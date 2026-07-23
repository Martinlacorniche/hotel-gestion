// Sonde de LECTURE du Connector API, sur la démo publique Mews.
//
// Double emploi :
//   1) Certification. Mews ne fait pas de visio : ils relisent les logs d'appels
//      de la démo pour vérifier que chaque endpoint déclaré tourne vraiment, et
//      les retrouvent par le champ `Client`. Ce balayage EST la preuve.
//   2) Cartographie. Les dumps donnent la forme réelle des données, base du
//      mapping vers le PMS.
//
//   node --env-file=.env.mews-demo scripts/mews-certif/sweep-read.mjs
//
// Aucun effet de bord : que des getAll/get. Refuse de tourner ailleurs que sur
// la démo (garde-fou plus bas) — on ne balaie pas l'hôtel réel.
//
// Deux temps, parce que la moitié des opérations exigent des identifiants
// obtenus par les autres (ServiceIds, RateGroupIds, ServiceOrderIds…) :
//   1. DÉCOUVERTE — le socle, qui donne les identifiants.
//   2. BALAYAGE   — tout le reste, alimenté par ces identifiants.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = process.env.MEWS_BASE || '';
const CREDS = {
  ClientToken: process.env.MEWS_CLIENT_TOKEN,
  AccessToken: process.env.MEWS_ACCESS_TOKEN,
  Client: process.env.MEWS_CLIENT_NAME,
};

if (!/mews-demo\.com/.test(BASE)) {
  console.error(`REFUS : MEWS_BASE doit pointer la démo, reçu « ${BASE || 'vide'} ».`);
  console.error('Lancer avec : node --env-file=.env.mews-demo scripts/mews-certif/sweep-read.mjs');
  process.exit(1);
}
if (!CREDS.ClientToken || !CREDS.AccessToken || !CREDS.Client) {
  console.error('REFUS : MEWS_CLIENT_TOKEN / MEWS_ACCESS_TOKEN / MEWS_CLIENT_NAME manquants.');
  process.exit(1);
}

const DUMPS = join('scripts', 'mews-certif', 'dumps');

// La démo plafonne les fenêtres de réservation à 100 HEURES (la prod tolère
// 95 jours — vérifié le 2026-07-13, ne pas généraliser l'une à l'autre).
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const win = (d) => ({ StartUtc: iso(now), EndUtc: iso(now + d * 864e5) });
const SHORT = win(4);     // sous la limite des 100 h
const MED = { StartUtc: iso(now - 30 * 864e5), EndUtc: iso(now + 30 * 864e5) };

const results = [];

async function probe(op, body, module) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...CREDS, ...body }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }

  const arrKey = json && typeof json === 'object'
    ? Object.keys(json).find((k) => Array.isArray(json[k])) : null;
  const arr = arrKey ? json[arrKey] : null;
  const sample = arr?.find((x) => x && typeof x === 'object');
  const count = arr ? arr.length : null;
  const keys = sample ? Object.keys(sample) : (res.ok && json && typeof json === 'object' ? Object.keys(json).slice(0, 10) : []);
  const msg = res.ok ? '' : (json?.Message || String(json).slice(0, 110));

  results.push({ op, module, ok: res.ok, status: res.status, ms: Date.now() - t0, count, keys, msg });
  await writeFile(join(DUMPS, `${op.replace('/', '.')}.json`), JSON.stringify(json, null, 2));

  console.log(`${res.ok ? `OK   ${String(count ?? '—').padStart(4)} obj` : `KO   ${res.status}`}  ${op.padEnd(30)} ${msg}`);
  await new Promise((r) => setTimeout(r, 300)); // on ne bouscule pas leur débit
  return res.ok ? json : null;
}

await mkdir(DUMPS, { recursive: true });

// ── 1. DÉCOUVERTE ───────────────────────────────────────────────────────────
console.log('\n— Découverte —');
const config = await probe('configuration/get', {}, 'socle');
const services = await probe('services/getAll', { Limitation: { Count: 1000 } }, 'socle');
await probe('resources/getAll', { Limitation: { Count: 100 } }, 'socle');

// PIÈGE : le bac à sable est partagé, et tout le monde y crée des services de
// test — 495 services, dont des dizaines de « Bookable » morts. Plusieurs
// opérations (availabilityBlocks, cancellationPolicies…) rejettent la liste
// entière dès qu'un identifiant ne leur convient pas : « Invalid ServiceIds ».
// On ne devine donc pas le service d'hébergement, on prend CELUI QUE LES
// RÉSERVATIONS UTILISENT réellement. C'est aussi ce que fera le vrai connecteur.
const serviceIds = (services?.Services || []).map((s) => s.Id);

