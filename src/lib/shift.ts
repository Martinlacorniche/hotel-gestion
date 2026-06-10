// Mode shift : logique pure "est en service maintenant".
// Un salarié est en service si une entrée de planning publiée lui donne un
// shift travaillé dont la plage [début − marge, fin + marge] contient l'instant
// courant. Les shifts de nuit passant minuit sont couverts en évaluant aussi
// l'entrée de la veille.

export const NON_WORKED_SHIFTS = ['Repos', 'CP', 'Maladie', 'Injustifié', 'Sans solde', 'École'];

// Marge décidée avec Martin (2026-06-10) : 2h avant et après le shift.
export const SHIFT_MARGIN_MIN = 120;

export interface PlanningEntryLite {
  date: string; // 'yyyy-MM-dd'
  shift: string | null;
  start_time: string | null; // 'HH:mm' ou 'HH:mm:ss'
  end_time: string | null;
  hotel_id?: string | null;
}

function toDate(dateStr: string, time: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
}

// Fenêtre de service d'une entrée (avec marge), ou null si non travaillée.
export function dutyWindow(
  entry: PlanningEntryLite,
  marginMin: number = SHIFT_MARGIN_MIN,
): { start: Date; end: Date } | null {
  if (!entry.shift || NON_WORKED_SHIFTS.includes(entry.shift)) return null;
  if (!entry.start_time || !entry.end_time) return null;
  if (entry.start_time.slice(0, 5) === entry.end_time.slice(0, 5)) return null; // 00:00 → 00:00

  const start = toDate(entry.date, entry.start_time);
  const end = toDate(entry.date, entry.end_time);
  if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1); // passe minuit (Night)

  return {
    start: new Date(start.getTime() - marginMin * 60_000),
    end: new Date(end.getTime() + marginMin * 60_000),
  };
}

// `entries` doit couvrir la veille ET le jour de `at` (pour les Night).
export function isOnDutyAt(
  entries: PlanningEntryLite[],
  at: Date,
  marginMin: number = SHIFT_MARGIN_MIN,
): boolean {
  return entries.some((e) => {
    const w = dutyWindow(e, marginMin);
    return w !== null && at >= w.start && at <= w.end;
  });
}
