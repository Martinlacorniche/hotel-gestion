import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole, type AppRole } from '@/lib/apiAuth';

// POST /api/users/update-role
// Body: { user_id: uuid (id_auth), new_role: 'admin' | 'daf' | 'user' }
//
// Change le rôle d'un user. Réservé au superadmin.
// Ne permet PAS de créer un autre superadmin (modèle 1 seul superadmin).
// Ne permet PAS au superadmin de se rétrograder lui-même.

export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON invalide' }, { status: 400 });
  }

  const { user_id, new_role } = body as { user_id?: string; new_role?: AppRole };

  if (!user_id || typeof user_id !== 'string') {
    return NextResponse.json({ ok: false, error: 'user_id requis' }, { status: 400 });
  }
  if (!new_role || !['admin', 'daf', 'user'].includes(new_role)) {
    return NextResponse.json(
      { ok: false, error: 'new_role requis (admin|daf|user)' },
      { status: 400 },
    );
  }
  if (user_id === auth.userId) {
    return NextResponse.json(
      { ok: false, error: 'Impossible de modifier son propre rôle' },
      { status: 403 },
    );
  }

  const { error: upErr } = await supabaseAdmin
    .from('users')
    .update({ role: new_role })
    .eq('id_auth', user_id);

  if (upErr) {
    return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
