import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import ProfileModal from './ProfileModal';
import CompactSearchBar from './CompactSearchBar';

interface NavbarProps {
  showBackButton?: boolean;
  showSearchBar?: boolean;
}

export default function Navbar({ showBackButton, showSearchBar }: NavbarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  return (
    <>
      <nav className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between p-6">
        {/* Left: Back button + Logo (stacked) */}
        <div className="flex flex-col items-start">
          <Link to="/" className="text-2xl font-extrabold tracking-tight text-white">
            Transcenda<span className="text-blue-500">.</span>
          </Link>
          {showBackButton && (
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-1 text-sm font-semibold text-white/80 hover:text-white transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          )}
        </div>

        {/* Center: Compact Search Bar */}
        {showSearchBar && (
          <div className="hidden sm:block">
            <CompactSearchBar />
          </div>
        )}

        {/* Right: Auth buttons */}
        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-3">
              {/* Profile Pill - Opens the Modal */}
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

              {/* Logout Button */}
              <button 
                onClick={logout}
                className="text-sm font-semibold bg-transparent hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white px-5 py-2 rounded-full transition-colors cursor-pointer"
              >
                Log Out
              </button>
            </div>
          ) : (
            <>
              <Link 
                to="/login" 
                className="text-sm font-semibold bg-transparent hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white px-5 py-2 rounded-full transition-colors cursor-pointer"
              >
                Log In
              </Link>
              <Link 
                to="/signup" 
                className="text-sm font-semibold bg-white text-slate-900 px-4 py-2 rounded-full hover:bg-slate-100 transition-colors shadow-sm"
              >
                Sign Up
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* Profile Modal Component */}
      <ProfileModal 
        isOpen={isProfileOpen} 
        onClose={() => setIsProfileOpen(false)} 
        user={user} 
      />
    </>
  );
}