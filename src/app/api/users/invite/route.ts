import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';

// POST /api/users/invite
// Body: { email, name, role: 'admin' | 'user', hotel_id, birth_date? }
//
// Envoie une invitation par email via Supabase Auth (inviteUserByEmail).
// L'invité reçoit un mail avec un lien qui le redirige vers
// /update-password?flow=invite pour définir son mot de passe.
//
// Auth : superadmin OU admin. Seul un superadmin peut créer un admin.

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://consigneshtbm.com';

export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin', 'admin']);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON invalide' }, { status: 400 });
  }

  const { email, name, role, hotel_id, birth_date } = body as {
    email?: string;
    name?: string;
    role?: 'admin' | 'user';
    hotel_id?: string;
    birth_date?: string;
  };

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ ok: false, error: 'email requis' }, { status: 400 });
  }
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ ok: false, error: 'name requis' }, { status: 400 });
  }
  if (!role || !['admin', 'user'].includes(role)) {
    return NextResponse.json({ ok: false, error: 'role requis (admin|user)' }, { status: 400 });
  }
  if (!hotel_id || typeof hotel_id !== 'string') {
    return NextResponse.json({ ok: false, error: 'hotel_id requis' }, { status: 400 });
  }
  if (role === 'admin' && auth.role !== 'superadmin') {
    return NextResponse.json({ ok: false, error: 'Seul un superadmin peut créer un admin' }, { status: 403 });
  }

  const redirectTo = `${SITE_URL}/update-password?flow=invite`;

  const { data: invData, error: invErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: { name, role, hotel_id },
    redirectTo,
  });

  if (invErr || !invData?.user) {
    return NextResponse.json({ ok: false, error: invErr?.message || 'Erreur invitation' }, { status: 500 });
  }

  const newAuthId = invData.user.id;

  const { error: insErr } = await supabaseAdmin.from('users').insert({
    email,
    name,
    role,
    id_auth: newAuthId,
    hotel_id,
    birth_date: birth_date || null,
    active: true,
  });

  if (insErr) {
    return NextResponse.json({ ok: false, error: insErr.message, partial: 'auth_created' }, { status: 500 });
  }

  const { data: configs } = await supabaseAdmin
    .from('planning_config')
    .select('ordre')
    .eq('hotel_id', hotel_id);

  const maxOrdre =
    configs && configs.length
      ? Math.max(...configs.map((c) => ((c as { ordre: number | null }).ordre || 0)))
      : 0;

  await supabaseAdmin.from('planning_config').insert({
    user_id: newAuthId,
    hotel_id,
    ordre: maxOrdre + 1,
  });

  return NextResponse.json({ ok: true, user_id: newAuthId });
}