const reservations = await probe('reservations/getAll', {
  ...SHORT, TimeFilter: 'Colliding',
  Extent: { Reservations: true, Customers: true },
  Limitation: { Count: 100 },
}, 'borne');
const resList = reservations?.Reservations || [];
const reservationIds = resList.map((r) => r.Id).slice(0, 20);

// Le service d'hébergement = le plus représenté parmi les réservations.
const tally = {};
for (const r of resList) if (r.ServiceId) tally[r.ServiceId] = (tally[r.ServiceId] || 0) + 1;
const stayService = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0];
const bookableIds = stayService ? [stayService] : [];
const svcName = (services?.Services || []).find((s) => s.Id === stayService)?.Name;
console.log(`   hébergement : « ${svcName || '?'} » (${stayService || 'introuvable'})`);

const rateGroups = await probe('rateGroups/getAll', { ServiceIds: bookableIds, Limitation: { Count: 50 } }, 'yield');
const rateGroupIds = (rateGroups?.RateGroups || []).map((g) => g.Id);

// ── 2. BALAYAGE ─────────────────────────────────────────────────────────────
console.log('\n— Balayage —');

// Socle
await probe('resourceCategories/getAll', { ServiceIds: bookableIds, Limitation: { Count: 50 } }, 'socle');
await probe('resourceBlocks/getAll', { CollidingUtc: SHORT, Limitation: { Count: 100 } }, 'socle');
await probe('companies/getAll', { Limitation: { Count: 50 } }, 'socle');
await probe('counters/getAll', { Limitation: { Count: 50 } }, 'socle');
await probe('outlets/getAll', { Limitation: { Count: 50 } }, 'socle');

// Borne de self check-in
// Le champ s'appelle `GroupId` sur une réservation, PAS `ReservationGroupId` :
// se tromper de nom fait sauter l'appel en silence (aucune erreur, juste rien).
const groupIds = [...new Set(resList.map((r) => r.GroupId).filter(Boolean))].slice(0, 20);
if (groupIds.length) {
  await probe('reservationGroups/getAll', { ReservationGroupIds: groupIds, Limitation: { Count: 50 } }, 'borne');
}
await probe('customers/getAll', {
  CreatedUtc: MED,
  Extent: { Customers: true, Documents: false, Addresses: false }, // pas de RGPD : on n'en veut pas
  Limitation: { Count: 50 },
}, 'borne');
await probe('customers/search', { Text: 'a', Limitation: { Count: 20 } }, 'borne');
// ⚠️ `cancellationPolicies/getAll` exige DEUX choses, et une seule est documentée par son
// message d'erreur (résolu le 2026-07-23 avec Milan Bezdecka, Mews) :
//   ① `ServiceIds` est OBLIGATOIRE — il n'apparaît pourtant dans aucune des listes de filtres
//      que renvoie l'erreur, d'où notre diagnostic erroné de « bug Mews » : sans lui, la
//      réponse est « Invalid ServiceIds », sur un champ que nous n'avions pas envoyé.
//   ② ET au moins un filtre parmi `RateGroupIds`, `CancellationPolicyIds`, `UpdatedUtc`
//      (fenêtre ≤ 3 mois, sinon « The interval must not exceed 3M1D »).
// ⚠️ Piège restant : `rateGroups/getAll(ServiceIds:[X])` renvoie des groupes que
// `cancellationPolicies/getAll(ServiceIds:[X])` REFUSE — 3 sur 18 sur la démo — et un seul
// identifiant invalide fait échouer tout l'appel. On passe donc par `UpdatedUtc`, qui ne
// dépend d'aucune liste d'identifiants et couvre le besoin (lister les politiques du service).
await probe('cancellationPolicies/getAll', {
  ServiceIds: bookableIds,
  UpdatedUtc: { StartUtc: iso(now - 80 * 864e5), EndUtc: iso(now) },
  Limitation: { Count: 50 },
}, 'borne');
await probe('ageCategories/getAll', { ServiceIds: bookableIds, Limitation: { Count: 50 } }, 'borne');

