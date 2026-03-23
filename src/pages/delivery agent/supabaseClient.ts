/**
 * RESPONSIBILITY: Frontend Supabase client for realtime subscriptions.
 * Uses the anon key (safe for browser) — NOT the service role key.
 */
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string
);
