const BASE = process.env.TTHOTEL_API_BASE!;
const CLIENT_ID = process.env.TTHOTEL_CLIENT_ID!;
const CLIENT_SECRET = process.env.TTHOTEL_CLIENT_SECRET!;
const USERNAME = process.env.TTHOTEL_USERNAME!;
const PASSWORD_MD5 = process.env.TTHOTEL_PASSWORD_MD5!;

if (!BASE || !CLIENT_ID || !CLIENT_SECRET || !USERNAME || !PASSWORD_MD5) {
  // Évite de planter l'app entière au build, mais throw au runtime si on appelle vraiment
  console.warn('[tthotel] credentials manquants en env — toute requête échouera');
}

type CachedToken = { token: string; refreshToken: string; expiresAt: number };
let cached: CachedToken | null = null;

async function fetchToken(body: URLSearchParams): Promise<CachedToken> {
  const res = await fetch(`${BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  if (data.errcode) {
    throw new Error(`TTHotel auth errcode=${data.errcode} ${data.errmsg ?? ''}`);
  }
  if (!data.access_token) {
    throw new Error(`TTHotel auth: réponse inattendue ${JSON.stringify(data)}`);
  }
  return {
    token: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000 - 60_000,
  };
}

async function authPassword() {
  return fetchToken(new URLSearchParams({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    username: USERNAME,
    password: PASSWORD_MD5,
  }));
}

async function authRefresh(refreshToken: string) {
  return fetchToken(new URLSearchParams({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }));
}

async function getAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  if (cached?.refreshToken) {
    try {
      cached = await authRefresh(cached.refreshToken);
      return cached.token;
    } catch {
      // fallback sur password
    }
  }
  cached = await authPassword();
  return cached.token;
}

type ApiResponse = Record<string, unknown> & { errcode?: number; errmsg?: string };

export async function tthotelPost<T extends ApiResponse = ApiResponse>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const token = await getAccessToken();
  const body = new URLSearchParams({
    clientId: CLIENT_ID,
    accessToken: token,
    date: Date.now().toString(),
  });
  for (const [k, v] of Object.entries(params)) body.set(k, String(v));

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    // TTHotel a renvoyé du HTML/texte au lieu de JSON.
    // Cas typiques : endpoint inexistant pour ce type de compte, route déplacée, etc.
    const preview = text.replace(/\s+/g, ' ').slice(0, 200);
    throw new Error(`TTHotel ${path}: réponse non-JSON (HTTP ${res.status}). Aperçu: ${preview}`);
  }
  if (typeof data.errcode === 'number' && data.errcode !== 0) {
    throw new Error(`TTHotel ${path} errcode=${data.errcode} ${data.errmsg ?? ''}`);
  }
  return data;
}

// ─── Helpers métier ─────────────────────────────────────────────────────────

export type TTLock = {
  lockId: number;
  lockAlias: string;
  lockMac?: string;
  electricQuantity?: number;
  hasGateway?: number;
  featureValue?: string;
  buildingNumber?: number;
  floorNumber?: number;
  buildingName?: string;
  floorName?: string;
};

export async function listLocks(pageNo = 1, pageSize = 100) {
  return tthotelPost<{ list: TTLock[]; pageNo: number; pageSize: number; total: number }>(
    '/v3/lock/list',
    { pageNo, pageSize },
  );
}

export async function listLocksByHotel(pageNo = 1, pageSize = 100) {
  return tthotelPost<{ list: TTLock[]; pageNo: number; pageSize: number; total: number }>(
    '/v3/lock/listByHotel',
    { pageNo, pageSize },
  );
}

/** Renvoie un Map lockId → infos serrure (mac, building, floor) pour tout l'hôtel. */
export async function getHotelLocksMap(): Promise<Map<number, TTLock>> {
  const map = new Map<number, TTLock>();
  let pageNo = 1;
  while (pageNo < 20) {
    const page = await listLocksByHotel(pageNo, 100);
    for (const l of page.list ?? []) map.set(l.lockId, l);
    if (!page.list || page.list.length < 100) break;
    pageNo += 1;
  }
  return map;
}

export type GatewayInfo = { gatewayId: number; gatewayName: string; isOnline: number };

/** Liste des passerelles du compte avec leur état en ligne. */
export async function listGateways(): Promise<GatewayInfo[]> {
  const res = await tthotelPost<{ list?: GatewayInfo[] }>('/v3/gateway/list', {
    pageNo: 1,
    pageSize: 100,
  });
  return res.list ?? [];
}

/** Teste si une serrure est joignable MAINTENANT via une passerelle en ligne. */
export async function isLockReachable(lockId: number): Promise<boolean> {
  try {
    await tthotelPost('/v3/lock/queryOpenState', { lockId });
    return true;
  } catch {
    return false;
  }
}

// Couverture gateway par serrure (hasGateway), mise en cache : change rarement
// et l'UI interroge souvent. TTL 60 s.
let gwCache: { at: number; map: Map<number, boolean> } | null = null;

// Niveau de batterie par serrure (electricQuantity), caché (change lentement).
let batCache: { at: number; map: Map<number, number | null> } | null = null;

export async function getLockBatteries(ttlMs = 300_000): Promise<Map<number, number | null>> {
  if (batCache && Date.now() - batCache.at < ttlMs) return batCache.map;
  const locks = await getHotelLocksMap();
  const map = new Map<number, number | null>(
    [...locks].map(([id, l]) => [id, typeof l.electricQuantity === 'number' ? l.electricQuantity : null]),
  );
  batCache = { at: Date.now(), map };
  return map;
}

export async function getGatewayCoverage(ttlMs = 60_000): Promise<Map<number, boolean>> {
  if (gwCache && Date.now() - gwCache.at < ttlMs) return gwCache.map;
  const locks = await getHotelLocksMap();
  const map = new Map([...locks].map(([id, l]) => [id, l.hasGateway === 1]));
  gwCache = { at: Date.now(), map };
  return map;
}

// Pour TTHotel, toutes les opérations doivent passer addType/changeType/deleteType=2
// (cloud) sinon Tomcat répond 400 sans message. addType=1 = SDK Bluetooth local.
const VIA_CLOUD = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Réveille la serrure via le gateway (best-effort, ignore l'échec). */
async function wakeLock(lockId: number) {
  try {
    await tthotelPost('/v3/lock/queryOpenState', { lockId });
  } catch {
    // serrure endormie / momentanément injoignable — on tente quand même la suite
  }
}

/**
 * Exécute une opération gateway→serrure avec réveil + retry. Les serrures
 * dorment : le 1er appel renvoie souvent `errcode 1` (failed), ça passe après
 * un queryOpenState (réveil). Vaut pour add/delete/change code ET carte.
 */
async function withGatewayRetry<T>(lockId: number, op: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    await wakeLock(lockId);
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      await sleep(1500);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Génère un code numérique de `length` chiffres, en évitant les patterns triviaux. */
function pickRandomShortCode(length = 4): string {
  for (let attempts = 0; attempts < 100; attempts++) {
    const code = Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
    // Refuse répétitions (0000, 1111…)
    if (/^(\d)\1+$/.test(code)) continue;
    // Refuse séquences strictement croissantes/décroissantes (1234, 9876…)
    const digits = code.split('').map(Number);
    let asc = true;
    let desc = true;
    for (let i = 1; i < digits.length; i++) {
      if (digits[i] !== digits[i - 1] + 1) asc = false;
      if (digits[i] !== digits[i - 1] - 1) desc = false;
    }
    if (!asc && !desc) return code;
  }
  return String(1000 + Math.floor(Math.random() * 9000));
}

/**
 * Crée un code custom à 4 chiffres valide sur [startMs, endMs[ et le renvoie.
 *
 * On le POUSSE sur la serrure via la passerelle (`addType=2`). Un code custom
 * (choisi par nous) n'est PAS validable par l'algorithme local de la serrure —
 * seuls les codes générés par keyboardPwd/get le sont. Sans ce push, la serrure
 * ne reçoit jamais le code et il n'ouvre pas. Nécessite donc une passerelle
 * joignable sur la chambre.
 */
/** Génère un code à 4 chiffres (sans patterns triviaux). */
export function generatePasscode(): string {
  return pickRandomShortCode(4);
}

/** Pousse un code donné sur UNE serrure via la passerelle. Renvoie son id. */
export async function pushPasscode(
  lockId: number,
  code: string,
  startMs: number,
  endMs: number,
  name?: string,
): Promise<number> {
  const res = await withGatewayRetry(lockId, () =>
    tthotelPost<{ keyboardPwdId: number }>('/v3/keyboardPwd/add', {
      lockId,
      keyboardPwd: code,
      keyboardPwdType: 3, // 3 = period passcode (valide sur [start, end])
      startDate: startMs,
      endDate: endMs,
      addType: VIA_CLOUD, // pousse le code sur la serrure via la passerelle
      ...(name ? { keyboardPwdName: name } : {}),
    }),
  );
  return res.keyboardPwdId;
}

export async function addRandomPasscode(
  lockId: number,
  startMs: number,
  endMs: number,
  name?: string,
) {
  const code = generatePasscode();
  const keyboardPwdId = await pushPasscode(lockId, code, startMs, endMs, name);
  return { keyboardPwdId, keyboardPwd: code };
}

export async function deletePasscode(lockId: number, keyboardPwdId: number) {
  return withGatewayRetry(lockId, () =>
    tthotelPost('/v3/keyboardPwd/delete', {
      lockId,
      keyboardPwdId,
      deleteType: VIA_CLOUD,
    }),
  );
}

export async function changePasscodePeriod(
  lockId: number,
  keyboardPwdId: number,
  startMs: number,
  endMs: number,
) {
  return withGatewayRetry(lockId, () =>
    tthotelPost('/v3/keyboardPwd/change', {
      lockId,
      keyboardPwdId,
      startDate: startMs,
      endDate: endMs,
      changeType: VIA_CLOUD,
    }),
  );
}

// ─── Cartes IC (révocation via gateway) ──────────────────────────────────────
// Nos cartes réception sont écrites par l'encodeur (secteurs hôtel) et ne sont
// PAS connues du cloud. Pour révoquer une carte précise sans toucher au pass ni
// aux autres cartes, on l'enregistre en IC par son numéro (add) puis on la
// supprime (delete) — séquence validée en réel le 2026-06-01 sur la chambre 11.
// Les deux ops passent par le gateway (addType/deleteType=2). La serrure peut
// dormir : queryOpenState la réveille, et on retente (cf. withGatewayRetry).

export type CardRevokeResult = { lockId: number; ok: boolean; error?: string };

/** Cherche le cardId d'une carte (par son numéro) enregistrée sur une serrure. */
async function findCardIdByNumber(lockId: number, cardNumber: string): Promise<number | null> {
  const now = Date.now();
  const res = await tthotelPost<{ list?: { cardId: number; cardNumber: string }[] }>(
    '/v3/identityCard/list',
    { lockId, pageNo: 1, pageSize: 100, startDate: now - 365 * 86_400_000, endDate: now + 400 * 86_400_000 },
  );
  const found = (res.list ?? []).find((c) => String(c.cardNumber) === String(cardNumber));
  return found?.cardId ?? null;
}

/**
 * Autorise une carte (par son numéro) sur UNE serrure, via gateway.
 * Indispensable à l'encodage : révoquer une carte BLACKLISTE son UID sur la
 * serrure, donc réutiliser plus tard cette carte physique échoue ("unauthorized")
 * tant qu'on ne l'a pas ré-autorisée. Si la carte est déjà enregistrée, no-op.
 */
export async function authorizeCardOnLock(
  lockId: number,
  cardNumber: string,
  endMs: number,
): Promise<void> {
  const existing = await findCardIdByNumber(lockId, cardNumber);
  if (existing) {
    // Déjà autorisée : on réaligne sa validité sur le séjour courant (évite
    // qu'une carte réutilisée garde une ancienne validité plus longue).
    await withGatewayRetry(lockId, () =>
      tthotelPost('/v3/identityCard/changePeriod', {
        lockId,
        cardId: existing,
        startDate: Date.now(),
        endDate: endMs,
        changeType: VIA_CLOUD,
      }),
    );
    return;
  }
  await withGatewayRetry(lockId, () =>
    tthotelPost('/v3/identityCard/add', {
      lockId,
      cardNumber,
      cardName: 'GUEST',
      startDate: Date.now(),
      endDate: endMs,
      addType: VIA_CLOUD,
    }),
  );
}

/** Autorise une carte sur plusieurs serrures, best-effort, sans s'arrêter au 1er échec. */
export async function authorizeCardOnLocks(
  lockIds: number[],
  cardNumber: string,
  endMs: number,
): Promise<CardRevokeResult[]> {
  const results: CardRevokeResult[] = [];
  for (const lockId of lockIds) {
    try {
      await authorizeCardOnLock(lockId, cardNumber, endMs);
      results.push({ lockId, ok: true });
    } catch (err) {
      results.push({ lockId, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/**
 * Révoque une carte (par son numéro) sur UNE serrure, via gateway.
 * On supprime l'enregistrement IC existant (créé à l'autorisation) — ce delete
 * blackliste l'UID sur la serrure. Si aucun enregistrement n'existe (carte
 * encodée sans gateway), on l'ajoute d'abord pour pouvoir le supprimer.
 * Réveil + retry sur le delete (la serrure peut dormir).
 */
export async function revokeCardOnLock(lockId: number, cardNumber: string): Promise<void> {
  let cardId = await findCardIdByNumber(lockId, cardNumber);
  if (!cardId) {
    const now = Date.now();
    const add = await withGatewayRetry(lockId, () =>
      tthotelPost<{ cardId: number }>('/v3/identityCard/add', {
        lockId,
        cardNumber,
        cardName: 'REVOKE',
        startDate: now,
        endDate: now + 86_400_000,
        addType: VIA_CLOUD,
      }),
    );
    cardId = add.cardId;
    if (!cardId) throw new Error('identityCard/add: pas de cardId renvoyé');
  }

  await withGatewayRetry(lockId, () =>
    tthotelPost('/v3/identityCard/delete', { lockId, cardId, deleteType: VIA_CLOUD }),
  );
}

/** Révoque une carte sur plusieurs serrures, sans s'arrêter au 1er échec. */
export async function revokeCardOnLocks(
  lockIds: number[],
  cardNumber: string,
): Promise<CardRevokeResult[]> {
  const results: CardRevokeResult[] = [];
  for (const lockId of lockIds) {
    try {
      await revokeCardOnLock(lockId, cardNumber);
      results.push({ lockId, ok: true });
    } catch (err) {
      results.push({ lockId, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
