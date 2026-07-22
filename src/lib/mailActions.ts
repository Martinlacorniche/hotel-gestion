// Gestionnaire de mails réception — Phase 2 : MOTEUR D'EXÉCUTION des actions.
//
// La Phase 1 CLASSE (dry-run). Ici on EXÉCUTE l'action proposée, sur validation
// humaine (bouton « Valider ») ou en auto une fois la catégorie prouvée fiable.
// Chaque action est une fonction isolée ; ce qui n'est pas encore câblé renvoie
// `blocked` (jamais d'effet de bord silencieux).
//
// ⚠️ Mews (déjà venu / tarif) n'existe QU'À LES VOILES (cfg.mews). Toute action qui
// veut enrichir via Mews DOIT être gated sur cfg.mews — La Corniche n'est pas sous Mews.

import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { moveMessage, createReplyDraft, getMessageText, getMessageHtml, listFileAttachments, forwardMessage, listInbox, searchMessages } from '@/lib/graphMailbox';
import { parseOtaResa, parseSwile, controlNote, cancellationNote, parseAgencyTakeover, parseGoelett, parseCds, parseCdsBooking, parseUvet, parseConferma, agencyTsBlock, shortRoom, ddmm, resaDiff, type AgencyTakeover, type OtaResa } from '@/lib/otaResa';
import { findGuest, hasPastStay, findReservation, cityTaxForReservation } from '@/lib/mews';
import { parsePreSejour, preSejourNote, preSejourFlags, isPreSejourActionable } from '@/lib/preSejour';
import { parseRooftopMail, normalizeHeure, normName } from '@/lib/rooftopMail';
import { receptionOnDuty } from '@/lib/onDuty';
import type { HotelMailConfig, MailCategory } from '@/lib/mailAssistant';

const LLM_MODEL = 'claude-sonnet-4-6';   // même modèle que /api/brief, /api/fiche-audit

export type ActionMode = 'off' | 'suggest' | 'auto';

// Catégories pilotables (on/off/auto) + leur mode par défaut. Tout démarre en
// 'suggest' (human-in-the-loop) : rien ne part en auto tant que Martin ne l'a pas décidé.
export const CATEGORY_MODES: MailCategory[] = [
  'spam_alert', 'resa_ota', 'resa_rooftop', 'facture', 'facture_interne', 'candidature', 'commercial', 'client_msg',
];
const DEFAULT_MODE: ActionMode = 'suggest';

// Mode courant par catégorie pour un hôtel (défaut 'suggest' si pas de ligne).
export async function getModes(hotelKey: string): Promise<Record<string, ActionMode>> {
  const { data } = await supabaseAdmin
    .from('assistant_mail_config')
    .select('category, mode')
    .eq('hotel_key', hotelKey);
  const out: Record<string, ActionMode> = {};
  for (const c of CATEGORY_MODES) out[c] = DEFAULT_MODE;
  for (const r of data ?? []) out[r.category as string] = r.mode as ActionMode;
  return out;
}

export async function setMode(hotelKey: string, category: string, mode: ActionMode): Promise<void> {
  await supabaseAdmin
    .from('assistant_mail_config')
    .upsert({ hotel_key: hotelKey, category, mode, updated_at: new Date().toISOString() },
      { onConflict: 'hotel_key,category' });
}

export type LogRow = {
  id: string;
  mailbox: string;
  message_id: string;
  from_addr: string | null;
  from_name: string | null;
  subject: string | null;
  category: string;
  proposed_action: string;
  detail: Record<string, unknown>;
};

export type ExecOutcome = {
  status: 'executed' | 'blocked';
  result?: Record<string, unknown>;
  error?: string;
};

// ── Actions câblées ─────────────────────────────────────────────────────────

// delete : mail inutile (alerte stock D-Edge, doublon) → corbeille (réversible).
async function actDelete(cfg: HotelMailConfig, row: LogRow): Promise<ExecOutcome> {
  await moveMessage(cfg.mailbox, row.message_id, 'deleteditems');
  return { status: 'executed', result: { movedTo: 'deleteditems' } };
}

// archive : à classer sans traitement (nos propres factures client Mews / Rooftop) → dossier
// Archive (réversible). Surtout PAS Pennylane. Martin 2026-07-09.
async function actArchive(cfg: HotelMailConfig, row: LogRow): Promise<ExecOutcome> {
  await moveMessage(cfg.mailbox, row.message_id, 'archive');
  return { status: 'executed', result: { movedTo: 'archive' } };
}

// Réponse type « nos effectifs sont au complet » — signée « La Direction / Hôtel <nom> ».
function candidatureHtml(nom: string): string {
  return (
    `<p>Bonjour,</p>` +
    `<p>Nous vous remercions de l’intérêt que vous portez à l’Hôtel ${nom} et de votre candidature, ` +
    `à laquelle nous avons prêté attention.</p>` +
    `<p>Nos effectifs sont actuellement au complet et nous ne sommes pas en mesure d’y donner une suite favorable. ` +
    `Nous conservons néanmoins votre candidature et reviendrons vers vous si une opportunité venait à se présenter.</p>` +
    `<p>Nous vous souhaitons une pleine réussite dans vos recherches.</p>` +
    `<p>Bien cordialement,<br/>La Direction — Hôtel ${nom}</p><br/>`
  );
}

// Réponse type aux relevés de commissions (Onyx CenterSource) : nos réservations ne sont pas
// commissionnables. Même réponse à chaque relevé (Martin 2026-07-10).
function nonCommissionableHtml(nom: string): string {
  return (
    `<p>Bonjour,</p>` +
    `<p>Nous accusons réception de votre relevé de commissions.</p>` +
    `<p>Après vérification, les réservations qui y figurent <strong>ne sont pas commissionnables</strong> : ` +
    `aucune commission n’est due à ce titre.</p>` +
    `<p>Nous vous remercions de bien vouloir clôturer ce relevé.</p>` +
    `<p>Bien cordialement,<br/>La Direction — Hôtel ${nom}</p><br/>`
  );
}

