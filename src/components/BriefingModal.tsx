'use client';

import { useCallback, useState } from 'react';
import { format as formatDate } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Sunrise, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { dutyWindow, type PlanningEntryLite } from '@/lib/shift';

// Briefing de prise de poste — phase 4 du chantier "outil vivant".
// JAMAIS d'ouverture automatique (demande Martin) : uniquement via la pastille
// "Mon brief". Montre ce qui a bougé depuis le DERNIER shift travaillé de
// CETTE personne (2 jours d'absence = 2 jours de mouvements, plafonné à 14 j ;
// fallback 24 h si aucun shift trouvé dans le planning).
// Règle Martin : "trop d'info tue l'info" → 6 éléments essentiels MAX,
// priorisés (ce qui te vise > flash direction > taxis imminents > le neuf),
// le reste en une ligne de compteurs. Pas de génératif : données brutes,
// déterministes.

const MAX_ESSENTIALS = 6;
const MAX_LOOKBACK_DAYS = 14;

interface Essential {
  kind: 'pour-toi' | 'direction' | 'taxi' | 'consigne' | 'ticket' | 'maintenance';
  text: string;
}

const KIND_STYLE: Record<Essential['kind'], { label: string; cls: string }> = {
  'pour-toi':  { label: 'Pour toi',    cls: 'bg-violet-100 text-violet-700' },
  direction:   { label: 'Direction',   cls: 'bg-amber-100 text-amber-700' },
  taxi:        { label: 'Aujourd’hui', cls: 'bg-sky-100 text-sky-700' },
  consigne:    { label: 'Consigne',    cls: 'bg-indigo-100 text-indigo-700' },
  ticket:      { label: 'Tâche',       cls: 'bg-emerald-100 text-emerald-700' },
  maintenance: { label: 'Maintenance', cls: 'bg-orange-100 text-orange-700' },
};

interface BriefData {
  since: Date | null; // null = fallback 24h (pas de shift précédent trouvé)
  essentials: Essential[];
  counts: string[];
}

const ymd = (d: Date) => formatDate(d, 'yyyy-MM-dd');

