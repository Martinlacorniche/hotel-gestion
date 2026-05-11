import { createClient } from '@supabase/supabase-js';

// Client Supabase server-only avec service_role : BYPASS RLS.
// À n'importer QUE depuis des fichiers server (API routes, server actions).
// Ne JAMAIS importer depuis un "use client" — exposerait la clé.

const supabaseUrl = 'https://drdlcohzfjdogyquglcs.supabase.co';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  console.warn('[supabaseAdmin] SUPABASE_SERVICE_ROLE_KEY manquant');
}

export const supabaseAdmin = createClient(supabaseUrl, serviceKey ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});