// draft_reply : crée un BROUILLON de réponse (rien n'est envoyé — l'humain relit/envoie).
// Câblé : candidature (template fixe) · relevé de commissions Onyx (template fixe, + le mail
// d'origine part à la corbeille : « répondre puis supprimer », Martin 2026-07-10 — le brouillon
// survit à la suppression de l'original, et la corbeille reste réversible).
// Message client (LLM) = pas encore câblé.
async function actDraftReply(cfg: HotelMailConfig, row: LogRow): Promise<ExecOutcome> {
  if (row.category === 'candidature' || row.detail?.template === 'effectifs_complets') {
    const d = await createReplyDraft(cfg.mailbox, row.message_id, candidatureHtml(cfg.nom));
    return { status: 'executed', result: { kind: 'candidature', draftId: d.draftId, webLink: d.webLink } };
  }
  if (row.category === 'commission_ota' || row.detail?.template === 'non_commissionable') {
    const d = await createReplyDraft(cfg.mailbox, row.message_id, nonCommissionableHtml(cfg.nom));
    await moveMessage(cfg.mailbox, row.message_id, 'deleteditems');
    return {
      status: 'executed',
      result: { kind: 'non_commissionable', draftId: d.draftId, webLink: d.webLink, movedTo: 'deleteditems' },
    };
  }
  return { status: 'blocked', error: 'Brouillon de réponse client non encore câblé (rédaction LLM à venir).' };
}

// resa_control : lit le mail D-Edge → parse la résa → (Voiles) enrichit « déjà venu »
// via Mews → produit une NOTE de contrôle à copier. AUCUN effet sortant (on ne classe
// ni ne déplace : « traiter d'abord, classer ensuite »). ⚠️ Mews gated sur cfg.mews.
async function actResaControl(cfg: HotelMailConfig, row: LogRow): Promise<ExecOutcome> {
  const body = await getMessageText(cfg.mailbox, row.message_id);
  // Swile a son propre format (pas D-Edge) → parseur dédié ; sinon parseur D-Edge/Booking.
  const isSwile = /swile/i.test(row.from_addr || '');
  const r = isSwile ? parseSwile(row.subject || '', body) : parseOtaResa(row.subject || '', body);

  // ANNULATION : pas de « déjà venu / TS » — on vérifie s'il faut FACTURER (hors délai).
  if (r.kind === 'annulation') {
    // ⚠️ LE DÉLAI N'EST JAMAIS DANS LE MAIL D'ANNULATION (vécu 2026-07-16, résa 7X6DYT) :
    // D-Edge y écrit seulement « Conditions d'annulation : Voir conditions d'annulation
    // Booking.com ». Sans lui, `isLateCancellation` ne tranche pas et la note disait
    // « délai à VÉRIFIER manuellement » — autant dire que personne ne vérifiait.
    // Or le délai EST dans le mail de RÉSERVATION INITIALE (« Le client pourra annuler
    // gratuitement jusqu'à N jour(s) avant l'arrivée »), qui vit toujours dans la boîte.
    // → on le retrouve par sa référence et on lui emprunte ce qui manque.
    let rr = r;
    if (r.freeCancelDaysBefore == null && r.ref) {
      try {
        const orig = (await searchMessages(cfg.mailbox, r.ref, 10)).find(
          (m) => m.id !== row.message_id && !/annulation/i.test(m.subject || ''),
        );
        if (orig) {
          const o = parseOtaResa(orig.subject || '', await getMessageText(cfg.mailbox, orig.id));
          rr = {
            ...r,
            freeCancelDaysBefore: o.freeCancelDaysBefore ?? r.freeCancelDaysBefore,
            refundable: r.refundable ?? o.refundable,
            penalty: r.penalty ?? o.penalty,
            firstNightAmount: r.firstNightAmount ?? o.firstNightAmount,
          };
        }
      } catch { /* recherche best-effort : on retombe sur « à vérifier manuellement » */ }
    }
    const note = cancellationNote(rr);
    return {
      status: 'executed',
      result: {
        kind: 'resa_cancel', note,
        // `depuisResaOrigine` dit à l'humain d'où vient le délai — utile s'il veut recouper.
        depuisResaOrigine: rr !== r && rr.freeCancelDaysBefore != null,
        resa: {
          ref: rr.ref, source: rr.source, guest: rr.guestName, arrival: rr.arrival,
          cancelDate: rr.cancelDateISO, freeCancelDaysBefore: rr.freeCancelDaysBefore,
          penalty: rr.penalty, firstNight: rr.firstNightAmount, payment: rr.payment, amount: rr.amount,
        },
      },
    };
  }

  // MODIFICATION : que s'est-il réellement passé ? D-Edge/Booking republient parfois la résa
  // À L'IDENTIQUE (vécu 2026-07-17, résa 1BI4XZ : seul l'en-tête du mail changeait). Faire
  // recontrôler une résa qui n'a pas bougé, c'est du travail pour rien — et à force, la
  // réception ne lit plus les modifs qui comptent vraiment.
  // → on retrouve la résa d'origine par sa réf (même méthode que pour le délai d'annulation)
  //   et on compare les CHAMPS PARSÉS. Diff vide ⇒ on classe sans déranger personne.
  //   Diff non vide ⇒ note normale, mais qui DIT ce qui a changé.
  let changed: string[] | null = null;
  if (r.kind === 'modification' && r.ref) {
    try {
      const orig = (await searchMessages(cfg.mailbox, r.ref, 10)).find(
        (m) => m.id !== row.message_id && !/modification|annulation/i.test(m.subject || ''),
      );
      if (orig) {
        const before = parseOtaResa(orig.subject || '', await getMessageText(cfg.mailbox, orig.id));
        changed = resaDiff(before, r);
        if (changed.length === 0) {
          await moveMessage(cfg.mailbox, row.message_id, 'archive');
          return {
            status: 'executed',
            result: {
              kind: 'resa_mod_noop', note: null,
              message: `Modification ${r.ref} sans aucun changement (comparée à la résa d’origine) → classée, rien à recontrôler.`,
              resa: { ref: r.ref, guest: r.guestName, arrival: r.arrival },
            },
          };
        }
      }
    } catch { /* best-effort : si l'origine est introuvable, on produit la note normale */ }
  }

  let dejaVenu: boolean | null = null;   // null = info indisponible (Corniche / Mews KO)
  let cityTax: number | null = null;     // TS exacte à encaisser sur place (VCC, Voiles)
  if (cfg.mews && r.guestLast) {
    try {
      const g = await findGuest(r.guestFirst, r.guestLast);
      dejaVenu = g ? await hasPastStay(g.id) : false;   // pas de profil Mews = 1er séjour
      // TS exacte : VCC (la carte virtuelle ne couvre pas la taxe) OU Swile prépayé (TS sur place).
      if (g && (r.payment === 'vcc' || r.source === 'Swile') && r.arrivalISO) {
        const resaId = await findReservation(g.id, r.arrivalISO);
        if (resaId) cityTax = (await cityTaxForReservation(resaId))?.amount ?? null;
      }
    } catch {
      dejaVenu = null;   // Mews indisponible : on ne bloque pas la note pour autant
    }
  }

  // Prise en charge agence sur la TS (prime sur « RSP TS ») : Djoca / Goelett / CDS-Ailleurs
  // Business → le bloc TS de la note vient de agencyTsBlock (cf otaResa).
  let tsOverride: string | null = null;
  if (r.payment === 'vcc' && r.guestLast) {
    const takeover = await findAgencyTakeover(cfg.mailbox, r.guestLast, r.arrivalISO).catch(() => null);
    if (takeover?.tsCovered) tsOverride = agencyTsBlock(takeover);
  }

  // Résas prises ensemble (mêmes dates + même canal + même horaire) → « AVEC <NOM> ».
  const linked = await findLinkedResas(cfg.mailbox, r).catch(() => []);

  let note = controlNote(r, dejaVenu, cityTax, tsOverride, linked);
  // Vraie modification : dire CE QUI a changé, sinon la réception doit rejouer la comparaison
  // à la main entre deux mails quasi identiques.
  if (changed?.length) note += ` · MODIF : ${changed.join(', ')}`;
  // Swile transmet des demandes voyageur (arrivée tardive, parking…) → à signaler à la réception,
  // qui devra répondre (Swile relaie la réponse au voyageur). Rappel : ne rien réclamer au client.
  if (r.source === 'Swile') {
    note += ' · NE RIEN RÉCLAMER (chambre prépayée)';
    if (r.specialRequests) note += ` · ⚠️ DEMANDES VOYAGEUR : ${r.specialRequests} → RÉPONDRE`;
  }
  return {
    status: 'executed',
    result: {
      kind: 'resa_control', note, dejaVenu, cityTax, linked,
      resa: {
        ref: r.ref, source: r.source, guest: r.guestName, arrival: r.arrival, departure: r.departure,
        nights: r.nights, guests: r.guests, room: r.roomType, amount: r.amount,
        ratePlan: r.ratePlan, refundable: r.refundable, payment: r.payment,
        vccChargeableFrom: r.vccChargeableFrom, genius: r.genius,
      },
    },
  };
}

