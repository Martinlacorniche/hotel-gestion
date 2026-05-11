import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Client Supabase server-only avec service_role : BYPASS RLS.
// À n'importer QUE depuis des fichiers server (API routes, server actions).
// Ne JAMAIS importer depuis un "use client" — exposerait la clé.
//
// Instanciation paresseuse via Proxy : le module peut s'importer même quand
// SUPABASE_SERVICE_ROLE_KEY n'est pas en env (build Netlify p.ex.). L'erreur
// ne se déclenche qu'au premier appel réel.

const supabaseUrl = 'https://drdlcohzfjdogyquglcs.supabase.co';

let cached: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (cached) return cached;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY manquant en environnement');
  }
  cached = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    const client = getClient() as unknown as Record<string, unknown>;
    const value = client[prop as string];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});
