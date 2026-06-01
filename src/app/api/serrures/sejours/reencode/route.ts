import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getHotelLocksMap } from '@/lib/tthotel';
import { parseTime, tomorrowAtLocalTime } from '@/lib/checkout';
import { requireRole } from '@/lib/apiAuth';

// POST /api/serrures/sejours/reencode
// Ré-encode une carte pour une chambre DÉJÀ occupée.
//   body { chambre_id: uuid, mode: 'replace' | 'add', nuits?, nb_cartes?, checkout_hour?, checkout_min? }
//
//  - 'replace' : nouvelle validité (nuits/checkout) → on met à jour la fin du séjour,
//                puis on encode nb_cartes carte(s) avec les nouvelles dates.
//  - 'add'     : on garde les dates du séjour, on encode juste nb_cartes carte(s) en plus.
//
// La 1re carte est créée ici (job initial) ; les cartes 2..N passent par
// /carte-supplementaire (qui relit la fin courante du séjour → cohérent avec replace).

export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin', 'admin', 'user']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON invalide' }, { status: 400 });
  }

  const {
    chambre_id,
    mode,
    nuits: nuitsRaw,
    nb_cartes: nbCartesRaw,
    checkout_hour: checkoutHourRaw,
    checkout_min: checkoutMinRaw,
  } = body as {
    chambre_id?: string;
    mode?: 'replace' | 'add';
    nuits?: number;
    nb_cartes?: number;
    checkout_hour?: number;
    checkout_min?: number;
  };

  if (!chambre_id) {
    return NextResponse.json({ ok: false, error: 'chambre_id requis' }, { status: 400 });
  }
  if (mode !== 'replace' && mode !== 'add') {
    return NextResponse.json({ ok: false, error: 'mode requis (replace|add)' }, { status: 400 });
  }

  const nbCartes = Math.max(1, Math.min(10, Math.floor(nbCartesRaw ?? 1)));

  // Chambre + hôtel
  const { data: chambre, error: eC } = await supabaseAdmin
    .from('chambres')
    .select('id, hotel_id, numero, tthotel_lock_id, hotels(default_checkout_time)')
    .eq('id', chambre_id)
    .single();
  if (eC || !chambre) {
    return NextResponse.json({ ok: false, error: eC?.message ?? 'chambre introuvable' }, { status: 404 });
  }

  // Séjour actif de la chambre
  const { data: sejour, error: eS } = await supabaseAdmin
    .from('sejours')
    .select('*')
    .eq('chambre_id', chambre_id)
    .in('statut', ['actif', 'pending'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (eS) return NextResponse.json({ ok: false, error: eS.message }, { status: 500 });
  if (!sejour) {
    return NextResponse.json({ ok: false, error: 'aucun séjour actif sur cette chambre' }, { status: 409 });
  }

  // Calcule la fin (utile seulement en mode replace)
  const hotelCheckout = (chambre as unknown as { hotels: { default_checkout_time: string | null } }).hotels
    ?.default_checkout_time;
  const { hh: defaultHh, mm: defaultMm } = parseTime(hotelCheckout ?? '11:00');
  const hh =
    checkoutHourRaw !== undefined && Number.isFinite(checkoutHourRaw)
      ? Math.max(0, Math.min(23, Math.floor(checkoutHourRaw)))
      : defaultHh;
  const mm =
    checkoutMinRaw !== undefined && Number.isFinite(checkoutMinRaw)
      ? Math.max(0, Math.min(59, Math.floor(checkoutMinRaw)))
      : defaultMm;
  const nuits = Math.max(1, Math.min(30, Math.floor(nuitsRaw ?? 1)));

  const debutIso = sejour.debut as string;
  let finIso = sejour.fin as string;

  if (mode === 'replace') {
    const newFin = tomorrowAtLocalTime(hh, mm, undefined, nuits);
    finIso = newFin.toISOString();
    const { error: eU } = await supabaseAdmin
      .from('sejours')
      .update({ fin: finIso, statut: 'actif', updated_at: new Date().toISOString() })
      .eq('id', sejour.id);
    if (eU) return NextResponse.json({ ok: false, error: eU.message }, { status: 500 });
  }

  // Infos serrure pour l'agent
  let lockMeta: { lockId: number; mac: string; buildNo: number; floorNo: number };
  try {
    const map = await getHotelLocksMap();
    const info = map.get(chambre.tthotel_lock_id);
    if (!info || info.buildingNumber === undefined || info.floorNumber === undefined || !info.lockMac) {
      throw new Error(`Infos hôtel manquantes pour lockId ${chambre.tthotel_lock_id} (${chambre.numero})`);
    }
    lockMeta = {
      lockId: chambre.tthotel_lock_id,
      mac: info.lockMac,
      buildNo: info.buildingNumber,
      floorNo: info.floorNumber,
    };
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  const { data: job, error: eJ } = await supabaseAdmin
    .from('jobs_encodeur')
    .insert({
      hotel_id: chambre.hotel_id,
      sejour_id: sejour.id,
      action: 'write_card',
      statut: 'queued',
      payload: {
        lockIds: [lockMeta.lockId],
        locks: [lockMeta],
        sejourIds: [sejour.id],
        debut: debutIso,
        fin: finIso,
        carte_index: 1,
        total_cartes: nbCartes,
        // 'replace' = la nouvelle carte remplace les précédentes → on révoque les
        // anciennes cartes du séjour une fois la nouvelle encodée (cf. authorize).
        supersede: mode === 'replace',
      },
    })
    .select()
    .single();
  if (eJ || !job) {
    return NextResponse.json({ ok: false, error: eJ?.message ?? 'insert job' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    sejour: { ...sejour, fin: finIso },
    jobs: [job],
    total_cartes: nbCartes,
  });
}
