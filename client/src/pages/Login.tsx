import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router'; 
import AuthLayout from '../components/AuthLayout';
import { supabase } from '../lib/supabaseClient';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null); 
  const [isLoading, setIsLoading] = useState(false); 
  
  const [searchParams] = useSearchParams();
  const navigate = useNavigate(); 

  useEffect(() => {
    
    const verified = searchParams.get('verified');
    const message = searchParams.get('message');
    
    if (verified === 'true' || window.location.hash.includes('type=signup') || window.location.hash.includes('access_token')) {
      setSuccessMessage('Verification successful! Please log in to your account.');
    } else if (message) {
      setSuccessMessage(message);
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setSuccessMessage(null);
    setErrorMessage(null); 
    setIsLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        setErrorMessage('User not found or incorrect password.');
      } else {
        setErrorMessage(error.message);
      }
      setIsLoading(false);
    } else {
      navigate('/');
    }
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Login to access your account">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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

        {successMessage && (
          <div className="bg-green-500/10 border border-green-500/20 text-green-400 text-sm p-3 rounded-lg text-center">
            {successMessage}
          </div>
        )}

        <button 
          type="submit" 
          className="w-full bg-blue-600 text-white py-2 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          disabled={isLoading}
        >
          {isLoading ? 'Logging in...' : 'Log In'}
        </button>
      </form>
      <p className="text-center text-slate-400 text-sm mt-6">
        Don't have an account? <Link to="/signup" className="text-blue-400 hover:underline">Sign up</Link>
      </p>
    </AuthLayout>
  );
}