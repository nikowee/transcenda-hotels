import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import axios from 'axios';
import {
  AlertCircle,
  BedDouble,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  User,
  Users,
} from 'lucide-react';
import type { BookingRecord } from '../types/booking';
import { formatCard, formatMoney, formatOccupancy } from '../lib/format';
import { clearHandoff } from '../lib/checkoutHandoff';

const API_URL = import.meta.env.VITE_API_URL;

/**
 * «React Page» ConfirmationPage — sequence step 11, and the "Display Booking
 * Confirmation" use case. Replaces confirmation.ejs.
 *
 * Reached by redirect back from Stripe, so router state does not survive the
 * trip and everything is re-fetched from the session id in the query string.
 *
 * There is no payment status to render. The bookings table has price_paid and
 * payment_id NOT NULL and no status column, so a row cannot exist unless Stripe
 * confirmed the charge: a returned booking *is* a paid booking, and the only
 * other outcome is that the charge has not been recorded yet.
 *
 * Sequence steps map to:
 *   6-10 POST /api/bookings/confirm  → server verifies the session with Stripe
 *                                      and inserts the booking
 *   11   render the returned record
 *   ?id=<uuid> revisit               → GET /api/bookings/:id, no Stripe hop
 */

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 5;

/** The schema stores no currency column: the platform prices everything in SGD. */

/**
 * A 404 is an answer — that booking does not exist. Every other failure
 * (5xx, network, CORS) means the lookup failed, not that the booking did, and
 * the two must not read the same: telling someone who has just paid that their
 * booking cannot be found, when the truth is that the API is down, is the worst
 * wrong answer this page can give.
 */
type PageError = { title: string; detail: string };

const NOT_FOUND: PageError = {
  title: 'Booking not found',
  detail: 'We could not find that booking.',
};

const UNREACHABLE: PageError = {
  title: 'We could not reach our booking service',
  detail:
    'Your payment may still have gone through. Nothing is lost — refresh this page in a moment.',
};



/** Stripe reports the brand lower-cased ("visa"); this page reads as a receipt. */

/** Confirm wraps the record; the by-id lookup returns it bare. */
const readBooking = (payload: unknown): BookingRecord | null => {
  const body = payload as { booking?: BookingRecord } & Partial<BookingRecord>;
  const record = body?.booking ?? (body as BookingRecord);
  return record?.id ? record : null;
};

const isStatus = (error: unknown, status: number) =>
  axios.isAxiosError(error) && error.response?.status === status;

