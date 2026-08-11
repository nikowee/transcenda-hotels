import { supabase } from './supabaseClient';

/** Build the Authorization header for the current session, or {} when signed out. */
export const authHeader = async (): Promise<Record<string, string>> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};
