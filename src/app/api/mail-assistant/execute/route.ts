import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';
import { hotelConfig } from '@/lib/mailAssistant';
import { executeRow, getModes, type LogRow } from '@/lib/mailActions';

// Gestionnaire de mails — EXÉCUTION d'une action sur une ligne du journal (superadmin).
//   POST /api/mail-assistant/execute?hotel=voiles
//   body: { id: <log id>, decision: 'validate' | 'skip' }
// 'validate' -> exécute l'action proposée (delete / brouillon…). 'skip' -> marque ignoré.
// Le mode de la catégorie doit être ≠ 'off' pour valider (sinon action désactivée).
// Tout passe par le service_role (RLS deny sur assistant_mail_log).

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const cfg = hotelConfig(new URL(req.url).searchParams.get('hotel') || '');
  if (!cfg) return NextResponse.json({ ok: false, error: 'hotel invalide' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '');
  const decision = String(body.decision || '');
  if (!id || (decision !== 'validate' && decision !== 'skip')) {
    return NextResponse.json({ ok: false, error: 'id + decision (validate|skip) requis' }, { status: 400 });
  }

  const { data: row, error: rowErr } = await supabaseAdmin
    .from('assistant_mail_log')
    .select('id, mailbox, message_id, from_addr, from_name, subject, category, proposed_action, detail, status')
    .eq('id', id)
    .single();
  if (rowErr || !row) return NextResponse.json({ ok: false, error: 'ligne introuvable' }, { status: 404 });
  if (row.mailbox !== cfg.mailbox) {
    return NextResponse.json({ ok: false, error: 'ligne d’un autre hôtel' }, { status: 403 });
  }

  const decidedStamp = { decided_by: auth.userId, decided_at: new Date().toISOString(), processed_at: new Date().toISOString() };

  if (decision === 'skip') {
    await supabaseAdmin.from('assistant_mail_log').update({ status: 'skipped', ...decidedStamp }).eq('id', id);
    return NextResponse.json({ ok: true, status: 'skipped' });
  }

  // decision === 'validate' : vérifier que la catégorie n'est pas désactivée.
  const modes = await getModes(cfg.key);
  if (modes[row.category] === 'off') {
    return NextResponse.json({ ok: false, error: `Catégorie « ${row.category} » désactivée (mode off).` }, { status: 409 });
  }

  const outcome = await executeRow(cfg, row as LogRow);
  if (outcome.status === 'blocked') {
    await supabaseAdmin.from('assistant_mail_log')
      .update({ action_error: outcome.error || 'action non exécutée', ...decidedStamp })
      .eq('id', id);
    return NextResponse.json({ ok: false, blocked: true, error: outcome.error }, { status: 422 });
  }

  await supabaseAdmin.from('assistant_mail_log')
    .update({ status: 'executed', dry_run: false, result: outcome.result || {}, action_error: null, ...decidedStamp })
    .eq('id', id);
  return NextResponse.json({ ok: true, status: 'executed', result: outcome.result });
}
