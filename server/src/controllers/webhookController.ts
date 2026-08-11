import { type Request, type Response } from 'express';
import {
  constructWebhookEvent,
  verifySession,
  verifyPaymentIntent,
} from '../services/paymentService.js';
import { findByPaymentId } from '../models/bookingModel.js';
import { recordPaidBooking } from './bookingController.js';

/** Stripe webhook — the «External API» callback into the «Express Router», and the only thing standing between a captured charge and a missing booking: when the customer closes the tab on Stripe's success page, or a 3DS challenge completes hours later, the browser never calls /confirm, and this handler creates the row instead. */
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
      /** The recovery path. */
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;

        if (session.payment_status !== 'paid') break;

        const paymentIntentId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);

        if (paymentIntentId && (await findByPaymentId(paymentIntentId))) break;

        // The event payload is unexpanded, so it carries no payment_method and
        // therefore none of the NOT NULL card columns. Re-reading the session is
        // what fetches them.
        const payment = await verifySession(session.id);
        const outcome = await recordPaidBooking(payment);

        if (!outcome.ok) {
          const detail = `session ${session.id} (${outcome.status}): ${outcome.error}`;

          // A transient fault — storage down, Stripe unreachable — is worth
          // another delivery, and throwing is how this handler asks for one.
          if (outcome.status >= 500) {
            throw new Error(`Recovery insert failed for ${detail}`);
          }

          // A rejected amount or unusable metadata will be rejected identically
          // on every redelivery, so retrying only buries the charge in noise.
          // Acknowledge and escalate: the customer has paid and has no booking.
          console.error(
            `⚠️  PAID CHARGE WITH NO BOOKING — manual intervention required: ${detail}`
          );
          break;
        }

        console.log(`Webhook recovered booking ${outcome.booking.id} for session ${session.id}`);
        break;
      }

      /** The recovery path for the Elements flow, which is the one the client actually uses. */
      case 'payment_intent.succeeded': {
        const intent = event.data.object;

        if (await findByPaymentId(intent.id)) break;

        // The event payload is unexpanded, so it carries no payment_method and
        // therefore none of the NOT NULL card columns.
        const payment = await verifyPaymentIntent(intent.id);
        const outcome = await recordPaidBooking(payment);

        if (!outcome.ok) {
          const detail = `intent ${intent.id} (${outcome.status}): ${outcome.error}`;

          if (outcome.status >= 500) {
            throw new Error(`Recovery insert failed for ${detail}`);
          }

          console.error(
            `⚠️  PAID CHARGE WITH NO BOOKING — manual intervention required: ${detail}`
          );
          break;
        }

        console.log(`Webhook recovered booking ${outcome.booking.id} for intent ${intent.id}`);
        break;
      }

      /** Nothing to do. */
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object;
        console.log(`Checkout ${session.id} ended without payment (${event.type}).`);
        break;
      }

      /** The Elements flow's equivalent of the two above, and equally inert. */
      case 'payment_intent.payment_failed': {
        const intent = event.data.object;
        console.log(`Payment intent ${intent.id} did not clear (${event.type}).`);
        break;
      }

      /** RECONCILIATION GAP. */
      case 'charge.refunded': {
        const charge = event.data.object;

        const paymentIntentId =
          typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : (charge.payment_intent?.id ?? null);

        const booking = paymentIntentId ? await findByPaymentId(paymentIntentId) : null;

        console.warn(
          [
            '⚠️  REFUND NOT RECORDED — no column exists for it.',
            `   booking:        ${booking?.id ?? 'not found'}`,
            `   payment intent: ${paymentIntentId ?? 'unknown'}`,
            `   refunded:       ${charge.amount_refunded} of ${charge.amount} ${charge.currency}`,
            `   full refund:    ${charge.refunded}`,
            '   The booking row still reads as paid. Reconcile against Stripe.',
          ].join('\n')
        );
        break;
      }

      default:
        // Unhandled event types are acknowledged so Stripe stops retrying them.
        break;
    }

    res.json({ received: true });
  } catch (error) {
    // 500 tells Stripe to retry, which is what we want: insertOne dedupes on
    // payment_id, so a redelivery either writes the missing row or no-ops.
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
};
