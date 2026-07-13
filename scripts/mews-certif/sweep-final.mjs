// Dernière passe : le reliquat qui touche encore nos besoins.
//
//   node --env-file=.env.mews-demo scripts/mews-certif/sweep-final.mjs
//
// Après quatre sondes, 111 opérations sur 200 étaient exercées. Sur les 89
// restantes, la plupart sont hors scope assumé (fidélité, bons cadeaux, pièces
// d'identité, messagerie, imprimante, TPE Mews, lecture des CB enregistrées).
// Restait ceci, qui compte :
//
//   • Les conditions d'annulation : `getAll` est cassé chez Mews, mais deux
//     variantes existent (par tarif, par réservation) — c'est la borne qui en a
//     besoin pour afficher « annulable jusqu'au… ».
//   • Le titulaire d'une réservation : une résa OTA arrive au nom du booker, pas
//     du client ; la réception doit pouvoir la réattribuer.
//   • Le remboursement d'une VRAIE carte (payments/refund ne marche que sur un
//     CreditCardPayment ou un paiement alternatif — pas sur un paiement externe).
//   • La demande d'empreinte (paymentMethodRequests) : garantir une réservation.
//   • Le prix des extras et le prix à l'occupation (simple / double) : sans ça, le
//     yield est borgne.
//   • Le routage automatique vers un compte société (billingAutomations en
//     écriture — on ne faisait que le lire).
//   • Les jetons d'accès aux ressources : à confronter aux serrures TTHotel.
//   • Les référentiels et la fiscalité.

import { requireDemo, call, section, writeMatrix, results, iso, now } from './lib.mjs';

requireDemo('sweep-final.mjs');

const tag = `CERTIF= ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')}`;

function tzOffsetMin(tz, at) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at).reduce((a, x) => (a[x.type] = x.value, a), {});
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - at.getTime()) / 60000;
}
let HOTEL_TZ = 'UTC';
function midnight(n) {
  const at = new Date(now + n * 864e5);
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: HOTEL_TZ }).format(at).split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  return new Date(guess - tzOffsetMin(HOTEL_TZ, new Date(guess)) * 60000).toISOString();
}

// ── Découverte ──────────────────────────────────────────────────────────────
section('Découverte');
const config = await call('configuration/get', {}, { module: 'socle', label: 'config' });
HOTEL_TZ = config?.Enterprise?.TimeZoneIdentifier || 'UTC';
const currency = config?.Enterprise?.DefaultCurrencyCode || 'EUR';

const services = await call('services/getAll', { Limitation: { Count: 1000 } }, { module: 'socle', label: 'services' });
const recent = await call('reservations/getAll', {
  StartUtc: iso(now), EndUtc: iso(now + 3 * 864e5), TimeFilter: 'Colliding',
  Extent: { Reservations: true }, Limitation: { Count: 100 },
}, { module: 'socle', label: 'résas' });
const resList = recent?.Reservations || [];
const tally = {};
for (const r of resList) if (r.ServiceId) tally[r.ServiceId] = (tally[r.ServiceId] || 0) + 1;
const stayService = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0];
const someRes = resList.find((r) => r.AssignedResourceId && r.CustomerId) ?? resList[0];

const rates = await call('rates/getAll', { ServiceIds: [stayService], Limitation: { Count: 100 } }, { module: 'socle', label: 'tarifs' });
const rate = (rates?.Rates || []).find((r) => r.Type === 'Public' && !r.BaseRateId && r.IsActive && r.IsEnabled);
const products = await call('products/getAll', { ServiceIds: [stayService], Limitation: { Count: 100 } }, { module: 'socle', label: 'produits' });
const productId = (products?.Products || [])[0]?.Id;

// ── 1. Conditions d'annulation (réparation) ─────────────────────────────────
section('Conditions d\'annulation');

// `cancellationPolicies/getAll` répond « Invalid ServiceIds » même sans
// ServiceIds — c'est cassé chez eux. Mais deux variantes existent, et ce sont
// elles dont la borne a besoin : « ce séjour est annulable jusqu'au… ».
if (rate?.Id) {
  await call('cancellationPolicies/getByRates', {
    RateIds: [rate.Id],
    ReservationStartUtc: midnight(30),
    ReservationEndUtc: midnight(32),
  }, { module: 'borne', label: 'conditions d\'annulation PAR TARIF' });
}
if (someRes?.Id) {
  await call('cancellationPolicies/getByReservations', {
    ReservationIds: [someRes.Id],
  }, { module: 'borne', label: 'conditions d\'annulation PAR RÉSERVATION' });
}

