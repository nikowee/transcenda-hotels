import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import SearchForm from '../components/SearchForm';
import ProfileModal from '../components/ProfileModal';
import { supabase } from '../lib/supabaseClient';
import type { User } from '@supabase/supabase-js';

export default function LandingPage() {
  const [user, setUser] = useState<User | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false); // 2. Add state for the modal

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="relative min-h-screen w-full bg-slate-900 flex flex-col items-center justify-center pt-20 pb-32 px-4 sm:px-6 lg:px-8">
      
      {/* Background Gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/40 via-slate-900 to-black z-0"></div>

      {/* Navigation Bar */}
      <nav className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between p-6">
        <div className="text-2xl font-extrabold text-white tracking-tight">
          Transcenda<span className="text-blue-500">.</span>
        </div>
        
        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-3">
              {/* 3. Make the Profile Pill Clickable to Open the Modal! */}
              <div 
                onClick={() => setIsProfileOpen(true)}
                className="flex items-center gap-3 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 hover:border-slate-500 backdrop-blur-sm rounded-full pl-3 pr-4 py-1.5 shadow-sm cursor-pointer transition-all group"
              >
                <div className="w-7 h-7 bg-blue-600 group-hover:bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold uppercase transition-colors">
                  {user.email ? user.email[0] : 'U'}
                </div>
                
                <span className="text-sm font-medium text-slate-200 group-hover:text-white max-w-[160px] sm:max-w-[200px] truncate transition-colors">
                  {user.email}
                </span>
              </div>

              {/* Keep Logout Button separate so they can still log out quickly */}
              <button 
                onClick={handleLogout}
                className="text-sm font-semibold bg-transparent hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white px-5 py-2 rounded-full transition-colors cursor-pointer"
              >
                Log Out
              </button>
            </div>
          ) : (
            <>
              <Link to="/login" className="text-sm font-semibold bg-transparent hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white px-5 py-2 rounded-full transition-colors cursor-pointer">
                Log In
              </Link>
              <Link to="/signup" className="text-sm font-semibold bg-white text-slate-900 px-4 py-2 rounded-full hover:bg-slate-100 transition-colors shadow-sm">
                Sign Up
              </Link>
            </>
          )}
        </div>
      </nav>

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

      {/* 4. Render the Modal Component at the bottom! */}
      <ProfileModal 
        isOpen={isProfileOpen} 
        onClose={() => setIsProfileOpen(false)} 
        user={user} 
      />

    </div>
  );
}