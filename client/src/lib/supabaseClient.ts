import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePubKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePubKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Check VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env'
  );
}

// Create Supabase Client
export const supabase = createClient(supabaseUrl, supabasePubKey);

// Helper function: get current user data if there is an existing session
export const getCurrentUser = async () => {
    const {data: { user } } = await supabase.auth.getUser();
    return user;
}

// Helper function: check if the current user is logged in
export const isAuthenticated = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return !!session;
};