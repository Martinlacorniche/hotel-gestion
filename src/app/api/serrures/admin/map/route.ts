import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// Crée le mapping lockId TTHotel ↔ chambre (table public.chambres).
// POST { hotel_id, numero, tthotel_lock_id, tthotel_lock_alias? }

export async function POST(req: Request) {
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

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id requis' }, { status: 400 });

  const { error } = await supabaseAdmin.from('chambres').delete().eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
