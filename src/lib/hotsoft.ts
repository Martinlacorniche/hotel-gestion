// Client HotSoft 8 Open API (éditeur Planet, ex-Hoist).
// Établissement visé à terme : Hôtel La Corniche. LECTURE SEULE pour l'instant —
// aucune fonction d'écriture n'est exposée ici tant que la certification n'est
// pas obtenue et que le périmètre accordé à notre protocole n'est pas connu.
//
// ENVIRONNEMENT : par défaut le bac à sable de certification
// (hsapi.hoistcloud.com/DemoHotel1). La prod La Corniche aura sa propre base et
// ses propres identifiants — et peut-être une forme d'auth différente si
// l'installation est on-premise (cf. « Overview » de la doc v140).
//
// Quatre différences de fond avec Mews, toutes encodées ici :
//
//  1. AUTH EN DEUX COUCHES. Le Basic Auth est exigé sur CHAQUE appel, y compris
//     ceux qui portent déjà le jeton. L'oublier renvoie un 401 en HTML.
//     Le jeton JWT (24 h) se passe DANS LE CORPS, en `authToken`, pas en header.
//
//  2. DATES AU FORMAT WCF `/Date(<ms>±hhmm)/`, en entrée comme en sortie, et
//     l'ISO 8601 est rejeté. Le décalage n'est PAS décoratif : le serveur
//     compare des heures-murs, et l'heure-mur vaut `ms + décalage`. Envoyer les
//     mêmes millisecondes avec `+0200` ou sans décalage interroge deux fenêtres
//     distantes de deux heures — sans la moindre erreur, juste des chiffres
//     faux. Vérifié sur le bac à sable : la même journée renvoie 810 lignes en
//     `+0200` et 896 sans décalage.
//     Convention retenue ici, immunisée à l'heure d'été : on encode l'heure-mur
//     voulue COMME SI elle était en UTC et on émet toujours `+0000`. Aucun
//     calcul de fuseau, donc aucun bug de bascule mars/octobre.
//
//  3. PAGINATION DANS L'URL (`/Reservations/Get/Page=2`), 50 lignes par page.
//
//  4. PAS DE WEBHOOKS. Voir `docs/hotsoft-couverture.md` : l'intégration sera
//     forcément en polling.

const BASE = process.env.HOTSOFT_BASE || '';

// Vrai quand on tape le bac à sable de certification plutôt qu'un hôtel réel.
export function isHotsoftDemo(): boolean {
  return /hoistcloud\.com\/DemoHotel/i.test(BASE);
}

function creds() {
  const user = process.env.HOTSOFT_USER;
  const password = process.env.HOTSOFT_PASSWORD;
  const hotelCode = process.env.HOTSOFT_HOTEL_CODE;
  const providerKey = process.env.HOTSOFT_PROVIDER_KEY;
  if (!BASE || !user || !password || !hotelCode || !providerKey) {
    throw new Error(
      'HOTSOFT_BASE / HOTSOFT_USER / HOTSOFT_PASSWORD / HOTSOFT_HOTEL_CODE / HOTSOFT_PROVIDER_KEY manquants en environnement',
    );
  }
  return { user, password, hotelCode, providerKey };
}

/* ------------------------------------------------------------------ dates */

// Sentinelle .NET `DateTime.MinValue` : HotSoft l'emploie partout où une date
// est simplement absente (date de départ d'une résa non partie, etc.).
const DOTNET_MIN_MS = -62135596800000;

// Millisecondes d'une heure-mur hôtel. On encode l'heure-mur comme si elle
// était en UTC — voir le point 2 de l'en-tête.
function wallMs(y: number, m: number, d: number, h = 0, min = 0, s = 0): number {
  return Date.UTC(y, m - 1, d, h, min, s);
}

// Une date « mur » hôtel vers le format attendu par HotSoft.
// Accepte 'yyyy-mm-dd' (borne de journée) ou un Date dont on lit les
// composantes UTC comme l'heure-mur voulue.
export function toHsDate(input: string | Date): string {
  let ms: number;
  if (typeof input === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(input);
    if (!m) throw new Error(`toHsDate: format attendu yyyy-mm-dd[Thh:mm[:ss]], reçu « ${input} »`);
    ms = wallMs(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  } else {
    ms = input.getTime();
  }
  return `/Date(${ms}+0000)/`;
}

// L'inverse. Renvoie un Date dont les composantes UTC SONT l'heure-mur hôtel
// (donc à lire avec getUTCHours(), jamais getHours()), ou null pour une date
// absente. C'est volontairement symétrique de `toHsDate`.
export function fromHsDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(value);
  if (!m) return null;
  const ms = Number(m[1]);
  if (ms === DOTNET_MIN_MS) return null;
  // L'heure-mur vaut `ms + décalage annoncé` : on ré-applique le décalage pour
  // retomber sur ce que l'hôtel affiche réellement.
  const off = m[2] ? (m[2][0] === '-' ? -1 : 1) * (Number(m[2].slice(1, 3)) * 60 + Number(m[2].slice(3, 5))) : 0;
  return new Date(ms + off * 60000);
}

