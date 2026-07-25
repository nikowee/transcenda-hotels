import React, { useState } from 'react';
import { Link } from 'react-router';
import AuthLayout from '../components/AuthLayout';
import { supabase } from '../lib/supabaseClient'; 

export default function Signup() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [checkMessage, setCheckMessage] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault(); 
        setErrorMessage(null);
        setCheckMessage(null);
        setIsLoading(true);

        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: `${window.location.origin}/login`
            }
        });

        if (error) {
            setErrorMessage(error.message || 'Signup failed. Please try again.');
        } else if (data?.user?.identities && data.user.identities.length === 0) {
            setErrorMessage('This email is already registered and verified. Please log in.');
        } else {
            setCheckMessage('Signup successful! Please check your email for confirmation.');
            setEmail('');
            setPassword('');
        }

        setIsLoading(false);
    };

    return (
        <AuthLayout title="Create an account" subtitle="Join Transcenda today">
            {/* Added noValidate below so the form sends gibberish to Supabase instead of getting blocked by the browser! */}
            <form onSubmit={handleSubmit} className="space-y-4">
                <input 
                    type="email" 
                    placeholder="Email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    required 
                />
                <input 
                    type="password" 
                    placeholder="Password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    required 
                />
                
                {errorMessage && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-lg text-center">
                        {errorMessage}
                    </div>
                )}
                {checkMessage && (
                    <div className="bg-green-500/10 border border-green-500/20 text-green-400 text-sm p-3 rounded-lg text-center">
                        {checkMessage}
                    </div>
                )}

                <button 
                    type="submit" 
                    className="w-full bg-blue-600 text-white py-2 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                    disabled={isLoading}
                >
                    {isLoading ? 'Signing up...' : 'Sign Up'}
                </button>
            </form>

            <p className="text-center text-slate-400 text-sm mt-6">
                Already have an account? <Link to="/login" className="text-blue-400 hover:underline">Log in</Link>
            </p>
        </AuthLayout>
    );
}