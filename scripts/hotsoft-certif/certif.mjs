// Runner de certification HotSoft — indexé par onglet et numéro de test.
//
// Pensé pour la visio de certification : Phil annonce « GetReservations, test 3 »,
// on tape `bash scripts/hotsoft-certif/run.sh certif.mjs GetReservations#3` et on
// lit un verdict en trois lignes. Pas de JSON brut à déchiffrer à voix haute.
//
//   bash scripts/hotsoft-certif/run.sh certif.mjs                   → tous les tests
//   bash scripts/hotsoft-certif/run.sh certif.mjs GetRooms          → un onglet
//   bash scripts/hotsoft-certif/run.sh certif.mjs GetRooms#2        → un test
//   bash scripts/hotsoft-certif/run.sh certif.mjs --list            → le catalogue
//
// TROIS VERDICTS, PAS DEUX. Le classeur demande très souvent « number of rows
// returned should match HotSoft row count » : cette comparaison-là ne peut pas
// être automatisée, elle exige l'écran HotSoft en face. On renvoie donc
// « À CONFRONTER » avec le chiffre à annoncer, plutôt qu'un PASS menteur.
//
// ─────────────────────────────────────────────────────────────────────────────
// CE QUE LE BAC À SABLE A APPRIS EN CONSTRUISANT CE FICHIER (tout est vérifié) :
//
//  1. `ReservationStatus` et `ReservationType` sont des TABLEAUX, jamais des
//     scalaires. `{ReservationStatus: 2}` renvoie une page d'erreur WCF 400 —
//     pas un message d'erreur JSON, une page HTML. Il faut `[2]`.
//
//  2. Les codes de statut du classeur sont les BONS pour filtrer : 0 renvoie
//     3154 réservations toutes marquées 0, et 2 en renvoie 36 toutes marquées 2.
//     Filtrer sur 4 renvoie exactement le même jeu que 2. Autrement dit
//     l'API honore la numérotation du classeur (Confirmed=0, Staying=2) et
//     `HS_RESERVATION_STATUS` dans src/lib/hotsoft.ts, qui annonce 4 = « en
//     séjour », est à re-vérifier avant de s'en servir pour afficher un statut.
//
//  3. Plusieurs endpoints renvoient un TABLEAU NU, sans enveloppe : GetAllProducts
//     (718 lignes ici), GetAllAccounts (786), GetAllProductGroups (39),
//     GetRoomsStatuses (6). D'autres enveloppent (`Rooms`, `Reservations`,
//     `Folios`, `Contacts`). Il n'y a pas de règle : on teste les deux.
//
//  4. `GetReservationFolios/` n'existe pas en REST malgré son onglet dédié —
//     c'est `Folios/Get/Page=N` avec `ReservationNumber`.
//
//  5. `Contacts/Get` et `GetContact` EXIGENT un critère : sans rien, 400.
//     `GetContact` veut un `ClientNumber` numérique.
//
//  6. Les valeurs attendues du classeur sont celles de LEUR hôtel de référence
//     (9 groupes de produits, 32 produits, 52 comptes, produits BOAT/FLOW,
//     comptes 110/130, chambre 102). Le bac à sable qu'on nous a ouvert est un
//     autre hôtel : ces chiffres ne tomberont pas juste, et ce n'est PAS un
//     échec de notre intégration. On affiche les deux côte à côte pour pouvoir
//     le dire calmement en visio.

import { requireDemo } from './lib.mjs';
import { callHotsoft, fetchAllPages, getHotelDate, toHsDate, hsDateStr } from './.build/hotsoft.js';

requireDemo('certif.mjs');

/* ------------------------------------------------------------------ statuts */

// Codes du classeur, confirmés par le bac à sable (cf. point 2 de l'en-tête).
const STATUT = { CONFIRMEE: 0, EN_SEJOUR: 2 };
const TYPE_CHAMBRE = 0;

/* ----------------------------------------------------------------- verdicts */

const PASS = (detail) => ({ verdict: 'PASS', detail });
const FAIL = (detail) => ({ verdict: 'ÉCHEC', detail });
const VOIR = (detail) => ({ verdict: 'À CONFRONTER', detail });

