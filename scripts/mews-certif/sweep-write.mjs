// Sonde d'ÉCRITURE du Connector API, sur la démo publique Mews.
//
//   node --env-file=.env.mews-demo scripts/mews-certif/sweep-write.mjs
//
// C'est la pièce maîtresse du dossier de certification : Mews relit les logs
// d'appels de la démo, et n'accorde en production QUE les opérations qu'il nous
// a vu exercer correctement. On ne joue donc pas une liste d'appels isolés — on
// joue un PARCOURS CLIENT réel, celui de nos modules :
//
//   1. Borne de self check-in  — profil, devis, réservation, chambre, check-in,
//                                extras, note, facture, check-out.
//   2. POS Rooftop             — consommation imputée, encaissement, annulation.
//   3. Réception / consignes   — notes de séjour, tâches, chambre hors service.
//   4. Yield / RMS             — prix poussé, restriction posée, dispo ajustée.
//
// Rien ne touche la prod : garde-fou dans lib.mjs (la base DOIT être mews-demo).

import { requireDemo, call, section, writeMatrix, results, iso, now } from './lib.mjs';

requireDemo('sweep-write.mjs');

// Mews raisonne en « time units » calés sur MINUIT LOCAL de l'hôtel, exprimé en
// UTC. Minuit UTC ne tombe donc pas sur un début de time unit : les opérations
// de yield le refusent (« FirstTimeUnitStartUtc is not start of TimeUnit »).
// Ici la démo est à Europe/Budapest ; Les Voiles sera à Europe/Paris. On calcule.
function tzOffsetMin(tz, at) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at).reduce((a, x) => (a[x.type] = x.value, a), {});
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return (asUtc - at.getTime()) / 60000;
}
let HOTEL_TZ = 'UTC';
// Minuit local du jour (maintenant + n jours), rendu en instant UTC.
function midnight(n) {
  const at = new Date(now + n * 864e5);
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: HOTEL_TZ })
    .format(at).split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const off = tzOffsetMin(HOTEL_TZ, new Date(guess));
  return new Date(guess - off * 60000).toISOString();
}

const stamp = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
const tag = `CERTIF ${stamp}`; // pour repérer nos objets dans le bazar de la démo

// ── Découverte : tout ce qu'il faut pour écrire ──────────────────────────────
section('Découverte');
const config = await call('configuration/get', {}, { module: 'socle', label: 'config' });
// ⚠️ LA DEVISE N'EST PAS DANS `DefaultCurrencyCode` — ce champ n'existe pas dans la réponse
// de `configuration/get`. Elle est dans `Enterprise.Currencies[]`, sur la ligne `IsDefault`.
// On lisait donc `undefined` et on retombait en silence sur EUR, alors que la démo est en GBP
// — d'où le 403 « Invalid identifier » de `payments/addCreditCard` (Milan Bezdecka, Mews,
// 2026-07-22 : le même appel passe chez lui, en GBP, avec nos tokens).
const currency = (config?.Enterprise?.Currencies || []).find((c) => c.IsDefault)?.Currency
  || config?.Enterprise?.DefaultCurrencyCode || 'EUR';
const taxEnv = config?.Enterprise?.TaxEnvironmentCode;
HOTEL_TZ = config?.Enterprise?.TimeZoneIdentifier || 'UTC';

await call('taxEnvironments/getAll', {}, { module: 'socle', label: 'taxes' });

const services = await call('services/getAll', { Limitation: { Count: 1000 } }, { module: 'socle', label: 'services' });

// Le bac à sable est pollué (495 services) : on ne devine pas le service
// d'hébergement, on prend celui que les réservations utilisent vraiment.
const recent = await call('reservations/getAll', {
  StartUtc: iso(now), EndUtc: iso(now + 3 * 864e5), TimeFilter: 'Colliding',
  Extent: { Reservations: true }, Limitation: { Count: 100 },
}, { module: 'socle', label: 'résas existantes' });
const tally = {};
for (const r of recent?.Reservations || []) if (r.ServiceId) tally[r.ServiceId] = (tally[r.ServiceId] || 0) + 1;
const stayService = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0];
const svcName = (services?.Services || []).find((s) => s.Id === stayService)?.Name;
console.log(`   hébergement : « ${svcName} » · devise ${currency} · env. fiscal ${taxEnv}`);

