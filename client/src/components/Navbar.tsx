import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { supabase } from '../lib/supabaseClient';
import type { User } from '@supabase/supabase-js';

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null);
  const navigate = useNavigate();

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
    navigate('/login');
  };

  return (
    <nav className="w-full bg-slate-900 border-b border-slate-800 px-6 py-4 flex justify-between items-center">
      {/* Left side: Brand / Logo */}
      <Link to="/" className="text-xl font-bold text-white tracking-wide">
        Transcenda<span className="text-blue-500">.</span>
      </Link>

      {/* Right side: Profile / Auth Actions */}
      <div className="flex items-center space-x-4">
        {user ? (
          // IF LOGGED IN: Show Avatar Circle, Email, and Logout Button
          <div className="flex items-center space-x-3 bg-slate-800/60 border border-slate-700/50 rounded-full pl-3 pr-2 py-1.5">
            <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold uppercase">
              {/* Displays the first letter of their email as an avatar badge */}
              {user.email ? user.email[0] : 'U'}
            </div>
            
            <span className="text-sm font-medium text-slate-300 max-w-[150px] truncate">
              {user.email}
            </span>

            <button 
              onClick={handleLogout}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2.5 py-1 rounded-full transition-colors"
            >
              Log out
            </button>
          </div>
        ) : (
          
          <div className="flex items-center space-x-4">
            <Link 
              to="/login" 
              className="text-sm font-medium text-slate-300 hover:text-white transition-colors"
            >
              Log in
            </Link>
            <Link 
              to="/signup" 
              className="text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Sign up
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}