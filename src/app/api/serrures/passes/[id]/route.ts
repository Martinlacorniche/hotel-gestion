import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { revokeCardOnLocks } from '@/lib/tthotel';
import { requireRole } from '@/lib/apiAuth';

// DELETE /api/serrures/passes/:id  → RÉVOQUE la carte du pass sur toutes ses
// serrures (add+delete via gateway = blacklist de l'UID), puis retire le pass.
// Si la révocation échoue sur des serrures (injoignables), on garde le pass et
// on remonte le détail pour pouvoir réessayer.

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireRole(req, ['superadmin', 'admin', 'user']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;

  const { data: pass, error: eP } = await supabaseAdmin
    .from('passes')
    .select('id, last_job_id')
    .eq('id', id)
    .single();
  if (eP || !pass) {
    return NextResponse.json({ ok: false, error: eP?.message ?? 'pass introuvable' }, { status: 404 });
  }

  // Carte du pass + serrures couvertes, depuis son dernier job d'encodage.
  let results: { lockId: number; ok: boolean; error?: string }[] = [];
  if (pass.last_job_id) {
    const { data: job } = await supabaseAdmin
      .from('jobs_encodeur')
      .select('payload, resultat')
      .eq('id', pass.last_job_id)
      .single();
    const cardNo = (job?.resultat as { card_no?: string } | null)?.card_no;
    const lockIds = ((job?.payload as { lockIds?: number[] } | null)?.lockIds) ?? [];
    if (cardNo && lockIds.length) {
      results = await revokeCardOnLocks(lockIds, cardNo);
    }
  }

  const allOk = results.every((r) => r.ok);

  // On ne retire le pass que si tout a été révoqué (sinon on garde pour réessayer).
  if (allOk) {
    const { error } = await supabaseAdmin.from('passes').delete().eq('id', id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: allOk, results, removed: allOk });
}
