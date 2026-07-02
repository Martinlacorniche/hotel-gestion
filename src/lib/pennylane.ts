// Client Pennylane (Company API v2) — LECTURE SEULE.
// On lit la compta (factures clients/fournisseurs, tiers) pour alimenter un
// cockpit de gestion + un copilote IA. Aucune écriture vers Pennylane.
// Jeton : process.env.PENNYLANE_API_TOKEN (Company API token).
//
// Vérifié 2026-07-02 :
//   • Base https://app.pennylane.com/api/external/v2, auth `Authorization: Bearer`.
//   • Pagination CURSOR : réponses { items, has_more, next_cursor }.
//   • Filtres serveur : [{"field","operator","value"}] ; champs autorisés sur
//     customer_invoices = id,date,invoice_number,customer_id,draft,… (PAS `paid`
//     ni `status`) ; opérateurs eq / gteq / lteq. On filtre donc par date côté
//     serveur, et par paid/status côté code.
//   • Montants renvoyés en STRING → à parser. paid/draft = booléens.

const BASE = 'https://app.pennylane.com/api/external/v2';

function token(): string {
  const t = process.env.PENNYLANE_API_TOKEN;
  if (!t) throw new Error('PENNYLANE_API_TOKEN manquant en environnement');
  return t;
}

type Filter = { field: string; operator: 'eq' | 'gteq' | 'lteq'; value: string | number | boolean };

async function callPennylane<T>(
  path: string,
  opts: { cursor?: string; filter?: Filter[]; sort?: string } = {},
): Promise<T> {
  const url = new URL(`${BASE}/${path}`);
  if (opts.cursor) url.searchParams.set('cursor', opts.cursor);
  if (opts.sort) url.searchParams.set('sort', opts.sort);
  if (opts.filter && opts.filter.length) url.searchParams.set('filter', JSON.stringify(opts.filter));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token()}`, Accept: 'application/json' },
  });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) {
    const msg = (json as { error?: string; message?: string })?.error
      || (json as { message?: string })?.message || text || `HTTP ${res.status}`;
    throw new Error(`Pennylane ${path} → ${res.status} ${msg}`);
  }
  return json as T;
}

type Page<T> = { items: T[]; has_more: boolean; next_cursor: string | null };

// Récupère toutes les pages (cursor) avec garde-fou anti-boucle.
async function fetchAll<T>(path: string, filter?: Filter[], sort?: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 500; guard++) {
    const page = await callPennylane<Page<T>>(path, { cursor, filter, sort });
    out.push(...(page.items || []));
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return out;
}

// ── Types (sous-ensemble utile) ──────────────────────────────────────────────
export type CustomerInvoice = {
  id: number;
  label?: string;
  invoice_number?: string;
  amount?: string;
  currency?: string;
  tax?: string;
  remaining_amount_with_tax?: string;
  paid?: boolean;
  draft?: boolean;
  status?: string;            // ex. 'late' | 'upcoming' | 'archived' …
  date?: string;              // 'YYYY-MM-DD'
  deadline?: string;
  customer?: { id?: number; name?: string };
};

export type SupplierInvoice = {
  id: number;
  label?: string;
  invoice_number?: string;
  amount?: string;
  currency_amount_before_tax?: string;
  currency?: string;
  remaining_amount_with_tax?: string;
  paid?: boolean;
  payment_status?: string;
  date?: string;
  deadline?: string;
  public_file_url?: string;
  supplier?: { id?: number; name?: string };
};

export type Customer = { id: number; name?: string; emails?: string[] };

// ── Helpers ──────────────────────────────────────────────────────────────────
export function num(s: string | number | null | undefined): number {
  if (typeof s === 'number') return s;
  const v = parseFloat(String(s ?? '0').replace(',', '.'));
  return isNaN(v) ? 0 : v;
}

const isoDate = (d: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(d);

// ── Lectures de base ─────────────────────────────────────────────────────────
export function listCustomerInvoices(sinceDate?: string): Promise<CustomerInvoice[]> {
  const filter: Filter[] = sinceDate ? [{ field: 'date', operator: 'gteq', value: sinceDate }] : [];
  return fetchAll<CustomerInvoice>('customer_invoices', filter, 'date');
}

export function listSupplierInvoices(sinceDate?: string): Promise<SupplierInvoice[]> {
  const filter: Filter[] = sinceDate ? [{ field: 'date', operator: 'gteq', value: sinceDate }] : [];
  return fetchAll<SupplierInvoice>('supplier_invoices', filter, 'date');
}

// Factures fournisseurs sur une fenêtre [since, until] (dates 'YYYY-MM-DD').
export function listSupplierInvoicesRange(since: string, until: string): Promise<SupplierInvoice[]> {
  return fetchAll<SupplierInvoice>('supplier_invoices', [
    { field: 'date', operator: 'gteq', value: since },
    { field: 'date', operator: 'lteq', value: until },
  ], 'date');
}

// Télécharge le PDF d'une facture (URL app.pennylane.com, authentifiée) en base64.
export async function downloadPdfBase64(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error(`PDF ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

