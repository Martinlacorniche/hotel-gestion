// Client Mews Connector API.
// Établissement : Hôtel Les Voiles (prod, https://api.mews.com).
// Majoritairement LECTURE (occupation, revenu). UNE écriture cadrée :
// enregistrer un paiement déjà encaissé ailleurs (TPE/espèces du POS Rooftop)
// via payments/addExternal — cf. addExternalPayment plus bas. Aucune charge/
// conso n'est poussée (orders/add reste fermé côté scope Mews).
//
// Scope du connecteur (vérifié 2026-06-23) : reservations/getAll et
// resources/getAll OK avec extent minimal ; adresses / pièces d'identité
// refusées (RGPD). Cf. mémoire project_borne_checkin_mews.

const MEWS_BASE = 'https://api.mews.com/api/connector/v1';

type MewsCreds = { ClientToken: string; AccessToken: string; Client: string };

function creds(): MewsCreds {
  const ClientToken = process.env.MEWS_CLIENT_TOKEN;
  const AccessToken = process.env.MEWS_ACCESS_TOKEN;
  const Client = process.env.MEWS_CLIENT_NAME || 'SiteConsignes';
  if (!ClientToken || !AccessToken) {
    throw new Error('MEWS_CLIENT_TOKEN / MEWS_ACCESS_TOKEN manquants en environnement');
  }
  return { ClientToken, AccessToken, Client };
}

async function callMews<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${MEWS_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...creds(), ...body }),
  });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) {
    const msg = (json as { Message?: string })?.Message || text || `HTTP ${res.status}`;
    throw new Error(`Mews ${path} → ${res.status} ${msg}`);
  }
  return json as T;
}

// Date (yyyy-mm-dd) d'un instant, exprimée dans le fuseau de l'hôtel (Paris).
export function parisDateStr(d: Date): string {
  // en-CA donne le format ISO yyyy-mm-dd
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// Heure (0-23) d'un instant, dans le fuseau de l'hôtel (Paris). DST-safe.
export function parisHour(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hour: '2-digit', hour12: false,
  }).format(d));
}

type Reservation = {
  Id: string;
  State: string;
  StartUtc: string;
  EndUtc: string;
  Number: string;
  AssignedResourceId: string | null;
};

type Resource = { Id: string; Name: string; Data?: { Discriminator?: string } };

export type Checkout = { reservationId: string; number: string; roomName: string };

// Map resourceId → Name (ex. "001", "12", "Rooftop").
async function getResourceNames(): Promise<Map<string, string>> {
  const data = await callMews<{ Resources: Resource[] }>('resources/getAll', {
    Limitation: { Count: 1000 },
  });
  const map = new Map<string, string>();
  for (const r of data.Resources || []) map.set(r.Id, r.Name);
  return map;
}

// Départs (check-outs) du jour : réservations passées à l'état "Processed"
// dont la date de départ (EndUtc) tombe aujourd'hui (heure de Paris).
// Renvoie le n° de chambre Mews pour chacune (à mapper côté appelant).
export async function getCheckoutsToday(now: Date = new Date()): Promise<Checkout[]> {
  const today = parisDateStr(now);
  // Fenêtre large autour d'aujourd'hui ; le filtrage fin se fait sur EndUtc.
  const startUtc = new Date(now.getTime() - 24 * 3600e3).toISOString();
  const endUtc = new Date(now.getTime() + 2 * 3600e3).toISOString();

  const [resData, names] = await Promise.all([
    callMews<{ Reservations: Reservation[] }>('reservations/getAll', {
      StartUtc: startUtc,
      EndUtc: endUtc,
      TimeFilter: 'Colliding',
      States: ['Processed'],
      Extent: { Reservations: true },
      Limitation: { Count: 1000 },
    }),
    getResourceNames(),
  ]);

  const out: Checkout[] = [];
  for (const r of resData.Reservations || []) {
    if (parisDateStr(new Date(r.EndUtc)) !== today) continue; // départ d'aujourd'hui seulement
    if (!r.AssignedResourceId) continue;
    const roomName = names.get(r.AssignedResourceId);
    if (!roomName) continue;
    out.push({ reservationId: r.Id, number: r.Number, roomName });
  }
  return out;
}

// ============================================================================
// Taux d'occupation prévisionnel (on-the-books), mois par mois.
// ============================================================================
// On compte les nuitées RÉSERVÉES (états engagés, hors annulations/options) sur
// les mois civils à venir, puis on divise par la capacité (chambres × jours du
// mois). C'est une vue "on the books" : elle grossit au fil des réservations.
// Aucune donnée financière ici (le scope Mews refuse l'extent `Items`) — que de
// l'occupation, parfaitement couverte par reservations/getAll.

