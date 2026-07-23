// Créer dans Mews la réservation d'un invité de groupe, POSÉE SUR L'ALLOTEMENT.
//
// Dernier maillon de la chaîne groupe : le bloc existe (mewsBlocks), l'invité
// réserve chez nous, et jusqu'ici sa réservation restait dans notre base avec une
// case `pms_done` que la réception venait cocher après avoir tout retapé.
//
// Contrairement à une résa OTA, il n'y a RIEN À DEVINER ici : le tarif, le nom du
// groupe, la configuration de lit, le nombre de personnes et le mode de règlement
// sont déjà chez nous. La note de contrôle se déduit donc entièrement, sans
// analyse de mail — elle est plus fiable que celle des résas Booking.

import { callMews } from '@/lib/mews';
import { addReservationNote } from '@/lib/mewsNotes';

const SERVICE_ID = process.env.MEWS_STAY_SERVICE_ID || '9475cd2d-5fa3-4a8a-9abb-aaa9008717f2';

// `ageCategories/getAll` est fermé (401) sur notre scope : on lit la catégorie
// « adulte » dans les réservations existantes plutôt que de coder un identifiant
// en dur qui deviendrait faux le jour d'une reconfiguration.
let adultCache: string | null = null;
export async function ageCategorieAdulte(): Promise<string> {
  if (adultCache) return adultCache;
  const now = Date.now();
  const r = await callMews<{ Reservations?: { PersonCounts?: { AgeCategoryId: string; Count: number }[] }[] }>(
    'reservations/getAll',
    {
      StartUtc: new Date(now - 60 * 864e5).toISOString(), EndUtc: new Date(now + 30 * 864e5).toISOString(),
      TimeFilter: 'Colliding', Extent: { Reservations: true }, Limitation: { Count: 300 },
    },
  );
  const tally: Record<string, number> = {};
  for (const x of r.Reservations ?? []) for (const p of x.PersonCounts ?? []) {
    tally[p.AgeCategoryId] = (tally[p.AgeCategoryId] ?? 0) + p.Count;
  }
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!top) throw new Error('Catégorie d’âge introuvable (aucune réservation récente à observer)');
  adultCache = top;
  return top;
}

// Mews attend des instants réels d'arrivée/départ. On reprend les heures de la
// maison (15h / 11h, heure de Paris) — c'est ce que portent les résas existantes.
function instantParis(dateISO: string, heure: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, heure);
  const h = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris', hour12: false, hour: '2-digit',
  }).format(new Date(guess)));
  return new Date(guess - ((h - heure + 24) % 24) * 3600e3).toISOString();
}

export type InviteGroupe = {
  nom: string; prenom: string; email?: string | null; tel?: string | null;
  arrivee: string; depart: string;
  categoryId: string;          // catégorie Mews de la chambre réservée
  rateId: string;              // tarif CLONÉ du bloc (jamais le tarif modèle)
  blockId: string;
  nbPersonnes: number;
};

export async function creerResaGroupe(i: InviteGroupe): Promise<{ customerId: string; reservationId: string }> {
  const customer = await callMews<{ Id?: string }>('customers/add', {
    LastName: i.nom, FirstName: i.prenom,
    ...(i.email ? { Email: i.email } : {}),
    ...(i.tel ? { Phone: i.tel } : {}),
    OverwriteExisting: false,
  });
  if (!customer.Id) throw new Error('Mews n’a pas créé le profil client');

  const ageId = await ageCategorieAdulte();
  const res = await callMews<{ Reservations?: { Reservation?: { Id: string } }[] }>('reservations/add', {
    ServiceId: SERVICE_ID,
    Reservations: [{
      StartUtc: instantParis(i.arrivee, 15),
      EndUtc: instantParis(i.depart, 11),
      CustomerId: customer.Id,
      RequestedCategoryId: i.categoryId,
      RateId: i.rateId,
      // C'est CE champ qui rattache la réservation à l'allotement : sans lui elle
      // consommerait de la disponibilité générale au lieu du bloc du groupe.
      AvailabilityBlockId: i.blockId,
      PersonCounts: [{ AgeCategoryId: ageId, Count: Math.max(1, i.nbPersonnes || 1) }],
      State: 'Confirmed',
    }],
  });
  const reservationId = (res.Reservations ?? [])[0]?.Reservation?.Id;
  if (!reservationId) throw new Error('Mews n’a pas créé la réservation');
  return { customerId: customer.Id, reservationId };
}

// La note de contrôle d'une résa de groupe. Même grammaire que celle des OTA
// (cf otaResa.controlNote) pour que la réception lise la même chose partout :
//   #<chambre> GROUPE <nom> # / <règlement> <taxe> <variables>
export function noteGroupe(p: {
  categorieNom: string; groupeNom: string;
  paye: boolean; tsMode: 'incluse' | 'ajoutee' | null; tsMontant: number | null;
  nuits: number; nbPersonnes: number; configLit?: string | null;
}): string {
  const chambre = (p.categorieNom || '').toLowerCase()
    .replace(/^chambre\s+/, '').replace(/\s*-\s*/, ' ').trim();
  const reglement = p.paye ? 'PRÉPAYÉ EN LIGNE' : 'À RÉGLER SUR PLACE';
  // La taxe suit le paramétrage du bloc : « incluse » = déjà dans le tarif ;
  // « ajoutée » = ajoutée au tarif et encaissée AVEC lui. Dans les deux cas elle
  // est réglée d'avance SI le séjour a été payé — sinon elle reste à encaisser.
  let taxe = '';
  if (p.tsMode === 'incluse') taxe = 'TS incluse';
  else if (p.tsMode === 'ajoutee') {
    const total = (p.tsMontant ?? 0) * Math.max(1, p.nbPersonnes) * Math.max(1, p.nuits);
    const montant = total ? ` ${total.toFixed(2).replace('.', ',')}€` : '';
    taxe = p.paye ? `TS prépayée${montant}` : `RSP TS${montant}`;
  }
  const variables = [
    p.configLit ? String(p.configLit).toLowerCase() : null,
    p.nbPersonnes > 1 ? `${p.nbPersonnes} pers` : null,
  ].filter(Boolean).join(' · ');
  return `#${chambre} GROUPE ${p.groupeNom} # / ${reglement}${taxe ? ' ' + taxe : ''}${variables ? ' · ' + variables : ''}`;
}

export async function poserNoteGroupe(reservationId: string, texte: string): Promise<string | null> {
  return addReservationNote(reservationId, texte);
}

// ⚠️ Mews EXIGE un motif, sinon 403 « Veuillez indiquer un motif » — et le champ
// attendu s'appelle `Notes`. `Reason` et `CancellationReason` sont refusés tous
// les deux (testé le 2026-07-23), alors même que `CancellationReason` existe sur
// l'objet réservation. Piège coûteux : sans le bon nom, une résa créée par erreur
// ne peut plus être retirée par l'API.
export async function annulerResa(reservationId: string, motif = 'Annulation invité'): Promise<void> {
  await callMews('reservations/cancel', { ReservationIds: [reservationId], Notes: motif });
}