// Un attendu chiffré du classeur : on ne tranche pas, on donne les deux nombres.
function compte(obtenu, attenduClasseur, quoi) {
  if (obtenu === attenduClasseur) return PASS(`${obtenu} ${quoi}, conforme au classeur`);
  return VOIR(`${obtenu} ${quoi} ici — le classeur en attend ${attenduClasseur} (hôtel de référence de Planet, pas ce bac à sable)`);
}

// Certains endpoints renvoient un tableau nu, d'autres l'enveloppent. Cf. point 3.
function liste(json, ...cles) {
  if (Array.isArray(json)) return json;
  for (const c of cles) if (Array.isArray(json?.[c])) return json[c];
  return [];
}

// Les dates arrivent en sentinelle .NET `/Date(1722624164910+0200)/` : un
// `.slice(0, 10)` naïf affiche « /Date(1722 ». On passe par le convertisseur du
// client, qui gère aussi DateTime.MinValue.
const jour = (d) => hsDateStr(d) ?? '—';

// Le texte est systématiquement complété d'espaces en base (`"115  "`, `"EXEC "`).
const txt = (v) => String(v ?? '').trim();

// `RoomType` est un OBJET sur une réservation comme sur une chambre : `Type` est
// le code à repasser en filtre, `Class` la classe, `Description` le libellé.
const codeType = (rt) => txt(rt?.Type);
const libelleType = (rt) => txt(rt?.Description) || codeType(rt) || '—';

/* ---------------------------------------------------------------- fixtures */

// Le classeur dit partout « ReservationNumber: xxxx » : c'est à nous de choisir
// une réservation réelle. On les résout une fois et on réutilise — pour que deux
// tests parlent bien du MÊME dossier quand Phil demande à le voir à l'écran.
const cache = new Map();
async function fixture(nom, calcul) {
  if (!cache.has(nom)) cache.set(nom, await calcul());
  return cache.get(nom);
}

const dateHotel = () => fixture('dateHotel', async () => {
  const d = await getHotelDate();
  if (!d) throw new Error('date d’exploitation illisible — identifiants ou base invalides');
  return d;
});

// Fenêtres calées sur la date d'EXPLOITATION, pas sur aujourd'hui : le bac à
// sable est figé fin 2024, une plage autour de `new Date()` ne renvoie rien.
const decale = async (jours) => {
  const d = new Date(`${await dateHotel()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
};

async function resasPaginees(corps, maxPages = 3) {
  return fetchAllPages('Reservations/Get/Page={page}', 'Reservations', corps, { maxPages });
}

async function resasUnePage(corps) {
  const json = await callHotsoft('Reservations/Get/Page=1', corps);
  return { items: json?.Reservations ?? [], total: json?.Paging?.TotalResults ?? (json?.Reservations?.length ?? 0) };
}

const enSejour = () => fixture('enSejour', async () => {
  const { items } = await resasUnePage({ ReservationStatus: [STATUT.EN_SEJOUR], ReservationType: [TYPE_CHAMBRE] });
  return items;
});

const uneResaEnSejour = () => fixture('uneResa', async () => {
  const items = await enSejour();
  return items.find((r) => r.Room?.Number?.trim()) || items[0] || null;
});

const chambres = () => fixture('chambres', async () => liste(await callHotsoft('GetRooms/', {}), 'Rooms'));

/* --------------------------------------------------------------- catalogue */

const TESTS = [];
const test = (onglet, n, desc, executer) => TESTS.push({ onglet, n, desc, executer });

/* --- GetAuthToken ---------------------------------------------------------
   Les deux premiers scénarios sont NÉGATIFS : prouver qu'un mauvais code hôtel
   et une mauvaise clé sont refusés proprement. Le client de production ne sait
   pas mal s'authentifier — heureusement — donc on appelle l'endpoint à la main
   en dégradant volontairement un seul champ à la fois. */

async function authBrut({ hotelCode, providerKey }) {
  const base = process.env.HOTSOFT_BASE.replace(/\/$/, '');
  const auth = Buffer.from(`${process.env.HOTSOFT_USER}:${process.env.HOTSOFT_PASSWORD}`).toString('base64');
  const res = await fetch(`${base}/GetAuthToken/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({ HotelCode: hotelCode, ProviderKey: providerKey }),
  });
  const texte = await res.text();
  let json = null;
  try { json = JSON.parse(texte); } catch { /* page d'erreur WCF : on garde le texte */ }
  return { statut: res.status, json, texte };
}

