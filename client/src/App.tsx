import { BrowserRouter, Routes, Route } from 'react-router';
import LandingPage from './pages/LandingPage';
import ResultsPage from './pages/ResultsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/results" element={<ResultsPage />} />
      </Routes>
    </BrowserRouter>
  );
}