// ── 2. Titulaire d'une réservation ──────────────────────────────────────────
section('Titulaire de la réservation');

// Une résa OTA arrive au nom du booker (Booking.com, l'agence), pas du client
// qui dort dans le lit. La réception doit pouvoir la réattribuer.
const newOwner = await call('customers/add', {
  LastName: 'Titulaire', FirstName: 'Les Voiles', OverwriteExisting: false,
}, { module: 'borne', label: 'créer le vrai client' });

if (someRes?.Id && newOwner?.Id) {
  await call('reservations/updateCustomer', {
    ReservationId: someRes.Id, CustomerId: newOwner.Id,
  }, { module: 'borne', label: 'CHANGER le titulaire', retries: 2 });
  // On remet le titulaire d'origine : la démo est partagée.
  if (someRes.CustomerId) {
    await call('reservations/updateCustomer', {
      ReservationId: someRes.Id, CustomerId: someRes.CustomerId,
    }, { module: 'borne', label: 'rétablir le titulaire', retries: 2 });
  }
}

await call('companionships/getAll', {
  Extent: { Companionships: true, Customers: false },
  Limitation: { Count: 20 },
}, { module: 'borne', label: 'accompagnants' });

// ── 3. Carte bancaire : encaisser puis rembourser ───────────────────────────
section('Carte bancaire — encaissement et remboursement');

// payments/refund ne marche NI sur un paiement externe NI sur du cash : il faut
// un CreditCardPayment. `addCreditCard` en crée un (il consigne une CB encaissée
// ailleurs, avec un numéro obfusqué — aucune donnée de carte réelle ne circule).
// C'est le seul chemin pour certifier le remboursement.
//
// ⚠️ SUR LA DÉMO, ÇA NE PASSE PAS : 403 « Invalid identifier », quelle que soit la
// carte ou le format. Le type de paiement « carte » n'est pas activé sur
// l'entreprise de démo (Mews impose que chaque type de paiement soit ouvert
// côté propriété). Conséquence : ni addCreditCard ni refund ne peuvent laisser
// de trace ici → À DEMANDER À MEWS, sinon ces deux endpoints ne seront pas
// accordés faute de démonstration.
const cardClient = await call('customers/add', {
  LastName: 'Carte', FirstName: 'Les Voiles',
  Email: `carte.${now}@lesvoiles.test`, // la demande d'empreinte part par mail : sans adresse, refus
  OverwriteExisting: false,
}, { module: 'pos', label: 'client CB' });

if (cardClient?.Id) {
  const cardPay = await call('payments/addCreditCard', {
    CustomerId: cardClient.Id,
    Amount: { Currency: currency, GrossValue: 60 },
    CreditCard: {
      Type: 'Visa',
      Number: '411111******1111', // obfusqué : Mews n'accepte pas de vraie carte ici
      Name: 'LES VOILES CERTIF',
      Expiration: '12/2030',
    },
  }, { module: 'pos', label: 'consigner un paiement CB' });
  const payId = cardPay?.PaymentId ?? cardPay?.CreditCardPaymentId;

  if (payId) {
    await call('payments/refund', {
      PaymentId: payId,
      AccountId: cardClient.Id,
      Reason: `${tag} — remboursement client`,
    }, { module: 'pos', label: 'REMBOURSER la carte' });
  }

  // Demander une empreinte : garantir une réservation sans encaisser.
  await call('paymentMethodRequests/add', {
    AccountId: cardClient.Id,
    Description: `${tag} — garantie de réservation`,
    ExpirationUtc: iso(now + 7 * 864e5),
    PaymentMethods: ['PaymentCard'], // l'énuméré est PaymentCard, pas CreditCard
  }, { module: 'pos', label: 'demander une empreinte CB' });
}

// ── 4. Prix des extras et prix à l'occupation ───────────────────────────────
section('Yield — extras et occupation');

await call('productCategories/getAll', {
  ServiceIds: [stayService], Limitation: { Count: 50 },
}, { module: 'yield', label: 'catégories d\'extras' });

if (productId) {
  await call('products/updatePrice', {
    ProductId: productId,
    PriceUpdates: [{
      Value: 18,
      FirstTimeUnitStartUtc: midnight(40),
      LastTimeUnitStartUtc: midnight(41),
    }],
  }, { module: 'yield', label: 'changer le prix d\'un extra' });
}

