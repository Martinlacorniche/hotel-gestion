import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { Classification, MailCategory, MailAction } from '@/lib/mailAssistant';

// ── Le classifieur qui LIT le mail ──────────────────────────────────────────
//
// POURQUOI (Martin 2026-07-24, après un 0/4 sur la boîte Voiles). Le tri par
// regex est bon sur les canaux qu'on lui a appris — D-Edge, LoungeUp, Conferma,
// la vitrine Rooftop — et structurellement aveugle au reste : un expéditeur
// jamais vu tombe en `autre/none`, toujours. Ce matin : Kayak, une newsletter
// belge et un mail Backyou, trois expéditeurs neufs, trois échecs. Le nombre
// d'expéditeurs qui peuvent écrire à un hôtel étant infini, le stock de règles
// ne rattrapera jamais le flux. Ce n'est pas un défaut de réglage, c'est le
// plafond de la méthode.
//
// Pire : une regex attrape parfois le MAUVAIS MOT. « Appel à candidature : les
// agricultrices de Provence » (un média provençal) déclenchait un brouillon
// « nos effectifs sont au complet ». D'où le marquage `weak` dans
// `mailAssistant.ts` : les règles à mot-clé ne tranchent plus, elles donnent un
// AVIS que ce classifieur arbitre après avoir lu le mail en entier.
//
// CE QU'IL NE FAIT PAS. Les canaux à format fixe restent aux règles sûres, qui
// ne classent pas mais EXTRAIENT (le tarif, la carte virtuelle, la taxe de
// séjour, le last-4). Aucun modèle ne fera ça plus fiablement, et on ne veut pas
// de hasard sur une note de réservation. D'où la liste blanche d'actions plus
// bas : ce classifieur ne peut pas proposer `resa_control`, `agency_note`,
// `rooftop_check`, `presejour_check` ni `livraison_consigne`.

const MODEL = 'claude-opus-4-8';

// Actions que le classifieur a le droit de proposer, par catégorie. Toute autre
// combinaison est rejetée et retombe sur `autre/none` : un modèle qui invente
// une action non câblée produirait une ligne « bloquée » incompréhensible.
const ALLOWED: Partial<Record<MailCategory, MailAction[]>> = {
  spam_alert:     ['delete'],
  facture:        ['route_pennylane'],
  facture_interne:['archive'],
  facture_ota:    ['invoice_note'],
  facture_client: ['none'],
  commission_ota: ['draft_reply'],
  commercial:     ['commercial_followup', 'none'],
  candidature:    ['draft_reply'],
  litige_ota:     ['archive'],
  client_msg:     ['none'],
  autre:          ['none'],
};

