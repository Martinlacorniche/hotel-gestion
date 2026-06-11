import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';
import { dutyWindow, type PlanningEntryLite } from '@/lib/shift';

// POST /api/brief   Body: { hotel_id: string }
//
// Brief de prise de poste (phase 4 outil vivant) : digère tout ce qui s'est
// passé depuis le DERNIER shift travaillé de l'appelant (planning publié,
// plafond 14 j, fallback 24 h) et le rend en quelques puces priorisées selon
// son service. Le LLM fusionne et raconte le film (y compris ce qui s'est
// réglé pendant l'absence — invisible sur les dashboards) — il ne liste pas.
// Généré à LA DEMANDE (clic "Mon brief"), jamais automatiquement.

const MAX_LOOKBACK_DAYS = 14;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// Calendrier explicite (14 j passés → 7 j à venir) : sans lui le modèle se
// trompe de jour de semaine en datant les faits (même fix que /api/capture).
function buildSystem(now: Date): string {
  const fmtDate = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' });
  const fmtDay = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long' });
  const calendar = Array.from({ length: 22 }, (_, i) => {
    const d = new Date(now.getTime() + (i - 14) * 86_400_000);
    const label = i === 14 ? " (AUJOURD'HUI)" : i === 15 ? ' (demain)' : i === 13 ? ' (hier)' : '';
    return `${fmtDay.format(d)} ${fmtDate.format(d)}${label}`;
  }).join(', ');
  return `${SYSTEM}
- Calendrier de référence (utilise EXACTEMENT ces correspondances jour/date, ne calcule jamais toi-même) : ${calendar}.
- Commence DIRECTEMENT par la première section "##" — aucun titre, aucune salutation (l'interface dit déjà bonjour).`;
}

const SYSTEM = `Tu rédiges le brief de prise de poste d'un salarié d'hôtel (français, tutoiement).
Tu reçois TOUT ce qui s'est passé pendant son absence + l'état du jour. Ton travail : DIGÉRER, pas lister.
Règles strictes :
- Le champ "maintenant" du contexte est LA référence temporelle. Les textes contiennent des dates relatives ("demain", "ce soir", "avant 12h") écrites À LEUR DATE DE RÉDACTION (champ "ecrit_le") : convertis-les en dates absolues avant de raisonner. Ne présente JAMAIS comme à venir un événement antérieur à maintenant — s'il est passé, il va dans "Pendant ton absence" (au passé) ou disparaît s'il n'apporte rien.
- "consignes_passees_ou_traitees_pendant_absence" = matière pour la section "Pendant ton absence" UNIQUEMENT (c'est expiré ou réglé) — jamais dans "À savoir pour aujourd'hui".
- "abonnements_cowork_en_cours" contient les VRAIES dates de fin : si un texte de consigne contredit ces dates, ce sont ces dates qui font foi.
- "chromecasts_deconnectes_en_ce_moment" est l'état TEMPS RÉEL : il fait foi sur tout texte qui parle de Chromecast. [] = tout est reconnecté (si un texte signalait une panne, dis qu'elle est résolue) ; null = état non relevé, ne rien affirmer.
- DATE chaque fait de "Pendant ton absence" (ex : "(lun 09/06)") et précise son sort : traité/réglé (champs traitee, reglee, faite) ou resté sans suite. Jamais de fait passé sans date ni statut.
- Si un texte est ambigu ou contradictoire (ex : une échéance relative déjà dépassée au moment où tu écris), ne tranche pas : signale-le en "à clarifier" avec les dates connues.
- 3 sections markdown maximum : "## Pendant ton absence" (ce qui s'est passé ET réglé — continuité), "## À savoir pour aujourd'hui" (ce qui va impacter SON shift, priorisé selon son service), "## Ta journée" (l'agenda opérationnel, en une ou deux lignes).
- MAXIMUM 8 puces ou points au TOTAL, courtes. C'est une limite dure : si la matière déborde, garde uniquement le plus important et termine la section "À savoir" par "+ le reste sur le tableau de bord".
- Fusionne ce qui se rapporte à la même chambre / au même client / au même sujet. Ne répète jamais une info dans deux sections.
- Priorise selon le service du salarié (service-front = réception : clients, délais, taxis, consignes ; service-housekeeping : chambres, maintenance, objets ; service-fb : petit-déjeuner, stocks, salles).
- Mets en gras (**) les noms de clients, numéros de chambre et échéances datées.
- N'invente RIEN, ne déduis pas au-delà des données. Catégorie vide = on n'en parle pas. Si globalement calme, dis-le en une phrase et garde juste l'agenda du jour.
- Parle comme un collègue efficace, zéro emphase corporate.`;

