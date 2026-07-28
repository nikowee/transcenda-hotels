import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router';
import LandingPage from './pages/LandingPage';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ResultsPage from './pages/ResultsPage';
import WelcomeBird from './components/WelcomeBird';

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
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/results" element={<ResultsPage />} />
        </Routes>
      </BrowserRouter>
    </>
  );
}