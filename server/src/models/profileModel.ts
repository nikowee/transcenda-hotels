/**
 * ProfileModel — the `profiles` table from ../data/schema.sql.
 *
 * `profiles.id` is a foreign key onto `auth.users(id)`, so a profile is the
 * application-visible half of a Supabase auth account: the parts we are allowed
 * to read and join against without touching the auth schema directly.
 *
 * `bookings.user_id` references this table with ON DELETE CASCADE, which means
 * deleting a profile deletes that person's booking history with it. That is the
 * schema's stated intent, but it is worth knowing before wiring up any
 * account-deletion flow — paid bookings are financial records and usually need
 * to outlive the account.
 */

export interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
  created_at: string;
}

export interface ProfileRecord {
  id: string;
  fullName: string;
  email: string;
  createdAt: string;
}

const TABLE = 'profiles';

/** Mirrors bookingModel's fallback so the app runs without credentials. */
const memoryStore = new Map<string, ProfileRecord>();

export const isSupabaseConfigured = (): boolean => {
  if (process.env.BOOKINGS_STORAGE === 'memory') return false;
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
};

const getClient = async () => {
  const { supabaseAdmin } = await import('../lib/supabaseClient.js');
  return supabaseAdmin;
};

const fromRow = (row: ProfileRow): ProfileRecord => ({
  id: row.id,
  fullName: row.full_name,
  email: row.email,
  createdAt: row.created_at,
});

export const findProfileById = async (id: string): Promise<ProfileRecord | null> => {
  if (!isSupabaseConfigured()) {
    return memoryStore.get(id) ?? null;
  }

  const supabase = await getClient();
  const { data: row, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Profile lookup failed: ${error.message}`);
  return row ? fromRow(row as ProfileRow) : null;
};

/**
 * Resolves the profile behind a booking so the guest details on the booking can
 * be checked against the account that made it. `email` is unique on this table,
 * which makes it a usable lookup key when only the guest email is known.
 */
export const findProfileByEmail = async (email: string): Promise<ProfileRecord | null> => {
  if (!isSupabaseConfigured()) {
    for (const profile of memoryStore.values()) {
      if (profile.email.toLowerCase() === email.toLowerCase()) return profile;
    }
    return null;
  }

  const supabase = await getClient();
  const { data: row, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (error) throw new Error(`Profile lookup failed: ${error.message}`);
  return row ? fromRow(row as ProfileRow) : null;
};

/**
 * Confirms a user_id exists before a booking cites it.
 *
 * Postgres would reject the insert anyway via the foreign key, but the error it
 * returns is an opaque constraint violation. Checking first lets the caller say
 * something useful instead of surfacing a database message.
 */
export const profileExists = async (id: string): Promise<boolean> =>
  (await findProfileById(id)) !== null;

/** Test seam, matching bookingModel. */
export const __clearProfileStore = (): void => {
  memoryStore.clear();
};

/** Test seam: lets a suite stand up a profile for a booking to reference. */
export const __seedProfile = (profile: ProfileRecord): void => {
  memoryStore.set(profile.id, profile);
};
