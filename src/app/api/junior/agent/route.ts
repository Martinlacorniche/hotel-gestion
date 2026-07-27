import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';
import { hotelConfig } from '@/lib/mailAssistant';
import { receptionOnDuty } from '@/lib/onDuty';

// Relais vers l'agent qui enquête, sur le serveur de La Corniche.
//
//   POST /api/junior/agent?hotel=corniche  { id?, question }   → { enquete }
//   GET  /api/junior/agent?enquete=<uuid>                      → { statut, reponse }
//
// Pourquoi un relais et pas un appel direct depuis le navigateur : la clé de
// l'agent ne doit jamais descendre côté client, et c'est ici qu'on vérifie qui
// demande.
//
// ⚠️ ON N'ATTEND PLUS LA RÉPONSE ICI. On l'a cru longtemps possible — « la
// fonction ne fait qu'attendre, elle tiendra » — mais Netlify compte le temps
// écoulé, pas le temps de calcul : une fonction synchrone est coupée à 26 s.
// Le `maxDuration = 60` et le timeout de 280 s promettaient l'impossible. Une
// question du 27/07 a été traitée en 36 s par le serveur, puis jetée ; l'écran
// affichait « réessaie ». Les enquêtes courtes passaient, les vraies enquêtes
// étaient perdues — on payait le travail sans jamais le lire.
//
// Le POST ouvre donc une enquête et rend la main en une seconde ; le serveur
// dépose sa réponse dans `junior_enquetes` ; l'écran vient la relever par le GET.
//
// ⚠️ SUPERADMIN UNIQUEMENT pour l'instant (Martin 2026-07-24 : « on met en ligne
// que pour moi »). L'agent lit toute la boîte et tout le CRM : on ouvre aux
// équipes quand on aura vu comment il se comporte.

export const dynamic = 'force-dynamic';
// 26 s est le plafond réel d'une fonction synchrone chez Netlify — inutile d'en
// déclarer plus, ce serait se mentir comme le `60` d'avant. Les deux routes
// d'ici rendent la main en une ou deux secondes ; la marge est déjà large.
export const maxDuration = 26;

