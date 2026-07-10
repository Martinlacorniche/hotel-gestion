import { NextRequest, NextResponse } from 'next/server';
import { HOTEL_MAIL_CONFIG } from '@/lib/mailAssistant';
import { purgeJunk, purgeTrash, JUNK_RETENTION_DAYS, TRASH_RETENTION_DAYS } from '@/lib/mailPurge';

// Purge de stockage — « pensons à la planète » (Martin 2026-07-10) :
//   · Courrier indésirable  → suppression définitive au-delà de 3 jours
//   · Éléments supprimés    → suppression définitive au-delà de 7 jours
//
//   POST /api/mail-assistant/purge-junk              -> les deux boîtes
//   POST /api/mail-assistant/purge-junk?hotel=voiles -> une seule
//
// Ne lit aucun contenu (id + date seulement) et ne touche jamais à la boîte de réception.
// Auth : header `x-cron-secret` (repli `x-mews-poll-secret`), comme les autres crons.

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || process.env.MEWS_POLL_SECRET || '';
  if (!secret) return false;
  const got = req.headers.get('x-cron-secret') || req.headers.get('x-mews-poll-secret') || '';
  return got === secret;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const key = new URL(req.url).searchParams.get('hotel');
  const cibles = key
    ? HOTEL_MAIL_CONFIG.filter((h) => h.key === key)
    : HOTEL_MAIL_CONFIG;
  if (cibles.length === 0) {
    return NextResponse.json({ error: 'hotel invalide', attendu: HOTEL_MAIL_CONFIG.map((h) => h.key) }, { status: 400 });
  }

  try {
    // En série : deux boîtes × deux dossiers, et Graph limite le débit par application.
    const resultats = [];
    for (const h of cibles) {
      resultats.push(await purgeJunk(h.key));
      resultats.push(await purgeTrash(h.key));
    }
    const total = resultats.reduce((n, r) => n + r.deleted, 0);
    return NextResponse.json({
      ok: true,
      retention_jours: { indesirables: JUNK_RETENTION_DAYS, corbeille: TRASH_RETENTION_DAYS },
      supprimes: total,
      detail: resultats,
    });
  } catch (e) {
    console.error('[mail-assistant] purgeJunk', e);
    return NextResponse.json({ error: 'purge failed' }, { status: 502 });
  }
}