// 'yyyy-mm-dd' d'une date HotSoft, dans le calendrier de l'hôtel.
export function hsDateStr(value: string | null | undefined): string | null {
  return fromHsDate(value)?.toISOString().slice(0, 10) ?? null;
}

/* ------------------------------------------------------------------- appel */

type TokenCache = { token: string; expiresAt: number };
let cached: TokenCache | null = null;

// Le jeton vit 24 h. On le renouvelle avec 5 min de marge, et on le jette dès
// qu'un appel le refuse (cf. `callHotsoft`).
async function authToken(force = false): Promise<string> {
  if (!force && cached && Date.now() < cached.expiresAt) return cached.token;

  const { user, password, hotelCode, providerKey } = creds();
  const res = await fetch(`${BASE}/GetAuthToken/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: basic(user, password) },
    body: JSON.stringify({ HotelCode: hotelCode, ProviderKey: providerKey }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HotSoft GetAuthToken → ${res.status} ${summarise(text)}`);

  let json: { AuthToken?: string; ValidTo?: string };
  try { json = JSON.parse(text); } catch { throw new Error(`HotSoft GetAuthToken → réponse illisible : ${summarise(text)}`); }
  if (!json.AuthToken) throw new Error(`HotSoft GetAuthToken → pas de jeton : ${summarise(text)}`);

  const validTo = fromHsDate(json.ValidTo)?.getTime();
  cached = {
    token: json.AuthToken,
    expiresAt: (validTo && validTo > Date.now() ? validTo : Date.now() + 23 * 3600_000) - 5 * 60_000,
  };
  return cached.token;
}

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

// Les erreurs de HotSoft arrivent souvent en page HTML WCF (401, « Request
// Error » sur un jeton invalide ou un paramètre mal nommé). On n'en garde
// qu'un extrait lisible, sinon les logs se remplissent de feuilles de style.
function summarise(text: string): string {
  const stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped.slice(0, 160) || `${text.length} octets`;
}

/**
 * Un appel REST. `path` est le chemin tel que listé par
 * `GET <base>/help` — qui fait autorité sur la doc pour les chemins exacts.
 */
export async function callHotsoft<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const { user, password } = creds();

  const once = async (token: string) => {
    const res = await fetch(`${BASE}/${path.replace(/^\//, '')}`, {
      method: 'POST',
      // Le Basic Auth est requis MÊME en portant le jeton : ce n'est pas une
      // redondance, c'est la porte du tenant cloud.
      headers: { 'Content-Type': 'application/json', Authorization: basic(user, password) },
      body: JSON.stringify({ authToken: token, ...body }),
    });
    return { res, text: await res.text() };
  };

  let { res, text } = await once(await authToken());

  // Un jeton périmé se manifeste par une page d'erreur, pas par un 401 propre :
  // on retente une fois avec un jeton neuf avant de conclure à une vraie panne.
  if (!res.ok && !text.trimStart().startsWith('{')) {
    ({ res, text } = await once(await authToken(true)));
  }

  if (!res.ok) throw new Error(`HotSoft ${path} → ${res.status} ${summarise(text)}`);

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`HotSoft ${path} → réponse non-JSON : ${summarise(text)}`);
  }
}

/* ---------------------------------------------------------------- paginé */

type Paging = { CurrentPage: number; TotalPages: number; TotalResults: number };
type PagedBody = { Paging: Paging | null; Messages?: { Message: string }[]; Response?: number };

/**
 * Parcourt un endpoint paginé et concatène `key`.
 *
 * `pathTemplate` porte le marqueur `{page}` : `'Reservations/Get/Page={page}'`.
 * Le numéro est dans le CHEMIN, pas dans le corps — une erreur qu'on ne fait
 * qu'une fois, l'API répondant alors la page d'aide WCF au lieu des données.
 *
 * `maxPages` est un garde-fou : une plage de dates trop large peut représenter
 * des centaines de pages (une seule journée de folios en fait déjà 17).
 */
