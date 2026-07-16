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
  | 'spam_alert' | 'resa_ota' | 'resa_swile' | 'resa_rooftop' | 'prise_en_charge' | 'facture' | 'facture_interne' | 'facture_ota'
  | 'commission_ota' | 'candidature' | 'commercial' | 'client_msg' | 'pre_sejour' | 'rapport_pms'
  | 'autre';

export type MailAction =
  | 'delete' | 'archive' | 'resa_control' | 'agency_note' | 'route_pennylane' | 'invoice_note'
  | 'draft_reply' | 'commercial_followup' | 'presejour_check' | 'rooftop_check' | 'none';

export type Classification = {
  category: MailCategory;
  action: MailAction;
  reason: string;
  detail: Record<string, unknown>;
};

const rx = {
  // Alertes/relances de stock D-Edge → suppression auto (Martin 2026-07-09). Couvre « n'est
  // plus disponible à la vente » ET « il ne reste plus qu'une seule chambre disponible… /
  // Ajoutez des disponibilités » (relance d'incitation à ouvrir des dispos).
  stockAlert: /n['’ ]?est plus disponible|plus disponible à la vente|ne reste plus qu.{0,15}chambre|ajoutez des disponibilit/i,
  bookingNoise: /résumé de votre compte|identifiant de l['’ ]?hôtel|account summary/i,
  // Digest quotidien des arrivées Booking → bruit (Martin 2026-07-07). Le détail actionnable
  // (facturation agence, TS Goelett) revient aussi par les mails D-Edge/Goelett individuels.
  bookingDigest: /résumé quotidien des arrivées|reservations with (?:today|tomorrow)|arrival date for/i,
  resaNew: /nouvelle réservation/i,
  resaMod: /modification de réservation/i,
  resaCancel: /annulation de réservation/i,
  facture: /\bfacture\b|avis d[’' ]?échéance|quittance|bon de livraison|\bBL\b/i,
  candidature: /candidature|alternance|(recherche|à la recherche).{0,25}(alternance|stage|emploi|apprentissage)|\bBTS\b.{0,20}tourisme/i,
  // ⚠️ Élargi 2026-07-16 au TOURNAGE (production audiovisuelle) : la demande CACTUS FILMS via
  // Madame Hotels (18 comédiens, 15→30/10/2026, ~180 nuitées) tombait en `autre/none` — aucun
  // mot du déclencheur n'y figurait. Ce n'est pas un cas isolé : « Grands Ducs Films — Un voyage »
  // (35 chambres demandées sur les 2 hôtels, tournage aux plages du Mourillon) est déjà passé.
  // « single use » = occupation single, vocabulaire B2B/production systématique dans ces demandes.
  commercial: /séminaire|s[ée]minaire|devis|salle de r[ée]union|journ[ée]e d['’ ]?[ée]tude|cocktail din|privatis|séjour de \d+|room ?block|bloc de chambres|groupe .{0,15}(chambres|personnes)|tournage|com[ée]diens?|figurants?|single use/i,
  dedge: /d-edge|d_edge|availpro/i,
  bookingGuest: /guest\.booking\.com$/i,
  // Préfixes de réponse/transfert. ⚠️ PAS QUE LE FRANÇAIS (2026-07-16) : le fil UVET GBT (agence
  // italienne) arrivait en « R: CONFIRMATION NR… » — « R: » = le « Re: » italien, « I: » = leur
  // « Inoltra » (transfert). Non reconnus, ces mails d'humains échappaient à `humanThread`, donc
  // au garde-fou qui interdit de supprimer un expéditeur listé en pub quand un humain y parle.
  // Ajout aussi de « aw » (allemand) et « rv » (renvoi espagnol).
  reply: /^\s*(re|rép|rép\.|r|tr|fwd|fw|i|aw|rv)\s*:/i,
  // NOS propres factures (émises par nous, pas des fournisseurs) → à classer (Archive),
  // surtout PAS routées vers Pennylane (Martin 2026-07-09).
  //  · Mews envoie les factures/folios clients depuis noreply@mews.li
  //  · le Rooftop / l'hôtel envoie ses factures depuis *@send.hotel-corniche.com
  factureInterneFrom: /noreply@mews\.li|@send\.hotel-corniche\.com/i,
  // Relance de commission d'agence (ex. Travel Counsellors) → même traitement qu'Onyx :
  // brouillon « non commissionnables » PUIS corbeille (Martin 2026-07-13). Le `delete` sec
  // d'avant (2026-07-09) supprimait une VRAIE facture sans que personne ne réponde → l'agence
  // relançait (Reminder 1, 2, « overdue »). Répondre est ce qui arrête les relances.
  commissionOta: /travelcounsellors\.com/i,
  // Onyx CenterSource = chambre de compensation des commissions d'agences. Envoie un « relevé
  // à valider et payer » (.xls). Nos réservations ne sont PAS commissionnables → on répond ça
  // à chaque fois, puis on supprime (Martin 2026-07-10).
  onyxCommission: /onyxcentersource\.com/i,
  // 🛡️ PARTENAIRES DONT LA COMMISSION EST CONTRACTUELLE — ne JAMAIS leur répondre « non
  // commissionnable » (Martin 2026-07-16). C'est la ligne de partage laissée en suspens le
  // 2026-07-13 (cas Travel Counsellors), tranchée ici par les faits : Madame Hotels (agence
  // spectacle/production, Christelle Colonna) travaille avec nous à 10 % de commission ANNONCÉS
  // D'AVANCE et inclus dans le tarif — dossier « Paname Comedy Club » (« nuit, petit déjeuner et
  // taxe de séjour, commission 10 % : 3 chambres Confort à 191,83 € ») et dossier CONFIRMÉ
  // « JARRY / Sud concerts ». Une facture de commission de leur part est DUE : elle ne doit
  // jamais déclencher le brouillon « nos réservations ne sont pas commissionnables ».
  commissionablePartners: /@madamehotels\.fr/i,
  // Pub / marketing envoyée par les OTA elles-mêmes (Expedia « Maximisez vos revenus »…).
  // ⚠️ Ces expéditeurs peuvent AUSSI porter de vraies notifications de réservation → la règle
  // ne s'applique qu'aux mails qui ne ressemblent pas à une résa (Martin 2026-07-10).
  marketingSenders: /donotreply@expediagroup\.com|@expediapartnercentral\.com/i,
  // Pub / prospection commerciale entrante → corbeille. Liste d'expéditeurs qui s'enrichit
  // au fil de l'eau (c'est ça, « apprendre » à l'assistant). Martin 2026-07-09.
  // Newsletters institutionnelles / tourisme : corbeille comme les autres (Martin 2026-07-10).
  // ⚠️ transgourmet est scopé à son SOUS-DOMAINE marketing `email.transgourmet.fr` : le domaine
  // principal porte les vrais bons de livraison / factures fournisseur, à ne pas supprimer.
  // ⚠️ `@provencemed.com` RETIRÉ le 2026-07-13 : Provence Méditerranée n'est pas un newsletteur,
  // c'est l'agence de destination = un PARTENAIRE. Backtest sur l'historique Corniche : l'équipe
  // range ses mails dans « Partenaires » et « Infos Tourisme » — elle les GARDE (ex. « RE: Brochure
  // Vacances Accessibles — demande de mise à jour 2026 » = notre fiche dans leur brochure).
  // ⚠️ @snservice.co « TTHotel Pro Login Address Update » (2026-07-15) = mail type phishing / faux
  // changement de domaine (tthotelpro.com → .net, « Urgent », télécharger l'app). Ça se fait passer
  // pour notre fournisseur de serrures TTHotel mais l'expéditeur n'est pas tthotelpro → corbeille.
  // (Martin : décision de supprimer. Ne jamais suivre les liens : vérifier via un canal TTHotel connu.)
  // ⚠️ @lestoilesdularge.com (2026-07-16) = démarchage d'un fabricant de textile/décoration
  // (« Semaine Nationale, célébrons le savoir-faire français ! ») — aucun lien commercial.
  prospectionSenders:
    /translaser\.fr|neutraliz\.com|@provence-alpes-cotedazur\.com|@email\.transgourmet\.fr|@vigneron\.paris|@snservice\.co|@lestoilesdularge\.com/i,
  // Notification de réservation Rooftop que la vitrine s'envoie à la réception des Voiles.
  // Le mail DOUBLE le plan de salle de l'onglet Service → inutile SI la résa est bien en base
  // (Martin 2026-07-16 : « si la résa est dans l'app correctement alors on supprime »). La
  // vérification se fait dans l'ACTION, pas ici : le `bodyPreview` de Graph est tronqué, et
  // surtout on ne supprime jamais sur le seul critère de l'expéditeur.
  rooftopResaFrom: /demandes@send\.hotel-corniche\.com/i,
  rooftopResaSubject: /r[ée]servation rooftop/i,
  // Digest de mise en quarantaine Microsoft 365 : Outlook a retenu un message qu'il juge
  // indésirable et propose de le passer en revue. Même doctrine que les indésirables (Martin
  // 2026-07-10 : « on ne lit pas les indésirables ») → corbeille. Le message retenu reste
  // récupérable 15 jours côté Microsoft si jamais un vrai client y tombait.
  quarantineDigest: /quarantine@messaging\.microsoft\.com/i,
  // LoungeUp (Corniche) : porte les formulaires PRÉ-SÉJOUR remplis par le client — cf preSejour.ts.
  loungeUp: /@app(\.eu)?\.loungeup\.com/i,
  // Éditions automatiques du PMS Hotsoft, que l'hôtel s'envoie à sa propre boîte (96 % du dossier
  // « Hotsoft », 12 353 mails). Pièces d'exploitation et de sécurité — jamais de suppression sèche.
  rapportPms:
    /feuille de caisse|feuille de situation|contr[ôo]le des annulations|^guests$|emergency report|r[ée]servations\s*:\s*annulations|hotsoft/i,
  pmsSenders: /@htbm\.fr|weareplanet\.com/i,
  // Un mail qui porte la parole d'un HUMAIN d'en face (réponse dans un fil, message d'un voyageur
  // relayé par l'OTA) ne part jamais à la corbeille sur le seul critère de l'expéditeur.
  guestMessage:
    /nous a envoy[ée] ce message|message re[çc]u de la part d|message d[’' ]?un voyageur|attend d[’' ]?[êe]tre lu/i,
  // Idem pour tout ce qui parle d'argent (facture, impayé) : jamais de suppression à l'aveugle.
  moneyHook: /\binvoice\b|impay[ée]|outstanding|relance de paiement/i,
  // Signal générique de newsletter / démarchage à froid (lien de désinscription + accroche).
  prospectionHook: /se d[ée]sinscrire|unsubscribe|d[ée]couvrez nos offres|\b[àa] partir de\s?\d/i,
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

  // 1d) NOS propres factures (folio client Mews, facture Rooftop) -> Archive. À classer,
  //     jamais Pennylane (Pennylane = factures FOURNISSEURS entrantes). Martin 2026-07-09.
  if (rx.factureInterneFrom.test(from) && rx.facture.test(hay)) {
    return { category: 'facture_interne', action: 'archive', reason: 'Notre propre facture (client Mews / Rooftop) → à classer', detail: {} };
  }

  // 1e+1g) Réclamations de commission d'agence (Onyx CenterSource, Travel Counsellors…) ->
  //     répondre « réservations non commissionnables » puis supprimer (Martin 2026-07-10,
  //     étendu à Travel Counsellors le 2026-07-13). Réponse = brouillon, l'humain envoie.
  //     ⚠️ Une facture NOMINATIVE portant sur une résa identifiable (client + dates + réf) peut
  //     être réellement due — cas Farrar 07/2026, agence ayant réservé en direct sous son code
  //     IATA. Le brouillon reste donc un brouillon : on ne l'envoie pas sans regarder la résa.
  //     ⚠️ Jamais pour un partenaire dont la commission est contractuelle (Madame Hotels & co) :
  //     leur commission est due, le brouillon serait faux. Ils tombent dans les règles normales.
  if (!rx.commissionablePartners.test(from) &&
      (rx.onyxCommission.test(from) || (rx.commissionOta.test(from) && /commission/i.test(hay)))) {
    return {
      category: 'commission_ota',
      action: 'draft_reply',
      reason: 'Réclamation de commission d’agence → répondre « non commissionnables » puis supprimer',
      detail: { template: 'non_commissionable' },
    };
  }

  // GARDE-FOU DES SUPPRESSIONS PAR EXPÉDITEUR (2026-07-13). Trier la pub « par expéditeur » (seule
  // méthode qui marche depuis que `prospectionHook` est mort) casse dès qu'un expéditeur envoie À LA
  // FOIS de la pub ET du vrai courrier. Backtest sur l'historique Corniche : la règle Expedia aurait
  // supprimé « Message reçu de la part d'un voyageur Expedia », et la règle PACA une facture.
  // → Une règle de suppression fondée sur l'EXPÉDITEUR ne s'applique jamais à un mail qui porte la
  //   parole d'un humain (réponse dans un fil, message de voyageur) ou qui parle d'argent.
  const humanThread = rx.reply.test(subj) || rx.guestMessage.test(hay);
  const aboutMoney = rx.facture.test(hay) || rx.moneyHook.test(hay);
  const senderDeleteOk = !humanThread && !aboutMoney;

  // 1f) Pub / prospection connue (expéditeurs déjà repérés) -> corbeille (Martin 2026-07-09).
  if (rx.prospectionSenders.test(from) && senderDeleteOk) {
    return { category: 'spam_alert', action: 'delete', reason: 'Pub / prospection (expéditeur connu)', detail: {} };
  }

  // 1f-bis) Digest « messages en quarantaine » Microsoft 365 -> corbeille (Martin 2026-07-16).
  //     Même doctrine que les indésirables : on ne les lit pas. Contrôle du dossier Corniche le
  //     2026-07-10 : que du démarchage/arnaque, aucun vrai client — le filtre Outlook fait son
  //     travail. Le message retenu reste récupérable 15 j côté Microsoft.
  if (rx.quarantineDigest.test(from) && senderDeleteOk) {
    return { category: 'spam_alert', action: 'delete', reason: 'Digest de quarantaine Microsoft 365 (on ne lit pas les indésirables)', detail: {} };
  }

  // 1f-ter) Notification de résa Rooftop émise par la vitrine -> RÉCONCILIATION avec la base :
  //     la résa est dans l'app → le mail dégage ; elle n'y est pas (ou ne colle pas) → l'humain
  //     regarde (Martin 2026-07-16). ⚠️ La suppression est décidée par l'ACTION après lecture de
  //     la base, JAMAIS ici : côté vitrine, l'insert (RPC `rooftop_book`) et l'envoi du mail sont
  //     deux chemins indépendants → ce mail est le seul filet si la base a raté la résa.
  //     `!humanThread` : une réponse dans le fil reste un message humain.
  if (rx.rooftopResaFrom.test(from) && rx.rooftopResaSubject.test(subj) && !humanThread) {
    return { category: 'resa_rooftop', action: 'rooftop_check', reason: 'Résa Rooftop (vitrine) → vérifier qu’elle est bien dans l’app', detail: {} };
  }

  // 1h) Formulaire PRÉ-SÉJOUR rempli par le client (LoungeUp, Corniche) -> on LIT le formulaire :
  //     s'il porte une demande (attentes particulières, PDJ, late check-out, facture entreprise),
  //     note à la réception ; sinon le mail dégage (Martin 2026-07-13). Le tri se fait dans
  //     l'action, pas ici : le `bodyPreview` de Graph (~255 car.) ne contient pas le formulaire.
  //     ⚠️ Placé après le garde-fou : une RÉPONSE d'un client à ce mail reste un message client.
  if (rx.loungeUp.test(from) && !humanThread) {
    return { category: 'pre_sejour', action: 'presejour_check', reason: 'Formulaire pré-séjour client (à lire)', detail: {} };
  }

  // 1i) Éditions automatiques du PMS Hotsoft que l'hôtel s'envoie à lui-même (feuille de caisse,
  //     situation HT/TTC, Guests, Emergency Report…). Pièces d'exploitation : on les CLASSE, on ne
  //     les détruit pas ici — la purge à 4 jours s'en charge ensuite (Martin 2026-07-13).
  if (rx.rapportPms.test(subj) && rx.pmsSenders.test(from)) {
    return { category: 'rapport_pms', action: 'archive', reason: 'Édition automatique du PMS (Hotsoft)', detail: {} };
  }

  // 1j) Résa SWILE (agence voyage d'affaires, `travel@notification.swile.co`) -> contrôle résa.
  //     Format propre à Swile (pas D-Edge) : prépayé, ne rien réclamer au voyageur, mais porte
  //     des demandes voyageur (arrivée tardive, parking) → contrôle + réponse. Placé AVANT le
  //     contrôle OTA générique car le parseur D-Edge ne sait pas lire le format Swile.
  if (/swile/i.test(from)) {
    return { category: 'resa_swile', action: 'resa_control', reason: 'Réservation Swile (voyage d’affaires, prépayée)', detail: { channel: 'swile' } };
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

  // 2b) Pub / marketing d'un OTA (Expedia « Maximisez vos revenus : ajoutez des types de
  //     chambres »…) -> corbeille. Placé APRÈS le contrôle résa, et gardé par `looksLikeResa` :
  //     ces expéditeurs peuvent aussi porter une vraie notification de réservation, qui ne doit
  //     jamais partir à la corbeille (Martin 2026-07-10).
  //     ⚠️ `looksLikeResa` NE SUFFIT PAS (backtest 2026-07-13) : `donotreply@expediapartnercentral.com`
  //     envoie aussi les MESSAGES DES VOYAGEURS, qui ne ressemblent pas à une notif de résa et
  //     partaient donc à la corbeille. D'où le `senderDeleteOk` (humain qui parle / argent).
  const looksLikeResa =
    rx.resaNew.test(subj) || rx.resaMod.test(subj) || rx.resaCancel.test(subj) || rx.dedge.test(hay);
  if (rx.marketingSenders.test(from) && !looksLikeResa && senderDeleteOk) {
    return { category: 'spam_alert', action: 'delete', reason: 'Pub / marketing OTA (à supprimer)', detail: {} };
  }

  // 3) Facture fournisseur en PJ -> routage Pennylane (l'entité se lira dans le PDF)
  if (mail.hasAttachments && (rx.facture.test(hay) || looksLikeFacturePdf(names))) {
    return { category: 'facture', action: 'route_pennylane', reason: 'Facture fournisseur (PJ PDF)', detail: { attachments: names } };
  }

  // 2c) Prise en charge agence (VCC OTA) sur une résa -> note pour l'équipe. Trois agences
  //   connues : Djocatravel · Goelett (partenaire paiement Booking, VCC) · CDS Groupe /
  //   Ailleurs Business (carte MasterCard agence couvrant la TS, facture à Ailleurs Business).
  //   Règle commune : NE PAS encaisser le client, débiter la carte agence (Martin 2026-07-06/07).
  //   4e canal (2026-07-16) : UVET GBT (`hotelbookings@uvetgbt.com`, sous-licencié American Express
  //   Global Business Travel, agence corporate italienne). Sujet « CONFIRMATION NR. <réf> - <réf
  //   hôtel> - <n°> - MR/MRS <NOM> - CHECK-IN jj/mm/aaaa CHECK-OUT jj/mm/aaaa », voucher + carte
  //   agence en PIÈCES JOINTES (`CreditCard_<réf>.pdf`) : « UVET GBT S.P.A. CREDIT CARD HEREBY
  //   ATTACHED TO BE CHARGED FOR THIS BOOKING ». ⚠️ FENÊTRE COURTE : le n° de carte n'est
  //   accessible que 5 j après la résa, puis de J-1 avant l'arrivée à J+2 après le départ — un
  //   mail vu trop tard = carte perdue (vécu le 2026-07-16 : résa CUOZZO, la réception a dû
  //   réclamer la carte le matin du départ). N° de carte JAMAIS stocké (4 derniers max).
  //   `!humanThread` : dans ce canal un humain de l'agence répond dans le fil (« R: CONFIRMATION
  //   NR… ») — ces mails-là restent à l'humain, on ne note que la confirmation automatique.
  const isUvet = /@uvetgbt\.com/i.test(from) && /confirmation nr/i.test(subj) && !humanThread;
  const isGoelett = /goelett/i.test(from);
  const isCds = /ailleursbusiness|cdsgroupe/i.test(from) || /prestations compl[ée]mentaires/i.test(subj);
  if (/djocatravel/i.test(from) || isGoelett || isCds || isUvet || (/prise en charge/i.test(subj) && /paiement/i.test(subj))) {
    const agency = isGoelett ? 'Goelett' : isCds ? 'CDS Groupe / Ailleurs Business' : isUvet ? 'UVET GBT' : 'Djocatravel';
    return {
      category: 'prise_en_charge',
      action: 'agency_note',
      reason: `Prise en charge agence (${agency})`,
      detail: { agency },
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

  // 6c) Démarchage à froid / newsletter (accroche marketing + lien de désinscription) et
  //     pas un interne htbm -> corbeille. Placé APRÈS le commercial pour ne jamais avaler une
  //     vraie demande (séminaire/devis). Martin 2026-07-09.
  if (rx.prospectionHook.test(hay) && !from.includes('htbm.fr')) {
    return { category: 'spam_alert', action: 'delete', reason: 'Démarchage / newsletter (à supprimer)', detail: {} };
  }

  // 7) Reste -> laisser à l'humain
  return { category: 'autre', action: 'none', reason: 'Non classé — laissé à l’humain', detail: {} };
}