// commercial_followup : capture + PRÉ-QUALIF + RELANCE (Martin 2026-07-05).
//  1) crée/complète une fiche suivi_commercial (CRM) ;
//  2) repère ce qui MANQUE (dates, nb participants, budget, prestation) et prépare un
//     BROUILLON qui pose ces questions au prospect (à valider avant envoi) ;
//  3) pose date_relance = aujourd'hui + RELANCE_DAYS pour ressortir le lead sans réponse.
const RELANCE_DAYS = 3;

type LeadIssue = 'nouvelle_demande' | 'refus' | 'confirmation' | 'autre';

type Lead = {
  issue?: LeadIssue; motif_perte?: string;
  nom_client?: string; societe?: string; telephone?: string; titre_demande?: string;
  date_evenement?: string; nb_personnes?: string; budget_estime?: number;
  resume?: string; missing?: string[]; draft_html?: string;
};

// Un seul appel LLM : ISSUE du mail + champs extraits + infos manquantes + brouillon adapté.
//
// Pourquoi le LLM et pas une regex pour l'issue (Martin 2026-07-10) : un mot-clé se trompe.
// « devis » suffisait à déclencher la pré-qualif + une relance à J+3 — y compris sur le mail où
// Céline Grosso (Biogroup) nous annonçait qu'elle retenait une AUTRE proposition. On relançait
// une cliente qui venait de dire non. L'issue se lit dans le sens du mail, pas dans ses mots.
async function qualifyLead(subject: string, body: string, hotelName: string): Promise<Lead> {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: LLM_MODEL, max_tokens: 1100,
    messages: [{
      role: 'user',
      content:
        `Tu es l'assistant commercial de l'Hôtel ${hotelName}. Analyse ce mail ` +
        `(séminaire / groupe / devis / privatisation) et réponds en JSON STRICT (rien autour), clés :\n` +
        `- issue : "nouvelle_demande" (le client demande ou relance), "refus" (il décline notre ` +
        `offre / retient un concurrent / annule), "confirmation" (il accepte), ou "autre"\n` +
        `- motif_perte : SI issue="refus", la raison en une phrase courte (ex. "salle de réunion ` +
        `trop petite pour le nombre d'invités"), sinon omets\n` +
        `- nom_client, societe, telephone (si présents)\n` +
        `- titre_demande : résumé court de la demande\n` +
        `- date_evenement : "yyyy-mm-dd" si une date précise est donnée, sinon omets\n` +
        `- nb_personnes : le nombre de participants si donné (texte), sinon omets\n` +
        `- budget_estime : nombre en € si donné, sinon omets\n` +
        `- resume : 2 phrases max pour la fiche CRM\n` +
        `- missing : SI issue="nouvelle_demande", les infos MANQUANTES à demander (parmi : dates ` +
        `exactes, nombre de participants, budget indicatif, type de prestation, restauration, ` +
        `hébergement) ; sinon liste vide\n` +
        `- draft_html : un brouillon de réponse en français. Si issue="refus" : remercier, ` +
        `accuser réception sans insister ni renégocier, et laisser la porte ouverte pour une ` +
        `prochaine fois. Sinon : remercier et poser UNIQUEMENT les questions de "missing". ` +
        `PAS de signature (ajoutée après). Balises <p>/<ul><li> autorisées.\n\n` +
        `Sujet: ${subject}\n\n${body.slice(0, 6000)}`,
    }],
  });
  const text = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()) as Lead; }
  catch { return { resume: text.slice(0, 400) }; }
}

