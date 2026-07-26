import { BrowserRouter, Routes, Route } from 'react-router';
import LandingPage from './pages/LandingPage';
import BookingEntry from './pages/BookingEntry';
import CheckoutPage from './pages/CheckoutPage';
import PaymentPage from './pages/PaymentPage';
import ConfirmationPage from './pages/ConfirmationPage';

/**
 * UC4 owns /booking, /checkout, /payment and /confirmation.
 *
 * /results and /hotel/:id belong to Features 2 and 3 and arrive with their
 * branches — the placeholder that used to stand in for /results has been removed
 * now that the real page exists. /booking is the seam RoomList navigates to.
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/booking" element={<BookingEntry />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/payment" element={<PaymentPage />} />
        <Route path="/confirmation" element={<ConfirmationPage />} />
      </Routes>
    </BrowserRouter>
  );
}
