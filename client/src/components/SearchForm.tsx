import { useState } from 'react';
import { useNavigate } from 'react-router';
import axios from 'axios';
import { MapPin, Calendar, Users, Search } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

export default function SearchForm() {
    const navigate = useNavigate();

    // State Memory: Tracking what the user types and selects
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedDestId, setSelectedDestId] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [suggestions, setSuggestions] = useState<Array<{ uid: string; term: string }>>([]);
    const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const [checkIn, setCheckIn] = useState('');
    const [checkOut, setCheckOut] = useState('');
    const [guests, setGuests] = useState(2);
    const [rooms, setRooms] = useState(1);

    // Calculate the minimum check-in date (3 days from now)
    const getMinCheckInDate = () => {
        const date = new Date();
        date.setDate(date.getDate() + 3);
        return date.toISOString().split('T')[0]; // YYYY-MM-DD format
    };

    // Form validation & submission
    const handleSearch: React.SubmitEventHandler<HTMLFormElement> = (event) => {
        event.preventDefault(); // Stops the browser from refreshing the page

        if (!selectedDestId) {
            alert("Please select a valid destination from the dropdown!");
            return;
        }
        if (!checkIn || !checkOut) {
            alert("Please select your travel dates.");
            return;
        }
        if (new Date(checkIn) >= new Date(checkOut)) {
            alert("Check-out date must be after Check-in date.");
            return;
        }

        // Ensure check-in is at least 3 days from today
        const minDate = new Date();
        minDate.setDate(minDate.getDate() + 3);
        minDate.setHours(0, 0, 0, 0);

        const checkInDate = new Date(checkIn);
        checkInDate.setHours(0, 0, 0, 0);

        if (checkInDate < minDate) {
            alert("Check-in date must be at least 3 days from today.");
            return;
        }

        // Redirect to results page and pass the data in the URL
        navigate(`/results?dest=${selectedDestId}&name=${encodeURIComponent(searchTerm)}&in=${checkIn}&out=${checkOut}&guests=${guests}&rooms=${rooms}`);
    };

    return (
        <form 
            onSubmit={handleSearch}
            className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-2 rounded-2xl bg-white p-4 shadow-xl md:flex-row md:items-center md:gap-4"
        >
            {/* Destination Input with Dropdown */}
            <div className="relative flex flex-1 flex-col">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Where</label>
                <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 hover:bg-slate-100 focus-within:ring-2 focus-within:ring-blue-500">
                    <MapPin className="text-blue-600 h-5 w-5" />
                    <input
                        type="text"
                        placeholder="Search destinations..."
                        className="w-full bg-transparent outline-none placeholder:text-slate-400"
                        value={searchTerm}
                        onChange={(e) => {
                            const text = e.target.value;
                            setSearchTerm(text);
                            setSelectedDestId(''); // Reset ID if they start typing again
                            
                            // Clear any pending timer
                            if (debounceTimer) clearTimeout(debounceTimer);
                            
                            // Don't search if less than 2 characters
                            if (text.trim().length < 2) {
                                setSuggestions([]);
                                setShowSuggestions(false);
                                return;
                            }
                            
                            // Set a new timer (300ms delay)
                            const timer = setTimeout(async () => {
                                setIsLoading(true);
                                try {
                                    const response = await axios.get(`${API_URL}/api/destinations/search?q=${text}`);
                                    setSuggestions(response.data);
                                    setShowSuggestions(true);
                                } catch (error) {
                                    console.error('Search error:', error);
                                    setSuggestions([]);
                                } finally {
                                    setIsLoading(false);
                                }
                            }, 300);
                            
                            setDebounceTimer(timer);
                        }}
                        onFocus={() => setShowSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)} // Delay hides dropdown so clicks register
                    />

                    {isLoading && (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    )}
                </div>

                {/* The Autocomplete Dropdown Box */}
                {showSuggestions && suggestions.length > 0 && (
                    <ul className="absolute top-[70px] left-0 z-50 w-full rounded-xl border border-slate-100 bg-white shadow-2xl overflow-hidden">
                        {suggestions.map((dest) => (
                            <li
                                key={dest.uid}
                                className="cursor-pointer px-4 py-3 hover:bg-blue-50 text-slate-700 hover:text-blue-700"
                                onClick={() => {
                                    setSearchTerm(dest.term);
                                    setSelectedDestId(dest.uid);
                                    setShowSuggestions(false);
                                }}
                            >
                                {dest.term}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Dates Input */}
            <div className="flex flex-col border-t border-slate-100 pt-2 md:border-t-0 md:border-l md:pt-0 md:pl-4">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Dates</label>
                <div className="flex items-center gap-2">
                    <Calendar className="text-blue-600 h-5 w-5" />
                    <input 
                        type="date" 
                        className="bg-transparent outline-none text-sm text-slate-700 cursor-pointer"
                        value={checkIn}
                        min={getMinCheckInDate()}
                        onChange={(e) => setCheckIn(e.target.value)}
                    />
                    <span className="text-slate-300">-</span>
                    <input 
                        type="date" 
                        className="bg-transparent outline-none text-sm text-slate-700 cursor-pointer"
                        value={checkOut}
                        onChange={(e) => setCheckOut(e.target.value)}
                    />
                </div>
            </div>

            {/* Guests & Rooms Input */}
            <div className="flex flex-col border-t border-slate-100 pt-2 md:border-t-0 md:border-l md:pt-0 md:pl-4">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Who</label>
                <div className="flex items-center gap-3">
                    <Users className="text-blue-600 h-5 w-5" />
                    <select 
                        className="bg-transparent outline-none text-sm text-slate-700 cursor-pointer"
                        value={guests}
                        onChange={(e) => setGuests(Number(e.target.value))}
                    >
                        {[1,2,3,4,5,6].map(num => <option key={num} value={num}>{num} Guests</option>)}
                    </select>
                    <select 
                        className="bg-transparent outline-none text-sm text-slate-700 cursor-pointer"
                        value={rooms}
                        onChange={(e) => setRooms(Number(e.target.value))}
                    >
                        {[1,2,3,4].map(num => <option key={num} value={num}>{num} Rooms</option>)}
                    </select>
                </div>
            </div>

            {/* Submit Button */}
            <button 
                type="submit"
                className="mt-4 flex h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-8 font-bold text-white shadow-md shadow-blue-200 transition-colors hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 md:mt-0"
            >
                <Search className="h-5 w-5" />
                Search
            </button>
        </form>
    )
}