// Gestionnaire de mails réception (Voiles + Corniche) — le CERVEAU (classifieur).
//
// Fonction PURE et déterministe : à partir d'un résumé de mail, décide la catégorie
// et l'action proposée. Aucun effet de bord, aucun LLM ici (le LLM ne sert que pour
// RÉDIGER les brouillons, en aval). Encode les règles apprises avec Martin (2026-07-04) :
//   - alerte stock D-Edge         -> supprimer (systématique)
//   - résa OTA (D-Edge/Booking)   -> contrôle résa (déjà venu + tarif) AVANT de classer
//   - facture fournisseur en PJ   -> router vers Pennylane (par entité facturée)
//   - candidature / alternance    -> brouillon « effectifs complets »
//   - demande séminaire / devis   -> suivi commercial (suivi_commercial)
//   - message client (Booking…)   -> brouillon de réponse (validation humaine)
//   - reste                       -> laisser à l'humain
// Voir memory project_assistant_mails_voiles.

// Config par HÔTEL : chaque hôtel = SA boîte, jamais mélangées. Le flag `mews`
// dit si l'enrichissement Mews (déjà venu / tarif) est possible — UNIQUEMENT Voiles
// (La Corniche n'est pas sous Mews). L'assistant tourne toujours scopé à UN hôtel.
export type HotelMailConfig = {
  key: 'voiles' | 'corniche';
  nom: string;
  hotelId: string;
  mailbox: string;
  mews: boolean;
};

export const HOTEL_MAIL_CONFIG: HotelMailConfig[] = [
  { key: 'voiles',   nom: 'Les Voiles',  hotelId: 'ded6e6fb-ff3c-4fa8-ad07-403ee316be53', mailbox: 'contact-lesvoiles@htbm.fr', mews: true },
  { key: 'corniche', nom: 'La Corniche', hotelId: 'f9d59e56-9a2f-433e-bcf4-f9753f105f32', mailbox: 'contact-corniche@htbm.fr', mews: false },
];

export function hotelConfig(key: string): HotelMailConfig | undefined {
  return HOTEL_MAIL_CONFIG.find((h) => h.key === key || h.hotelId === key || h.mailbox === key);
}

export type MailInput = {
  fromAddr: string;
  fromName?: string;
  subject: string;
  preview?: string;
  hasAttachments?: boolean;
  attachmentNames?: string[];
};

export type MailCategory =
  | 'spam_alert' | 'resa_ota' | 'prise_en_charge' | 'facture' | 'facture_ota' | 'candidature'
  | 'commercial' | 'client_msg' | 'autre';

export type MailAction =
  | 'delete' | 'resa_control' | 'agency_note' | 'route_pennylane' | 'invoice_note' | 'draft_reply'
  | 'commercial_followup' | 'none';

export type Classification = {
  category: MailCategory;
  action: MailAction;
  reason: string;
  detail: Record<string, unknown>;
};

