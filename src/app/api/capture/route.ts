import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireRole } from '@/lib/apiAuth';
import { CAPTURE_SCHEMA, type CaptureProposal } from '@/lib/captureTypes';

// POST /api/capture
// Body: { text: string }
//
// Routeur de capture universelle : transforme une note libre tapée par un
// salarié en proposition structurée (consigne, demande taxi/réveil/VTC,
// ticket, maintenance, objet trouvé) via Claude Haiku + structured outputs.
// La création de l'objet reste côté client après confirmation humaine —
// cette route ne touche pas à la base.

const MAX_INPUT_LENGTH = 500;

const MAX_OPEN_ITEMS = 150;

function buildSystemPrompt(hotelNames: string[], openItems: string[]): string {
  const now = new Date();
  // fr-CA donne directement yyyy-MM-dd
  const fmtDate = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' });
  const fmtDay = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long' });
  const today = fmtDate.format(now);
  const weekday = fmtDay.format(now);
  // Calendrier des 8 prochains jours pour que le modèle n'ait pas à calculer
  // les jours de la semaine (source d'erreurs d'un jour).
  const calendar = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(now.getTime() + i * 86_400_000);
    const label = i === 0 ? ' (aujourd’hui)' : i === 1 ? ' (demain)' : '';
    return `${fmtDay.format(d)} = ${fmtDate.format(d)}${label}`;
  }).join(', ');

  return `Tu es le routeur de capture d'un outil de gestion hôtelière interne (hôtels en France).
Nous sommes le ${weekday} ${today} (heure de Paris).
Calendrier des prochains jours : ${calendar}.
Quand la note mentionne un jour de la semaine, utilise EXACTEMENT la date du calendrier ci-dessus.
${hotelNames.length ? `Les hôtels du groupe : ${hotelNames.join(', ')}. Si la note mentionne explicitement l'un d'eux (même abrégé ou approximatif), renvoie son nom EXACT de cette liste dans "hotel" ; sinon "hotel" = null. La mention de l'hôtel ne doit alors PAS être répétée dans le texte/titre.` : ''}

Un salarié (réception, housekeeping, maintenance) tape une note libre. Transforme-la en objets structurés pour les bons modules.
Une note peut contenir PLUSIEURS éléments distincts (ex : "réveil 17 6h30 + taxi gare 7h15" = 2 éléments) : renvoie un item par élément dans "items". Une note simple = un seul item. Note incompréhensible = un seul item "inconnu".
Les types possibles :
- "demande" : un taxi, un VTC ou un réveil pour une chambre, à une date et une heure. Ex : "réveil 12 demain 7h" → Réveil, chambre 12.
- "maintenance" : un problème technique dans une chambre ou un lieu (fuite, panne, clim, ampoule, serrure, dégât...). Choisis le type le plus proche de la liste.
- "objet_trouve" : un objet oublié ou retrouvé appartenant à un client.
- "ticket" : une tâche de service à faire (préparer, vérifier, commander, rappeler...) qui n'est ni technique ni un taxi/réveil. Choisis le service concerné ; priorité "Moyenne" par défaut, "Haute" seulement si l'urgence est explicite.
- "consigne" : une information ou une instruction à transmettre aux équipes ou à un collègue précis ("dire à X de...", "pour Mariam : ...") — client VIP, situation particulière, sujet commercial, rappel à faire, instruction temporaire. C'est le type PAR DÉFAUT : si la note est compréhensible mais ne correspond à aucun autre module, c'est une consigne. Si la note vise un destinataire, le texte de la consigne DOIT commencer par "Pour <Prénom> : ".
- "cloture" : la note dit EXPLICITEMENT qu'une chose est FAITE, réparée, terminée, validée, annulée ou n'a plus lieu d'être ("fuite 12 réparée", "le taxi de la 5 c'est bon", "consigne VIP plus d'actualité") ET elle correspond clairement à UN élément de la liste des éléments ouverts ci-dessous. Renvoie "target_index" = l'index de cet élément. Si la note mentionne un temps de travail ou un coût (maintenance), remplis temps_travail (heures) / budget (euros), sinon null. ATTENTION : une note qui DÉCRIT un problème sans mot d'achèvement (réparé, fait, ok, terminé, rendu, annulé...) n'est JAMAIS une clôture, même si un élément ouvert identique existe — c'est une création normale. Si l'achèvement est exprimé mais qu'aucun élément ouvert ne correspond, renvoie "inconnu" : n'invente JAMAIS un index.
- "inconnu" : UNIQUEMENT si la note est réellement incompréhensible (charabia, vide de sens), OU si elle annonce qu'une chose est faite mais qu'AUCUN élément ouvert ne correspond. Dans ce cas n'inclus aucun sous-objet et explique dans "resume" ce qui manque (ex : "Aucun élément ouvert ne correspond à ...").

