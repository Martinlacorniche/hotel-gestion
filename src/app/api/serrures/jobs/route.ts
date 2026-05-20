import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';

// GET /api/serrures/jobs?limit=25  → derniers jobs d'encodage (outil de debug, admin-only).
// Renvoie le statut/erreur de chaque job + une heuristique "agent en ligne ?".

export async function GET(req: Request) {
  const auth = await requireRole(req, ['admin', 'superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '25', 10) || 25));

  const { data, error } = await supabaseAdmin
    .from('jobs_encodeur')
    .select('id, statut, action, created_at, updated_at, resultat, payload')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const jobs = (data ?? []).map((j) => {
    const res = j.resultat as Record<string, unknown> | null;
    const payload = j.payload as Record<string, unknown> | null;
    const lockIds = Array.isArray(payload?.lockIds) ? (payload!.lockIds as unknown[]) : [];
    return {
      id: j.id,
      statut: j.statut as string,
      action: j.action as string,
      created_at: j.created_at as string,
      updated_at: j.updated_at as string,
      error: res && typeof res.error === 'string' ? (res.error as string) : null,
      nb_locks: lockIds.length,
    };
  });

  // Heuristique "agent en ligne ?" : un job 'queued' depuis > 25 s sans bouger
  // = l'agent ne dépile pas (probablement hors-ligne ou bloqué).
  const now = Date.now();
  const newest = jobs[0];
  let agent: 'ok' | 'stuck' | 'idle' = 'idle';
  if (newest) {
    const ageMs = now - new Date(newest.created_at).getTime();
    if (newest.statut === 'queued' && ageMs > 25_000) agent = 'stuck';
    else agent = 'ok';
  }

  return NextResponse.json({ ok: true, jobs, agent });
}