// États comptés comme "réservé". On exclut Enquiry/Requested/Optional (non
// engagés) et bien sûr Canceled.
const ON_THE_BOOKS_STATES = ['Confirmed', 'Started', 'Processed'];
// Mews refuse les fenêtres > 100 jours par appel → on découpe (marge de sécurité).
const MAX_INTERVAL_DAYS = 95;

export type MonthlyOccupancy = {
  month: string;          // 'YYYY-MM' (mois civil, fuseau Paris)
  occupiedNights: number; // nuitées réservées dans le mois
  availableNights: number; // capacité × nb de jours du mois
  occupancy: number;      // pourcentage 0-100, arrondi à 0,1
};

// Liste des `horizon` mois civils à partir du mois courant (Paris).
function targetMonths(now: Date, horizon: number): { key: string; days: number }[] {
  const todayStr = parisDateStr(now); // 'YYYY-MM-DD'
  let y = Number(todayStr.slice(0, 4));
  let m = Number(todayStr.slice(5, 7)); // 1-12
  const months: { key: string; days: number }[] = [];
  for (let i = 0; i < horizon; i++) {
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate(); // jours du mois m
    months.push({ key: `${y}-${String(m).padStart(2, '0')}`, days });
    m++; if (m > 12) { m = 1; y++; }
  }
  return months;
}

