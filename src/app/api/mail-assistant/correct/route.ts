import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';
import { hotelConfig } from '@/lib/mailAssistant';
import { executeRow, type LogRow } from '@/lib/mailActions';

// « Non, c'est plutôt… » — l'humain corrige la proposition de Junior.
//
// POST /api/mail-assistant/correct?hotel=voiles
//   body: { id, category?, action?, commentaire?, executer? }
//
// Deux gestes en un :
//   · on CONSIGNE la correction (assistant_mail_corrections) — c'est la matière
//     première des futures règles ; sans elle, une erreur de classement disparaît
//     dans l'oubli et personne ne l'apprend jamais ;
//   · on RETRAITE le mail tout de suite avec la bonne action, si on la demande.
//
// Aucun appel LLM ici : corriger, c'est écrire une donnée, pas tenir une
// conversation. Le coût de l'apprentissage est reporté à la session de
// dépouillement, pas payé sur chaque mail.

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['superadmin', 'admin', 'user']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const key = new URL(req.url).searchParams.get('hotel') || '';
  const cfg = hotelConfig(key);
  if (!cfg) return NextResponse.json({ ok: false, error: 'hotel invalide' }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as {
    id?: string; category?: string; action?: string; commentaire?: string; executer?: boolean;
  };
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ ok: false, error: 'id requis' }, { status: 400 });

  const commentaire = String(body.commentaire || '').trim() || null;
  const category = body.category ? String(body.category) : null;
  const action = body.action ? String(body.action) : null;
  if (!category && !action && !commentaire) {
    return NextResponse.json({ ok: false, error: 'rien à corriger' }, { status: 400 });
  }

  const { data: row, error } = await supabaseAdmin
    .from('assistant_mail_log')
    .select('id, mailbox, message_id, from_addr, from_name, subject, category, proposed_action, detail, status')
    .eq('id', id).single();
  if (error || !row) return NextResponse.json({ ok: false, error: 'ligne introuvable' }, { status: 404 });
  if (row.mailbox !== cfg.mailbox) {
    return NextResponse.json({ ok: false, error: 'ligne d’un autre hôtel' }, { status: 403 });
  }

  await supabaseAdmin.from('assistant_mail_corrections').insert({
    log_id: row.id, mailbox: row.mailbox, subject: row.subject, from_addr: row.from_addr,
    category_avant: row.category, action_avant: row.proposed_action,
    category_apres: category, action_apres: action,
    commentaire, corrige_par: auth.userId,
  });

  // La ligne porte désormais la vérité de l'humain : c'est elle qui sera rejouée
  // si on repasse dessus, et c'est elle que je relirai en session.
  const maj: Record<string, unknown> = {};
  if (category) maj.category = category;
  if (action) maj.proposed_action = action;
  if (commentaire) maj.detail = { ...(row.detail || {}), commentaire_humain: commentaire };
  if (Object.keys(maj).length) await supabaseAdmin.from('assistant_mail_log').update(maj).eq('id', row.id);

  // Retraitement immédiat avec l'action corrigée, si elle est exécutable.
  let outcome: unknown = null;
  const actionFinale = action || row.proposed_action;
  if (body.executer && actionFinale && actionFinale !== 'none') {
    const cible: LogRow = {
      ...(row as unknown as LogRow),
      category: category || row.category,
      proposed_action: actionFinale,
      detail: { ...(row.detail || {}), ...(commentaire ? { commentaire_humain: commentaire } : {}) },
    };
    const r = await executeRow(cfg, cible);
    outcome = r;
    await supabaseAdmin.from('assistant_mail_log').update({
      status: r.status === 'executed' ? 'executed' : 'proposed',
      result: r.result ?? null, action_error: r.error ?? null,
      processed_at: new Date().toISOString(), decided_at: new Date().toISOString(),
      decided_by: auth.userId,
    }).eq('id', row.id);
  }

  return NextResponse.json({ ok: true, outcome });
}