// Le prospect décline : on CLÔT la fiche (statut Refus + motif) et on ANNULE la relance —
// sinon le lead perdu ressort dans /commercial trois jours plus tard. Brouillon de réponse
// courtoise à relire (Martin 2026-07-10). Aucune fiche existante → on ne crée rien : un refus
// sans dossier n'a rien à tracer, on rend la main à l'humain.
async function handleRefus(
  cfg: HotelMailConfig, row: LogRow, lead: Lead, email: string | null, today: string,
): Promise<ExecOutcome> {
  if (!email) return { status: 'blocked', error: 'Refus détecté mais expéditeur inconnu.' };

  const { data } = await supabaseAdmin
    .from('suivi_commercial').select('id, commentaires')
    .eq('hotel_id', cfg.hotelId).ilike('email', email).limit(1);
  if (!data?.length) {
    return { status: 'blocked', error: `Refus détecté (${lead.motif_perte || 'motif non lu'}) mais aucune fiche pour ${email}.` };
  }

  const motif = (lead.motif_perte || '').slice(0, 300) || null;
  // Note EN TÊTE : l'équipe écrit ses commentaires du plus récent au plus ancien.
  const note = `${today.slice(8, 10)}/${today.slice(5, 7)} refus : ${motif || 'autre proposition retenue'} - Junior`;
  const merged = [note, data[0].commentaires].filter(Boolean).join('\n');

  const { error } = await supabaseAdmin.from('suivi_commercial').update({
    statut: 'Refus', motif_perte: motif, date_relance: null, commentaires: merged.slice(0, 4000),
  }).eq('id', data[0].id);
  if (error) return { status: 'blocked', error: `MAJ suivi_commercial: ${error.message}` };

  // Réponse CLIENT → signée par la personne en shift (cf reference_signature_htbm).
  let draft: { draftId: string; webLink: string } | null = null;
  if (lead.draft_html) {
    const duty = await receptionOnDuty(cfg.hotelId).catch(() => null);
    const sig = `<br/><p>Bien à vous,<br/>${duty?.name || 'La Réception'}<br/>Hôtel ${cfg.nom}</p>`;
    draft = await createReplyDraft(cfg.mailbox, row.message_id, `${lead.draft_html}${sig}`).catch(() => null);
  }
  return {
    status: 'executed',
    result: { kind: 'commercial', mode: 'refus', id: data[0].id, motif_perte: motif, ...(draft || {}) },
  };
}

async function actCommercialFollowup(cfg: HotelMailConfig, row: LogRow): Promise<ExecOutcome> {
  if (!process.env.ANTHROPIC_API_KEY) return { status: 'blocked', error: 'Clé Anthropic absente (qualification impossible).' };
  const body = await getMessageText(cfg.mailbox, row.message_id);
  const lead = await qualifyLead(row.subject || '', body, cfg.nom);
  const email = row.from_addr || null;
  const today = new Date().toISOString().slice(0, 10);

  // Le client décline → surtout PAS la pré-qualif ni la relance à J+3.
  if (lead.issue === 'refus') return await handleRefus(cfg, row, lead, email, today);

  const relance = new Date(Date.now() + RELANCE_DAYS * 24 * 3600e3).toISOString().slice(0, 10);
  const missing = Array.isArray(lead.missing) ? lead.missing : [];
  const stampedNote = [
    `[${today}] Demande reçue par mail : ${lead.resume || row.subject || ''}`,
    missing.length ? `À qualifier : ${missing.join(', ')}.` : 'Complet à première lecture.',
  ].join(' ').slice(0, 1000);

  // Brouillon de pré-qualif (si des infos manquent) — reste dans Brouillons, rien n'est envoyé.
  let draft: { draftId: string; webLink: string } | null = null;
  if (missing.length && lead.draft_html) {
    const sig = `<br/><p>Bien à vous,<br/>Service commercial — Hôtel ${cfg.nom}</p>`;
    draft = await createReplyDraft(cfg.mailbox, row.message_id, `${lead.draft_html}${sig}`).catch(() => null);
  }

  // Fiche existante ? (même email, même hôtel) → on complète + reprogramme la relance.
  if (email) {
    const { data } = await supabaseAdmin
      .from('suivi_commercial').select('id, commentaires').eq('hotel_id', cfg.hotelId).ilike('email', email).limit(1);
    if (data && data.length) {
      const merged = [data[0].commentaires, stampedNote].filter(Boolean).join('\n');
      await supabaseAdmin.from('suivi_commercial')
        .update({ commentaires: merged, date_relance: relance }).eq('id', data[0].id);
      return { status: 'executed', result: { kind: 'commercial', mode: 'updated', id: data[0].id, missing, ...(draft || {}), lead } };
    }
  }

  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(lead.date_evenement || '') ? lead.date_evenement : null;
  const budget = typeof lead.budget_estime === 'number' && isFinite(lead.budget_estime) ? lead.budget_estime : null;
  const { data: ins, error } = await supabaseAdmin.from('suivi_commercial').insert({
    nom_client: lead.nom_client || row.from_name || email || 'Contact mail',
    email, telephone: lead.telephone || null, societe: lead.societe || null,
    titre_demande: lead.titre_demande || row.subject || null,
    date_evenement: isoDate, budget_estime: budget,
    statut: 'Nouveau', source: 'Email réception', hotel_id: cfg.hotelId,
    commentaires: stampedNote, date_relance: relance,
  }).select('id').single();
  if (error) return { status: 'blocked', error: `Insert suivi_commercial: ${error.message}` };
  return { status: 'executed', result: { kind: 'commercial', mode: 'created', id: ins?.id, missing, ...(draft || {}), lead } };
}

// route_pennylane : lit l'entité FACTURÉE dans le PDF (bloc « facturé à », pas l'adresse)
// et transfère la facture à la boîte Pennylane fournisseurs de cette entité. ENVOI SORTANT
// (garder en mode 'suggest'). Entité ambiguë → bloqué (routage manuel).
const PENNYLANE_SUPPLIERS: Record<'voiles' | 'suere' | 'dream_team', string> = {
  voiles: 'les-voiles-ot48ibrs@suppliers.pennylane.com',
  suere: 'sarl-suere-lv9e6urz@suppliers.pennylane.com',
  dream_team: 'dream-team-q1hyns7f@suppliers.pennylane.com',
};

async function detectBilledEntity(pdfBase64: string): Promise<'voiles' | 'suere' | 'dream_team' | 'inconnu'> {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: LLM_MODEL, max_tokens: 40,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text:
          `Lis le bloc DESTINATAIRE / « facturé à » de cette facture (PAS l'adresse du lieu). ` +
          `Quelle entité juridique est facturée ? Identités : ` +
          `voiles = SAS LES VOILES (SIRET 795063304) ; suere = SARL SUERE (exploitante BW La Corniche) ; ` +
          `dream_team = SAS DREAM TEAM (SIRET 90186088200025 ou 813487899). ` +
          `RÉPONDS UNIQUEMENT par le code exact (voiles, suere, dream_team ou inconnu), sans aucune phrase ni ponctuation.` },
      ],
    }],
  });
  const t = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('').toLowerCase();
  if (/dream/.test(t)) return 'dream_team';
  if (/suere/.test(t)) return 'suere';
  if (/voiles/.test(t)) return 'voiles';
  return 'inconnu';
}