Règles :
- Dates au format yyyy-MM-dd, heures au format HH:mm (24h). "demain" = le jour suivant ${today}. Si aucune date n'est précisée pour une demande ou un ticket, utilise ${today}.
- Si la chambre n'est pas précisée, mets "" (et ["?"] pour les chambres de maintenance).
- "prix" : uniquement pour un VTC dont le prix est mentionné, sinon null.
- Reformule texte/titre proprement (orthographe corrigée, en français), sans inventer d'information.
- La reformulation ne doit perdre AUCUNE information de la note (détails, conditions, nuances, consignes de négociation...). Structure et corrige, mais ne résume pas.
- "date_fin" d'une consigne : si la note indique que la situation se termine à une date identifiable (ex : "pas de clim avant vendredi" → la consigne reste utile jusqu'à vendredi), mets cette date. Sinon null.
- Si une image est fournie (photo d'une note manuscrite, capture d'un mail, photo d'un problème...), utilise tout ce qui y est lisible ou visible comme si ça faisait partie de la note.
- "resume" : une phrase courte du type "Créer un réveil pour la chambre 12 demain à 07:00" (ou "Clôturer : Fuite douche chambre 24" pour une clôture).
- Pour chaque item, remplis UNIQUEMENT le sous-objet correspondant au type choisi.
- Ne clôture JAMAIS dans le doute : si tu hésites entre plusieurs éléments ouverts ou si le rapprochement est incertain, renvoie "inconnu" avec une explication. Une note peut mélanger créations et clôtures ("fuite 12 réparée, par contre ampoule grillée couloir 2" = 1 clôture + 1 maintenance).

${
  openItems.length
    ? `Éléments actuellement OUVERTS (pour le type "cloture", target_index = index dans cette liste) :
${openItems.map((label, i) => `${i}. ${label}`).join('\n')}`
    : `Aucun élément ouvert n'a été fourni : n'utilise JAMAIS le type "cloture".`
}`;
}

export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin', 'admin', 'user']);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { ok: false, error: 'ANTHROPIC_API_KEY manquante côté serveur' },
      { status: 500 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON invalide' }, { status: 400 });
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const hotelNames = Array.isArray(body.hotels)
    ? (body.hotels as unknown[]).filter((h): h is string => typeof h === 'string').slice(0, 10)
    : [];
  const openItems = Array.isArray(body.openItems)
    ? (body.openItems as unknown[])
        .filter((l): l is string => typeof l === 'string' && l.length > 0)
        .map((l) => l.slice(0, 160))
        .slice(0, MAX_OPEN_ITEMS)
    : [];

  const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  let image: { media_type: string; data: string } | null = null;
  if (body.image && typeof body.image === 'object') {
    const img = body.image as { media_type?: unknown; data?: unknown };
    if (
      typeof img.media_type !== 'string' ||
      !ALLOWED_IMAGE_TYPES.includes(img.media_type) ||
      typeof img.data !== 'string'
    ) {
      return NextResponse.json({ ok: false, error: 'Image invalide' }, { status: 400 });
    }
    if (img.data.length > 8_000_000) {
      return NextResponse.json({ ok: false, error: 'Image trop lourde (max ~5 Mo)' }, { status: 400 });
    }
    image = { media_type: img.media_type, data: img.data };
  }

  if (!text && !image) {
    return NextResponse.json({ ok: false, error: 'text ou image requis' }, { status: 400 });
  }
  if (text.length > MAX_INPUT_LENGTH) {
    return NextResponse.json(
      { ok: false, error: `Note trop longue (max ${MAX_INPUT_LENGTH} caractères)` },
      { status: 400 },
    );
  }

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: buildSystemPrompt(hotelNames, openItems),
      output_config: {
        format: {
          type: 'json_schema',
          schema: CAPTURE_SCHEMA as unknown as Record<string, unknown>,
        },
      },
      messages: [
        {
          role: 'user',
          content: [
            ...(image
              ? [
                  {
                    type: 'image' as const,
                    source: {
                      type: 'base64' as const,
                      media_type: image.media_type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                      data: image.data,
                    },
                  },
                ]
              : []),
            { type: 'text' as const, text: text || 'Analyse l’image et crée l’objet correspondant.' },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      return NextResponse.json(
        { ok: false, error: 'Analyse impossible, reformule la note' },
        { status: 422 },
      );
    }

    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      return NextResponse.json({ ok: false, error: 'Réponse vide du modèle' }, { status: 502 });
    }

    const parsed = JSON.parse(block.text) as { items: CaptureProposal[] };
    let proposals = Array.isArray(parsed.items) ? parsed.items.slice(0, 10) : [];
    // Garde-fou : une clôture doit référencer un index valide de la liste fournie.
    proposals = proposals.map((p) => {
      if (p.type !== 'cloture') return p;
      const idx = p.cloture?.target_index;
      if (idx == null || !Number.isInteger(idx) || idx < 0 || idx >= openItems.length) {
        return {
          type: 'inconnu' as const,
          resume: `Aucun élément ouvert ne correspond — rien à clôturer. (${p.resume})`,
          hotel: null,
        };
      }
      return p;
    });
    if (!proposals.length) {
      return NextResponse.json(
        { ok: false, error: 'Aucun élément reconnu, reformule la note' },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: true, proposals });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error('capture: erreur API Anthropic', err.status, err.message);
      return NextResponse.json(
        { ok: false, error: 'Service d’analyse indisponible, réessaie' },
        { status: 502 },
      );
    }
    console.error('capture: erreur inattendue', err);
    return NextResponse.json({ ok: false, error: 'Erreur interne' }, { status: 500 });
  }
}
