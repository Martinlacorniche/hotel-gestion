import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';
import { hotelConfig } from '@/lib/mailAssistant';
import { repondreAJunior, type LogRow } from '@/lib/mailActions';

// Répondre à une question de Junior, depuis la conversation.
//
//   POST /api/mail-assistant/repondre?hotel=voiles  { id, texte }
//
// C'est le premier aller-retour (Martin 2026-07-24 : « si Junior a besoin d'un
// prix, il me le demande, il peut »). Il s'arrête avant de rédiger quand une
// décision lui échappe — un tarif, un arbitrage — et reprend son travail avec ce
// qu'on lui dit : il réécrit la réponse, remplace son brouillon, et garde
// l'échange sur la ligne.
//
// ⚠️ Aucune limite de rôle au-delà de superadmin pour l'instant : la page n'est
// pas encore ouverte aux équipes. Quand elle le sera, répondre à Junior restera
// permis à tous — c'est celui qui voit le mail qui sait —, mais l'écrire ici
// évitera de l'oublier.

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const cfg = hotelConfig(new URL(req.url).searchParams.get('hotel') || '');
  if (!cfg) return NextResponse.json({ ok: false, error: 'hotel invalide' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '');
  const texte = String(body.texte || '').trim();
  if (!id || !texte) return NextResponse.json({ ok: false, error: 'id + texte requis' }, { status: 400 });

  const { data: row } = await supabaseAdmin
    .from('assistant_mail_log')
    .select('id, mailbox, message_id, from_addr, from_name, subject, category, proposed_action, detail, result')
    .eq('id', id).single();
  if (!row) return NextResponse.json({ ok: false, error: 'ligne introuvable' }, { status: 404 });
  if (row.mailbox !== cfg.mailbox) {
    return NextResponse.json({ ok: false, error: 'ligne d’un autre hôtel' }, { status: 403 });
  }

  // Le prénom de la personne qui répond signe le brouillon : un interlocuteur qui
  // a un prénom obtient de meilleurs retours qu'une boîte (règle du 23/07).
  const { data: moi } = await supabaseAdmin
    .from('users').select('name').eq('id_auth', auth.userId).maybeSingle();

  const outcome = await repondreAJunior(cfg, row as LogRow, texte, (moi?.name as string) || null);
  if (outcome.status === 'blocked') {
    return NextResponse.json({ ok: false, error: outcome.error }, { status: 422 });
  }

  await supabaseAdmin.from('assistant_mail_log')
    .update({ result: outcome.result || {}, action_error: null, processed_at: new Date().toISOString() })
    .eq('id', id);

  return NextResponse.json({ ok: true, result: outcome.result });
}
