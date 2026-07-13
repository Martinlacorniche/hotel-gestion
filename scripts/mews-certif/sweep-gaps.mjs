// Sonde de rattrapage : les trous repérés en recomptant nos besoins.
//
//   node --env-file=.env.mews-demo scripts/mews-certif/sweep-gaps.mjs
//
// Après les trois premières sondes, on exerçait 89 opérations sur 200. En
// confrontant cette liste aux modules qu'on va DÉCLARER, il restait des trous
// gênants — dont plusieurs « à moitié certifiés », ce qui est pire que rien :
// savoir envoyer un lien de paiement sans savoir relire s'il a été payé, c'est
// un module inutilisable.
//
//   • Le cycle de l'option : poser une réservation optionnelle, puis la confirmer.
//   • L'upsell catalogue : un produit Mews (petit-déj, parking) posé sur un séjour.
//   • L'aperçu de facture : les lignes d'un séjour, ce que la borne affiche au départ.
//   • Les notes de FICHE CLIENT (≠ notes de séjour) : l'assistant mails s'en sert.
//   • Le cycle complet du lien de paiement : envoyer, relire, annuler.
//   • Les empreintes CB : facturer un no-show.
//   • Les corrections de notes : modifier le porteur, supprimer une note vide.
//   • Les référentiels : équipements des chambres, origines des résas, relations.
//
// NB — le trou qu'aucune sonde ne peut boucher : les WEBHOOKS. Ce ne sont pas des
// endpoints, ils se configurent sur le profil d'intégration côté Mews. Sans eux,
// on interroge en boucle au lieu d'être notifié. À demander explicitement.

import { requireDemo, call, section, writeMatrix, results, iso, now } from './lib.mjs';

requireDemo('sweep-gaps.mjs');

const tag = `CERTIF~ ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')}`;

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
const guestRes = resList.find((r) => r.AssignedResourceId && r.CustomerId) ?? resList[0];
const guest = guestRes?.CustomerId;

const cats = await call('resourceCategories/getAll', { ServiceIds: [stayService], Limitation: { Count: 50 } }, { module: 'socle', label: 'catégories' });
const ages = await call('ageCategories/getAll', { ServiceIds: [stayService], Limitation: { Count: 20 } }, { module: 'socle', label: 'âges' });
const rates = await call('rates/getAll', { ServiceIds: [stayService], Limitation: { Count: 100 } }, { module: 'socle', label: 'tarifs' });
const products = await call('products/getAll', { ServiceIds: [stayService], Limitation: { Count: 100 } }, { module: 'socle', label: 'produits' });

const rate = (rates?.Rates || []).find((r) => r.Type === 'Public' && !r.BaseRateId && r.IsActive && r.IsEnabled);
const adultAgeId = (ages?.AgeCategories || []).find((a) => a.Classification === 'Adult')?.Id ?? (ages?.AgeCategories || [])[0]?.Id;
const productId = (products?.Products || []).find((p) => p.IsActive !== false)?.Id ?? (products?.Products || [])[0]?.Id;

// Une catégorie qui a encore de la place (la démo est partagée et se sature).
const avail = await call('services/getAvailability', {
  ServiceId: stayService,
  FirstTimeUnitStartUtc: midnight(30),
  LastTimeUnitStartUtc: midnight(33),
}, { module: 'socle', label: 'disponibilité' });
const categoryId = (avail?.CategoryAvailabilities || [])
  .map((c) => ({ id: c.CategoryId, free: Math.min(...(c.Availabilities || [0])) }))
  .filter((c) => c.free > 0).sort((a, b) => b.free - a.free)[0]?.id
  ?? (cats?.ResourceCategories || [])[0]?.Id;

// ── 1. Le cycle de l'option (poser puis confirmer) ───────────────────────────
section('Option posée puis confirmée');

const client = await call('customers/add', {
  LastName: 'Option', FirstName: 'Les Voiles', OverwriteExisting: false,
}, { module: 'borne', label: 'créer le client' });
const clientId = client?.Id;

// Une réservation créée en état « Optional » : c'est l'option qu'on pose au
// téléphone et qui tombe si elle n'est pas confirmée.
const optional = await call('reservations/add', {
  ServiceId: stayService,
  Reservations: [{
    StartUtc: midnight(30), EndUtc: midnight(32),
    CustomerId: clientId,
    RequestedCategoryId: categoryId,
    RateId: rate?.Id,
    PersonCounts: [{ AgeCategoryId: adultAgeId, Count: 2 }],
    State: 'Optional',
  }],
}, { module: 'borne', label: 'poser une OPTION' });
const optId = (optional?.Reservations || [])[0]?.Reservation?.Id;

