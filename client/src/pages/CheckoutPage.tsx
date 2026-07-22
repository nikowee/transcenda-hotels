import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import axios from 'axios';
import {
  AlertCircle,
  ArrowLeft,
  BedDouble,
  Calendar,
  CreditCard,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';
import type {
  CheckoutQuote,
  GuestDetails,
  GuestFieldErrors,
  PaymentMethodInput,
} from '../types/booking';

const API_URL = import.meta.env.VITE_API_URL;

/**
 * CheckoutPage — UC4 "Book & Make Payment".
 *
 * Replaces the checkout.ejs template from the class diagram: the diagram was
 * drawn against a server-rendered EJS monolith, while this codebase is a
 * decoupled SPA, so `render(page, data, errorMessage)` becomes local state and
 * the server returns JSON instead of HTML.
 *
 * Sequence diagram steps map to:
 *   1-2  mount + GET /api/bookings/checkout      → priced quote
 *   3    submit guest details                    → POST /api/bookings/guest-details
 *   1a-3a invalid details                        → fieldErrors, stay on step 1
 *   4-6  submit payment                          → POST /api/bookings/payment
 *   6a-9a payment failure                        → paymentError, stay on step 2
 *   7-10 persist + email                         → POST /api/bookings/confirm
 *   11   confirmation                            → navigate to /confirmation
 */

type Step = 'guest' | 'payment';

const iso = (date: Date) => date.toISOString().slice(0, 10);

const emptyGuest: GuestDetails = { guestName: '', guestEmail: '', contactNumber: '' };
const emptyPayment: PaymentMethodInput = {
  nameOnCard: '',
  cardNumber: '',
  expiry: '',
  cvc: '',
};

const formatMoney = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** 4242 4242 4242 4242 as you type */
const formatCardNumber = (value: string) =>
  value
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(.{4})/g, '$1 ')
    .trim();

const formatExpiry = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
};