// L'erreur d'authentification est imbriquée : `Message` est un objet qui porte
// lui-même un champ `Message`. L'afficher tel quel donne « [object Object] ».
const messageAuth = (r) =>
  r.json?.Message?.Message || r.json?.Message ||
  r.texte.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110);

test('GetAuthToken', 1, 'HotelCode invalide → doit être refusé', async () => {
  const r = await authBrut({ hotelCode: 'CODE-INVALIDE', providerKey: process.env.HOTSOFT_PROVIDER_KEY });
  if (r.json?.AuthToken) return FAIL('un jeton a été délivré malgré un code hôtel invalide — à signaler comme faille');
  return PASS(`refusé (HTTP ${r.statut}) : « ${messageAuth(r)} »`);
});

test('GetAuthToken', 2, 'ProviderKey invalide → doit être refusé', async () => {
  const r = await authBrut({ hotelCode: process.env.HOTSOFT_HOTEL_CODE, providerKey: '00000000-0000-0000-0000-000000000000' });
  if (r.json?.AuthToken) return FAIL('un jeton a été délivré malgré une clé invalide — à signaler comme faille');
  return PASS(`refusé (HTTP ${r.statut}) : « ${messageAuth(r)} »`);
});

test('GetAuthToken', 3, 'Identifiants valides → jeton + date de validité', async () => {
  const r = await authBrut({ hotelCode: process.env.HOTSOFT_HOTEL_CODE, providerKey: process.env.HOTSOFT_PROVIDER_KEY });
  if (!r.json?.AuthToken) return FAIL(`aucun jeton : ${messageAuth(r)}`);
  return PASS(`jeton obtenu, valable jusqu’au ${jour(r.json.ValidTo)} — stockable jusqu’à expiration`);
});

/* --- GetAllProductGroups --------------------------------------------------- */

test('GetAllProductGroups', 1, 'GetAllProductGroups → le classeur attend 9 lignes', async () => {
  const g = liste(await callHotsoft('GetAllProductGroups/', {}), 'ProductGroups');
  return compte(g.length, 9, 'groupes de produits');
});

test('GetAllProductGroups', 2, 'Confirmer les groupes BEV (Beverage) et ACCOM (Accommodation)', async () => {
  const g = liste(await callHotsoft('GetAllProductGroups/', {}), 'ProductGroups');
  const codes = g.map((x) => String(x.Code ?? '').trim().toUpperCase());
  const manquants = ['BEV', 'ACCOM'].filter((c) => !codes.includes(c));
  if (!manquants.length) return PASS('BEV et ACCOM présents');
  return VOIR(
    `${manquants.join(' et ')} absent(s) : ce bac à sable code ses groupes en numérique ` +
    `(${g.slice(0, 4).map((x) => `${String(x.Code).trim()}=${String(x.Description).trim()}`).join(', ')}…)`,
  );
});

/* --- GetAllProducts -------------------------------------------------------- */

test('GetAllProducts', 1, 'GetAllProducts → le classeur attend 32 lignes', async () => {
  const p = liste(await callHotsoft('GetAllProducts/', {}), 'Products');
  return compte(p.length, 32, 'produits');
});

test('GetAllProducts', 2, 'Confirmer BOAT (Boat Cruise, 30.00) et FLOW (Flowers, 50.00)', async () => {
  const p = liste(await callHotsoft('GetAllProducts/', {}), 'Products');
  const lignes = ['BOAT', 'FLOW'].map((code) => {
    const x = p.find((y) => String(y.Code ?? '').trim().toUpperCase() === code);
    return x ? `${code} = ${String(x.Description).trim()} à ${x.Price}` : `${code} absent`;
  });
  if (lignes.some((l) => l.endsWith('absent'))) {
    return VOIR(`${lignes.join(' | ')} — produits de l’hôtel de référence ; ici 1er produit : ${String(p[0]?.Code).trim()} = ${String(p[0]?.Description).trim()}`);
  }
  return PASS(lignes.join(' | '));
});

/* --- GetAllAccounts -------------------------------------------------------- */

test('GetAllAccounts', 1, 'GetAllAccounts → le classeur attend 52 lignes', async () => {
  const a = liste(await callHotsoft('GetAllAccounts/', {}), 'Accounts');
  return compte(a.length, 52, 'comptes');
});

