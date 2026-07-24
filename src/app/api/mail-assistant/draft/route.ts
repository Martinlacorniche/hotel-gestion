import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';
import { hotelConfig } from '@/lib/mailAssistant';
import { getDraftText, sendDraft, deleteDraft } from '@/lib/graphMailbox';

// Le brouillon préparé par Junior — lu, envoyé ou jeté DEPUIS l'écran.
//
//   GET  /api/mail-assistant/draft?hotel=voiles&id=<log id>[&quel=gaetan]
//   POST /api/mail-assistant/draft?hotel=voiles  { id, quel?, decision: 'send' | 'discard' }
//
// Pourquoi cette route (Martin 2026-07-24) : « la propal de mail on la fait direct
// dans mail assistant et comme ça on te dit d'envoyer ou non ». Aller relire dans
// Outlook, c'était deux applications et un aller-retour — et des réponses qui ne
// partaient jamais : neuf brouillons oubliés purgés le 17/07, dont une réponse
// rédigée à un client qui n'a jamais rien reçu.
//
// ⚠️ L'identifiant du brouillon n'est JAMAIS pris dans la requête : il est relu
// dans la ligne de journal. Sinon n'importe quel identifiant Graph deviendrait
// envoyable depuis l'extérieur.

export const dynamic = 'force-dynamic';

type Quel = 'client' | 'gaetan';

async function brouillonDe(id: string, quel: Quel, mailbox: string) {
  const { data } = await supabaseAdmin
    .from('assistant_mail_log').select('id, mailbox, result').eq('id', id).single();
  if (!data) return { err: 'ligne introuvable', code: 404 as const };
  if (data.mailbox !== mailbox) return { err: 'ligne d’un autre hôtel', code: 403 as const };
  const res = (data.result || {}) as Record<string, unknown>;
  const draftId = String((quel === 'gaetan' ? res.draftGaetanId : res.draftId) || '');
  if (!draftId) return { err: 'aucun brouillon sur cette ligne', code: 404 as const };
  return { draftId, res, code: 200 as const };
}

export async function GET(req: Request) {
  const auth = await requireRole(req, ['superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const cfg = hotelConfig(url.searchParams.get('hotel') || '');
  if (!cfg) return NextResponse.json({ ok: false, error: 'hotel invalide' }, { status: 400 });
  const quel: Quel = url.searchParams.get('quel') === 'gaetan' ? 'gaetan' : 'client';

  const b = await brouillonDe(String(url.searchParams.get('id') || ''), quel, cfg.mailbox);
  if (b.code !== 200) return NextResponse.json({ ok: false, error: b.err }, { status: b.code });

  try {
    return NextResponse.json({ ok: true, texte: await getDraftText(cfg.mailbox, b.draftId!) });
  } catch (e) {
    // Un brouillon supprimé à la main dans Outlook n'est pas une erreur du système :
    // on le dit simplement, l'écran cachera le bloc.
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'brouillon illisible' }, { status: 404 });
  }
}

export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const cfg = hotelConfig(new URL(req.url).searchParams.get('hotel') || '');
  if (!cfg) return NextResponse.json({ ok: false, error: 'hotel invalide' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const decision = String(body.decision || '');
  if (decision !== 'send' && decision !== 'discard') {
    return NextResponse.json({ ok: false, error: 'decision attendue : send | discard' }, { status: 400 });
  }
  const quel: Quel = body.quel === 'gaetan' ? 'gaetan' : 'client';

  const b = await brouillonDe(String(body.id || ''), quel, cfg.mailbox);
  if (b.code !== 200) return NextResponse.json({ ok: false, error: b.err }, { status: b.code });

  try {
    if (decision === 'send') await sendDraft(cfg.mailbox, b.draftId!);
    else await deleteDraft(cfg.mailbox, b.draftId!);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'échec' }, { status: 502 });
  }

  // La trace reste sur la ligne : qui a envoyé quoi, et quand. Le lien Outlook, lui,
  // ne mène plus nulle part une fois le message parti — on le retire.
  const res = { ...(b.res as Record<string, unknown>) };
  const cle = quel === 'gaetan' ? 'draftGaetan' : 'draft';
  delete res[`${cle}Id`];
  delete res[quel === 'gaetan' ? 'draftGaetanLink' : 'webLink'];
  res[`${cle}${decision === 'send' ? 'Envoye' : 'Jete'}`] = new Date().toISOString();
  await supabaseAdmin.from('assistant_mail_log').update({ result: res }).eq('id', String(body.id));

  return NextResponse.json({ ok: true, decision });
}
