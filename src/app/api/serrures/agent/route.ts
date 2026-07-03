import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';

// GET /api/serrures/agent → état de l'agent encodeur (PC réception) pour le voyant
// « en ligne / hors ligne » sur /serrures. Accessible à tous les rôles ops.
// online = un battement de cœur reçu il y a moins de SEUIL_SEC secondes.

const SEUIL_SEC = 30;

export async function GET(req: Request) {
  const auth = await requireRole(req, ['superadmin', 'admin', 'user']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  // Les serrures sont configurées pour un hôtel (Les Voiles) : on prend le hotel_id
  // des chambres. Si un jour plusieurs hôtels ont des serrures, on filtrera dessus.
  const { data: ch } = await supabaseAdmin
    .from('chambres')
    .select('hotel_id')
    .not('tthotel_lock_id', 'is', null)
    .limit(1);
  const hotelId = ch?.[0]?.hotel_id as string | undefined;
  if (!hotelId) return NextResponse.json({ ok: true, online: false, encoderOk: false, ageSec: null });

  const { data: hb } = await supabaseAdmin
    .from('agent_heartbeat')
    .select('last_seen, encoder_ok, detail')
    .eq('hotel_id', hotelId)
    .maybeSingle();

  if (!hb) return NextResponse.json({ ok: true, online: false, encoderOk: false, ageSec: null });

  const ageSec = Math.round((Date.now() - new Date(hb.last_seen).getTime()) / 1000);
  const online = ageSec < SEUIL_SEC;

  return NextResponse.json({
    ok: true,
    online,
    encoderOk: online && !!hb.encoder_ok,
    ageSec,
    lastSeen: hb.last_seen,
    detail: hb.detail ?? null,
  });
}
