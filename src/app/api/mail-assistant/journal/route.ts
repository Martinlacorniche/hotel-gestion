import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';
import { runDryRun } from '@/lib/mailAssistantRun';
import { hotelConfig } from '@/lib/mailAssistant';

// Journal du gestionnaire de mails — réservé au SUPERADMIN (Phase 1).
//   GET  /api/mail-assistant/journal?hotel=voiles  -> dernières lignes journalisées
//   POST /api/mail-assistant/journal?hotel=voiles  -> lance un tri dry-run puis renvoie le résultat
// La table assistant_mail_log est en RLS deny : on passe par le service_role ici.

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireRole(req, ['superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const key = new URL(req.url).searchParams.get('hotel') || '';
  const cfg = hotelConfig(key);

  let q = supabaseAdmin
    .from('assistant_mail_log')
    .select('id, created_at, mailbox, from_addr, from_name, subject, received_at, category, proposed_action, reason, detail, status, dry_run, result, action_error, decided_at')
    // ⚠️ FENÊTRE 24 H. Le journal s'accumule sans fin : au-delà d'une journée, la
    // page devient une archive illisible où le travail du jour se noie. Ce qui est
    // plus vieux reste en base (et dans le PMS), il n'a juste plus à encombrer
    // l'écran — un mail non traité depuis 24 h relève d'autre chose qu'un tri.
    .gte('received_at', new Date(Date.now() - 24 * 3600e3).toISOString())
    .order('received_at', { ascending: false, nullsFirst: false })
    .limit(200);
  if (cfg) q = q.eq('mailbox', cfg.mailbox);

  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, rows: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const key = new URL(req.url).searchParams.get('hotel') || '';
  if (!hotelConfig(key)) return NextResponse.json({ ok: false, error: 'hotel invalide' }, { status: 400 });

  try {
    const r = await runDryRun(key);
    return NextResponse.json({ ok: true, dry_run: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'run failed' }, { status: 502 });
  }
}
