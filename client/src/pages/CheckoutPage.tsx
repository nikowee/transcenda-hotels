import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import axios from 'axios';
import {
  AlertCircle,
  ArrowLeft,
  BedDouble,
  Building2,
  Calendar,
  ExternalLink,
  Globe,
  Hash,
  Home,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  ShieldCheck,
  User,
  UserRound,
  Users,
} from 'lucide-react';
import type {
  BillingAddress,
  BillingFieldErrors,
  CheckoutQuote,
  GuestDetails,
  GuestFieldErrors,
} from '../types/booking';
import { formatMoney, formatOccupancy, formatRooms } from '../lib/format';
import { matchesStay, readHandoff, stayToParams, writeHandoff } from '../lib/checkoutHandoff';

const API_URL = import.meta.env.VITE_API_URL;

/**
 * «React Page» CheckoutPage — UC4 "Book & Make Payment".
 *
 * Replaces the checkout.ejs template from the class diagram: the diagram was
 * drawn against a server-rendered EJS monolith, while this codebase is a
 * decoupled SPA, so `render(page, data, errorMessage)` becomes local state.
 *
 * This page never collects card details. The card is entered on the next page
 * (/payment) inside Stripe's own hosted fields, so no PAN, expiry or CVC is
 * ever entered into, stored by, or transmitted through our client or server.
 *
 * Sequence steps map to:
 *   1-2  mount + GET /api/bookings/checkout   → priced quote (display only)
 *   3    submit guest details                 → POST /api/bookings/guest-details
 *   1a-3a invalid details                     → fieldErrors, stay on step 1
 *   4    continue to payment                  → write handoff, go to /payment
 *   5    the payment page mints the intent    → POST /api/bookings/payment-intent
 *   6-11 handled there and in ConfirmationPage, and by the webhook
 */

type Step = 'guest' | 'review';

/** Matches the salutations the bookings table is populated with. */
const SALUTATIONS = ['Mr', 'Mrs', 'Ms', 'Mx', 'Dr', 'Prof'];


const emptyGuest: GuestDetails = {
  salutation: SALUTATIONS[0],
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  specialRequests: '',
};

/**
 * Defaults to SG because the platform prices in SGD. The field is still
 * editable — a card issued abroad has a foreign billing address, and AVS checks
 * against the issuer's record, not ours.
 */
/**
 * Short list rather than all 249 codes: these cover the platform's actual
 * traffic, and a searchable full list is a component this form does not need
 * yet. The server validates any two-letter code, so widening it is data-only.
 */
const COUNTRIES = [
  { code: 'SG', name: 'Singapore' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'TH', name: 'Thailand' },
  { code: 'AU', name: 'Australia' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'JP', name: 'Japan' },
];

const emptyBilling: BillingAddress = {
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'SG',
};



