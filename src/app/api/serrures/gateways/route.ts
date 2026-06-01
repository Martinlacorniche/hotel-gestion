import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { listGateways, getHotelLocksMap, isLockReachable } from '@/lib/tthotel';
import { requireRole } from '@/lib/apiAuth';

// GET /api/serrures/gateways          → état passerelles + par chambre :
//   gateway associée (hasGateway) + batterie (electricQuantity). RAPIDE.
// GET /api/serrures/gateways?reach=1  → ajoute la joignabilité réelle
//   (queryOpenState séquentiel, ~1-2s/serrure) — sur demande, car lent.

export async function GET(req: Request) {
  const auth = await requireRole(req, ['superadmin', 'admin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const withReach = new URL(req.url).searchParams.get('reach') === '1';

  const { data: chambres, error } = await supabaseAdmin
    .from('chambres')
    .select('numero, tthotel_lock_id, ordre')
    .order('ordre', { ascending: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  let gateways: { name: string; online: boolean }[] = [];
  let locksMap: Awaited<ReturnType<typeof getHotelLocksMap>>;
  try {
    const [gws, lm] = await Promise.all([listGateways(), getHotelLocksMap()]);
    gateways = gws.map((g) => ({ name: g.gatewayName, online: g.isOnline === 1 }));
    locksMap = lm;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  // Joignabilité : optionnelle et SÉQUENTIELLE (une passerelle ne parle qu'à une
  // serrure à la fois — en parallèle tout échoue par contention).
  const reachByLock = new Map<number, boolean>();
  if (withReach) {
    for (const c of chambres ?? []) {
      reachByLock.set(c.tthotel_lock_id, await isLockReachable(c.tthotel_lock_id));
    }
  }

  const rooms = (chambres ?? []).map((c) => {
    const l = locksMap.get(c.tthotel_lock_id);
    return {
      numero: c.numero as string,
      lockId: c.tthotel_lock_id as number,
      hasGateway: l?.hasGateway === 1,
      battery: typeof l?.electricQuantity === 'number' ? l.electricQuantity : null,
      reachable: withReach ? (reachByLock.get(c.tthotel_lock_id) ?? false) : null,
    };
  });

  return NextResponse.json({ ok: true, gateways, rooms, reachTested: withReach });
}
