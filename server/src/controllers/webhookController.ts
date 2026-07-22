import { type Request, type Response } from 'express';
import { constructWebhookEvent } from '../services/paymentService.js';
import { findOne, markPaid, markFailed } from '../models/bookingModel.js';
import { sendConfirmation } from '../services/emailService.js';

/**
 * Stripe webhook — the authoritative source of payment state.
 *
 * The browser returning from Stripe is a convenience, not proof: it can be
 * closed mid-redirect, and 3DS/SCA challenges complete asynchronously. This
 * handler is what guarantees a completed payment eventually reaches the booking.
 *
 * Must be mounted with express.raw() BEFORE the global express.json(), because
 * signature verification needs the unparsed body.
 */
export const handleStripeWebhook = async (req: Request, res: Response): Promise<void> => {
  const signature = req.headers['stripe-signature'];

  if (typeof signature !== 'string') {
    res.status(400).json({ error: 'Missing Stripe-Signature header.' });
    return;
  }

  let event;
  try {
    event = constructWebhookEvent(req.body as Buffer, signature);
  } catch (error) {
    // A missing secret is our fault, not the caller's. 503 keeps Stripe
    // retrying so the event survives until the config is fixed; a 400 here
    // would tell Stripe to discard it permanently.
    if (error instanceof Error && error.message === 'WEBHOOK_NOT_CONFIGURED') {
      console.error('Webhook received but STRIPE_WEBHOOK_SECRET is not configured.');
      res.status(503).json({ error: 'Webhook processing is not configured.' });
      return;
    }

    // Anything else means the payload was not signed by Stripe. Never process it,
    // and never retry it.
    console.error('Webhook signature verification failed.');
    res.status(400).json({ error: 'Invalid signature.' });
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        const reference = session.client_reference_id;

        if (!reference) break;
        if (session.payment_status !== 'paid') break;

        const booking = await findOne({ bookingReference: reference });
        if (!booking) {
          console.error(`Webhook for unknown booking ${reference}`);
          break;
        }

        // Guard against a session whose charged total drifted from our price.
        if (session.amount_total !== null) {
          const expected = Math.round(booking.totalPrice * 100);
          if (session.amount_total !== expected) {
            console.error(
              `Webhook amount mismatch on ${reference}: ${session.amount_total} vs ${expected}`
            );
            break;
          }
        }

        const paymentIntentId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : (session.payment_intent?.id ?? 'unknown');

        const updated = await markPaid(reference, paymentIntentId);

        // Null means the return-from-Stripe call already handled it.
        if (updated) {
          await sendConfirmation(updated.guestEmail, updated);
        }
        break;
      }

      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object;
        if (session.client_reference_id) {
          await markFailed(session.client_reference_id);
        }
        break;
      }

      default:
        // Unhandled event types are acknowledged so Stripe stops retrying them.
        break;
    }

    res.json({ received: true });
  } catch (error) {
    // 500 tells Stripe to retry; markPaid is idempotent so retries are safe.
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
};
