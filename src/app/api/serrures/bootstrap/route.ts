import { NextResponse } from 'next/server';
import { listLocks } from '@/lib/tthotel';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';

// Endpoint qui agrège : serrures TTHotel + hôtels en DB + chambres déjà mappées.
// Sert de "page d'admin" pour faire le mapping initial lockId ↔ chambre.
// Réservé aux admins (réglages serrures).

export async function GET(req: Request) {
  const auth = await requireRole(req, ['admin', 'superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  try {
    const [locksRes, hotelsRes, chambresRes] = await Promise.all([
      listLocks(1, 100),
      supabaseAdmin.from('hotels').select('id, nom, slug').order('nom'),
      supabaseAdmin
        .from('chambres')
        .select('id, hotel_id, numero, tthotel_lock_id, tthotel_lock_alias')
        .order('numero'),
    ]);

    if (hotelsRes.error) throw new Error(`Supabase hotels: ${hotelsRes.error.message}`);
    if (chambresRes.error) throw new Error(`Supabase chambres: ${chambresRes.error.message}`);

    const locks = (locksRes.list ?? []).map((l) => ({
      lockId: l.lockId,
      alias: l.lockAlias,
      mac: l.lockMac,
      battery: l.electricQuantity,
      hasGateway: !!l.hasGateway,
    }));

    return NextResponse.json({
      ok: true,
      hotels: hotelsRes.data ?? [],
      chambres: chambresRes.data ?? [],
      locks,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
