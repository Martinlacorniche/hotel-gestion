import { createClient } from '@supabase/supabase-js';
import toast from 'react-hot-toast';
import { isReadOnlyMode, READONLY_WRITE_WHITELIST } from '@/lib/readOnlyMode';

const supabaseUrl = 'https://drdlcohzfjdogyquglcs.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyZGxjb2h6Zmpkb2d5cXVnbGNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk1NDk1NDYsImV4cCI6MjA2NTEyNTU0Nn0.uPRYdTX9F0ccSdCTcUta7UyzahcPCZeFmoxIpuKamME';

const rawSupabase = createClient(supabaseUrl, supabaseAnonKey);

const READONLY_ERROR = { message: 'Hors service — lecture seule', code: 'SHIFT_READONLY' };
const BLOCKED_METHODS = ['insert', 'update', 'upsert', 'delete'];

// Pseudo-builder renvoyé à la place d'une écriture bloquée : chaînable à
// l'infini (.select(), .eq(), .single()...) et awaitable, il résout toujours
// { data: null, error: READONLY_ERROR } pour que les pages affichent leur
// gestion d'erreur habituelle sans planter.
function blockedBuilder(): unknown {
  const target = () => {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: READONLY_ERROR, count: null, status: 403 });
      }
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}

// Mode shift : quand le drapeau lecture seule est posé (salarié hors de sa
// plage de service), toutes les écritures DB sont interceptées ici — un seul
// point de passage au lieu de modifier chaque page.
const guardedFrom = (table: string) => {
  const builder = rawSupabase.from(table);
  if (!isReadOnlyMode() || READONLY_WRITE_WHITELIST.includes(table)) return builder;
  for (const method of BLOCKED_METHODS) {
    (builder as unknown as Record<string, unknown>)[method] = () => {
      toast.error('Hors service — lecture seule');
      return blockedBuilder();
    };
  }
  return builder;
};

export const supabase = new Proxy(rawSupabase, {
  get(target, prop, receiver) {
    if (prop === 'from') return guardedFrom;
    const value = Reflect.get(target, prop, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
