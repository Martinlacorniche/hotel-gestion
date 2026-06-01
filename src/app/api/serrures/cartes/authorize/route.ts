import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { authorizeCardOnLocks, revokeCardOnLocks } from '@/lib/tthotel';
import { sejourActiveCardNos } from '@/lib/serruresLocks';
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

  const payload = (job.payload ?? {}) as {
    lockIds?: number[];
    sejourIds?: string[];
    fin?: string;
    supersede?: boolean;
  };
  const resultat = (job.resultat ?? {}) as { card_no?: string };
  const cardNo = resultat.card_no;
  const lockIds = payload.lockIds ?? [];
  if (!cardNo || lockIds.length === 0) {
    return NextResponse.json({ ok: true, skipped: true }); // pas de carte à autoriser
  }
  const endMs = payload.fin ? new Date(payload.fin).getTime() : Date.now() + 2 * 86_400_000;

  const results = await authorizeCardOnLocks(lockIds, cardNo, endMs);

  // 'Remplacer' : une fois la nouvelle carte autorisée, on révoque les ANCIENNES
  // cartes du séjour (tout sauf la nouvelle). Si on a reposé la même carte
  // physique (même numéro), il n'y a rien à révoquer.
  let superseded: string[] = [];
  if (payload.supersede) {
    for (const sejourId of payload.sejourIds ?? []) {
      const olds = (await sejourActiveCardNos(sejourId)).filter((c) => c !== cardNo);
      const reallyRevoked: string[] = [];
      for (const old of olds) {
        const r = await revokeCardOnLocks(lockIds, old);
        if (r.every((x) => x.ok)) reallyRevoked.push(old);
      }
      if (reallyRevoked.length) {
        const { data: sj } = await supabaseAdmin
          .from('sejours')
          .select('cartes_revoquees')
          .eq('id', sejourId)
          .single();
        const set = new Set<string>([
          ...(((sj?.cartes_revoquees as string[] | null) ?? [])),
          ...reallyRevoked,
        ]);
        await supabaseAdmin.from('sejours').update({ cartes_revoquees: [...set] }).eq('id', sejourId);
        superseded = superseded.concat(reallyRevoked);
      }
    }
  }

  return NextResponse.json({ ok: results.every((r) => r.ok), results, superseded });
}