const cats = await call('resourceCategories/getAll', { ServiceIds: [stayService], Limitation: { Count: 50 } }, { module: 'socle', label: 'catégories' });
const ages = await call('ageCategories/getAll', { ServiceIds: [stayService], Limitation: { Count: 20 } }, { module: 'socle', label: 'âges' });
const rates = await call('rates/getAll', { ServiceIds: [stayService], Limitation: { Count: 50 } }, { module: 'socle', label: 'tarifs' });

const adultAgeId = (ages?.AgeCategories || []).find((a) => a.Classification === 'Adult')?.Id
  ?? (ages?.AgeCategories || [])[0]?.Id;

// On ne prend pas la première catégorie venue : la démo est partagée et
// régulièrement saturée (« this property has no availability »). On demande à
// Mews qui a encore de la place sur notre fenêtre, et on réserve là.
const avail = await call('services/getAvailability', {
  ServiceId: stayService,
  FirstTimeUnitStartUtc: midnight(-1),
  LastTimeUnitStartUtc: midnight(22),
}, { module: 'socle', label: 'disponibilité' });
const freeByCat = (avail?.CategoryAvailabilities || [])
  .map((c) => ({ id: c.CategoryId, min: Math.min(...(c.Availabilities || [0])) }))
  .filter((c) => Number.isFinite(c.min))
  .sort((a, b) => b.min - a.min);
const categoryId = freeByCat[0]?.min > 0
  ? freeByCat[0].id
  : (cats?.ResourceCategories || [])[0]?.Id;

// Trois familles de tarifs : Public, Private, et AvailabilityBlock. Ces derniers
// appartiennent à un bloc d'allotement et Mews REFUSE d'y rattacher une
// réservation. On veut un tarif public, actif, et RACINE — racine parce que les
// tarifs dérivés se recalculent tout seuls et ne se pilotent pas (yield).
const bookable = (rates?.Rates || []).filter(
  (r) => r.Type !== 'AvailabilityBlock' && r.IsActive && r.IsEnabled,
);
const rate = bookable.find((r) => r.Type === 'Public' && !r.BaseRateId)
  ?? bookable.find((r) => !r.BaseRateId)
  ?? bookable[0];
const rateId = rate?.Id;

// Une consommation ne se pose PAS sur le service d'hébergement (les nuits y sont
// postées par Mews). Il faut un service « additionnel » — le bar, le restaurant.
// On prend celui que les lignes existantes utilisent vraiment.
const pastItems = await call('orderItems/getAll', {
  ConsumedUtc: { StartUtc: iso(now - 30 * 864e5), EndUtc: iso(now) },
  Limitation: { Count: 500 },
}, { module: 'socle', label: 'lignes existantes' });
const addTally = {};
const byId = Object.fromEntries((services?.Services || []).map((s) => [s.Id, s]));
const taxTally = {};
for (const it of pastItems?.OrderItems || []) {
  const s = byId[it.ServiceId];
  if (s?.Data?.Discriminator === 'Additional') addTally[it.ServiceId] = (addTally[it.ServiceId] || 0) + 1;
  // Le code de taxe attendu est un code de TAUX (« UK-2022-20% »), pas le code
  // d'environnement fiscal (« UK-2022 »). Aucune opération ne le liste : on le
  // relève sur les lignes existantes, c'est-à-dire sur ce que l'hôtel applique
  // vraiment.
  for (const t of it.Amount?.TaxValues || []) if (t.Code) taxTally[t.Code] = (taxTally[t.Code] || 0) + 1;
}
const posService = Object.entries(addTally).sort((a, b) => b[1] - a[1])[0]?.[0];
const taxCode = Object.entries(taxTally).sort((a, b) => b[1] - a[1])[0]?.[0];
console.log(`   tarif « ${rate?.Name} » (${rate?.Type}) · POS « ${byId[posService]?.Name || '?'} » · taxe ${taxCode} · fuseau ${HOTEL_TZ}`);

if (!stayService || !categoryId || !adultAgeId || !rateId) {
  console.error('\nDécouverte incomplète — impossible de réserver. Arrêt.');
  await writeMatrix('mews-capacites-ecriture.md', 'Mews — matrice de capacités (écriture)', LABELS);
  process.exit(1);
}

