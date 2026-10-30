import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
export function stagingSupabase(): SupabaseClient {
 const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if (!url || !key) throw new Error("Staging Supabase is not configured.");
 if (!client) client = createClient(url, key, {
   auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
 });
 return client;
}
