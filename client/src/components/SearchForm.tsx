import { useState, useMemo, React } from 'react';
import { useNavigate } from 'react-router';
import Fuse from 'fuse.js';
import { MapPin, Calendar, Users, Search } from 'lucide-react';
import { destinations } from '../data/mockDestinations';

export default function SearchForm(){
    const navigate = useNavigate();

    // State Memory: Tracking what the user types and selects
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedDestId, setSelectedDestId] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);

    const [checkIn, setCheckIn] = useState('');
    const [checkOut, setCheckOut] = useState('');
    const [guests, setGuests] = useState(2);
    const [rooms, setRooms] = useState(1);

    // Fuse fuzzy searching
    // useMemo to memoize the Fuse instance so it isnt rerendered on every keystroke
    const fuse = useMemo(() => new Fuse(destinations, {
        keys: ['term', 'state'],
        threshold: 0.3
    }), []);

    // Search logic: Runs every time a user presses a key
    const searchResults = searchTerm ? fuse.search(searchTerm).map(result => result.item) : [];

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

        // Redirect to results page and pass the data in the URL
        navigate(`/results?dest=${selectedDestId}&in=${checkIn}&out=${checkOut}&guests=${guests}&rooms=${rooms}`);
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
                            setSearchTerm(e.target.value);
                            setSelectedDestId(''); // Reset ID if they start typing again
                            setShowSuggestions(true);
                        }}
                        onFocus={() => setShowSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)} // Delay hides dropdown so clicks register
                    />
                </div>

                {/* The Autocomplete Dropdown Box */}
                {showSuggestions && searchResults.length > 0 && (
                    <ul className="absolute top-[70px] left-0 z-50 w-full rounded-xl border border-slate-100 bg-white shadow-2xl overflow-hidden">
                        {searchResults.map((dest) => (
                            <li
                                key={dest.id}
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