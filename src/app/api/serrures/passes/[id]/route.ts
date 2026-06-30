import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getHotelLocksMap } from '@/lib/tthotel';
import { requireRole } from '@/lib/apiAuth';

// DELETE /api/serrures/passes/:id  → retire le pass IMMÉDIATEMENT (il disparaît de
// l'UI) et empile la révocation de sa carte dans `pass_revocations`. Un cron
// (revoke-drain) blackliste ensuite la carte serrure par serrure, en réessayant
// tant que des passerelles sont injoignables. Les serrures qui n'existent plus
// dans l'hôtel (ex. serrure remplacée) sont ignorées : la carte n'y ouvre rien.

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireRole(req, ['superadmin', 'admin', 'user']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;

  const { data: pass, error: eP } = await supabaseAdmin
    .from('passes')
    .select('id, hotel_id, label, last_job_id')
    .eq('id', id)
    .single();
  if (eP || !pass) {
    return NextResponse.json({ ok: false, error: eP?.message ?? 'pass introuvable' }, { status: 404 });
  }

  // Carte du pass + serrures couvertes, depuis son dernier job d'encodage.
  let cardNo: string | undefined;
  let lockIds: number[] = [];
  if (pass.last_job_id) {
    const { data: job } = await supabaseAdmin
      .from('jobs_encodeur')
      .select('payload, resultat')
      .eq('id', pass.last_job_id)
      .single();
    cardNo = (job?.resultat as { card_no?: string } | null)?.card_no;
    lockIds = ((job?.payload as { lockIds?: number[] } | null)?.lockIds) ?? [];
  }

  // On ne garde que les serrures encore présentes dans l'hôtel (les disparues
  // ne détiennent plus la carte → rien à révoquer). Best-effort : si TTHotel est
  // injoignable ici, on enfile tel quel, le drain filtrera.
  let pending = lockIds;
  if (cardNo && lockIds.length) {
    try {
      const map = await getHotelLocksMap();
      pending = lockIds.filter((l) => map.has(l));
    } catch {
      pending = lockIds;
    }
  }

  // Retrait immédiat du pass.
  const { error: eDel } = await supabaseAdmin.from('passes').delete().eq('id', id);
  if (eDel) return NextResponse.json({ ok: false, error: eDel.message }, { status: 500 });

  // Mise en file de la révocation (si carte connue et serrures à traiter).
  let queued = false;
  if (cardNo && pending.length) {
    const { error: eIns } = await supabaseAdmin.from('pass_revocations').insert({
      hotel_id: pass.hotel_id,
      card_no: cardNo,
      pass_label: pass.label ?? null,
      lock_ids: pending,
    });
    if (!eIns) queued = true;
  }

  return NextResponse.json({ ok: true, removed: true, queued, pendingLocks: pending.length });
}
