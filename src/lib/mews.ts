// Client Mews Connector API — LECTURE SEULE.
// Établissement : Hôtel Les Voiles (prod, https://api.mews.com).
// On ne fait qu'observer : aucune écriture vers Mews.
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
