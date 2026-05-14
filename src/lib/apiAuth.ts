import { supabaseAdmin } from '@/lib/supabaseAdmin';

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
