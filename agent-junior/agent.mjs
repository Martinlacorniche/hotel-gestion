// ── Junior, l'agent qui enquête ─────────────────────────────────────────────
//
// Tourne sur le serveur de La Corniche, pas sur Netlify : une enquête dure des
// minutes (chercher dans la boîte, ouvrir une fiche, croiser un planning), alors
// qu'une fonction Netlify est coupée bien avant.
//
// RÈGLES POSÉES AVEC MARTIN (2026-07-24) :
//   · Il n'intervient JAMAIS de lui-même. Un humain le sollicite depuis /junior.
//   · LECTURE LIBRE, ÉCRITURE INTERDITE ici. Il cherche, lit, croise, explique —
//     tout ce qui modifie quoi que ce soit passe par l'app, avec un clic humain.
//     C'est la barrière : même mal aiguillé, il ne peut rien casser.
//   · Plafond de tours et de durée : un agent qui enquête peut tourner en rond.
//
// Volontairement autonome (aucune dépendance au dépôt) : les règles métier vivent
// dans l'app, ici il n'y a que des accès en lecture.

import { createServer } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';

const PORT = Number(process.env.AGENT_PORT || 5055);
const SECRET = process.env.AGENT_SECRET;
const SB_URL = 'https://drdlcohzfjdogyquglcs.supabase.co/rest/v1';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MODEL = 'claude-opus-4-8';
const MAX_TOURS = 12;
const MAX_MS = 4 * 60 * 1000;

const BOITES = new Set(['contact-lesvoiles@htbm.fr', 'contact-corniche@htbm.fr']);
const HOTELS = {
  voiles: { id: 'ded6e6fb-ff3c-4fa8-ad07-403ee316be53', nom: 'Les Voiles', mailbox: 'contact-lesvoiles@htbm.fr' },
  corniche: { id: 'f9d59e56-9a2f-433e-bcf4-f9753f105f32', nom: 'La Corniche', mailbox: 'contact-corniche@htbm.fr' },
};

// ── Accès Microsoft Graph (lecture seule) ───────────────────────────────────
let jeton = null;
async function graphToken() {
  if (jeton && Date.now() < jeton.exp) return jeton.v;
  const r = await fetch(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GRAPH_CLIENT_ID, client_secret: process.env.GRAPH_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`token ${r.status}`);
  jeton = { v: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return jeton.v;
}

async function graph(mailbox, path) {
  if (!BOITES.has(String(mailbox).toLowerCase())) throw new Error(`boîte hors périmètre : ${mailbox}`);
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}${path}`, {
    headers: { Authorization: `Bearer ${await graphToken()}`, ConsistencyLevel: 'eventual' },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`graph ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
  return j;
}

const enTexte = (html) => String(html || '')
  .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