test('GetAllAccounts', 2, 'Confirmer les comptes 110 (BREAK) et 130 (LUNCH)', async () => {
  const a = liste(await callHotsoft('GetAllAccounts/', {}), 'Accounts');
  const lignes = ['110', '130'].map((num) => {
    const x = a.find((y) => String(y.Code ?? '').trim() === num);
    return x ? `${num} = ${String(x.Description ?? '').trim()} (export ${x.AccountExport})` : `${num} absent`;
  });
  if (lignes.some((l) => l.endsWith('absent'))) {
    return VOIR(`${lignes.join(' | ')} — plan comptable de l’hôtel de référence ; ici 1er compte : ${String(a[0]?.Code).trim()} → export ${a[0]?.AccountExport}`);
  }
  return PASS(lignes.join(' | '));
});

/* --- GetRooms -------------------------------------------------------------- */

test('GetRooms', 1, 'GetRooms → confirmer le nombre de chambres', async () => {
  const r = await chambres();
  return VOIR(`${r.length} chambres renvoyées — à confronter au compte affiché dans HotSoft`);
});

test('GetRooms', 2, 'GetRooms filtré sur la classe STD → nombre et numéros', async () => {
  const r = liste(await callHotsoft('GetRooms/', { RoomClass: 'STD' }), 'Rooms');
  if (!r.length) return VOIR('aucune chambre en classe STD ici — demander à Phil la classe à utiliser sur ce jeu de données');
  return VOIR(`${r.length} chambres en STD : ${r.map((x) => txt(x.Number)).join(', ')} — à confronter à HotSoft`);
});

test('GetRooms', 3, 'GetRooms sur la chambre 102 → détail', async () => {
  const r = liste(await callHotsoft('GetRooms/', { RoomNumber: '102' }), 'Rooms');
  if (!r.length) {
    const dispo = (await chambres()).slice(0, 6).map((x) => txt(x.Number)).join(', ');
    return VOIR(`pas de chambre 102 sur ce bac à sable — premières chambres : ${dispo}…`);
  }
  const c = r[0];
  return PASS(
    `chambre ${txt(c.Number)} : ${txt(c.Description)}, type ${codeType(c.RoomType)} (${libelleType(c.RoomType)}), ` +
    `classe ${txt(c.RoomType?.Class) || '—'}, ${c.NumberOfBeds} lit(s), statut ${c.RoomStatus}`,
  );
});

/* --- GetRoomsStatuses ------------------------------------------------------ */

test('GetRoomsStatuses', 1, 'GetRoomsStatuses → confirmer les alias de statut ménage', async () => {
  const s = liste(await callHotsoft('GetRoomsStatuses/', {}), 'RoomStatuses', 'Statuses');
  if (!s.length) return FAIL('aucun statut renvoyé');
  return PASS(`${s.length} statuts : ${s.map((x) => `${String(x.Alias).trim()}=${x.Description}(${x.Status})`).join(', ')}`);
});

/* --- GetContact -----------------------------------------------------------
   Attention : contrairement à ce que laisse croire le libellé « Invoke
   GetContacts », l'endpoint REFUSE un appel sans critère (400). C'est en soi
   une observation à porter au classeur. */

const unContact = () => fixture('contact', async () => {
  const c = await callHotsoft('Contacts/Get/Page=1', { Name: 'a' });
  return liste(c, 'Contacts')[0] || null;
});

test('GetContact', 1, 'Lister des contacts → adresse, compte, coordonnées', async () => {
  let sansCritere = null;
  try {
    sansCritere = liste(await callHotsoft('Contacts/Get/Page=1', {}), 'Contacts');
  } catch { /* attendu : l'API exige un critère */ }
  const c = await unContact();
  if (!c) return FAIL('aucun contact lisible même avec un critère');
  const champs = ['Name', 'Address1', 'City', 'Email', 'ContactNumber', 'ClientNumber'].filter((k) => c[k]);
  const detail = `contact « ${c.Name || c.ContactName} » — champs peuplés : ${champs.join(', ')}`;
  return sansCritere
    ? PASS(detail)
    : VOIR(`${detail}. ⚠️ un appel SANS critère est refusé (400) : à noter au classeur, le scénario suppose l’inverse`);
});

