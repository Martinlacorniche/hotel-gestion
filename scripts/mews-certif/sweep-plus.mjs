// Sonde complémentaire : ce que les deux premières laissaient de côté.
//
//   node --env-file=.env.mews-demo scripts/mews-certif/sweep-plus.mjs
//
// Sur les 200 opérations du Connector API, les sondes lecture + écriture en
// exerçaient 65. Celle-ci ajoute les familles qui nous serviront et qu'il vaut
// mieux certifier MAINTENANT (un endpoint non démontré n'est pas accordé, et
// l'ajouter après coup, c'est repasser une manche) :
//
//   1. Rapports & compta — la vraie source financière (écritures comptables,
//      balances, encours), et l'export en masse pour alimenter un outil tiers.
//   2. Transfert de charge — déplacer une conso d'une note à une autre : le
//      « mettez ça sur ma chambre » réclamé après coup au bar.
//   3. Groupes & allotements — le chantier Groupes/Mariages, plus les comptes
//      société (billing automations, qui remplacent les routing rules dépréciées).
//   4. RMS avancé & housekeeping — créer des tarifs (pas seulement en pousser le
//      prix), piloter le surbooking, lire l'état d'occupation temps réel.
//   5. Encodeur de clefs — Mews sait piloter un key cutter.
//
// Volontairement HORS scope : bons cadeaux, imprimante à tickets, TPE Mews
// (on a Stripe et notre propre terminal), pièces d'identité, adresses,
// messagerie invité.

import { requireDemo, call, section, writeMatrix, results, iso, now } from './lib.mjs';

requireDemo('sweep-plus.mjs');

const stamp = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
const tag = `CERTIF+ ${stamp}`;

// Même règle que dans la sonde d'écriture : les « time units » sont calés sur
// minuit LOCAL de l'hôtel, pas minuit UTC.
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
const tally = {};
for (const r of recent?.Reservations || []) if (r.ServiceId) tally[r.ServiceId] = (tally[r.ServiceId] || 0) + 1;
const stayService = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0];
// L'encodeur refuse une réservation sans chambre (« Cannot create a key for a
// reservation without an assigned room »), et le transfert de charge veut un
// client réellement logé. On prend donc, dans l'ordre : une résa EN COURS avec
// chambre (une clef se coupe à l'arrivée), sinon une résa attribuée.
const withRoom = (recent?.Reservations || []).filter((r) => r.AssignedResourceId && r.CustomerId);
const someReservation = withRoom.find((r) => r.State === 'Started')
  ?? withRoom[0]
  ?? (recent?.Reservations || [])[0];

const cats = await call('resourceCategories/getAll', { ServiceIds: [stayService], Limitation: { Count: 50 } }, { module: 'socle', label: 'catégories' });
const categoryIds = (cats?.ResourceCategories || []).map((c) => c.Id);

const rates = await call('rates/getAll', { ServiceIds: [stayService], Limitation: { Count: 100 } }, { module: 'socle', label: 'tarifs' });
const rate = (rates?.Rates || []).find((r) => r.Type === 'Public' && !r.BaseRateId && r.IsActive && r.IsEnabled);
const rateGroupId = rate?.GroupId;

// Le code de taxe est un code de TAUX (« UK-2022-20% »), qu'aucune opération ne
// liste : on le relève sur les lignes existantes.
const pastItems = await call('orderItems/getAll', {
  ConsumedUtc: { StartUtc: iso(now - 30 * 864e5), EndUtc: iso(now) },
  Limitation: { Count: 200 },
}, { module: 'socle', label: 'lignes existantes' });
const taxTally = {};
for (const it of pastItems?.OrderItems || []) {
  for (const t of it.Amount?.TaxValues || []) if (t.Code) taxTally[t.Code] = (taxTally[t.Code] || 0) + 1;
}
const taxCode = Object.entries(taxTally).sort((a, b) => b[1] - a[1])[0]?.[0];

// ── 1. Rapports & comptabilité ──────────────────────────────────────────────
section('Rapports & comptabilité');

// Les écritures comptables : LA source financière canonique. Bien plus fiable
// que de recoller orderItems + payments à la main comme on le fait aujourd'hui.
const acct = await call('accountingItems/getAll', {
  Extent: { OrderItems: true, Payments: true, CreditCardPayments: true },
  ClosedUtc: { StartUtc: iso(now - 30 * 864e5), EndUtc: iso(now) },
  Limitation: { Count: 100 },
}, { module: 'rapports', label: 'écritures comptables', dump: true });

