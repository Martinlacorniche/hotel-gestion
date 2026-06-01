import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { revokeCardOnLocks } from '@/lib/tthotel';
import { sejourActiveCardNos } from '@/lib/serruresLocks';
import { requireRole } from '@/lib/apiAuth';

// POST /api/serrures/cartes/revoke
//   body { cardNo: string, sejourIds: string[] }
// Révoque une carte physique sur toutes les serrures qu'elle ouvre (add+delete
// via gateway). Un séjour passe en `revoque` uniquement si la révocation a
// réussi sur SA serrure (sinon la carte ouvre encore cette chambre → on le dit).

export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin', 'admin', 'user']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  let body: { cardNo?: string; sejourIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'body JSON requis' }, { status: 400 });
  }
  const cardNo = (body.cardNo ?? '').trim();
  const sejourIds = body.sejourIds ?? [];
  if (!cardNo || sejourIds.length === 0) {
    return NextResponse.json({ ok: false, error: 'cardNo et sejourIds requis' }, { status: 400 });
  }

  const { data: sejours, error } = await supabaseAdmin
    .from('sejours')
    .select('id, statut, tthotel_passcode_id, cartes_revoquees, chambres(numero, tthotel_lock_id)')
    .in('id', sejourIds);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // séjour ↔ serrure (+ état pour décider la clôture)
  type SejourInfo = { lockId: number; numero: string; hasCode: boolean; revoked: string[] };
  const lockBySejour = new Map<string, SejourInfo>();
  for (const s of sejours ?? []) {
    const ch = (s as unknown as { chambres: { numero: string; tthotel_lock_id: number } | null }).chambres;
    if (ch) {
      lockBySejour.set(s.id, {
        lockId: ch.tthotel_lock_id,
        numero: ch.numero,
        hasCode: !!(s as { tthotel_passcode_id: number | null }).tthotel_passcode_id,
        revoked: ((s as { cartes_revoquees: string[] | null }).cartes_revoquees ?? []),
      });
    }
  }
  const lockIds = [...new Set([...lockBySejour.values()].map((v) => v.lockId))];
  if (lockIds.length === 0) {
    return NextResponse.json({ ok: false, error: 'aucune serrure trouvée pour ces séjours' }, { status: 404 });
  }

  // révocation serrure par serrure
  const revokeResults = await revokeCardOnLocks(lockIds, cardNo);
  const okByLock = new Map(revokeResults.map((r) => [r.lockId, r.ok]));

  // Pour chaque séjour dont la serrure a bien été révoquée : on marque ce numéro
  // de carte révoqué, et on ne clôt le séjour QUE s'il ne reste plus de clé
  // (ni code, ni autre carte active).
  const now = new Date().toISOString();
  const closed: string[] = [];
  for (const [sid, info] of lockBySejour) {
    if (!okByLock.get(info.lockId)) continue;
    const revoked = new Set<string>(info.revoked);
    revoked.add(cardNo);
    const remainingCards = (await sejourActiveCardNos(sid)).filter((c) => c !== cardNo);
    const stillHasKey = info.hasCode || remainingCards.length > 0;
    const update: Record<string, unknown> = { cartes_revoquees: [...revoked], updated_at: now };
    if (!stillHasKey) {
      update.statut = 'revoque';
      closed.push(sid);
    }
    await supabaseAdmin.from('sejours').update(update).eq('id', sid);
  }

  const results = revokeResults.map((r) => {
    const numero = [...lockBySejour.values()].find((v) => v.lockId === r.lockId)?.numero ?? String(r.lockId);
    return { lockId: r.lockId, numero, ok: r.ok, error: r.error };
  });
  const allOk = results.every((r) => r.ok);

  return NextResponse.json({ ok: allOk, results, closedSejours: closed });
}
