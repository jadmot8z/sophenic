import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export function createAdminClient() {
  return createSupabaseClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
