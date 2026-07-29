// Répétition à blanc de l'importeur La Corniche — LECTURE SEULE, rien n'est
// écrit ni dans HotSoft ni dans Supabase. L'objet est de valider la BOUCLE,
// pas de charger des données : la démo est un hôtel irlandais.
//
// Ce que ça démontre concrètement :
//  1. le rattrapage incrémental des réservations, faute de webhooks ;
//  2. les suppressions, qu'aucune autre lecture ne révèle ;
//  3. le CA d'une journée reconstitué en UNE lecture, ventes et encaissements
//     séparés, avec la ventilation par moyen de paiement.
//
// bash scripts/hotsoft-certif/run.sh import-dryrun.mjs

import { requireDemo } from './lib.mjs';
import {
  getHotelDate, getReservationsUpdatedSince, getFoliosByJournalDate,
  fetchAllPages, toHsDate, hsDateStr, HS_RESERVATION_STATUS,
} from './.build/hotsoft.js';

requireDemo('import-dryrun.mjs');

const euro = (n) => `${n.toFixed(2).replace('.', ',')} €`;

// Le bac à sable est figé : on part de SA date d'exploitation, pas du jour réel.
const hotelDate = await getHotelDate();
const shift = (days) => {
  const d = new Date(`${hotelDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

console.log(`Date d'exploitation : ${hotelDate}\n`);

/* -- 1. Rattrapage incrémental ------------------------------------------- */
// En production ce curseur vient de la base (dernier import réussi). On borne
// volontairement en pages : une fenêtre large peut représenter des centaines de
// pages, et un importeur qui s'étrangle tout seul ne se rattrape jamais.
console.log(`— Réservations modifiées entre ${shift(-2)} et ${shift(1)} —`);
const maj = await getReservationsUpdatedSince(shift(-2), shift(1), { maxPages: 4 });
console.log(`  ${maj.total} au total, ${maj.items.length} rapatriées${maj.truncated ? ' (tronqué : à reprendre par fenêtres plus fines)' : ''}`);

const parStatut = {};
for (const r of maj.items) {
  const k = HS_RESERVATION_STATUS[r.ReservationStatus] ?? `inconnu (${r.ReservationStatus})`;
  parStatut[k] = (parStatut[k] || 0) + 1;
}
for (const [k, n] of Object.entries(parStatut).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(4)}  ${k}`);
}

const ex = maj.items[0];
if (ex) {
  console.log(`  exemple : n°${ex.Number}  ${hsDateStr(ex.Arrival)} → ${hsDateStr(ex.Departure)}`
    + `  ch.${(ex.Room?.Number || '—').trim()}  ${HS_RESERVATION_STATUS[ex.ReservationStatus]}`);
}

/* -- 2. Les suppressions -------------------------------------------------- */
// Une résa supprimée disparaît simplement des lectures normales : sans ce
// passage, l'import garderait indéfiniment des séjours fantômes.
console.log(`\n— Réservations supprimées sur la même fenêtre —`);
const del = await fetchAllPages('Reservations/Deleted/Page={page}', 'Reservations',
  { UpdatedFrom: toHsDate(shift(-2)), UpdatedTo: toHsDate(shift(1)) }, { maxPages: 2 });
console.log(`  ${del.total} suppression(s) à répercuter`);

/* -- 3. Le CA d'une journée ----------------------------------------------- */
// UNE seule lecture donne ventes ET encaissements de tout l'hôtel.
//
// ⚠️ Le discriminant est `JournalType`, PAS le signe du montant. Se fier au
// signe paraît marcher — les paiements sont massivement négatifs — mais ça
// range les avoirs parmi les encaissements et, surtout, ça compte comme
// « encaissé » toute vente saisie en négatif. Vérifié sur le bac à sable : un
// « No Show » de 269 € porte le PLU NOSHOW et le JournalType 1, c'est une
// vente. Le signe ne sert qu'à distinguer, DANS chaque famille, l'avoir de la
// vente et le remboursement du paiement.
const JOURNAL_VENTE = 1;
const JOURNAL_PAIEMENT = 2;
const JOURNAL_LEDGER = 4; // deposit / city ledger : ni vente ni encaissement

const jour = shift(-1);
console.log(`\n— Journée du ${jour} —`);
const { items: lignes, total, truncated } = await getFoliosByJournalDate(jour, shift(0), { maxPages: 30 });
console.log(`  ${total} écritures${truncated ? ' (tronqué)' : ''}, ${lignes.length} lues`);

let ventes = 0;
let ventesHT = 0;
let ledger = 0;
const encaissements = {};
const inclassables = new Set();

for (const l of lignes) {
  switch (l.JournalType) {
    case JOURNAL_VENTE:
      ventes += l.AmountInclVat;
      ventesHT += l.AmountExclVat;
      break;
    case JOURNAL_PAIEMENT: {
      // Négatif = argent qui rentre. On inverse pour raisonner en caisse.
      const moyen = (l.Description || 'sans libellé').trim();
      encaissements[moyen] = (encaissements[moyen] || 0) - l.AmountInclVat;
      break;
    }
    case JOURNAL_LEDGER:
      ledger += l.AmountInclVat;
      break;
    default:
      inclassables.add(l.JournalType);
  }
}

console.log(`  ventes   ${euro(ventes)} TTC  (${euro(ventesHT)} HT)`);
const totalEnc = Object.values(encaissements).reduce((a, b) => a + b, 0);
console.log(`  encaissé ${euro(totalEnc)}`);
for (const [moyen, montant] of Object.entries(encaissements).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${euro(montant).padStart(14)}  ${moyen}`);
}
if (ledger) console.log(`  ledger   ${euro(ledger)} (dépôts / comptes débiteurs, hors CA)`);
if (inclassables.size) {
  console.log(`  ⚠️ JournalType non prévus : ${[...inclassables].join(', ')} — à qualifier avant mise en prod`);
}

// L'écart ventes/encaissements d'une journée est NORMAL — on encaisse le
// séjour d'hier, on facture celui d'aujourd'hui. Ce n'est pas un contrôle de
// cohérence, juste le rappel qu'on ne peut pas déduire l'un de l'autre.
console.log(`\n  (écart ${euro(totalEnc - ventes)} : normal, encaissements et ventes ne tombent pas le même jour)`);

console.log('\nRépétition terminée — aucune écriture effectuée.');