export default function CheckoutPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  /**
   * A handoff left behind by a payment that did not complete.
   *
   * The payment page only clears it on success, so its presence means the
   * customer got as far as the card form and came back — cancelled, declined,
   * or by using the back link. Everything they typed is in it.
   *
   * Read once, lazily, rather than in an effect: hydrating after the first
   * paint would flash an empty form and then fill it, and would briefly show
   * step 1 before jumping to step 2.
   */
  const resumed = useMemo(() => readHandoff(), []);

  /**
   * The stay comes from the URL, and from the handoff only when the URL is bare.
   *
   * This used to fall back to 'demo-hotel' / 'Demo Hotel' / 'deluxe-king' and a
   * near-term date range so /checkout could be opened directly before the
   * results page existed. It exists now, and those defaults had become a real
   * bug: any parameter that failed to arrive was silently replaced, the server
   * dutifully priced the substitute, and the guest was shown a payment page for
   * a stay they had never chosen. A missing parameter has to be visible.
   *
   * The alternate spellings stay — dest/in/out/guests are what the search and
   * hotel-details pages emit — but nothing is invented.
   */
  const urlStay = useMemo(() => {
    const get = (...names: string[]) => {
      for (const name of names) {
        const value = searchParams.get(name)?.trim();
        if (value) return value;
      }
      return '';
    };

    return {
      destinationId: get('destinationId', 'dest'),
      hotelId: get('hotelId'),
      // Optional: the server resolves it from the supplier when absent, which is
      // how a booking started from RoomList works at all.
      hotelName: get('hotelName'),
      // Comma-joined rather than repeated keys: `room_types` is stored that way,
      // so the string survives the whole round trip without re-encoding.
      roomTypes: get('roomTypes', 'roomId'),
      startDate: get('startDate', 'in'),
      endDate: get('endDate', 'out'),
      // Search emits a single head count and has no children field, so everyone
      // it sends is an adult until one exists.
      adults: get('adults', 'guests'),
      children: get('children') || '0',
    };
  }, [searchParams]);

  /**
   * A bare /checkout with a handoff in storage is a resume, not a broken link.
   *
   * Anything that routes here without parameters — an old bookmark, a "back to
   * details" link written before it carried a query, the browser's own back
   * button off a redirect — would otherwise land on "this checkout link is
   * missing destinationId, hotelId, …" while the stay it needs is sitting in
   * sessionStorage. The stay is only borrowed when the URL supplies *nothing*:
   * a link carrying some parameters is a link to a different stay, and filling
   * in its gaps from a previous booking is how the substituted-stay bug worked.
   */
  const stayParams = useMemo(
    () =>
      resumed && !urlStay.destinationId && !urlStay.hotelId && !urlStay.startDate
        ? stayToParams(resumed.stay)
        : urlStay,
    [resumed, urlStay]
  );

  /**
   * Resume only what belongs to the stay on screen.
   *
   * The handoff outlives the booking it was written for — the payment page
   * clears it on success and nothing clears it on abandonment, which is the
   * whole point. So a customer who walked away from paying for one hotel and
   * came back to book a different one still has the first handoff in storage,
   * and seating its guest on this stay's review step would mean confirming and
   * emailing a booking under a previous, unrelated guest's name.
   *
   * The address is part of the gate as well as the values: a handoff without one
   * cannot pass the payment endpoint's billing validator, and the only page that
   * can collect it is step 1.
   */
  const resumes = Boolean(
    resumed && resumed.billingAddress && matchesStay(resumed.stay, stayParams)
  );

  /**
   * Step 2, not step 1, when there is something to resume.
   *
   * A failed payment used to drop the customer back on an empty guest form and
   * make them re-enter their name, email, phone and full billing address before
   * they could try the card again — even though the cancelled banner already
   * told them to "pick up where you left off". They had passed validation once;
   * sending them through it a second time is the whole complaint.
   *
   * A handoff for a *different* stay still refills the form — those details are
   * the same person's and retyping them is the annoyance being fixed — but it
   * starts at step 1, where they are re-validated against the new booking.
   */
  const [step, setStep] = useState<Step>(resumes ? 'review' : 'guest');
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');

  const [guest, setGuest] = useState<GuestDetails>(resumed?.guestDetails ?? emptyGuest);
  const [fieldErrors, setFieldErrors] = useState<GuestFieldErrors>({});
  const [billing, setBilling] = useState<BillingAddress>(resumed?.billingAddress ?? emptyBilling);
  const [billingErrors, setBillingErrors] = useState<BillingFieldErrors>({});

  const [payError, setPayError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const wasCancelled = searchParams.get('cancelled') === '1';

  /** Named, so the guest is told which part of the link is missing. */
  const missingParams = useMemo(
    () =>
      (
        [
          ['destinationId', stayParams.destinationId],
          ['hotelId', stayParams.hotelId],
          ['roomTypes', stayParams.roomTypes],
          ['startDate', stayParams.startDate],
          ['endDate', stayParams.endDate],
          ['adults', stayParams.adults],
        ] as const
      )
        .filter(([, value]) => !value)
        .map(([name]) => name),
    [stayParams]
  );

  // Sequence step 1: GET /checkout
  useEffect(() => {
    let cancelled = false;

    const loadQuote = async () => {
      if (missingParams.length > 0) {
        setQuoteError(
          `This checkout link is missing ${missingParams.join(', ')}. ` +
            'Please choose your room again from the hotel page.'
        );
        return;
      }

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
  }, [stayParams, missingParams]);

  // Sequence step 3 (+ alternative flow 1a-3a)
  const handleGuestSubmit: React.SubmitEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});
    setBillingErrors({});

    try {
      // Billing rides along so the server can reject an address here rather
      // than two pages later, after the customer has committed to paying.
      await axios.post(`${API_URL}/api/bookings/guest-details`, {
        ...guest,
        billingAddress: billing,
      });
      setStep('review');
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 422) {
        setFieldErrors(error.response.data.errors ?? {});
        setBillingErrors(error.response.data.billingErrors ?? {});
      } else {
        setFieldErrors({ firstName: 'Something went wrong. Please try again.' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Sequence step 4. Nothing priced is sent from here — the guest and the stay
   * are handed off to /payment, which asks the server to mint the payment
   * intent against its own prices.
   */
  const handlePay = async () => {
    if (!quote) return;

    setIsSubmitting(true);
    setPayError('');

    const stay = {
      destinationId: quote.destinationId,
      hotelId: quote.hotelId,
      hotelName: quote.hotelName,
      roomTypes: quote.roomTypes,
      startDate: quote.startDate,
      endDate: quote.endDate,
      adults: quote.adults,
      children: quote.children,
    };

    try {
      /**
       * Handed over in sessionStorage rather than router state so refreshing
       * /payment does not strand the customer with no booking to pay for. The
       * payment page re-prices it against the server anyway — nothing here is
       * trusted as an amount.
       */
      writeHandoff({ guestDetails: guest, billingAddress: billing, stay });

      navigate('/payment');
    } catch (error) {
      // sessionStorage throws in private-mode Safari and with storage disabled,
      // which would otherwise strand the customer on a dead button.
      setPayError('We could not continue to payment. Please enable site storage and retry.');
      setIsSubmitting(false);
      console.error('Checkout handoff failed:', error);
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
            {/* "Nothing was charged" is asserted verbatim by the E2E spec and
                is the one sentence a customer needs first. The reassurance
                after it is only true when there was something to resume. */}
            <p>
              You cancelled the payment. Nothing was charged.
              {resumes
                ? ' Your details are still here — check them over and try again.'
                : ' You can start again below.'}
            </p>
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
                billing={billing}
                billingErrors={billingErrors}
                onBillingChange={setBilling}
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
                total={quote ? formatMoney(quote.totalPrice) : ''}
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
  billing: BillingAddress;
  billingErrors: BillingFieldErrors;
  onBillingChange: (billing: BillingAddress) => void;
  errors: GuestFieldErrors;
  isSubmitting: boolean;
  onChange: (guest: GuestDetails) => void;
  onSubmit: React.SubmitEventHandler<HTMLFormElement>;
}

function GuestDetailsForm({
  guest,
  billing,
  billingErrors,
  onBillingChange,
  errors,
  isSubmitting,
  onChange,
  onSubmit,
}: GuestFormProps) {
  const set =
    (key: keyof GuestDetails) =>
    (
      event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
    ) =>
      onChange({ ...guest, [key]: event.target.value });

  const setBilling =
    (key: keyof BillingAddress) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onBillingChange({ ...billing, [key]: event.target.value });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Who's staying?</h2>
        <p className="mt-1 text-sm text-slate-500">
          We'll send your confirmation and check-in instructions here.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-[140px_1fr]">
        <Field
          label="Salutation"
          icon={<UserRound className="h-5 w-5 text-blue-600" />}
          error={errors.salutation}
        >
          <select
            aria-label="Salutation"
            className={inputClass}
            value={guest.salutation}
            onChange={set('salutation')}
          >
            {SALUTATIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="First name"
          icon={<User className="h-5 w-5 text-blue-600" />}
          error={errors.firstName}
        >
          <input
            type="text"
            className={inputClass}
            placeholder="As it appears on your passport"
            value={guest.firstName}
            onChange={set('firstName')}
          />
        </Field>
      </div>

      <Field
        label="Last name"
        icon={<User className="h-5 w-5 text-blue-600" />}
        error={errors.lastName}
      >
        <input
          type="text"
          className={inputClass}
          placeholder="Family name"
          value={guest.lastName}
          onChange={set('lastName')}
        />
      </Field>

      <Field label="Email" icon={<Mail className="h-5 w-5 text-blue-600" />} error={errors.email}>
        <input
          type="email"
          className={inputClass}
          placeholder="you@example.com"
          value={guest.email}
          onChange={set('email')}
        />
      </Field>

      <Field label="Phone" icon={<Phone className="h-5 w-5 text-blue-600" />} error={errors.phone}>
        <input
          type="tel"
          className={inputClass}
          placeholder="+65 9123 4567"
          value={guest.phone}
          onChange={set('phone')}
        />
      </Field>

      <Field
        label="Special requests (optional)"
        icon={<MessageSquare className="h-5 w-5 shrink-0 self-start text-blue-600" />}
        error={errors.specialRequests}
      >
        <textarea
          rows={3}
          className={`${inputClass} resize-none`}
          placeholder="High floor, late check-in, allergies…"
          value={guest.specialRequests ?? ''}
          onChange={set('specialRequests')}
        />
      </Field>


      {/* Billing address — collected here rather than on the payment page so a
          typo surfaces before the customer commits to paying. Its real job is
          the AVS check Stripe runs against it. */}
      <div className="border-t border-slate-100 pt-5">
        <h3 className="text-sm font-bold text-slate-800">Billing address</h3>
        <p className="mt-1 text-xs text-slate-500">
          As it appears on your card statement. Used to verify your payment.
        </p>
      </div>

      <Field
        label="Address line 1"
        icon={<Home className="h-5 w-5 text-blue-600" />}
        error={billingErrors.line1}
      >
        <input
          type="text"
          className={inputClass}
          placeholder="10 Bayfront Avenue"
          autoComplete="billing address-line1"
          value={billing.line1}
          onChange={setBilling('line1')}
        />
      </Field>

      <Field
        label="Address line 2 (optional)"
        icon={<Home className="h-5 w-5 text-blue-600" />}
        error={billingErrors.line2}
      >
        <input
          type="text"
          className={inputClass}
          placeholder="Unit, floor, building"
          autoComplete="billing address-line2"
          value={billing.line2 ?? ''}
          onChange={setBilling('line2')}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="City"
          icon={<Building2 className="h-5 w-5 text-blue-600" />}
          error={billingErrors.city}
        >
          <input
            type="text"
            className={inputClass}
            placeholder="Singapore"
            autoComplete="billing address-level2"
            value={billing.city}
            onChange={setBilling('city')}
          />
        </Field>

        <Field
          label="State or region (optional)"
          icon={<Building2 className="h-5 w-5 text-blue-600" />}
          error={billingErrors.state}
        >
          <input
            type="text"
            className={inputClass}
            placeholder="Leave blank if none"
            autoComplete="billing address-level1"
            value={billing.state ?? ''}
            onChange={setBilling('state')}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Postal code"
          icon={<Hash className="h-5 w-5 text-blue-600" />}
          error={billingErrors.postalCode}
        >
          <input
            type="text"
            className={inputClass}
            placeholder="018956"
            autoComplete="billing postal-code"
            value={billing.postalCode}
            onChange={setBilling('postalCode')}
          />
        </Field>

        <Field
          label="Country"
          icon={<Globe className="h-5 w-5 text-blue-600" />}
          error={billingErrors.country}
        >
          <select
            aria-label="Billing country"
            className={inputClass}
            autoComplete="billing country"
            value={billing.country}
            onChange={setBilling('country')}
          >
            {COUNTRIES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

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
  const specialRequests = guest.specialRequests?.trim();

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
          <dd className="text-sm text-slate-700">
            {guest.salutation} {guest.firstName} {guest.lastName}
          </dd>
        </div>
        <div className="flex items-center gap-3 py-3">
          <Mail className="h-4 w-4 shrink-0 text-blue-600" />
          <dt className="sr-only">Email</dt>
          <dd className="text-sm text-slate-700">{guest.email}</dd>
        </div>
        <div className="flex items-center gap-3 py-3">
          <Phone className="h-4 w-4 shrink-0 text-blue-600" />
          <dt className="sr-only">Phone</dt>
          <dd className="text-sm text-slate-700">{guest.phone}</dd>
        </div>
        {specialRequests && (
          <div className="flex items-start gap-3 py-3">
            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
            <dt className="sr-only">Special requests</dt>
            <dd className="text-sm text-slate-700">{specialRequests}</dd>
          </div>
        )}
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
              {/* No total means the quote never loaded, and the reason is already
                  on screen above. "Pay " with nothing after it reads as a
                  rendering fault rather than a page waiting on a price. */}
              {total ? `Pay ${total}` : 'Pay'}
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
          {quote.hotelName}
        </p>
        <p className="flex items-center gap-2">
          <BedDouble className="h-4 w-4 text-blue-400" />
          {formatRooms(quote.roomTypes, quote.roomLabels)}
        </p>
        <p className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-blue-400" />
          {quote.startDate} → {quote.endDate}
        </p>
        <p className="flex items-center gap-2">
          <Users className="h-4 w-4 text-blue-400" />
          {formatOccupancy(quote.adults, quote.children)}
        </p>
      </div>

      <dl className="mt-6 space-y-2 border-t border-white/10 pt-4 text-sm">
        <div className="flex justify-between text-slate-300">
          <dt>
            {/* nightlyTotal, not a per-room rate: a multi-room stay bills the sum
                of its rooms each night. Per-room figures are in quote.nightlyRates,
                index-aligned with roomTypes, if the summary ever itemises them. */}
            {formatMoney(quote.nightlyTotal)} × {quote.nights} night
            {quote.nights > 1 ? 's' : ''}
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
