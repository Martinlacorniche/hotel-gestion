import { NextRequest, NextResponse } from 'next/server';
import { HOTEL_MAIL_CONFIG } from '@/lib/mailAssistant';
import { purgeJunk, JUNK_RETENTION_DAYS } from '@/lib/mailPurge';

// Purge des indésirables — « on ne lit pas les indésirables, mais on vide la boîte tous les
// 3 jours, pensons à la planète » (Martin 2026-07-10).
//
//   POST /api/mail-assistant/purge-junk              -> les deux boîtes
//   POST /api/mail-assistant/purge-junk?hotel=voiles -> une seule
//
// Supprime DÉFINITIVEMENT les indésirables reçus il y a plus de 3 jours. Ne lit aucun contenu
// (id + date seulement) et ne touche jamais à la boîte de réception.
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
    // En série : deux boîtes, et Graph limite le débit par application.
    const resultats = [];
    for (const h of cibles) resultats.push(await purgeJunk(h.key));
    const total = resultats.reduce((n, r) => n + r.deleted, 0);
    return NextResponse.json({ ok: true, retention_jours: JUNK_RETENTION_DAYS, supprimes: total, detail: resultats });
  } catch (e) {
    console.error('[mail-assistant] purgeJunk', e);
    return NextResponse.json({ error: 'purge failed' }, { status: 502 });
  }
}
