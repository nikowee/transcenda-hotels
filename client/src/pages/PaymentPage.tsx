import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import axios from 'axios';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { authHeader } from '../lib/authHeader';
import {
  AlertCircle,
  ArrowLeft,
  BedDouble,
  Calendar,
  CreditCard,
  Loader2,
  Lock,
  MapPin,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';
import type {
  BillingAddress,
  CheckoutQuote,
  GuestDetails,
  StayDetails,
} from '../types/booking';
import { formatMoney, formatNights, formatOccupancy, formatRooms } from '../lib/format';

const API_URL = import.meta.env.VITE_API_URL;
const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

/**
 * «React Page» PaymentPage — UC4 sequence step 4, "Submit Payment".
 *
 * The class diagram draws a payment page inside the application, and this is it.
 * What the diagram could not know is that implementing it literally — our own
 * inputs, posting a PAN to our own server — puts the Express host inside PCI
 * SAQ D. So the page is ours and the *inputs* are Stripe's: PaymentElement
 * mounts cross-origin iframes, the card is confirmed browser→Stripe, and no
 * card number ever reaches this bundle or our API. That keeps SAQ A while still
 * putting the payment step where the diagram puts it.
 *
 * Two card UIs, and the server picks:
 *   - Stripe configured  → PaymentElement, a real charge
 *   - PAYMENTS_MODE=simulate → the demo form below, because Elements needs a
 *     real client secret from a real intent and there is none to mount against
 *
 * Sequence steps 4-5 land here; 6-11 continue in ConfirmationPage.
 */

/** Loaded once. Null when unset, which is the normal case while simulating. */
const stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null;

interface IntentResponse {
  clientSecret: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  simulated: boolean;
  /**
   * The priced stay behind the amount, for the summary beside the card form.
   *
   * Comes from the intent response rather than the sessionStorage handoff on
   * purpose. The browser carries the guest and the stay across the two pages; it
   * must never carry the price. Reading the summary from the same response the
   * PaymentIntent was minted from is what guarantees the figures on screen are
   * the figures being charged.
   */
  quote: CheckoutQuote;
}

interface HandoffState {
  guestDetails: GuestDetails;
  /**
   * Forwarded verbatim to /payment-intent. The server validates it again there
   * and refuses without it, so dropping it here is not a missing-field bug — it
   * is a payment that cannot start at all.
   */
  billingAddress: BillingAddress;
  stay: StayDetails;
}


export default function PaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [intent, setIntent] = useState<IntentResponse | null>(null);
  const [error, setError] = useState('');

  /**
   * The guest and stay are handed over in sessionStorage rather than router
   * state so a refresh on this page does not lose them and strand the customer
   * mid-flow. Cleared once the booking is confirmed.
   */
  const handoff = useMemo<HandoffState | null>(() => {
    try {
      const raw = sessionStorage.getItem('transcenda:checkout');
      return raw ? (JSON.parse(raw) as HandoffState) : null;
    } catch {
      return null;
    }
  }, []);

  /**
   * Holds the in-flight request, not a "have I run" boolean.
   *
   * StrictMode mounts this effect twice in development. A plain flag would fire
   * two POSTs and mint two PaymentIntents — real objects in the Stripe
   * dashboard, one of them permanently orphaned. A run-once ref that skips the
   * second mount is worse: the first mount's cleanup has already tripped its
   * own cancelled flag, so nothing ever calls setIntent and the page sits on
   * "Preparing secure payment…" forever. That exact mistake cost real debugging
   * time on ConfirmationPage earlier.
   *
   * Caching the promise fixes both: one request, and whichever mount is still
   * alive resolves it.
   */
  const intentRequest = useRef<Promise<IntentResponse> | null>(null);

  useEffect(() => {
    if (!handoff) {
      setError('Your booking details have expired. Please start again.');
      return;
    }

    let active = true;

    if (!intentRequest.current) {
      /**
       * The access token is what attaches this booking to an account. It is not
       * accompanied by a userId in the body: the server reads the account from
       * the token it verifies and rejects a body that claims a different one,
       * so sending both could only ever disagree.
       *
       * Signed out, authHeader() is empty and this is a guest checkout.
       */
      intentRequest.current = authHeader()
        .then((headers) =>
          axios.post<IntentResponse>(
            `${API_URL}/api/bookings/payment-intent`,
            {
              guestDetails: handoff.guestDetails,
              billingAddress: handoff.billingAddress,
              stay: handoff.stay,
            },
            { headers }
          )
        )
        .then((response) => response.data)
        .catch((requestError) => {
          // Cleared so a remount can retry rather than replaying a rejection.
          intentRequest.current = null;
          throw requestError;
        });
    }

    intentRequest.current
      .then((data) => {
        if (active) setIntent(data);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(
          axios.isAxiosError(requestError)
            ? (requestError.response?.data?.error ?? 'We could not start your payment.')
            : 'We could not reach the payment service.'
        );
      });

    return () => {
      active = false;
    };
  }, [handoff]);

  const onPaid = (paymentIntentId: string) => {
    sessionStorage.removeItem('transcenda:checkout');
    navigate(`/confirmation?payment_intent=${encodeURIComponent(paymentIntentId)}`);
  };

  const cancelled = searchParams.get('cancelled') === '1';

  return (
    <div className="relative min-h-screen w-full bg-slate-900 px-4 pt-24 pb-16 sm:px-6 lg:px-8">
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/40 via-slate-900 to-black"></div>

      <nav className="absolute top-0 right-0 left-0 z-50 flex items-center justify-between p-6">
        <Link to="/" className="text-2xl font-extrabold tracking-tight text-white">
          Transcenda<span className="text-blue-500">.</span>
        </Link>
        <Link
          to="/checkout"
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to details
        </Link>
      </nav>

      {/* Wider than the single-column original: the summary sits beside the card
          form from lg up, and stacks under it below that. */}
      <div className="relative z-10 mx-auto w-full max-w-5xl">
        <header className="mb-8">
          <h1 className="text-4xl font-extrabold tracking-tighter text-white md:text-5xl">
            Payment{' '}
            <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
              details.
            </span>
          </h1>
          {intent && (
            <p className="mt-3 text-slate-300">
              You're paying{' '}
              <span className="font-semibold text-white">
                {formatMoney(intent.amount, intent.currency)}
              </span>
            </p>
          )}
        </header>

        {cancelled && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p>You cancelled the payment. Nothing was charged.</p>
          </div>
        )}

        {error && (
          <div className="rounded-2xl bg-white p-8 text-center shadow-xl">
            <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
            <h2 className="mt-4 text-xl font-bold text-slate-800">We can't take payment yet</h2>
            <p className="mt-2 text-slate-500">{error}</p>
            <Link
              to="/checkout"
              className="mt-6 inline-flex h-12 items-center rounded-xl bg-blue-600 px-8 font-bold text-white shadow-md shadow-blue-200 transition-colors hover:bg-blue-700"
            >
              Back to details
            </Link>
          </div>
        )}

        {!error && !intent && (
          <div className="flex items-center justify-center gap-3 py-16 text-slate-300">
            <Loader2 className="h-6 w-6 animate-spin" />
            Preparing secure payment…
          </div>
        )}

        {intent && !error && (
          <div className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
            <main className="rounded-2xl bg-white p-6 shadow-xl md:p-8">
              {/**
               * Three outcomes, not two. `simulated || !stripePromise` used to
               * collapse the last two together, and that was a trap: when the
               * server mints a *real* PaymentIntent and this build has no
               * publishable key, it mounted the demo form against a live charge.
               * The demo form derives brand and last four and posts them — it
               * cannot confirm a card with Stripe — so the intent stays at
               * requires_payment_method, /confirm answers 402 "Payment has not
               * completed", and the page is a dead end that looks like a working
               * form. Say what is actually wrong instead.
               */}
              {intent.simulated ? (
                <DemoCardForm intent={intent} onPaid={onPaid} />
              ) : stripePromise ? (
                <Elements
                  stripe={stripePromise}
                  options={{ clientSecret: intent.clientSecret, appearance: { theme: 'stripe' } }}
                >
                  <StripeCardForm intent={intent} onPaid={onPaid} />
                </Elements>
              ) : (
                <MissingStripeKey />
              )}
            </main>

            {/* Guarded, not assumed. Reading quote.currency off an absent quote
                throws during render, React unmounts the tree, and the customer
                gets a blank page with no error — which is precisely how a
                server/client contract drift blanked the checkout page once
                already. A missing summary is a worse page; a thrown one is no
                page at all. */}
            {intent.quote && (
              <BookingSummary quote={intent.quote} guest={handoff?.guestDetails ?? null} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * What is being paid for, beside the card form.
 *
 * Checkout showed this too, but a customer arrives here having crossed a page
 * boundary with the total in their head and nothing else — asking them to
 * commit a card against a bare figure is how a wrong-dates booking gets paid
 * for. It is also the last screen before money moves, which makes it the last
 * chance to notice.
 *
 * Every figure comes from the quote the intent was minted from. The guest name
 * comes from the handoff because it is the one thing here that is not priced and
 * not sent to Stripe as an amount.
 */
function BookingSummary({
  quote,
  guest,
}: {
  quote: CheckoutQuote;
  guest: GuestDetails | null;
}) {
  return (
    <aside
      aria-label="Booking summary"
      className="h-fit rounded-2xl bg-white/5 p-6 ring-1 ring-white/10 backdrop-blur"
    >
      <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
        Booking summary
      </h2>

      <div className="mt-4 space-y-3 text-sm text-slate-200">
        <p className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
          <span className="font-semibold text-white">{quote.hotelName}</span>
        </p>
        <p className="flex items-start gap-2">
          <BedDouble className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
          <span>{formatRooms(quote.roomTypes, quote.roomLabels)}</span>
        </p>
        <p className="flex items-start gap-2">
          <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
          <span>
            {quote.startDate} → {quote.endDate}
            <span className="text-slate-400">
              {' '}
              ({formatNights(quote.nights)})
            </span>
          </span>
        </p>
        <p className="flex items-start gap-2">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
          <span>{formatOccupancy(quote.adults, quote.children)}</span>
        </p>
        {guest && (
          <p className="flex items-start gap-2">
            <User className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
            <span>
              {guest.salutation} {guest.firstName} {guest.lastName}
            </span>
          </p>
        )}
      </div>

      <dl className="mt-6 space-y-2 border-t border-white/10 pt-4 text-sm">
        <div className="flex justify-between text-slate-300">
          <dt>
            {/* nightlyTotal, not a per-room rate: a multi-room stay bills the
                sum of its rooms each night. */}
            {formatMoney(quote.nightlyTotal)} × {quote.nights} night{quote.nights === 1 ? '' : 's'}
          </dt>
          <dd>{formatMoney(quote.subtotal)}</dd>
        </div>
        <div className="flex justify-between text-slate-300">
          <dt>Taxes &amp; fees</dt>
          <dd>{formatMoney(quote.taxes)}</dd>
        </div>
        <div className="flex justify-between border-t border-white/10 pt-3 text-base font-extrabold text-white">
          <dt>Total</dt>
          <dd>{formatMoney(quote.totalPrice)}</dd>
        </div>
      </dl>
    </aside>
  );
}

/**
 * The server is taking a real payment and this build cannot render card fields
 * for it.
 *
 * Both ways out are configuration, and which one is right depends on what the
 * reader is doing, so both are named rather than guessed at. Neither is
 * something the page can do for itself: mounting Elements needs a publishable
 * key at build time, and switching to the simulator is the server's call — a
 * client that could choose it would be a client that could ask for the demo form
 * against live Stripe.
 */
function MissingStripeKey() {
  return (
    <div className="text-center">
      <AlertCircle className="mx-auto h-12 w-12 text-amber-500" />
      <h2 className="mt-4 text-xl font-bold text-slate-800">Card entry is not configured</h2>
      <p className="mt-2 text-slate-500">
        The server created a real payment, but this build has no Stripe publishable key, so
        Stripe's card fields cannot be shown. Nothing has been charged.
      </p>
      <dl className="mx-auto mt-6 max-w-md space-y-3 text-left text-sm">
        <div className="rounded-xl bg-slate-50 p-4">
          <dt className="font-semibold text-slate-700">To take real test-mode cards</dt>
          <dd className="mt-1 text-slate-500">
            Set <code className="rounded bg-slate-200 px-1">VITE_STRIPE_PUBLISHABLE_KEY</code> in{' '}
            <code className="rounded bg-slate-200 px-1">client/.env</code> and restart Vite.
          </dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <dt className="font-semibold text-slate-700">To use the demo card form instead</dt>
          <dd className="mt-1 text-slate-500">
            Set <code className="rounded bg-slate-200 px-1">PAYMENTS_MODE=simulate</code> in{' '}
            <code className="rounded bg-slate-200 px-1">server/.env</code> and restart the server.
          </dd>
        </div>
      </dl>
    </div>
  );
}

interface FormProps {
  intent: IntentResponse;
  onPaid: (paymentIntentId: string) => void;
}

/**
 * The real thing. PaymentElement renders Stripe-hosted iframes, and
 * confirmPayment sends the card straight to Stripe — this component never sees
 * a card number, which is what keeps the page out of PCI scope.
 */
function StripeCardForm({ intent, onPaid }: FormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isPaying, setIsPaying] = useState(false);
  const [message, setMessage] = useState('');
  /** Stripe's iframes mount asynchronously; pressing Pay before they do does nothing. */
  const [isReady, setIsReady] = useState(false);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();

    /**
     * Never a silent return. If Stripe.js has not finished initialising, a bare
     * `return` here makes the Pay button do literally nothing — no spinner, no
     * message, no request — which is indistinguishable from a broken page and
     * impossible to report usefully.
     */
    if (!stripe || !elements) {
      setMessage('The payment form is still loading. Give it a moment and try again.');
      return;
    }

    setIsPaying(true);
    setMessage('');

    // redirect: 'if_required' keeps the customer here for ordinary cards and
    // only leaves the page when the bank demands a 3DS challenge.
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/confirmation?payment_intent=${intent.paymentIntentId}`,
      },
      redirect: 'if_required',
    });

    if (result.error) {
      // Stripe's own card messages are customer-safe and specific; the ones we
      // must not relay are the API errors, which never surface here.
      setMessage(result.error.message ?? 'That payment could not be completed.');
      setIsPaying(false);
      return;
    }

    onPaid(intent.paymentIntentId);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Card details</h2>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
          <Lock className="h-3.5 w-3.5" />
          Entered directly with Stripe. Transcenda never sees your card number.
        </p>
      </div>

      {message && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{message}</p>
        </div>
      )}

      {/**
       * onLoadError is not optional decoration. Without it, an Element that
       * fails to initialise leaves Stripe's own loading skeleton on screen
       * indefinitely — no error, no timeout, a spinner that never resolves and
       * a Pay button that cannot do anything. Surfacing the reason is the
       * difference between a bug report and a shrug.
       */}
      <PaymentElement
        options={{
          /**
           * Card first, and expanded on arrival.
           *
           * The intent is created with automatic_payment_methods, so Stripe
           * offers everything the account has enabled for the currency — for SGD
           * that is PayNow and Link alongside card. Left to itself it opened on
           * PayNow and rendered a method chooser with no fields at all: the card
           * inputs are created lazily and did not exist in the DOM until the
           * Card tab was clicked. Nothing was broken, but a payment page you
           * cannot type into is indistinguishable from one that is stuck, which
           * is precisely how this was first reported.
           *
           * `tabs` keeps the other methods one click away rather than removing
           * them, so PayNow and Link are still offered.
           */
          layout: 'tabs',
          paymentMethodOrder: ['card'],
        }}
        onReady={() => setIsReady(true)}
        onLoadError={(event) =>
          setMessage(
            event.error?.message ??
              'Stripe could not load the card form. Refresh to try again.'
          )
        }
      />

      <button
        type="submit"
        disabled={!stripe || !isReady || isPaying}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-8 font-bold text-white shadow-md shadow-blue-200 transition-colors hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 disabled:cursor-not-allowed disabled:bg-blue-400"
      >
        {isPaying ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Processing…
          </>
        ) : (
          <>
            <Lock className="h-4 w-4" />
            Pay {formatMoney(intent.amount, intent.currency)}
          </>
        )}
      </button>
    </form>
  );
}

/** Stripe's published test numbers, so a demo can show both outcomes. */
const DEMO_CARDS = [
  { number: '4242 4242 4242 4242', label: 'Visa — succeeds' },
  { number: '5555 5555 5555 4444', label: 'Mastercard — succeeds' },
  { number: '4000 0000 0000 0002', label: 'Visa — declined' },
];

const DECLINE_NUMBER = '4000000000000002';

/** Brand from the IIN range, the same way a real gateway does it. */
const brandOf = (digits: string): string => {
  if (/^4/.test(digits)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard';
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^6(?:011|5)/.test(digits)) return 'discover';
  return 'unknown';
};

const groupDigits = (value: string) =>
  value.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim();

/**
 * Demo-only card entry, shown when the server reports it is simulating.
 *
 * This exists because Elements cannot mount without a real client secret, so
 * without it a credential-free demo has no payment step to show at all.
 *
 * The number typed here never leaves the browser. Brand and last four are
 * derived locally and only those are sent, so even the demo path never puts a
 * PAN on the wire — and the server discards the field entirely unless it is
 * simulating, so this cannot be used against a real charge.
 */
function DemoCardForm({ intent, onPaid }: FormProps) {
  const [number, setNumber] = useState(DEMO_CARDS[0].number);
  const [expiry, setExpiry] = useState('12/30');
  const [cvc, setCvc] = useState('123');
  const [name, setName] = useState('JANE TAN');
  const [isPaying, setIsPaying] = useState(false);
  const [message, setMessage] = useState('');

  const digits = number.replace(/\D/g, '');
  const brand = brandOf(digits);

  const handleSubmit: React.SubmitEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setMessage('');

    if (digits.length < 13) {
      setMessage('That card number is too short.');
      return;
    }

    const [monthPart, yearPart] = expiry.split('/');
    const expMonth = Number(monthPart);
    const expYear = 2000 + Number(yearPart);

    if (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) {
      setMessage('Enter the expiry as MM/YY.');
      return;
    }

    // Mirrors Stripe's own decline test card so the failure path is walkable.
    if (digits === DECLINE_NUMBER) {
      setMessage('Your card was declined. Please try a different payment method.');
      return;
    }

    setIsPaying(true);
    try {
      await axios.post(`${API_URL}/api/bookings/confirm`, {
        paymentIntentId: intent.paymentIntentId,
        // Metadata only. The number itself stays in this component.
        demoCard: { brand, last4: digits.slice(-4), expMonth, expYear },
      });
      onPaid(intent.paymentIntentId);
    } catch (requestError) {
      setMessage(
        axios.isAxiosError(requestError)
          ? (requestError.response?.data?.error ?? 'That payment could not be completed.')
          : 'We could not reach the payment service.'
      );
      setIsPaying(false);
    }
  };

  const fieldClass =
    'w-full rounded-lg bg-slate-50 p-2.5 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500';

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p>
          <span className="font-bold">Demo mode.</span> No money moves and no card is stored. The
          number you type stays in your browser — only the brand and last four digits are sent.
          Set <code className="font-mono text-xs">STRIPE_SECRET_KEY</code> to use real Stripe.
        </p>
      </div>

      <div>
        <h2 className="text-xl font-bold text-slate-800">Card details</h2>
        <p className="mt-1 text-sm text-slate-500">Use one of Stripe's test numbers.</p>
      </div>

      {message && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{message}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {DEMO_CARDS.map((card) => (
          <button
            key={card.number}
            type="button"
            onClick={() => setNumber(card.number)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-400 hover:text-blue-700"
          >
            {card.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col">
        <label htmlFor="demo-card-number" className="mb-1 text-xs font-bold tracking-wider text-slate-500 uppercase">
          Card number
        </label>
        <div className="relative">
          <input
            id="demo-card-number"
            inputMode="numeric"
            className={`${fieldClass} pr-20`}
            value={number}
            onChange={(event) => setNumber(groupDigits(event.target.value))}
          />
          <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs font-bold text-slate-400 uppercase">
            {brand === 'unknown' ? '' : brand}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col">
          <label htmlFor="demo-expiry" className="mb-1 text-xs font-bold tracking-wider text-slate-500 uppercase">
            Expiry
          </label>
          <input
            id="demo-expiry"
            inputMode="numeric"
            placeholder="MM/YY"
            className={fieldClass}
            value={expiry}
            onChange={(event) => {
              const raw = event.target.value.replace(/\D/g, '').slice(0, 4);
              setExpiry(raw.length > 2 ? `${raw.slice(0, 2)}/${raw.slice(2)}` : raw);
            }}
          />
        </div>
        <div className="flex flex-col">
          <label htmlFor="demo-cvc" className="mb-1 text-xs font-bold tracking-wider text-slate-500 uppercase">
            CVC
          </label>
          <input
            id="demo-cvc"
            inputMode="numeric"
            className={fieldClass}
            value={cvc}
            onChange={(event) => setCvc(event.target.value.replace(/\D/g, '').slice(0, 4))}
          />
        </div>
      </div>

      <div className="flex flex-col">
        <label htmlFor="demo-name" className="mb-1 text-xs font-bold tracking-wider text-slate-500 uppercase">
          Name on card
        </label>
        <input
          id="demo-name"
          className={fieldClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <button
        type="submit"
        disabled={isPaying}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-8 font-bold text-white shadow-md shadow-blue-200 transition-colors hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 disabled:cursor-not-allowed disabled:bg-blue-400"
      >
        {isPaying ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Processing…
          </>
        ) : (
          <>
            <CreditCard className="h-4 w-4" />
            Pay {formatMoney(intent.amount, intent.currency)}
          </>
        )}
      </button>
    </form>
  );
}
