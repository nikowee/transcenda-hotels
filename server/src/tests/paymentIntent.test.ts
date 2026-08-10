import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import nock from 'nock';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { app } from './setup.js';
import { resetRateLimits } from '../middleware/rateLimit.js';
import { findByPaymentId } from '../models/bookingModel.js';
import { MAX_ROOMS } from '../controllers/bookingController.js';
import { useHotelNock, mockRoomPrices } from './helpers/hotelNock.js';
import { signIn, useAuthNock, type FakeSession } from './helpers/authNock.js';
import {
  STRIPE_API,
  useStripeNock,
  withLiveStripe,
  cardPaymentMethod,
  retrievedPaymentIntent,
  withSilencedErrorLog,
} from './helpers/stripeNock.js';

/** UC4 — the embedded Stripe Elements flow, end to end over HTTP. */

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

/** deluxe-king is 240/night × 3 nights, +9% tax. */
const EXPECTED_TOTAL = 784.8;
const EXPECTED_MINOR = 78480;

/** What the simulator reports for the NOT NULL card columns. */
const SIMULATED_CARD = { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 };

/** Mirrors toSessionMetadata, for the live-mode intents nock hands back. */
const METADATA = {
  guest: JSON.stringify(VALID_GUEST),
  stay: JSON.stringify(VALID_STAY),
};

/** The confirmation email logs a line per booking, and this suite writes enough of them to bury the reporter output. */
const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const original = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = original;
  }
};

/** Every request resets the limiter first. */
const postIntent = async (body: Record<string, unknown> = {}, session?: FakeSession) => {
  resetRateLimits();
  const pending = request(app)
    .post('/api/bookings/payment-intent')
    .send({ guestDetails: VALID_GUEST, stay: VALID_STAY, billingAddress: VALID_BILLING, ...body });

  return session ? pending.set(session.header) : pending;
};

const postConfirm = async (body: Record<string, unknown>) => {
  resetRateLimits();
  return quietly(() => request(app).post('/api/bookings/confirm').send(body));
};

/** For the refusals: the handler logs the reason it turned a charge away, which is exactly right in production and pure noise in a run where the refusal is the assertion. */
const postConfirmExpectingRefusal = async (body: Record<string, unknown>) =>
  withSilencedErrorLog(() => postConfirm(body));

/** Mints an intent and returns its id, asserting the endpoint actually worked. */
const startIntent = async (
  body: Record<string, unknown> = {},
  session?: FakeSession
): Promise<string> => {
  const response = await postIntent(body, session);
  expect(response.status, JSON.stringify(response.body)).to.equal(200);
  expect(response.body.paymentIntentId).to.be.a('string');
  return response.body.paymentIntentId as string;
};

/** The whole Elements flow, returning the booking that was written. */
const bookViaIntent = async (
  body: Record<string, unknown> = {},
  confirmExtras = {},
  session?: FakeSession
) => {
  const paymentIntentId = await startIntent(body, session);
  const response = await postConfirm({ paymentIntentId, ...confirmExtras });

  expect(response.status, JSON.stringify(response.body)).to.equal(200);
  return response.body.booking;
};

/** The hosted-Checkout flow, for the tests that compare the two. */
const bookViaSession = async (body: Record<string, unknown> = {}) => {
  resetRateLimits();
  const payment = await request(app)
    .post('/api/bookings/payment')
    .send({ guestDetails: VALID_GUEST, stay: VALID_STAY, billingAddress: VALID_BILLING, ...body });

  expect(payment.status, JSON.stringify(payment.body)).to.equal(200);
  const sessionId = new URL(payment.body.redirectUrl).searchParams.get('session_id');

  const response = await postConfirm({ sessionId });
  expect(response.status, JSON.stringify(response.body)).to.equal(200);
  return response.body.booking;
};

