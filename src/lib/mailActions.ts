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
import { moveMessage, createReplyDraft, getMessageText, listFileAttachments, forwardMessage, listInbox } from '@/lib/graphMailbox';
import { parseOtaResa, controlNote, cancellationNote, parseAgencyTakeover, parseGoelett, shortRoom, ddmm, type AgencyTakeover } from '@/lib/otaResa';
import { findGuest, hasPastStay, findReservation, cityTaxForReservation } from '@/lib/mews';
import type { HotelMailConfig, MailCategory } from '@/lib/mailAssistant';

const LLM_MODEL = 'claude-sonnet-4-6';   // même modèle que /api/brief, /api/fiche-audit

export type ActionMode = 'off' | 'suggest' | 'auto';

// Catégories pilotables (on/off/auto) + leur mode par défaut. Tout démarre en
// 'suggest' (human-in-the-loop) : rien ne part en auto tant que Martin ne l'a pas décidé.
export const CATEGORY_MODES: MailCategory[] = [
  'spam_alert', 'resa_ota', 'facture', 'candidature', 'commercial', 'client_msg',
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

// draft_reply : crée un BROUILLON de réponse (rien n'est envoyé — l'humain relit/envoie).
// Câblé : candidature (template fixe). Message client (LLM) = pas encore câblé.
async function actDraftReply(cfg: HotelMailConfig, row: LogRow): Promise<ExecOutcome> {
  if (row.category === 'candidature' || row.detail?.template === 'effectifs_complets') {
    const d = await createReplyDraft(cfg.mailbox, row.message_id, candidatureHtml(cfg.nom));
    return { status: 'executed', result: { kind: 'candidature', draftId: d.draftId, webLink: d.webLink } };
  }
  return { status: 'blocked', error: 'Brouillon de réponse client non encore câblé (rédaction LLM à venir).' };
}

// resa_control : lit le mail D-Edge → parse la résa → (Voiles) enrichit « déjà venu »
// via Mews → produit une NOTE de contrôle à copier. AUCUN effet sortant (on ne classe
// ni ne déplace : « traiter d'abord, classer ensuite »). ⚠️ Mews gated sur cfg.mews.
async function actResaControl(cfg: HotelMailConfig, row: LogRow): Promise<ExecOutcome> {
  const body = await getMessageText(cfg.mailbox, row.message_id);
  const r = parseOtaResa(row.subject || '', body);

  // ANNULATION : pas de « déjà venu / TS » — on vérifie s'il faut FACTURER (hors délai).
  if (r.kind === 'annulation') {
    const note = cancellationNote(r);
    return {
      status: 'executed',
      result: {
        kind: 'resa_cancel', note,
        resa: {
          ref: r.ref, source: r.source, guest: r.guestName, arrival: r.arrival,
          cancelDate: r.cancelDateISO, freeCancelDaysBefore: r.freeCancelDaysBefore,
          penalty: r.penalty, firstNight: r.firstNightAmount, payment: r.payment, amount: r.amount,
        },
      },
    };
  }

  let dejaVenu: boolean | null = null;   // null = info indisponible (Corniche / Mews KO)
  let cityTax: number | null = null;     // TS exacte à encaisser sur place (VCC, Voiles)
  if (cfg.mews && r.guestLast) {
    try {
      const g = await findGuest(r.guestFirst, r.guestLast);
      dejaVenu = g ? await hasPastStay(g.id) : false;   // pas de profil Mews = 1er séjour
      // TS exacte : seulement pour les VCC (la carte virtuelle ne couvre pas la taxe).
      if (g && r.payment === 'vcc' && r.arrivalISO) {
        const resaId = await findReservation(g.id, r.arrivalISO);
        if (resaId) cityTax = (await cityTaxForReservation(resaId))?.amount ?? null;
      }
    } catch {
      dejaVenu = null;   // Mews indisponible : on ne bloque pas la note pour autant
    }
  }

  // Prise en charge agence sur la TS (prime sur « RSP TS ») :
  //  - Goelett = TS prépayée sur une 2e CCV dédiée → note « CCV TS …xxxx » (débiter cette carte) ;
  //  - Djoca   = TS incluse dans la prise en charge → note « TS incl. agence ».
  let tsByAgency = false;
  let tsCardLast4: string | null = null;
  if (r.payment === 'vcc' && r.guestLast) {
    const takeover = await findAgencyTakeover(cfg.mailbox, r.guestLast, r.arrivalISO).catch(() => null);
    if (takeover?.provider === 'goelett') tsCardLast4 = takeover.cardLast4;
    else if (takeover?.tsCovered) tsByAgency = true;
  }

  const note = controlNote(r, dejaVenu, cityTax, tsByAgency, tsCardLast4);
  return {
    status: 'executed',
    result: {
      kind: 'resa_control', note, dejaVenu, cityTax,
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

type Lead = {
  nom_client?: string; societe?: string; telephone?: string; titre_demande?: string;
  date_evenement?: string; nb_personnes?: string; budget_estime?: number;
  resume?: string; missing?: string[]; draft_html?: string;
};

// Un seul appel LLM : champs extraits + infos manquantes + brouillon de pré-qualif.
async function qualifyLead(subject: string, body: string, hotelName: string): Promise<Lead> {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: LLM_MODEL, max_tokens: 1100,
    messages: [{
      role: 'user',
      content:
        `Tu es l'assistant commercial de l'Hôtel ${hotelName}. Analyse ce mail de demande ` +
        `(séminaire / groupe / devis / privatisation) et réponds en JSON STRICT (rien autour), clés :\n` +
        `- nom_client, societe, telephone (si présents)\n` +
        `- titre_demande : résumé court de la demande\n` +
        `- date_evenement : "yyyy-mm-dd" si une date précise est donnée, sinon omets\n` +
        `- nb_personnes : le nombre de participants si donné (texte), sinon omets\n` +
        `- budget_estime : nombre en € si donné, sinon omets\n` +
        `- resume : 2 phrases max pour la fiche CRM\n` +
        `- missing : liste des infos MANQUANTES à demander pour qualifier (parmi : dates exactes, ` +
        `nombre de participants, budget indicatif, type de prestation, restauration, hébergement)\n` +
        `- draft_html : un brouillon de réponse en français, poli et chaleureux, qui remercie et ` +
        `pose UNIQUEMENT les questions de "missing" (une liste courte). PAS de signature (ajoutée après). ` +
        `Balises <p>/<ul><li> autorisées.\n\nSujet: ${subject}\n\n${body.slice(0, 6000)}`,
    }],
  });
  const text = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()) as Lead; }
  catch { return { resume: text.slice(0, 400) }; }
}