// POS Rooftop / facturation
await probe('bills/getAll', { CreatedUtc: MED, Limitation: { Count: 50 } }, 'pos');
await probe('orderItems/getAll', { ConsumedUtc: MED, Limitation: { Count: 100 } }, 'pos');
await probe('payments/getAll', { ChargedUtc: MED, Limitation: { Count: 100 } }, 'pos');
await probe('accountingCategories/getAll', { Limitation: { Count: 100 } }, 'pos');
await probe('products/getAll', { ServiceIds: serviceIds, Limitation: { Count: 100 } }, 'pos');
await probe('outletItems/getAll', { ConsumedUtc: MED, Limitation: { Count: 50 } }, 'pos');
await probe('routingRules/getAll', { Limitation: { Count: 50 } }, 'pos');

// Outil réception / consignes
if (reservationIds.length) {
  await probe('serviceOrderNotes/getAll', { ServiceOrderIds: reservationIds, Limitation: { Count: 50 } }, 'reception');
}
await probe('tasks/getAll', { CreatedUtc: MED, Limitation: { Count: 50 } }, 'reception');
await probe('cashiers/getAll', { Limitation: { Count: 50 } }, 'reception');
await probe('cashierTransactions/getAll', { CreatedUtc: MED, Limitation: { Count: 50 } }, 'reception');
await probe('exchangeRates/getAll', {}, 'reception');

// Yield / RMS
const rates = await probe('rates/getAll', { ServiceIds: bookableIds, Limitation: { Count: 100 } }, 'yield');
const rateIds = (rates?.Rates || []).map((r) => r.Id).slice(0, 3);
if (rateIds.length) {
  await probe('rates/getPricing', { RateId: rateIds[0], ...SHORT }, 'yield');
}
await probe('restrictions/getAll', { ServiceIds: bookableIds, CollidingUtc: SHORT, Limitation: { Count: 100 } }, 'yield');
await probe('services/getAvailability', { ServiceId: bookableIds[0], ...SHORT }, 'yield');
await probe('availabilityBlocks/getAll', { ServiceIds: bookableIds, CollidingUtc: SHORT, Limitation: { Count: 50 } }, 'yield');
await probe('businessSegments/getAll', { ServiceIds: bookableIds, Limitation: { Count: 50 } }, 'yield');
await probe('sources/getAll', { Limitation: { Count: 50 } }, 'yield');
await probe('rules/getAll', { ServiceIds: bookableIds, Limitation: { Count: 50 } }, 'yield');

// ── 3. LA MATRICE ───────────────────────────────────────────────────────────
// Elle sert de spec de connecteur ET d'inventaire pour le formulaire de certif.
const LABELS = {
  socle: 'Socle (configuration, chambres, entreprise)',
  borne: 'Borne de self check-in',
  pos: 'POS Rooftop / facturation',
  reception: 'Outil réception / consignes',
  yield: 'Yield / RMS interne',
};
const byModule = {};
for (const r of results) (byModule[r.module] ??= []).push(r);

let md = `# Mews — matrice de capacités (lecture)

Balayage du Connector API sur la **démo publique** (\`api.mews-demo.com\`), client
\`${CREDS.Client}\`. Les dumps JSON complets sont dans \`scripts/mews-certif/dumps/\`.

\`\`\`
node --env-file=.env.mews-demo scripts/mews-certif/sweep-read.mjs
\`\`\`

⚠️ La démo plafonne les fenêtres de réservation à **100 heures** ; la prod tolère
95 jours. Ne pas conclure de l'une sur l'autre.

`;
for (const [mod, rows] of Object.entries(byModule)) {
  md += `## ${LABELS[mod] || mod}\n\n| Opération | Verdict | Objets | Champs renvoyés |\n|---|---|---|---|\n`;
  for (const r of rows) {
    const detail = r.ok
      ? (r.keys.slice(0, 8).join(', ') || '—')
      : r.msg.replace(/\|/g, '/').slice(0, 90);
    md += `| \`${r.op}\` | ${r.ok ? 'OK' : `KO (${r.status})`} | ${r.count ?? '—'} | ${detail} |\n`;
  }
  md += '\n';
}
const ok = results.filter((r) => r.ok).length;
md += `_${ok}/${results.length} opérations en succès._\n`;
await writeFile(join('docs', 'mews-capacites-lecture.md'), md);

console.log(`\n${ok}/${results.length} OK → docs/mews-capacites-lecture.md`);