// ── Le prompt ───────────────────────────────────────────────────────────────
// Relu et validé par Martin le 2026-07-24. C'EST ICI QUE VIVENT LES DÉCISIONS
// MÉTIER : une règle tranchée s'écrit en français dans ce texte, pas en regex.
// Toute modification de ce bloc se relit comme une note de service — c'est le
// but : Martin doit pouvoir l'auditer sans lire de code.
const REGLES = `
Tu tries la boîte mail de la réception d'un groupe hôtelier. Tu ne réponds à
personne et tu ne rédiges rien : tu ranges. Un humain valide chacune de tes
décisions avant qu'elle s'applique.

## Les deux hôtels

- La Corniche — Best Western Plus, Toulon. 29 chambres. PMS Hotsoft.
  4 salles de séminaire. Petit-déjeuner 20 €.
- Les Voiles — Toulon. 16 chambres. PMS Mews. Rooftop eat & drink.
  Petit-déjeuner 14 €.

## Ce qui a déjà été traité avant toi

Les canaux à format fixe sont pris en charge par des règles sûres, en amont :
réservations D-Edge / Booking / Expedia, prises en charge d'agences (Djoca,
Goelett, CDS, UVET, Conferma), réservations Rooftop de la vitrine, formulaires
pré-séjour LoungeUp, éditions automatiques du PMS, livraisons Cuisine Solutions.
Si un mail arrive jusqu'à toi, c'est qu'aucune n'a reconnu son canal. Ne cherche
pas à refaire leur travail.

## Catégories — tu en choisis exactement une

- spam_alert / delete — Publicité, démarchage à froid, newsletter (tourisme,
  fournisseur, média), phishing, faux organisme officiel vendant des affichages
  obligatoires.
- facture / route_pennylane — Facture FOURNISSEUR : quelqu'un nous facture, on
  doit payer.
- facture_interne / archive — Nos propres factures client, émises par notre PMS
  ou notre vitrine.
- facture_ota / invoice_note — Une OTA ou une agence RÉCLAME une copie de
  facture (Hotelbeds, message voyageur Expedia « guest requires invoice »).
- facture_client / none — Un CLIENT interroge sur SA facture (montant incompris,
  réclamation). L'équipe traite.
- commission_ota / draft_reply — Relevé ou facture de commission d'agence de
  voyage (Onyx CenterSource, Travel Counsellors).
- commercial / commercial_followup — Demande de séminaire, groupe, devis,
  location de salle, tournage.
- candidature / draft_reply — Candidature spontanée ou alternance : quelqu'un
  cherche UN EMPLOI CHEZ NOUS.
- litige_ota / archive — Service Clients Booking : accord d'annulation, geste
  commercial acté.
- client_msg / none — Un client écrit et ça ne rentre dans aucune case ci-dessus.
- autre / none — Tu n'es pas sûr.

## Les règles de la maison

1. Dans le doute, autre / none. Un mail passé à l'humain ne coûte rien. Un mail
   mal rangé coûte un client. Tu n'es pas noté sur ton taux de réponse.

2. Ne supprime JAMAIS un mail qui porte la parole d'un être humain, ni un mail
   qui parle d'argent (facture, impayé, commission, remboursement, relance) —
   même venant d'un expéditeur d'habitude publicitaire. Un même expéditeur
   envoie souvent de la pub ET du vrai courrier : Expedia envoie ses promotions
   et les messages des voyageurs depuis le même domaine.

3. Newsletters et promotions B2B → corbeille par principe, y compris celles des
   partenaires de destination comme Provence Méditerranée : un agenda des
   animations, une invitation, un « save the date » polluent la boîte. La seule
   chose qui sauve un de ces mails, c'est qu'il ATTENDE UNE ACTION de notre part
   — mettre à jour notre fiche dans une brochure, remplir un formulaire,
   répondre à une sollicitation. Dans ce cas il remonte à l'humain.

4. « Candidature » ne veut pas dire emploi. Un appel à candidature, un appel à
   projets, un concours, un appel à témoignages ne sont pas des candidatures.
   Il faut que quelqu'un postule chez nous, pour un poste.

5. Une commission d'agence peut être RÉELLEMENT DUE. Best Western
   (polehotels@bestwestern.fr) réclame des commissions qu'il faut saisir dans
   MemberWeb sous peine de suspension : ce n'est pas une réclamation à rejeter,
   c'est une obligation → autre / none, l'équipe s'en occupe. Seuls les relevés
   groupés d'Onyx et de Travel Counsellors vont en commission_ota.

6. Madame Hôtels (@madamehotels.fr) est une agence commissionnée à 10 %,
   annoncés d'avance et inclus dans le tarif. Ne jamais lui répondre que nos
   réservations ne sont pas commissionnables.

7. Si un collègue (@htbm.fr) a déjà écrit dans le fil, on n'y touche pas →
   autre / none. Un dossier qu'un humain a pris en main est à lui.

8. Le mot « facture » ne suffit pas à décider. Une facture fournisseur (on
   paie), une facture client (on encaisse) et une demande de copie sont trois
   choses différentes. Regarde qui écrit et ce qu'il demande, pas le mot.

9. La Corniche tourne sur Hotsoft, que tu ne vois pas. Un mail encore en boîte
   ne prouve pas que personne ne s'en est occupé. Ne conclus jamais qu'un
   dossier a été oublié.

10. Réponses aux clients Booking : uniquement via l'extranet. Les réponses par
    mail rebondissent. Si un mail appelle une réponse à un client Booking,
    laisse-le à l'humain plutôt que de proposer un brouillon.

11. Medallia est l'outil de satisfaction du réseau Best Western, et il envoie
    deux choses très différentes. Une « Survey Alert - Action Required » porte
    l'avis d'un vrai client, souvent mécontent, et appelle une réponse de
    l'équipe → client_msg / none. Un « Votre séjour à l'hôtel… » (ou sa version
    étrangère) est la copie de l'invitation à l'enquête envoyée au client :
    aucune action pour nous → spam_alert / delete.

## Ce que tu rends

Un objet JSON STRICT, rien autour :
{"category": "...", "action": "...", "confidence": 0.0, "reason": "une phrase
en français, pour la personne qui va valider", "signals": ["ce qui t'a décidé"]}

Si ta confiance est inférieure à 0,7, rends autre / none en expliquant ton
hésitation dans reason. C'est une réponse valable, pas un échec.
`.trim();

// ── L'apprentissage ─────────────────────────────────────────────────────────
//
// Chaque « Non, c'est plutôt… » de la réception atterrit dans
// `assistant_mail_corrections` (migration 103). Jusqu'ici cette table
// s'accumulait sans que RIEN ne la relise : la matière première d'un
// apprentissage continu était là, mais la boucle s'arrêtait avant de se
// refermer. C'est ce que ces quelques lignes changent — une correction faite
// par l'équipe le lundi change la décision du mardi, sans session avec moi.
//
// ⚠️ ON N'APPREND QUE DES CORRECTIONS HUMAINES. Un assistant qui apprendrait de
// ses propres verdicts validés par lui-même amplifierait ses erreurs au lieu de
// les corriger.
//
// ⚠️ On dédoublonne par expéditeur : sans ça, un canal corrigé quinze fois
// écraserait quinze cas différents et ferait exploser le prompt.
const MAX_CORRECTIONS = 40;