export async function fetchAllPages<T>(
  pathTemplate: string,
  key: string,
  body: Record<string, unknown> = {},
  { maxPages = 50 }: { maxPages?: number } = {},
): Promise<{ items: T[]; total: number; truncated: boolean }> {
  if (!pathTemplate.includes('{page}')) {
    throw new Error(`fetchAllPages: « ${pathTemplate} » doit contenir le marqueur {page}`);
  }

  const items: T[] = [];
  let page = 1;
  let totalPages = 1;
  let total = 0;

  do {
    const json = await callHotsoft<PagedBody & Record<string, unknown>>(
      pathTemplate.replace('{page}', String(page)),
      body,
    );
    const batch = json[key];
    if (Array.isArray(batch)) items.push(...(batch as T[]));
    totalPages = json.Paging?.TotalPages ?? 1;
    total = json.Paging?.TotalResults ?? items.length;
    page += 1;
  } while (page <= totalPages && page <= maxPages);

  return { items, total, truncated: totalPages > maxPages };
}

/* --------------------------------------------------------------- lectures */

export type HsReservation = {
  Number: string;
  ReservationStatus: number;
  ReservationType: number;
  Arrival: string;
  Departure: string;
  UpdatedDate: string;
  CreatedDate: string;
  Adults: number;
  Children: number;
  Room: { Number?: string } | null;
  Contact: { Name?: string; Email?: string } | null;
  Notes: string | null;
  GroupNumber: string;
  GuestBalance: number;
  Channel: string;
  CRSNumber: string;
};

// Statuts observés sur le bac à sable et documentés côté HotSoft.
export const HS_RESERVATION_STATUS: Record<number, string> = {
  0: 'Aucun',
  1: 'Nouvelle',
  2: 'Confirmée',
  3: 'Provisoire',
  4: 'En séjour',
  5: 'Clôturée',
  6: 'Liste d’attente',
  7: 'Annulée',
};

/** Réservations dont la date d'arrivée tombe dans la fenêtre (dates 'yyyy-mm-dd'). */
export async function getReservationsByArrival(from: string, to: string, opts?: { maxPages?: number }) {
  return fetchAllPages<HsReservation>(
    'Reservations/Get/Page={page}',
    'Reservations',
    { ArrivalFrom: toHsDate(from), ArrivalTo: toHsDate(to) },
    opts,
  );
}

/**
 * Réservations modifiées dans la fenêtre — le pivot du polling, faute de
 * webhooks. À compléter par `Reservations/Deleted/Page={page}` : une résa
 * supprimée ne ressort évidemment plus ici.
 */
export async function getReservationsUpdatedSince(from: string, to: string, opts?: { maxPages?: number }) {
  return fetchAllPages<HsReservation>(
    'Reservations/Get/Page={page}',
    'Reservations',
    { UpdatedFrom: toHsDate(from), UpdatedTo: toHsDate(to) },
    opts,
  );
}

export type HsFolio = {
  ReservationNumber: string;
  Description: string;
  // 1 = vente, 2 = paiement, 4 = ledger (dépôts / comptes débiteurs).
  // C'est LE discriminant à utiliser : les paiements sont massivement négatifs
  // et les ventes positives, mais l'inverse existe (avoirs, remboursements) et
  // certaines ventes sont saisies en négatif. Classer au signe fait entrer des
  // ventes dans la caisse — vérifié sur le bac à sable avec le PLU « NOSHOW ».
  JournalType: number;
  AmountInclVat: number;
  AmountExclVat: number;
  Quantity: number;
  ProductCode: string | null;
  JournalDate: string;
  SubFolio: number;
  PaymentReference: string;
  // Écriture comptable en partie double — c'est ce qui permet de raccrocher au
  // plan comptable via `AccountExport` de GetAllAccounts.
  Postings: { AccountID: number; Debit: number; Credit: number; PostingType: number }[];
};

/**
 * Toutes les lignes de folio de l'hôtel sur une plage de dates de journal —
 * sans numéro de réservation. C'est l'équivalent HotSoft de
 * `orderItems/getAll` + `payments/getAll` chez Mews, en une seule lecture.
 */
export async function getFoliosByJournalDate(from: string, to: string, opts?: { maxPages?: number }) {
  return fetchAllPages<HsFolio>(
    'Folios/Get/Page={page}',
    'Folios',
    { JournalDateFrom: toHsDate(from), JournalDateTo: toHsDate(to) },
    opts,
  );
}

/** Date d'exploitation de l'hôtel — à ne pas confondre avec la date du jour. */
export async function getHotelDate(): Promise<string | null> {
  return hsDateStr(await callHotsoft<string>('GetHotelDate/'));
}