// Le prix à l'occupation : ce qu'on facture en moins pour une simple, en plus
// pour une troisième personne. Sans ça, un yield est borgne.
if (rate?.Id) {
  await call('rates/updateCapacityOffset', {
    CapacityOffsetUpdates: [{ RateId: rate.Id }],
  }, { module: 'yield', label: 'prix selon l\'occupation' });
}

// ── 5. Routage automatique vers un compte société ───────────────────────────
section('Débiteurs société');

const soc = await call('companies/add', {
  Name: `${tag} — Société`,
}, { module: 'groupes', label: 'créer la société' });
const socId = (soc?.Companies || [])[0]?.Id;

await call('companyContracts/getAll', { Limitation: { Count: 20 } }, { module: 'groupes', label: 'contrats société' });

// Le routage automatique : toutes les nuits d'un client d'une société partent
// sur la note de la société. C'est le remplaçant des routing rules (dépréciées).
const auto = await call('billingAutomations/add', {
  BillingAutomations: [{
    Name: `${tag} — routage société`,
    Prepayment: 'All',
    AssignmentTargetType: 'CompanyAsOwner',
    TriggerType: 'Continuous',
    BillAggregationType: 'OnePerReservation',
    ...(socId ? { CompaniesWithRelations: [{ CompanyId: socId, CompanyRelations: { PartnerCompany: true, TravelAgency: false } }] } : {}),
    // RoutedItemTypes n'est pas une liste : c'est un objet dont les SIX booléens
    // sont TOUS obligatoires. Ici on ne route que les nuits et la taxe de séjour.
    Assignments: [{
      ServiceId: stayService,
      RoutedItemTypes: {
        SpaceOrder: true, CityTax: true, AllProducts: false,
        Deposits: false, AdditionalExpenses: false, AllCustomItems: false,
      },
    }],
  }],
}, { module: 'groupes', label: 'créer un routage automatique' });
const autoId = (auto?.BillingAutomations || [])[0]?.Id ?? (auto?.BillingAutomationIds || [])[0];

if (autoId) {
  await call('billingAutomations/delete', {
    BillingAutomationIds: [autoId],
  }, { module: 'groupes', label: 'supprimer le routage' });
}
if (socId) {
  await call('companies/delete', { CompanyIds: [socId] }, { module: 'groupes', label: 'supprimer la société' });
}

// ── 6. Serrures, fiscalité, référentiels ────────────────────────────────────
section('Serrures, fiscalité, référentiels');

// « Resource access tokens » : les jetons d'accès aux ressources. À confronter
// aux serrures TTHotel — si Mews porte déjà les accès, c'est un doublon de moins.
await call('resourceAccessTokens/getAll', {
  CollidingUtc: { StartUtc: iso(now - 7 * 864e5), EndUtc: iso(now + 7 * 864e5) },
  Limitation: { Count: 20 },
}, { module: 'peripheriques', label: 'jetons d\'accès aux chambres', dump: true });

// fiscalMachineCommands/getAll répond « Invalid JSON » à TOUS les corps, y compris
// vide — c'est cassé chez eux (3e anomalie relevée). Sans objet pour nous de toute
// façon : la France n'impose pas de machine fiscale matérielle mais une
// certification logicielle (NF525). On ne le déclare pas.

// enterprises/getAll exige une autorisation « portfolio » (multi-établissements)
// que notre token mono-hôtel n'a pas : Mews renvoie 401 et nous renvoie lui-même
// vers configuration/get. On ne le déclare donc pas.
await call('countries/getAll', {}, { module: 'socle', label: 'pays' });
await call('currencies/getAll', {}, { module: 'socle', label: 'devises' });
await call('languages/getAll', {}, { module: 'socle', label: 'langues' });

await writeMatrix('mews-capacites-final.md', 'Mews — matrice de capacités (dernière passe)', {
  socle: 'Référentiels',
  borne: 'Borne — annulation, titulaire',
  pos: 'POS — carte bancaire, empreintes',
  yield: 'Yield — extras, occupation',
  groupes: 'Débiteurs société',
  rapports: 'Fiscalité',
  peripheriques: 'Serrures / accès',
});

const ko = results.filter((r) => !r.ok);
if (ko.length) {
  console.log('\nÉchecs :');
  for (const r of ko) console.log(`  ${r.op.padEnd(36)} ${r.label} → ${r.msg}`);
}