const rx = {
  stockAlert: /n['’ ]?est plus disponible|plus disponible à la vente/i,
  bookingNoise: /résumé de votre compte|identifiant de l['’ ]?hôtel|account summary/i,
  // Digest quotidien des arrivées Booking → bruit (Martin 2026-07-07). Le détail actionnable
  // (facturation agence, TS Goelett) revient aussi par les mails D-Edge/Goelett individuels.
  bookingDigest: /résumé quotidien des arrivées|reservations with (?:today|tomorrow)|arrival date for/i,
  resaNew: /nouvelle réservation/i,
  resaMod: /modification de réservation/i,
  resaCancel: /annulation de réservation/i,
  facture: /\bfacture\b|avis d[’' ]?échéance|quittance|bon de livraison|\bBL\b/i,
  candidature: /candidature|alternance|(recherche|à la recherche).{0,25}(alternance|stage|emploi|apprentissage)|\bBTS\b.{0,20}tourisme/i,
  commercial: /séminaire|s[ée]minaire|devis|salle de r[ée]union|journ[ée]e d['’ ]?[ée]tude|cocktail din|privatis|séjour de \d+|room ?block|bloc de chambres|groupe .{0,15}(chambres|personnes)/i,
  dedge: /d-edge|d_edge|availpro/i,
  bookingGuest: /guest\.booking\.com$/i,
  reply: /^\s*(re|rép|rép\.|tr|fwd)\s*:/i,
};

// Réf D-EDGE (ex. 7QHRMG) souvent en tête du sujet.
function dedgeRef(subject: string): string | null {
  const m = subject.match(/\b([0-9A-Z]{6})\b/);
  return m ? m[1] : null;
}

function looksLikeFacturePdf(names: string[]): boolean {
  return names.some((n) => /\.pdf$/i.test(n) && /(facture|invoice|quittance|avis|fac[-_]|bl[-_ ]?\d|\d{5,})/i.test(n));
}

export function classifyMail(mail: MailInput): Classification {
  const subj = mail.subject || '';
  const prev = mail.preview || '';
  const hay = `${subj}\n${prev}`;
  const from = (mail.fromAddr || '').toLowerCase();
  const names = mail.attachmentNames || [];

  // 1) Alerte stock D-Edge -> suppression systématique
  if (rx.stockAlert.test(hay)) {
    return { category: 'spam_alert', action: 'delete', reason: 'Alerte stock D-Edge (hôtel non dispo à la vente)', detail: {} };
  }

  // 1b) Notifs de compte Booking (résumé de compte, identifiants hôtel) -> suppression (bruit).
  if (/booking\.com$/i.test(from) && rx.bookingNoise.test(hay)) {
    return { category: 'spam_alert', action: 'delete', reason: 'Notification de compte Booking (sans action)', detail: {} };
  }

  // 1c) Digest quotidien des arrivées Booking -> suppression (Martin 2026-07-07).
  if (/booking\.com$/i.test(from) && rx.bookingDigest.test(hay)) {
    return { category: 'spam_alert', action: 'delete', reason: 'Digest quotidien des arrivées Booking (bruit)', detail: {} };
  }

  // 2) Résa OTA (D-Edge / Booking) -> contrôle résa
  if (rx.resaNew.test(subj) || rx.resaMod.test(subj) || rx.resaCancel.test(subj)) {
    const kind = rx.resaCancel.test(subj) ? 'annulation' : rx.resaMod.test(subj) ? 'modification' : 'nouvelle';
    return {
      category: 'resa_ota',
      // Annulation AUSSI en contrôle : vérifier si annulé HORS DÉLAI → à facturer (Martin 2026-07-05).
      action: 'resa_control',
      reason: `Réservation OTA (${kind})`,
      detail: { kind, ref: dedgeRef(subj) },
    };
  }

  // 3) Facture fournisseur en PJ -> routage Pennylane (l'entité se lira dans le PDF)
  if (mail.hasAttachments && (rx.facture.test(hay) || looksLikeFacturePdf(names))) {
    return { category: 'facture', action: 'route_pennylane', reason: 'Facture fournisseur (PJ PDF)', detail: { attachments: names } };
  }

  // 2c) Prise en charge agence (VCC OTA : Djocatravel, Goelett…) sur une résa -> note pour l'équipe.
  //   Goelett = partenaire paiement de Booking (carte virtuelle) : NE PAS encaisser le client,
  //   facturer au nom de Goelett Sp. z o.o. (Martin 2026-07-06).
  const isGoelett = /goelett/i.test(from);
  if (/djocatravel/i.test(from) || isGoelett || (/prise en charge/i.test(subj) && /paiement/i.test(subj))) {
    const agency = isGoelett ? 'Goelett' : 'Djocatravel';
    return {
      category: 'prise_en_charge',
      action: 'agency_note',
      reason: `Prise en charge agence (${agency})`,
      detail: isGoelett
        ? { agency, note: 'Paiement par carte virtuelle (VCC) — NE PAS encaisser le client, facture au nom de Goelett Sp. z o.o.' }
        : { agency },
    };
  }

  // 3b) OTA (Hotelbeds…) réclame une copie de facture -> note « facture à envoyer » (compta).
  if (/hotelbeds/i.test(from) && (/booking ref|invoice|facture/i.test(hay))) {
    const ref = subj.match(/Ref\.?\s*([0-9][0-9A-Za-z-]{4,})/i)?.[1] || null;
    return { category: 'facture_ota', action: 'invoice_note', reason: 'Hotelbeds réclame la facture', detail: { ota: 'Hotelbeds', ref } };
  }

  // 4) Candidature / alternance -> brouillon « effectifs complets »
  if (rx.candidature.test(hay)) {
    return { category: 'candidature', action: 'draft_reply', reason: 'Candidature spontanée / alternance', detail: { template: 'effectifs_complets' } };
  }

  // 5) Demande commerciale (séminaire / devis / groupe pro) -> suivi_commercial
  if (rx.commercial.test(hay)) {
    return { category: 'commercial', action: 'commercial_followup', reason: 'Demande commerciale (séminaire/devis/groupe)', detail: {} };
  }

  // 6) Message client (via Booking, ou réponse d'un externe) -> brouillon, validation humaine
  if (rx.bookingGuest.test(from) || (rx.reply.test(subj) && !from.includes('htbm.fr'))) {
    return { category: 'client_msg', action: 'draft_reply', reason: 'Message client (à répondre)', detail: {} };
  }

  // 7) Reste -> laisser à l'humain
  return { category: 'autre', action: 'none', reason: 'Non classé — laissé à l’humain', detail: {} };
}
