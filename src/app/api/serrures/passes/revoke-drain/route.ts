import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { revokeCardOnLock } from '@/lib/tthotel';

// POST /api/serrures/passes/revoke-drain
// Draine la file `pass_revocations` : pour chaque carte en attente, blackliste
// l'UID sur quelques serrures (fail-fast, attempts=1), retire celles révoquées,
// supprime la ligne quand il ne reste plus de serrure. Appelé par pg_cron.
// Auth : secret partagé (header x-revoke-secret), pas d'utilisateur.

export const dynamic = 'force-dynamic';
export const maxDuration = 26; // borne Netlify ; on cape le nb de serrures/run en conséquence

// Bornes anti-timeout : on traite peu de serrures par exécution, le cron repasse.
const ROWS_PER_RUN = 3;
const LOCKS_PER_RUN = 5;

export async function POST(req: Request) {
  const secret = process.env.SERRURES_REVOKE_SECRET;
  const provided = req.headers.get('x-revoke-secret');
  if (!secret || provided !== secret) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { data: pending } = await supabaseAdmin
    .from('pass_revocations')
    .select('id, card_no, lock_ids, attempts')
    .order('created_at', { ascending: true })
    .limit(ROWS_PER_RUN);

  let budget = LOCKS_PER_RUN;
  const summary: { id: string; revoked: number; remaining: number }[] = [];

  for (const row of pending ?? []) {
    const lockIds: number[] = row.lock_ids ?? [];
    if (lockIds.length === 0) {
      await supabaseAdmin.from('pass_revocations').delete().eq('id', row.id);
      continue;
    }

    const stillPending: number[] = [];
    let lastError: string | null = null;
    let revoked = 0;

    for (const lockId of lockIds) {
      if (budget <= 0) {
        stillPending.push(lockId); // plus de budget ce run → on garde pour le prochain
        continue;
      }
      budget -= 1;
      try {
        await revokeCardOnLock(lockId, row.card_no, 1); // fail-fast
        revoked += 1;
      } catch (err) {
        stillPending.push(lockId);
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (stillPending.length === 0) {
      await supabaseAdmin.from('pass_revocations').delete().eq('id', row.id);
    } else {
      await supabaseAdmin
        .from('pass_revocations')
        .update({
          lock_ids: stillPending,
          attempts: (row.attempts ?? 0) + 1,
          last_error: lastError,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
    }

    summary.push({ id: row.id, revoked, remaining: stillPending.length });
    if (budget <= 0) break;
  }

  return NextResponse.json({ ok: true, processed: summary.length, summary });
}
