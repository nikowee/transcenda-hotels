import './env.js';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { randomUUID } from 'crypto';
import {
  insertOne,
  findById,
  findByPaymentId,
  findByUserId,
  isSupabaseConfigured,
  __clearMemoryStore,
} from '../models/bookingModel.js';
import type { BookingInput } from '../models/bookingTypes.js';

/** The storage layer, tested directly. */

const guest = {
  salutation: 'Ms',
  firstName: 'Jane',
  lastName: 'Tan',
  email: 'jane@example.com',
  phone: '+65 9123 4567',
  specialRequests: 'High floor, away from the lift.',
};

const stay = {
  destinationId: 'RsBU',
  hotelId: 'marina-bay',
  hotelName: 'Marina Bay Sands',
  roomTypes: ['deluxe-king'],
  startDate: '2026-08-01',
  endDate: '2026-08-04',
  adults: 2,
  children: 1,
};

/** Payment ids are derived from a per-call UUID rather than a shared constant. */
const bookingInput = (overrides: Partial<BookingInput> = {}): BookingInput => ({
  userId: null,
  guest,
  billing: null,
  stay,
  nights: 3,
  pricePaid: 784.8,
  paymentId: `pi_model_${randomUUID()}`,
  payeeId: 'cus_test_model',
  card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
  ...overrides,
});

