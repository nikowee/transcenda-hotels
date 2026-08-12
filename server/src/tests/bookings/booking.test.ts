/**
 * Feature 4 (Booking data) — coverage index.
 *
 * This file began as a scaffold of `it.skip` placeholders written when UC4 had
 * no backend tests. It has them now, so the placeholders are replaced by a map
 * to the suites that actually assert each case. Skipped stubs cost nothing to
 * keep and read, to anyone running `npm test`, as unfinished security work.
 *
 *   400 on missing guest information
 *     → booking.test.ts  "returns field errors for missing details (alternative flow 1a)"
 *
 *   Creates a booking and returns a reference on valid input
 *     → booking.test.ts        "is idempotent across repeated confirmations"
 *     → recordPaidBooking.test.ts  writes the row and returns its id
 *
 *   Card number masked in stored and returned data
 *     → booking.test.ts  "returns the booking and never exposes card data beyond the last four"
 *     → stripePayments.test.ts  "reads the card brand, last four and expiry off the expanded payment method"
 *
 *   Raw CVV and full PAN never persisted
 *     → PaymentPage.test.tsx (client)  "never renders a card input"
 *     → booking-flow.spec.ts (e2e)  asserts no PAN, in any spelling, in anything the browser sent
 *
 *   Invalid or expired card rejected by the processor
 *     → paymentIntent.test.ts  "surfaces a declined card as a safe message with no Stripe wording"
 *     → booking-flow.spec.ts (e2e)  "A declined card says so, books nothing and goes nowhere"
 *
 *   GET /api/bookings/:id returns the confirmation details
 *     → booking.test.ts  "returns the booking and never exposes card data beyond the last four"
 *
 * GDPR account deletion was the one case with no coverage anywhere. It now has
 * its own suite: see `deleteAccount.test.ts`.
 */

export {};