if (optId) {
  // confirm ne marche QUE depuis l'état Optional — d'où l'option ci-dessus.
  await call('reservations/confirm', {
    ReservationIds: [optId], SendConfirmationEmail: false,
  }, { module: 'borne', label: 'CONFIRMER l\'option' });

  // L'upsell depuis le CATALOGUE Mews (≠ ligne libre) : petit-déj, parking.
  if (productId) {
    await call('reservations/addProduct', {
      ReservationId: optId, ProductId: productId, Count: 1,
    }, { module: 'borne', label: 'ajouter un extra du catalogue' });
    await call('products/getPricing', {
      ProductId: productId,
      FirstTimeUnitStartUtc: midnight(30),
      LastTimeUnitStartUtc: midnight(32),
    }, { module: 'borne', label: 'prix de l\'extra' });
  }

  // Un accompagnant sur le dossier.
  const mate = await call('customers/add', {
    LastName: 'Accompagnant', FirstName: 'Les Voiles', OverwriteExisting: false,
  }, { module: 'borne', label: 'créer un accompagnant' });
  if (mate?.Id) {
    await call('reservations/addCompanion', {
      ReservationId: optId, CustomerId: mate.Id,
    }, { module: 'borne', label: 'ajouter l\'accompagnant' });
    await call('reservations/deleteCompanion', {
      ReservationId: optId, CustomerId: mate.Id,
    }, { module: 'borne', label: 'retirer l\'accompagnant' });
  }

  // L'aperçu de facture : ce que la borne affiche au client avant son départ.
  await call('reservations/getAllItems', {
    ReservationIds: [optId], Currency: currency,
  }, { module: 'borne', label: 'lignes du séjour (aperçu facture)' });

  await call('reservations/cancel', {
    ReservationIds: [optId], Notes: tag, PostCancellationFee: false, SendEmail: false,
  }, { module: 'borne', label: 'annuler (nettoyage)' });
}

// ── 2. Notes de FICHE CLIENT (≠ notes de séjour) ─────────────────────────────
section('Notes de fiche client');

// Deux objets distincts que Mews ne mélange pas : la note de SÉJOUR
// (serviceOrderNotes, déjà certifiée) vit sur le dossier ; la note de FICHE
// (accountNotes) vit sur le client et le suit d'un séjour à l'autre. C'est
// celle-ci que l'assistant mails utilise pour l'historique.
if (clientId) {
  const note = await call('accountNotes/add', {
    AccountNotes: [{
      AccountId: clientId,
      Content: `${tag} — client fidèle, préfère les étages hauts`,
      Classifications: ['FrontOffice'],
    }],
  }, { module: 'reception', label: 'note sur la fiche client' });
  const noteId = (note?.AccountNotes || [])[0]?.Id;

  await call('accountNotes/getAll', {
    AccountIds: [clientId], Limitation: { Count: 20 },
  }, { module: 'reception', label: 'relire les notes de fiche' });

  if (noteId) {
    // Asymétrie piégeuse : à l'AJOUT, Classifications est un TABLEAU d'énumérés ;
    // à la MODIFICATION, c'est un OBJET de booléens (chacun en « update value »).
    await call('accountNotes/update', {
      AccountNoteUpdates: [{
        AccountNoteId: noteId,
        Content: { Value: `${tag} — corrigée` },
        Classifications: { FrontOffice: { Value: true }, PreviousStay: { Value: true } },
      }],
    }, { module: 'reception', label: 'corriger la note de fiche', retries: 2 });
    await call('accountNotes/delete', {
      AccountNoteIds: [noteId],
    }, { module: 'reception', label: 'supprimer la note de fiche' });
  }

  await call('customers/getRelationships', {
    CustomerIds: [clientId], Limitation: { Count: 20 },
  }, { module: 'reception', label: 'relations du profil' });
}

// ── 3. Le cycle complet du lien de paiement ─────────────────────────────────
section('Lien de paiement — cycle complet');