async function actRoutePennylane(cfg: HotelMailConfig, row: LogRow): Promise<ExecOutcome> {
  if (!process.env.ANTHROPIC_API_KEY) return { status: 'blocked', error: 'Clé Anthropic absente (lecture PDF impossible).' };
  const atts = await listFileAttachments(cfg.mailbox, row.message_id);
  const pdf = atts.find((a) => /pdf/i.test(a.contentType) || /\.pdf$/i.test(a.name));
  if (!pdf || !pdf.contentBytes) return { status: 'blocked', error: 'Aucune facture PDF exploitable en pièce jointe.' };

  const entity = await detectBilledEntity(pdf.contentBytes);
  if (entity === 'inconnu') return { status: 'blocked', error: 'Entité facturée non identifiée dans le PDF — router à la main.' };

  const address = PENNYLANE_SUPPLIERS[entity];
  await forwardMessage(cfg.mailbox, row.message_id, address,
    `Facture transférée pour comptabilisation (routage assistant réception — entité: ${entity}).`);
  return { status: 'executed', result: { kind: 'pennylane', entity, address, attachment: pdf.name } };
}

// livraison_consigne : lit le bon de commande Cuisine Solutions (PDF) pour en extraire la DATE
// DE LIVRAISON + le contenu, et crée une consigne datée du jour de livraison (contrôle réception,
// chaîne du froid). Écriture DB uniquement (aucun envoi sortant) ; pattern hérité de teloConsigne.
type Livraison = { date: string | null; surgele: boolean; produits: string; total: string | null; commande: string | null };

async function extractLivraison(pdfBase64: string): Promise<Livraison> {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: LLM_MODEL, max_tokens: 500,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text:
          `Bon de commande / livraison fournisseur. Renvoie UNIQUEMENT un JSON compact, sans texte autour : ` +
          `{"date":"AAAA-MM-JJ","surgele":true,"produits":["<désignation> ×<qté colis>"],"total_ht":"<montant €>","commande":"<n°>"}. ` +
          `"date" = la DATE DE LIVRAISON (« Livré le »), PAS la date de commande ; null si absente. ` +
          `"surgele" = true si le bon mentionne surgelé / STEF / -20°C / froid négatif. ` +
          `"produits" = liste courte des articles (désignation + nb de colis). Aucune autre clé.` },
      ],
    }],
  });
  const t = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
  try {
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(j.date || '') ? j.date : null,
      surgele: !!j.surgele,
      produits: Array.isArray(j.produits) ? j.produits.slice(0, 12).join(' · ') : '',
      total: typeof j.total_ht === 'string' && j.total_ht.trim() ? j.total_ht.trim() : null,
      commande: j.commande ? String(j.commande) : null,
    };
  } catch {
    return { date: null, surgele: false, produits: '', total: null, commande: null };
  }
}

function livraisonConsigneText(l: Livraison): string {
  const lignes = [
    `🧊 LIVRAISON CUISINE SOLUTIONS${l.commande ? ` — cmd n°${l.commande}` : ''}${l.surgele ? ' (surgelé -20°C)' : ''}. À réceptionner ce jour.`,
    l.surgele ? '⚠️ Contrôler la chaîne du froid (produits -20°C) et ranger au congélateur sans attendre.' : null,
    l.produits ? `Contenu : ${l.produits}.` : null,
    l.total ? `Total ${l.total}.` : null,
    'Vérifier quantités & températures contre le bon de commande.',
  ].filter(Boolean);
  return lignes.join('\n');
}

async function actLivraisonConsigne(cfg: HotelMailConfig, row: LogRow): Promise<ExecOutcome> {
  if (!process.env.ANTHROPIC_API_KEY) return { status: 'blocked', error: 'Clé Anthropic absente (lecture du bon de commande impossible).' };
  const atts = await listFileAttachments(cfg.mailbox, row.message_id);
  const pdf = atts.find((a) => /pdf/i.test(a.contentType) || /\.pdf$/i.test(a.name));
  if (!pdf || !pdf.contentBytes) return { status: 'blocked', error: 'Aucun bon de commande PDF exploitable en pièce jointe.' };

  const info = await extractLivraison(pdf.contentBytes);
  if (!info.date) return { status: 'blocked', error: 'Date de livraison non lue dans le bon — consigne à créer à la main.' };

  // Anti-doublon : une seule consigne de livraison par jour × hôtel (le mail peut être rejoué,
  // ou relayé par plusieurs personnes). Même garde-fou que teloConsigne.
  const { data: existantes } = await supabaseAdmin
    .from('consignes').select('id, texte').eq('hotel_id', cfg.hotelId).eq('date_creation', info.date);
  const doublon = (existantes || []).find((c: { texte: string | null }) => /cuisine solutions|livraison/i.test(c.texte || ''));
  if (doublon) return { status: 'executed', result: { kind: 'livraison', mode: 'doublon', date: info.date } };

  const { data: ins, error } = await supabaseAdmin.from('consignes').insert({
    texte: livraisonConsigneText(info), auteur: 'Junior', date_creation: info.date, hotel_id: cfg.hotelId, valide: false,
  }).select('id').single();
  if (error) return { status: 'blocked', error: `Insert consigne: ${error.message}` };
  return { status: 'executed', result: { kind: 'livraison', mode: 'created', id: ins?.id, date: info.date, surgele: info.surgele, fournisseur: 'Cuisine Solutions' } };
}

// Cherche une prise en charge agence (Djoca) dans la boîte, pour le client + l'arrivée
// d'une résa. Sert à corriger la TS de la note résa (agence couvre la TS).
async function findAgencyTakeover(
  mailbox: string, guestLast: string, arrivalISO: string | null,
): Promise<AgencyTakeover | null> {
  const inbox = await listInbox(mailbox, 40);
  const cands = inbox.filter((m) =>
    /djocatravel/i.test(m.fromAddr) || /goelett/i.test(m.fromAddr) || /ailleursbusiness|cdsgroupe/i.test(m.fromAddr)
    || /prise en charge/i.test(m.subject) || /paiement pour .+ pour la r[ée]servation/i.test(m.subject)
    || /prestations compl[ée]mentaires/i.test(m.subject));
  for (const m of cands) {
    const body = await getMessageText(mailbox, m.id).catch(() => '');
    const t = parseTakeover(m.fromAddr, m.subject, body);
    const nameOk = t.guestLast && t.guestLast.toLowerCase() === guestLast.toLowerCase();
    const dateOk = !arrivalISO || !t.checkInISO || t.checkInISO === arrivalISO;
    if (nameOk && dateOk) return t;
  }
  return null;
}

// Deux résas prises ENSEMBLE : « mêmes dates, même canal de réservation et même horaire de
// réservation = sûrement ensemble » (Martin 2026-07-10). Cas vécu : 2 chambres Expedia posées
// à 2 min d'intervalle pour un même déplacement pro (Michou / Abitbol, 29→31/07).
//
// ⚠️ Les trois signaux sont exigés ENSEMBLE. Les mêmes dates seules ne prouvent rien — dans un
// hôtel, deux clients sans rapport réservent les mêmes nuits tous les jours. Écrire le nom d'un
// client sur la note d'un autre par erreur serait pire que de ne rien signaler.
const LINK_WINDOW_MIN = 30;

