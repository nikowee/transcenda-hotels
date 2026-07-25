import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import axios from 'axios';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import {
  AlertCircle,
  ArrowLeft,
  CreditCard,
  Loader2,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import type { BillingAddress, GuestDetails, StayDetails } from '../types/booking';

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

const formatMoney = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

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
      intentRequest.current = axios
        .post<IntentResponse>(`${API_URL}/api/bookings/payment-intent`, {
          guestDetails: handoff.guestDetails,
          billingAddress: handoff.billingAddress,
          stay: handoff.stay,
        })
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

      <div className="relative z-10 mx-auto w-full max-w-2xl">
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
          <main className="rounded-2xl bg-white p-6 shadow-xl md:p-8">
            {intent.simulated || !stripePromise ? (
              <DemoCardForm intent={intent} onPaid={onPaid} />
            ) : (
              <Elements
                stripe={stripePromise}
                options={{ clientSecret: intent.clientSecret, appearance: { theme: 'stripe' } }}
              >
                <StripeCardForm intent={intent} onPaid={onPaid} />
              </Elements>
            )}
          </main>
        )}
      </div>
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

  const handleSubmit: React.SubmitEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (!stripe || !elements) return;

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

      <PaymentElement />

      <button
        type="submit"
        disabled={!stripe || isPaying}
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
