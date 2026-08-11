import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router';
import LandingPage from './pages/LandingPage';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ResultsPage from './pages/ResultsPage';
import HotelDetailPage from './pages/HotelDetailsPage';
import BookingEntry from './pages/BookingEntry';
import CheckoutPage from './pages/CheckoutPage';
import PaymentPage from './pages/PaymentPage';
import ConfirmationPage from './pages/ConfirmationPage';
import WelcomeBird from './components/WelcomeBird';

/**
 * The whole journey, in the order a guest walks it:
 *
 *   /  →  /results  →  /hotel/:id  →  /booking  →  /checkout  →  /payment
 *                                                             →  /confirmation
 *
 * /booking is a connector page and not diretly navigable to.
 */
export default function App() {
  const [showSplash, setShowSplash] = useState(() => {
    return !sessionStorage.getItem('hasSeenBird');
  });

  const handleBirdComplete = () => {
    sessionStorage.setItem('hasSeenBird', 'true');
    setShowSplash(false);
  };

  return (
    <>
      {/* 1. Render the splash screen OVER the app if it's active */}
      {showSplash && <WelcomeBird onComplete={handleBirdComplete} />}

      {/* 2. Render the actual app underneath so it can be blurred */}
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />

        {/* Auth */}
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        {/* Search and hotel details */}
        <Route path="/results" element={<ResultsPage />} />
        <Route path="/hotel/:id" element={<HotelDetailPage />} />

        {/* Book & Make Payment */}
        <Route path="/booking" element={<BookingEntry />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/payment" element={<PaymentPage />} />
        <Route path="/confirmation" element={<ConfirmationPage />} />
      </Routes>
    </BrowserRouter>
    </>
  );
}
