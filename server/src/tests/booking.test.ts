import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from './setup.js';
import { resetRateLimits } from '../middleware/rateLimit.js';
import { findByPaymentId } from '../models/bookingModel.js';
import { MAX_GUESTS, MAX_NIGHTS, MAX_ROOMS } from '../controllers/bookingController.js';
import { useHotelNock, mockRoomPrices } from './helpers/hotelNock.js';
import { signIn, useAuthNock, type FakeSession } from './helpers/authNock.js';

/** UC4 — Book & Make Payment, end to end over HTTP. */

const VALID_GUEST = {
  salutation: 'Ms',
  firstName: 'Jane',
  lastName: 'Tan',
  email: 'jane@example.com',
  phone: '+65 9123 4567',
};

const VALID_STAY = {
  destinationId: 'RsBU',
  hotelId: 'marina-bay',
  hotelName: 'Marina Bay Sands',
  roomTypes: ['deluxe-king'],
  startDate: '2026-08-01',
  endDate: '2026-08-04',
  adults: 2,
  children: 0,
};

/** A complete billing address. */
const VALID_BILLING = {
  line1: '10 Bayfront Avenue',
  line2: '#12-34',
  city: 'Singapore',
  state: null,
  postalCode: '018956',
  country: 'SG',
};

/** A query string carries roomTypes comma-joined rather than as an array. */
const VALID_STAY_QUERY = { ...VALID_STAY, roomTypes: VALID_STAY.roomTypes.join(',') };

/** deluxe-king is 240/night × 3 nights, +9% tax */
const EXPECTED_TOTAL = 784.8;

/** The confirmation email logs a line per booking, and the suite creates enough of them to bury the reporter output. */
const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const original = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = original;
  }
};

/** Stripe puts the session id in the success URL; the browser sends it back. */
const sessionIdFrom = (redirectUrl: string): string => {
  const sessionId = new URL(redirectUrl).searchParams.get('session_id');
  expect(sessionId, `no session_id in ${redirectUrl}`).to.be.a('string');
  return sessionId as string;
};

/** Sequence steps 4-5: prices the stay and opens a checkout session. */
const startCheckout = async (
  body: Record<string, unknown> = {},
  session?: FakeSession
): Promise<string> => {
  const pending = request(app)
    .post('/api/bookings/payment')
    .send({ guestDetails: VALID_GUEST, stay: VALID_STAY, billingAddress: VALID_BILLING, ...body });

  const response = await (session ? pending.set(session.header) : pending);

  expect(response.status, JSON.stringify(response.body)).to.equal(200);
  return sessionIdFrom(response.body.redirectUrl);
};

/** Sequence steps 6-10: the whole flow, returning the booking that was written. */
const bookAndConfirm = async (
  body: Record<string, unknown> = {},
  session?: FakeSession
) => {
  const sessionId = await startCheckout(body, session);
  const response = await quietly(() =>
    request(app).post('/api/bookings/confirm').send({ sessionId })
  );

  expect(response.status, JSON.stringify(response.body)).to.equal(200);
  return response.body.booking;
};

