import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import axios from 'axios';
import {
  AlertCircle,
  ArrowLeft,
  BedDouble,
  Calendar,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';
import type { CheckoutQuote, GuestDetails, GuestFieldErrors } from '../types/booking';

const API_URL = import.meta.env.VITE_API_URL;

/**
 * CheckoutPage — UC4 "Book & Make Payment".
 *
 * Replaces the checkout.ejs template from the class diagram: the diagram was
 * drawn against a server-rendered EJS monolith, while this codebase is a
 * decoupled SPA, so `render(page, data, errorMessage)` becomes local state.
 *
 * This page never collects card details. Payment happens on a Stripe-hosted
 * checkout page, so no PAN, expiry or CVC is ever entered into, stored by, or
 * transmitted through our client or server.
 *
 * Sequence steps map to:
 *   1-2  mount + GET /api/bookings/checkout   → priced quote (display only)
 *   3    submit guest details                 → POST /api/bookings/guest-details
 *   1a-3a invalid details                     → fieldErrors, stay on step 1
 *   4-5  confirm and pay                      → POST /api/bookings/payment
 *                                             → redirect to Stripe
 *   6-11 handled on return in ConfirmationPage, and by the webhook
 */

type Step = 'guest' | 'review';

const iso = (date: Date) => date.toISOString().slice(0, 10);

const emptyGuest: GuestDetails = { guestName: '', guestEmail: '', contactNumber: '' };

const formatMoney = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CheckoutPage() {
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState<Step>('guest');
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');

  const [guest, setGuest] = useState<GuestDetails>(emptyGuest);
  const [fieldErrors, setFieldErrors] = useState<GuestFieldErrors>({});

  const [payError, setPayError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const wasCancelled = searchParams.get('cancelled') === '1';

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
      } catch (error) {
        if (cancelled) return;
        const message = axios.isAxiosError(error)
          ? (error.response?.data?.error ?? 'We could not load your booking summary.')
          : 'We could not load your booking summary.';
        setQuoteError(message);
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
      setStep('review');
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 422) {
        setFieldErrors(error.response.data.errors ?? {});
      } else {
        setFieldErrors({ guestName: 'Something went wrong. Please try again.' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Sequence steps 4-5. The server prices the stay itself and returns a
   * Stripe-hosted URL; nothing about the amount is sent from here.
   */
  const handlePay = async () => {
    if (!quote) return;

    setIsSubmitting(true);
    setPayError('');

    try {
      const response = await axios.post(`${API_URL}/api/bookings/payment`, {
        guestDetails: guest,
        stay: {
          hotelId: quote.hotelId,
          roomId: quote.roomId,
          checkIn: quote.checkIn,
          checkOut: quote.checkOut,
          guests: quote.guests,
          rooms: quote.rooms,
        },
      });

      // Leaves our origin entirely — card entry happens on Stripe.
      window.location.assign(response.data.redirectUrl);
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? (error.response?.data?.error ?? 'We could not start your payment.')
        : 'We could not reach the payment service.';
      setPayError(message);
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

        {wasCancelled && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p>You cancelled the payment. Nothing was charged — pick up where you left off.</p>
          </div>
        )}

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
              <ReviewAndPay
                guest={guest}
                error={payError}
                isSubmitting={isSubmitting}
                total={quote ? formatMoney(quote.totalPrice, quote.currency) : ''}
                canPay={Boolean(quote)}
                onBack={() => setStep('guest')}
                onPay={handlePay}
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
    { id: 'review', label: 'Review & pay' },
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

interface ReviewProps {
  guest: GuestDetails;
  error: string;
  isSubmitting: boolean;
  total: string;
  canPay: boolean;
  onBack: () => void;
  onPay: () => void;
}

function ReviewAndPay({ guest, error, isSubmitting, total, canPay, onBack, onPay }: ReviewProps) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Review and pay</h2>
        <p className="mt-1 text-sm text-slate-500">
          Check your details, then continue to our payment provider.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-bold">We couldn't start your payment</p>
            <p className="mt-0.5">{error}</p>
          </div>
        </div>
      )}

      <dl className="divide-y divide-slate-100 rounded-xl bg-slate-50 px-4">
        <div className="flex items-center gap-3 py-3">
          <User className="h-4 w-4 shrink-0 text-blue-600" />
          <dt className="sr-only">Name</dt>
          <dd className="text-sm text-slate-700">{guest.guestName}</dd>
        </div>
        <div className="flex items-center gap-3 py-3">
          <Mail className="h-4 w-4 shrink-0 text-blue-600" />
          <dt className="sr-only">Email</dt>
          <dd className="text-sm text-slate-700">{guest.guestEmail}</dd>
        </div>
        <div className="flex items-center gap-3 py-3">
          <Phone className="h-4 w-4 shrink-0 text-blue-600" />
          <dt className="sr-only">Contact number</dt>
          <dd className="text-sm text-slate-700">{guest.contactNumber}</dd>
        </div>
      </dl>

      <div className="flex items-start gap-2.5 rounded-xl bg-blue-50 p-4 text-sm text-blue-900">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
        <p>
          You'll enter your card on our payment provider's secure page. Transcenda never sees or
          stores your card details.
        </p>
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
          type="button"
          onClick={onPay}
          disabled={isSubmitting || !canPay}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-8 font-bold text-white shadow-md shadow-blue-200 transition-colors hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 disabled:cursor-not-allowed disabled:bg-blue-400"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Redirecting…
            </>
          ) : (
            <>
              <ExternalLink className="h-4 w-4" />
              Pay {total}
            </>
          )}
        </button>
      </div>
    </div>
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
