// Module Gestion — configuration métier (mapping fournisseurs, postes, rattachement).
// Partagé serveur (routes /api/gestion). La Corniche uniquement pour l'instant
// (le jeton Pennylane = société Corniche).

export type Poste = 'pdj' | 'cowork' | 'resto';

export const POSTES: { id: Poste; label: string }[] = [
  { id: 'pdj', label: 'Petit-déj' },
  { id: 'cowork', label: 'Cowork' },
  { id: 'resto', label: 'Restaurant' },
];

export const posteLabel = (p: string): string => POSTES.find((x) => x.id === p)?.label || p;

// Mapping fournisseur → poste. Le match se fait par sous-chaîne (minuscules) sur
// le libellé Pennylane (ex. "Facture CAFES FOLLIET - 49402187"). Éditable ici ;
// une UI d'édition viendra plus tard.
export const FOURNISSEUR_POSTE: { match: string; poste: Poste }[] = [
  { match: 'folliet', poste: 'pdj' },
  { match: 'transgourmet', poste: 'pdj' },
  { match: 'aix et terra', poste: 'pdj' },
  { match: 'forezia', poste: 'cowork' },
  { match: 'navarro', poste: 'cowork' },
  { match: 'cuisine solution', poste: 'resto' },
  { match: 'compagnie des desserts', poste: 'resto' },
];

// Poste d'un libellé de facture (null si le fournisseur n'est pas suivi).
export function posteForLabel(label: string | null | undefined): Poste | null {
  const s = (label || '').toLowerCase();
  return FOURNISSEUR_POSTE.find((m) => s.includes(m.match))?.poste ?? null;
}

// Nom "propre" du fournisseur depuis le libellé Pennylane généré
// ("Facture CAFES FOLLIET - 49402187 (label généré)" → "CAFES FOLLIET").
export function fournisseurFromLabel(label: string | null | undefined): string {
  return (label || '')
    .replace(/\s*\(label généré\)\s*$/i, '')
    .replace(/^(Facture|Avoir)\s+/i, '')
    .replace(/\s+-\s+[^-]*$/, '')
    .trim();
}

export const isAvoirLabel = (label: string | null | undefined): boolean =>
  /^\s*avoir\b/i.test(label || '');

// Mois de rattachement (conso). Une facture datée en fin de mois concerne le plus
// souvent le mois SUIVANT (commandé le 26, reçu/consommé début du mois d'après).
// Règle par défaut : jour >= 25 → mois suivant. Éditable par facture ensuite.
export function moisRattachement(dateStr: string | null | undefined): string {
  const s = String(dateStr || '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s.slice(0, 7);
  let y = +m[1], mo = +m[2];
  const day = +m[3];
  if (day >= 25) { mo += 1; if (mo > 12) { mo = 1; y += 1; } }
  return `${y}-${String(mo).padStart(2, '0')}`;
}