export default function BriefingModal({
  user,
  hotelId,
}: {
  user: { id: string; name?: string } | null;
  hotelId: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(false);

  // Construit le brief (fenêtre + données). Retourne null si rien à montrer.
  const buildBrief = useCallback(async (): Promise<BriefData | null> => {
    if (!user?.id || !hotelId) return null;
    const now = new Date();

    // 1. Fenêtre : fin du dernier shift travaillé avant le shift courant
    const lookbackStart = new Date(now.getTime() - MAX_LOOKBACK_DAYS * 86_400_000);
    const { data: entries } = await supabase
      .from('planning_entries')
      .select('date, shift, start_time, end_time')
      .eq('user_id', user.id)
      .eq('status', 'published')
      .gte('date', ymd(lookbackStart))
      .lte('date', ymd(now))
      .order('date', { ascending: true });

    const worked = (entries ?? [])
      .map((e) => ({ e: e as PlanningEntryLite, w: dutyWindow(e as PlanningEntryLite) }))
      .filter((x): x is { e: PlanningEntryLite; w: { start: Date; end: Date } } => x.w !== null);

    // Shift courant/imminent = sa fenêtre ±2h contient maintenant
    const current = worked.find((x) => now >= x.w.start && now <= x.w.end);

    // Dernier shift terminé AVANT le début du shift courant (ou avant maintenant)
    const ref = current ? current.w.start : now;
    const prev = [...worked].reverse().find((x) => x.w.end < ref && x !== current);
    const since = prev
      ? new Date(Math.max(prev.w.end.getTime(), lookbackStart.getTime()))
      : new Date(now.getTime() - 86_400_000); // fallback : 24h
    const sinceIso = since.toISOString();
    const today = ymd(now);
    const nowHM = formatDate(now, 'HH:mm');

    // 2. Données (toutes scopées à l'hôtel sélectionné)
    const [consignesR, flashR, demandesR, ticketsR, maintR, libR] = await Promise.all([
      supabase.from('consignes').select('texte, utilisateurs_ids, created_at')
        .eq('hotel_id', hotelId).eq('valide', false)
        .order('created_at', { ascending: false }).limit(60),
      supabase.from('flash_infos').select('message, target_ids, created_at')
        .eq('hotel_id', hotelId).eq('active', true).gte('created_at', sinceIso)
        .order('created_at', { ascending: false }).limit(10),
      supabase.from('demandes').select('type, chambre, heure')
        .eq('hotel_id', hotelId).eq('valide', false).eq('date', today)
        .order('heure', { ascending: true }),
      supabase.from('tickets').select('titre, created_at, date_action')
        .eq('hotel_id', hotelId).eq('valide', false).gte('created_at', sinceIso)
        .order('created_at', { ascending: false }).limit(20),
      supabase.from('maintenance').select('titre, chambre, date_creation')
        .eq('hotel_id', hotelId).neq('statut', 'Fait').gte('date_creation', ymd(since))
        .order('date_creation', { ascending: false }).limit(20),
      supabase.from('chambres_liberees').select('chambres')
        .eq('hotel_id', hotelId).gte('created_at', `${today}T00:00:00`),
    ]);

    const consignes = consignesR.data ?? [];
    const newConsignes = consignes.filter((c) => c.created_at >= sinceIso);
    const targeted = newConsignes.filter((c) =>
      Array.isArray(c.utilisateurs_ids) && c.utilisateurs_ids.includes(user.id));
    const general = newConsignes.filter((c) => !targeted.includes(c));
    const flash = (flashR.data ?? []).filter((f) =>
      !f.target_ids || !f.target_ids.length || f.target_ids.includes(user.id));
    const demandes = demandesR.data ?? [];
    const upcoming = demandes.filter((d) => (d.heure ?? '') >= nowHM);
    const tickets = ticketsR.data ?? [];
    const maint = maintR.data ?? [];
    const roomsFreed = (libR.data ?? []).flatMap((l) => l.chambres ?? []);

    // 3. L'essentiel — priorisé, plafonné
    const essentials: Essential[] = [];
    const push = (kind: Essential['kind'], text: string) => {
      if (essentials.length < MAX_ESSENTIALS) essentials.push({ kind, text });
    };
    const clip = (s: string, n = 110) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

    targeted.forEach((c) => push('pour-toi', clip(c.texte)));
    flash.slice(0, 2).forEach((f) => push('direction', clip(f.message)));
    upcoming.slice(0, 2).forEach((d) =>
      push('taxi', `${d.type} chambre ${d.chambre || '?'} à ${(d.heure ?? '').slice(0, 5)}`));
    general.forEach((c) => push('consigne', clip(c.texte)));
    tickets.forEach((t) => push('ticket', clip(t.titre)));
    maint.forEach((m) => push('maintenance', clip(`${m.titre} (ch. ${m.chambre || '?'})`)));

    // 4. Le reste en compteurs
    const counts: string[] = [];
    if (consignes.length) counts.push(`${consignes.length} consigne${consignes.length > 1 ? 's' : ''} active${consignes.length > 1 ? 's' : ''}`);
    if (demandes.length) counts.push(`${demandes.length} taxi/réveil aujourd’hui`);
    if (roomsFreed.length) counts.push(`${roomsFreed.length} chambre${roomsFreed.length > 1 ? 's' : ''} libérée${roomsFreed.length > 1 ? 's' : ''}`);

    return { since: prev ? since : null, essentials, counts };
  }, [user?.id, hotelId]);

  const openManually = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const b = await buildBrief();
      if (b) {
        setBrief(b);
        setOpen(true);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!user?.id || !hotelId) return null;

  return (
    <>
      {/* Pastille "Mon brief" — seul point d'entrée, jamais d'ouverture auto */}
      {!open && (
        <button
          onClick={openManually}
          title="Mon brief de prise de poste"
          className="fixed bottom-5 left-5 z-40 inline-flex items-center gap-2 rounded-full bg-white border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-600 shadow-md transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-60"
          disabled={loading}
        >
          <Sunrise className="h-4 w-4" />
          {loading ? 'Un instant…' : 'Mon brief'}
        </button>
      )}

      {open && brief && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-1 flex items-start justify-between gap-3">
              <h2 className="text-xl font-bold text-slate-900">
                Bonjour{user.name ? `, ${user.name}` : ''} 👋
              </h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-4 text-sm text-slate-500">
              {brief.since
                ? `Depuis ton dernier shift (${formatDate(brief.since, 'eeee HH:mm', { locale: fr })}) :`
                : 'Sur les dernières 24 h :'}
            </p>

            {brief.essentials.length ? (
              <ul className="space-y-2.5">
                {brief.essentials.map((e, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${KIND_STYLE[e.kind].cls}`}>
                      {KIND_STYLE[e.kind].label}
                    </span>
                    <span className="text-sm leading-snug text-slate-700">{e.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                Rien de spécial depuis ton dernier passage — bonne journée 🌞
              </p>
            )}

            {brief.counts.length > 0 && (
              <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
                {brief.counts.join(' · ')} — tout est sur le tableau de bord.
              </p>
            )}

            <button
              onClick={() => setOpen(false)}
              className="mt-5 w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700"
            >
              C’est parti
            </button>
          </div>
        </div>
      )}
    </>
  );
}
