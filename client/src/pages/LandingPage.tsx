import { useState } from 'react';
import SearchForm from '../components/SearchForm';
import ProfileModal from '../components/ProfileModal';
import Navbar from '../components/Navbar';
import { useAuth } from '../hooks/useAuth';

export default function LandingPage() {
  const { user } = useAuth();
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  return (
    <div className="relative min-h-screen w-full bg-brand-surface flex flex-col items-center justify-center pt-20 pb-32 px-4 sm:px-6 lg:px-8">
      
      {/* Background Gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/40 via-slate-900 to-black z-0"></div>

      {/* Modular Navigation Bar */}
      <Navbar />

      {/* Hero Content */}
      <div className="relative z-10 w-full max-w-4xl text-center space-y-8 mt-10">
        <div className="space-y-4">
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter text-white drop-shadow-sm">
            Find your next <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300">escape.</span>
          </h1>
          <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto">
            Book premium stays at exclusive rates. Earn rewards on every night.
          </p>
        </div>

        <div className="pt-8">
          <SearchForm />
        </div>
      </div>

      {/* Modal Component */}
      <ProfileModal 
        isOpen={isProfileOpen} 
        onClose={() => setIsProfileOpen(false)} 
        user={user} 
      />

    </div>
  );
}