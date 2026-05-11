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

// Pour TTHotel, toutes les opérations doivent passer addType/changeType/deleteType=2
// (cloud) sinon Tomcat répond 400 sans message. addType=1 = SDK Bluetooth local.
const VIA_CLOUD = 2;

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
 * On utilise /v3/keyboardPwd/add SANS addType : TTHotel enregistre le code côté
 * cloud avec une validité algorithmique → la serrure le valide LOCALEMENT,
 * sans gateway ni sync BLE. C'est l'astuce TTHotel pour les codes "online"
 * sur serrures non-gateway.
 */
export async function addRandomPasscode(
  lockId: number,
  startMs: number,
  endMs: number,
  name?: string,
) {
  const code = pickRandomShortCode(4);
  const res = await tthotelPost<{ keyboardPwdId: number }>('/v3/keyboardPwd/add', {
    lockId,
    keyboardPwd: code,
    keyboardPwdType: 3, // 3 = period passcode (valide sur [start, end])
    startDate: startMs,
    endDate: endMs,
    ...(name ? { keyboardPwdName: name } : {}),
  });
  return { keyboardPwdId: res.keyboardPwdId, keyboardPwd: code };
}

export async function deletePasscode(lockId: number, keyboardPwdId: number) {
  return tthotelPost('/v3/keyboardPwd/delete', {
    lockId,
    keyboardPwdId,
    deleteType: VIA_CLOUD,
  });
}

export async function changePasscodePeriod(
  lockId: number,
  keyboardPwdId: number,
  startMs: number,
  endMs: number,
) {
  return tthotelPost('/v3/keyboardPwd/change', {
    lockId,
    keyboardPwdId,
    startDate: startMs,
    endDate: endMs,
    changeType: VIA_CLOUD,
  });
}
