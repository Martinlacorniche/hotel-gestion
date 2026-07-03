import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getMonthlyOccupancy, getMonthlyRevenue } from '@/lib/mews';

// POST (ou GET) /api/mews/refresh-occupancy
//
// Déclenché par pg_cron (toutes les ~3 h). Calcule le taux d'occupation
// prévisionnel (on-the-books) de l'hôtel Les Voiles, mois par mois sur
// HORIZON_MONTHS mois civils, et met le résultat en cache dans la table
// `mews_occupancy`. Le dashboard lit ce cache (pas d'appel Mews côté client).
//
// Garanties :
//  - LECTURE SEULE côté Mews (on observe, on n'écrit jamais dans le PMS).
//  - Pas de donnée financière (le scope Mews refuse l'extent `Items`) : que de
//    l'occupation, calculée depuis reservations/getAll + capacité chambres.
//  - Auth : secret partagé (header x-mews-poll-secret), pas d'utilisateur.

export const dynamic = 'force-dynamic';

// Nombre de mois (mois courant inclus). 6 mois ≈ 2 appels Mews (fenêtre 100 j).
// Augmentable sans risque (chaque tranche de 95 j = 1 appel supplémentaire).
const HORIZON_MONTHS = 6;

async function handle(req: Request) {
  // 1) Auth par secret partagé (le cron n'est pas un utilisateur).
  const secret = process.env.MEWS_POLL_SECRET;
  const provided = req.headers.get('x-mews-poll-secret');
  if (!secret || provided !== secret) {
    return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 });
  }

  const voilesId = process.env.HTBM_HOTEL_UUID;
  if (!voilesId) {
    return NextResponse.json({ ok: false, error: 'HTBM_HOTEL_UUID manquant' }, { status: 500 });
  }

  // 2) Capacité = nb de chambres vendables suivies aux Voiles (table chambres).
  const { count, error: capErr } = await supabaseAdmin
    .from('chambres')
    .select('id', { count: 'exact', head: true })
    .eq('hotel_id', voilesId);
  if (capErr) {
    return NextResponse.json({ ok: false, error: `chambres: ${capErr.message}` }, { status: 500 });
  }
  const capacity = count || 0;
  if (capacity === 0) {
    return NextResponse.json({ ok: false, error: 'capacité 0 (aucune chambre en base)' }, { status: 500 });
  }

  // 3) Occupation prévisionnelle + revenu (CA / hébergement) côté Mews.
  //    Le revenu utilise orderItems/getAll (scope ouvert 2026-07) : réalisé pour
  //    le passé récent, portefeuille (on-the-books) pour le mois courant + futur.
  const [months, revenue] = await Promise.all([
    getMonthlyOccupancy(capacity, new Date(), HORIZON_MONTHS),
    getMonthlyRevenue(new Date(), HORIZON_MONTHS),
  ]);
  const revByMonth = new Map(revenue.map((r) => [r.month, r]));

  // 4) Upsert du cache (1 ligne par mois). onConflict (hotel_id, month).
  //    PM (prix moyen chambre) = hébergement TTC ÷ nuitées occupées.
  const nowIso = new Date().toISOString();
  const rows = months.map((m) => {
    const rev = revByMonth.get(m.month);
    const hebergTtc = rev?.hebergTtc ?? 0;
    const prixMoyen = m.occupiedNights > 0 ? Math.round(hebergTtc / m.occupiedNights) : 0;
    return {
      hotel_id: voilesId,
      month: m.month,
      occupied_nights: m.occupiedNights,
      available_nights: m.availableNights,
      occupancy: m.occupancy,
      ca_ttc: rev?.caTtc ?? 0,
      heberg_ttc: hebergTtc,
      prix_moyen: prixMoyen,
      updated_at: nowIso,
    };
  });
  const { error: upErr } = await supabaseAdmin
    .from('mews_occupancy')
    .upsert(rows, { onConflict: 'hotel_id,month' });
  if (upErr) {
    return NextResponse.json({ ok: false, error: `upsert: ${upErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, capacity, horizon: HORIZON_MONTHS, months, revenue });
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
