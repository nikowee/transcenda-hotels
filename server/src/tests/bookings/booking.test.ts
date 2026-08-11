import { describe, it } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { app } from '../setup.ts';

// ────────────────────────────────────────────────────────────────────
// TODO: Feature 4 (Booking data) currently has NO backend tests, and
// no route/service code for it was available when this scaffold was
// generated. Fill these in once POST /api/bookings (or equivalent)
// exists. Suggested cases, based on the case study's requirements:
// ────────────────────────────────────────────────────────────────────

describe('Booking API', () => {
  it.skip('should return 400 when required guest information is missing', async () => {
    // Currently returns 404 - there's no /api/bookings route in index.ts
    // yet. Un-skip this once that route exists.
    const response = await request(app).post('/api/bookings').send({
      // missing firstName, lastName, email, phone, payment info, etc.
    });

    expect(response.status).to.equal(400);
  });

  it.skip('should create a booking and return a booking reference on valid input', async () => {
    // TODO: mock the Stripe API call (nock('https://api.stripe.com') ...)
    // and assert the response includes a bookingReference, price,
    // destination_id, hotel_id, and stay details.
  });

  it.skip('should mask the card number in stored/returned booking data', async () => {
    // Per the spec: only the first 6 and last 4 digits of the card
    // number should ever be persisted or displayed.
    // e.g. expect(response.body.payeeInformation.cardNumber).to.match(/^\d{6}\*+\d{4}$/);
  });

  it.skip('should not persist raw CVV/CVC or full card number anywhere', async () => {
    // TODO: inspect whatever your booking is stored in (DB call, mock, etc.)
    // to assert the raw CVV/full PAN never reaches storage.
  });

  it.skip('should reject an invalid/expired card via the payment processor', async () => {
    // TODO: mock a Stripe decline response and assert the booking is
    // NOT created and a meaningful error is returned.
  });

  it.skip('GET /api/bookings/:id should return the confirmation details', async () => {
    // TODO: once a booking exists, fetching it should return the same
    // shape shown on the confirmation page (booking ref, stay dates,
    // guest info, last 4 digits of card).
  });
});

describe('GDPR - Delete Account API', () => {
  it.skip('should delete all PII (name, email, phone, birth date) for a user on request', async () => {
    // TODO: covers the "Delete Account" requirement in the non-functional
    // requirements section. Assert the user's PII fields are gone/anonymized
    // after calling the delete endpoint, while non-PII records (e.g.
    // aggregate booking counts) can remain if your design keeps them.
  });
});
