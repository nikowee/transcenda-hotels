import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { supabase } from '../lib/supabaseClient';
import { authHeader } from '../lib/authHeader';
import type { BookingRecord } from '../types/booking';
import type { User } from '@supabase/supabase-js';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

/** "12 Aug 2026 – 15 Aug 2026", from the two ISO dates the record carries. */
const formatStay = (startDate: string, endDate: string): string => {
  const format = (value: string) =>
    new Date(value).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  return `${format(startDate)} – ${format(endDate)}`;
};

/** Past or upcoming, decided from the checkout date. */
const stayStatus = (endDate: string): 'Upcoming' | 'Completed' =>
  new Date(endDate) >= new Date() ? 'Upcoming' : 'Completed';

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

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [bookings, setBookings] = useState<BookingRecord[] | null>(null);
  const [bookingsError, setBookingsError] = useState<string | null>(null);

  const userId = user?.id;

  const loadBookings = useCallback(async () => {
    if (!userId) return;

    setBookingsError(null);
    setBookings(null);

    try {
      // The path names the account and the token proves entitlement to it. The
      // server 403s if they disagree, so this cannot read anyone else's history
      // even if userId were wrong.
      const response = await axios.get<{ bookings: BookingRecord[] }>(
        `${API_URL}/api/bookings/user/${userId}`,
        { headers: await authHeader() }
      );
      setBookings(response.data.bookings);
    } catch (error) {
      setBookingsError(
        axios.isAxiosError(error)
          ? (error.response?.data?.error ?? 'We could not load your bookings.')
          : 'We could not reach the booking service.'
      );
    }
  }, [userId]);

  /** Fetches on first open of the tab and again whenever it is reopened, rather than once on mount: the modal outlives a booking made in the same session, so a cached list would be missing the trip the guest just paid for. */
  useEffect(() => {
    if (isOpen && activeTab === 'bookings') void loadBookings();
  }, [isOpen, activeTab, loadBookings]);

  if (!isOpen || !user) return null;

  const handlePasswordUpdate = async (e: React.SyntheticEvent) => {
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

  const handleDeleteAccount = async (e: React.SyntheticEvent) => {
    e.preventDefault(); 
    setIsDeleting(true);
    setDeleteError(null);
  
    try {
      // 1. Verify the password by signing in
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email!,
        password: deletePassword, 
      });
  
      if (signInError) {
        setDeleteError('Incorrect password. Please try again.');
        setIsDeleting(false);
        return; 
      }

      // 2. Call your backend server route to delete the user via admin API using VITE_API_URL
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const response = await fetch(`${apiUrl}/api/users/${user.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete user account on server.');
      }
  
      // 3. Sign out locally and reload page
      await supabase.auth.signOut();
      window.location.reload();
  
    } catch (err: unknown) {
      let errorMessage = 'Error deleting account.';
      if (err instanceof Error) {
        errorMessage = err.message;
      }
      setDeleteError(errorMessage);
      setIsDeleting(false);
    }
  };

  return (
    <>
      {/* LAYER 1: Main Profile Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
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
            {activeTab === 'details' && (
              <div className="space-y-6">
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

                <div className="pt-6 mt-6 border-t border-slate-800">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-red-400">Account Deletion</h3>
                    <p className="text-xs text-slate-400">Once you delete your account, there is no going back. Please be certain.</p>
                    <button 
                      onClick={() => setIsDeleteConfirmOpen(true)}
                      className="w-full bg-transparent border border-red-500/50 hover:bg-red-500/10 text-red-400 font-semibold py-2 rounded-lg text-sm transition-colors cursor-pointer"
                    >
                      Delete Account
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'bookings' && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-slate-400">Your Recent Trips</h3>

                {bookingsError && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-lg text-center space-y-3">
                    <p>{bookingsError}</p>
                    <button
                      onClick={() => void loadBookings()}
                      className="text-xs font-semibold underline hover:no-underline cursor-pointer"
                    >
                      Try again
                    </button>
                  </div>
                )}

                {!bookingsError && bookings === null && (
                  <p className="text-slate-400 text-sm text-center py-8">Loading your bookings…</p>
                )}

                {!bookingsError && bookings?.length === 0 && (
                  <p className="text-slate-400 text-sm text-center py-8">No bookings found yet. Time to plan an escape!</p>
                )}

                {!bookingsError && bookings && bookings.length > 0 && (
                  <div className="space-y-3">
                    {bookings.map((booking) => {
                      const status = stayStatus(booking.endDate);
                      return (
                        <div key={booking.id} className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 flex justify-between items-center gap-4 hover:border-slate-700 transition-colors">
                          <div className="min-w-0">
                            <h4 className="text-white font-medium text-sm truncate">{booking.hotelName}</h4>
                            <p className="text-slate-400 text-xs mt-0.5">
                              {formatStay(booking.startDate, booking.endDate)}
                            </p>
                            <p className="text-slate-500 text-xs mt-0.5">
                              {booking.nights} {booking.nights === 1 ? 'night' : 'nights'} ·{' '}
                              {booking.roomTypes.length} {booking.roomTypes.length === 1 ? 'room' : 'rooms'}
                            </p>
                            <span className={`inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                              status === 'Upcoming' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'
                            }`}>
                              {status}
                            </span>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-white font-bold text-sm">
                              S${booking.pricePaid.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* LAYER 2: Centered Delete Confirmation Popup */}
      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
          <form onSubmit={handleDeleteAccount} className="w-full max-w-sm bg-slate-900 border border-red-500/30 p-6 rounded-2xl shadow-2xl flex flex-col gap-4">
            <div className="text-center space-y-2 mb-2">
              <h3 className="text-lg font-bold text-red-400">Are you absolutely sure?</h3>
              <p className="text-sm text-slate-400">Enter your password to confirm deletion. This action cannot be undone.</p>
            </div>
            
            <input
              type="password"
              placeholder="Enter your password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm focus:ring-2 focus:ring-red-500 outline-none"
              required
              autoFocus
            />

            {deleteError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-lg text-center">
                {deleteError}
              </div>
            )}

            <div className="flex gap-3 mt-2">
              <button
                type="button"
                onClick={() => { setIsDeleteConfirmOpen(false); setDeletePassword(''); setDeleteError(null); }}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isDeleting || !deletePassword}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors cursor-pointer"
              >
                {isDeleting ? 'Deleting...' : 'Confirm Deletion'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}