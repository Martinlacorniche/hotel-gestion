// Balayage en lecture du HotSoft 8 Open API sur le bac à sable.
//
// Deux usages :
//  - vérifier ce que notre protocole peut réellement lire (le JWT porte des
//    `AccessibleAreas` : ce qui marche ici ne marchera pas forcément à La
//    Corniche, et inversement) ;
//  - produire `docs/hotsoft-couverture.md`, l'inventaire qu'on oppose à Planet.
//
// bash scripts/hotsoft-certif/run.sh sweep-read.mjs

import { probe, section, requireDemo, writeMatrix, results } from './lib.mjs';
import { getHotelDate, toHsDate } from './.build/hotsoft.js';

requireDemo('sweep-read.mjs');

const len = (k) => (json) => (Array.isArray(json) ? json.length : (json?.[k]?.length ?? 0));
const paged = (k) => (json) => json?.Paging?.TotalResults ?? json?.[k]?.length ?? 0;

// La date d'exploitation de l'hôtel, pas celle du jour : le bac à sable est
// figé fin 2024, une fenêtre calée sur `new Date()` ne renverrait rien.
const hotelDate = await getHotelDate();
if (!hotelDate) {
  console.error('Impossible de lire la date hôtel — identifiants ou base invalides.');
  process.exit(1);
}
console.log(`Date d'exploitation du bac à sable : ${hotelDate}`);

