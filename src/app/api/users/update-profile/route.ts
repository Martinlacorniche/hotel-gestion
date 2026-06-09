import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';

// POST /api/users/update-profile
// Body: { user_id: uuid (id_auth), name?: string, birth_date?: string | null, hotel_id?: string | null }
//
// Met à jour le nom, la date de naissance et/ou l'hôtel de rattachement d'un user.
// L'hôtel de rattachement (users.hotel_id) détermine dans quel planning le salarié
// apparaît (cf. /planning, filtre .eq('hotel_id', ...)).
// Réservé aux admin + superadmin. Refuse la modif d'un superadmin
// (cohérent avec les autres actions de la page /users).

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

  const { user_id, name, birth_date, hotel_id } = body as {
    user_id?: string;
    name?: string;
    birth_date?: string | null;
    hotel_id?: string | null;
  };

  if (!user_id || typeof user_id !== 'string') {
    return NextResponse.json({ ok: false, error: 'user_id requis' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof name === 'string') {
    const trimmed = name.trim();
    if (!trimmed) {
      return NextResponse.json({ ok: false, error: 'name ne peut pas être vide' }, { status: 400 });
    }
    update.name = trimmed;
  }
  if (birth_date === null || typeof birth_date === 'string') {
    update.birth_date = birth_date || null;
  }
  if (typeof hotel_id === 'string') {
    if (!hotel_id.trim()) {
      return NextResponse.json({ ok: false, error: 'hotel_id ne peut pas être vide' }, { status: 400 });
    }
    update.hotel_id = hotel_id;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  const { data: target, error: tgErr } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id_auth', user_id)
    .single();

  if (tgErr || !target) {
    return NextResponse.json({ ok: false, error: 'Utilisateur introuvable' }, { status: 404 });
  }
  if (target.role === 'superadmin') {
    return NextResponse.json(
      { ok: false, error: 'Impossible de modifier un superadmin' },
      { status: 403 },
    );
  }

  const { error: upErr } = await supabaseAdmin
    .from('users')
    .update(update)
    .eq('id_auth', user_id);

  if (upErr) {
    return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