export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin', 'admin', 'user']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, error: 'ANTHROPIC_API_KEY manquante' }, { status: 500 });
  }

  let body: { hotel_id?: string; chromecasts?: Array<{ name?: string; disconnected_since?: string | null }> | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON invalide' }, { status: 400 });
  }
  const hotelId = body.hotel_id;
  if (!hotelId) return NextResponse.json({ ok: false, error: 'hotel_id requis' }, { status: 400 });
  // État temps réel relevé par le navigateur (LAN hôtel) — voir BriefingModal.
  const chromecastsDown = Array.isArray(body.chromecasts)
    ? body.chromecasts
        .filter((c) => typeof c?.name === 'string')
        .slice(0, 30)
        .map((c) => ({ nom: c.name, deconnecte_depuis: c.disconnected_since ?? null }))
    : null;

  const now = new Date();
  const lookbackStart = new Date(now.getTime() - MAX_LOOKBACK_DAYS * 86_400_000);

  // 1. Fenêtre : fin du dernier shift travaillé avant le shift courant
  const { data: entries } = await supabaseAdmin
    .from('planning_entries')
    .select('date, shift, start_time, end_time')
    .eq('user_id', auth.userId)
    .eq('status', 'published')
    .gte('date', ymd(lookbackStart))
    .lte('date', ymd(now))
    .order('date', { ascending: true });

  const worked = (entries ?? [])
    .map((e) => ({ e: e as PlanningEntryLite, w: dutyWindow(e as PlanningEntryLite) }))
    .filter((x): x is { e: PlanningEntryLite; w: { start: Date; end: Date } } => x.w !== null);
  const current = worked.find((x) => now >= x.w.start && now <= x.w.end);
  const ref = current ? current.w.start : now;
  const prev = [...worked].reverse().find((x) => x.w.end < ref && x !== current);
  const since = prev
    ? new Date(Math.max(prev.w.end.getTime(), lookbackStart.getTime()))
    : new Date(now.getTime() - 86_400_000);
  const sinceIso = since.toISOString();
  const sinceDay = ymd(since);
  const today = ymd(now);

  // 2. Contexte : prénom + service du salarié
  const [{ data: me }, { data: cfg }] = await Promise.all([
    supabaseAdmin.from('users').select('name').eq('id_auth', auth.userId).single(),
    supabaseAdmin.from('planning_config').select('service')
      .eq('user_id', auth.userId).eq('hotel_id', hotelId).limit(1).maybeSingle(),
  ]);

  // 3. Tout ce qui a bougé dans la fenêtre (hôtel sélectionné)
  const [consNew, consDone, tickNew, tickDone, maintNew, maintDone, demToday, flash, lib, consRepl, abos] =
    await Promise.all([
      supabaseAdmin.from('consignes').select('texte, auteur, valide, created_at, date_creation, date_fin')
        .eq('hotel_id', hotelId).gte('created_at', sinceIso)
        .order('created_at', { ascending: false }).limit(30),
      supabaseAdmin.from('consignes').select('texte, auteur')
        .eq('hotel_id', hotelId).eq('valide', true)
        .gte('date_validation', sinceDay).lt('created_at', sinceIso).limit(20),
      supabaseAdmin.from('tickets').select('titre, service, valide, date_action, created_at')
        .eq('hotel_id', hotelId).gte('created_at', sinceIso).limit(20),
      supabaseAdmin.from('tickets').select('titre')
        .eq('hotel_id', hotelId).eq('valide', true)
        .gte('date_validation', sinceDay).lt('created_at', sinceIso).limit(20),
      supabaseAdmin.from('maintenance').select('titre, chambre, statut')
        .eq('hotel_id', hotelId).gte('date_creation', sinceDay).limit(20),
      supabaseAdmin.from('maintenance').select('titre, chambre, temps_travail')
        .eq('hotel_id', hotelId).eq('statut', 'Fait')
        .gte('date_resolution', sinceDay).lt('date_creation', sinceDay).limit(20),
      supabaseAdmin.from('demandes').select('type, chambre, heure, valide')
        .eq('hotel_id', hotelId).eq('date', today).order('heure', { ascending: true }),
      supabaseAdmin.from('flash_infos').select('message')
        .eq('hotel_id', hotelId).eq('active', true).gte('created_at', sinceIso).limit(10),
      supabaseAdmin.from('chambres_liberees').select('chambres')
        .eq('hotel_id', hotelId).gte('created_at', `${today}T00:00:00`),
      supabaseAdmin.from('consignes').select('texte, replies')
        .eq('hotel_id', hotelId).order('created_at', { ascending: false }).limit(50),
      supabaseAdmin.from('abonnements').select('date_debut, date_fin, prix, commentaire, clients(nom, prenom)')
        .gte('date_fin', today).lte('date_debut', today).limit(20),
    ]);

  const replies = (consRepl.data ?? []).flatMap((c) =>
    ((c.replies as Array<{ texte?: string; auteur?: string; created_at?: string }> | null) ?? [])
      .filter((r) => (r.created_at ?? '') >= sinceIso)
      .map((r) => ({ sur: c.texte?.slice(0, 60), de: r.auteur, texte: r.texte })));

  // Une consigne sans date_fin ne vit que le jour de sa création (même règle
  // que les dashboards) : passée ou validée → matière "pendant ton absence",
  // jamais "aujourd'hui" (sinon le brief annonce des événements déjà passés).
  const stillCurrent = (c: { valide: boolean; date_creation: string | null; date_fin: string | null }) => {
    if (c.valide) return false;
    const dAction = c.date_creation;
    if (!dAction) return false;
    return dAction <= today && today <= (c.date_fin || dAction);
  };
  const consCurrent = (consNew.data ?? []).filter(stillCurrent);
  const consPast = (consNew.data ?? []).filter((c) => !stillCurrent(c));

  const ctx = {
    salarie: { prenom: me?.name ?? '', service: cfg?.service ?? 'inconnu' },
    absence: { depuis: since.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }), maintenant: now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) },
    consignes_valables_aujourdhui: consCurrent.map((c) => ({
      texte: c.texte, auteur: c.auteur, ecrit_le: c.date_creation, jusqu_au: c.date_fin ?? c.date_creation,
    })),
    consignes_passees_ou_traitees_pendant_absence: consPast.map((c) => ({
      texte: c.texte, auteur: c.auteur, ecrit_le: c.date_creation, reglee: c.valide,
    })),
    consignes_anciennes_reglees: (consDone.data ?? []).map((c) => c.texte),
    abonnements_cowork_en_cours: (abos.data ?? []).map((a) => ({
      client: `${(a.clients as { prenom?: string; nom?: string } | null)?.prenom ?? ''} ${(a.clients as { prenom?: string; nom?: string } | null)?.nom ?? ''}`.trim(),
      du: a.date_debut, au: a.date_fin, prix: a.prix, commentaire: a.commentaire,
    })),
    reponses_dans_les_fils: replies,
    taches_nouvelles: (tickNew.data ?? []).map((t) => ({
      titre: t.titre, service: t.service, faite: t.valide, pour_le: t.date_action,
      ecrit_le: (t.created_at as string | null)?.slice(0, 10),
    })),
    taches_anciennes_reglees: (tickDone.data ?? []).map((t) => t.titre),
    maintenances_nouvelles: (maintNew.data ?? []).map((m) => ({ titre: m.titre, chambre: m.chambre, statut: m.statut })),
    maintenances_reparees: (maintDone.data ?? []).map((m) => ({ titre: m.titre, chambre: m.chambre, temps: m.temps_travail })),
    taxis_reveils_aujourdhui: (demToday.data ?? []).map((d) => ({ type: d.type, chambre: d.chambre, heure: d.heure, fait: d.valide })),
    flash_direction: (flash.data ?? []).map((f) => f.message),
    chambres_liberees_aujourdhui: (lib.data ?? []).flatMap((l) => l.chambres ?? []),
    // null = état non relevé (hors LAN) ; [] = tout est connecté
    chromecasts_deconnectes_en_ce_moment: chromecastsDown,
  };

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      // Sonnet (pas Haiku) : le brief exige du raisonnement temporel et des
      // croisements entre sources que Haiku rate (jours de semaine faux,
      // contradictions non détectées). Volume faible (1 brief/prise de poste)
      // → ~3 ct pièce, acceptable.
      model: 'claude-sonnet-4-6',
      max_tokens: 900,
      system: buildSystem(now),
      messages: [{ role: 'user', content: JSON.stringify(ctx) }],
    });
    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      return NextResponse.json({ ok: false, error: 'Réponse vide du modèle' }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      brief: block.text,
      since: prev ? since.toISOString() : null,
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error('brief: erreur API Anthropic', err.status, err.message);
      return NextResponse.json({ ok: false, error: 'Brief indisponible, réessaie' }, { status: 502 });
    }
    console.error('brief: erreur inattendue', err);
    return NextResponse.json({ ok: false, error: 'Erreur interne' }, { status: 500 });
  }
}
