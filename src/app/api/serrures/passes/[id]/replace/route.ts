import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { buildAllLocksMeta, dateInMonths } from '@/lib/serruresLocks';

// POST /api/serrures/passes/:id/replace
// Ré-encode une nouvelle carte pour ce pass (carte perdue / renouvellement) :
// nouvelle validité 12 mois + nouveau job d'encodage. Sans gateway, l'ancienne
// carte physique reste valide jusqu'à sa date — la révocation viendra avec les gateways.

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  const { data: pass, error: eGet } = await supabaseAdmin
    .from('passes')
    .select('*')
    .eq('id', id)
    .single();
  if (eGet || !pass) {
    return NextResponse.json({ ok: false, error: eGet?.message ?? 'pass introuvable' }, { status: 404 });
  }

  let hotelId: string;
  let locks: Awaited<ReturnType<typeof buildAllLocksMeta>>['locks'];
  try {
    ({ hotelId, locks } = await buildAllLocksMeta());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  const debut = new Date();
  const fin = dateInMonths(12);

  const { data: job, error: eJ } = await supabaseAdmin
    .from('jobs_encodeur')
    .insert({
      hotel_id: hotelId,
      sejour_id: null,
      action: 'write_card',
      statut: 'queued',
      payload: {
        lockIds: locks.map((l) => l.lockId),
        locks,
        sejourIds: [],
        passId: pass.id,
        debut: debut.toISOString(),
        fin: fin.toISOString(),
        carte_index: 1,
        total_cartes: 1,
      },
    })
    .select()
    .single();
  if (eJ || !job) {
    return NextResponse.json({ ok: false, error: eJ?.message ?? 'insert job' }, { status: 500 });
  }

  await supabaseAdmin
    .from('passes')
    .update({
      debut: debut.toISOString(),
      fin: fin.toISOString(),
      last_job_id: job.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', pass.id);

  return NextResponse.json({
    ok: true,
    pass: { ...pass, debut: debut.toISOString(), fin: fin.toISOString(), last_job_id: job.id },
    job,
  });
}