test('GetContact', 2, 'Recherche par critère (numéro client, nom) + critère absurde → vide', async () => {
  const c = await unContact();
  if (!c) return FAIL('aucun contact pour construire le critère');
  const nom = String(c.Name || c.ContactName || '').trim();
  const parNom = liste(await callHotsoft('Contacts/Get/Page=1', { Name: nom }), 'Contacts');
  const vide = liste(await callHotsoft('Contacts/Get/Page=1', { Name: 'ZZZ-INEXISTANT-ZZZ' }), 'Contacts');
  const num = c.ClientNumber ?? c.ContactNumber;
  let parNumero = '';
  if (num != null) {
    const j = await callHotsoft('GetContact/', { ClientNumber: Number(num) }).catch((e) => ({ erreur: e.message }));
    parNumero = j?.erreur ? ` ; GetContact ClientNumber=${num} en erreur` : ` ; GetContact ClientNumber=${num} → ${j?.Name || j?.Contact?.Name || 'réponse sans nom'}`;
  }
  if (!parNom.length) return FAIL(`recherche sur « ${nom} » sans résultat alors que le contact existe`);
  if (vide.length) return FAIL(`un critère absurde renvoie quand même ${vide.length} contact(s)`);
  return PASS(`« ${nom} » → ${parNom.length} résultat(s) ; critère inexistant → 0${parNumero}`);
});

test('GetContact', 3, 'Contacts/Get avec pagination', async () => {
  const { items, total, truncated } = await fetchAllPages('Contacts/Get/Page={page}', 'Contacts', { Name: 'a' }, { maxPages: 3 });
  return PASS(`${items.length} contacts lus sur ${total} annoncés${truncated ? ', parcours volontairement tronqué à 3 pages' : ''}`);
});

/* --- GetReservationFolios --------------------------------------------------
   L'onglet s'appelle GetReservationFolios mais cette route REST n'existe pas :
   c'est `Folios/Get/Page=N`. À faire corriger dans le classeur. */

test('GetReservationFolios', 1, 'Folios d’une réservation → sous-folios et postes', async () => {
  const resa = await uneResaEnSejour();
  if (!resa) return FAIL('aucune réservation en séjour sur le bac à sable pour porter le test');
  const j = await callHotsoft('Folios/Get/Page=1', { ReservationNumber: resa.Number });
  const folios = liste(j, 'Folios');
  if (!folios.length) return VOIR(`résa ${resa.Number} sans folio — en choisir une autre avec Phil`);
  const somme = folios.reduce((n, f) => n + (f.AmountInclVat ?? f.Amount ?? 0), 0);
  return PASS(
    `résa ${resa.Number} → ${j.Paging?.TotalResults ?? folios.length} poste(s) sur ${j.Paging?.TotalPages ?? 1} page(s) ; ` +
    `page 1 : ${folios.length} lignes, total ${somme.toFixed(2)}`,
  );
});

test('GetReservationFolios', 2, 'Numéro de réservation invalide → « No reservation found »', async () => {
  const j = await callHotsoft('Folios/Get/Page=1', { ReservationNumber: '99999999' });
  const folios = liste(j, 'Folios');
  const msg = (j?.Messages || []).map((m) => m.Message).join(' ');
  if (folios.length) return FAIL(`un numéro bidon renvoie quand même ${folios.length} folio(s)`);
  return PASS(`refusé proprement : « ${msg || 'aucun folio, sans message'} »`);
});

/* --- GetReservations et Reservations Get Page ------------------------------
   Les deux onglets portent EXACTEMENT les mêmes dix scénarios : le premier vise
   l'appel simple, le second la version paginée. On génère les deux séries depuis
   une seule définition, en ne changeant que le mode d'appel. */

