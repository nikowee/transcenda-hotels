import { BrowserRouter, Routes, Route } from 'react-router';
import LandingPage from './pages/LandingPage';
import HotelDetailPage from './pages/HotelDetailsPage';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ResultsPage from './pages/ResultsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />

        {/* Auth Routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        
        {/* Results Route */}
        <Route path="/results" element={<ResultsPage />} />

        {/* Hotel Details Route */}
        <Route path="/hotel/:id" element={<HotelDetailPage />} />
      </Routes>
    </BrowserRouter>
  );
}