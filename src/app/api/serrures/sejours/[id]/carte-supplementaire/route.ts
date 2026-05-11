import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getHotelLocksMap } from '@/lib/tthotel';

// POST /api/serrures/sejours/:id/carte-supplementaire
// Crée 1 nouveau job d'encodage avec les mêmes droits que le séjour existant
// (mêmes serrures, même fin). Utile pour faire un double ou ajouter un occupant.
// `id` peut être un séjour racine ou enfant (cas multi-chambres) — on remonte au head.

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  const { data: sejour, error: eS } = await supabaseAdmin
    .from('sejours')
    .select('*')
    .eq('id', id)
    .single();
  if (eS || !sejour) {
    return NextResponse.json({ ok: false, error: eS?.message ?? 'séjour introuvable' }, { status: 404 });
  }
  if (sejour.methode !== 'carte') {
    return NextResponse.json({ ok: false, error: 'séjour non carte' }, { status: 400 });
  }
  if (sejour.statut !== 'actif' && sejour.statut !== 'pending') {
    return NextResponse.json({ ok: false, error: 'séjour non actif' }, { status: 409 });
  }

  const headId = sejour.parent_sejour_id ?? sejour.id;

  // Récupère tous les séjours liés (head + enfants) pour reconstituer la liste de serrures
  const { data: linked, error: eL } = await supabaseAdmin
    .from('sejours')
    .select('id, chambre_id, debut, fin, parent_sejour_id, chambres(tthotel_lock_id, numero, hotel_id)')
    .or(`id.eq.${headId},parent_sejour_id.eq.${headId}`);
  if (eL || !linked || linked.length === 0) {
    return NextResponse.json({ ok: false, error: eL?.message ?? 'séjours liés introuvables' }, { status: 500 });
  }

  const head = linked.find((s) => s.id === headId) ?? linked[0];
  const hotelId = (head as unknown as { chambres: { hotel_id: string } }).chambres.hotel_id;

  let locksMeta: Array<{ lockId: number; mac: string; buildNo: number; floorNo: number }>;
  try {
    const map = await getHotelLocksMap();
    locksMeta = linked.map((s) => {
      const ch = (s as unknown as { chambres: { tthotel_lock_id: number; numero: string } }).chambres;
      const info = map.get(ch.tthotel_lock_id);
      if (!info || info.buildingNumber === undefined || info.floorNumber === undefined || !info.lockMac) {
        throw new Error(`Infos hôtel manquantes pour lockId ${ch.tthotel_lock_id} (${ch.numero})`);
      }
      return {
        lockId: ch.tthotel_lock_id,
        mac: info.lockMac,
        buildNo: info.buildingNumber,
        floorNo: info.floorNumber,
      };
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  // Compte les jobs write_card déjà émis pour ce séjour pour numéroter la nouvelle carte
  const { count: existingCount } = await supabaseAdmin
    .from('jobs_encodeur')
    .select('*', { count: 'exact', head: true })
    .eq('sejour_id', headId)
    .eq('action', 'write_card');
  const carteIndex = (existingCount ?? 0) + 1;

  const { data: job, error: eJ } = await supabaseAdmin
    .from('jobs_encodeur')
    .insert({
      hotel_id: hotelId,
      sejour_id: headId,
      action: 'write_card',
      statut: 'queued',
      payload: {
        lockIds: locksMeta.map((l) => l.lockId),
        locks: locksMeta,
        sejourIds: linked.map((s) => s.id),
        debut: head.debut,
        fin: head.fin,
        carte_index: carteIndex,
        total_cartes: carteIndex,
      },
    })
    .select()
    .single();
  if (eJ) return NextResponse.json({ ok: false, error: eJ.message }, { status: 500 });

  return NextResponse.json({ ok: true, job, sejourIds: linked.map((s) => s.id) });
}