const persons = [{ AgeCategoryId: adultAgeId, Count: 2 }];
const stayData = (startDay, endDay) => ({
  StartUtc: midnight(startDay), EndUtc: midnight(endDay),
  RequestedCategoryId: categoryId, RateId: rateId, PersonCounts: persons,
});

// ── 1. Borne de self check-in : le parcours complet ──────────────────────────
section('Borne — parcours client complet');

// Le client se présente : on crée (ou retrouve) son profil.
const cust = await call('customers/add', {
  LastName: 'Certification', FirstName: 'Les Voiles',
  Email: `certif.${now}@lesvoiles.test`,
  NationalityCode: 'FR', OverwriteExisting: false,
}, { module: 'borne', label: 'créer le profil client' });
const customerId = cust?.Id ?? cust?.Customer?.Id;

if (customerId) {
  await call('customers/update', {
    CustomerId: customerId, Phone: '+33 4 94 00 00 00',
  }, { module: 'borne', label: 'compléter le profil' });
}

// Devis avant réservation (la borne affiche un prix).
await call('reservations/price', {
  ServiceId: stayService,
  Reservations: [{ ...stayData(1, 3), CustomerId: customerId }],
}, { module: 'borne', label: 'chiffrer un séjour' });

// Séjour A : hier → aujourd'hui. C'est le seul montage qui permet d'enchaîner
// check-in ET check-out le même jour : Mews refuse de démarrer un séjour futur,
// et refuse de clôturer avant le dernier jour du séjour.
const resA = await call('reservations/add', {
  ServiceId: stayService,
  Reservations: [{ ...stayData(-1, 0), CustomerId: customerId }],
}, { module: 'borne', label: 'réserver (séjour en cours)' });
// La réponse enveloppe : { Reservations: [ { Identifier, Reservation: { Id } } ] }
const idA = (resA?.Reservations || [])[0]?.Reservation?.Id;

// Séjour B : dans le futur — il servira à la modification et à l'annulation.
const resB = await call('reservations/add', {
  ServiceId: stayService,
  Reservations: [{ ...stayData(20, 22), CustomerId: customerId }],
}, { module: 'borne', label: 'réserver (séjour futur)' });
const idB = (resB?.Reservations || [])[0]?.Reservation?.Id;

if (idA) {
  // Attribution d'une chambre : la borne doit pouvoir choisir. Le check-in
  // exige une chambre assignée ET inspectée (propre) — si la démo n'en a pas,
  // le start échouera et la matrice le dira.
  const resources = await call('resources/getAll', { Limitation: { Count: 200 } }, { module: 'borne', label: 'chambres' });
  // Une chambre n'est pas « dans » une catégorie sur l'objet Resource : le lien
  // passe par une table d'affectation dédiée. Assigner une chambre d'une autre
  // catégorie vaut « Invalid AssignedResourceId ».
  const links = await call('resourceCategoryAssignments/getAll', {
    ResourceCategoryIds: [categoryId], Limitation: { Count: 500 },
  }, { module: 'borne', label: 'chambres par catégorie' });
  const inCategory = (links?.ResourceCategoryAssignments || []).map((a) => a.ResourceId);

  // Mews attribue souvent une chambre tout seul à la création. On la reprend si
  // elle existe, sinon on en choisit une DANS LA CATÉGORIE réservée — en prendre
  // une au hasard vaut « Invalid AssignedResourceId ».
  const autoRoom = (resA?.Reservations || [])[0]?.Reservation?.AssignedResourceId;
  const roomId = autoRoom ?? inCategory[0];

  if (roomId) {
    // On exerce l'attribution dans tous les cas : la borne doit savoir poser une
    // chambre sur un dossier, et c'est un endpoint à certifier.
    await call('reservations/update', {
      ReservationId: idA,
      ReservationUpdates: [{ ReservationId: idA, AssignedResourceId: { Value: roomId } }],
    }, { module: 'borne', label: 'attribuer la chambre', retries: 2 });

    // Mews refuse le check-in tant que la chambre n'est pas INSPECTÉE. Sur la
    // démo elles traînent en « Dirty ». La borne ne fera pas cet appel — le
    // gouvernant, si : c'est le même endpoint.
    await call('resources/update', {
      ResourceUpdates: [{ ResourceId: roomId, State: { Value: 'Inspected' } }],
    }, { module: 'reception', label: 'chambre inspectée (housekeeping)' });
  }

  await call('reservations/start', { ReservationId: idA }, { module: 'borne', label: 'CHECK-IN' });

  // Note de séjour (la réception écrit sur le dossier).
  const note = await call('serviceOrderNotes/add', {
    ServiceOrderNotes: [{ ServiceOrderId: idA, Text: `${tag} — arrivée tardive, clés au coffre` }],
  }, { module: 'reception', label: 'poser une note de séjour' });
  const noteId = (note?.ServiceOrderNotes || [])[0]?.Id;
  if (noteId) {
    await call('serviceOrderNotes/update', {
      ServiceOrderNoteUpdates: [{ ServiceOrderNoteId: noteId, Text: { Value: `${tag} — note corrigée` } }],
    }, { module: 'reception', label: 'corriger la note' });
    await call('serviceOrderNotes/delete', {
      ServiceOrderNoteIds: [noteId],
    }, { module: 'reception', label: 'supprimer la note' });
  }
}

