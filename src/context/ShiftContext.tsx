'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Lock, CalendarDays, Home } from 'lucide-react';
import { format as formatDate, subDays } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import { setReadOnlyMode } from '@/lib/readOnlyMode';
import { isOnDutyAt, type PlanningEntryLite } from '@/lib/shift';

// Mode shift (cadré avec Martin le 2026-06-10) :
// - rôle "user" hors de sa plage de service (shift planifié ± 2h) →
//   web limité à l'accueil + planning, en lecture seule (writes bloquées
//   au niveau du client Supabase via readOnlyMode).
// - admins/superadmins : jamais restreints.
// C'est une frontière d'usage (droit à la déconnexion), pas de sécurité.

interface ShiftState {
  restricted: boolean;
  onDuty: boolean;
  loading: boolean;
}

const ShiftContext = createContext<ShiftState>({ restricted: false, onDuty: true, loading: true });
export const useShift = () => useContext(ShiftContext);

// Chemins accessibles hors shift (en plus de l'accueil '/')
const ALLOWED_PREFIXES = ['/planning', '/profil', '/login', '/register', '/forgot-password', '/update-password'];

function isAllowedPath(path: string): boolean {
  if (path === '/') return true;
  return ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

const REFRESH_ENTRIES_MS = 10 * 60_000; // refetch du planning
const TICK_MS = 60_000; // réévaluation de la fenêtre de service

export function ShiftProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const [entries, setEntries] = useState<PlanningEntryLite[] | null>(null);
  const [now, setNow] = useState(() => new Date());

  const isSubject = !!user && user.role === 'user';

  // Planning du jour + de la veille (shifts de nuit), rafraîchi périodiquement
  useEffect(() => {
    if (!isSubject || !user) {
      setEntries(null);
      return;
    }
    let cancelled = false;
    const fetchEntries = async () => {
      const today = new Date();
      const dates = [formatDate(subDays(today, 1), 'yyyy-MM-dd'), formatDate(today, 'yyyy-MM-dd')];
      const { data } = await supabase
        .from('planning_entries')
        .select('date, shift, start_time, end_time')
        .eq('user_id', user.id)
        .eq('status', 'published')
        .in('date', dates);
      if (!cancelled) setEntries(data ?? []);
    };
    fetchEntries();
    const interval = setInterval(fetchEntries, REFRESH_ENTRIES_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isSubject, user?.id]);

  // Horloge : la fenêtre ±2h évolue même sans refetch
  useEffect(() => {
    if (!isSubject) return;
    const t = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(t);
  }, [isSubject]);

  const loading = isSubject && entries === null;
  const onDuty = !isSubject || loading ? true : isOnDutyAt(entries ?? [], now);
  // Pendant le chargement on n'enferme pas l'utilisateur (pas de flash de blocage)
  const restricted = isSubject && !loading && !onDuty;

  useEffect(() => {
    setReadOnlyMode(restricted);
  }, [restricted]);

  const blocked = restricted && !isAllowedPath(pathname ?? '/');

  return (
    <ShiftContext.Provider value={{ restricted, onDuty, loading }}>
      {restricted && (
        <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900">
          <Lock className="h-4 w-4 shrink-0" />
          Hors service — consultation seule (accueil et planning). À tout à l’heure !
        </div>
      )}
      {blocked ? (
        <div className="flex min-h-[80vh] flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
            <Lock className="h-8 w-8 text-amber-700" />
          </div>
          <h1 className="text-xl font-semibold text-gray-800">Tu n’es pas en poste</h1>
          <p className="max-w-sm text-sm text-gray-500">
            Cette page est disponible pendant tes heures de service (ton shift ± 2h). En
            attendant, l’accueil et le planning restent consultables.
          </p>
          <div className="flex gap-3 pt-2">
            <Link
              href="/"
              className="flex h-11 items-center gap-2 rounded-md border border-gray-300 px-4 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Home className="h-4 w-4" />
              Accueil
            </Link>
            <Link
              href="/planning"
              className="flex h-11 items-center gap-2 rounded-md bg-indigo-600 px-4 text-sm text-white hover:bg-indigo-700"
            >
              <CalendarDays className="h-4 w-4" />
              Mon planning
            </Link>
          </div>
        </div>
      ) : (
        children
      )}
    </ShiftContext.Provider>
  );
}
