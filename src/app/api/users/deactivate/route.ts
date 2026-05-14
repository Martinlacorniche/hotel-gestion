import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole, type AppRole } from '@/lib/apiAuth';

// POST /api/users/deactivate
// Body: { user_id: uuid (id_auth), employment_end_date?: 'YYYY-MM-DD' }
//
// Désactive un user : ban auth (impossible de se loguer) + active=false +
// employment_end_date dans public.users.
// JAMAIS de delete — voir feedback_no_user_delete (loi française conservation
// plannings).
//
// Règles :
//  - superadmin : peut désactiver n'importe qui sauf lui-même.
//  - admin     : ne peut désactiver QUE les role='user'.

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

  const { user_id, employment_end_date } = body as {
    user_id?: string;
    employment_end_date?: string;
  };

  if (!user_id || typeof user_id !== 'string') {
    return NextResponse.json({ ok: false, error: 'user_id requis' }, { status: 400 });
  }

  if (user_id === auth.userId) {
    return NextResponse.json({ ok: false, error: 'Impossible de se désactiver soi-même' }, { status: 403 });
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
      { ok: false, error: 'Un admin ne peut désactiver que des role=user' },
      { status: 403 },
    );
  }

  const { error: banErr } = await supabaseAdmin.rpc('ban_user', { p_user_id: user_id });
  if (banErr) {
    return NextResponse.json({ ok: false, error: 'Ban auth: ' + banErr.message }, { status: 500 });
  }

  const { error: upErr } = await supabaseAdmin
    .from('users')
    .update({
      active: false,
      employment_end_date: employment_end_date || new Date().toISOString().slice(0, 10),
    })
    .eq('id_auth', user_id);

  if (upErr) {
    return NextResponse.json({ ok: false, error: 'Update public.users: ' + upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