export default function ConfirmationPage() {
  const [searchParams] = useSearchParams();
  const [booking, setBooking] = useState<BookingRecord | null>(null);
  const [error, setError] = useState<PageError | null>(null);
  const [isSettling, setIsSettling] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const sessionId = searchParams.get('session_id');
  /**
   * The Elements flow returns here with payment_intent instead of session_id.
   * Both are verified server-side against Stripe and both produce the same
   * booking, so the page only needs to know which key to forward.
   */
  const paymentIntentId = searchParams.get('payment_intent');
  const bookingId = searchParams.get('id');

  /**
   * Holds the in-flight confirmation, not a "have I run" boolean.
   *
   * This used to deliberately allow the effect to run twice, on the grounds
   * that confirming is idempotent server-side. It is not: insertOne reads
   * findByPaymentId and then inserts, with nothing atomic in between and no
   * unique constraint behind it, so two concurrent confirmations both see no
   * booking and both write one. Rows milliseconds apart sharing a payment_id
   * are exactly that race.
   *
   * A plain run-once ref is the wrong fix and was correctly rejected before —
   * it strands the page in its loading state, because the first mount's cleanup
   * has already tripped `cancelled`. Caching the promise gives one request and
   * lets whichever mount is still alive consume it.
   */
  const confirmRequest = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const finalise = async () => {
      if (!sessionId && !paymentIntentId && !bookingId) {
        setError({ ...NOT_FOUND, detail: 'No booking reference was provided.' });
        setIsLoading(false);
        return;
      }

      // Revisiting a booking that was already confirmed: no Stripe round trip,
      // and nothing to wait for, so a single lookup answers conclusively.
      if (!sessionId && !paymentIntentId && bookingId) {
        try {
          const response = await axios.get<BookingRecord>(`${API_URL}/api/bookings/${bookingId}`);
          if (cancelled) return;
          setBooking(response.data);
          clearHandoff();
          setError(null);
        } catch (fetchError) {
          if (cancelled) return;
          setError(isStatus(fetchError, 404) ? NOT_FOUND : UNREACHABLE);
        }
        if (!cancelled) setIsLoading(false);
        return;
      }

      // Sequence steps 6-10: the server verifies the completed session against
      // Stripe and writes the booking. The webhook does the same independently,
      // whichever arrives first wins.
      for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
        if (cancelled) return;

        try {
          confirmRequest.current ??= axios
            .post(
              `${API_URL}/api/bookings/confirm`,
              paymentIntentId ? { paymentIntentId } : { sessionId }
            )
            .catch((requestError) => {
              // Cleared so the next poll retries rather than replaying a
              // rejection for the remaining attempts.
              confirmRequest.current = null;
              throw requestError;
            });

          const response = (await confirmRequest.current) as { data: unknown };
          if (cancelled) return;

          // A poll that came back unsettled must ask again, not re-read the
          // same resolved promise forever.
          confirmRequest.current = null;

          const record = readBooking(response.data);
          if (record) {
            setBooking(record);
            /**
             * Here, not only in PaymentPage's success handler.
             *
             * That handler runs for cards Stripe settles inline, but a bank that
             * demands a 3DS challenge takes the whole page away and returns the
             * browser straight to this URL — confirmPayment never resolves, so
             * nothing on the payment page clears anything. The handoff then
             * survives a paid booking and auto-resumes the customer's *next*
             * checkout onto the stay they have already paid for.
             *
             * A confirmed booking record is the one signal both paths share, and
             * it is the definition of "this handoff is spent".
             */
            clearHandoff();
            setError(null);
            setIsLoading(false);
            return;
          }

          // Accepted, but Stripe has not reported the charge as settled yet.
        } catch (confirmError) {
          if (cancelled) return;

          // 402 is "not paid yet", which is a wait, not a failure.
          if (!isStatus(confirmError, 402)) {
            // Only a 404 is conclusive. Anything else gets the remaining
            // attempts before the page gives up, so a brief backend blip does
            // not report a paid booking as missing.
            if (isStatus(confirmError, 404)) {
              setError(NOT_FOUND);
              setIsLoading(false);
              return;
            }

            if (attempt === MAX_POLLS - 1) {
              setError(UNREACHABLE);
              setIsLoading(false);
              return;
            }
          }
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      if (cancelled) return;

      // Out of attempts with the charge still in flight. The money may well be
      // gone, so this must not read as a failure or as a missing booking.
      setIsSettling(true);
      setIsLoading(false);
    };

    finalise();
    return () => {
      cancelled = true;
    };
  }, [sessionId, paymentIntentId, bookingId]);

  return (
    <div className="relative min-h-screen w-full bg-slate-900 px-4 pt-24 pb-16 sm:px-6 lg:px-8">
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/40 via-slate-900 to-black"></div>

      <nav className="absolute top-0 right-0 left-0 z-50 flex items-center justify-between p-6">
        <Link to="/" className="text-2xl font-extrabold tracking-tight text-white">
          Transcenda<span className="text-blue-500">.</span>
        </Link>
      </nav>

      <div className="relative z-10 mx-auto w-full max-w-3xl">
        {isLoading && (
          <div className="flex items-center justify-center gap-3 py-24 text-slate-300">
            <Loader2 className="h-6 w-6 animate-spin" />
            Confirming your booking…
          </div>
        )}

        {!isLoading && error && (
          <div className="rounded-2xl bg-white p-8 text-center shadow-xl">
            <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
            <h1 className="mt-4 text-2xl font-bold text-slate-800">{error.title}</h1>
            <p className="mt-2 text-slate-500">{error.detail}</p>
            {bookingId && (
              <p className="mt-3 font-mono text-sm font-bold tracking-tight text-slate-700">
                {bookingId}
              </p>
            )}
            <Link
              to="/"
              className="mt-6 inline-flex h-12 items-center rounded-xl bg-blue-600 px-8 font-bold text-white shadow-md shadow-blue-200 transition-colors hover:bg-blue-700"
            >
              Back to search
            </Link>
          </div>
        )}

        {!isLoading && !error && isSettling && (
          <div className="rounded-2xl bg-white p-8 text-center shadow-xl">
            <Clock className="mx-auto h-12 w-12 text-amber-500" />
            <h1 className="mt-4 text-2xl font-bold text-slate-800">
              Your payment is still settling
            </h1>
            <p className="mt-2 text-slate-500">
              This usually takes a few seconds. Your card may already have been charged — refresh
              this page shortly, and your confirmation email will arrive either way.
            </p>
            <Link
              to="/"
              className="mt-6 inline-flex h-12 items-center rounded-xl bg-blue-600 px-8 font-bold text-white shadow-md shadow-blue-200 transition-colors hover:bg-blue-700"
            >
              Back to search
            </Link>
          </div>
        )}

        {!isLoading && booking && (
          <>
            <header className="mb-8 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/15 ring-1 ring-blue-400/30">
                <CheckCircle2 className="h-9 w-9 text-blue-400" />
              </div>

              <h1 className="mt-5 text-4xl font-extrabold tracking-tighter text-white md:text-5xl">
                You're all{' '}
                <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                  booked.
                </span>
              </h1>

              <p className="mt-3 text-slate-300">
                A confirmation has been sent to{' '}
                <span className="font-semibold text-white">{booking.guest.email}</span>
              </p>
            </header>

            <div className="rounded-2xl bg-white p-6 shadow-xl md:p-8">
              <div className="flex flex-col items-start justify-between gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center">
                <div>
                  <p className="text-xs font-bold tracking-wider text-slate-500 uppercase">
                    Booking ID
                  </p>
                  <p className="mt-1 font-mono text-2xl font-extrabold tracking-tight text-slate-900">
                    {booking.id}
                  </p>
                </div>
                {/* No status column exists: this row could not have been written
                    unless the charge cleared, so the badge is a statement of
                    fact rather than a value read off the record. */}
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">
                  PAID
                </span>
              </div>

              <div className="grid gap-6 pt-5 sm:grid-cols-2">
                <section className="space-y-3">
                  <h2 className="text-xs font-bold tracking-wider text-slate-500 uppercase">
                    Your stay
                  </h2>
                  <p className="flex items-center gap-2 text-sm text-slate-700">
                    <MapPin className="h-4 w-4 text-blue-600" />
                    {booking.hotelName}
                  </p>
                  <p className="flex items-center gap-2 text-sm text-slate-700">
                    <BedDouble className="h-4 w-4 text-blue-600" />
                    {booking.roomTypes.join(' · ')}
                  </p>
                  <p className="flex items-center gap-2 text-sm text-slate-700">
                    <Calendar className="h-4 w-4 text-blue-600" />
                    {booking.startDate} → {booking.endDate} · {booking.nights} night
                    {booking.nights > 1 ? 's' : ''}
                  </p>
                  <p className="flex items-center gap-2 text-sm text-slate-700">
                    <Users className="h-4 w-4 text-blue-600" />
                    {formatOccupancy(booking.adults, booking.children)}
                  </p>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xs font-bold tracking-wider text-slate-500 uppercase">
                    Guest
                  </h2>
                  <p className="flex items-center gap-2 text-sm text-slate-700">
                    <User className="h-4 w-4 text-blue-600" />
                    {booking.guest.salutation} {booking.guest.firstName} {booking.guest.lastName}
                  </p>
                  <p className="flex items-center gap-2 text-sm text-slate-700">
                    <Mail className="h-4 w-4 text-blue-600" />
                    {booking.guest.email}
                  </p>
                  <p className="flex items-center gap-2 text-sm text-slate-700">
                    <Phone className="h-4 w-4 text-blue-600" />
                    {booking.guest.phone}
                  </p>
                  {booking.specialRequests && (
                    <p className="flex items-start gap-2 text-sm text-slate-700">
                      <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                      {booking.specialRequests}
                    </p>
                  )}
                </section>
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-5">
                <div>
                  <span className="text-sm font-semibold text-slate-500">Total paid</span>
                  <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                    <CreditCard className="h-4 w-4 text-blue-600" />
                    {formatCard(booking.card)}
                  </p>
                </div>
                <span className="text-2xl font-extrabold text-slate-900">
                  {formatMoney(booking.pricePaid)}
                </span>
              </div>
            </div>

            <div className="mt-6 flex justify-center">
              <Link
                to="/"
                className="inline-flex h-12 items-center rounded-xl bg-white px-8 font-bold text-slate-900 shadow-sm transition-colors hover:bg-slate-100"
              >
                Book another stay
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
