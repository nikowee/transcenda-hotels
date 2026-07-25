import { BrowserRouter, Routes, Route } from 'react-router';
import LandingPage from './pages/LandingPage';
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
        <Route path="/results" element={<ResultsPage />} />

        <Route path="/results" element={
          <div className="min-h-screen bg-slate-50 flex items-center justify-center">
            <div className="text-center space-y-4">
              <div className="animate-bounce">
                <div className="h-16 w-16 bg-blue-100 rounded-full mx-auto flex items-center justify-center">
                  <span className="text-3xl">🏨</span>
                </div>
              </div>
              <h1 className="text-3xl font-bold text-slate-700">Finding your perfect stay...</h1>
              <p className="text-slate-400">Results page coming soon!</p>
            </div>
          </div>
        }/>
      </Routes>
    </BrowserRouter>
  );
}