export async function recentCorrections(): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('assistant_mail_corrections')
    .select('subject, from_addr, category_avant, action_avant, category_apres, action_apres, commentaire')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error || !data?.length) return '';

  const vues = new Set<string>();
  const lignes: string[] = [];
  for (const c of data) {
    const cle = (c.from_addr || c.subject || '').toLowerCase();
    if (vues.has(cle)) continue;
    vues.add(cle);
    // Une correction sans reclassement ET sans commentaire n'apprend rien.
    const reclasse = c.category_apres || c.action_apres;
    if (!reclasse && !c.commentaire) continue;

    const avant = `${c.category_avant}/${c.action_avant}`;
    const apres = `${c.category_apres ?? c.category_avant}/${c.action_apres ?? c.action_avant}`;
    let l = `· « ${(c.subject || '').slice(0, 90)} » (${c.from_addr})`;
    if (reclasse) l += `\n  tu avais dit ${avant}, c'était ${apres}`;
    if (c.commentaire) l += `\n  note de l'équipe : « ${c.commentaire} »`;
    lignes.push(l);
    if (lignes.length >= MAX_CORRECTIONS) break;
  }
  if (!lignes.length) return '';

  return `## Corrections déjà apportées par l'équipe\n\n` +
    `Ce sont de vraies décisions humaines sur de vrais mails. Elles priment sur ` +
    `ton intuition : si un mail ressemble à l'un de ces cas, tranche comme l'équipe ` +
    `a tranché.\n\n${lignes.join('\n')}`;
}

export type LlmVerdict = Classification & { confidence: number };

export type LlmInput = {
  hotelName: string;
  fromAddr: string;
  fromName?: string;
  subject: string;
  body: string;
  attachmentNames?: string[];
  receivedAt?: string | null;
  /** Ce que les règles à mot-clé ont cru voir. Un avis, pas une consigne. */
  hint?: Classification;
};

// Le corps complet, mais borné : au-delà, on paie du bruit. 6 000 caractères
// couvrent très largement un mail d'hôtellerie signature et fil cité compris.
const MAX_BODY = 6000;

export async function classifyWithLlm(input: LlmInput, corrections: string): Promise<LlmVerdict | null> {
  const pj = input.attachmentNames?.length ? `\nPièces jointes : ${input.attachmentNames.join(', ')}` : '';
  const avis = input.hint
    ? `\n\nUne règle automatique a cru reconnaître « ${input.hint.category} / ${input.hint.action} » ` +
      `(${input.hint.reason}). Ce n'est qu'un avis fondé sur des mots-clés, souvent faux. ` +
      `Confirme-le ou corrige-le après avoir lu le mail.`
    : '';

  const system: Anthropic.TextBlockParam[] = [
    // Le point de cache est posé après les règles, qui ne bougent pas : les
    // corrections, elles, s'ajoutent en continu et invalideraient le préfixe.
    // ⚠️ Le cache ne s'active qu'au-delà de 4 096 tokens de préfixe sur ce
    // modèle — tant que le bloc de règles reste court, il ne prend pas (aucune
    // erreur, simplement aucune économie).
    { type: 'text', text: REGLES, cache_control: { type: 'ephemeral' } },
    ...(corrections ? [{ type: 'text' as const, text: corrections }] : []),
  ];

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      system,
      messages: [{
        role: 'user',
        content:
          `Hôtel destinataire : ${input.hotelName}\n` +
          `Reçu le : ${input.receivedAt ?? 'inconnu'}\n` +
          `Expéditeur : ${input.fromName ?? ''} <${input.fromAddr}>\n` +
          `Objet : ${input.subject}${pj}\n\n` +
          `--- corps du message ---\n${(input.body || '').slice(0, MAX_BODY)}\n--- fin ---${avis}`,
      }],
    });

    const txt = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const brut = txt.match(/\{[\s\S]*\}/)?.[0];
    if (!brut) return null;
    const j = JSON.parse(brut) as {
      category?: string; action?: string; confidence?: number; reason?: string; signals?: string[];
    };

    const category = j.category as MailCategory;
    const action = j.action as MailAction;
    const confidence = typeof j.confidence === 'number' ? j.confidence : 0;

    // Garde-fous de sortie. Un verdict hors liste blanche, ou peu assuré, n'est
    // pas une erreur à corriger : c'est un mail qui revient à l'humain.
    const permises = ALLOWED[category];
    if (!permises || !permises.includes(action) || confidence < 0.7) {
      return {
        category: 'autre', action: 'none', confidence,
        reason: j.reason?.trim() || 'Je préfère te le passer, je ne suis pas sûr',
        detail: { llm: true, rejete: permises ? 'confiance insuffisante' : 'catégorie hors périmètre', propose: `${category}/${action}`, signals: j.signals },
        weak: true,
      };
    }

    return {
      category, action, confidence,
      reason: j.reason?.trim() || 'Classé après lecture du mail',
      detail: { llm: true, confidence, signals: j.signals ?? [], hint: input.hint?.category ?? null },
    };
  } catch {
    // Panne d'API, quota, JSON illisible : on ne bloque pas le tri, on garde le
    // verdict des règles. Le pire cas reste le comportement d'avant.
    return null;
  }
}
