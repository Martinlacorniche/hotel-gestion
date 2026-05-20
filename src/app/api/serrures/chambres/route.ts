import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';

// Liste les chambres avec leur séjour actif (si présent), pour la grille UI.

export async function GET(req: Request) {
  const auth = await requireRole(req, ['superadmin', 'admin', 'user']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const { data: chambres, error: errC } = await supabaseAdmin
    .from('chambres')
    .select('id, hotel_id, numero, tthotel_lock_id, tthotel_lock_alias, ordre')
    .order('ordre', { ascending: true })
    .order('numero', { ascending: true });
  if (errC) return NextResponse.json({ ok: false, error: errC.message }, { status: 500 });

  const { data: sejours, error: errS } = await supabaseAdmin
    .from('sejours')
    .select('*')
    .in('statut', ['actif', 'pending']);
  if (errS) return NextResponse.json({ ok: false, error: errS.message }, { status: 500 });

  const byChambre = new Map<string, typeof sejours[number]>();
  for (const s of sejours ?? []) byChambre.set(s.chambre_id, s);

  return NextResponse.json({
    ok: true,
    chambres: (chambres ?? []).map((c) => ({
      ...c,
      sejour: byChambre.get(c.id) ?? null,
    })),
  });
}