// Les balances par grand livre : qui doit quoi (débiteurs, city ledger).
// L'intervalle de dates s'appelle Start/End (des DATES, pas des instants) et il
// est plafonné à un mois.
await call('ledgerBalances/getAll', {
  Date: { Start: iso(now - 7 * 864e5).slice(0, 10), End: iso(now).slice(0, 10) },
  LedgerTypes: ['Revenue', 'Payment', 'Guest', 'City'],
  Limitation: { Count: 100 },
}, { module: 'rapports', label: 'balances des grands livres' });

// Les encours d'un client (ce qu'il reste à payer).
const anyCustomer = someReservation?.CustomerId;
if (anyCustomer) {
  await call('customers/getOpenItems', {
    CustomerIds: [anyCustomer],
  }, { module: 'rapports', label: 'encours client' });
}

await call('taxations/getAll', {}, { module: 'rapports', label: 'taxations' });
await call('departments/getAll', { Limitation: { Count: 50 } }, { module: 'rapports', label: 'départements' });

// L'export en masse : asynchrone, prévu pour alimenter un outil tiers (BI,
// compta). On demande, puis on relit l'état du job.
const exp = await call('exports/add', {
  EntityType: 'OrderItem',
  // La fenêtre doit être CLOSE depuis au moins 5 minutes (et couvrir 180 j max) :
  // l'export travaille sur un instantané figé, pas sur des données qui bougent.
  Filters: { UpdatedUtc: { StartUtc: iso(now - 864e5), EndUtc: iso(now - 10 * 60e3) } },
}, { module: 'rapports', label: 'demander un export' });
const exportId = exp?.ExportId ?? (exp?.Exports || [])[0]?.Id;
if (exportId) {
  await call('exports/getAll', { ExportIds: [exportId] }, { module: 'rapports', label: 'relire l\'export' });
}

// ── 2. Transfert de charge (le « mettez ça sur ma chambre ») ─────────────────
section('Transfert de charge');

// Le scénario réel : un client commande au bar sans dire qu'il est logé. La
// conso part sur un compte de passage. Puis il dit « mettez-la sur ma chambre ».
// On déplace alors l'écriture vers le compte ET la note du client logé —
// `accountingItems/update` fait les deux d'un coup.
const posService = Object.entries(
  (pastItems?.OrderItems || []).reduce((a, it) => {
    const s = (services?.Services || []).find((x) => x.Id === it.ServiceId);
    if (s?.Data?.Discriminator === 'Additional') a[it.ServiceId] = (a[it.ServiceId] || 0) + 1;
    return a;
  }, {}),
).sort((a, b) => b[1] - a[1])[0]?.[0];

const guest = someReservation?.CustomerId; // un client actuellement en séjour

if (posService && guest) {
  const walkin = await call('customers/add', {
    LastName: 'Passage', FirstName: 'Client', OverwriteExisting: false,
  }, { module: 'pos', label: 'client de passage au bar' });

  const barBill = await call('bills/add', {
    Bills: [{ AccountId: walkin?.Id, Name: `${tag} — note du bar` }],
  }, { module: 'pos', label: 'ouvrir la note du bar' });
  const barBillId = (barBill?.Bills || [])[0]?.Id;

  const barOrder = await call('orders/add', {
    ServiceId: posService,
    AccountId: walkin?.Id,
    ...(barBillId ? { BillId: barBillId } : {}),
    Items: [{
      Name: 'Spritz (à transférer)',
      UnitCount: 1,
      UnitAmount: { Currency: currency, GrossValue: 12, TaxCodes: [taxCode] },
    }],
  }, { module: 'pos', label: 'conso posée au bar' });

  // On retrouve la ligne. `OrderIds` n'est pas un filtre accepté : on relit par
  // note (la note du bar ne contient que ça) puis on recoupe sur l'OrderId.
  // Cohérence différée : on attend que la ligne soit indexée (1 à 3 s), sinon
  // le transfert serait sauté en silence.
  const fresh = await call('orderItems/getAll', {
    AccountIds: [walkin?.Id],
    CreatedUtc: { StartUtc: iso(now - 3600e3), EndUtc: iso(now + 3600e3) },
    Limitation: { Count: 50 },
  }, {
    module: 'pos', label: 'retrouver la ligne',
    retries: 5, until: (j) => (j.OrderItems || []).length > 0,
  });
  const lines = fresh?.OrderItems || [];
  const itemId = (lines.find((i) => i.OrderId === barOrder?.OrderId) ?? lines[0])?.Id;
  if (!itemId) console.log(`  --   ligne introuvable (${lines.length} lignes sur la note du bar)`);

  const roomBill = await call('bills/add', {
    Bills: [{ AccountId: guest, Name: `${tag} — note de la chambre` }],
  }, { module: 'pos', label: 'ouvrir la note de la chambre' });
  const roomBillId = (roomBill?.Bills || [])[0]?.Id;

  if (itemId && roomBillId) {
    await call('accountingItems/update', {
      AccountingItemUpdates: [{
        AccountingItemId: itemId,
        AccountId: { Value: guest },      // le compte change : c'est le client logé
        BillId: { Value: roomBillId },    // et sa note
      }],
    }, { module: 'pos', label: 'TRANSFÉRER la conso sur la chambre', retries: 2 });
  }
}