const shift = (days) => {
  const d = new Date(`${hotelDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

section('Établissement et configuration');
await probe('GetHotel/', {}, { module: 'hotel', label: 'identité, devise, TVA' });
await probe('GetHotelDate/', {}, { module: 'hotel', label: 'date d’exploitation' });
await probe('GetHotelSettings/', {}, { module: 'hotel', label: 'réglages (champs obligatoires…)' });
await probe('Config/Protocols/Get', {}, {
  module: 'hotel', label: 'protocoles activés sur l’hôtel', count: len('Protocols'), dump: true,
});

section('Détection de changements (le substitut de webhook)');
await probe('Config/Monitoring/Get', { Peek: true }, {
  module: 'sync', label: 'tables modifiées depuis le dernier passage', count: len('Updates'),
});

section('Chambres et gouvernante');
await probe('GetRooms/', {}, { module: 'rooms', label: 'inventaire des chambres', count: len('Rooms') });
await probe('GetRoomTypes/', {}, { module: 'rooms', label: 'catégories', count: len('RoomTypes') });
await probe('GetRoomsStatuses/', {}, { module: 'rooms', label: 'statuts ménage disponibles', count: len() });
await probe('Rooms/Class/Get', {}, { module: 'rooms', label: 'classes de chambre', count: len('RoomClasses') });

section('Réservations');
const resas = await probe('Reservations/Get/Page=1', {
  ArrivalFrom: toHsDate(shift(-30)), ArrivalTo: toHsDate(shift(30)),
}, { module: 'resa', label: 'arrivées ±30 j', count: paged('Reservations'), dump: true });

await probe('Reservations/Get/Page=1', {
  UpdatedFrom: toHsDate(shift(-7)), UpdatedTo: toHsDate(shift(1)),
}, { module: 'resa', label: 'modifiées depuis 7 j (pivot du polling)', count: paged('Reservations') });

// Piège : l'endpoint des supprimées ne connaît PAS de filtre « DeletedFrom ».
// On l'interroge sur les mêmes axes qu'une résa vivante (arrivée, création,
// mise à jour) — et un nom de paramètre inconnu ne renvoie pas une erreur de
// validation mais un 502 du proxy, ce qui se lit à tort comme une panne.
await probe('Reservations/Deleted/Page=1', {
  UpdatedFrom: toHsDate(shift(-30)), UpdatedTo: toHsDate(shift(1)),
}, { module: 'resa', label: 'supprimées (invisibles autrement)', count: paged('Reservations') });

// Une réservation réelle sert de cobaye aux endpoints qui en exigent une.
const sample = (resas?.Reservations || []).find((r) => r.ReservationStatus === 5)
  || (resas?.Reservations || [])[0];
const RN = sample?.Number;
console.log(RN ? `  (réservation témoin : ${RN})` : '  (aucune réservation témoin trouvée)');

if (RN) {
  await probe('GetReservationBill/', { ReservationNumber: RN }, { module: 'resa', label: 'note d’un séjour' });
  await probe('GetAllReservationFolios/', { ReservationNumber: RN }, { module: 'resa', label: 'folios d’un séjour' });
  await probe('Reservations/Arrangements/Get', { ReservationNumber: RN }, {
    module: 'resa', label: 'arrangements (pension…)', count: len('Arrangements'),
  });
  await probe('ReservationCanCheckIn/', { ReservationNumbers: [RN] }, {
    module: 'borne', label: 'la résa est-elle enregistrable ?',
  });
  await probe('GetRegistrationCardDetails/', { ReservationNumber: RN }, {
    module: 'borne', label: 'fiche de police pré-remplie',
  });
}

section('Facturation, caisse et comptabilité');
await probe('Folios/Get/Page=1', {
  JournalDateFrom: toHsDate(shift(-1)), JournalDateTo: toHsDate(shift(0)),
}, { module: 'ca', label: 'TOUTES les écritures de l’hôtel sur 1 jour', count: paged('Folios'), dump: true });

await probe('GetAllAccounts/', {}, { module: 'ca', label: 'plan comptable (AccountExport)', count: len(), dump: true });
await probe('GetAllProducts/', {}, { module: 'ca', label: 'articles POS (PLU, prix)', count: len(), dump: true });
await probe('GetAllProductGroups/', {}, { module: 'ca', label: 'familles d’articles', count: len() });
await probe('GetAllVoucherTypes/', {}, { module: 'ca', label: 'types de bons', count: len() });
await probe('GetStatistics/', {
  DateFrom: toHsDate(shift(-7)), DateTo: toHsDate(shift(0)),
}, { module: 'ca', label: 'statistiques agrégées' });

section('Borne et clefs');
await probe('GetKeyAccessPoints/', { InterfaceProduct: 550 }, {
  module: 'borne', label: 'points d’accès encodables', count: len(),
});
await probe('GetPreCheckInTimeSlots/', {}, {
  module: 'borne', label: 'créneaux de pré-enregistrement', count: len('PreCheckInSlotsInformation'),
});
await probe('GetRegistrationCardCriteria/', {}, { module: 'borne', label: 'champs exigés sur la fiche' });

section('Tarifs et disponibilité');
await probe('GetPriceRates/', {}, { module: 'tarifs', label: 'grilles tarifaires', count: len('PriceRates') });
await probe('PriceRate/Info/Get/Page=1', {}, { module: 'tarifs', label: 'détail des tarifs', count: paged('PriceRateInfos') });
// Les bornes s'appellent StartDate/EndDate ici, et DateFrom/DateTo ailleurs
// (GetStatistics) : il n'y a pas de convention unique sur cette API, chaque
// endpoint a la sienne. Toujours vérifier la page de doc correspondante.
await probe('Restrictions/Get/Page=1', {
  StartDate: toHsDate(shift(0)), EndDate: toHsDate(shift(30)),
}, { module: 'tarifs', label: 'restrictions (stop-sell…)', count: paged('Restrictions') });
// NON RÉSOLU au 29/07 : le corps ci-dessous reprend à l'identique l'exemple
// REST de la doc v140, et le serveur refuse quand même à la désérialisation
// (page « Request Error », avant d'atteindre la méthode). Essayés en vain :
// avec et sans StayLength, AvailabilityKindType 0 et 1, RoomType vide ou réel,
// et trois noms d'objet enveloppant. Question posée à Planet.
// Sans conséquence pour nous : l'occupation se recalcule à partir des
// réservations et de l'inventaire chambres, comme on le fait déjà chez Mews.
await probe('GetAvailability/', {
  AllotmentNumber: '', AvailabilityKindType: 1,
  EndDate: toHsDate(shift(7)), NumberOfRooms: 0, IncludeOverbookings: false,
  RoomType: '', StartDate: toHsDate(shift(0)), StayLength: 1,
}, { module: 'tarifs', label: 'disponibilité (⚠️ voir commentaire)', count: len('Availabilities') });

section('Référentiels');
await probe('Contacts/Get/Page=1', { Name: 'a' }, { module: 'ref', label: 'contacts', count: paged('Contacts') });
await probe('GetCountries/', {}, { module: 'ref', label: 'pays', count: len() });
await probe('GetMarketCodes/', {}, { module: 'ref', label: 'codes marché / segmentation', count: len('MarketCodes') });
await probe('GetAllStates/', {}, { module: 'ref', label: 'états', count: len() });

const ko = results.filter((r) => !r.ok);
await writeMatrix('hotsoft-couverture.md', 'HotSoft 8 Open API — couverture en lecture', {
  hotel: 'Établissement et configuration',
  sync: 'Détection de changements',
  rooms: 'Chambres et gouvernante',
  resa: 'Réservations',
  ca: 'Facturation, caisse et comptabilité',
  borne: 'Borne, fiche de police et clefs',
  tarifs: 'Tarifs et disponibilité',
  ref: 'Référentiels',
}, [
  `Date d'exploitation du bac à sable au moment du balayage : **${hotelDate}**`,
  '(l\'environnement est figé — les fenêtres de dates sont calées dessus, pas sur le jour réel).',
  '',
  '> Un KO ici ne signifie pas « impossible » : il peut s\'agir d\'un nom de paramètre',
  '> encore inconnu, d\'une donnée absente du jeu de démo, ou d\'une zone non ouverte',
  '> à notre `ProviderKey`. Le jeton porte des `AccessibleAreas` — le périmètre de',
  '> La Corniche devra être revérifié une fois le protocole activé.',
].join('\n'));

if (ko.length) {
  console.log('\nÀ éclaircir avec Planet :');
  for (const r of ko) console.log(`  - ${r.path} : ${r.detail}`);
}