// Savoir envoyer un lien sans savoir relire s'il a été payé ni l'annuler, c'est
// un module inutilisable. On certifie les trois.
if (clientId) {
  const req = await call('paymentRequests/add', {
    PaymentRequests: [{
      AccountId: clientId,
      Amount: { Currency: currency, Value: 80 },
      Type: 'Payment',
      Reason: 'Deposit',
      ExpirationUtc: iso(now + 7 * 864e5),
      Description: `${tag} — acompte`,
    }],
    SendPaymentRequestEmails: false,
  }, { module: 'pos', label: 'envoyer un lien de paiement' });
  const reqId = (req?.PaymentRequests || [])[0]?.Id;

  const all = await call('paymentRequests/getAll', {
    AccountIds: [clientId], Limitation: { Count: 20 },
  }, {
    module: 'pos', label: 'relire les liens (payé ?)',
    retries: 4, until: (j) => (j.PaymentRequests || []).length > 0,
  });
  const toCancel = reqId ?? (all?.PaymentRequests || []).find((p) => p.State === 'Pending')?.Id;

  if (toCancel) {
    // Seuls les liens « Pending » sont annulables.
    await call('paymentRequests/cancel', {
      PaymentRequestIds: [toCancel],
    }, { module: 'pos', label: 'annuler le lien' });
  }

  // Les empreintes CB en cours : c'est ce qui permet de facturer un no-show.
  await call('preauthorizations/getAllByCustomers', {
    CustomerIds: [guest ?? clientId],
  }, { module: 'pos', label: 'empreintes CB en cours' });
}

// ── 4. Corrections de notes ─────────────────────────────────────────────────
section('Corrections de notes');

if (clientId) {
  const b = await call('bills/add', {
    Bills: [{ AccountId: clientId, Name: `${tag} — note à corriger` }],
  }, { module: 'pos', label: 'ouvrir une note' });
  const billId = (b?.Bills || [])[0]?.Id;
  if (billId) {
    // Une note FERMÉE est immuable : on ne corrige que tant qu'elle est ouverte.
    await call('bills/update', {
      BillsUpdates: [{ BillId: billId, AccountId: { Value: clientId } }],
    }, { module: 'pos', label: 'corriger le porteur de la note' });
    // bills/delete exige une note VIDE (celle-ci l'est).
    await call('bills/delete', {
      BillIds: [billId],
    }, { module: 'pos', label: 'supprimer la note vide' });
  }
}

// ── 5. Référentiels et suivi ────────────────────────────────────────────────
section('Référentiels');

const feats = await call('resourceFeatures/getAll', {
  ServiceIds: [stayService], Limitation: { Count: 50 },
}, { module: 'socle', label: 'équipements des chambres' });
const featIds = (feats?.ResourceFeatures || []).map((f) => f.Id).slice(0, 10);
if (featIds.length) {
  await call('resourceFeatureAssignments/getAll', {
    ResourceFeatureIds: featIds, Limitation: { Count: 100 },
  }, { module: 'socle', label: 'quelle chambre a quel équipement' });
}

await call('sourceAssignments/getAll', {
  UpdatedUtc: { StartUtc: iso(now - 30 * 864e5), EndUtc: iso(now) },
  Limitation: { Count: 50 },
}, { module: 'rapports', label: 'origine des réservations' });

await call('availabilityAdjustments/getAll', {
  Limitation: { Count: 50 },
}, { module: 'yield', label: 'ajustements de disponibilité' });

await call('productServiceOrders/getAll', {
  ServiceIds: [stayService], Limitation: { Count: 50 },
}, { module: 'rapports', label: 'extras vendus' });

await call('commands/getAllActive', {}, { module: 'peripheriques', label: 'commandes en cours (encodeur)' });

// ── Matrice ─────────────────────────────────────────────────────────────────
await writeMatrix('mews-capacites-rattrapage.md', 'Mews — matrice de capacités (rattrapage)', {
  socle: 'Découverte & référentiels',
  borne: 'Borne — option, extras, aperçu de facture',
  reception: 'Réception — notes de fiche client',
  pos: 'POS — liens de paiement, corrections',
  rapports: 'Rapports',
  yield: 'Yield',
  peripheriques: 'Périphériques',
});

const ko = results.filter((r) => !r.ok);
if (ko.length) {
  console.log('\nÉchecs :');
  for (const r of ko) console.log(`  ${r.op.padEnd(34)} ${r.label} → ${r.msg}`);
}
