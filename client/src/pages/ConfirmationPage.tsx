import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import axios from 'axios';
import {
  AlertCircle,
  BedDouble,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  MapPin,
  Phone,
  User,
} from 'lucide-react';
import type { BookingRecord } from '../types/booking';

const API_URL = import.meta.env.VITE_API_URL;

/**
 * ConfirmationPage — sequence step 11, and the "Display Booking Confirmation"
 * use case. Replaces confirmation.ejs.
 *
 * Reached by redirect back from Stripe, so router state does not survive the
 * trip and everything is re-fetched. Payment status is only ever read from the
 * server, which in turn reads it from Stripe — nothing here decides whether a
 * booking is paid.
 *
 * If the webhook has not landed yet the booking is briefly PENDING, so this
 * polls a few times before settling.
 */

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 5;

const formatMoney = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ConfirmationPage() {
  const [searchParams] = useSearchParams();
  const [booking, setBooking] = useState<BookingRecord | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const reference = searchParams.get('ref');
  const sessionId = searchParams.get('session_id');
  const hasRun = useRef(false);

  useEffect(() => {
    // StrictMode double-mounts in dev; confirming twice is harmless server-side
    // but there is no reason to do it.
    if (hasRun.current) return;
    hasRun.current = true;

    let cancelled = false;

    const finalise = async () => {
      if (!reference) {
        setError('No booking reference was provided.');
        setIsLoading(false);
        return;
      }

      // Sequence steps 6-10: verify the completed session server-side. The
      // webhook does the same independently, whichever arrives first wins.
      if (sessionId) {
        try {
          await axios.post(`${API_URL}/api/bookings/confirm`, {
            sessionId,
            bookingReference: reference,
          });
        } catch {
          // Non-fatal: the webhook is the authoritative path. Fall through and
          // read whatever state the booking is actually in.
        }
      }

      for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
        if (cancelled) return;

        try {
          const response = await axios.get<BookingRecord>(
            `${API_URL}/api/bookings/${reference}`
          );
          if (cancelled) return;

          setBooking(response.data);
          setIsLoading(false);

          if (response.data.paymentStatus !== 'PENDING') return;
        } catch {
          if (cancelled) return;
          setError('We could not find that booking reference.');
          setIsLoading(false);
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    };

    finalise();
    return () => {
      cancelled = true;
    };
  }, [reference, sessionId]);

  const isPending = booking?.paymentStatus === 'PENDING';
  const isFailed = booking?.paymentStatus === 'FAILED';

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
            <h1 className="mt-4 text-2xl font-bold text-slate-800">Booking not found</h1>
            <p className="mt-2 text-slate-500">{error}</p>
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
              <div
                className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ring-1 ${
                  isFailed
                    ? 'bg-red-500/15 ring-red-400/30'
                    : isPending
                      ? 'bg-amber-500/15 ring-amber-400/30'
                      : 'bg-blue-500/15 ring-blue-400/30'
                }`}
              >
                {isFailed ? (
                  <AlertCircle className="h-9 w-9 text-red-400" />
                ) : isPending ? (
                  <Clock className="h-9 w-9 text-amber-400" />
                ) : (
                  <CheckCircle2 className="h-9 w-9 text-blue-400" />
                )}
              </div>

              <h1 className="mt-5 text-4xl font-extrabold tracking-tighter text-white md:text-5xl">
                {isFailed ? (
                  <>Payment didn't go through.</>
                ) : isPending ? (
                  <>Confirming your payment…</>
                ) : (
                  <>
                    You're all{' '}
                    <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                      booked.
                    </span>
                  </>
                )}
              </h1>

              <p className="mt-3 text-slate-300">
                {isFailed ? (
                  <>Nothing was charged. You can try booking again at any time.</>
                ) : isPending ? (
                  <>
                    This usually takes a few seconds. Your reference is safe to keep — refresh this
                    page if it doesn't update.
                  </>
                ) : (
                  <>
                    A confirmation has been sent to{' '}
                    <span className="font-semibold text-white">{booking.guestEmail}</span>
                  </>
                )}
              </p>
            </header>

            <div className="rounded-2xl bg-white p-6 shadow-xl md:p-8">
              <div className="flex flex-col items-start justify-between gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center">
                <div>
                  <p className="text-xs font-bold tracking-wider text-slate-500 uppercase">
                    Booking reference
                  </p>
                  <p className="mt-1 font-mono text-2xl font-extrabold tracking-tight text-slate-900">
                    {booking.bookingReference}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${
                    isFailed
                      ? 'bg-red-50 text-red-700 ring-red-200'
                      : isPending
                        ? 'bg-amber-50 text-amber-700 ring-amber-200'
                        : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                  }`}
                >
                  {booking.paymentStatus}
                </span>
              </div>

              <div className="grid gap-6 pt-5 sm:grid-cols-2">
                <section className="space-y-3">
                  <h2 className="text-xs font-bold tracking-wider text-slate-500 uppercase">
                    Your stay
                  </h2>
                  <p className="flex items-center gap-2 text-sm text-slate-700">
                    <MapPin className="h-4 w-4 text-blue-600" />
                    {booking.hotelId}
                  </p>
                  <p className="flex items-center gap-2 text-sm text-slate-700">
                    <BedDouble className="h-4 w-4 text-blue-600" />
                    {booking.roomId}
                  </p>
                  <p className="flex items-center gap-2 text-sm text-slate-700">
                    <Calendar className="h-4 w-4 text-blue-600" />
                    {booking.checkIn} → {booking.checkOut}
                  </p>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xs font-bold tracking-wider text-slate-500 uppercase">
                    Guest
                  </h2>
                  <p className="flex items-center gap-2 text-sm text-slate-700">
                    <User className="h-4 w-4 text-blue-600" />
                    {booking.guestName}
                  </p>
                  <p className="flex items-center gap-2 text-sm text-slate-700">
                    <Mail className="h-4 w-4 text-blue-600" />
                    {booking.guestEmail}
                  </p>
                  <p className="flex items-center gap-2 text-sm text-slate-700">
                    <Phone className="h-4 w-4 text-blue-600" />
                    {booking.contactNumber}
                  </p>
                </section>
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-5">
                <span className="text-sm font-semibold text-slate-500">
                  {isPending ? 'Total' : isFailed ? 'Amount' : 'Total paid'}
                </span>
                <span className="text-2xl font-extrabold text-slate-900">
                  {formatMoney(booking.totalPrice, booking.currency)}
                </span>
              </div>
            </div>

            <div className="mt-6 flex justify-center">
              <Link
                to="/"
                className="inline-flex h-12 items-center rounded-xl bg-white px-8 font-bold text-slate-900 shadow-sm transition-colors hover:bg-slate-100"
              >
                {isFailed ? 'Try again' : 'Book another stay'}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
