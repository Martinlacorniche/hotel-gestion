import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole, type AppRole } from '@/lib/apiAuth';

// POST /api/users/reactivate
// Body: { user_id: uuid (id_auth) }
//
// Réactive un user précédemment désactivé : unban auth + active=true +
// employment_end_date=null dans public.users.
//
// Règles :
//  - superadmin : peut réactiver n'importe qui.
//  - admin     : ne peut réactiver QUE les role='user'.

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

  const { user_id } = body as { user_id?: string };
  if (!user_id || typeof user_id !== 'string') {
    return NextResponse.json({ ok: false, error: 'user_id requis' }, { status: 400 });
  }

  const { data: target, error: tErr } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id_auth', user_id)
    .single();
  if (tErr || !target) {
    return NextResponse.json({ ok: false, error: 'User cible introuvable' }, { status: 404 });
  }

  const targetRole = target.role as AppRole;
  if (auth.role === 'admin' && targetRole !== 'user') {
    return NextResponse.json(
      { ok: false, error: 'Un admin ne peut réactiver que des role=user' },
      { status: 403 },
    );
  }

  const { error: unbanErr } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
    ban_duration: 'none',
  });
  if (unbanErr) {
    return NextResponse.json({ ok: false, error: 'Unban auth: ' + unbanErr.message }, { status: 500 });
  }

  const { error: upErr } = await supabaseAdmin
    .from('users')
    .update({ active: true, employment_end_date: null })
    .eq('id_auth', user_id);

  if (upErr) {
    return NextResponse.json({ ok: false, error: 'Update public.users: ' + upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
