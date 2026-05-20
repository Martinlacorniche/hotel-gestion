import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { buildAllLocksMeta, dateInMonths } from '@/lib/serruresLocks';
import { requireRole } from '@/lib/apiAuth';

// GET  /api/serrures/passes   → liste des pass + statut d'encodage de leur dernière carte
// POST /api/serrures/passes   → crée un pass (carte 1 an, toutes les chambres) + job d'encodage
//   body { label?: string, mois?: number (1..24, défaut 12) }

export async function GET(req: Request) {
  const auth = await requireRole(req, ['superadmin', 'admin', 'user']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const { data: passes, error } = await supabaseAdmin
    .from('passes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const jobIds = (passes ?? []).map((p) => p.last_job_id).filter(Boolean) as string[];
  const statutByJob = new Map<string, string>();
  if (jobIds.length) {
    const { data: jobs } = await supabaseAdmin
      .from('jobs_encodeur')
      .select('id, statut')
      .in('id', jobIds);
    for (const j of jobs ?? []) statutByJob.set(j.id, j.statut);
  }

  return NextResponse.json({
    ok: true,
    passes: (passes ?? []).map((p) => ({
      ...p,
      job_statut: p.last_job_id ? statutByJob.get(p.last_job_id) ?? null : null,
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin', 'admin', 'user']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  let body: { label?: string; mois?: number } = {};
  try {
    body = await req.json();
  } catch {
    // body optionnel
  }
  const mois = Math.max(1, Math.min(24, Math.floor(body.mois ?? 12)));
  const label = (body.label ?? '').trim() || null;

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
  const fin = dateInMonths(mois);

  const { data: pass, error: eP } = await supabaseAdmin
    .from('passes')
    .insert({
      hotel_id: hotelId,
      label,
      debut: debut.toISOString(),
      fin: fin.toISOString(),
      statut: 'actif',
    })
    .select()
    .single();
  if (eP || !pass) {
    return NextResponse.json({ ok: false, error: eP?.message ?? 'insert pass' }, { status: 500 });
  }

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
        sejourIds: [], // pas de séjour à activer pour un pass
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

  await supabaseAdmin.from('passes').update({ last_job_id: job.id }).eq('id', pass.id);

  return NextResponse.json({ ok: true, pass: { ...pass, last_job_id: job.id }, job });
}
