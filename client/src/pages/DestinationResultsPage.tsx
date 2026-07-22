import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import axios from 'axios';
import HotelResultsList from '../components/HotelResultsList';
import LoadingPage from '../components/LoadingPage';

const API_URL = import.meta.env.VITE_API_URL;

export default function DestinationResultsPage() {
    const [searchParams] = useSearchParams();
    const destId = searchParams.get('dest');

    const [hotels, setHotels] = useState<Array<any> | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!destId) {
            setError('No destination selected.');
            return;
        }

        axios.get(`${API_URL}/api/hotels/${destId}`)
            .then((res) => setHotels(res.data))
            .catch(() => setError('Failed to load hotels. Please try again.'));
    }, [destId]);

    if (error) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center space-y-4">
                    <div className="h-16 w-16 bg-red-100 rounded-full mx-auto flex items-center justify-center">
                        <span className="text-3xl">😕</span>
                    </div>
                    <h1 className="text-3xl font-bold text-slate-700">Something went wrong</h1>
                    <p className="text-slate-400">{error}</p>
                </div>
            </div>
        );
    }

    if (hotels === null) {
        return <LoadingPage />;
    }

    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <HotelResultsList hotels={hotels} />
        </div>
    );
}