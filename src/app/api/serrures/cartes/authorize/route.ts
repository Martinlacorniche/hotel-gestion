import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { authorizeCardOnLocks } from '@/lib/tthotel';
import { requireRole } from '@/lib/apiAuth';

// POST /api/serrures/cartes/authorize   body { jobId: string }
// Appelé par l'UI quand un job d'encodage carte passe `done` : ré-autorise la
// carte (par son numéro) sur ses serrures via gateway. Indispensable car une
// carte physique déjà révoquée reste blacklistée tant qu'on ne la ré-autorise
// pas. Best-effort : échoue sans gateway, mais la carte neuve marche en secteur.

export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin', 'admin', 'user']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  let body: { jobId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'body JSON requis' }, { status: 400 });
  }
  if (!body.jobId) return NextResponse.json({ ok: false, error: 'jobId requis' }, { status: 400 });

  const { data: job, error } = await supabaseAdmin
    .from('jobs_encodeur')
    .select('action, statut, payload, resultat')
    .eq('id', body.jobId)
    .single();
  if (error || !job) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'job introuvable' }, { status: 404 });
  }
  if (job.action !== 'write_card' || job.statut !== 'done') {
    return NextResponse.json({ ok: false, error: 'job non éligible (write_card/done)' }, { status: 409 });
  }

  const payload = (job.payload ?? {}) as { lockIds?: number[]; fin?: string };
  const resultat = (job.resultat ?? {}) as { card_no?: string };
  const cardNo = resultat.card_no;
  const lockIds = payload.lockIds ?? [];
  if (!cardNo || lockIds.length === 0) {
    return NextResponse.json({ ok: true, skipped: true }); // pas de carte à autoriser
  }
  const endMs = payload.fin ? new Date(payload.fin).getTime() : Date.now() + 2 * 86_400_000;

  const results = await authorizeCardOnLocks(lockIds, cardNo, endMs);
  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}