// Itère les nuits d'un séjour : dates 'YYYY-MM-DD' de checkIn (incluse) à
// checkOut (exclue — le jour du départ n'est pas une nuit).
function* eachNight(checkIn: string, checkOut: string): Generator<string> {
  let cur = Date.UTC(+checkIn.slice(0, 4), +checkIn.slice(5, 7) - 1, +checkIn.slice(8, 10));
  const end = Date.UTC(+checkOut.slice(0, 4), +checkOut.slice(5, 7) - 1, +checkOut.slice(8, 10));
  while (cur < end) {
    const d = new Date(cur);
    yield `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    cur += 86400e3;
  }
}

// Récupère toutes les réservations engagées d'une fenêtre (pagination cursor).
async function fetchReservations(startUtc: string, endUtc: string): Promise<Reservation[]> {
  const all: Reservation[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard++) {
    const Limitation: Record<string, unknown> = { Count: 1000 };
    if (cursor) Limitation.Cursor = cursor;
    const data = await callMews<{ Reservations: Reservation[]; Cursor?: string }>('reservations/getAll', {
      StartUtc: startUtc,
      EndUtc: endUtc,
      TimeFilter: 'Colliding',
      States: ON_THE_BOOKS_STATES,
      Extent: { Reservations: true },
      Limitation,
    });
    const batch = data.Reservations || [];
    all.push(...batch);
    if (batch.length < 1000 || !data.Cursor) break;
    cursor = data.Cursor;
  }
  return all;
}

// Occupation mensuelle prévisionnelle. `capacity` = nb de chambres vendables.
export async function getMonthlyOccupancy(
  capacity: number,
  now: Date = new Date(),
  horizon = 6,
): Promise<MonthlyOccupancy[]> {
  const months = targetMonths(now, horizon);
  const monthSet = new Set(months.map((x) => x.key));
  const first = months[0].key;        // 'YYYY-MM' du mois courant
  const last = months[months.length - 1].key;

  // Fenêtre globale = du 1er du mois courant au 1er du mois suivant le dernier,
  // paddée de ±1 jour (les bornes Mews sont en UTC, pas en heure de Paris).
  const startMs = Date.UTC(+first.slice(0, 4), +first.slice(5, 7) - 1, 1) - 86400e3;
  const endMs = Date.UTC(+last.slice(0, 4), +last.slice(5, 7), 1) + 86400e3;

  // Découpe en tranches < 100 jours, dédoublonnage des résas par Id (une résa
  // chevauchant deux tranches est renvoyée deux fois).
  const byId = new Map<string, Reservation>();
  for (let s = startMs; s < endMs; s += MAX_INTERVAL_DAYS * 86400e3) {
    const e = Math.min(s + MAX_INTERVAL_DAYS * 86400e3, endMs);
    const res = await fetchReservations(new Date(s).toISOString(), new Date(e).toISOString());
    for (const r of res) byId.set(r.Id, r);
  }

  const occupied: Record<string, number> = {};
  for (const k of monthSet) occupied[k] = 0;
  for (const r of byId.values()) {
    const inDate = parisDateStr(new Date(r.StartUtc));
    const outDate = parisDateStr(new Date(r.EndUtc));
    for (const night of eachNight(inDate, outDate)) {
      const mk = night.slice(0, 7);
      if (monthSet.has(mk)) occupied[mk]++;
    }
  }

  return months.map(({ key, days }) => {
    const available = capacity * days;
    const occ = occupied[key] || 0;
    return {
      month: key,
      occupiedNights: occ,
      availableNights: available,
      occupancy: available > 0 ? Math.round((occ / available) * 1000) / 10 : 0,
    };
  });
}

// ============================================================================
// CA & PM (prix moyen) — revenu par mois, via orderItems (scope ouvert 2026-07).
// ============================================================================
// « Réalisé » pour le passé, « portefeuille » (on-the-books) pour le mois courant
// et le futur : Mews pré-poste les nuits futures des réservations engagées, donc
// une simple fenêtre `ConsumedUtc` couvrant le mois capte les deux.
//
// Règle validée avec l'exploitant (compta Voiles, TTC) :
//   • On EXCLUT les lignes AccountingState === 'Canceled' (vraies annulations).
//   • CA = Σ GrossValue (TTC) de toutes les lignes restantes ; caHt = Σ NetValue.
//   • Hébergement = lignes Type ∈ {SpaceOrder, CancellationFee} (chambres +
//     no-show/frais d'annulation facturés), en TTC. Sert de base au PM.
//   • PM (prix moyen chambre) = hébergement TTC ÷ nuitées occupées (occupancy).

const ACCOMMODATION_TYPES = new Set(['SpaceOrder', 'CancellationFee']);

// orderItems/getAll impose « interval must not exceed 3M1D » (≠ 100 j des
// réservations). On découpe donc en tranches < 3 mois (marge de sécurité).
const MAX_REVENUE_INTERVAL_DAYS = 80;

type OrderItem = {
  Id: string;
  Type: string;
  AccountingState: string;
  ConsumedUtc: string | null;
  ClosedUtc: string | null;
  Amount?: { NetValue?: number; GrossValue?: number; Currency?: string };
};

async function fetchOrderItems(startUtc: string, endUtc: string): Promise<OrderItem[]> {
  const all: OrderItem[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard++) {
    const Limitation: Record<string, unknown> = { Count: 1000 };
    if (cursor) Limitation.Cursor = cursor;
    const data = await callMews<{ OrderItems: OrderItem[]; Cursor?: string }>('orderItems/getAll', {
      ConsumedUtc: { StartUtc: startUtc, EndUtc: endUtc },
      Limitation,
    });
    const batch = data.OrderItems || [];
    all.push(...batch);
    if (batch.length < 1000 || !data.Cursor) break;
    cursor = data.Cursor;
  }
  return all;
}

export type MonthlyRevenue = {
  month: string;      // 'YYYY-MM' (mois civil Paris)
  caTtc: number;      // CA total TTC (toutes lignes non annulées)
  caHt: number;       // CA total HT
  hebergTtc: number;  // revenu hébergement TTC (base du PM)
};

// Revenu mensuel sur `horizon` mois à partir du mois courant (Paris).
export async function getMonthlyRevenue(now: Date = new Date(), horizon = 6): Promise<MonthlyRevenue[]> {
  const months = targetMonths(now, horizon);
  const monthSet = new Set(months.map((x) => x.key));
  const first = months[0].key;
  const last = months[months.length - 1].key;

  const startMs = Date.UTC(+first.slice(0, 4), +first.slice(5, 7) - 1, 1) - 86400e3;
  const endMs = Date.UTC(+last.slice(0, 4), +last.slice(5, 7), 1) + 86400e3;

  // Découpe < 3 mois (limite orderItems) + dédoublonnage par Id.
  const seen = new Set<string>();
  const items: OrderItem[] = [];
  for (let s = startMs; s < endMs; s += MAX_REVENUE_INTERVAL_DAYS * 86400e3) {
    const e = Math.min(s + MAX_REVENUE_INTERVAL_DAYS * 86400e3, endMs);
    const batch = await fetchOrderItems(new Date(s).toISOString(), new Date(e).toISOString());
    for (const it of batch) {
      if (it.Id && seen.has(it.Id)) continue;
      if (it.Id) seen.add(it.Id);
      items.push(it);
    }
  }

  const agg: Record<string, { caTtc: number; caHt: number; hebergTtc: number }> = {};
  for (const k of monthSet) agg[k] = { caTtc: 0, caHt: 0, hebergTtc: 0 };
  for (const it of items) {
    if (it.AccountingState === 'Canceled') continue;
    const anchor = it.ConsumedUtc || it.ClosedUtc;
    if (!anchor) continue;
    const mk = parisDateStr(new Date(anchor)).slice(0, 7);
    if (!monthSet.has(mk)) continue;
    const ttc = Number(it.Amount?.GrossValue || 0);
    const ht = Number(it.Amount?.NetValue || 0);
    agg[mk].caTtc += ttc;
    agg[mk].caHt += ht;
    if (ACCOMMODATION_TYPES.has(it.Type)) agg[mk].hebergTtc += ttc;
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;
  return months.map(({ key }) => ({
    month: key,
    caTtc: r2(agg[key].caTtc),
    caHt: r2(agg[key].caHt),
    hebergTtc: r2(agg[key].hebergTtc),
  }));
}

// ── ÉCRITURE : enregistrer un paiement externe dans Mews ─────────────────────
// payments/addExternal N'ENCAISSE RIEN : il consigne dans Mews un règlement
// déjà pris ailleurs (TPE physique ou espèces). Type OBLIGATOIRE en
// environnement légal français : 'Cash' (espèces) ou 'CreditCard' (TPE carte).
// Le paiement se rattache à un compte Mews (AccountId), pas à une note précise.
// Vérifié en prod le 2026-07-04 (scope écriture ouvert). Cf. mémoire
// project_mews_occupancy / project_rooftop_pos_resa.
export type MewsExternalPaymentType = 'Cash' | 'CreditCard';

export async function addExternalPayment(params: {
  accountId: string;
  grossValue: number;
  type: MewsExternalPaymentType;
  currency?: string;
  externalIdentifier?: string;
  notes?: string;
}): Promise<{ id: string | null }> {
  const { accountId, grossValue, type, currency = 'EUR', externalIdentifier, notes } = params;
  // Corps À LA RACINE (pas enveloppé dans Payments[]). Amount EXIGE TaxCodes,
  // même vide pour un règlement sans taxe. Environnement gross (TTC) → GrossValue.
  // Vérifié en prod le 2026-07-04 : 200 { ExternalPaymentId }.
  const res = await callMews<{ ExternalPaymentId?: string }>(
    'payments/addExternal',
    {
      AccountId: accountId,
      Amount: { Currency: currency, GrossValue: grossValue, TaxCodes: [] },
      Type: type,
      ...(externalIdentifier ? { ExternalIdentifier: externalIdentifier } : {}),
      ...(notes ? { Notes: notes } : {}),
    },
  );
  return { id: res.ExternalPaymentId ?? null };
}

// Annuler un paiement dans Mews (correction d'erreur de saisie). Passe l'état à
// 'Canceled'. Corps À LA RACINE : { PaymentId, State }. Vérifié prod 2026-07-04
// (200). Échoue si le paiement est déjà sur une note clôturée côté PMS — dans ce
// cas la correction doit se faire à la main dans Mews.
// IDEMPOTENT : si le paiement est DÉJÀ annulé, Mews renvoie une transition
// invalide état→même état (ex. « ...de "Annulé" à "Annulé" ») — on considère
// l'annulation faite plutôt que d'échouer. Détection indépendante de la langue :
// on compare les deux états cités dans le message (identiques = no-op).
export async function cancelPayment(paymentId: string): Promise<{ alreadyCanceled: boolean }> {
  try {
    await callMews('payments/updateState', { PaymentId: paymentId, State: 'Canceled' });
    return { alreadyCanceled: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    const states = [...msg.matchAll(/["'«»“”]([^"'«»“”]+)["'«»“”]/g)].map(m => m[1].trim().toLowerCase());
    if (states.length >= 2 && states[states.length - 1] === states[states.length - 2]) {
      return { alreadyCanceled: true };
    }
    throw e;
  }
}

// ── LECTURE : contrôle résa « déjà venu ? » (gestionnaire de mails, Voiles) ───
// ⚠️ VOILES UNIQUEMENT (La Corniche n'est pas sous Mews). L'appelant doit gater sur
// cfg.mews. Pièges (cf. memory project_assistant_mails_voiles) : filtres customers/
// getAll au PLURIEL (LastNames), Extent SANS Documents/Addresses (sinon 401 RGPD).

type MewsCustomer = { Id: string; FirstName?: string; LastName?: string; Email?: string };

// Trouve un profil client par nom (option : prénom pour départager les homonymes).
export async function findGuest(
  firstName: string | null, lastName: string | null,
): Promise<{ id: string; firstName: string; lastName: string; email: string } | null> {
  if (!lastName) return null;
  const data = await callMews<{ Customers: MewsCustomer[] }>('customers/getAll', {
    LastNames: [lastName],
    Extent: { Customers: true, Documents: false, Addresses: false },
    Limitation: { Count: 100 },
  });
  const list = data.Customers || [];
  if (!list.length) return null;
  const fn = (firstName || '').trim().toLowerCase();
  const match = fn ? list.find((c) => (c.FirstName || '').trim().toLowerCase() === fn) : null;
  const c = match || list[0];
  return { id: c.Id, firstName: c.FirstName || '', lastName: c.LastName || '', email: c.Email || '' };
}

type PastReservation = { Id: string; State: string; ScheduledEndUtc?: string; EndUtc?: string };

// « Déjà venu » = au moins UNE réservation PASSÉE et TRAITÉE (séjour terminé) pour ce
// client. Balayage par fenêtres de 90 j sur ~18 mois glissants (reservations/getAll
// TimeFilter End, States Processed, extent minimal). S'arrête au 1er séjour trouvé.
export async function hasPastStay(customerId: string, now: Date = new Date()): Promise<boolean> {
  const WINDOW_MS = 90 * 24 * 3600e3;
  const oldest = now.getTime() - 18 * 30 * 24 * 3600e3;
  const nowIso = now.toISOString();
  for (let end = now.getTime(); end > oldest; end -= WINDOW_MS) {
    const start = Math.max(oldest, end - WINDOW_MS);
    const data = await callMews<{ Reservations: PastReservation[] }>('reservations/getAll', {
      CustomerIds: [customerId],
      StartUtc: new Date(start).toISOString(),
      EndUtc: new Date(end).toISOString(),
      TimeFilter: 'End',
      States: ['Processed'],
      Extent: { Reservations: true },
      Limitation: { Count: 100 },
    });
    for (const r of data.Reservations || []) {
      const endUtc = r.ScheduledEndUtc || r.EndUtc;
      if (endUtc && endUtc < nowIso) return true;
    }
  }
  return false;
}

type UpcomingReservation = { Id: string; StartUtc?: string; ScheduledStartUtc?: string; Number?: string };

// Retrouve LA réservation d'un client dont l'arrivée = arrivalISO (yyyy-mm-dd), pour la
// relier à un mail D-Edge. Fenêtre ±3 j autour de l'arrivée ; match exact sur la date.
export async function findReservation(customerId: string, arrivalISO: string): Promise<string | null> {
  const day = new Date(`${arrivalISO}T12:00:00Z`).getTime();
  const data = await callMews<{ Reservations: UpcomingReservation[] }>('reservations/getAll', {
    CustomerIds: [customerId],
    StartUtc: new Date(day - 3 * 24 * 3600e3).toISOString(),
    EndUtc: new Date(day + 3 * 24 * 3600e3).toISOString(),
    TimeFilter: 'Colliding',
    Extent: { Reservations: true },
    Limitation: { Count: 50 },
  });
  const list = data.Reservations || [];
  const exact = list.find((r) => (r.ScheduledStartUtc || r.StartUtc || '').slice(0, 10) === arrivalISO);
  return (exact || list[0])?.Id ?? null;
}

type TaxLineItem = { BillingName?: string; Amount?: { Currency?: string; GrossValue?: number } };

// Somme des lignes « Taxe de séjour / City tax » d'une réservation (montant à encaisser
// SUR PLACE quand le règlement est une CCV — la carte virtuelle ne couvre pas la TS).
// Lu via orderItems/getAll (BillingName explicite, ex. « Taxe de séjour (Adultes) »).
export async function cityTaxForReservation(reservationId: string): Promise<{ amount: number; currency: string } | null> {
  const data = await callMews<{ OrderItems: TaxLineItem[] }>('orderItems/getAll', {
    ServiceOrderIds: [reservationId],
    Limitation: { Count: 200 },
  });
  const items = (data.OrderItems || []).filter((it) =>
    /taxe de séjour|city tax|tourist tax/i.test(it.BillingName || ''));
  if (!items.length) return null;
  const amount = items.reduce((s, it) => s + (it.Amount?.GrossValue || 0), 0);
  const currency = items[0].Amount?.Currency || 'EUR';
  return { amount: Math.round(amount * 100) / 100, currency };
}