function scenariosReservations(onglet, appel) {
  test(onglet, 1, 'Résa par numéro → nom, chambre, adultes, arrivée/départ', async () => {
    const resa = await uneResaEnSejour();
    if (!resa) return FAIL('aucune réservation en séjour pour porter le test');
    const { items } = await appel({ ReservationNumber: resa.Number });
    if (items.length !== 1) return FAIL(`${items.length} résa(s) renvoyée(s) pour un numéro unique`);
    const r = items[0];
    const tarif = r.Rates?.[0];
    return PASS(
      `${r.Number} — ${r.Contact?.Name || 'sans nom'}, chambre ${txt(r.Room?.Number) || '—'}, ` +
      `type ${codeType(r.Room?.RoomType) || '—'} (${libelleType(r.Room?.RoomType)}), ` +
      `tarif ${tarif ? `${txt(tarif.Description)} à ${tarif.AmountIncVat} ${txt(tarif.CurrencyCode)}` : '—'}, ` +
      `${r.Adults ?? '?'} ad. ${r.Children ?? 0} enf., du ${jour(r.Arrival)} au ${jour(r.Departure)}`,
    );
  });

  test(onglet, 2, 'Résas en séjour, type Chambre → le compte doit égaler celui de HotSoft', async () => {
    const { items, total } = await appel({ ReservationStatus: [STATUT.EN_SEJOUR], ReservationType: [TYPE_CHAMBRE] });
    return VOIR(`${total || items.length} résa(s) en séjour — à confronter à l’écran HotSoft`);
  });

  test(onglet, 3, 'Résas confirmées partant sur une fenêtre de dates', async () => {
    const de = await decale(0);
    const a = await decale(7);
    const { items, total } = await appel({
      ReservationStatus: [STATUT.CONFIRMEE], ReservationType: [TYPE_CHAMBRE],
      DepartureFrom: toHsDate(de), DepartureTo: toHsDate(a),
    });
    return VOIR(
      `${total || items.length} résa(s) confirmée(s) partant entre le ${de} et le ${a} ` +
      `(fenêtre calée sur la date d’exploitation, pas sur aujourd’hui) — à confronter à HotSoft`,
    );
  });

  test(onglet, 4, 'Chambre + statut + nom approchant (fuzzy)', async () => {
    const resa = await uneResaEnSejour();
    const chambre = String(resa?.Room?.Number ?? '').trim();
    if (!chambre) return FAIL('aucune résa en séjour avec chambre attribuée');
    const nom = String(resa.Contact?.Name || '').split(',')[0].trim();
    const { items } = await appel({
      RoomNumber: chambre, ReservationStatus: [STATUT.EN_SEJOUR], ContactName: nom,
    });
    if (!items.length) return FAIL(`chambre ${chambre} + nom « ${nom} » ne renvoie rien`);
    const r = items[0];
    return PASS(`chambre ${chambre} + « ${nom} » → ${items.length} résa(s) ; 1re : ${r.Number} ${r.Contact?.Name || ''}`);
  });

  test(onglet, 5, 'Résas en séjour filtrées sur deux types de chambre', async () => {
    const items = await enSejour();
    // Le filtre attend les CODES (`RoomType.Type`), pas les objets renvoyés.
    const types = [...new Set(items.map((r) => codeType(r.Room?.RoomType)).filter(Boolean))].slice(0, 2);
    if (types.length < 2) return VOIR(`moins de deux types de chambre en séjour ici (${types.join(', ') || 'aucun'}) — à jouer avec Phil sur son jeu de données`);
    const { items: f, total } = await appel({
      RoomType: types, ReservationStatus: [STATUT.EN_SEJOUR], ReservationType: [TYPE_CHAMBRE],
    });
    return VOIR(`types ${types.join(' et ')} → ${total || f.length} résa(s) — à confronter à HotSoft`);
  });

  test(onglet, 6, 'Réservation de groupe en cours → nom, dates, type', async () => {
    const groupe = (await enSejour()).find((r) => String(r.GroupNumber || '').trim());
    if (!groupe) return VOIR('aucune résa de groupe en séjour sur le bac à sable — à créer avec Phil pendant la séance');
    return PASS(`groupe ${groupe.GroupNumber} via résa ${groupe.Number} — ${groupe.Contact?.Name || '?'}, du ${jour(groupe.Arrival)} au ${jour(groupe.Departure)}`);
  });

  test(onglet, 7, 'Idem test 6 avec IncGroupReservations: true → les résas liées', async () => {
    const groupe = (await enSejour()).find((r) => String(r.GroupNumber || '').trim());
    if (!groupe) return VOIR('pas de groupe disponible — dépend du test 6');
    const { items } = await appel({ ReservationNumber: groupe.Number, IncGroupReservations: true });
    return PASS(`groupe ${groupe.GroupNumber} → ${items.length} réservation(s) : ${items.map((r) => r.Number).join(', ')}`);
  });

  test(onglet, 8, 'Résas rattachées à un contingent (allotment)', async () => {
    const avecAllot = (await enSejour()).find((r) => String(r.AllotmentNumber || '').trim());
    if (!avecAllot) return VOIR('aucune résa en séjour rattachée à un contingent — à créer avec Phil, ou ouvrir Allotments/DateRange/Get qui est hors périmètre déclaré');
    const { items } = await appel({ AllotmentNumber: avecAllot.AllotmentNumber });
    return PASS(`contingent ${avecAllot.AllotmentNumber} → ${items.length} résa(s) : ${items.map((r) => r.Number).join(', ')}`);
  });

  test(onglet, 9, 'Réservation de conférence en cours → nom, dates, type', async () => {
    const { items } = await appel({ ReservationStatus: [STATUT.EN_SEJOUR] });
    const conf = items.find((r) => r.ReservationType && r.ReservationType !== TYPE_CHAMBRE);
    if (!conf) return VOIR('aucune résa de conférence en séjour — à créer avec Phil pendant la séance');
    return PASS(`résa ${conf.Number}, type ${conf.ReservationType} — ${conf.Contact?.Name || '?'}, du ${jour(conf.Arrival)} au ${jour(conf.Departure)}`);
  });

  test(onglet, 10, 'Idem test 9 avec IncConferenceReservations: true → les résas liées', async () => {
    const { items } = await appel({ ReservationStatus: [STATUT.EN_SEJOUR] });
    const conf = items.find((r) => r.ReservationType && r.ReservationType !== TYPE_CHAMBRE);
    if (!conf) return VOIR('pas de conférence disponible — dépend du test 9');
    const { items: liees } = await appel({ ReservationNumber: conf.Number, IncConferenceReservations: true });
    return PASS(`conférence ${conf.Number} → ${liees.length} réservation(s) : ${liees.map((r) => r.Number).join(', ')}`);
  });
}

