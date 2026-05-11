// Helpers pour calculer "demain à HHh dans la timezone d'un hôtel".
// Robuste DST (heure été/hiver) sans dépendance externe.

export const HOTEL_TZ = 'Europe/Paris';

/** Renvoie un Date correspondant à "J+n à hh:mm dans la timezone tz" (n par défaut = 1). */
export function tomorrowAtLocalTime(hh: number, mm: number, tz = HOTEL_TZ, nightsFromNow = 1): Date {
  const target = new Date(Date.now() + nightsFromNow * 24 * 3600 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(target);
  const [y, m, d] = parts.split('-').map(Number);

  // Étape 1 : on construit "naivement" l'instant comme si hh:mm était en UTC
  const naiveUtc = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));

  // Étape 2 : on mesure le décalage tz↔UTC pour ce moment et on l'applique
  const tzMs = new Date(naiveUtc.toLocaleString('en-US', { timeZone: tz })).getTime();
  const utcMs = new Date(naiveUtc.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const offsetMs = utcMs - tzMs;

  return new Date(naiveUtc.getTime() + offsetMs);
}

/** Parse "HH:MM" ou "HH:MM:SS" → { hh, mm }. */
export function parseTime(value: string): { hh: number; mm: number } {
  const [h = '11', m = '0'] = value.split(':');
  return { hh: parseInt(h, 10) || 11, mm: parseInt(m, 10) || 0 };
}
