import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { User } from '@supabase/supabase-js';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
}

export default function ProfileModal({ isOpen, onClose, user }: ProfileModalProps) {
  const [activeTab, setActiveTab] = useState<'details' | 'bookings'>('details');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  if (!isOpen || !user) return null;

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setIsUpdating(true);

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      setMessage({ text: error.message, type: 'error' });
    } else {
      setMessage({ text: 'Password updated successfully!', type: 'success' });
      setNewPassword('');
    }
    setIsUpdating(false);
  };

  // Placeholder booking history
  const dummyBookings = [
    { id: '1', hotel: 'Skyline Luxury Suites', dates: 'Aug 12 - Aug 15, 2026', status: 'Confirmed', price: '$850' },
    { id: '2', hotel: 'Grand Ocean Resort & Spa', dates: 'Sep 01 - Sep 04, 2026', status: 'Completed', price: '$1,200' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
      {/* Modal Box */}
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        
        {/* Header & Tabs */}
        <div className="border-b border-slate-800 p-6 pb-0 bg-slate-900/50">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-white">My Profile</h2>
            <button 
              onClick={onClose}
              className="text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>

          {/* Tab Navigation Buttons */}
          <div className="flex gap-6 border-b border-slate-800">
            <button
              onClick={() => { setActiveTab('details'); setMessage(null); }}
              className={`pb-3 text-sm font-semibold transition-colors relative cursor-pointer ${
                activeTab === 'details' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Account Details
            </button>
            <button
              onClick={() => { setActiveTab('bookings'); setMessage(null); }}
              className={`pb-3 text-sm font-semibold transition-colors relative cursor-pointer ${
                activeTab === 'bookings' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Booking History
            </button>
          </div>
        </div>

        {/* Tab Body Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          
          {/* TAB 1: ACCOUNT DETAILS */}
          {activeTab === 'details' && (
            <div className="space-y-6">
              {/* Read-Only Info */}
              <div className="space-y-4 bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                <div>
                  <label className="text-xs text-slate-400 uppercase font-semibold tracking-wider">Email Address</label>
                  <p className="text-white font-medium mt-1">{user.email}</p>
                </div>
                <div>
                  <label className="text-xs text-slate-400 uppercase font-semibold tracking-wider">Account ID</label>
                  <p className="text-slate-400 text-xs font-mono mt-1 select-all">{user.id}</p>
                </div>
              </div>

              {/* Change Password Form */}
              <form onSubmit={handlePasswordUpdate} className="space-y-4 pt-2">
                <h3 className="text-sm font-semibold text-white">Change Password</h3>
                <input
                  type="password"
                  placeholder="Enter new password (min. 6 chars)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                  minLength={6}
                />

                {message && (
                  <div className={`text-sm p-3 rounded-lg text-center border ${
                    message.type === 'error' 
                      ? 'bg-red-500/10 border-red-500/20 text-red-400' 
                      : 'bg-green-500/10 border-green-500/20 text-green-400'
                  }`}>
                    {message.text}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isUpdating || !newPassword}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm transition-colors cursor-pointer"
                >
                  {isUpdating ? 'Updating...' : 'Update Password'}
                </button>
              </form>
            </div>
          )}

          {/* TAB 2: BOOKING HISTORY */}
          {activeTab === 'bookings' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-400">Your Recent Trips</h3>
              
              {dummyBookings.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-8">No bookings found yet. Time to plan an escape!</p>
              ) : (
                <div className="space-y-3">
                  {dummyBookings.map((booking) => (
                    <div key={booking.id} className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex justify-between items-center hover:border-slate-700 transition-colors">
                      <div>
                        <h4 className="text-white font-medium text-sm">{booking.hotel}</h4>
                        <p className="text-slate-400 text-xs mt-0.5">{booking.dates}</p>
                        <span className={`inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                          booking.status === 'Confirmed' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'
                        }`}>
                          {booking.status}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-white font-bold text-sm">{booking.price}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}