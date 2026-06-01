import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getGatewayCoverage } from '@/lib/tthotel';
import { requireRole } from '@/lib/apiAuth';

// GET /api/serrures/cartes → cartes invité ACTIVES (hors pass), groupées par
// carte physique (card_no), avec les chambres ouvertes et un flag « révocable »
// (gateway présent sur la chambre). Les pass sont dans une table séparée et
// leurs jobs ont sejourIds vide → exclus d'office.

type ActiveSejour = { id: string; numero: string; lockId: number; fin: string; revoked: Set<string> };

export async function GET(req: Request) {
  const auth = await requireRole(req, ['superadmin', 'admin', 'user']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  // 1) séjours carte actifs + leur chambre. NB : on ne filtre PAS sur methode —
  // un séjour 'code' peut avoir reçu une carte ensuite (et inversement).
  const { data: sejours, error: eS } = await supabaseAdmin
    .from('sejours')
    .select('id, fin, carte_uid, cartes_revoquees, chambres(numero, tthotel_lock_id)')
    .eq('statut', 'actif');
  if (eS) return NextResponse.json({ ok: false, error: eS.message }, { status: 500 });

  const nowMs = Date.now();
  const active = new Map<string, ActiveSejour>();
  for (const s of sejours ?? []) {
    const ch = (s as unknown as { chambres: { numero: string; tthotel_lock_id: number } | null }).chambres;
    if (!ch) continue;
    // Un séjour dont le checkout est passé = carte expirée → on ne l'affiche pas
    // (le statut peut rester 'actif' en base faute de transition automatique).
    if (new Date(s.fin).getTime() <= nowMs) continue;
    const revoked = new Set<string>(((s as { cartes_revoquees: string[] | null }).cartes_revoquees ?? []));
    active.set(s.id, { id: s.id, numero: ch.numero, lockId: ch.tthotel_lock_id, fin: s.fin, revoked });
  }
  if (active.size === 0) return NextResponse.json({ ok: true, cartes: [] });

  // 2) jobs d'encodage terminés → card_no par séjour
  const { data: jobs, error: eJ } = await supabaseAdmin
    .from('jobs_encodeur')
    .select('payload, resultat')
    .eq('action', 'write_card')
    .eq('statut', 'done')
    .order('created_at', { ascending: false })
    .limit(500);
  if (eJ) return NextResponse.json({ ok: false, error: eJ.message }, { status: 500 });

  // On liste TOUTES les cartes (card_no distincts) encodées pour les séjours
  // actifs, sauf celles marquées révoquées (cartes_revoquees). Un séjour peut
  // donc avoir plusieurs cartes (carte supplémentaire). Jobs en ordre décroissant.
  type Card = { cardNo: string; sejourIds: Set<string>; locks: Map<number, string>; fin: string };
  const cards = new Map<string, Card>();
  const cardNoBySejour = new Map<string, string>(); // 1re vue (= plus récente) par séjour, pour carte_uid

  for (const job of jobs ?? []) {
    const payload = (job.payload ?? {}) as { sejourIds?: string[] };
    const resultat = (job.resultat ?? {}) as { card_no?: string };
    const cardNo = resultat.card_no;
    const sids = payload.sejourIds ?? [];
    if (!cardNo || sids.length === 0) continue; // pas de carte, ou pass
    for (const sid of sids) {
      const s = active.get(sid);
      if (!s) continue;
      if (s.revoked.has(cardNo)) continue; // carte révoquée → exclue
      if (!cardNoBySejour.has(sid)) cardNoBySejour.set(sid, cardNo);
      let card = cards.get(cardNo);
      if (!card) {
        card = { cardNo, sejourIds: new Set(), locks: new Map(), fin: s.fin };
        cards.set(cardNo, card);
      }
      card.sejourIds.add(sid);
      card.locks.set(s.lockId, s.numero);
      if (s.fin > card.fin) card.fin = s.fin;
    }
  }

  // 3) couverture gateway par serrure (cache 60s)
  let gatewayByLock = new Map<number, boolean>();
  try {
    gatewayByLock = await getGatewayCoverage();
  } catch {
    // si TTHotel ne répond pas, on liste quand même sans le flag (révocable=null)
  }

  // 4) réconcilier carte_uid (best-effort, non bloquant)
  for (const [sid, cardNo] of cardNoBySejour) {
    const s = sejours?.find((x) => x.id === sid);
    if (s && !s.carte_uid) {
      await supabaseAdmin.from('sejours').update({ carte_uid: cardNo }).eq('id', sid).then(undefined, () => {});
    }
  }

  const cartes = [...cards.values()]
    .map((c) => ({
      cardNo: c.cardNo,
      fin: c.fin,
      sejourIds: [...c.sejourIds],
      chambres: [...c.locks.entries()]
        .map(([lockId, numero]) => ({
          lockId,
          numero,
          revocable: gatewayByLock.size ? (gatewayByLock.get(lockId) ?? false) : null,
        }))
        .sort((a, b) => a.numero.localeCompare(b.numero, 'fr', { numeric: true })),
    }))
    .sort((a, b) => a.fin.localeCompare(b.fin));

  return NextResponse.json({ ok: true, cartes });
}