async function actCommercialFollowup(cfg: HotelMailConfig, row: LogRow): Promise<ExecOutcome> {
  if (!process.env.ANTHROPIC_API_KEY) return { status: 'blocked', error: 'Clé Anthropic absente (qualification impossible).' };
  const body = await getMessageText(cfg.mailbox, row.message_id);
  const lead = await qualifyLead(row.subject || '', body, cfg.nom);
  const email = row.from_addr || null;
  const today = new Date().toISOString().slice(0, 10);
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

// Cherche une prise en charge agence (Djoca) dans la boîte, pour le client + l'arrivée
// d'une résa. Sert à corriger la TS de la note résa (agence couvre la TS).
async function findAgencyTakeover(
  mailbox: string, guestLast: string, arrivalISO: string | null,
): Promise<AgencyTakeover | null> {
  const inbox = await listInbox(mailbox, 40);
  const cands = inbox.filter((m) =>
    /djocatravel/i.test(m.fromAddr) || /goelett/i.test(m.fromAddr)
    || /prise en charge/i.test(m.subject) || /paiement pour .+ pour la r[ée]servation/i.test(m.subject));
  for (const m of cands) {
    const body = await getMessageText(mailbox, m.id).catch(() => '');
    const isG = /goelett/i.test(m.fromAddr) || /goelett/i.test(m.subject);
    const t = isG ? parseGoelett(m.subject, body) : parseAgencyTakeover(m.subject, body);
    const nameOk = t.guestLast && t.guestLast.toLowerCase() === guestLast.toLowerCase();
    const dateOk = !arrivalISO || !t.checkInISO || t.checkInISO === arrivalISO;
    if (nameOk && dateOk) return t;
  }
  return null;
}

// agency_note : prise en charge agence (Djoca) → note pour l'équipe (carte à débiter à
// l'arrivée, ce que l'agence couvre). Aucun n° de carte complet stocké (4 derniers max).
async function actAgencyNote(cfg: HotelMailConfig, row: LogRow): Promise<ExecOutcome> {
  const body = await getMessageText(cfg.mailbox, row.message_id);
  const isGoelett = /goelett/i.test(row.from_addr || '') || /goelett/i.test(row.subject || '');
  const t = isGoelett ? parseGoelett(row.subject || '', body) : parseAgencyTakeover(row.subject || '', body);

  const parts: string[] = [];
  if (isGoelett) {
    // Goelett : note RÉCEPTION en codes courts (Martin 2026-07-07) — chambre sur CCV Booking,
    // TS sur une 2e CCV dédiée Goelett : `#supérieure [NANR] CCV # CCV TS …6624`.
    // Le tarif (NANR/FLEX) + GENIUS + 1er séjour vivent dans le mail résa D-Edge (pas Goelett)
    // → ajoutés au lien résa↔Goelett. « CCV TS » implique : débiter cette carte, pas le client.
    let note = `#${shortRoom(t.room)} CCV # CCV TS …${t.cardLast4 || '????'}`;
    note = note.replace(/\s+/g, ' ').trim();
    return {
      status: 'executed',
      result: { kind: 'agency_note', note, agency: t.agency, ref: t.ref, bookingRef: t.bookingRef, guest: t.guestName, cardLast4: t.cardLast4, tsCovered: true, tsAmount: t.tsAmount },
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
  const note = `📄 FACTURE À ENVOYER à ${ota}${ref ? ` — résa ${ref}` : ''}`;
  return { status: 'executed', result: { kind: 'invoice_note', note, ota, ref } };
}

// ── Dispatch ────────────────────────────────────────────────────────────────

const NOT_WIRED: Record<string, string> = {
  none: 'Aucune action à exécuter (laissé à l’humain).',
};

export async function executeRow(cfg: HotelMailConfig, row: LogRow): Promise<ExecOutcome> {
  try {
    switch (row.proposed_action) {
      case 'delete':              return await actDelete(cfg, row);
      case 'draft_reply':         return await actDraftReply(cfg, row);
      case 'resa_control':        return await actResaControl(cfg, row);
      case 'invoice_note':        return await actInvoiceNote(cfg, row);
      case 'agency_note':         return await actAgencyNote(cfg, row);
      case 'commercial_followup': return await actCommercialFollowup(cfg, row);
      case 'route_pennylane':     return await actRoutePennylane(cfg, row);
      default:
        return { status: 'blocked', error: NOT_WIRED[row.proposed_action] || `Action inconnue : ${row.proposed_action}` };
    }
  } catch (e) {
    return { status: 'blocked', error: e instanceof Error ? e.message : 'échec exécution' };
  }
}