// ── 2. POS Rooftop : consommation imputée puis encaissée ─────────────────────
section('POS Rooftop — consommation et encaissement');

if (customerId && posService) {
  // Une note dédiée : c'est elle qu'on chargera, encaissera, puis clôturera.
  const bill = await call('bills/add', {
    Bills: [{ AccountId: customerId, Name: tag }],
  }, { module: 'pos', label: 'ouvrir une note' });
  const billId = (bill?.Bills || [])[0]?.Id;

  // Une conso libre (produit absent du catalogue) imputée sur cette note.
  // Une note ne se clôture qu'ÉQUILIBRÉE : la charge et le règlement doivent
  // tomber juste (2 × 12 = 24, encaissés 24).
  const order = await call('orders/add', {
    ServiceId: posService,
    AccountId: customerId,
    ...(billId ? { BillId: billId } : {}),
    ...(idA ? { LinkedReservationId: idA } : {}),
    Items: [{
      Name: 'Spritz Rooftop',
      UnitCount: 2,
      UnitAmount: { Currency: currency, GrossValue: 12, TaxCodes: [taxCode] },
    }],
  }, { module: 'pos', label: 'imputer une consommation' });
  const orderId = order?.OrderId;

  const pay = await call('payments/addExternal', {
    AccountId: customerId,
    ...(billId ? { BillId: billId } : {}),
    Amount: { Currency: currency, GrossValue: 24 },
    Type: 'CreditCard', // TPE physique — obligatoire en environnement légal FR
    Notes: tag,
  }, { module: 'pos', label: 'encaisser (TPE)' });

  // Deux corrections, qui ne veulent PAS dire la même chose et ne se traitent
  // pas pareil (payments/refund ne marche pas sur un paiement externe) :
  //
  //   • erreur de saisie → on ANNULE le paiement (il n'aurait jamais dû exister)
  //   • vrai remboursement → paiement externe NÉGATIF (l'argent sort vraiment,
  //     donc il doit rester tracé, pas être effacé)
  await call('payments/addExternal', {
    AccountId: customerId,
    Amount: { Currency: currency, GrossValue: -8 },
    Type: 'Cash',
    Notes: `${tag} — remboursement partiel en espèces`,
  }, { module: 'pos', label: 'rembourser (paiement négatif)' });

  const badPay = await call('payments/addExternal', {
    AccountId: customerId,
    Amount: { Currency: currency, GrossValue: 5 },
    Type: 'Cash',
    Notes: `${tag} — saisie erronée, à annuler`,
  }, { module: 'pos', label: 'encaisser (à annuler)' });
  const badPayId = badPay?.ExternalPaymentId;
  if (badPayId) {
    await call('payments/updateState', {
      PaymentId: badPayId, State: 'Canceled',
    }, { module: 'pos', label: 'annuler un paiement (erreur de saisie)' });
  }

  // Lien de paiement (l'équivalent Mews de notre lien Stripe).
  await call('paymentRequests/add', {
    PaymentRequests: [{
      AccountId: customerId,
      Amount: { Currency: currency, Value: 50 },
      Type: 'Payment',
      Reason: 'Deposit',
      ExpirationUtc: iso(now + 7 * 864e5),
      Description: `${tag} — acompte`,
    }],
    SendPaymentRequestEmails: false, // on ne spamme pas la boîte de démo
  }, { module: 'pos', label: 'demander un paiement (lien)' });

  // Erreur de saisie au bar : une conso posée à tort, sur une AUTRE note (pas
  // celle qu'on va clôturer — une note fermée est immuable, on ne peut plus rien
  // y annuler).
  const oops = await call('orders/add', {
    ServiceId: posService,
    AccountId: customerId,
    Items: [{
      Name: 'Café (erreur de saisie)',
      UnitCount: 1,
      UnitAmount: { Currency: currency, GrossValue: 3, TaxCodes: [taxCode] },
    }],
  }, { module: 'pos', label: 'imputer une conso à tort' });
  if (oops?.OrderId) {
    // `OrderIds` n'est PAS un filtre accepté : on relit par compte + fenêtre de
    // création, puis on retrouve notre ligne par son libellé.
    // Cohérence différée : la ligne met 1 à 3 s à être indexée, et d'ici là
    // Mews renvoie « 0 ligne » sans erreur. On attend qu'elle apparaisse, sinon
    // l'annulation qui suit est sautée en silence.
    const items = await call('orderItems/getAll', {
      AccountIds: [customerId],
      CreatedUtc: { StartUtc: iso(now - 3600e3), EndUtc: iso(now + 3600e3) },
      Limitation: { Count: 100 },
    }, {
      module: 'pos', label: 'relire les lignes',
      retries: 5, until: (j) => (j.OrderItems || []).length > 0,
    });
    // Une ligne n'expose pas d'OrderId : son libellé est dans `BillingName`.
    const itemId = (items?.OrderItems || [])
      .find((i) => (i.BillingName || '').startsWith('Café'))?.Id;
    if (itemId) {
      await call('orderItems/cancel', { OrderItemIds: [itemId] }, { module: 'pos', label: 'annuler la ligne' });
    }
  }

  // La note est équilibrée (24 chargés, 24 encaissés) : on la clôture et on
  // édite la facture — c'est le départ du client.
  if (billId) {
    await call('bills/close', { BillId: billId, Type: 'Receipt' }, { module: 'pos', label: 'clôturer la note' });
    await call('bills/getPdf', { BillId: billId }, { module: 'pos', label: 'éditer la facture PDF' });
  }
}

