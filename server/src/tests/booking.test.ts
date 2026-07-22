import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { app } from './setup.js';
import { resetRateLimits } from '../middleware/rateLimit.js';

/**
 * UC4 — Book & Make Payment.
 *
 * Runs against the simulated gateway (PAYMENTS_MODE=simulate, set in ./env), so
 * no Stripe credentials are needed. The simulator mirrors the real branch's
 * shape: session ids are `sim_sess_<bookingReference>`, which is what a genuine
 * return from Stripe carries in its session_id query parameter.
 *
 * Most of these assert security properties rather than happy-path behaviour —
 * they are the regression net for the payment-bypass and price-manipulation
 * findings, and each one maps to a specific defect that was live at one point.
 */

const VALID_GUEST = {
  guestName: 'Jane Tan',
  guestEmail: 'jane@example.com',
  contactNumber: '+65 9123 4567',
};

const VALID_STAY = {
  hotelId: 'marina-bay',
  roomId: 'deluxe-king',
  checkIn: '2026-08-01',
  checkOut: '2026-08-04',
  guests: 2,
  rooms: 1,
};

/** deluxe-king is 240/night × 3 nights × 1 room, +9% tax */
const EXPECTED_TOTAL = 784.8;

const createPendingBooking = async (): Promise<string> => {
  const response = await request(app)
    .post('/api/bookings/payment')
    .send({ guestDetails: VALID_GUEST, stay: VALID_STAY });

  expect(response.status).to.equal(200);
  return response.body.bookingReference;
};