describe('bookingModel', () => {
  describe('insertOne', () => {
    it('returns the written row with a generated UUID handle', async () => {
      const input = bookingInput();

      const record = await insertOne(input);

      // The UUID is the customer's only handle now that booking_reference is
      // gone, so it has to come back from the write itself.
      expect(record.id).to.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(record.paymentId).to.equal(input.paymentId);
      expect(record.pricePaid).to.equal(784.8);
      expect(record.createdAt).to.be.a('string');
    });

    it('round-trips the split guest, occupancy and stay columns', async () => {
      const record = await insertOne(bookingInput());

      expect(record.guest.salutation).to.equal('Ms');
      expect(record.guest.firstName).to.equal('Jane');
      expect(record.guest.lastName).to.equal('Tan');
      expect(record.guest.email).to.equal('jane@example.com');
      expect(record.guest.phone).to.equal('+65 9123 4567');
      expect(record.specialRequests).to.equal('High floor, away from the lift.');
      expect(record.adults).to.equal(2);
      expect(record.children).to.equal(1);
      expect(record.startDate).to.equal('2026-08-01');
      expect(record.endDate).to.equal('2026-08-04');
      expect(record.nights).to.equal(3);
    });

    it('rebuilds roomTypes as a list from the comma-joined column', async () => {
      // room_types is a single text column, so the split lives in the model and
      // a multi-room booking must survive the join and the split unchanged.
      const record = await insertOne(
        bookingInput({ stay: { ...stay, roomTypes: ['deluxe-king', 'standard-queen'] } })
      );

      expect(record.roomTypes).to.deep.equal(['deluxe-king', 'standard-queen']);
    });

    it('normalises card_last4 to the four characters the column holds', async () => {
      // card_last4 is character(4): Postgres blank-pads anything shorter, so a
      // short value has to be normalised on write or it reads back with spaces.
      const record = await insertOne(
        bookingInput({ card: { brand: 'amex', last4: '05', expMonth: 1, expYear: 2031 } })
      );

      expect(record.card.last4).to.equal('0005');
      expect(record.card.last4).to.have.length(4);
      expect(record.card.brand).to.equal('amex');
    });

    it('keeps a null specialRequests null rather than storing an empty string', async () => {
      const record = await insertOne(
        bookingInput({ guest: { ...guest, specialRequests: null } })
      );

      expect(record.specialRequests).to.equal(null);
      expect(record.guest.specialRequests).to.equal(null);
    });

    /** The single most important property in this file. */
    it('returns the existing booking instead of writing the same charge twice', async () => {
      const input = bookingInput();

      const first = await insertOne(input);
      const second = await insertOne(input);

      expect(second.id).to.equal(first.id);
    });

    /** The case the sequential test above cannot see, and the one that actually happened: 7 of 11 payments in the development database had between two and three rows, every set written 9–164ms apart. */
    it('writes one row when two callers confirm the same charge at once', async () => {
      const input = bookingInput();

      const [first, second] = await Promise.all([insertOne(input), insertOne(input)]);

      expect(second.id).to.equal(first.id);
      expect(await findByPaymentId(input.paymentId)).to.not.equal(null);
    });

    it('writes one row when the browser, the webhook and a redelivery all land together', async () => {
      const input = bookingInput();

      const written = await Promise.all([
        insertOne(input),
        insertOne(input),
        insertOne(input),
      ]);

      const ids = new Set(written.map((record) => record.id));
      expect([...ids]).to.have.lengthOf(1);
    });

    it('lets a payment be retried after a write fails', async () => {
      // The in-flight entry has to be cleared on rejection as well as on
      // success. If it were only cleared on success, one transient failure
      // would make that payment_id permanently unwritable — every later
      // attempt would await the same rejected promise and fail identically,
      // and the charge would never be recorded.
      const input = bookingInput();

      let rejected = false;
      try {
        await insertOne({ ...input, card: undefined as never });
      } catch {
        rejected = true;
      }
      expect(rejected).to.equal(true);

      const record = await insertOne(input);
      expect(record.paymentId).to.equal(input.paymentId);
    });

    it('ignores the second caller\'s data entirely on a duplicate payment id', async () => {
      const input = bookingInput();
      const first = await insertOne(input);

      // A redelivered webhook must not be able to rewrite a booking that was
      // already recorded — the row is the record of what was charged.
      const second = await insertOne({ ...input, pricePaid: 1, guest: { ...guest, lastName: 'Impostor' } });

      expect(second.id).to.equal(first.id);
      expect(second.pricePaid).to.equal(784.8);
      expect(second.guest.lastName).to.equal('Tan');
    });
  });

  describe('findById', () => {
    it('finds a booking by the UUID the write returned', async () => {
      const written = await insertOne(bookingInput());

      const found = await findById(written.id);

      expect(found?.id).to.equal(written.id);
      expect(found?.paymentId).to.equal(written.paymentId);
    });

    it('returns null for an id that was never written', async () => {
      expect(await findById(randomUUID())).to.equal(null);
    });
  });

  describe('findByPaymentId', () => {
    it('answers "have we already recorded this charge?"', async () => {
      const written = await insertOne(bookingInput());

      const found = await findByPaymentId(written.paymentId);

      expect(found?.id).to.equal(written.id);
    });

    it('returns null for a charge with no booking, which is what starts recovery', async () => {
      // The webhook reads a null here as "the browser never came back" and
      // inserts the row itself.
      expect(await findByPaymentId(`pi_model_${randomUUID()}`)).to.equal(null);
    });
  });

  describe('findByUserId', () => {
    it('returns only the bookings belonging to that user', async () => {
      const mine = randomUUID();
      const theirs = randomUUID();

      const first = await insertOne(bookingInput({ userId: mine }));
      const second = await insertOne(bookingInput({ userId: mine }));
      await insertOne(bookingInput({ userId: theirs }));

      const bookings = await findByUserId(mine);

      expect(bookings.map((booking) => booking.id).sort()).to.deep.equal(
        [first.id, second.id].sort()
      );
    });

    it('returns an empty list rather than null for a user with no bookings', async () => {
      // "My bookings" renders an empty state; a null would throw on .map.
      expect(await findByUserId(randomUUID())).to.deep.equal([]);
    });

    it('never returns a guest checkout, which has no user_id at all', async () => {
      const written = await insertOne(bookingInput({ userId: null }));

      const bookings = await findByUserId(randomUUID());

      expect(bookings.map((booking) => booking.id)).to.not.include(written.id);
    });
  });

  describe('isSupabaseConfigured', () => {
    it('reports the in-memory store while BOOKINGS_STORAGE=memory', () => {
      // Guards the switch the whole suite depends on: if this ever flips, the
      // tests start writing to a real database.
      expect(process.env.BOOKINGS_STORAGE).to.equal('memory');
      expect(isSupabaseConfigured()).to.equal(false);
    });

    it('treats BOOKINGS_STORAGE=memory as authoritative over credentials', () => {
      const previous = process.env.BOOKINGS_STORAGE;
      try {
        process.env.BOOKINGS_STORAGE = 'memory';
        process.env.SUPABASE_URL = 'https://real.supabase.co';
        process.env.SUPABASE_SECRET_KEY = 'real-key';

        // Checked before the credentials, which is why a developer with a valid
        // .env can still be writing to a store that vanishes on restart.
        expect(isSupabaseConfigured()).to.equal(false);
      } finally {
        process.env.BOOKINGS_STORAGE = previous;
      }
    });
  });

  describe('__clearMemoryStore', () => {
    it('drops every record, which is what keeps suites from resolving each other\'s bookings', async () => {
      const written = await insertOne(bookingInput());
      expect(await findById(written.id)).to.not.equal(null);

      __clearMemoryStore();

      expect(await findById(written.id)).to.equal(null);
      expect(await findByPaymentId(written.paymentId)).to.equal(null);
    });
  });
});