// Départ : Mews n'autorise le check-out qu'au dernier jour du séjour — d'où le
// séjour A monté hier→aujourd'hui.
if (idA) {
  await call('reservations/process', {
    ReservationId: idA, CloseBills: true, AllowOpenBalance: true, Notes: tag,
  }, { module: 'borne', label: 'CHECK-OUT' });
}

// ── 3. Séjour futur : modification puis annulation ───────────────────────────
section('Borne — modification et annulation');

if (idB) {
  await call('reservations/updateInterval', {
    ReservationId: idB,
    StartUtc: midnight(21), EndUtc: midnight(24),
    ChargeCancellationFee: false,
  }, { module: 'borne', label: 'décaler les dates' });

  await call('reservations/cancel', {
    ReservationIds: [idB], Notes: `${tag} — annulation de test`, PostCancellationFee: false, SendEmail: false,
  }, { module: 'borne', label: 'annuler la réservation' });
}

// ── 4. Réception / consignes : tâches et chambre hors service ────────────────
section('Réception — tâches et blocages');

const task = await call('tasks/add', {
  Name: `${tag} — vérifier la clim ch. 12`,
  DeadlineUtc: iso(now + 864e5),
  Description: 'Remonté par la sonde de certification.',
}, { module: 'reception', label: 'créer une tâche' });
const taskId = task?.TaskId;
if (taskId) {
  await call('tasks/close', { TaskIds: [taskId] }, { module: 'reception', label: 'clore la tâche' });
}

