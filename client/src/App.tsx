import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router';
import LandingPage from './pages/LandingPage';
import CheckoutPage from './pages/CheckoutPage';
import ConfirmationPage from './pages/ConfirmationPage';

/**
 * Results are still a placeholder, but UC4 is triggered from here ("User clicks
 * Book Now"), so the search params are forwarded straight through to checkout.
 */
function ResultsPlaceholder() {
  const { search } = useLocation();

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="animate-bounce">
          <div className="h-16 w-16 bg-blue-100 rounded-full mx-auto flex items-center justify-center">
            <span className="text-3xl">🏨</span>
          </div>
        </div>
        <h1 className="text-3xl font-bold text-slate-700">Finding your perfect stay...</h1>
        <p className="text-slate-400">Results page coming soon!</p>
        <Link
          to={`/checkout${search}`}
          className="inline-flex h-12 items-center rounded-xl bg-blue-600 px-8 font-bold text-white shadow-md shadow-blue-200 transition-colors hover:bg-blue-700 focus:ring-4 focus:ring-blue-300"
        >
          Book Now
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/results" element={<ResultsPlaceholder />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/confirmation" element={<ConfirmationPage />} />
      </Routes>
    </BrowserRouter>
  );
}