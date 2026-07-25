import { useState } from 'react';
import { useNavigate } from 'react-router';
import axios from 'axios';
import { Loader2, Shuffle } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

interface DemoStayResponse {
  stay: {
    destination: string;
    hotelName: string;
    roomLabels: string[];
    nights?: number;
    indicativeTotal: number;
    currency: string;
  };
  /** Ready-made query string for /checkout — the server owns that spelling. */
  checkoutQuery: string;
}

/**
 * Drops the visitor into checkout with a real hotel, real room and real dates,
 * chosen at random by the server.
 *
 * The point of a demo is to show the supplier integration doing something, and a
 * hardcoded link to one fixed hotel shows the opposite — you cannot tell a live
 * price from a constant by looking at it. Every press picks a different city,
 * hotel, room, party and set of dates, priced by Ascenda at whatever it costs
 * today.
 *
 * The stay comes back with an indicative total, which is deliberately not passed
 * on to checkout. The server reprices from its own supplier call there; this
 * component could not influence the amount if it tried.
 */
export default function DemoStayButton() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const pickStay = async () => {
    setIsLoading(true);
    setError('');

    try {
      const { data } = await axios.get<DemoStayResponse>(`${API_URL}/api/bookings/demo-stay`);
      navigate(`/checkout?${data.checkoutQuery}`);
    } catch (requestError) {
      setError(
        axios.isAxiosError(requestError)
          ? (requestError.response?.data?.error ?? 'Could not find a stay to demo.')
          : 'Could not reach the booking service.'
      );
      // Only on failure. On success the component unmounts with the navigation,
      // and setting state on the way out logs a warning for no benefit.
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={pickStay}
        disabled={isLoading}
        className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-slate-200 backdrop-blur transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Finding a stay…
          </>
        ) : (
          <>
            <Shuffle className="h-4 w-4 text-blue-400" />
            Surprise me with a stay
          </>
        )}
      </button>

      {error && (
        <p role="alert" className="text-sm text-amber-300">
          {error}
        </p>
      )}
    </div>
  );
}