describe('UC4 — Elements / PaymentIntent payment flow', () => {
  useHotelNock();
  useAuthNock();

  beforeEach(() => {
    resetRateLimits();
  });

  describe('POST /api/bookings/payment-intent', () => {
    it('returns a client secret and the server-priced amount, and writes nothing', async () => {
      const response = await postIntent();

      expect(response.status).to.equal(200);
      expect(response.body).to.have.keys(
        'clientSecret',
        'paymentIntentId',
        'amount',
        'currency',
        'simulated',
        'quote'
      );
      expect(response.body.paymentIntentId).to.match(/^sim_pi_/);
      expect(response.body.clientSecret).to.contain(response.body.paymentIntentId);
      expect(response.body.amount).to.equal(EXPECTED_TOTAL);
      expect(response.body.currency).to.equal('SGD');

      // The summary the payment page renders is the same quote the intent was
      // minted from, so what is shown and what is charged cannot drift apart.
      expect(response.body.quote.totalPrice).to.equal(response.body.amount);
      expect(response.body.quote.currency).to.equal(response.body.currency);
      expect(response.body.quote.hotelName).to.equal(VALID_STAY.hotelName);
      expect(response.body.quote.roomLabels).to.deep.equal(['Deluxe King']);

      // The table cannot hold an unpaid booking, so nothing exists until the
      // browser confirms the card and comes back to /confirm.
      expect(await findByPaymentId(response.body.paymentIntentId)).to.equal(null);
    });

    it('echoes an amount that matches a quote built independently by the server', async () => {
      // Not a restated constant: the figure the payment page displays has to be
      // the same one GET /checkout quoted, or the customer is shown one price
      // and charged another.
      const quote = await request(app)
        .get('/api/bookings/checkout')
        .query({ ...VALID_STAY, roomTypes: VALID_STAY.roomTypes.join(',') });

      const response = await postIntent();

      expect(response.body.amount).to.equal(quote.body.totalPrice);
      expect(response.body.currency).to.equal(quote.body.currency);
    });

    // Regression: the amount was once read straight from the request body.
    it('ignores a price smuggled into the request', async () => {
      const response = await postIntent({
        amount: 0.01,
        totalPrice: 0.01,
        pricePaid: 0.01,
        stay: { ...VALID_STAY, totalPrice: 1, nightlyTotal: 1, subtotal: 1, taxes: 0 },
      });

      expect(response.body.amount).to.equal(EXPECTED_TOTAL);
    });

    it('charges the amount it echoed, not the one that was smuggled', async () => {
      const booking = await bookViaIntent({ amount: 0.01, pricePaid: 0.01 });

      expect(booking.pricePaid).to.equal(EXPECTED_TOTAL);
    });

    /** `simulated` tells the page whether to mount Stripe Elements or the demo form, and the demo form is what makes demoCard honoured at all. */
    it('decides the simulated flag itself, whatever the client asks for', async () => {
      for (const asked of [false, 'false', null, 0]) {
        const response = await postIntent({ simulated: asked });

        expect(response.body.simulated, JSON.stringify(asked)).to.equal(true);
      }
    });

    it('rejects invalid guest details before minting an intent', async () => {
      const response = await postIntent({ guestDetails: { firstName: 'Jane' } });

      expect(response.status).to.equal(422);
      expect(response.body.errors).to.have.property('lastName');
      expect(response.body.clientSecret).to.equal(undefined);
    });

    it('rejects a stay it cannot price', async () => {
      mockRoomPrices({ hotelId: 'marina-bay', rooms: [] });

      const response = await postIntent({
        stay: { ...VALID_STAY, roomTypes: ['invented-cheap-room'] },
      });

      expect(response.status).to.equal(400);
      expect(response.body.error).to.match(/not available/i);
    });

    it('rejects a userId that is not a UUID, while it is still free to do so', async () => {
      // user_id is a foreign key to profiles: a malformed one fails at insert
      // time, which is long after the card has been charged.
      const response = await postIntent({ userId: 'not-a-uuid' }, signIn());

      expect(response.status).to.equal(400);
      expect(response.body.error).to.match(/uuid/i);
    });

    it('names the oversized field when the stay will not fit in the metadata', async () => {
      // Stripe caps a metadata value at 500 characters and rejects the whole
      // request if one is over, which would surface as an opaque 502 at the last
      // step of the funnel.
      const response = await postIntent({
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

    /** Both payment endpoints share preparePayment, so the two must refuse the same bodies for the same reasons. */
    it('refuses exactly what POST /payment refuses', async () => {
      // The unknown-room case below is put to the supplier by both endpoints.
      // Without this the two agree on 502 rather than on 400 — still equal, so
      // the test would pass while comparing the wrong pair of answers.
      mockRoomPrices({ hotelId: 'marina-bay', rooms: [], times: 4 });

      const bodies = [
        { guestDetails: { firstName: 'Jane' } },
        { stay: { ...VALID_STAY, roomTypes: ['invented-cheap-room'] } },
        { stay: { ...VALID_STAY, adults: 0 } },
        { userId: 'not-a-uuid' },
        { guestDetails: { ...VALID_GUEST, email: 'not-an-email' } },
      ];

      for (const body of bodies) {
        const intent = await postIntent(body);
        resetRateLimits();
        const hosted = await request(app)
          .post('/api/bookings/payment')
          .send({ guestDetails: VALID_GUEST, stay: VALID_STAY, billingAddress: VALID_BILLING, ...body });

        expect(intent.status, JSON.stringify(body)).to.equal(hosted.status);
      }
    });

    /** The client secret is safe in the browser — it authorises one payment and nothing else — but the intent id is the reconciliation handle, and nothing else about the booking has any business in this response. */
    /** The unconfigured case cannot be reached in-process: paymentService builds its Stripe client once at module scope from STRIPE_SECRET_KEY, and ../env.ts supplies one before any test runs. */
    it('answers 503 when neither credentials nor simulate mode are configured', async function () {
      this.timeout(60_000);

      const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
      const tsx = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));
      const controller = new URL('../controllers/bookingController.js', import.meta.url).href;

      const script = `
        (async () => {
          const { postPaymentIntent } = await import(${JSON.stringify(controller)});
          let status = 0;
          let body = null;
          const res = {
            status(code) { status = code; return this; },
            json(payload) { body = payload; return this; },
          };
          await postPaymentIntent({ body: {} }, res);
          console.log(JSON.stringify({ status, body }));
        })();
      `;

      // Empty strings rather than deletions: dotenv skips a key that is already
      // present, so this also blocks the developer's own .env from supplying one.
      const { stdout } = await promisify(execFile)(tsx, ['-e', script], {
        cwd: repoRoot,
        env: { ...process.env, STRIPE_SECRET_KEY: '', PAYMENTS_MODE: '' },
      });

      const lines = stdout.trim().split('\n');
      const reported = JSON.parse(lines[lines.length - 1] as string);

      expect(reported.status).to.equal(503);
      expect(reported.body.error).to.match(/not available/i);
      // Refused before anything was priced or a client secret was minted.
      expect(reported.body.clientSecret).to.equal(undefined);
    });

    it('leaks no booking or payee detail into the payment-intent response', async () => {
      const response = await postIntent({ userId: randomUUID() });

      const serialised = JSON.stringify(response.body);
      expect(serialised).to.not.contain('jane@example.com');
      expect(serialised).to.not.contain('sk_test');
      expect(response.body.metadata).to.equal(undefined);
    });
  });

  describe('POST /api/bookings/confirm — the intent path', () => {
    it('writes the booking once Stripe says the intent succeeded', async () => {
      const booking = await bookViaIntent();

      expect(booking.id).to.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(booking.paymentId).to.match(/^sim_pi_/);
      expect(booking.pricePaid).to.equal(EXPECTED_TOTAL);
      expect(booking.nights).to.equal(3);
      expect(booking.hotelName).to.equal('Marina Bay Sands');
      expect(booking.guest.email).to.equal('jane@example.com');
    });

    it('carries the guest and stay through the intent metadata', async () => {
      // The Elements flow never leaves our page, but the booking still cannot be
      // written before payment — so the metadata on the intent is still the only
      // record of what was asked for.
      const session = signIn();
      const booking = await bookViaIntent(
        {
          guestDetails: { ...VALID_GUEST, specialRequests: 'Late check-in, around 11pm.' },
          stay: { ...VALID_STAY, roomTypes: ['deluxe-king', 'standard-queen'], children: 2 },
        },
        {},
        session
      );

      expect(booking.roomTypes).to.deep.equal(['deluxe-king', 'standard-queen']);
      expect(booking.children).to.equal(2);
      expect(booking.specialRequests).to.equal('Late check-in, around 11pm.');
      expect(booking.userId).to.equal(session.userId);
    });

    it('requires one of the two payment identifiers', async () => {
      for (const body of [
        {},
        { paymentIntentId: '' },
        { paymentIntentId: '   ' },
        { paymentIntentId: null },
        { paymentIntentId: 42 },
        { paymentIntentId: ['sim_pi_x'] },
        { sessionId: '', paymentIntentId: '' },
        { demoCard: SIMULATED_CARD },
      ]) {
        const response = await postConfirm(body);

        expect(response.status, JSON.stringify(body)).to.equal(400);
        expect(response.body.error, JSON.stringify(body)).to.match(/sessionId or paymentIntentId/i);
      }
    });

    /** Regression, in the shape it would take on this path: the payment endpoint must not be optional. */
    it('cannot be made to write a booking from a forged intent id', async () => {
      const forged = `sim_pi_${randomUUID()}`;

      const response = await postConfirm({ paymentIntentId: forged });

      // The simulator never issued this intent, so it reports it unpaid — a
      // different fact from "no metadata", and answered as such.
      expect(response.status).to.equal(402);
      expect(response.body.booking).to.equal(undefined);
      expect(await findByPaymentId(forged)).to.equal(null);
    });

    it('cannot be made to write a booking from an id Stripe never issued', async () => {
      // Not simulator-shaped, so this reaches the real client — where the
      // suite-wide network block refuses it. No booking either way, and the
      // failure must not carry our credentials out with it.
      const response = await postConfirmExpectingRefusal({
        paymentIntentId: 'pi_totally_made_up',
      });

      expect(response.status).to.equal(502);
      expect(response.body.booking).to.equal(undefined);
      expect(JSON.stringify(response.body)).to.not.contain('sk_test');
      expect(await findByPaymentId('pi_totally_made_up')).to.equal(null);
    });

    /** A guest refreshing the payment page after confirming replays this, and Stripe's webhook races it besides. */
    it('is idempotent across repeated confirmations of one intent', async () => {
      const paymentIntentId = await startIntent();

      const responses = [
        await postConfirm({ paymentIntentId }),
        await postConfirm({ paymentIntentId }),
        await postConfirm({ paymentIntentId }),
      ];

      const ids = new Set<string>();
      for (const response of responses) {
        expect(response.status, JSON.stringify(response.body)).to.equal(200);
        ids.add(response.body.booking.id);
      }

      expect(ids.size).to.equal(1);
    });

    it('sends the confirmation email exactly once however often it is replayed', async () => {
      const paymentIntentId = await startIntent();

      const original = console.log;
      const lines: string[] = [];
      console.log = (...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      };
      try {
        resetRateLimits();
        await request(app).post('/api/bookings/confirm').send({ paymentIntentId });
        resetRateLimits();
        await request(app).post('/api/bookings/confirm').send({ paymentIntentId });
        resetRateLimits();
        await request(app).post('/api/bookings/confirm').send({ paymentIntentId });
      } finally {
        console.log = original;
      }

      const emails = lines.filter((line) => line.includes('Booking confirmation queued'));
      expect(emails).to.have.lengthOf(1);
    });

    it('resolves deterministically when a body carries both identifiers', async () => {
      // A client that kept a stale session id from an abandoned hosted checkout
      // must not be able to make the intent it actually paid ambiguous.
      resetRateLimits();
      const payment = await request(app)
        .post('/api/bookings/payment')
        .send({ guestDetails: VALID_GUEST, stay: VALID_STAY, billingAddress: VALID_BILLING });
      const sessionId = new URL(payment.body.redirectUrl).searchParams.get('session_id');
      const paymentIntentId = await startIntent();

      const response = await postConfirm({ sessionId, paymentIntentId });

      expect(response.status).to.equal(200);
      expect(response.body.booking.paymentId).to.equal(paymentIntentId);
    });
  });

  /** The two flows exist to give the customer a choice of payment page, not two versions of a booking. */
  describe('both payment paths converge on the same record', () => {
    it('produces the same booking shape whichever path wrote it', async () => {
      const viaSession = await bookViaSession();
      const viaIntent = await bookViaIntent();

      expect(Object.keys(viaIntent).sort()).to.deep.equal(Object.keys(viaSession).sort());

      // Everything but the identifiers and the clock must be identical: same
      // guest, same stay, same price, same card columns.
      for (const key of Object.keys(viaSession)) {
        if (key === 'id' || key === 'paymentId' || key === 'createdAt') continue;
        expect(viaIntent[key], key).to.deep.equal(viaSession[key]);
      }
    });

    it('prices both paths from the same server-side quote', async () => {
      const viaSession = await bookViaSession({ stay: { ...VALID_STAY, adults: 1 } });
      const viaIntent = await bookViaIntent({ stay: { ...VALID_STAY, adults: 1 } });

      expect(viaIntent.pricePaid).to.equal(viaSession.pricePaid);
      expect(viaIntent.pricePaid).to.equal(EXPECTED_TOTAL);
    });

    it('keys both paths by the payment intent id, so one charge is one booking', async () => {
      const viaSession = await bookViaSession();
      const viaIntent = await bookViaIntent();

      expect(await findByPaymentId(viaSession.paymentId)).to.have.property('id', viaSession.id);
      expect(await findByPaymentId(viaIntent.paymentId)).to.have.property('id', viaIntent.id);
    });
  });

  /** The demo card, which is the one place an untrusted body reaches the card columns at all. */
  describe('demoCard while simulating', () => {
    it('honours a well-formed demo card so the booking shows what was typed', async () => {
      const booking = await bookViaIntent(
        {},
        { demoCard: { brand: 'mastercard', last4: '4444', expMonth: 7, expYear: 2029 } }
      );

      expect(booking.card).to.deep.equal({
        brand: 'mastercard',
        last4: '4444',
        expMonth: 7,
        expYear: 2029,
      });

      // And it is what was stored, not just what was echoed.
      const fetched = await request(app).get(`/api/bookings/${booking.id}`);
      expect(fetched.body.card.last4).to.equal('4444');
    });

    it('falls back to the simulator card when none is sent', async () => {
      const booking = await bookViaIntent();

      expect(booking.card).to.deep.equal(SIMULATED_CARD);
    });

    it('truncates an over-long brand rather than refusing the booking', async () => {
      // card_brand is a bounded column and the money is already taken by this
      // point; there is no outcome where refusing the insert is the better one.
      const booking = await bookViaIntent(
        {},
        { demoCard: { brand: 'b'.repeat(200), last4: '4242', expMonth: 12, expYear: 2030 } }
      );

      expect(booking.card.brand).to.have.length(20);
    });

    /** Each of these is a value that would otherwise land in a NOT NULL column: an empty brand, a two-character last4 in a character(4), a month of 13. */
    const malformed: Array<{ label: string; demoCard: unknown }> = [
      {
        label: 'a last4 that is not four digits',
        demoCard: { brand: 'visa', last4: '42', expMonth: 12, expYear: 2030 },
      },
      {
        label: 'a last4 carrying non-digits',
        demoCard: { brand: 'visa', last4: '4a2b', expMonth: 12, expYear: 2030 },
      },
      {
        label: 'a last4 sent as a number',
        demoCard: { brand: 'visa', last4: 4242, expMonth: 12, expYear: 2030 },
      },
      {
        label: 'a thirteenth month',
        demoCard: { brand: 'visa', last4: '4242', expMonth: 13, expYear: 2030 },
      },
      {
        label: 'a zeroth month',
        demoCard: { brand: 'visa', last4: '4242', expMonth: 0, expYear: 2030 },
      },
      {
        label: 'a fractional month',
        demoCard: { brand: 'visa', last4: '4242', expMonth: 6.5, expYear: 2030 },
      },
      {
        label: 'a year no card could carry',
        demoCard: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 1999 },
      },
      {
        label: 'a missing brand',
        demoCard: { last4: '4242', expMonth: 12, expYear: 2030 },
      },
      {
        label: 'a blank brand',
        demoCard: { brand: '   ', last4: '4242', expMonth: 12, expYear: 2030 },
      },
      { label: 'a string instead of an object', demoCard: 'visa 4242 12/30' },
      { label: 'a number instead of an object', demoCard: 42 },
      { label: 'null', demoCard: null },
      { label: 'an array', demoCard: ['visa', '4242', 12, 2030] },
      { label: 'an empty object', demoCard: {} },
    ];

    for (const { label, demoCard } of malformed) {
      it(`falls back to the simulator card for ${label}`, async () => {
        const booking = await bookViaIntent({}, { demoCard });

        expect(booking.card).to.deep.equal(SIMULATED_CARD);
      });
    }

    /** The demo form computes last4 in the browser precisely so the number itself never travels, and readDemoCard has no field that would accept one. */
    it('has no path by which a card number could reach storage', async () => {
      const booking = await bookViaIntent(
        {},
        {
          demoCard: {
            brand: 'visa',
            last4: '4242',
            expMonth: 12,
            expYear: 2030,
            number: '4242424242424242',
            pan: '4111111111111111',
            cardNumber: '5555555555554444',
            cvc: '123',
          },
        }
      );

      expect(Object.keys(booking.card).sort()).to.deep.equal([
        'brand',
        'expMonth',
        'expYear',
        'last4',
      ]);

      const fetched = await request(app).get(`/api/bookings/${booking.id}`);
      const serialised = JSON.stringify(fetched.body);

      // Card numbers are 13-19 digits. Nothing legitimate in a booking is a
      // digit run that long — the ids are UUIDs and the price is a decimal.
      expect(serialised).to.not.match(/\d{13,19}/);
      expect(serialised).to.not.match(/cardNumber|cvc|securityCode|\bpan\b/i);
      expect(serialised).to.not.contain('4111');
      expect(serialised).to.not.contain('5554444');
    });

    it('will not let a demo card override a payment that did not clear', async () => {
      // demoCard is honoured only when the payment is paid. Without that guard
      // an unpaid intent plus a plausible card is a booking for nothing.
      const response = await postConfirm({
        paymentIntentId: `sim_pi_${randomUUID()}`,
        demoCard: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
      });

      expect(response.status).to.equal(402);
      expect(response.body.booking).to.equal(undefined);
    });
  });

  /** With real credentials the card comes from Stripe and demoCard has to be discarded outright — otherwise a genuine charge can be labelled with a card the payer never used, in the columns a dispute would be argued from. */
  describe('with real Stripe credentials', () => {
    useStripeNock();

    const liveIntentId = (): string => `pi_live_${randomUUID().replace(/-/g, '')}`;

    it('discards demoCard entirely and records the card Stripe reports', async () => {
      const id = liveIntentId();

      nock(STRIPE_API)
        .get(`/v1/payment_intents/${id}`)
        .query(true)
        .reply(
          200,
          retrievedPaymentIntent({
            id,
            amount: EXPECTED_MINOR,
            metadata: METADATA,
            paymentMethod: cardPaymentMethod({
              brand: 'amex',
              last4: '0005',
              expMonth: 3,
              expYear: 2031,
            }),
          })
        );

      const response = await withLiveStripe(() =>
        postConfirm({
          paymentIntentId: id,
          demoCard: { brand: 'mastercard', last4: '4444', expMonth: 7, expYear: 2029 },
        })
      );

      expect(response.status, JSON.stringify(response.body)).to.equal(200);
      expect(response.body.booking.card).to.deep.equal({
        brand: 'amex',
        last4: '0005',
        expMonth: 3,
        expYear: 2031,
      });
    });

    it('reports the simulated flag as false, whatever the client asked for', async () => {
      const id = liveIntentId();

      nock(STRIPE_API)
        .post('/v1/payment_intents')
        .reply(200, retrievedPaymentIntent({ id, clientSecret: `${id}_secret_live` }));

      const response = await withLiveStripe(() => postIntent({ simulated: true }));

      expect(response.status, JSON.stringify(response.body)).to.equal(200);
      expect(response.body.simulated).to.equal(false);
      expect(response.body.clientSecret).to.equal(`${id}_secret_live`);
      // Still the server's own quote, never the figure that was asked for.
      expect(response.body.amount).to.equal(EXPECTED_TOTAL);
    });

    it('applies the amount cross-check to the intent path too', async () => {
      // The re-price is the last line of defence on price integrity, and it has
      // to run whichever payment page the customer used.
      const id = liveIntentId();

      nock(STRIPE_API)
        .get(`/v1/payment_intents/${id}`)
        .query(true)
        .reply(200, retrievedPaymentIntent({ id, amount: 100, metadata: METADATA }));

      const response = await withLiveStripe(() =>
        postConfirmExpectingRefusal({ paymentIntentId: id })
      );

      expect(response.status).to.equal(409);
      expect(response.body.error).to.match(/amount did not match/i);
      expect(await findByPaymentId(id)).to.equal(null);
    });

    it('applies the currency check to the intent path too', async () => {
      const id = liveIntentId();

      nock(STRIPE_API)
        .get(`/v1/payment_intents/${id}`)
        .query(true)
        .reply(
          200,
          retrievedPaymentIntent({
            id,
            amount: EXPECTED_MINOR,
            currency: 'usd',
            metadata: METADATA,
          })
        );

      const response = await withLiveStripe(() =>
        postConfirmExpectingRefusal({ paymentIntentId: id })
      );

      expect(response.status).to.equal(409);
      expect(response.body.error).to.match(/currency did not match/i);
    });

    it('refuses an intent whose metadata cannot be repriced into a booking', async () => {
      const id = liveIntentId();

      nock(STRIPE_API)
        .get(`/v1/payment_intents/${id}`)
        .query(true)
        .reply(200, retrievedPaymentIntent({ id, amount: EXPECTED_MINOR, metadata: {} }));

      const response = await withLiveStripe(() =>
        postConfirmExpectingRefusal({ paymentIntentId: id })
      );

      expect(response.status).to.equal(422);
      expect(response.body.error).to.match(/missing its booking details/i);
      expect(await findByPaymentId(id)).to.equal(null);
    });

    it('records an unknown card rather than refusing a wallet payment', async () => {
      // The card columns are NOT NULL and a wallet reports no card. A captured
      // charge with no booking at all is strictly worse than a row saying so.
      const id = liveIntentId();

      nock(STRIPE_API)
        .get(`/v1/payment_intents/${id}`)
        .query(true)
        .reply(
          200,
          retrievedPaymentIntent({
            id,
            amount: EXPECTED_MINOR,
            metadata: METADATA,
            paymentMethod: null,
          })
        );

      const response = await withLiveStripe(() => postConfirm({ paymentIntentId: id }));

      expect(response.status, JSON.stringify(response.body)).to.equal(200);
      expect(response.body.booking.card).to.deep.equal({
        brand: 'unknown',
        last4: '0000',
        expMonth: 0,
        expYear: 0,
      });
    });

    it('writes nothing for an intent that has not succeeded', async () => {
      const id = liveIntentId();

      nock(STRIPE_API)
        .get(`/v1/payment_intents/${id}`)
        .query(true)
        .reply(
          200,
          retrievedPaymentIntent({
            id,
            status: 'requires_payment_method',
            amount: EXPECTED_MINOR,
            metadata: METADATA,
          })
        );

      const response = await withLiveStripe(() => postConfirm({ paymentIntentId: id }));

      expect(response.status).to.equal(402);
      expect(await findByPaymentId(id)).to.equal(null);
    });
  });

  describe('rate limiting', () => {
    it('throttles repeated payment-intent requests from one address', async () => {
      // Unthrottled, minting client secrets is a free card-testing surface.
      resetRateLimits();
      const statuses: number[] = [];

      for (let attempt = 0; attempt < 13; attempt += 1) {
        const response = await request(app)
          .post('/api/bookings/payment-intent')
          .send({ guestDetails: VALID_GUEST, stay: VALID_STAY, billingAddress: VALID_BILLING });
        statuses.push(response.status);
      }

      expect(statuses).to.include(429);
      expect(statuses.filter((status) => status === 200).length).to.be.at.most(10);
    });
  });

  /** Regression: the demo card must be gated on where the payment CAME FROM, not on whether the process happens to be in simulate mode. */
  describe('demoCard is gated on provenance, not on the process mode', () => {
    it('ignores demoCard on a genuine charge even while PAYMENTS_MODE=simulate', async () => {
      expect(process.env.PAYMENTS_MODE, 'the bug needs simulate mode active').to.equal('simulate');

      const id = `pi_genuine_${randomUUID()}`;
      const realCard = cardPaymentMethod({
        brand: 'amex',
        last4: '0005',
        expMonth: 3,
        expYear: 2031,
      });

      nock(STRIPE_API)
        .get(`/v1/payment_intents/${id}`)
        .query(true)
        .reply(200, retrievedPaymentIntent({ id, metadata: METADATA, paymentMethod: realCard }));

      resetRateLimits();
      const response = await postConfirm({
        paymentIntentId: id,
        demoCard: { brand: 'mastercard', last4: '4444', expMonth: 7, expYear: 2029 },
      });

      expect(response.status, JSON.stringify(response.body)).to.equal(200);

      // What Stripe reported, not what the request body claimed.
      const stored = await findByPaymentId(id);
      expect(stored?.card).to.deep.equal({
        brand: 'amex',
        last4: '0005',
        expMonth: 3,
        expYear: 2031,
      });
      expect(stored?.card.brand).to.not.equal('mastercard');
    });

    it('still honours demoCard on a payment the simulator actually issued', async () => {
      // The allowance itself must survive the fix, or the demo form stops working.
      const booking = await bookViaIntent(
        {},
        { demoCard: { brand: 'mastercard', last4: '4444', expMonth: 7, expYear: 2029 } }
      );

      expect(booking.card).to.deep.equal({
        brand: 'mastercard',
        last4: '4444',
        expMonth: 7,
        expYear: 2029,
      });
    });
  });

  /** The billing address has to travel out to Stripe with the intent. */
  describe('billing address round trip', () => {
    /** The Stripe object is the only place the address is recorded anywhere — our own table stores none of it — so "it reaches Stripe" stops being a nicety and becomes the whole of its persistence. */
    it('puts the address on the intent it sends to Stripe', async () => {
      useStripeNock();

      let sent: Record<string, string> = {};

      nock(STRIPE_API)
        .post('/v1/payment_intents', (body) => {
          sent = Object.fromEntries(new URLSearchParams(body as string));
          return true;
        })
        .reply(200, retrievedPaymentIntent({ metadata: METADATA }));

      const response = await withLiveStripe(() => postIntent());

      expect(response.status, JSON.stringify(response.body)).to.equal(200);
      expect(sent['shipping[address][line1]']).to.equal(VALID_BILLING.line1);
      expect(sent['shipping[address][city]']).to.equal(VALID_BILLING.city);
      expect(sent['shipping[address][postal_code]']).to.equal(VALID_BILLING.postalCode);
      expect(sent['shipping[address][country]']).to.equal(VALID_BILLING.country);
      expect(sent['shipping[name]']).to.equal('Jane Tan');
    });

    /** /payment mints an intent on mount, and a refresh or a second trip through checkout is a fresh mount. */
    it('sends the same idempotency key when the same stay is re-submitted', async () => {
      useStripeNock();

      const keys: string[] = [];
      const intercept = () =>
        nock(STRIPE_API)
          .post('/v1/payment_intents')
          .reply(function () {
            keys.push(String(this.req.headers['idempotency-key']));
            return [200, retrievedPaymentIntent({ metadata: METADATA })];
          });

      intercept();
      intercept();

      await withLiveStripe(async () => {
        await postIntent();
        await postIntent();
      });

      expect(keys).to.have.lengthOf(2);
      expect(keys[0]).to.be.a('string').and.not.equal('undefined');
      expect(keys[0], 'a re-submitted stay must reuse its key').to.equal(keys[1]);
    });

    /** The other half. */
    it('changes the key when the stay prices differently', async () => {
      useStripeNock();

      const keys: string[] = [];
      const intercept = () =>
        nock(STRIPE_API)
          .post('/v1/payment_intents')
          .reply(function () {
            keys.push(String(this.req.headers['idempotency-key']));
            return [200, retrievedPaymentIntent({ metadata: METADATA })];
          });

      intercept();
      intercept();

      await withLiveStripe(async () => {
        await postIntent();
        // One more night is a different total, so a different attempt.
        await postIntent({ stay: { ...VALID_STAY, endDate: '2026-08-05' } });
      });

      expect(keys).to.have.lengthOf(2);
      expect(keys[0]).to.not.equal(keys[1]);
    });

    it('gives two guests booking the same room their own keys', async () => {
      useStripeNock();

      const keys: string[] = [];
      const intercept = () =>
        nock(STRIPE_API)
          .post('/v1/payment_intents')
          .reply(function () {
            keys.push(String(this.req.headers['idempotency-key']));
            return [200, retrievedPaymentIntent({ metadata: METADATA })];
          });

      intercept();
      intercept();

      await withLiveStripe(async () => {
        await postIntent();
        await postIntent({ guestDetails: { ...VALID_GUEST, email: 'someone.else@example.com' } });
      });

      expect(keys[0]).to.not.equal(keys[1]);
    });

    it('refuses the payment when the address is missing, before any charge', async () => {
      resetRateLimits();
      const response = await request(app)
        .post('/api/bookings/payment-intent')
        .send({ guestDetails: VALID_GUEST, stay: VALID_STAY });

      expect(response.status).to.equal(422);
      // Namespaced separately so the client can mark up the two forms without
      // guessing which section a bare `city` key belongs to.
      expect(response.body.billingErrors).to.have.keys(
        'line1',
        'city',
        'postalCode',
        'country'
      );
      expect(response.body.errors).to.equal(undefined);
    });

    it('reports guest and billing problems together', async () => {
      resetRateLimits();
      const response = await request(app)
        .post('/api/bookings/payment-intent')
        .send({
          guestDetails: { ...VALID_GUEST, email: 'nope' },
          billingAddress: { ...VALID_BILLING, country: 'Singapore' },
          stay: VALID_STAY,
        });

      expect(response.status).to.equal(422);
      expect(response.body.errors).to.have.property('email');
      expect(response.body.billingErrors).to.have.property('country');
    });

    it('applies the same rule to the hosted-checkout endpoint', async () => {
      // Both endpoints share preparePayment, and this is what pins that: a
      // divergence would let one path bank an address the other rejects.
      resetRateLimits();
      const response = await request(app)
        .post('/api/bookings/payment')
        .send({ guestDetails: VALID_GUEST, stay: VALID_STAY });

      expect(response.status).to.equal(422);
      expect(response.body.billingErrors).to.have.property('line1');
    });
  });
});
