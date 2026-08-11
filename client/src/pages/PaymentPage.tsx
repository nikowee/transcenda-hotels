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
import type { CheckoutQuote, GuestDetails } from '../types/booking';
import { formatMoney, formatNights, formatOccupancy, formatRooms } from '../lib/format';
import {
  clearHandoff,
  readHandoff,
  stayToCheckoutQuery,
  type CheckoutHandoff,
} from '../lib/checkoutHandoff';

const API_URL = import.meta.env.VITE_API_URL;
const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

/**
 * «React Page» PaymentPage — sequence step 4. The inputs are Stripe's iframes,
 * so no card number reaches this bundle (SAQ A). The server picks the card
 * UI: real Elements, or the demo form under PAYMENTS_MODE=simulate.
 */

/** Loaded once. Null when unset, which is the normal case while simulating. */
const stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null;

interface IntentResponse {
  clientSecret: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  simulated: boolean;
  /** The priced stay behind the amount, read from the intent response rather than the handoff on purpose. */
  quote: CheckoutQuote;
}




export default function PaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [intent, setIntent] = useState<IntentResponse | null>(null);
  const [error, setError] = useState('');

  /** Read the handoff once — sessionStorage rather than router state, so a refresh keeps the booking to pay for. */
  const handoff = useMemo<CheckoutHandoff | null>(() => readHandoff(), []);

  /** Build the back link with the stay in its query. */
  const back = useMemo(
    () =>
      handoff
        ? { to: `/checkout?${stayToCheckoutQuery(handoff.stay)}`, label: 'Back to details' }
        : { to: '/', label: 'Back to search' },
    [handoff]
  );

  /** Hold the in-flight request, not a "have I run" boolean. */
  const intentRequest = useRef<Promise<IntentResponse> | null>(null);

  useEffect(() => {
    if (!handoff) {
      setError('Your booking details have expired. Please start again.');
      return;
    }

    let active = true;

    if (!intentRequest.current) {
      /** The access token is what attaches this booking to an account. */
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
    // Clear only on success — a failed payment leaves the handoff so the
    // customer resumes at the review step. ConfirmationPage clears it too:
    // a 3DS challenge navigates away and never comes back through here.
    clearHandoff();
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
          to={back.to}
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {back.label}
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
              to={back.to}
              className="mt-6 inline-flex h-12 items-center rounded-xl bg-blue-600 px-8 font-bold text-white shadow-md shadow-blue-200 transition-colors hover:bg-blue-700"
            >
              {back.label}
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
               * Three outcomes, not two: the demo form only for a simulated
               * intent, Elements only with a publishable key, and an explicit
               * explainer otherwise — mounting the demo form against a real
               * PaymentIntent leaves it stuck at requires_payment_method, a
               * dead end that looks like a working form.
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

            {/* Guarded, not assumed: reading fields off an absent quote throws
                during render and blanks the whole page — a missing summary is
                a worse page; a thrown one is no page at all. */}
            {intent.quote && (
              <BookingSummary quote={intent.quote} guest={handoff?.guestDetails ?? null} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The booking summary beside the card form. */
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

/** The server is taking a real payment and this build cannot render card fields for it. */
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

/** The real thing. */
function StripeCardForm({ intent, onPaid }: FormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isPaying, setIsPaying] = useState(false);
  const [message, setMessage] = useState('');
  /** Stripe's iframes mount asynchronously; pressing Pay before they do does nothing. */
  const [isReady, setIsReady] = useState(false);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();

    /** Never a silent return: before Stripe.js finishes initialising, a bare return makes the Pay button do literally nothing. */
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
       * onLoadError is load-bearing: without it a failed Element leaves
       * Stripe's loading skeleton on screen indefinitely — no error, no
       * timeout, a Pay button that cannot do anything.
       */}
      <PaymentElement
        options={{
          /** Card first, expanded on arrival: automatic_payment_methods offers PayNow and Link alongside card for SGD, and left to itself the Element opens on a method chooser with no typeable fields. */
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

/** Demo-only card entry, shown when the server reports it is simulating. */
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