// ── 3. Groupes, allotements, comptes société ────────────────────────────────
section('Groupes & allotements');

// Un allotement : le socle du chantier Groupes/Mariages.
const block = await call('availabilityBlocks/add', {
  AvailabilityBlocks: [{
    ServiceId: stayService,
    TemplateRateId: rate?.Id,
    FirstTimeUnitStartUtc: midnight(60),
    LastTimeUnitStartUtc: midnight(62),
    State: 'Confirmed',
    Name: `${tag} — mariage`,
  }],
}, { module: 'groupes', label: 'créer un allotement' });
const blockId = (block?.AvailabilityBlocks || [])[0]?.Id;

if (blockId) {
  await call('availabilityBlocks/update', {
    AvailabilityBlocks: [{
      AvailabilityBlockId: blockId,
      Name: { Value: `${tag} — mariage (confirmé)` },
    }],
  }, { module: 'groupes', label: 'modifier l\'allotement' });

  // Un allotement ne réserve rien tant qu'on ne lui affecte pas d'unités. Le
  // bloc se SERT dans le stock général : l'ajustement est donc NÉGATIF (Mews
  // refuse un positif : « must have a non-positive resource count »). Encore
  // faut-il qu'il reste des chambres à prendre — sinon c'est du surbooking.
  const freeForBlock = await call('services/getAvailability', {
    ServiceId: stayService,
    FirstTimeUnitStartUtc: midnight(60),
    LastTimeUnitStartUtc: midnight(61),
  }, { module: 'groupes', label: 'disponibilité pour le bloc' });
  const withRoom = (freeForBlock?.CategoryAvailabilities || [])
    .map((c) => ({ id: c.CategoryId, free: Math.min(...(c.Availabilities || [0])) }))
    .filter((c) => c.free > 0)
    .sort((a, b) => b.free - a.free)[0];

  if (withRoom) {
    await call('services/updateAvailability', {
      ServiceId: stayService,
      AvailabilityUpdates: [{
        ResourceCategoryId: withRoom.id,
        FirstTimeUnitStartUtc: midnight(60),
        LastTimeUnitStartUtc: midnight(61),
        UnitCountAdjustment: { Value: -Math.min(2, withRoom.free) },
        AvailabilityBlockId: blockId,
      }],
    }, { module: 'groupes', label: 'affecter des chambres au bloc' });
  } else {
    console.log('  --   plus une chambre libre sur la démo à cette date : affectation non exercée');
  }

  await call('availabilityBlocks/delete', {
    AvailabilityBlockIds: [blockId],
  }, { module: 'groupes', label: 'supprimer l\'allotement' });
}

// Compte société (TO, entreprise) : la base du débiteur.
const company = await call('companies/add', {
  Name: `${tag} — Société de test`,
}, { module: 'groupes', label: 'créer une société' });
const companyId = (company?.Companies || [])[0]?.Id;
if (companyId) {
  await call('companies/update', {
    CompanyId: companyId, Name: { Value: `${tag} — Société (maj)` },
  }, { module: 'groupes', label: 'modifier la société' });
  await call('companies/delete', {
    CompanyIds: [companyId],
  }, { module: 'groupes', label: 'supprimer la société' });
}

// Les billing automations remplacent les routing rules (dépréciées) : c'est le
// routage automatique des charges vers le compte société.
await call('billingAutomations/getAll', { Limitation: { Count: 50 } }, { module: 'groupes', label: 'lire les automations de facturation' });

// ── 4. RMS avancé & housekeeping ────────────────────────────────────────────
section('RMS avancé & housekeeping');

