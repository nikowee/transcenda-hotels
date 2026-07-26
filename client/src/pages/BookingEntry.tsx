import { Navigate, useSearchParams, Link } from 'react-router';
import { AlertCircle } from 'lucide-react';

/**
 * `/booking` — the seam between hotel details and UC4.
 *
 * RoomList (Feature 3) navigates here when a guest picks a room, and it speaks a
 * different dialect from checkout:
 *
 *     RoomList sends   /booking?hotel&dest&in&out&guests&key
 *     Checkout wants   /checkout?hotelId&destinationId&startDate&endDate
 *                                &adults&children&roomTypes
 *
 * Translating in one component rather than teaching CheckoutPage a second set of
 * parameter names keeps the query contract of the booking flow single, and keeps
 * this adapter deletable the day the two agree.
 *
 * `hotelName` is deliberately not forwarded: RoomList does not have it, and the
 * server resolves it from the supplier when it is absent. Nothing priced is
 * forwarded either — /checkout re-quotes from the supplier regardless.
 */
export default function BookingEntry() {
  const [params] = useSearchParams();

  const hotelId = params.get('hotel')?.trim() ?? '';
  const destinationId = params.get('dest')?.trim() ?? '';
  const startDate = params.get('in')?.trim() ?? '';
  const endDate = params.get('out')?.trim() ?? '';
  const roomKey = params.get('key')?.trim() ?? '';

  /**
   * Search collects a single head-count and a room count; it has no separate
   * children field, so every guest is an adult until one exists. Ascenda's
   * pipe-per-room spelling ("2|2") can also reach us, and the total is what
   * checkout wants.
   */
  const guestsRaw = params.get('guests')?.trim() ?? '';
  const adults = guestsRaw
    .split('|')
    .map((part) => Number.parseInt(part, 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .reduce((sum, n) => sum + n, 0);

  const missing = [
    !hotelId && 'hotel',
    !destinationId && 'dest',
    !startDate && 'in',
    !endDate && 'out',
    !roomKey && 'key',
    !adults && 'guests',
  ].filter(Boolean) as string[];

  if (missing.length > 0) {
    /**
     * Named rather than swallowed. `dest` is the one that actually goes missing:
     * ResultsPage links to /hotel/:id without it, so HotelDetailsPage reads a
     * null destination and RoomList forwards the empty string. Without this the
     * guest would land on a checkout page that just says the stay is invalid,
     * and the real cause is two navigations upstream.
     */
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-xl">
          <AlertCircle className="mx-auto h-12 w-12 text-amber-500" />
          <h1 className="mt-4 text-xl font-bold text-slate-800">
            That room selection is incomplete
          </h1>
          <p className="mt-2 text-slate-500">
            The link is missing <code className="rounded bg-slate-100 px-1">{missing.join(', ')}</code>,
            so we cannot price the stay. Please pick the room again from the hotel page.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex h-12 items-center rounded-xl bg-blue-600 px-8 font-bold text-white transition-colors hover:bg-blue-700"
          >
            Start a new search
          </Link>
        </div>
      </div>
    );
  }

  const checkout = new URLSearchParams({
    destinationId,
    hotelId,
    roomTypes: roomKey,
    startDate,
    endDate,
    adults: String(adults),
    children: '0',
  });

  return <Navigate to={`/checkout?${checkout.toString()}`} replace />;
}