export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const base = process.env.JUNIOR_AGENT_URL;
  const secret = process.env.JUNIOR_AGENT_SECRET;
  if (!base || !secret) {
    return NextResponse.json(
      { ok: false, error: 'Junior n’est pas joignable : il manque son adresse ou sa clé côté serveur.' },
      { status: 503 },
    );
  }

  const cfg = hotelConfig(new URL(req.url).searchParams.get('hotel') || '');
  if (!cfg) return NextResponse.json({ ok: false, error: 'hotel invalide' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const question = String(body.question || '').trim();
  if (!question) return NextResponse.json({ ok: false, error: 'question requise' }, { status: 400 });
  // Le service n'a aucune mémoire entre deux enquêtes : c'est l'écran qui lui
  // repasse le fil, sinon une question de suivi repartirait de zéro.
  const fil = Array.isArray(body.fil) ? body.fil.slice(-3) : [];

  // À QUI IL PARLE. Junior tutoie un collègue par son prénom depuis le début — mais
  // l'agent, lui, répondait à la cantonade (Martin 2026-07-24 : « il s'adapte pas à
  // la personne en shift »). On lui donne donc qui l'interroge, et qui tient le desk
  // en ce moment : ce n'est pas toujours la même personne, et ce que l'un demande
  // concerne souvent le travail de l'autre.
  const { data: moi } = await supabaseAdmin
    .from('users').select('name').eq('id_auth', auth.userId).maybeSingle();
  const duty = await receptionOnDuty(cfg.hotelId).catch(() => null);
  const qui = [
    moi?.name ? `Tu parles à ${moi.name}.` : null,
    duty?.name
      ? (duty.name === moi?.name
          ? `${duty.name} est en poste à la réception en ce moment.`
          : `À la réception en ce moment, c'est ${duty.name} — c'est elle ou lui qui appliquera ce que tu dis.`)
      : 'Personne n’est en poste à la réception à cette heure-ci.',
  ].filter(Boolean).join(' ');

  // Le dossier ouvert à l'écran lui évite de chercher ce qu'on a déjà sous les
  // yeux : on ne discute pas dans le vide, on discute DE quelque chose.
  let contexte = '';
  if (body.id) {
    const { data } = await supabaseAdmin
      .from('assistant_mail_log')
      .select('subject, from_addr, from_name, received_at, category, reason, result')
      .eq('id', String(body.id)).eq('mailbox', cfg.mailbox).maybeSingle();
    if (data) {
      const res = (data.result || {}) as Record<string, unknown>;
      contexte = [
        `Mail : « ${data.subject} »`,
        `De : ${data.from_name || ''} <${data.from_addr}>${data.received_at ? ` le ${String(data.received_at).slice(0, 16).replace('T', ' à ')}` : ''}`,
        `Ce que j'en ai compris : ${data.reason || '—'}`,
        res.ref ? `Référence du dossier : ${res.ref}` : '',
        res.message ? `Ce qu'il reste à faire : ${res.message}` : '',
      ].filter(Boolean).join('\n');
    }
  }

  // L'enquête est ouverte AVANT d'appeler le serveur : c'est elle qui porte le
  // numéro, et une enquête ouverte pour rien vaut mieux qu'une réponse déposée
  // dans le vide.
  const { data: enquete, error: err } = await supabaseAdmin
    .from('junior_enquetes')
    .insert({ hotel_key: cfg.key, question, contexte: contexte || null, demandee_par: auth.userId })
    .select('id').single();
  if (err || !enquete) {
    return NextResponse.json({ ok: false, error: 'Je n’ai pas pu ouvrir l’enquête.' }, { status: 500 });
  }

  try {
    // 15 s suffisent largement : le serveur accuse réception en une seconde et
    // travaille ensuite. Ce délai ne mesure plus l'enquête, seulement le trajet.
    const r = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-secret': secret },
      body: JSON.stringify({ question, hotel: cfg.key, contexte, fil, qui, enquete_id: enquete.id }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `agent ${r.status}`);
    }
    return NextResponse.json({ ok: true, enquete: enquete.id });
  } catch (e) {
    // Serveur éteint ou tunnel coupé. On referme l'enquête plutôt que de la
    // laisser « en cours » pour toujours : l'écran attendrait une réponse que
    // personne n'écrira. Junior n'est pas indispensable — le tri continue sans lui.
    const erreur = e instanceof Error && e.name === 'TimeoutError'
      ? 'Le serveur de La Corniche ne répond pas.'
      : 'Je n’arrive pas à joindre Junior sur le serveur de La Corniche.';
    await supabaseAdmin.from('junior_enquetes')
      .update({ statut: 'echec', erreur, finished_at: new Date().toISOString() })
      .eq('id', enquete.id);
    return NextResponse.json({ ok: false, error: erreur }, { status: 504 });
  }
}

// Relever une enquête. L'écran repasse ici toutes les deux secondes tant qu'elle
// est en cours — c'est court à lire et ça ne réveille rien côté serveur.
export async function GET(req: Request) {
  const auth = await requireRole(req, ['superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const id = new URL(req.url).searchParams.get('enquete');
  if (!id) return NextResponse.json({ ok: false, error: 'enquete requise' }, { status: 400 });

  const { data } = await supabaseAdmin
    .from('junior_enquetes')
    .select('statut, reponse, traces, erreur, created_at')
    .eq('id', id).maybeSingle();
  if (!data) return NextResponse.json({ ok: false, error: 'enquête introuvable' }, { status: 404 });

  // Filet contre l'attente éternelle : le serveur peut mourir en cours d'enquête
  // (redémarrage, coupure) sans jamais rien déposer. Son propre plafond est de
  // 4 minutes ; passé 6, plus personne ne viendra.
  if (data.statut === 'en_cours' && Date.now() - new Date(data.created_at).getTime() > 6 * 60_000) {
    return NextResponse.json({
      ok: true, statut: 'echec',
      erreur: 'Il n’a pas rendu sa réponse — repose-lui la question.',
    });
  }

  return NextResponse.json({
    ok: true, statut: data.statut,
    reponse: data.reponse, traces: data.traces || [], erreur: data.erreur,
  });
}