// Créer un tarif (et pas seulement en modifier le prix).
if (rateGroupId) {
  const newRate = await call('rates/add', {
    Rates: [{
      ServiceId: stayService,
      RateGroupId: rateGroupId,
      Names: { 'en-US': `${tag} — Tarif test` },
      // PricingType est un DISCRIMINANT (quel bloc de `Pricing` est rempli),
      // pas un mode de calcul : BaseRatePricing = tarif autonome.
      PricingType: 'BaseRatePricing',
      Pricing: { BaseRatePricing: { Amount: { Currency: currency, GrossValue: 150, TaxCodes: [taxCode] } } },
      IsEnabled: false, // on ne le met pas à la vente sur un environnement partagé
    }],
  }, { module: 'yield', label: 'créer un tarif' });
  const newRateId = (newRate?.Rates || [])[0]?.Id;
  if (newRateId) {
    await call('rates/delete', { RateIds: [newRateId] }, { module: 'yield', label: 'supprimer le tarif' });
  }
}

// Le surbooking piloté : combien de ventes au-delà de la capacité on s'autorise.
await call('serviceOverbookingLimits/set', {
  ServiceId: stayService,
  SetServiceOverbookingLimits: [{
    FirstTimeUnitStartUtc: midnight(60),
    LastTimeUnitStartUtc: midnight(61),
    Limit: 1,
  }],
}, { module: 'yield', label: 'autoriser 1 surbooking' });

await call('serviceOverbookingLimits/getAll', {
  ServiceIds: [stayService],
  CollidingUtc: { StartUtc: midnight(59), EndUtc: midnight(62) },
  Limitation: { Count: 50 },
}, { module: 'yield', label: 'relire les limites' });

await call('serviceOverbookingLimits/clear', {
  ServiceId: stayService,
  ClearServiceOverbookingLimits: [{
    FirstTimeUnitStartUtc: midnight(60),
    LastTimeUnitStartUtc: midnight(61),
  }],
}, { module: 'yield', label: 'lever le surbooking' });

// L'état d'occupation temps réel : quelles chambres sont libres, propres, sales.
// C'est le socle du sujet « chambres libres → housekeeping ».
if (categoryIds.length) {
  await call('resources/getOccupancyState', {
    ResourceCategoryIds: categoryIds.slice(0, 5), // 5 maximum
  }, { module: 'reception', label: 'état d\'occupation des chambres', dump: true });
}

// Dédoublonnage du cardex : indispensable le jour d'une reprise de données.
const c1 = await call('customers/add', { LastName: 'Doublon', FirstName: 'A', OverwriteExisting: false }, { module: 'reception', label: 'client doublon (source)' });
const c2 = await call('customers/add', { LastName: 'Doublon', FirstName: 'B', OverwriteExisting: false }, { module: 'reception', label: 'client doublon (cible)' });
if (c1?.Id && c2?.Id) {
  await call('customers/merge', {
    SourceCustomerId: c1.Id, TargetCustomerId: c2.Id,
  }, { module: 'reception', label: 'fusionner deux profils' });
}

// ── 5. Encodeur de clefs ────────────────────────────────────────────────────
section('Encodeur de clefs');

const devices = await call('devices/getAll', {}, { module: 'peripheriques', label: 'périphériques déclarés', dump: true });
const cutter = (devices?.Devices || []).find((d) => /keycutter|key cutter/i.test(d.Type || d.Data?.Discriminator || ''));
if (cutter && someReservation?.Id) {
  await call('commands/addKeyCutter', {
    KeyCutterId: cutter.Id,
    ReservationId: someReservation.Id,
    KeyCount: 1,
  }, { module: 'peripheriques', label: 'encoder une clef' });
} else {
  console.log(`  --   aucun encodeur déclaré sur la démo (${(devices?.Devices || []).length} périphériques) — endpoint non exerçable ici`);
}

// ── Matrice ─────────────────────────────────────────────────────────────────
await writeMatrix('mews-capacites-complement.md', 'Mews — matrice de capacités (complément)', {
  socle: 'Découverte',
  rapports: 'Rapports & comptabilité',
  pos: 'POS — transfert de charge',
  groupes: 'Groupes, allotements, sociétés',
  yield: 'RMS avancé',
  reception: 'Réception & housekeeping',
  peripheriques: 'Périphériques (encodeur de clefs)',
});

const ko = results.filter((r) => !r.ok);
if (ko.length) {
  console.log('\nÉchecs :');
  for (const r of ko) console.log(`  ${r.op.padEnd(32)} ${r.label} → ${r.msg}`);
}