scenariosReservations('GetReservations', resasUnePage);
scenariosReservations('Reservations Get Page', (corps) => resasPaginees(corps, 3));

/* ------------------------------------------------------------------ moteur */

const argv = process.argv.slice(2);
const cibles = argv.filter((a) => !a.startsWith('--'));

if (argv.includes('--list')) {
  let onglet = '';
  for (const t of TESTS) {
    if (t.onglet !== onglet) { onglet = t.onglet; console.log(`\n${onglet}`); }
    console.log(`  ${onglet}#${t.n}  ${t.desc}`);
  }
  console.log(`\n${TESTS.length} tests en lecture. L’écriture (check-in, statut chambre, transaction) n’est pas couverte ici.`);
  process.exit(0);
}

const selection = cibles.length
  ? TESTS.filter((t) => cibles.some((c) => {
      const [onglet, n] = c.split('#');
      return t.onglet.toLowerCase() === onglet.toLowerCase() && (!n || String(t.n) === n);
    }))
  : TESTS;

if (!selection.length) {
  console.error(`Aucun test ne correspond à « ${cibles.join(' ')} ». Voir --list.`);
  process.exit(1);
}

console.log(`Date d’exploitation du bac à sable : ${await dateHotel()}\n`);

const bilan = { PASS: 0, 'À CONFRONTER': 0, 'ÉCHEC': 0 };

for (const t of selection) {
  const t0 = Date.now();
  let r;
  try {
    r = await t.executer();
  } catch (e) {
    r = FAIL(String(e.message || e).replace(/^HotSoft \S+ → /, '').replace(/\s+/g, ' ').slice(0, 150));
  }
  bilan[r.verdict] += 1;
  const marque = { PASS: '✅', 'À CONFRONTER': '👀', 'ÉCHEC': '❌' }[r.verdict];
  console.log(`${marque} ${t.onglet}#${t.n} — ${t.desc}`);
  console.log(`   ${r.detail}  (${Date.now() - t0} ms)`);
}

console.log(
  `\n${selection.length} test(s) : ${bilan.PASS} ✅ vérifiés automatiquement, ` +
  `${bilan['À CONFRONTER']} 👀 à confronter à l’écran HotSoft, ${bilan['ÉCHEC']} ❌ en échec.`,
);
