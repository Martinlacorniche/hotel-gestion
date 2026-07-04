import { NextRequest, NextResponse } from 'next/server';
import { runDryRun } from '@/lib/mailAssistantRun';
import { HOTEL_MAIL_CONFIG } from '@/lib/mailAssistant';

// Gestionnaire de mails réception — cron DRY-RUN (Phase 1), SCOPÉ À UN HÔTEL.
//   POST /api/mail-assistant?hotel=voiles    -> contact-lesvoiles@ (Mews dispo)
//   POST /api/mail-assistant?hotel=corniche  -> contact-corniche@  (PAS de Mews)
// Lit l'inbox, classe, journalise (dry_run) — ne supprime/n'envoie RIEN.
// Auth : header `x-cron-secret` (repli `x-mews-poll-secret`).

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || process.env.MEWS_POLL_SECRET || '';
  if (!secret) return false;
  const got = req.headers.get('x-cron-secret') || req.headers.get('x-mews-poll-secret') || '';
  return got === secret;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const key = new URL(req.url).searchParams.get('hotel') || '';
  if (!HOTEL_MAIL_CONFIG.some((h) => h.key === key)) {
    return NextResponse.json({ error: 'hotel invalide', attendu: HOTEL_MAIL_CONFIG.map((h) => h.key) }, { status: 400 });
  }
  try {
    const r = await runDryRun(key);
    return NextResponse.json({ ok: true, dry_run: true, ...r });
  } catch (e) {
    console.error('[mail-assistant] runDryRun', e);
    return NextResponse.json({ error: 'run failed' }, { status: 502 });
  }
}