async function findLinkedResas(mailbox: string, r: OtaResa): Promise<string[]> {
  if (!r.arrivalISO || !r.departureISO || !r.bookedAtISO || !r.source) return [];

  const booked = new Date(r.bookedAtISO).getTime();
  if (Number.isNaN(booked)) return [];

  const inbox = await listInbox(mailbox, 40);
  const noms: string[] = [];
  for (const m of inbox) {
    if (!/nouvelle réservation/i.test(m.subject)) continue;
    const other = parseOtaResa(m.subject, await getMessageText(mailbox, m.id).catch(() => ''));
    if (!other.ref || other.ref === r.ref) continue;              // pas soi-même
    if (other.source !== r.source) continue;                       // même canal
    if (other.arrivalISO !== r.arrivalISO) continue;               // mêmes dates
    if (other.departureISO !== r.departureISO) continue;
    if (!other.bookedAtISO) continue;
    const t = new Date(other.bookedAtISO).getTime();
    if (Number.isNaN(t) || Math.abs(t - booked) > LINK_WINDOW_MIN * 60_000) continue;  // même horaire
    if (other.guestName) noms.push(other.guestName);
  }
  return noms;
}

// CDS enveloppe ses liens dans un tracker `link-email.cdsgroupe.com/c?q=<base64url>` qui encode
// une structure binaire contenant l'URL cible en clair (après « aHR0cHM » = "https"). On décode
// pour retrouver l'URL directe — plus fiable que de suivre le tracker (dont le q se tronque à
// l'extraction HTML). Renvoie null si ce n'est pas un tracker décodable.
function decodeCdsTracker(href: string): string | null {
  const q = href.match(/[?&]q=([^&"']+)/)?.[1];
  if (!q) return null;
  const i = q.indexOf('aHR0cHM');   // base64url de "https"
  if (i < 0) return null;
  try {
    const dec = Buffer.from(q.slice(i), 'base64url').toString('utf8');
    return dec.match(/https?:\/\/[^\s"']+/)?.[0] || null;
  } catch { return null; }
}

// Confirme la réception d'une résa CDS « payé par Booking » en visitant le lien
// « SecuriseBookingFromMail » du mail (sinon CDS relance tous les jours). AUCUN paiement n'est
// déclenché — c'est un simple accusé de réception côté CDS. On cible précisément ce lien (pas
// « signaler une anomalie » ni « booking issues »).
async function confirmCdsBookingReceipt(mailbox: string, messageId: string): Promise<{ confirmed: boolean; url: string | null }> {
  const html = await getMessageHtml(mailbox, messageId).catch(() => '');
  const hrefs = [...html.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]);
  let target: string | null = null;
  for (const h of hrefs) {
    if (/SecuriseBookingFromMail/i.test(h)) { target = h; break; }
    if (/link-email\.cdsgroupe\.com/i.test(h)) {
      const dec = decodeCdsTracker(h);
      if (dec && /SecuriseBookingFromMail/i.test(dec)) { target = dec; break; }
    }
  }
  if (!target) return { confirmed: false, url: null };
  try {
    const res = await fetch(target, { redirect: 'follow' });
    const txt = await res.text().catch(() => '');
    return { confirmed: res.ok && /success|confirm/i.test(txt), url: target };
  } catch { return { confirmed: false, url: target }; }
}

// Choisit le bon parser d'après l'expéditeur/sujet (Djoca / Goelett / CDS-Ailleurs Business).
function parseTakeover(fromAddr: string, subject: string, body: string): AgencyTakeover {
  if (/goelett/i.test(fromAddr) || /goelett/i.test(subject)) return parseGoelett(subject, body);
  // Variante `bookings@cdsgroupe` « rappel de paiement / payé par Booking » = confirmer réception,
  // RIEN à débiter — à distinguer d'Ailleurs Business (carte agence à débiter).
  if (/bookings@cdsgroupe/i.test(fromAddr) && /rappel de paiement|pay[ée]e? par booking|confirmer la r[ée]ception/i.test(`${subject} ${body}`))
    return parseCdsBooking(subject, body);
  if (/ailleursbusiness|cdsgroupe/i.test(fromAddr) || /prestations compl[ée]mentaires/i.test(subject)) return parseCds(subject, body);
  // UVET GBT : parseur dédié, sinon on retomberait sur le parseur Djoca ci-dessous et la note
  // serait fausse (erreur déjà commise sur Goelett le 2026-07-07).
  if (/@uvetgbt\.com/i.test(fromAddr) && /confirmation nr/i.test(subject)) return parseUvet(subject, body);
  // Conferma Connect : idem, parseur dédié OBLIGATOIRE (règle d'or maison — jamais d'agency_note
  // sans le parseur de l'agence : le fallback Djoca ci-dessous inventerait « Djocatravel », sans
  // montant ni plafond de préautorisation, et surtout perdrait l'avertissement « carte bloquée »).
  if (/@conferma\.com/i.test(fromAddr)) return parseConferma(subject, body);
  return parseAgencyTakeover(subject, body);
}

// agency_note : prise en charge agence (Djoca) → note pour l'équipe (carte à débiter à
// l'arrivée, ce que l'agence couvre). Aucun n° de carte complet stocké (4 derniers max).
async function actAgencyNote(cfg: HotelMailConfig, row: LogRow): Promise<ExecOutcome> {
  const body = await getMessageText(cfg.mailbox, row.message_id);
  const t = parseTakeover(row.from_addr || '', row.subject || '', body);

  const parts: string[] = [];
  // Variante CDS « payé par Booking » : rien à débiter, juste confirmer la réception (sinon
  // relance quotidienne). On relie la réf CDS à la résa Booking et la société donneuse d'ordre.
  if (t.provider === 'cds_booking') {
    // Confirme la réception côté CDS (stoppe les relances quotidiennes). Sans effet sur un paiement.
    const conf = await confirmCdsBookingReceipt(cfg.mailbox, row.message_id).catch(() => ({ confirmed: false, url: null as string | null }));
    const bits = [`📌 CDS${t.ref ? ` ${t.ref}` : ''}`];
    if (t.guestName) bits.push(t.guestName);
    if (t.company) bits.push(`(${t.company})`);
    if (t.checkInISO) bits.push(`arr ${ddmm(t.checkInISO)}`);
    bits.push('PAYÉ PAR BOOKING — RIEN À DÉBITER');
    if (t.bookingRef) bits.push(`résa Booking ${t.bookingRef}`);
    bits.push(conf.confirmed ? '✅ réception confirmée à CDS (relances stoppées)' : '⚠️ réception NON confirmée — cliquer le lien du mail');
    return {
      status: 'executed',
      result: { kind: 'agency_note', note: bits.join(' · '), agency: t.agency, ref: t.ref, bookingRef: t.bookingRef, guest: t.guestName, company: t.company, tsCovered: false, cdsConfirmed: conf.confirmed, cdsConfirmUrl: conf.url },
    };
  }
  if (t.provider === 'goelett' || t.provider === 'cds') {
    // Note RÉCEPTION en codes courts (Martin 2026-07-07) : la chambre est sur CCV (Booking),
    // la TS sur la carte agence (Goelett = 2e CCV last-4 ; CDS = carte derrière un lien).
    // Le tarif FLEX/NANR + GENIUS + 1er séjour vivent dans le mail résa D-Edge (pas ici) →
    // complétés au lien résa↔agence. Facturation (invoiceTo) gardée en détail, pas dans la note.
    const note = `#${shortRoom(t.room)} CCV # / ${agencyTsBlock(t)}`.replace(/\s+/g, ' ').trim();
    return {
      status: 'executed',
      result: { kind: 'agency_note', note, agency: t.agency, ref: t.ref, bookingRef: t.bookingRef, guest: t.guestName, cardLast4: t.cardLast4, tsCovered: true, tsAmount: t.tsAmount, invoiceTo: t.invoiceTo },
    };
  }
  if (t.provider === 'conferma') {
    // Conferma/CWT : carte virtuelle DANS le mail, le client ne l'a pas. Le piège du canal est
    // la PRÉAUTORISATION : au-delà du plafond annoncé (1 €), la carte se BLOQUE — c'est
    // invisible pour un réceptionniste, donc ça passe en tête de note, avant tout le reste.
    const bits = [`📌 PEC ${t.agency}`];
    if (t.guestName) bits.push(t.guestName);
    if (t.checkInISO) bits.push(`arr ${ddmm(t.checkInISO)}${t.nights ? ` · ${t.nights} nuit${t.nights > 1 ? 's' : ''}` : ''}`);
    if (t.totalAmount) bits.push(t.totalAmount);
    // Le n° n'est pas dans le mail : on envoie la réception au bon endroit plutôt que de la
    // laisser chercher (« Afficher dans le navigateur » ouvre la carte).
    bits.push('DÉBITER LA CARTE AGENCE — derrière le lien « Afficher dans le navigateur » du mail (le client ne l’a pas)');
    if (t.preAuthMaxEur != null) {
      bits.push(`⚠️ PRÉAUTO ${t.preAuthMaxEur} € MAX et PAS de code de préauto — au-delà la carte se BLOQUE`);
    }
    // La carte ne couvre que la chambre : le reste (dont la taxe de séjour) est encaissé au départ.
    bits.push('RSP TS + extras au départ');
    // Le canal se referme sur lui-même : le mail Conferma porte AUSSI le lien de dépôt de la
    // facture — c'est la réponse aux « CWT guest requires invoice » qui arrivent par Expedia.
    bits.push('FACTURE À DÉPOSER via le lien « Charger la facture » du mail');
    return {
      status: 'executed',
      result: {
        kind: 'agency_note', note: bits.join(' · '), agency: t.agency, ref: t.ref,
        guest: t.guestName, nights: t.nights, cardLast4: t.cardLast4, company: t.company,
        preAuthMaxEur: t.preAuthMaxEur, amount: t.totalAmount, tsCovered: false,
      },
    };
  }
  if (t.provider === 'uvet') {
    // UVET : la carte n'est ni dans le corps ni derrière un lien — elle est dans une PJ PDF
    // (`CreditCard_<réf>.pdf`) → on renvoie la réception vers la PJ, pas vers « le mail ».
    // L'urgence est portée dans la note : la fenêtre d'accès se ferme à J+2 après le départ.
    const bits = [`📌 PEC UVET GBT`];
    if (t.guestName) bits.push(t.guestName);
    if (t.checkInISO) bits.push(`arr ${ddmm(t.checkInISO)}${t.nights ? ` · ${t.nights} nuit${t.nights > 1 ? 's' : ''}` : ''}`);
    if (t.ref) bits.push(`réf ${t.ref}${t.bookingRef ? ` (${t.bookingRef})` : ''}`);
    bits.push('DÉBITER LA CARTE AGENCE — PDF « CreditCard_… » en PJ du mail');
    bits.push('⚠️ carte accessible jusqu’à J+2 après le départ seulement — ne pas laisser traîner');
    return {
      status: 'executed',
      result: { kind: 'agency_note', note: bits.join(' · '), agency: t.agency, ref: t.ref, bookingRef: t.bookingRef, guest: t.guestName, nights: t.nights, tsCovered: false },
    };
  }
  {
    parts.push(`📌 PRISE EN CHARGE ${t.agency}`);
    if (t.guestName) parts.push(t.guestName);
    if (t.checkInISO) parts.push(`arr ${ddmm(t.checkInISO)}`);
    if (t.room) parts.push(t.room);
    parts.push(`DÉBITER LA CARTE AGENCE${t.cardLast4 ? ` ···${t.cardLast4}` : ''} à l’arrivée${t.debitAtArrival ? ' (pas de pré-auto)' : ''} — n° dans le mail`);
    if (t.tsCovered) parts.push('TS incluse — NE PAS facturer au client');
  }
  return {
    status: 'executed',
    result: { kind: 'agency_note', note: parts.join(' · '), agency: t.agency, ref: t.ref, bookingRef: t.bookingRef, guest: t.guestName, cardLast4: t.cardLast4, tsCovered: t.tsCovered, tsAmount: t.tsAmount },
  };
}

// invoice_note : un OTA (Hotelbeds…) réclame la facture d'une résa → produit une note
// « facture à envoyer » à coller sur la résa (aucun effet sortant). Corniche ni Voiles Mews.
async function actInvoiceNote(_cfg: HotelMailConfig, row: LogRow): Promise<ExecOutcome> {
  const ota = (row.detail?.ota as string) || 'OTA';
  const ref = (row.detail?.ref as string)
    || (row.subject || '').match(/Ref\.?\s*([0-9][0-9A-Za-z-]{4,})/i)?.[1] || '';
  // Un message de voyageur Expedia ne porte NI réf de résa NI dates — seulement le nom
  // (« CWT guest requires invoice »). Sans le nom, la note serait inexploitable.
  const guest = (row.detail?.guest as string) || '';
  const qui = ref ? ` — résa ${ref}` : guest ? ` — ${guest}` : '';
  let note = `📄 FACTURE À ENVOYER à ${ota}${qui}`;
  // Cas CWT/Conferma : le voyageur réclame la facture VIA Expedia, mais elle ne s'envoie pas
  // par mail — elle se DÉPOSE sur le lien « Charger la facture » du mail Conferma de la même
  // résa. Sans ce rappel, on demande à la réception d'envoyer une facture sans lui dire où.
  if (row.detail?.cwt) {
    note += ' · CWT → déposer via le lien « Charger la facture » du mail Conferma de cette résa';
  }
  return { status: 'executed', result: { kind: 'invoice_note', note, ota, ref, guest } };
}

// presejour_check : le client a rempli le formulaire pré-séjour (LoungeUp). On le LIT.
//   · il porte une demande (attente particulière, PDJ, late check-out, facture entreprise,
//     heure d'arrivée hors 15 h) -> note pour la réception, et le mail reste (il sera classé
//     une fois la demande traitée : « traiter d'abord, classer ensuite »).
//   · il ne porte qu'une enquête marketing (distance, transport, motif) -> corbeille.
// Martin 2026-07-13 : « on vérifie les pré-séjour si il y a une info importante, le reste ça dégage ».
async function actPreSejour(cfg: HotelMailConfig, row: LogRow): Promise<ExecOutcome> {
  const body = await getMessageText(cfg.mailbox, row.message_id);
  const p = parsePreSejour(body);

  if (!isPreSejourActionable(p)) {
    await moveMessage(cfg.mailbox, row.message_id, 'deleteditems');
    return {
      status: 'executed',
      result: { kind: 'presejour_empty', movedTo: 'deleteditems', guest: p.guest, room: p.room },
    };
  }

  return {
    status: 'executed',
    result: {
      kind: 'presejour_note',
      note: preSejourNote(p),
      flags: preSejourFlags(p),
      guest: p.guest, room: p.room, arrival: p.arrival, resaRef: p.resaRef,
    },
  };
}

// rooftop_check : la vitrine notifie chaque résa Rooftop à la réception, ce qui DOUBLE le plan
// de salle de l'onglet Service. Martin 2026-07-16 : « si la résa est dans l'app correctement
// alors on supprime » → on réconcilie le mail avec `rooftop_reservations` AVANT de supprimer.
//   · trouvée et concordante        -> corbeille (le mail n'apprend rien à personne)
//   · absente, ou champs divergents -> BLOQUÉ + note : c'est le seul témoin d'une résa perdue
// ⚠️ Pas de suppression sur le seul critère de l'expéditeur : côté vitrine l'insert en base
// (RPC `rooftop_book`, client) et l'envoi du mail (route API) sont deux chemins indépendants —
// le `fetch` de notification est même en `.catch(() => {})`.
async function actRooftopCheck(cfg: HotelMailConfig, row: LogRow): Promise<ExecOutcome> {
  const body = await getMessageText(cfg.mailbox, row.message_id);
  const p = parseRooftopMail(row.subject || '', body);

  if (!p.nom || !p.dateISO) {
    return { status: 'blocked', error: 'Mail Rooftop illisible (nom ou date absents) — à regarder à la main.' };
  }

  const { data, error } = await supabaseAdmin
    .from('rooftop_reservations')
    .select('id, nom, date_resa, heure, couverts, statut, telephone')
    .eq('hotel_id', cfg.hotelId)
    .eq('date_resa', p.dateISO);
  if (error) return { status: 'blocked', error: `Lecture rooftop_reservations : ${error.message}` };

  const match = (data || []).find((r) => normName(r.nom) === normName(p.nom));
  if (!match) {
    return {
      status: 'blocked',
      error: `⚠️ Résa Rooftop ABSENTE de l’app : ${p.nom} · ${p.dateISO} ${p.heure ?? ''} · ${p.couverts ?? '?'} couv.` +
        ` — à saisir dans l’onglet Service (tél. ${p.telephone ?? '—'}).`,
    };
  }

  // Divergences : l'heure et le nombre de couverts doivent coller. La TABLE n'est pas un critère
  // (l'équipe la réattribue légitimement depuis le plan de salle), le statut non plus (une résa
  // annulée après coup reste « correctement dans l'app »).
  const ecarts: string[] = [];
  if (p.heure && normalizeHeure(match.heure) !== p.heure) ecarts.push(`heure mail ${p.heure} ≠ app ${match.heure}`);
  if (p.couverts && match.couverts !== p.couverts) ecarts.push(`couverts mail ${p.couverts} ≠ app ${match.couverts}`);
  if (ecarts.length) {
    return { status: 'blocked', error: `⚠️ Résa Rooftop divergente (${p.nom}, ${p.dateISO}) : ${ecarts.join(' · ')} — à vérifier.` };
  }

  await moveMessage(cfg.mailbox, row.message_id, 'deleteditems');
  return {
    status: 'executed',
    result: {
      kind: 'rooftop_ok',
      movedTo: 'deleteditems',
      resaId: match.id,
      guest: p.nom, date: p.dateISO, heure: p.heure, couverts: p.couverts, statut: match.statut,
    },
  };
}

// ── Dispatch ────────────────────────────────────────────────────────────────

const NOT_WIRED: Record<string, string> = {
  none: 'Aucune action à exécuter (laissé à l’humain).',
};

export async function executeRow(cfg: HotelMailConfig, row: LogRow): Promise<ExecOutcome> {
  try {
    switch (row.proposed_action) {
      case 'delete':              return await actDelete(cfg, row);
      case 'archive':             return await actArchive(cfg, row);
      case 'draft_reply':         return await actDraftReply(cfg, row);
      case 'resa_control':        return await actResaControl(cfg, row);
      case 'invoice_note':        return await actInvoiceNote(cfg, row);
      case 'agency_note':         return await actAgencyNote(cfg, row);
      case 'commercial_followup': return await actCommercialFollowup(cfg, row);
      case 'route_pennylane':     return await actRoutePennylane(cfg, row);
      case 'presejour_check':     return await actPreSejour(cfg, row);
      case 'rooftop_check':       return await actRooftopCheck(cfg, row);
      case 'livraison_consigne':  return await actLivraisonConsigne(cfg, row);
      default:
        return { status: 'blocked', error: NOT_WIRED[row.proposed_action] || `Action inconnue : ${row.proposed_action}` };
    }
  } catch (e) {
    return { status: 'blocked', error: e instanceof Error ? e.message : 'échec exécution' };
  }
}
