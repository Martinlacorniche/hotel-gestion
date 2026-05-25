import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';

// PATCH /api/haccp/sensors/:id
// Body : { location?, sensor_type?, temp_min?, temp_max?, alert_delay_min?, active?, notes? }
//
// Met à jour la configuration d'une sonde HACCP. Réservé aux admin/superadmin.
// Un admin ne peut modifier que les sondes de son hôtel ; le superadmin peut tout.

const ALLOWED_TYPES = ['negatif', 'positif', 'ambient'] as const;
type SensorType = (typeof ALLOWED_TYPES)[number];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(req, ['admin', 'superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: 'id requis' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON invalide' }, { status: 400 });
  }

  // Whitelist + validation
  const update: Record<string, unknown> = {};

  if (typeof body.location === 'string' && body.location.trim()) {
    update.location = body.location.trim();
  }
  if (typeof body.sensor_type === 'string' && ALLOWED_TYPES.includes(body.sensor_type as SensorType)) {
    update.sensor_type = body.sensor_type;
  }
  if (body.temp_min === null || (typeof body.temp_min === 'number' && isFinite(body.temp_min))) {
    update.temp_min = body.temp_min;
  }
  if (body.temp_max === null || (typeof body.temp_max === 'number' && isFinite(body.temp_max))) {
    update.temp_max = body.temp_max;
  }
  if (typeof body.alert_delay_min === 'number' && body.alert_delay_min >= 1) {
    update.alert_delay_min = Math.round(body.alert_delay_min);
  }
  if (typeof body.active === 'boolean') {
    update.active = body.active;
  }
  if (body.notes === null || typeof body.notes === 'string') {
    update.notes = body.notes;
  }

  // Cohérence min < max si les deux sont précisés
  const newMin = update.temp_min as number | null | undefined;
  const newMax = update.temp_max as number | null | undefined;
  if (typeof newMin === 'number' && typeof newMax === 'number' && newMin >= newMax) {
    return NextResponse.json(
      { ok: false, error: 'temp_min doit être strictement inférieur à temp_max' },
      { status: 400 },
    );
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: 'Aucun champ valide à mettre à jour' }, { status: 400 });
  }

  // Un admin (non-superadmin) ne peut modifier que les sondes de son hôtel
  if (auth.role === 'admin') {
    const { data: sensor } = await supabaseAdmin
      .from('haccp_sensors')
      .select('hotel_id')
      .eq('id', id)
      .single();
    if (!sensor || sensor.hotel_id !== auth.hotelId) {
      return NextResponse.json({ ok: false, error: 'Sonde non accessible pour cet utilisateur' }, { status: 403 });
    }
  }

  update.updated_at = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from('haccp_sensors')
    .update(update)
    .eq('id', id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
