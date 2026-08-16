import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { randomUUID } from 'crypto';
import request from 'supertest';
import nock from 'nock';
import { app } from './setup.js';
import { signIn } from './helpers/authNock.js';
import { resetRateLimits } from '../middleware/rateLimit.js';
import { insertOne, findById, __clearMemoryStore } from '../models/bookingModel.js';
import type { BookingInput } from '../models/bookingTypes.js';

/**
 * Account deletion, the erasure half.
 *
 * Deleting the auth user removes the account and nothing else. Every booking
 * that user made still carries their name, email, phone and free-text
 * requests, reachable by guest_email long after the account is gone — so the
 * handler erases those first.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://placeholder.supabase.co';

const expectAdminDelete = (userId: string) =>
  nock(SUPABASE_URL).delete(`/auth/v1/admin/users/${userId}`).reply(200, {});

const bookingFor = (userId: string): BookingInput => ({
  userId,
  guest: {
    salutation: 'Ms',
    firstName: 'Jane',
    lastName: 'Tan',
    email: 'jane@example.com',
    phone: '+65 9123 4567',
    specialRequests: 'High floor.',
  },
  billing: null,
  stay: {
    destinationId: 'RsBU',
    hotelId: 'diH7',
    hotelName: 'The Fullerton Hotel Singapore',
    roomTypes: ['deluxe-king'],
    startDate: '2026-10-01',
    endDate: '2026-10-04',
    adults: 2,
    children: 0,
  },
  nights: 3,
  pricePaid: 784.8,
  paymentId: `pi_erase_${randomUUID()}`,
  payeeId: 'cus_test_erasure',
  card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
});

describe('DELETE /api/users/:uid — personal data erasure', () => {
  beforeEach(() => {
    resetRateLimits();
    __clearMemoryStore();
    nock.cleanAll();
  });

  it('erases the personal data on the caller’s bookings', async () => {
    const session = signIn();
    const booking = await insertOne(bookingFor(session.userId));
    expectAdminDelete(session.userId);

    const response = await request(app).delete(`/api/users/${session.userId}`).set(session.header);

    expect(response.status).to.equal(200);
    expect(response.body.bookingsAnonymised).to.equal(1);

    const after = await findById(booking.id);
    expect(after, 'the booking row is an accounting record and stays').to.not.equal(null);
    expect(after!.guest.firstName).to.not.equal('Jane');
    expect(after!.guest.lastName).to.not.equal('Tan');
    expect(after!.guest.email).to.not.equal('jane@example.com');
    expect(after!.guest.phone).to.not.equal('+65 9123 4567');
    expect(after!.specialRequests).to.equal(null);
    // Unlinked, so nothing traces the row back to the deleted account.
    expect(after!.userId).to.equal(null);
  });

  it('keeps the booking auditable — the money still reconciles', async () => {
    const session = signIn();
    const input = bookingFor(session.userId);
    const booking = await insertOne(input);
    expectAdminDelete(session.userId);

    const response = await request(app).delete(`/api/users/${session.userId}`).set(session.header);
    expect(response.status).to.equal(200);

    const after = await findById(booking.id);
    // Erasure must have run, otherwise "preserved" proves nothing.
    expect(after!.userId).to.equal(null);
    expect(after!.pricePaid).to.equal(784.8);
    expect(after!.paymentId).to.equal(input.paymentId);
    expect(after!.hotelName).to.equal('The Fullerton Hotel Singapore');
    expect(after!.startDate).to.equal('2026-10-01');
  });

  it('touches only the caller’s bookings', async () => {
    const session = signIn();
    const mine = await insertOne(bookingFor(session.userId));
    const theirs = await insertOne(bookingFor(randomUUID()));
    expectAdminDelete(session.userId);

    await request(app).delete(`/api/users/${session.userId}`).set(session.header);

    expect((await findById(mine.id))!.guest.email).to.not.equal('jane@example.com');
    expect((await findById(theirs.id))!.guest.email).to.equal('jane@example.com');
  });

  it('succeeds for a user who never booked', async () => {
    const session = signIn();
    expectAdminDelete(session.userId);

    const response = await request(app).delete(`/api/users/${session.userId}`).set(session.header);

    expect(response.status).to.equal(200);
    expect(response.body.bookingsAnonymised).to.equal(0);
  });
});

/**
 * The deployed path. Everything above runs the in-memory branch, so the
 * PostgREST UPDATE and the explicit profiles delete are otherwise unexercised.
 */
describe('DELETE /api/users/:uid — erasure against Supabase', () => {
  let previousStorage: string | undefined;

  // Only BOOKINGS_STORAGE: supabaseClient reads SUPABASE_URL at first import,
  // so changing that here would point later suites' interceptors at another host.
  before(() => {
    previousStorage = process.env.BOOKINGS_STORAGE;
    process.env.BOOKINGS_STORAGE = 'supabase';
  });

  after(() => {
    if (previousStorage === undefined) delete process.env.BOOKINGS_STORAGE;
    else process.env.BOOKINGS_STORAGE = previousStorage;
  });

  beforeEach(() => {
    resetRateLimits();
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('anonymises the bookings, drops the profile, then deletes the auth user', async () => {
    const session = signIn();
    const order: string[] = [];

    // The body is matched whole: billing_* must never appear, since a column the
    // deployed table lacks fails the entire UPDATE.
    const bookings = nock(SUPABASE_URL)
      .patch('/rest/v1/bookings', {
        user_id: null,
        payee_id: '[deleted]',
        special_requests: null,
        guest_salutation: '[deleted]',
        guest_first_name: '[deleted]',
        guest_last_name: '[deleted]',
        guest_email: '[deleted]',
        guest_phone: '[deleted]',
      })
      // select=id is in the URL because the count comes from the returned rows.
      .query({ user_id: `eq.${session.userId}`, select: 'id' })
      .reply(200, () => {
        order.push('bookings');
        return [{ id: randomUUID() }, { id: randomUUID() }];
      });

    const profiles = nock(SUPABASE_URL)
      .delete('/rest/v1/profiles')
      .query({ id: `eq.${session.userId}` })
      .reply(204, () => {
        order.push('profiles');
        return '';
      });

    const authUser = nock(SUPABASE_URL)
      .delete(`/auth/v1/admin/users/${session.userId}`)
      .reply(200, () => {
        order.push('authUser');
        return {};
      });

    const response = await request(app).delete(`/api/users/${session.userId}`).set(session.header);

    expect(response.status).to.equal(200);
    // Counted from the UPDATE's own reply, not from anything the caller sent.
    expect(response.body.bookingsAnonymised).to.equal(2);
    expect(bookings.isDone(), 'the UPDATE must be issued').to.equal(true);
    expect(profiles.isDone(), 'the profiles row is deleted, not left to a cascade').to.equal(true);
    expect(authUser.isDone(), 'the admin delete must still run').to.equal(true);
    // bookings.user_id cascades from profiles: deleting the row first would take
    // the accounting records with it.
    expect(order).to.deep.equal(['bookings', 'profiles', 'authUser']);
  });
});