export function listCustomers(): Promise<Customer[]> {
  return fetchAll<Customer>('customers');
}

// ── Snapshot cockpit ─────────────────────────────────────────────────────────
export type FinanceSnapshot = {
  since: string;              // date de début de la fenêtre analysée
  generatedAt: string;        // ISO
  ca_facture: number;         // Σ montants TTC facturés (hors brouillons/annulées) sur la fenêtre
  nb_factures: number;
  creances: {                 // impayés CLIENTS (à encaisser)
    total: number;
    nb: number;
    en_retard: number;        // Σ restant dû des factures échues
    nb_en_retard: number;
    top: { nom: string; montant: number; echeance?: string; numero?: string }[];
  };
  dettes: {                   // à payer FOURNISSEURS
    total: number;
    nb: number;
  };
};

// Fenêtre par défaut : `monthsBack` mois glissants (créances anciennes incluses
// tant qu'elles tombent dans la fenêtre). Tout est calculé en LECTURE.
export async function getFinanceSnapshot(now: Date = new Date(), monthsBack = 24): Promise<FinanceSnapshot> {
  const since = new Date(now); since.setMonth(since.getMonth() - monthsBack);
  const sinceStr = isoDate(since);
  const todayStr = isoDate(now);

  const [ci, si] = await Promise.all([
    listCustomerInvoices(sinceStr),
    listSupplierInvoices(sinceStr),
  ]);

  const active = ci.filter((i) => !i.draft && i.status !== 'archived');

  const ca_facture = active.reduce((s, i) => s + num(i.amount), 0);

  const unpaidC = active.filter((i) => !i.paid);
  const creancesTotal = unpaidC.reduce((s, i) => s + num(i.remaining_amount_with_tax || i.amount), 0);
  const enRetard = unpaidC.filter((i) => i.status === 'late' || (i.deadline && i.deadline < todayStr));
  const enRetardTotal = enRetard.reduce((s, i) => s + num(i.remaining_amount_with_tax || i.amount), 0);
  const top = [...unpaidC]
    .sort((a, b) => num(b.remaining_amount_with_tax || b.amount) - num(a.remaining_amount_with_tax || a.amount))
    .slice(0, 8)
    .map((i) => ({
      nom: i.customer?.name || i.label || `Facture ${i.invoice_number || i.id}`,
      montant: num(i.remaining_amount_with_tax || i.amount),
      echeance: i.deadline,
      numero: i.invoice_number,
    }));

  const unpaidS = si.filter((i) => !i.paid);
  const dettesTotal = unpaidS.reduce((s, i) => s + num(i.remaining_amount_with_tax || i.amount), 0);

  return {
    since: sinceStr,
    generatedAt: now.toISOString(),
    ca_facture,
    nb_factures: active.length,
    creances: {
      total: creancesTotal,
      nb: unpaidC.length,
      en_retard: enRetardTotal,
      nb_en_retard: enRetard.length,
      top,
    },
    dettes: { total: dettesTotal, nb: unpaidS.length },
  };
}
