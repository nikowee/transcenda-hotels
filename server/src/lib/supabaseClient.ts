import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Check SUPABASE_URL and SUPABASE_SECRET_KEY in .env'
  );
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey);

export const deleteUser = async (userId: string) => {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw error;
};