describe('UC4 — Book & Make Payment', () => {
  // supertest reuses one loopback address, so every request shares a bucket.
  beforeEach(() => {
    resetRateLimits();
  });

  describe('GET /api/bookings/checkout', () => {
    it('prices a valid stay from server-side rates', async () => {
      const response = await request(app).get('/api/bookings/checkout').query(VALID_STAY);

      expect(response.status).to.equal(200);
      expect(response.body).to.include({
        nights: 3,
        currency: 'SGD',
        nightlyRate: 240,
        subtotal: 720,
        totalPrice: EXPECTED_TOTAL,
      });
    });

    it('refuses to price an unknown room type', async () => {
      const response = await request(app)
        .get('/api/bookings/checkout')
        .query({ ...VALID_STAY, roomId: 'invented-cheap-room' });

      expect(response.status).to.equal(400);
      expect(response.body.error).to.match(/not available/i);
    });

    it('rejects a check-out before check-in', async () => {
      const response = await request(app)
        .get('/api/bookings/checkout')
        .query({ ...VALID_STAY, checkIn: '2026-08-04', checkOut: '2026-08-01' });

      expect(response.status).to.equal(400);
    });

    it('rejects malformed dates', async () => {
      const response = await request(app)
        .get('/api/bookings/checkout')
        .query({ ...VALID_STAY, checkIn: 'not-a-date' });

      expect(response.status).to.equal(400);
    });

    it('rejects out-of-range guest and room counts', async () => {
      const tooManyGuests = await request(app)
        .get('/api/bookings/checkout')
        .query({ ...VALID_STAY, guests: 99 });
      expect(tooManyGuests.status).to.equal(400);

      const tooManyRooms = await request(app)
        .get('/api/bookings/checkout')
        .query({ ...VALID_STAY, rooms: 0 });
      expect(tooManyRooms.status).to.equal(400);
    });
  });

  describe('POST /api/bookings/guest-details', () => {
    it('returns field errors for missing details (alternative flow 1a)', async () => {
      const response = await request(app)
        .post('/api/bookings/guest-details')
        .send({ guestName: '', guestEmail: '', contactNumber: '' });

      expect(response.status).to.equal(422);
      expect(response.body.errors).to.have.keys(
        'guestName',
        'guestEmail',
        'contactNumber'
      );
    });

    it('rejects a malformed email address', async () => {
      const response = await request(app)
        .post('/api/bookings/guest-details')
        .send({ ...VALID_GUEST, guestEmail: 'not-an-email' });

      expect(response.status).to.equal(422);
      expect(response.body.errors).to.have.property('guestEmail');
    });

    it('accepts complete, valid details', async () => {
      const response = await request(app)
        .post('/api/bookings/guest-details')
        .send(VALID_GUEST);

      expect(response.status).to.equal(200);
      expect(response.body).to.deep.equal({ valid: true });
    });
  });

  describe('POST /api/bookings/payment', () => {
    it('creates a PENDING booking and returns a redirect URL', async () => {
      const response = await request(app)
        .post('/api/bookings/payment')
        .send({ guestDetails: VALID_GUEST, stay: VALID_STAY });

      expect(response.status).to.equal(200);
      expect(response.body.bookingReference).to.match(/^TRX-[A-Z0-9]+$/);
      expect(response.body.redirectUrl).to.be.a('string');

      const booking = await request(app).get(
        `/api/bookings/${response.body.bookingReference}`
      );
      expect(booking.body.paymentStatus).to.equal('PENDING');
    });

    // Regression: the amount was previously read straight from the request body.
    it('ignores a client-supplied amount', async () => {
      const response = await request(app).post('/api/bookings/payment').send({
        guestDetails: VALID_GUEST,
        stay: VALID_STAY,
        amount: 0.01,
        totalPrice: 0.01,
      });

      expect(response.status).to.equal(200);

      const booking = await request(app).get(
        `/api/bookings/${response.body.bookingReference}`
      );
      expect(booking.body.totalPrice).to.equal(EXPECTED_TOTAL);
    });

    // Regression: a forged roomId used to be hashed into a price.
    it('ignores a price smuggled inside the stay object', async () => {
      const response = await request(app)
        .post('/api/bookings/payment')
        .send({
          guestDetails: VALID_GUEST,
          stay: { ...VALID_STAY, totalPrice: 1, nightlyRate: 1 },
        });

      expect(response.status).to.equal(200);

      const booking = await request(app).get(
        `/api/bookings/${response.body.bookingReference}`
      );
      expect(booking.body.totalPrice).to.equal(EXPECTED_TOTAL);
    });

    it('rejects invalid guest details before creating anything', async () => {
      const response = await request(app)
        .post('/api/bookings/payment')
        .send({ guestDetails: { guestName: 'x' }, stay: VALID_STAY });

      expect(response.status).to.equal(422);
      expect(response.body.errors).to.exist;
    });

    it('rejects an unknown room type', async () => {
      const response = await request(app)
        .post('/api/bookings/payment')
        .send({
          guestDetails: VALID_GUEST,
          stay: { ...VALID_STAY, roomId: 'invented-cheap-room' },
        });

      expect(response.status).to.equal(400);
    });
  });

  describe('POST /api/bookings/confirm', () => {
    // Regression: the transaction id used to be accepted on truthiness alone,
    // which made the payment endpoint entirely optional.
    it('rejects a forged session id', async () => {
      const reference = await createPendingBooking();

      const response = await request(app)
        .post('/api/bookings/confirm')
        .send({ sessionId: 'totally_made_up', bookingReference: reference });

      expect(response.status).to.be.oneOf([400, 402, 502]);

      const booking = await request(app).get(`/api/bookings/${reference}`);
      expect(booking.body.paymentStatus).to.equal('PENDING');
    });

    it("rejects a session belonging to a different booking", async () => {
      const reference = await createPendingBooking();

      const response = await request(app).post('/api/bookings/confirm').send({
        sessionId: 'sim_sess_TRX-SOMEONEELSE',
        bookingReference: reference,
      });

      expect(response.status).to.equal(400);

      const booking = await request(app).get(`/api/bookings/${reference}`);
      expect(booking.body.paymentStatus).to.equal('PENDING');
    });

    it('requires both a session id and a booking reference', async () => {
      const response = await request(app)
        .post('/api/bookings/confirm')
        .send({ sessionId: 'sim_sess_TRX-ABC' });

      expect(response.status).to.equal(400);
    });

    it('marks the booking PAID on a legitimate return from checkout', async () => {
      const reference = await createPendingBooking();

      const response = await request(app)
        .post('/api/bookings/confirm')
        .send({ sessionId: `sim_sess_${reference}`, bookingReference: reference });

      expect(response.status).to.equal(200);
      expect(response.body.booking.paymentStatus).to.equal('PAID');
    });

    // The webhook and the browser return race each other; both call markPaid.
    it('is idempotent across repeated confirmations', async () => {
      const reference = await createPendingBooking();
      const payload = {
        sessionId: `sim_sess_${reference}`,
        bookingReference: reference,
      };

      const first = await request(app).post('/api/bookings/confirm').send(payload);
      const second = await request(app).post('/api/bookings/confirm').send(payload);
      const third = await request(app).post('/api/bookings/confirm').send(payload);

      for (const response of [first, second, third]) {
        expect(response.status).to.equal(200);
        expect(response.body.booking.paymentStatus).to.equal('PAID');
      }
    });
  });

  describe('GET /api/bookings/:reference', () => {
    it('rejects a malformed reference without hitting storage', async () => {
      const response = await request(app).get('/api/bookings/not-a-reference');
      expect(response.status).to.equal(400);
    });

    it('returns 404 for a well-formed but unknown reference', async () => {
      const response = await request(app).get('/api/bookings/TRX-ZZZZZZZZZZ');
      expect(response.status).to.equal(404);
    });

    it('returns the booking and never exposes card data', async () => {
      const reference = await createPendingBooking();
      const response = await request(app).get(`/api/bookings/${reference}`);

      expect(response.status).to.equal(200);
      expect(response.body.bookingReference).to.equal(reference);

      const serialised = JSON.stringify(response.body);
      expect(serialised).to.not.match(/cardNumber|cvc|expiry|pan/i);
    });
  });

  describe('POST /api/webhooks/stripe', () => {
    it('rejects a payload with no signature header', async () => {
      const response = await request(app)
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send({ type: 'checkout.session.completed' });

      expect(response.status).to.equal(400);
    });

    // 503 rather than 400 when STRIPE_WEBHOOK_SECRET is unset, which is the case
    // under test: a 400 would tell Stripe to discard the event permanently, so a
    // misconfiguration on our side must stay retryable.
    it('never accepts an unverified payload', async () => {
      const response = await request(app)
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 't=1,v1=deadbeef')
        .send({ type: 'checkout.session.completed' });

      expect(response.status).to.be.oneOf([400, 503]);
      expect(response.body.error).to.match(/signature|not configured/i);
    });
  });

  describe('rate limiting', () => {
    it('throttles repeated payment attempts from one address', async () => {
      const statuses: number[] = [];

      for (let attempt = 0; attempt < 13; attempt += 1) {
        const response = await request(app)
          .post('/api/bookings/payment')
          .send({ guestDetails: VALID_GUEST, stay: VALID_STAY });
        statuses.push(response.status);
      }

      expect(statuses).to.include(429);
      expect(statuses.filter((status) => status === 200).length).to.be.at.most(10);
    });
  });
});
