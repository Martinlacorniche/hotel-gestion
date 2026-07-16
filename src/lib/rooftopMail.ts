// Notifications de réservation Rooftop que la VITRINE s'envoie à la réception des Voiles
// (`Rooftop Les Voiles <demandes@send.hotel-corniche.com>` → contact-lesvoiles@htbm.fr).
//
// Pourquoi ce parseur existe (Martin 2026-07-16) : « si la résa est dans l'app correctement
// alors on supprime ». Le mail double le plan de salle de l'onglet Service — donc il ne sert
// à rien… SAUF s'il est le seul témoin d'une résa que l'app n'a pas. Côté vitrine, l'insert
// en base (RPC `rooftop_book`, côté client) et l'envoi du mail (route `/api/rooftop-reservation`)
// sont DEUX chemins indépendants — le `fetch` de notif est même en `.catch(() => {})`. On ne
// supprime donc jamais sur le seul critère de l'expéditeur : on VÉRIFIE d'abord en base, et un
// mail orphelin (ou qui ne colle pas à la ligne trouvée) remonte à l'humain.
//
// Format du corps : `getMessageText` remplace CHAQUE balise par un \n → le libellé et sa valeur
// tombent sur DEUX lignes (même piège que LoungeUp, cf preSejour.ts).

export type RooftopMailResa = {
  nom: string | null;
  dateISO: string | null;
  heure: string | null;      // normalisé HH:MM
  couverts: number | null;
  table: string | null;
  telephone: string | null;
  email: string | null;
  message: string | null;
};

const MOIS: Record<string, number> = {
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11,
  décembre: 12, decembre: 12,
};

// « samedi 18 juillet 2026 » → « 2026-07-18 ». ⚠️ `\w` ne couvre pas les accents en JS
// (cf piège LoungeUp) → classe explicite [a-zà-ÿ] pour attraper « février »/« août ».
export function frDateToISO(s: string): string | null {
  const m = s.match(/(\d{1,2})\s+([a-zà-ÿ]+)\s+(\d{4})/i);
  if (!m) return null;
  const mois = MOIS[m[2].toLowerCase()];
  if (!mois) return null;
  return `${m[3]}-${String(mois).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// « 19h30 » / « 19 h » / « 18:30 » → « 19:30 » / « 19:00 » / « 18:30 ». La base contient les
// deux écritures (`heure` est du texte libre : « 19h30 » via la vitrine, « 18:30 » saisi à la
// main) → on normalise des deux côtés avant de comparer.
export function normalizeHeure(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2})\s*[h:]\s*(\d{2})?/i);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${(m[2] || '00').padStart(2, '0')}`;
}

// Accents/casse/espaces neutralisés pour comparer un nom saisi à la main à celui du mail.
export function normName(s: string | null): string {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// Lit « Libellé » puis sa valeur, que le mail la mette sur la même ligne ou sur la suivante.
function field(lines: string[], label: string): string | null {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (let i = 0; i < lines.length; i++) {
    const same = lines[i].match(new RegExp(`^${esc}\\s*[:\\t]\\s*(.+)$`, 'i'));
    if (same) return same[1].trim();
    if (new RegExp(`^${esc}\\s*:?$`, 'i').test(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j]) return lines[j];
      }
    }
  }
  return null;
}

export function parseRooftopMail(subject: string, body: string): RooftopMailResa {
  const lines = body.split('\n').map((l) => l.trim());

  const couvertsRaw = field(lines, 'Couverts');
  // La date figure dans le corps ET dans le sujet (« … · samedi 18 juillet 2026 19h30 — … »).
  const dateISO = frDateToISO(field(lines, 'Date') || '') || frDateToISO(subject);
  const heure = normalizeHeure(field(lines, 'Heure')) ||
    normalizeHeure(subject.match(/(\d{1,2}\s*[h:]\s*\d{0,2})/)?.[1] || null);

  return {
    nom: field(lines, 'Nom') || subject.match(/—\s*(.+?)\s*\(\d+\s*pers/i)?.[1]?.trim() || null,
    dateISO,
    heure,
    couverts: couvertsRaw ? Number(couvertsRaw.match(/\d+/)?.[0] ?? NaN) || null : null,
    table: field(lines, 'Table'),
    telephone: field(lines, 'Téléphone'),
    email: field(lines, 'Email'),
    message: field(lines, 'Message'),
  };
}
