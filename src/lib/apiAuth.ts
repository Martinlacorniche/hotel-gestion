import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { NON_WORKED_SHIFTS, SHIFT_MARGIN_MIN } from '@/lib/shift';

// Helper d'authentification pour les API routes.
// Lit le header Authorization Bearer, valide le token via Supabase Auth,
// récupère le role de l'utilisateur dans public.users, et vérifie qu'il
// fait partie des rôles autorisés.
//
// À n'utiliser QUE depuis des fichiers server (API routes / server actions).

export type AppRole = 'superadmin' | 'admin' | 'user';

export type AuthResult =
  | { ok: true; userId: string; role: AppRole; hotelId: string | null }
  | { ok: false; status: number; error: string };

export async function requireRole(req: Request, allowed: AppRole[]): Promise<AuthResult> {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return { ok: false, status: 401, error: 'Auth header manquant' };
  }
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, status: 401, error: 'Token vide' };

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, error: 'Token invalide' };
  }

  const authId = userData.user.id;
  const { data: pu, error: puErr } = await supabaseAdmin
    .from('users')
    .select('role, hotel_id, active')
    .eq('id_auth', authId)
    .single();

  if (puErr || !pu) {
    return { ok: false, status: 403, error: 'Utilisateur absent de public.users' };
  }
  if (pu.active === false) {
    return { ok: false, status: 403, error: 'Utilisateur désactivé' };
  }

  const role = pu.role as AppRole;
  if (!allowed.includes(role)) {
    return { ok: false, status: 403, error: `Rôle ${role} non autorisé pour cette action` };
  }

  return { ok: true, userId: authId, role, hotelId: pu.hotel_id };
}

// --- Mode shift côté serveur -------------------------------------------------
// Vérifie qu'un rôle "user" est dans sa plage de service (shift planifié ± 2h),
// en HEURE DE PARIS (le serveur Netlify tourne en UTC). Reproduit la logique du
// ShiftContext client, mais comme garde-fou serveur pour les actions sensibles
// (encaissement). Admins/superadmins ne passent jamais par ici.

// Composantes "heure de Paris" d'un instant.
function parisParts(d: Date): { y: number; m: number; day: number; hh: number; mm: number } {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce<Record<string, string>>((a, x) => { a[x.type] = x.value; return a; }, {});
  return { y: +p.year, m: +p.month, day: +p.day, hh: +(p.hour === '24' ? '0' : p.hour), mm: +p.minute };
}
const pad2 = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
// Convertit une heure murale en instant fictif : l'offset Paris s'annule dans
// les comparaisons puisque "maintenant" et les bornes utilisent la même base.
const wall = (y: number, m: number, d: number, hh: number, mm: number) => Date.UTC(y, m - 1, d, hh, mm);

export async function isUserOnDuty(authUserId: string): Promise<boolean> {
  const now = parisParts(new Date());
  const today = ymd(now.y, now.m, now.day);
  const yWall = new Date(wall(now.y, now.m, now.day, 12, 0) - 86_400_000); // veille (shifts de nuit)
  const yest = ymd(yWall.getUTCFullYear(), yWall.getUTCMonth() + 1, yWall.getUTCDate());

  // planning_entries.user_id = id d'auth (cf. AuthContext / ShiftContext).
  const { data } = await supabaseAdmin
    .from('planning_entries')
    .select('date, shift, start_time, end_time')
    .eq('user_id', authUserId)
    .eq('status', 'published')
    .in('date', [yest, today]);

  if (!data?.length) return false;
  const nowWall = wall(now.y, now.m, now.day, now.hh, now.mm);
  const margin = SHIFT_MARGIN_MIN * 60_000;

  return data.some((e) => {
    if (!e.shift || NON_WORKED_SHIFTS.includes(e.shift)) return false;
    if (!e.start_time || !e.end_time) return false;
    const s = String(e.start_time).slice(0, 5);
    const en = String(e.end_time).slice(0, 5);
    if (s === en) return false; // 00:00 → 00:00
    const [sy, sm, sd] = String(e.date).split('-').map(Number);
    const [sh, smin] = s.split(':').map(Number);
    const [eh, emin] = en.split(':').map(Number);
    const startWall = wall(sy, sm, sd, sh, smin);
    let endWall = wall(sy, sm, sd, eh, emin);
    if (endWall <= startWall) endWall += 86_400_000; // passe minuit (Night)
    return nowWall >= startWall - margin && nowWall <= endWall + margin;
  });
}

// Accès aux actions d'encaissement : admin/superadmin toujours ; rôle "user"
// uniquement pendant son service (mode shift), aligné sur le ShiftContext client.
export async function requirePaymentAccess(req: Request): Promise<AuthResult> {
  const auth = await requireRole(req, ['superadmin', 'admin', 'user']);
  if (!auth.ok) return auth;
  if (auth.role === 'user') {
    const onDuty = await isUserOnDuty(auth.userId);
    if (!onDuty) {
      return { ok: false, status: 403, error: 'Hors service : l\'encaissement n\'est disponible que pendant ton shift.' };
    }
  }
  return auth;
}