const allRes = await call('resources/getAll', { Limitation: { Count: 50 } }, { module: 'reception', label: 'chambres' });
const blockRoom = (allRes?.Resources || [])[0]?.Id;
if (blockRoom) {
  // « OutOfService » n'existe pas ici : c'est un ÉTAT de chambre (resources/update),
  // pas un blocage. Un block ne connaît que OutOfOrder et InternalUse.
  const block = await call('resourceBlocks/add', {
    ResourceBlocks: [{
      ResourceId: blockRoom, Name: `${tag} — travaux`, Type: 'OutOfOrder',
      StartUtc: midnight(30), EndUtc: midnight(31),
    }],
  }, { module: 'reception', label: 'bloquer une chambre (travaux)' });
  const blockId = (block?.ResourceBlocks || [])[0]?.Id;
  if (blockId) {
    await call('resourceBlocks/delete', { ResourceBlockIds: [blockId] }, { module: 'reception', label: 'débloquer la chambre' });
  }
}

// ── 5. Yield / RMS : pousser un prix, poser une restriction, ajuster la dispo ─
section('Yield — prix, restrictions, disponibilité');

// Le tarif retenu plus haut est déjà racine et non-bloc : c'est celui qu'on
// pilote. (Un tarif dérivé se recalcule seul, Mews refuse qu'on le force.)
const rootRateId = rateId;

await call('rates/updatePrice', {
  RateId: rootRateId,
  PriceUpdates: [{
    CategoryId: categoryId,
    Value: 189,
    FirstTimeUnitStartUtc: midnight(40),
    LastTimeUnitStartUtc: midnight(42),
  }],
}, { module: 'yield', label: 'pousser un prix' });

// `Days` est un objet de 7 booléens (pas une liste), et les durées sont en
// ISO 8601. Un séjour de 2 nuits minimum le week-end.
const WEEKEND = {
  Monday: false, Tuesday: false, Wednesday: false, Thursday: false,
  Friday: true, Saturday: true, Sunday: false,
};
const conditions = {
  Type: 'Stay',
  ExactRateId: rootRateId,
  ResourceCategoryId: categoryId,
  StartUtc: midnight(40), EndUtc: midnight(42),
  Days: WEEKEND,
};

await call('restrictions/set', {
  ServiceId: stayService,
  Data: [{ ...conditions, MinLength: 'P0M2DT0H0M0S' }],
}, { module: 'yield', label: 'poser une restriction (2 nuits mini le week-end)' });

// La levée ne se fait pas par identifiant : on rejoue EXACTEMENT les mêmes
// conditions, et Mews redécoupe.
await call('restrictions/clear', {
  ServiceId: stayService,
  Data: [conditions],
}, { module: 'yield', label: 'lever la restriction' });

await call('services/updateAvailability', {
  ServiceId: stayService,
  AvailabilityUpdates: [{
    ResourceCategoryId: categoryId,
    FirstTimeUnitStartUtc: midnight(40),
    LastTimeUnitStartUtc: midnight(41),
    // Ajustement RELATIF, jamais absolu : -1 retire une chambre à la vente.
    UnitCountAdjustment: { Value: -1 },
  }],
}, { module: 'yield', label: 'ajuster la disponibilité' });

// On remet la disponibilité comme on l'a trouvée (la démo est partagée).
await call('services/updateAvailability', {
  ServiceId: stayService,
  AvailabilityUpdates: [{
    ResourceCategoryId: categoryId,
    FirstTimeUnitStartUtc: midnight(40),
    LastTimeUnitStartUtc: midnight(41),
    UnitCountAdjustment: {}, // sans Value = efface l'ajustement
  }],
}, { module: 'yield', label: 'rétablir la disponibilité' });

// ── Matrice ─────────────────────────────────────────────────────────────────
const LABELS = {
  socle: 'Découverte (lecture préalable)',
  borne: 'Borne de self check-in',
  pos: 'POS Rooftop / facturation',
  reception: 'Outil réception / consignes',
  yield: 'Yield / RMS interne',
};
await writeMatrix('mews-capacites-ecriture.md', 'Mews — matrice de capacités (écriture)', LABELS);

const ko = results.filter((r) => !r.ok);
if (ko.length) {
  console.log('\nÉchecs à traiter avant la certification :');
  for (const r of ko) console.log(`  ${r.op.padEnd(28)} ${r.label} → ${r.msg}`);
}
