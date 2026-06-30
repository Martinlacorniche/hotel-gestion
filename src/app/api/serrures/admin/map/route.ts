import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';

// Crée le mapping lockId TTHotel ↔ chambre (table public.chambres).
// Réservé aux admins (réglages serrures).
// POST { hotel_id, numero, tthotel_lock_id, tthotel_lock_alias? }

export async function POST(req: Request) {
  const auth = await requireRole(req, ['admin', 'superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON invalide' }, { status: 400 });
  }

  const { hotel_id, numero, tthotel_lock_id, tthotel_lock_alias } = body as {
    hotel_id?: string;
    numero?: string;
    tthotel_lock_id?: number;
    tthotel_lock_alias?: string;
  };

  if (!hotel_id || !numero || !tthotel_lock_id) {
    return NextResponse.json(
      { ok: false, error: 'hotel_id, numero et tthotel_lock_id requis' },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from('chambres')
    .insert({
      hotel_id,
      numero: String(numero).trim(),
      tthotel_lock_id,
      tthotel_lock_alias: tthotel_lock_alias ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, chambre: data });
}

// Remplace la serrure d'une chambre DÉJÀ mappée (changement physique de serrure).
// On met à jour `tthotel_lock_id` sur la ligne existante — l'historique des
// séjours (rattachés par chambre_id) est conservé. C'est l'opération correcte
// quand on a remplacé une serrure : le « démapper » échouerait sur la FK des
// séjours, et de toute façon supprimerait tout l'historique.
// PATCH { id, tthotel_lock_id, tthotel_lock_alias? }
export async function PATCH(req: Request) {
  const auth = await requireRole(req, ['admin', 'superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON invalide' }, { status: 400 });
  }

  const { id, tthotel_lock_id, tthotel_lock_alias } = body as {
    id?: string;
    tthotel_lock_id?: number;
    tthotel_lock_alias?: string;
  };

  if (!id || !tthotel_lock_id) {
    return NextResponse.json({ ok: false, error: 'id et tthotel_lock_id requis' }, { status: 400 });
  }

  // Garde-fou : refuse d'affecter une serrure déjà rattachée à une AUTRE chambre.
  const { data: clash, error: eClash } = await supabaseAdmin
    .from('chambres')
    .select('id, numero')
    .eq('tthotel_lock_id', tthotel_lock_id)
    .neq('id', id)
    .maybeSingle();
  if (eClash) return NextResponse.json({ ok: false, error: eClash.message }, { status: 500 });
  if (clash) {
    return NextResponse.json(
      { ok: false, error: `Cette serrure est déjà mappée à la chambre ${clash.numero}` },
      { status: 409 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from('chambres')
    .update({
      tthotel_lock_id,
      ...(tthotel_lock_alias !== undefined ? { tthotel_lock_alias } : {}),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, chambre: data });
}

export async function DELETE(req: Request) {
  const auth = await requireRole(req, ['admin', 'superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id requis' }, { status: 400 });

  const { error } = await supabaseAdmin.from('chambres').delete().eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
