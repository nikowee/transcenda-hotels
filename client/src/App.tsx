import { BrowserRouter, Routes, Route } from 'react-router';
import LandingPage from './pages/LandingPage';
import DestinationResultsPage from './pages/DestinationResultsPage';
import HotelDetailPage from './components/HotelDetailsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/results" element={<DestinationResultsPage />} />
        <Route path="/hotel/:id" element={<HotelDetailPage />} />
      </Routes>
    </BrowserRouter>
  );
}