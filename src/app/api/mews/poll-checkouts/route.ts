import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getCheckoutsToday, parisHour } from '@/lib/mews';

// POST (ou GET) /api/mews/poll-checkouts
//
// Déclenché par pg_cron toutes les ~5 min. Détecte les départs (check-outs) de
// l'hôtel Les Voiles dans Mews et les transmet au housekeeping en INSÉRANT dans
// `chambres_liberees` — exactement comme si la réception les avait tapés. Le
// webhook (migration 19) → Edge Function send-chambres-liberees envoie alors la
// notif push. La réception des Voiles n'a plus rien à saisir.
//
// Garanties :
//  - LECTURE SEULE côté Mews (on observe, on n'écrit jamais dans le PMS).
//  - Anti-doublon : 1 check-out = 1 transmission = 1 notif (table
//    mews_checkouts_vus, claim atomique via upsert ignoreDuplicates).
//  - Plage horaire : ne réveille Mews qu'entre 06h et 15h (Paris). Hors plage,
//    no-op immédiat (aucun appel réseau).
//  - Auth : secret partagé (header x-mews-poll-secret), pas d'utilisateur.

export const dynamic = 'force-dynamic';

const HOUR_START = 6;  // inclus
const HOUR_END = 15;   // exclus

async function handle(req: Request) {
  // 1) Auth par secret partagé (le cron n'est pas un utilisateur).
  const secret = process.env.MEWS_POLL_SECRET;
  const provided = req.headers.get('x-mews-poll-secret');
  if (!secret || provided !== secret) {
    return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 });
  }

  // 2) Garde-fou horaire : personne au ménage hors 06h-15h → on ne touche pas Mews.
  const now = new Date();
  const h = parisHour(now);
  if (h < HOUR_START || h >= HOUR_END) {
    return NextResponse.json({ ok: true, skipped: 'hors plage horaire (06h-15h Paris)', parisHour: h });
  }

  const voilesId = process.env.HTBM_HOTEL_UUID;
  if (!voilesId) {
    return NextResponse.json({ ok: false, error: 'HTBM_HOTEL_UUID manquant' }, { status: 500 });
  }

  // 3) Départs du jour côté Mews.
  const checkouts = await getCheckoutsToday(now);
  if (checkouts.length === 0) {
    return NextResponse.json({ ok: true, checkouts: 0, nouveau: 0 });
  }

  // 4) Ne garder que les chambres réellement suivies aux Voiles (ignore 001,
  //    Rooftop et tout espace non répertorié dans notre table chambres).
  const { data: chambres, error: chErr } = await supabaseAdmin
    .from('chambres')
    .select('numero')
    .eq('hotel_id', voilesId);
  if (chErr) {
    return NextResponse.json({ ok: false, error: `chambres: ${chErr.message}` }, { status: 500 });
  }
  const known = new Set((chambres ?? []).map((c) => String(c.numero).trim()));
  const valides = checkouts.filter((c) => known.has(c.roomName.trim()));
  if (valides.length === 0) {
    return NextResponse.json({ ok: true, checkouts: checkouts.length, nouveau: 0, note: 'aucune chambre suivie' });
  }

  // 5) Claim atomique anti-doublon : on insère dans mews_checkouts_vus en
  //    ignorant les conflits ; .select() ne renvoie QUE les lignes réellement
  //    insérées = les check-outs encore jamais traités.
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('mews_checkouts_vus')
    .upsert(
      valides.map((c) => ({ reservation_id: c.reservationId, hotel_id: voilesId, chambre: c.roomName })),
      { onConflict: 'reservation_id', ignoreDuplicates: true },
    )
    .select('reservation_id, chambre');
  if (claimErr) {
    return NextResponse.json({ ok: false, error: `claim: ${claimErr.message}` }, { status: 500 });
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ ok: true, checkouts: checkouts.length, nouveau: 0 });
  }

  // 6) Transmission housekeeping : 1 ligne = toutes les nouvelles chambres de ce
  //    cycle → 1 seule notif listant les chambres. L'INSERT déclenche le webhook.
  const rooms = claimed.map((c) => c.chambre);
  const { error: libErr } = await supabaseAdmin
    .from('chambres_liberees')
    .insert({ hotel_id: voilesId, chambres: rooms, auteur: 'Mews ✨' });

  if (libErr) {
    // Rollback du claim pour retenter au prochain cycle (sinon notif perdue).
    await supabaseAdmin
      .from('mews_checkouts_vus')
      .delete()
      .in('reservation_id', claimed.map((c) => c.reservation_id));
    return NextResponse.json({ ok: false, error: `chambres_liberees: ${libErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, checkouts: checkouts.length, nouveau: rooms.length, chambres: rooms });
}

export async function POST(req: Request) {
  try { return await handle(req); }
  catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
