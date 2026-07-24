import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';
import { hotelConfig } from '@/lib/mailAssistant';

// Relais vers l'agent qui enquête, sur le serveur de La Corniche.
//
//   POST /api/junior/agent?hotel=corniche  { id?, question }
//
// Pourquoi un relais et pas un appel direct depuis le navigateur : la clé de
// l'agent ne doit jamais descendre côté client, et c'est ici qu'on vérifie qui
// demande. L'app passe par le tunnel Tailscale du serveur (JUNIOR_AGENT_URL) —
// une enquête dure des minutes, ce qu'aucune fonction Netlify ne tiendrait si
// elle devait faire le travail elle-même ; ici elle ne fait qu'attendre.
//
// ⚠️ SUPERADMIN UNIQUEMENT pour l'instant (Martin 2026-07-24 : « on met en ligne
// que pour moi »). L'agent lit toute la boîte et tout le CRM : on ouvre aux
// équipes quand on aura vu comment il se comporte.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

  try {
    const r = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-secret': secret },
      body: JSON.stringify({ question, hotel: cfg.key, contexte, fil }),
      signal: AbortSignal.timeout(280_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      return NextResponse.json({ ok: false, error: j.error || `agent ${r.status}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, reponse: j.reponse, traces: j.traces || [] });
  } catch (e) {
    // Serveur éteint, tunnel coupé, enquête trop longue : on le dit simplement.
    // Junior n'est pas indispensable — le tri, lui, continue de tourner sans lui.
    return NextResponse.json(
      { ok: false, error: e instanceof Error && e.name === 'TimeoutError'
        ? 'Il cherche depuis trop longtemps — repose-lui la question autrement.'
        : 'Je n’arrive pas à joindre Junior sur le serveur de La Corniche.' },
      { status: 504 },
    );
  }
}
