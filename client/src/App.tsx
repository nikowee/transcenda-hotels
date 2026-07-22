import { BrowserRouter, Routes, Route } from 'react-router';
import LandingPage from './pages/LandingPage';
import DestinationResultsPage from './pages/DestinationResultsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/results" element={<DestinationResultsPage />} />
      </Routes>
    </BrowserRouter>
  );
}