export default function CheckoutPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState<Step>('guest');
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');

  const [guest, setGuest] = useState<GuestDetails>(emptyGuest);
  const [fieldErrors, setFieldErrors] = useState<GuestFieldErrors>({});

  const [payment, setPayment] = useState<PaymentMethodInput>(emptyPayment);
  const [paymentError, setPaymentError] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Falls back to a near-term stay so /checkout is reachable directly, before
  // the results page is wired up to pass real room selections through.
  const stayParams = useMemo(() => {
    const today = new Date();
    const defaultIn = new Date(today.getTime() + 86_400_000);
    const defaultOut = new Date(today.getTime() + 4 * 86_400_000);

    return {
      hotelId: searchParams.get('hotelId') ?? searchParams.get('dest') ?? 'demo-hotel',
      roomId: searchParams.get('roomId') ?? 'deluxe-king',
      checkIn: searchParams.get('checkIn') ?? searchParams.get('in') ?? iso(defaultIn),
      checkOut: searchParams.get('checkOut') ?? searchParams.get('out') ?? iso(defaultOut),
      guests: searchParams.get('guests') ?? '2',
      rooms: searchParams.get('rooms') ?? '1',
    };
  }, [searchParams]);

  // Sequence step 1: GET /checkout
  useEffect(() => {
    let cancelled = false;

    const loadQuote = async () => {
      try {
        const response = await axios.get<CheckoutQuote>(`${API_URL}/api/bookings/checkout`, {
          params: stayParams,
        });
        if (!cancelled) {
          setQuote(response.data);
          setQuoteError('');
        }
      } catch {
        if (!cancelled) {
          setQuoteError('We could not load your booking summary. Please try again.');
        }
      }
    };

    loadQuote();
    return () => {
      cancelled = true;
    };
  }, [stayParams]);

  // Sequence step 3 (+ alternative flow 1a-3a)
  const handleGuestSubmit: React.SubmitEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});

    try {
      await axios.post(`${API_URL}/api/bookings/guest-details`, guest);
      setStep('payment');
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 422) {
        // 2a: re-render this step carrying the error messages
        setFieldErrors(error.response.data.errors ?? {});
      } else {
        setFieldErrors({ guestName: 'Something went wrong. Please try again.' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Sequence steps 4-10 (+ alternative flow 6a-9a)
  const handlePaymentSubmit: React.SubmitEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (!quote) return;

    setIsSubmitting(true);
    setPaymentError('');

    try {
      // Steps 4-6
      const paymentResponse = await axios.post(`${API_URL}/api/bookings/payment`, {
        amount: quote.totalPrice,
        paymentMethod: payment,
      });

      // Steps 7-10
      const confirmResponse = await axios.post(`${API_URL}/api/bookings/confirm`, {
        guestDetails: guest,
        stay: {
          hotelId: quote.hotelId,
          roomId: quote.roomId,
          checkIn: quote.checkIn,
          checkOut: quote.checkOut,
          totalPrice: quote.totalPrice,
        },
        transactionId: paymentResponse.data.transactionId,
      });

      // Step 11
      navigate(`/confirmation?ref=${confirmResponse.data.booking.bookingReference}`, {
        state: {
          booking: confirmResponse.data.booking,
          emailDelivered: confirmResponse.data.emailDelivered,
        },
      });
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        // 7a-8a: tell them it failed and invite an alternate method (9a: resume step 4)
        setPaymentError(
          error.response.data.errorMessage ??
            error.response.data.error ??
            'Payment could not be processed. Please try another method.'
        );
        setPayment((current) => ({ ...current, cardNumber: '', cvc: '' }));
      } else {
        setPaymentError('We could not reach the payment gateway. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full bg-slate-900 px-4 pt-24 pb-16 sm:px-6 lg:px-8">
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/40 via-slate-900 to-black"></div>

      <nav className="absolute top-0 right-0 left-0 z-50 flex items-center justify-between p-6">
        <Link to="/" className="text-2xl font-extrabold tracking-tight text-white">
          Transcenda<span className="text-blue-500">.</span>
        </Link>
        <Link
          to="/"
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-300 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to search
        </Link>
      </nav>

      <div className="relative z-10 mx-auto w-full max-w-5xl">
        <header className="mb-8 space-y-2">
          <h1 className="text-4xl font-extrabold tracking-tighter text-white md:text-5xl">
            Complete your{' '}
            <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
              booking.
            </span>
          </h1>
          <StepIndicator step={step} />
        </header>

        {quoteError && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p>{quoteError}</p>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <main className="rounded-2xl bg-white p-6 shadow-xl md:p-8">
            {step === 'guest' ? (
              <GuestDetailsForm
                guest={guest}
                errors={fieldErrors}
                isSubmitting={isSubmitting}
                onChange={setGuest}
                onSubmit={handleGuestSubmit}
              />
            ) : (
              <PaymentForm
                payment={payment}
                error={paymentError}
                isSubmitting={isSubmitting}
                total={quote ? formatMoney(quote.totalPrice, quote.currency) : ''}
                onChange={setPayment}
                onBack={() => setStep('guest')}
                onSubmit={handlePaymentSubmit}
              />
            )}
          </main>

          <OrderSummary quote={quote} />
        </div>
      </div>
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: Array<{ id: Step | 'done'; label: string }> = [
    { id: 'guest', label: 'Guest details' },
    { id: 'payment', label: 'Payment' },
    { id: 'done', label: 'Confirmation' },
  ];
  const activeIndex = step === 'guest' ? 0 : 1;

  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      {steps.map((item, index) => (
        <li key={item.id} className="flex items-center gap-3">
          <span
            className={`flex items-center gap-2 font-semibold ${
              index <= activeIndex ? 'text-white' : 'text-slate-500'
            }`}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                index <= activeIndex ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'
              }`}
            >
              {index + 1}
            </span>
            {item.label}
          </span>
          {index < steps.length - 1 && <span className="h-px w-6 bg-slate-600" />}
        </li>
      ))}
    </ol>
  );
}

interface FieldProps {
  label: string;
  icon: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}

function Field({ label, icon, error, children }: FieldProps) {
  return (
    <div className="flex flex-col">
      <label className="mb-1 text-xs font-bold tracking-wider text-slate-500 uppercase">
        {label}
      </label>
      <div
        className={`flex items-center gap-2 rounded-lg bg-slate-50 p-2 transition-colors hover:bg-slate-100 focus-within:ring-2 ${
          error ? 'ring-2 ring-red-400' : 'focus-within:ring-blue-500'
        }`}
      >
        {icon}
        {children}
      </div>
      {error && (
        <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-red-600">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </p>
      )}
    </div>
  );
}

const inputClass = 'w-full bg-transparent outline-none placeholder:text-slate-400';

interface GuestFormProps {
  guest: GuestDetails;
  errors: GuestFieldErrors;
  isSubmitting: boolean;
  onChange: (guest: GuestDetails) => void;
  onSubmit: React.SubmitEventHandler<HTMLFormElement>;
}

function GuestDetailsForm({ guest, errors, isSubmitting, onChange, onSubmit }: GuestFormProps) {
  const set = (key: keyof GuestDetails) => (event: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...guest, [key]: event.target.value });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Who's staying?</h2>
        <p className="mt-1 text-sm text-slate-500">
          We'll send your confirmation and check-in instructions here.
        </p>
      </div>

      <Field label="Full name" icon={<User className="h-5 w-5 text-blue-600" />} error={errors.guestName}>
        <input
          type="text"
          className={inputClass}
          placeholder="As it appears on your passport"
          value={guest.guestName}
          onChange={set('guestName')}
        />
      </Field>

      <Field label="Email" icon={<Mail className="h-5 w-5 text-blue-600" />} error={errors.guestEmail}>
        <input
          type="email"
          className={inputClass}
          placeholder="you@example.com"
          value={guest.guestEmail}
          onChange={set('guestEmail')}
        />
      </Field>

      <Field
        label="Contact number"
        icon={<Phone className="h-5 w-5 text-blue-600" />}
        error={errors.contactNumber}
      >
        <input
          type="tel"
          className={inputClass}
          placeholder="+65 9123 4567"
          value={guest.contactNumber}
          onChange={set('contactNumber')}
        />
      </Field>

      <button
        type="submit"
        disabled={isSubmitting}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-8 font-bold text-white shadow-md shadow-blue-200 transition-colors hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 disabled:cursor-not-allowed disabled:bg-blue-400"
      >
        {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        Continue to payment
      </button>
    </form>
  );
}

interface PaymentFormProps {
  payment: PaymentMethodInput;
  error: string;
  isSubmitting: boolean;
  total: string;
  onChange: (payment: PaymentMethodInput) => void;
  onBack: () => void;
  onSubmit: React.SubmitEventHandler<HTMLFormElement>;
}

function PaymentForm({
  payment,
  error,
  isSubmitting,
  total,
  onChange,
  onBack,
  onSubmit,
}: PaymentFormProps) {
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Payment details</h2>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
          <Lock className="h-3.5 w-3.5" />
          Encrypted in transit and processed by our payment gateway.
        </p>
      </div>

      {/* Alternative flow 7a-8a */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-bold">Payment failed</p>
            <p className="mt-0.5">{error}</p>
            <p className="mt-1 text-red-600">Please try a different card or payment method.</p>
          </div>
        </div>
      )}

      <Field label="Name on card" icon={<User className="h-5 w-5 text-blue-600" />}>
        <input
          type="text"
          className={inputClass}
          placeholder="JANE TAN"
          value={payment.nameOnCard}
          onChange={(event) => onChange({ ...payment, nameOnCard: event.target.value })}
        />
      </Field>

      <Field label="Card number" icon={<CreditCard className="h-5 w-5 text-blue-600" />}>
        <input
          type="text"
          inputMode="numeric"
          className={inputClass}
          placeholder="4242 4242 4242 4242"
          value={payment.cardNumber}
          onChange={(event) =>
            onChange({ ...payment, cardNumber: formatCardNumber(event.target.value) })
          }
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Expiry" icon={<Calendar className="h-5 w-5 text-blue-600" />}>
          <input
            type="text"
            inputMode="numeric"
            className={inputClass}
            placeholder="MM/YY"
            value={payment.expiry}
            onChange={(event) => onChange({ ...payment, expiry: formatExpiry(event.target.value) })}
          />
        </Field>

        <Field label="CVC" icon={<ShieldCheck className="h-5 w-5 text-blue-600" />}>
          <input
            type="text"
            inputMode="numeric"
            className={inputClass}
            placeholder="123"
            value={payment.cvc}
            onChange={(event) =>
              onChange({ ...payment, cvc: event.target.value.replace(/\D/g, '').slice(0, 4) })
            }
          />
        </Field>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onBack}
          disabled={isSubmitting}
          className="h-12 rounded-xl border border-slate-200 px-6 font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-8 font-bold text-white shadow-md shadow-blue-200 transition-colors hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 disabled:cursor-not-allowed disabled:bg-blue-400"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Processing…
            </>
          ) : (
            <>
              <Lock className="h-4 w-4" />
              Pay {total}
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function OrderSummary({ quote }: { quote: CheckoutQuote | null }) {
  if (!quote) {
    return (
      <aside className="h-fit rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
        <div className="space-y-3">
          <div className="h-4 w-2/3 animate-pulse rounded bg-white/10" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-white/10" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-white/10" />
        </div>
      </aside>
    );
  }

  return (
    <aside className="h-fit rounded-2xl bg-white/5 p-6 ring-1 ring-white/10 backdrop-blur">
      <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">Your stay</h2>

      <div className="mt-4 space-y-3 text-sm text-slate-200">
        <p className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-blue-400" />
          {quote.hotelId}
        </p>
        <p className="flex items-center gap-2">
          <BedDouble className="h-4 w-4 text-blue-400" />
          {quote.roomId} · {quote.rooms} room{quote.rooms > 1 ? 's' : ''}
        </p>
        <p className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-blue-400" />
          {quote.checkIn} → {quote.checkOut}
        </p>
        <p className="flex items-center gap-2">
          <Users className="h-4 w-4 text-blue-400" />
          {quote.guests} guest{quote.guests > 1 ? 's' : ''}
        </p>
      </div>

      <dl className="mt-6 space-y-2 border-t border-white/10 pt-4 text-sm">
        <div className="flex justify-between text-slate-300">
          <dt>
            {formatMoney(quote.nightlyRate, quote.currency)} × {quote.nights} night
            {quote.nights > 1 ? 's' : ''}
          </dt>
          <dd>{formatMoney(quote.subtotal, quote.currency)}</dd>
        </div>
        <div className="flex justify-between text-slate-300">
          <dt>Taxes &amp; fees</dt>
          <dd>{formatMoney(quote.taxes, quote.currency)}</dd>
        </div>
        <div className="flex justify-between border-t border-white/10 pt-3 text-base font-extrabold text-white">
          <dt>Total</dt>
          <dd>{formatMoney(quote.totalPrice, quote.currency)}</dd>
        </div>
      </dl>
    </aside>
  );
}
