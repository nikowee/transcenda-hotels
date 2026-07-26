import { supabase } from './supabaseClient';

/**
 * The `Authorization` header for the current session, or `{}` when signed out.
 *
 * Booking as a guest is a supported flow, so the empty object is a normal
 * answer rather than a failure — spread it into a request either way and the
 * server treats a header-less request as a guest checkout.
 *
 * getSession rather than a cached token: supabase-js refreshes an access token
 * that is close to expiry as part of this call, so a long checkout does not end
 * with the server rejecting a token that went stale while the guest was typing.
 */
export const authHeader = async (): Promise<Record<string, string>> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};