describe('UC4 — Book & Make Payment', () => {
  useHotelNock();
  useAuthNock();

  // supertest reuses one loopback address, so every request shares a bucket.
  beforeEach(() => {
    resetRateLimits();
  });

  describe('GET /api/bookings/checkout', () => {
    it('prices a valid stay from server-side rates', async () => {
      const response = await request(app).get('/api/bookings/checkout').query(VALID_STAY_QUERY);

      expect(response.status).to.equal(200);
      expect(response.body).to.include({
        nights: 3,
        currency: 'SGD',
        nightlyTotal: 240,
        subtotal: 720,
        taxes: 64.8,
        totalPrice: EXPECTED_TOTAL,
      });
      expect(response.body.roomTypes).to.deep.equal(['deluxe-king']);
    });

    // Regression: the amount was once read straight from the request.
    it('ignores a price smuggled into the query string', async () => {
      const response = await request(app)
        .get('/api/bookings/checkout')
        .query({ ...VALID_STAY_QUERY, totalPrice: 0.01, subtotal: 0.01, nightlyTotal: 1 });

      expect(response.status).to.equal(200);
      expect(response.body.totalPrice).to.equal(EXPECTED_TOTAL);
      expect(response.body.nightlyTotal).to.equal(240);
    });

    /** An id outside the demo catalogue might be a real supplier room, so the server has to ask before it can say no — and the supplier answering "I sell no such room" is what makes this a 400 rather than a 502. */
    it('refuses to price an unknown room type', async () => {
      mockRoomPrices({ hotelId: 'marina-bay', rooms: [] });

      const response = await request(app)
        .get('/api/bookings/checkout')
        .query({ ...VALID_STAY_QUERY, roomTypes: 'invented-cheap-room' });

      expect(response.status).to.equal(400);
      expect(response.body.error).to.match(/not available/i);
    });

    // A plain lookup returns a function for these keys rather than undefined.
    it('refuses a room type inherited from Object.prototype', async () => {
      mockRoomPrices({ hotelId: 'marina-bay', rooms: [], times: 3 });

      for (const roomType of ['constructor', 'toString', '__proto__']) {
        const response = await request(app)
          .get('/api/bookings/checkout')
          .query({ ...VALID_STAY_QUERY, roomTypes: roomType });

        expect(response.status, roomType).to.equal(400);
        expect(response.body.error, roomType).to.match(/not available/i);
      }
    });

    it('rejects an end date before the start date', async () => {
      const response = await request(app)
        .get('/api/bookings/checkout')
        .query({ ...VALID_STAY_QUERY, startDate: '2026-08-04', endDate: '2026-08-01' });

      expect(response.status).to.equal(400);
    });

    it('rejects malformed dates', async () => {
      const response = await request(app)
        .get('/api/bookings/checkout')
        .query({ ...VALID_STAY_QUERY, startDate: 'not-a-date' });

      expect(response.status).to.equal(400);
    });

    it('rejects out-of-range occupancy and room counts', async () => {
      const noAdults = await request(app)
        .get('/api/bookings/checkout')
        .query({ ...VALID_STAY_QUERY, adults: 0 });
      expect(noAdults.status).to.equal(400);

      const tooManyGuests = await request(app)
        .get('/api/bookings/checkout')
        .query({ ...VALID_STAY_QUERY, adults: MAX_GUESTS + 1 });
      expect(tooManyGuests.status).to.equal(400);

      const tooManyRooms = await request(app)
        .get('/api/bookings/checkout')
        .query({
          ...VALID_STAY_QUERY,
          roomTypes: Array.from({ length: MAX_ROOMS + 1 }, () => 'deluxe-king').join(','),
        });
      expect(tooManyRooms.status).to.equal(400);
    });

    it('rejects a stay longer than MAX_NIGHTS', async () => {
      const endDate = new Date(Date.parse('2026-08-01') + (MAX_NIGHTS + 1) * 86_400_000)
        .toISOString()
        .slice(0, 10);

      const response = await request(app)
        .get('/api/bookings/checkout')
        .query({ ...VALID_STAY_QUERY, endDate });

      expect(response.status).to.equal(400);
    });
  });

  describe('POST /api/bookings/guest-details', () => {
    it('returns field errors for missing details (alternative flow 1a)', async () => {
      const response = await request(app)
        .post('/api/bookings/guest-details')
        .send({ salutation: '', firstName: '', lastName: '', email: '', phone: '' });

      expect(response.status).to.equal(422);
      expect(response.body.valid).to.equal(false);
      expect(response.body.errors).to.have.keys(
        'salutation',
        'firstName',
        'lastName',
        'email',
        'phone'
      );
    });

    it('rejects a salutation outside the allowlist', async () => {
      const response = await request(app)
        .post('/api/bookings/guest-details')
        .send({ ...VALID_GUEST, salutation: 'Lord' });

      expect(response.status).to.equal(422);
      expect(response.body.errors).to.have.property('salutation');
    });

    it('rejects a malformed email address', async () => {
      const response = await request(app)
        .post('/api/bookings/guest-details')
        .send({ ...VALID_GUEST, email: 'not-an-email' });

      expect(response.status).to.equal(422);
      expect(response.body.errors).to.have.property('email');
    });

    it('accepts complete, valid details', async () => {
      const response = await request(app).post('/api/bookings/guest-details').send(VALID_GUEST);

      expect(response.status).to.equal(200);
      expect(response.body).to.deep.equal({ valid: true });
    });
  });

  describe('POST /api/bookings/payment', () => {
    it('returns a redirect URL carrying the session id, and writes nothing', async () => {
      const response = await request(app)
        .post('/api/bookings/payment')
        .send({ guestDetails: VALID_GUEST, stay: VALID_STAY, billingAddress: VALID_BILLING });

      expect(response.status).to.equal(200);
      expect(response.body.redirectUrl).to.be.a('string');

      const sessionId = sessionIdFrom(response.body.redirectUrl);
      expect(sessionId).to.match(/^sim_sess_/);

      // The table cannot hold an unpaid booking, so nothing exists until the
      // charge clears. A row here would mean an unpaid stay is bookable.
      const reference = sessionId.replace('sim_sess_', '');
      expect(await findByPaymentId(`sim_pi_${reference}`)).to.equal(null);
    });

    it('never leaks the booking id or payment id into the payment response', async () => {
      const response = await request(app)
        .post('/api/bookings/payment')
        .send({ guestDetails: VALID_GUEST, stay: VALID_STAY, billingAddress: VALID_BILLING });

      expect(response.body).to.have.keys('redirectUrl');
    });

    // Regression: the amount was previously read straight from the request body.
    it('ignores a client-supplied amount', async () => {
      const booking = await bookAndConfirm({ amount: 0.01, totalPrice: 0.01, pricePaid: 0.01 });

      expect(booking.pricePaid).to.equal(EXPECTED_TOTAL);
    });

    // Regression: a forged room id used to be hashed into a price.
    it('ignores a price smuggled inside the stay object', async () => {
      const booking = await bookAndConfirm({
        stay: { ...VALID_STAY, totalPrice: 1, nightlyTotal: 1, subtotal: 1, taxes: 0 },
      });

      expect(booking.pricePaid).to.equal(EXPECTED_TOTAL);
    });

    it('rejects invalid guest details before opening a session', async () => {
      const response = await request(app)
        .post('/api/bookings/payment')
        .send({ guestDetails: { firstName: 'Jane' }, stay: VALID_STAY });

      expect(response.status).to.equal(422);
      expect(response.body.errors).to.have.property('lastName');
    });

    it('rejects an unknown room type', async () => {
      mockRoomPrices({ hotelId: 'marina-bay', rooms: [] });

      const response = await request(app)
        .post('/api/bookings/payment')
        .send({
          guestDetails: VALID_GUEST,
          billingAddress: VALID_BILLING,
          stay: { ...VALID_STAY, roomTypes: ['invented-cheap-room'] },
        });

      expect(response.status).to.equal(400);
      expect(response.body.error).to.match(/not available/i);
    });

    it('rejects a non-numeric occupancy rather than pricing it as NaN', async () => {
      for (const adults of ['abc', null, [], {}]) {
        const response = await request(app)
          .post('/api/bookings/payment')
          .send({
            guestDetails: VALID_GUEST,
            billingAddress: VALID_BILLING,
            stay: { ...VALID_STAY, adults },
          });

        expect(response.status, JSON.stringify(adults)).to.equal(400);
      }
    });

    it('rejects a userId that is not a UUID, while it is still free to do so', async () => {
      // user_id is a foreign key to profiles: a malformed one fails at insert
      // time, which is long after the card has been charged.
      const response = await request(app)
        .post('/api/bookings/payment')
        .send({ guestDetails: VALID_GUEST, stay: VALID_STAY, billingAddress: VALID_BILLING, userId: 'not-a-uuid' });

      expect(response.status).to.equal(400);
      expect(response.body.error).to.match(/uuid/i);
    });

    it('rejects special requests too long to fit a Stripe metadata value', async () => {
      const response = await request(app)
        .post('/api/bookings/payment')
        .send({
          guestDetails: { ...VALID_GUEST, specialRequests: 'a'.repeat(600) },
          stay: VALID_STAY,
        });

      expect(response.status).to.equal(422);
      expect(response.body.errors).to.have.property('specialRequests');
    });

    it('names the oversized field when the stay will not fit in the metadata', async () => {
      // Stripe caps a metadata value at 500 characters and rejects the whole
      // session if one is over, which would surface as an opaque 502 at the last
      // step of the funnel. Each field is individually in range here; it is the
      // serialised stay that is not.
      const response = await request(app)
        .post('/api/bookings/payment')
        .send({
          guestDetails: VALID_GUEST,
          billingAddress: VALID_BILLING,
          stay: {
            ...VALID_STAY,
            destinationId: 'd'.repeat(64),
            hotelId: 'h'.repeat(64),
            hotelName: 'n'.repeat(200),
            roomTypes: Array.from({ length: MAX_ROOMS }, () => 'executive-suite'),
          },
        });

      expect(response.status).to.equal(400);
      expect(response.body.error).to.contain('stay');
    });
  });

  describe('POST /api/bookings/confirm', () => {
    /** The duplicate-bookings defect, end to end. */
    it('writes one booking when two confirmations arrive together', async () => {
      const sessionId = await startCheckout();

      const [first, second] = await Promise.all([
        quietly(() => request(app).post('/api/bookings/confirm').send({ sessionId })),
        quietly(() => request(app).post('/api/bookings/confirm').send({ sessionId })),
      ]);

      expect(first.status, JSON.stringify(first.body)).to.equal(200);
      expect(second.status, JSON.stringify(second.body)).to.equal(200);

      // Same row, not two rows that happen to describe the same stay.
      expect(second.body.booking.id).to.equal(first.body.booking.id);
    });

    it('writes the booking once Stripe says the charge cleared', async () => {
      const booking = await bookAndConfirm();

      expect(booking.id).to.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(booking.pricePaid).to.equal(EXPECTED_TOTAL);
      expect(booking.paymentId).to.match(/^sim_pi_/);
      expect(booking.hotelName).to.equal('Marina Bay Sands');
      expect(booking.nights).to.equal(3);
      expect(booking.guest.email).to.equal('jane@example.com');
      expect(booking.card).to.include({ brand: 'visa', last4: '4242' });
    });

    it('carries the guest and stay across the redirect in the session metadata', async () => {
      // Nothing was persisted before payment, so the metadata is the only thing
      // that survives the trip to the hosted page — if it did not, the charge
      // would clear with no way to know what was booked.
      const booking = await bookAndConfirm({
        guestDetails: { ...VALID_GUEST, specialRequests: 'Late check-in, around 11pm.' },
        stay: { ...VALID_STAY, roomTypes: ['deluxe-king', 'standard-queen'], children: 2 },
      });

      expect(booking.roomTypes).to.deep.equal(['deluxe-king', 'standard-queen']);
      expect(booking.children).to.equal(2);
      expect(booking.specialRequests).to.equal('Late check-in, around 11pm.');
      expect(booking.guest.salutation).to.equal('Ms');
      expect(booking.guest.lastName).to.equal('Tan');
    });

    it('records the userId when the booking was made by a signed-in guest', async () => {
      const session = signIn();

      const booking = await bookAndConfirm({}, session);

      expect(booking.userId).to.equal(session.userId);
    });

    it('records no userId when the booking was made without signing in', async () => {
      // Guest checkout is a supported flow, not a degraded one: no token means
      // no account, and the booking is still written.
      const booking = await bookAndConfirm();

      expect(booking.userId).to.equal(null);
    });

    it('takes the account from the token even when the body claims another', async () => {
      // The body is a claim; the token is the credential. This is the case that
      // would otherwise let a signed-in guest post a booking into a stranger's
      // history, so it must fail loudly rather than resolve either way.
      const session = signIn();
      const response = await request(app)
        .post('/api/bookings/payment')
        .set(session.header)
        .send({
          guestDetails: VALID_GUEST,
          stay: VALID_STAY,
          billingAddress: VALID_BILLING,
          userId: randomUUID(),
        });

      expect(response.status).to.equal(403);
      expect(response.body.error).to.match(/another account/i);
    });

    it('refuses to attribute a booking to an account with no token to prove it', async () => {
      // Silently writing this as a guest checkout would be worse than failing:
      // a guest who believes they are signed in would pay, and then not find
      // the booking on the history page they expect it on.
      const response = await request(app)
        .post('/api/bookings/payment')
        .send({
          guestDetails: VALID_GUEST,
          stay: VALID_STAY,
          billingAddress: VALID_BILLING,
          userId: randomUUID(),
        });

      expect(response.status).to.equal(401);
      expect(response.body.error).to.match(/sign in/i);
    });

    it('requires a session id', async () => {
      for (const sessionId of [undefined, '', '   ', 42, null]) {
        const response = await request(app).post('/api/bookings/confirm').send({ sessionId });

        expect(response.status, JSON.stringify(sessionId)).to.equal(400);
      }
    });

    /** Regression: the transaction id used to be accepted on truthiness alone, which made the payment endpoint entirely optional — anyone could POST a made-up id and receive a confirmed booking. */
    it('cannot be made to write a booking from a forged session id', async () => {
      const forged = `sim_sess_${randomUUID()}`;

      const response = await quietly(() =>
        request(app).post('/api/bookings/confirm').send({ sessionId: forged })
      );

      // The simulator never issued this session, so no metadata comes back and
      // there is nothing to turn into a booking.
      expect(response.status).to.equal(422);
      expect(response.body.booking).to.equal(undefined);
      expect(await findByPaymentId(`sim_pi_${forged.replace('sim_sess_', '')}`)).to.equal(null);
    });

    it('cannot be made to write a booking from an id Stripe never issued', async () => {
      // Not simulator-shaped, so this reaches the real client — where the
      // suite-wide network block refuses it. A booking must not appear either
      // way, and the failure must not be reported as a payment problem.
      const response = await quietly(() =>
        request(app).post('/api/bookings/confirm').send({ sessionId: 'totally_made_up' })
      );

      expect(response.status).to.equal(502);
      expect(response.body.booking).to.equal(undefined);
      expect(JSON.stringify(response.body)).to.not.contain('sk_test');
    });

    /** The browser return and the webhook race each other, and a guest refreshing the confirmation page replays this endpoint. */
    it('is idempotent across repeated confirmations', async () => {
      const sessionId = await startCheckout();

      const responses = await quietly(async () => [
        await request(app).post('/api/bookings/confirm').send({ sessionId }),
        await request(app).post('/api/bookings/confirm').send({ sessionId }),
        await request(app).post('/api/bookings/confirm').send({ sessionId }),
      ]);

      const ids = new Set<string>();
      for (const response of responses) {
        expect(response.status).to.equal(200);
        ids.add(response.body.booking.id);
      }

      expect(ids.size).to.equal(1);
    });

    it('sends the confirmation email exactly once however often it is replayed', async () => {
      // The findByPaymentId short-circuit inside recordPaidBooking is the only
      // thing between a refreshed confirmation page and a guest receiving three
      // identical emails.
      const sessionId = await startCheckout();

      const original = console.log;
      const lines: string[] = [];
      console.log = (...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      };
      try {
        await request(app).post('/api/bookings/confirm').send({ sessionId });
        await request(app).post('/api/bookings/confirm').send({ sessionId });
        await request(app).post('/api/bookings/confirm').send({ sessionId });
      } finally {
        console.log = original;
      }

      const emails = lines.filter((line) => line.includes('Booking confirmation queued'));
      expect(emails).to.have.lengthOf(1);
    });
  });

  describe('GET /api/bookings/:id', () => {
    it('rejects a malformed id without hitting storage', async () => {
      for (const id of ['not-a-uuid', "' or 1=1", 'x'.repeat(4096)]) {
        const response = await request(app).get(`/api/bookings/${encodeURIComponent(id)}`);
        expect(response.status, id.slice(0, 20)).to.equal(400);
      }
    });

    it('returns 404 for a well-formed but unknown id', async () => {
      const response = await request(app).get(`/api/bookings/${randomUUID()}`);

      expect(response.status).to.equal(404);
    });

    it('returns the booking and never exposes card data beyond the last four', async () => {
      const booking = await bookAndConfirm();

      const response = await request(app).get(`/api/bookings/${booking.id}`);

      expect(response.status).to.equal(200);
      expect(response.body.id).to.equal(booking.id);
      expect(response.body.card.last4).to.equal('4242');

      // Brand, last four and expiry are the only card fields PCI-DSS permits
      // storing; nothing else may ever reach a response body.
      const serialised = JSON.stringify(response.body);
      expect(serialised).to.not.match(/cardNumber|cvc|securityCode|\bpan\b/i);
    });
  });

  /** The response carries names, emails, phone numbers, stay dates and card last-four, so most of what is asserted here is who is allowed to see it. */
  describe('GET /api/bookings/user/:userId', () => {
    it('rejects a malformed userId', async () => {
      const session = signIn();
      const response = await request(app)
        .get('/api/bookings/user/not-a-uuid')
        .set(session.header);

      expect(response.status).to.equal(400);
      expect(response.body.error).to.match(/userId/i);
    });

    it('refuses an anonymous request', async () => {
      const response = await request(app).get(`/api/bookings/user/${randomUUID()}`);

      expect(response.status).to.equal(401);
    });

    it('refuses to show one user the bookings of another', async () => {
      // The whole point of the endpoint's authorisation: a UUID in the path is
      // an identifier, so knowing someone's must not be enough to read their
      // history.
      const session = signIn();
      const response = await request(app)
        .get(`/api/bookings/user/${randomUUID()}`)
        .set(session.header);

      expect(response.status).to.equal(403);
      expect(response.body.error).to.match(/your own/i);
    });

    it('returns an empty list for a user with no bookings', async () => {
      const session = signIn();
      const response = await request(app)
        .get(`/api/bookings/user/${session.userId}`)
        .set(session.header);

      expect(response.status).to.equal(200);
      expect(response.body).to.deep.equal({ bookings: [] });
    });

    it('returns only that user\'s bookings', async () => {
      const me = signIn();
      const someoneElse = signIn();
      const mine = await bookAndConfirm({}, me);
      const theirs = await bookAndConfirm({}, someoneElse);

      const response = await request(app)
        .get(`/api/bookings/user/${me.userId}`)
        .set(me.header);

      expect(response.status).to.equal(200);
      const ids = response.body.bookings.map((booking: { id: string }) => booking.id);
      expect(ids).to.include(mine.id);
      expect(ids).to.not.include(theirs.id);
    });
  });

  /** Route ordering. */
  describe('route ordering', () => {
    it('reaches the quote handler at /api/bookings/checkout, not the id lookup', async () => {
      const response = await request(app).get('/api/bookings/checkout').query(VALID_STAY_QUERY);

      expect(response.status).to.equal(200);
      expect(response.body.totalPrice).to.equal(EXPECTED_TOTAL);
    });

    it('still reaches the quote handler when the query is invalid', async () => {
      // The failure mode this guards is subtle: swallowed by /:id, the endpoint
      // still 400s — but with the wrong error, so the client sees a booking-id
      // complaint about a search form.
      const response = await request(app).get('/api/bookings/checkout');

      expect(response.status).to.equal(400);
      expect(response.body.error).to.match(/destinationId/i);
      expect(response.body.error).to.not.match(/booking id/i);
    });

    it('reaches the user handler at /api/bookings/user/:userId', async () => {
      const session = signIn();
      const response = await request(app)
        .get(`/api/bookings/user/${session.userId}`)
        .set(session.header);

      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('bookings');
    });
  });

  // Regression: the allowlist was once pinned to the single literal
  // "http://localhost:3000", so opening the app on 127.0.0.1 or the LAN address
  // Vite prints as "Network:" silently broke every API call — the destination
  // dropdown just stopped appearing, with no visible error.
  describe('CORS in development', () => {
    const localOrigins = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://10.32.37.20:3000',
      'http://192.168.1.50:3000',
      'http://172.17.0.2:3000',
    ];

    for (const origin of localOrigins) {
      it(`allows ${origin}`, async () => {
        const response = await request(app)
          .get('/api/destinations/search')
          .query({ q: 'singapore' })
          .set('Origin', origin);

        expect(response.status).to.equal(200);
        expect(response.headers['access-control-allow-origin']).to.equal(origin);
      });
    }

    it('does not grant a foreign origin, and does not 500 doing so', async () => {
      const response = await request(app)
        .get('/api/destinations/search')
        .query({ q: 'singapore' })
        .set('Origin', 'https://evil.com');

      expect(response.headers['access-control-allow-origin']).to.equal(undefined);
      expect(response.status).to.not.equal(500);
    });
  });

  describe('rate limiting', () => {
    it('throttles repeated payment attempts from one address', async () => {
      // Unthrottled, /payment is a card-testing surface and /confirm is a
      // session-enumeration one.
      const statuses: number[] = [];

      await quietly(async () => {
        for (let attempt = 0; attempt < 13; attempt += 1) {
          const response = await request(app)
            .post('/api/bookings/payment')
            .send({ guestDetails: VALID_GUEST, stay: VALID_STAY, billingAddress: VALID_BILLING });
          statuses.push(response.status);
        }
      });

      expect(statuses).to.include(429);
      expect(statuses.filter((status) => status === 200).length).to.be.at.most(10);
    });
  });
});
