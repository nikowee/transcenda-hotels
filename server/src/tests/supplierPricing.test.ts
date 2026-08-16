import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from './setup.js';
import { resetRateLimits } from '../middleware/rateLimit.js';
import { recordPaidBooking } from '../controllers/bookingController.js';
import { __clearRateCache } from '../services/hotelRoomService.js';
import { useHotelNock, mockRoomPrices, ascendaRoom, mockPriceFailure } from './helpers/hotelNock.js';

/** Booking a room the supplier priced, over HTTP. */

const ROOM_KEY = '2eb243ba-2f54-561b-8069-0db1439138f1';
const HOTEL_ID = 'diH7';

const STAY = {
  destinationId: 'WD0M',
  hotelId: HOTEL_ID,
  hotelName: 'The Fullerton Bay Hotel',
  roomTypes: [ROOM_KEY],
  startDate: '2026-10-01',
  endDate: '2026-10-04',
  adults: 2,
  children: 0,
};

const GUEST = {
  salutation: 'Ms',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '+65 9123 4567',
};

const BILLING = {
  line1: '80 Collyer Quay',
  city: 'Singapore',
  postalCode: '049326',
  country: 'SG',
};

const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const error = console.error;
  const warn = console.warn;
  const log = console.log;
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.error = error;
    console.warn = warn;
    console.log = log;
  }
};

/** Mints a simulated session and digs out the id Stripe would have substituted. */
const startPayment = async (): Promise<string> => {
  const response = await request(app)
    .post('/api/bookings/payment')
    .send({ guestDetails: GUEST, billingAddress: BILLING, stay: STAY });

  expect(response.status, JSON.stringify(response.body)).to.equal(200);

  const sessionId = new URL(response.body.redirectUrl).searchParams.get('session_id');
  expect(sessionId).to.be.a('string');
  return sessionId as string;
};

describe('booking a supplier-priced room', () => {
  useHotelNock();

  beforeEach(() => {
    resetRateLimits();
  });

  it('quotes a real room from the supplier rather than refusing it', async () => {
    mockRoomPrices({ hotelId: HOTEL_ID });

    const response = await request(app)
      .get('/api/bookings/checkout')
      .query({ ...STAY, roomTypes: ROOM_KEY });

    expect(response.status).to.equal(200);
    expect(response.body.totalPrice).to.equal(1990.49);
    expect(response.body.taxes).to.equal(286.03);
    // subtotal + taxes has to equal the total exactly, or the on-screen
    // breakdown does not add up.
    expect(response.body.subtotal + response.body.taxes).to.equal(response.body.totalPrice);
  });

  it('charges and stores the supplier price, not a demo rate', async () => {
    mockRoomPrices({ hotelId: HOTEL_ID, times: 2 });

    const sessionId = await startPayment();
    const confirmed = await quietly(() =>
      request(app).post('/api/bookings/confirm').send({ sessionId })
    );

    expect(confirmed.status).to.equal(200);
    expect(confirmed.body.booking.pricePaid).to.equal(1990.49);
    expect(confirmed.body.booking.roomTypes).to.deep.equal([ROOM_KEY]);
  });

  /** The regression this whole quotedTotal mechanism exists for. */
  it('honours the quoted price when the supplier moves its rate mid-checkout', async () => {
    mockRoomPrices({ hotelId: HOTEL_ID, rooms: [ascendaRoom({ key: ROOM_KEY, total: 900, taxes: 100 })] });
    const sessionId = await startPayment();

    // The supplier reprices while the guest is on the payment page.
    __clearRateCache();
    mockRoomPrices({ hotelId: HOTEL_ID, rooms: [ascendaRoom({ key: ROOM_KEY, total: 1500, taxes: 150 })] });

    const confirmed = await quietly(() =>
      request(app).post('/api/bookings/confirm').send({ sessionId })
    );

    expect(confirmed.status).to.equal(200);
    expect(confirmed.body.booking.pricePaid).to.equal(900);
  });

  /** Ascenda scopes room keys to the price search that issued them: ask for the same hotel and dates twice and the same room comes back under a new uuid. */
  it('records the booking when the room key has rotated out of the supplier search', async () => {
    mockRoomPrices({ hotelId: HOTEL_ID, rooms: [ascendaRoom({ key: ROOM_KEY, total: 900, taxes: 100 })] });
    const sessionId = await startPayment();

    // A later search: same room, new key. The one we sold is unfindable.
    __clearRateCache();
    mockRoomPrices({
      hotelId: HOTEL_ID,
      rooms: [ascendaRoom({ key: 'f0b5be9c-2507-506b-a064-7dba696c6d7f', total: 900, taxes: 100 })],
    });

    const confirmed = await quietly(() =>
      request(app).post('/api/bookings/confirm').send({ sessionId })
    );

    expect(confirmed.status).to.equal(200);
    expect(confirmed.body.booking.pricePaid).to.equal(900);
    // The key that was sold, not the one the later search returned.
    expect(confirmed.body.booking.roomTypes).to.deep.equal([ROOM_KEY]);
  });

  /** The other side of that coin. */
  it('still refuses a captured amount that does not match the quoted one', async () => {
    const outcome = await quietly(() =>
      recordPaidBooking({
        paid: true,
        paymentIntentId: `pi_supplier_${randomUUID()}`,
        // Quoted at 900; something charged 1500.
        amountTotal: 150_000,
        currency: 'sgd',
        payeeId: 'cus_test',
        card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
        clientReferenceId: randomUUID(),
        metadata: {
          guest: JSON.stringify(GUEST),
          stay: JSON.stringify(STAY),
          quotedTotal: '900.00',
        },
        simulated: false,
      })
    );

    expect(outcome.ok).to.equal(false);
    if (outcome.ok) return;
    expect(outcome.status).to.equal(409);
  });

  it('reports a supplier outage as an upstream fault, not a bad request', async () => {
    mockPriceFailure(HOTEL_ID);

    const response = await quietly(() =>
      request(app)
        .get('/api/bookings/checkout')
        .query({ ...STAY, roomTypes: ROOM_KEY })
    );

    expect(response.status).to.equal(502);
    // A 400 would tell the guest they asked for something invalid, which is
    // both wrong and unactionable — the stay is fine, we are not.
    expect(response.body.error).to.match(/hotel/i);
  });

  it('leaves the offline demo rooms priced without touching the supplier', async () => {
    // No interceptor: globalSetup blocks outbound sockets, so any request the
    // demo path makes fails this test.
    const response = await request(app)
      .get('/api/bookings/checkout')
      .query({ ...STAY, roomTypes: 'deluxe-king' });

    expect(response.status).to.equal(200);
    expect(response.body.totalPrice).to.equal(784.8);
  });

  /** A stay with one real room and one demo slug still has to price both, which only works because the two tables are merged rather than one replacing the other. */
  it('prices a mixed basket from both tables at once', async () => {
    mockRoomPrices({ hotelId: HOTEL_ID });

    const response = await request(app)
      .get('/api/bookings/checkout')
      .query({ ...STAY, roomTypes: `${ROOM_KEY},deluxe-king` });

    expect(response.status).to.equal(200);
    expect(response.body.nightlyRates).to.deep.equal([568.15, 240]);
    expect(response.body.totalPrice).to.equal(1990.49 + 784.8);
  });
});
