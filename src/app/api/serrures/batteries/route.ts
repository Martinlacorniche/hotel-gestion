import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getLockBatteries } from '@/lib/tthotel';
import { requireRole } from '@/lib/apiAuth';

// GET /api/serrures/batteries → serrures en batterie faible (≤ 10 %), pour
// alerter les équipes en réception. Accessible à tous les rôles ops. Caché 5 min.

const SEUIL = 10;

export async function GET(req: Request) {
  const auth = await requireRole(req, ['superadmin', 'admin', 'user']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const { data: chambres, error } = await supabaseAdmin
    .from('chambres')
    .select('numero, tthotel_lock_id')
    .order('ordre', { ascending: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  let batteries: Map<number, number | null>;
  try {
    batteries = await getLockBatteries();
  } catch {
    // TTHotel indisponible → pas d'alerte plutôt qu'une erreur bloquante
    return NextResponse.json({ ok: true, low: [] });
  }

  const low = (chambres ?? [])
    .map((c) => ({ numero: c.numero as string, battery: batteries.get(c.tthotel_lock_id) ?? null }))
    .filter((r) => r.battery != null && r.battery <= SEUIL)
    .sort((a, b) => (a.battery ?? 0) - (b.battery ?? 0));

  return NextResponse.json({ ok: true, low });
}
