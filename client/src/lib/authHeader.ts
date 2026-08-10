import { supabase } from './supabaseClient';

/**
 * Build the Authorization header for the current session, or {} when signed
 * out — guest checkout is a supported flow, so the empty object is a normal
 * answer, and the server reads a header-less request as a guest booking.
 *
 * getSession over a cached token: supabase-js refreshes a near-expiry access
 * token as part of the call, so a long checkout never ends with the server
 * rejecting a token that went stale while the guest was typing.
 */
export const authHeader = async (): Promise<Record<string, string>> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};