async function sb(table, query) {
  const r = await fetch(`${SB_URL}/${table}?${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return r.json();
}

// ── Les outils : tout en lecture ────────────────────────────────────────────
const OUTILS = [
  {
    name: 'chercher_mails',
    description: 'Cherche des mails dans TOUTE la boîte de l\'hôtel (reçus, envoyés, dossiers de rangement). Sert à reconstituer un fil, vérifier si on a déjà répondu, ou retrouver une pièce jointe.',
    input_schema: {
      type: 'object',
      properties: { requete: { type: 'string', description: 'mots-clés, référence de dossier, ou adresse e-mail' } },
      required: ['requete'],
    },
  },
  {
    name: 'lire_mail',
    description: 'Lit un mail en entier à partir de son identifiant, obtenu par chercher_mails.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'chercher_dossier',
    description: 'Cherche une fiche du suivi commercial. ⚠️ La fiche est au nom du CLIENT FINAL, pas de l\'intermédiaire qui écrit : cherche le nom du client cité DANS le mail avant celui de l\'expéditeur. Tu peux aussi chercher par e-mail, ou par date d\'événement seule (le critère le plus sûr quand le nom ne donne rien).',
    input_schema: {
      type: 'object',
      properties: {
        texte: { type: 'string', description: 'nom du client final, société, e-mail, ou référence BY-… (facultatif si tu donnes une date)' },
        date_evenement: { type: 'string', description: 'yyyy-mm-dd — date de l\'événement, très discriminante' },
      },
    },
  },
  {
    name: 'planning_salles',
    description: 'Occupation réelle des salles de séminaire sur une période. Ne renvoie que les dossiers vivants (option ou gagné).',
    input_schema: {
      type: 'object',
      properties: {
        debut: { type: 'string', description: 'yyyy-mm-dd' },
        fin: { type: 'string', description: 'yyyy-mm-dd' },
      },
      required: ['debut', 'fin'],
    },
  },
  {
    // ⚠️ UN SEUL OUTIL POUR TOUT LE QUOTIDIEN, pas un par table. Multiplier les
    // outils dilue le choix du modèle et fait grossir le prompt à chaque nouvelle
    // fonctionnalité de l'app ; ici on ajoute un registre à une liste (Martin
    // 2026-07-24 : « dans 6 mois l'agent il va pas être surchargé ? »).
    name: 'vie_de_lhotel',
    description: 'Ce qui se passe dans l\'hôtel à une date donnée : consignes de la réception, demandes clients (taxi, réveil…), tickets de service, maintenance en cours, chambres libérées, qui est en poste. Sers-t\'en pour savoir si un sujet a déjà été traité en interne.',
    input_schema: {
      type: 'object',
      properties: {
        registre: {
          type: 'string',
          enum: ['consignes', 'demandes', 'tickets', 'maintenance', 'chambres_liberees', 'planning'],
          description: 'ce que tu veux consulter',
        },
        date: { type: 'string', description: 'yyyy-mm-dd (par défaut aujourd\'hui)' },
        jours: { type: 'number', description: 'nombre de jours à couvrir à partir de la date, 1 par défaut, 14 au plus' },
      },
      required: ['registre'],
    },
  },
];

async function executer(nom, args, hotel) {
  const h = HOTELS[hotel] || HOTELS.corniche;
  if (nom === 'chercher_mails') {
    const j = await graph(h.mailbox, `/messages?$search=${encodeURIComponent(`"${args.requete}"`)}&$top=15`
      + '&$select=id,subject,from,toRecipients,sentDateTime,receivedDateTime,hasAttachments,bodyPreview');
    return (j.value || []).map((m) => ({
      id: m.id,
      de: m.from?.emailAddress?.address || '',
      a: (m.toRecipients || []).map((t) => t.emailAddress?.address).join(', '),
      date: m.sentDateTime || m.receivedDateTime,
      denous: String(m.from?.emailAddress?.address || '').includes('htbm.fr'),
      objet: m.subject, pj: !!m.hasAttachments,
      apercu: String(m.bodyPreview || '').slice(0, 200),
    }));
  }
  if (nom === 'lire_mail') {
    const j = await graph(h.mailbox, `/messages/${args.id}?$select=subject,from,toRecipients,sentDateTime,body`);
    return {
      objet: j.subject, de: j.from?.emailAddress?.address,
      a: (j.toRecipients || []).map((t) => t.emailAddress?.address).join(', '),
      date: j.sentDateTime, texte: enTexte(j.body?.content).slice(0, 6000),
    };
  }
  if (nom === 'chercher_dossier') {
    const champs = 'id,nom_client,societe,email,statut,date_evenement,date_fin_evenement,budget_estime,etat_paiement,besoin_gaetan,motif_perte,date_relance,commentaires';
    let q = `select=${champs}&hotel_id=eq.${h.id}&limit=8`;
    const t = String(args.texte || '').replace(/[^\p{L}\p{N} .@'-]/gu, ' ').trim();
    // L'e-mail compte autant que le nom : sur un dossier passé par un intermédiaire,
    // c'est souvent la seule chose que les deux ont en commun.
    if (t) q += `&or=(nom_client.ilike.*${t}*,societe.ilike.*${t}*,email.ilike.*${t}*,titre_demande.ilike.*${t}*,commentaires.ilike.*${t}*)`;
    if (args.date_evenement) q += `&date_evenement=eq.${args.date_evenement}`;
    if (!t && !args.date_evenement) throw new Error('donne au moins un texte ou une date');
    return sb('suivi_commercial', q);
  }
  if (nom === 'planning_salles') {
    return sb('view_planning_seminaires',
      `select=room_name,nom_client,start_date,end_date,start_time,end_time,display_status&hotel_id=eq.${h.id}`
      + `&start_date=lte.${args.fin}&end_date=gte.${args.debut}`);
  }
  if (nom === 'vie_de_lhotel') {
    const d0 = args.date || new Date().toISOString().slice(0, 10);
    const n = Math.min(Math.max(Number(args.jours) || 1, 1), 14);
    const d1 = new Date(new Date(d0).getTime() + (n - 1) * 864e5).toISOString().slice(0, 10);
    const plage = (col) => `${col}=gte.${d0}&${col}=lte.${d1}`;
    const R = {
      consignes: ['consignes', `select=texte,auteur,valide,date_creation&${plage('date_creation')}`],
      demandes: ['demandes', `select=type,nom,chambre,heure,date,statut,valide&${plage('date')}`],
      tickets: ['tickets', `select=titre,service,priorite,date_action,valide,auteur&${plage('date_action')}`],
      maintenance: ['maintenance', `select=titre,type,chambre,statut,date_creation,date_resolution,commentaire&${plage('date_creation')}`],
      chambres_liberees: ['chambres_liberees', `select=chambres,auteur,created_at&created_at=gte.${d0}`],
      planning: ['planning_entries', `select=date,shift,status,user_id&status=eq.published&${plage('date')}`],
    }[args.registre];
    if (!R) throw new Error(`registre inconnu : ${args.registre}`);
    return sb(R[0], `${R[1]}&hotel_id=eq.${h.id}&limit=60`);
  }
  throw new Error(`outil inconnu : ${nom}`);
}

// ── La boucle ───────────────────────────────────────────────────────────────
const SYSTEME = `Tu es Junior, l'assistant de la réception de l'hôtel. Quelqu'un de
l'équipe te sollicite sur un dossier précis : tu enquêtes, puis tu réponds.

CE QUE TU PEUX FAIRE : chercher et lire des mails (toute la boîte, envoyés compris),
ouvrir une fiche du suivi commercial, regarder l'occupation des salles, et consulter
la vie de l'hôtel — consignes, demandes clients, tickets de service, maintenance,
chambres libérées, qui est en poste. Sers-toi-en : va vérifier plutôt que supposer.
Un sujet a souvent déjà été traité en interne sans que le mail le dise.

CE QUE TU NE PEUX PAS FAIRE : écrire, envoyer, supprimer, modifier quoi que ce soit.
Tu n'as que la lecture. Si la suite demande un geste — répondre à un client, poser
une option, mettre une fiche à jour — dis-le clairement, c'est l'humain qui le fera
depuis l'écran.

CHERCHER UN DOSSIER — CE QUI FAIT PERDRE DU TEMPS : une fiche est au nom du CLIENT
FINAL, jamais de l'intermédiaire qui écrit. Une centrale de réservation, une agence,
une place de marché portent des dizaines de dossiers sans rapport ; leur chargé de
compte n'est pas le client. Si le mail dit « anniversaire pour Emmanuelle », cherche
« Emmanuelle » avant de conclure qu'il n'y a pas de fiche. Trois pistes, dans l'ordre :
la référence du dossier si elle existe, le nom du client final ou son e-mail, puis la
DATE de l'événement seule — très discriminante. N'annonce « aucune fiche » qu'après
avoir essayé la date.

COMMENT TU RÉPONDS : court et direct, en français, comme un collègue au comptoir.
Donne d'abord la réponse, ensuite ce sur quoi tu t'appuies (date du mail, statut de
la fiche). Si tu n'as pas trouvé, dis-le franchement — une hypothèse présentée comme
un fait coûte plus cher qu'un « je ne sais pas ». Ne cite jamais le nom d'un autre
client dans un texte qui pourrait partir chez un tiers.`;

async function enqueter({ question, hotel, contexte, fil }) {
  const client = new Anthropic();
  const t0 = Date.now();
  // ⚠️ LE SERVICE N'A AUCUNE MÉMOIRE — c'est voulu : rien ne s'accumule entre deux
  // enquêtes. Le fil de la conversation est donc renvoyé par l'écran à chaque fois,
  // sinon « et pour l'autre dossier ? » repartirait de zéro et il redemanderait ce
  // qu'on vient de lui dire. Trois échanges suffisent : au-delà, on paie du contexte
  // que personne ne relit.
  const messages = [];
  for (const e of (Array.isArray(fil) ? fil : []).slice(-3)) {
    if (!e?.moi || !e?.lui) continue;
    messages.push({ role: 'user', content: String(e.moi).slice(0, 2000) });
    messages.push({ role: 'assistant', content: String(e.lui).slice(0, 6000) });
  }
  messages.push({
    role: 'user',
    content: (contexte && !messages.length ? `Contexte du dossier ouvert à l'écran :\n${contexte}\n\n` : '') + `Question : ${question}`,
  });
  const traces = [];

  for (let tour = 0; tour < MAX_TOURS; tour++) {
    if (Date.now() - t0 > MAX_MS) return { reponse: 'J’ai cherché trop longtemps sans conclure — repose-moi la question autrement.', traces };
    const rep = await client.messages.create({
      model: MODEL, max_tokens: 4000, system: SYSTEME, tools: OUTILS, messages,
      thinking: { type: 'adaptive' },
    });
    messages.push({ role: 'assistant', content: rep.content });

    const appels = rep.content.filter((b) => b.type === 'tool_use');
    if (!appels.length) {
      const texte = rep.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { reponse: texte || 'Je n’ai rien à ajouter.', traces };
    }

    const resultats = [];
    for (const a of appels) {
      traces.push({ outil: a.name, args: a.input });
      try {
        const out = await executer(a.name, a.input, hotel);
        resultats.push({ type: 'tool_result', tool_use_id: a.id, content: JSON.stringify(out).slice(0, 20000) });
      } catch (e) {
        resultats.push({ type: 'tool_result', tool_use_id: a.id, content: `Erreur : ${e.message}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: resultats });
  }
  return { reponse: 'J’ai fait le tour de ce que je pouvais consulter sans trouver de réponse nette.', traces };
}

// ── Le serveur ──────────────────────────────────────────────────────────────
createServer(async (req, res) => {
  const fin = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  // ⚠️ Tailscale Funnel RETIRE le préfixe du chemin avant de transmettre : une
  // requête sur /agent/sante arrive ici en /sante. On accepte donc les deux formes,
  // pour que le service réponde aussi bien en direct (port local) qu'à travers le
  // tunnel — c'est ce qui a fait échouer le premier essai depuis internet.
  const chemin = (req.url || '/').replace(/^\/agent/, '') || '/';
  if (req.method === 'GET' && chemin === '/sante') return fin(200, { ok: true, junior: 'prêt' });
  if (req.method !== 'POST' || chemin !== '/') return fin(404, { ok: false, error: 'non' });
  if (!SECRET || req.headers['x-agent-secret'] !== SECRET) return fin(401, { ok: false, error: 'clé invalide' });

  let brut = '';
  req.on('data', (c) => { brut += c; if (brut.length > 200000) req.destroy(); });
  req.on('end', async () => {
    try {
      const { question, hotel, contexte, fil } = JSON.parse(brut || '{}');
      if (!question) return fin(400, { ok: false, error: 'question requise' });
      const t0 = Date.now();
      const r = await enqueter({ question, hotel, contexte, fil });
      console.log(`[${new Date().toISOString()}] ${hotel} · ${Math.round((Date.now() - t0) / 1000)}s · ${r.traces.length} outils · ${String(question).slice(0, 70)}`);
      fin(200, { ok: true, ...r });
    } catch (e) {
      console.error('erreur', e);
      fin(500, { ok: false, error: String(e.message || e) });
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Junior écoute sur 127.0.0.1:${PORT}`));
