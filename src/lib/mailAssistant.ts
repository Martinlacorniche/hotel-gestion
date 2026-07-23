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
  | 'litige_ota' | 'livraison'
  | 'autre';

export type MailAction =
  | 'delete' | 'archive' | 'resa_control' | 'agency_note' | 'route_pennylane' | 'invoice_note'
  | 'draft_reply' | 'commercial_followup' | 'presejour_check' | 'rooftop_check' | 'livraison_consigne' | 'none';

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
  // ⚠️ « Aperçu mensuel de votre boîte de réception » (`no-reply@properties.booking.com`) ajouté
  // le 2026-07-17 : relance d'engagement (« consultez votre boîte de réception »), aucun contenu
  // actionnable. Vérité terrain : l'équipe Corniche l'a jeté le matin même.
  bookingNoise: /résumé de votre compte|identifiant de l['’ ]?hôtel|account summary|aperçu mensuel de votre boîte/i,
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
  // ⚠️ Élargi 2026-07-17 à la LOCATION DE SALLE SÈCHE (sans hébergement) : la demande récurrente
  // de DE BAECQUE (commissaire-priseur, « journées d'expertise » en Telo Maritimo, 299 €/jour,
  // 3 fiches déjà Confirmé) tombait en `autre/none` — il écrit « la grande salle », jamais
  // « salle de réunion ». Une demande de salle sans le mot « séminaire » reste une demande
  // commerciale. `salle` seul serait trop large (la salle du PDJ revient dans du courrier
  // d'exploitation) → on exige un verbe de réservation ou un qualificatif.
  commercial: /séminaire|s[ée]minaire|devis|salle de r[ée]union|(?:grande|petite) salle|(?:r[ée]server|louer|location de|dispo.{0,15}de) (?:la |une |votre )?salle|journ[ée]e d['’ ]?(?:[ée]tude|expertise)|cocktail din|privatis|séjour de \d+|room ?block|bloc de chambres|groupe .{0,15}(chambres|personnes)|tournage|com[ée]diens?|figurants?|single use/i,
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
  // Nos propres mails Mews. `mewsConfirmation` ne vise QUE la confirmation de séjour :
  // du même expéditeur partent aussi les annulations automatiques (qui portent une info),
  // nos factures, un lien d'authentification et des « [ACTION REQUIRED] Groupe de
  // réservation » — tous doivent survivre. Cf. règle 1e-bis.
  mewsSelf: /noreply@mews\.li/i,
  mewsConfirmation: /confirmation de votre r[ée]servation|your reservation .{0,20}confirmed/i,
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
  // 🆕 CANAL BEST WESTERN — La Corniche est un BW Plus : la centrale nous envoie les demandes
  // d'affaires captées par ses chargés de compte. Sujet toujours « Nouvelle demande pour <hôtel>
  // (BY-xxxxxxx) », expéditeur = un humain @bestwestern.fr. C'est un des GROS canaux de leads de
  // la Corniche (8 dossiers en base : URETEK, Genmills, NORAUTO, AXA, CNRS, ZOLL…), et il tombait
  // en `autre/none`. ⚠️ Pourquoi la règle 5 (`rx.commercial`) ne l'attrape pas : le type
  // d'événement (« Convention, Séminaire, Voyage d'entreprise ») est DANS LE CORPS, bien au-delà
  // des ~255 car. du `bodyPreview`. Le sujet, lui, est stable → on trie dessus.
  bwLead: /nouvelle demande pour\b|\bBY-\d{6,}\b/i,
  bwFrom: /@bestwestern\.fr$/i,
  // ⛔ PAS DE RÈGLE « CV EN PIÈCE JOINTE » (tranché Martin 2026-07-23). Le cas vécu ce jour
  // (objet « Please print 15 copies », corps vide, PJ `CV.pdf` — un chef italien qui démarche)
  // relève de l'EXCEPTIONNEL : on le laisse aux équipes, en `autre/none`. Une candidature qui
  // se nomme (mot « candidature », « alternance »…) reste attrapée par `rx.candidature`.
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
  // ⚠️ @cndt-fr.fr (2026-07-22) = « Centre national du droit du travail — Nouveaux Affichages
  // Obligatoires 2026 » : ARNAQUE classique (usurpe un air officiel pour vendre des panneaux
  // d'affichage obligatoires, suivie d'une facturation agressive). Adressé « HOTEL LES VOILES »
  // mais tombé dans la boîte Corniche (envoi en masse). Le vrai droit du travail ne démarche pas.
  prospectionSenders:
    /translaser\.fr|neutraliz\.com|@provence-alpes-cotedazur\.com|@email\.transgourmet\.fr|@vigneron\.paris|@snservice\.co|@lestoilesdularge\.com|@cndt-fr\.fr|@provencemed\.com/i,
  // 🔁 `@provencemed.com` REMIS ICI le 2026-07-23 — ceci ANNULE la correction du 2026-07-13.
  // Le backtest d'alors concluait « partenaire, l'équipe les garde » ; Martin tranche l'inverse :
  // « c'est de la merde qui pollue donc on vire, SAUF si c'est une demande ». Sur les 16 mails
  // de cet expéditeur en historique, la coupure est nette : 6 pubs (agenda hebdo des animations,
  // invitations, save the date) contre 8 « RE: Facture Pro Forma » et 1 « Demande de mise à jour »
  // de brochure. Les 8 factures sont déjà protégées (fil humain + argent) ; la demande de mise à
  // jour ne l'était PAS → d'où `demandeHook` ci-dessous, sans lequel cette règle jetterait une
  // vraie sollicitation. Cf. `senderDeleteOk`.
  //
  // Une sollicitation qui attend une action de notre part (mettre à jour notre fiche, remplir un
  // formulaire, renvoyer un document) n'est jamais de la pub, même venant d'un expéditeur qui en
  // envoie par ailleurs. Volontairement ÉTROIT : « demandez votre devis » ou « sur simple demande »
  // sont des formules publicitaires et ne doivent pas matcher.
  demandeHook:
    /demande de (?:mise à jour|renseignements?|documents?|informations?|devis de)|merci de (?:bien vouloir )?(?:nous )?(?:compl[ée]ter|mettre à jour|renvoyer|retourner)|pourriez-vous nous (?:envoyer|transmettre|communiquer|mettre)/i,
  // Cuisine Solutions (fournisseur de plats surgelés du Rooftop des Voiles) envoie des
  // CONFIRMATIONS DE COMMANDE (`envoifacturescse@cuisinesolutions.com`, progiciel VIF) avec le
  // bon en PJ PDF — souvent RELAYÉES par Nina « à imprimer » (l'expéditeur devient alors interne
  // htbm, d'où le match sur le CORPS aussi). Le bon porte une DATE DE LIVRAISON future (surgelé
  // STEF -20°C) → pattern « consigne datée du jour de livraison pour contrôle réception »
  // (Martin 2026-07-22, déjà fait à la main les 04/07 & 22/07). ⚠️ Ce n'est PAS une facture
  // (Pennylane) : c'est un bon de commande/livraison → catégorie `livraison`.
  cuisineSolutions: /cuisinesolutions/i,
  livraisonHook: /confirmation de (?:la )?commande|bon de livraison|\bBL\b|livraison au? \d/i,
  // Monsieur Cocktail (Gaëtan Dupuis, SARL MC Entreprises, `gaetan@monsieurcocktail.com` /
  // `dupuisgaetan@orange.fr`) = PARTENAIRE traiteur/animation cocktail récurrent (Martin
  // 2026-07-22). La réception lui transfère les demandes BW pour vérifier sa dispo, il répond
  // « Compte sur moi :) » → dans les fiches `suivi_commercial` ça s'écrit « G dispo ». Ses
  // réponses ne doivent JAMAIS déclencher un brouillon (le fallback `client_msg` le voulait) :
  // c'est un partenaire sur un dossier existant, la réception note « G dispo » et classe.
  monsieurCocktail: /@monsieurcocktail\.com|dupuisgaetan@orange\.fr/i,
  // Service Clients Booking : issue d'un litige/geste commercial (« <client> a accepté votre
  // proposition d'annuler la réservation et de supprimer les frais associés »). Le dossier est
  // clos côté Booking → à CLASSER, jamais à supprimer (Martin 2026-07-17).
  // ⚠️ Le mail porte quand même une consigne conditionnelle — « si vous avez déjà débité le
  // client, procédez au remboursement intégral » — donc l'archivage ne vaut PAS quittance : c'est
  // la réception qui solde le remboursement (vécu le 2026-07-17 : Elora avait ouvert la consigne
  // « Ilham Mansar : remboursement du FULLPAY ? » le matin même). Le `reason` le rappelle pour
  // que le journal ne laisse pas croire que tout est fait.
  bookingCsFrom: /cs-noreply@booking\.com/i,
  bookingCsResolved: /a accept[ée] votre proposition|accepted your proposal/i,
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
  // ⚠️ LoungeUp porte DEUX flux distincts sous le même expéditeur (2026-07-17) :
  //   · le formulaire pré-séjour → corps « Nouvelle demande : Pré-Séjour » (parsable, preSejour.ts)
  //   · un MESSAGE LIBRE du client écrit dans l'app → corps « Vous avez reçu un message d'un
  //     client via l'App », suivi du texte du client. Aucun formulaire à parser.
  // Les confondre envoyait le message libre à `parsePreSejour`, qui ne trouve aucun champ et
  // conclut « rien d'important » → une vraie demande client passait à la trappe (vécu : Frederikke
  // Laursen, ch. 022, demandait une place de parking pour sa voiture de location).
  // Le sujet ne discrimine pas (c'est le 1er mot du client, ex. « Bonjour. Is it possible… ») :
  // seul ce marqueur du corps le fait. Il est bien dans le `bodyPreview` (~255 car.), en tête.
  loungeUpClientMsg: /re[çc]u un message d['’ ]?un client|message d['’ ]?un client via l['’ ]?app/i,
  // Éditions automatiques du PMS Hotsoft, que l'hôtel s'envoie à sa propre boîte (96 % du dossier
  // « Hotsoft », 12 353 mails). Pièces d'exploitation et de sécurité — jamais de suppression sèche.
  rapportPms:
    /feuille de caisse|feuille de situation|contr[ôo]le des annulations|^guests$|emergency report|r[ée]servations\s*:\s*annulations|hotsoft/i,
  pmsSenders: /@htbm\.fr|weareplanet\.com/i,
  // Un mail qui porte la parole d'un HUMAIN d'en face (réponse dans un fil, message d'un voyageur
  // relayé par l'OTA) ne part jamais à la corbeille sur le seul critère de l'expéditeur.
  //     (« message d'un client via l'App » = LoungeUp, cf `loungeUpClientMsg` — c'est la parole
  //     d'un client, au même titre qu'un message de voyageur relayé par une OTA.)
  guestMessage:
    /nous a envoy[ée] ce message|message re[çc]u de la part d|message d[’' ]?un (?:voyageur|client)|attend d[’' ]?[êe]tre lu/i,
  // Idem pour tout ce qui parle d'argent (facture, impayé) : jamais de suppression à l'aveugle.
  moneyHook: /\binvoice\b|impay[ée]|outstanding|relance de paiement/i,
  // Un voyageur (ou son agence) réclame une facture. Vu en masse le 2026-07-17 : les 4 voyageurs
  // CWT du 22/07 envoient tous, via la messagerie Expedia, le même « CWT guest requires invoice ».
  // Ce n'est pas une question ouverte → c'est la même famille que Hotelbeds (`invoice_note`).
  invoiceRequest: /requires? (?:an? )?invoice|need(?:s)? (?:an? )?invoice|demande.{0,15}factur|souhaite.{0,15}factur|besoin.{0,10}factur/i,
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

  // 1c-bis) Service Clients Booking : le client a accepté notre proposition d'annuler sans frais
  //     -> dossier clos côté Booking, on CLASSE (Martin 2026-07-17). Jamais `delete` : le mail
  //     est la trace écrite de l'accord du client sur un geste commercial.
  if (rx.bookingCsFrom.test(from) && rx.bookingCsResolved.test(hay)) {
    return {
      category: 'litige_ota',
      action: 'archive',
      reason: 'Litige Booking clos (client a accepté l’annulation sans frais) → à classer ; le remboursement éventuel se solde dans le PMS',
      detail: { dossier: subj.match(/Dossier\s+(\d{6,})/i)?.[1] || null },
    };
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
  //   Troisième cas depuis le 2026-07-23 : un mail qui nous DEMANDE quelque chose (mettre à jour
  //   notre fiche dans une brochure, compléter un formulaire) n'est pas de la pub, même si
  //   l'expéditeur en envoie aussi — « on vire, sauf si c'est une demande » (Martin).
  const humanThread = rx.reply.test(subj) || rx.guestMessage.test(hay);
  const aboutMoney = rx.facture.test(hay) || rx.moneyHook.test(hay);
  const asksSomething = rx.demandeHook.test(hay);
  const senderDeleteOk = !humanThread && !aboutMoney && !asksSomething;

  // 1e-bis) NOS PROPRES confirmations de réservation Mews -> corbeille (Martin 2026-07-23 :
  //     « ça dégage, pense écologie »). C'est la copie d'un mail que Mews a déjà envoyé au
  //     client : elle n'apprend rien à la réception et occupe du stockage pour rien.
  //     ⚠️ RÈGLE VOLONTAIREMENT ÉTROITE. `noreply@mews.li` envoie 5 familles distinctes
  //     (41 mails inventoriés le 2026-07-23) : 31 confirmations, 5 annulations automatiques
  //     pour non-présentation (qui, elles, PORTENT UNE INFO — cf. le dossier Galand), 2 de
  //     nos factures (archivées par la règle 1d), 1 lien d'authentification, et surtout
  //     2 « [ACTION REQUIRED] Groupe de réservation » qui appellent une action. Élargir au
  //     seul expéditeur jetterait les quatre autres familles.
  //     Placé APRÈS le garde-fou : une réponse humaine dans le fil reste protégée.
  if (rx.mewsSelf.test(from) && rx.mewsConfirmation.test(subj) && senderDeleteOk) {
    return { category: 'facture_interne', action: 'delete', reason: 'Copie de notre confirmation de réservation Mews (déjà envoyée au client)', detail: {} };
  }

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
  //     ⚠️ Le MESSAGE LIBRE d'un client via l'app passe par le même expéditeur mais n'est pas un
  //     formulaire → brouillon de réponse, pas `presejour_check` (Martin 2026-07-17 : « pour les
  //     retours clients met les mails en brouillon »). Testé sur le vrai mail Laursen.
  if (rx.loungeUp.test(from) && rx.loungeUpClientMsg.test(hay)) {
    return { category: 'client_msg', action: 'draft_reply', reason: 'Message d’un client via l’app LoungeUp → brouillon de réponse', detail: { channel: 'loungeup' } };
  }
  if (rx.loungeUp.test(from) && !humanThread) {
    return { category: 'pre_sejour', action: 'presejour_check', reason: 'Formulaire pré-séjour client (à lire)', detail: {} };
  }

  // 1h-bis) MESSAGE D'UN VOYAGEUR RELAYÉ PAR EXPEDIA (2026-07-17). Trou repéré au backtest du
  //     2026-07-13 et jamais bouché : `donotreply@expediapartnercentral.com` envoie À LA FOIS de
  //     la pub ET la parole des voyageurs. Le garde-fou `senderDeleteOk` les sauvait de la
  //     corbeille, mais personne ne les classait → ils dormaient en `autre/none`.
  //     ⚠️ L'expéditeur porte un sous-domaine ALÉATOIRE (`ikxc1ex2mf@m.expediapartnercentral.com`)
  //     → matcher le domaine, jamais la boîte.
  //     Placé AVANT la règle pub du même expéditeur.
  if (/expediapartnercentral\.com/i.test(from) && rx.guestMessage.test(hay)) {
    const guest = subj.match(/voyageur Expedia\s*:\s*(.+?)\s*$/i)?.[1]?.trim() || null;
    // Le message ne pose pas une question, il réclame une facture (« CWT guest requires
    // invoice ») → même traitement que Hotelbeds : une note actionnable, pas un brouillon.
    if (rx.invoiceRequest.test(hay)) {
      return {
        category: 'facture_ota', action: 'invoice_note',
        reason: `Voyageur Expedia réclame une facture${guest ? ` (${guest})` : ''}`,
        // `cwt` : le message dit « CWT guest requires invoice ». La facture ne s'envoie alors
        // PAS par mail — elle se dépose sur le lien du mail Conferma de la même résa. Le mot
        // n'est que dans le CORPS (le sujet ne porte que le nom du voyageur) → on le remonte ici.
        detail: { ota: 'Expedia', guest, cwt: /\bCWT\b/.test(hay) },
      };
    }
    return {
      category: 'client_msg', action: 'draft_reply',
      reason: 'Message d’un voyageur Expedia → brouillon de réponse',
      detail: { channel: 'expedia', guest },
    };
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

  // 1k) Confirmation de commande / livraison Cuisine Solutions (surgelé) -> consigne datée du
  //     jour de LIVRAISON pour contrôle réception (Martin 2026-07-22). Détecté par l'expéditeur
  //     OU par le corps (Nina relaie souvent « à imprimer », l'expéditeur devient interne).
  //     ⚠️ DOIT passer AVANT la règle 3 « facture fournisseur en PJ » : le PDF du bon s'appelle
  //     « 00053663.pdf » → `looksLikeFacturePdf` (`\d{5,}`) l'enverrait à tort vers Pennylane.
  //     `hasAttachments` exigé : la date de livraison + le contenu se lisent dans le PDF (action).
  if ((rx.cuisineSolutions.test(from) || rx.cuisineSolutions.test(hay)) && rx.livraisonHook.test(hay) && mail.hasAttachments) {
    return { category: 'livraison', action: 'livraison_consigne', reason: 'Livraison Cuisine Solutions (surgelé) → consigne de contrôle réception', detail: { fournisseur: 'Cuisine Solutions' } };
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
  //   5e canal (2026-07-17) : CONFERMA CONNECT (`noreply@conferma.com`), plateforme de cartes
  //   virtuelles des agences corporate — vu avec CWT via Expedia, 4 résas d'un coup. Sujet
  //   « Réservation -<réf Expedia> », corps « Carte de crédit virtuelle tierce / Formulaire
  //   d'autorisation ». ⚠️ Piège propre à ce canal : **préautorisation plafonnée à 1 €**, au-delà
  //   la carte se BLOQUE — un réceptionniste ne peut pas le deviner, `parseConferma` le remonte.
  const isUvet = /@uvetgbt\.com/i.test(from) && /confirmation nr/i.test(subj) && !humanThread;
  const isGoelett = /goelett/i.test(from);
  const isCds = /ailleursbusiness|cdsgroupe/i.test(from) || /prestations compl[ée]mentaires/i.test(subj);
  const isConferma = /@conferma\.com/i.test(from) && !humanThread;
  if (/djocatravel/i.test(from) || isGoelett || isCds || isUvet || isConferma || (/prise en charge/i.test(subj) && /paiement/i.test(subj))) {
    const agency = isGoelett ? 'Goelett' : isCds ? 'CDS Groupe / Ailleurs Business' : isUvet ? 'UVET GBT' : isConferma ? 'Conferma' : 'Djocatravel';
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

  // 4b) Monsieur Cocktail (Gaëtan) = partenaire traiteur cocktail -> fil commercial, à la
  //     réception. Placé AVANT le fallback `client_msg` (rule 6) qui voulait un brouillon de
  //     réponse sur ses « Re: » (Martin 2026-07-22). Action `none` : il répond sur un dossier
  //     existant, la réception note « G dispo » sur la fiche — rien à envoyer automatiquement.
  if (rx.monsieurCocktail.test(from)) {
    return { category: 'commercial', action: 'none', reason: 'Monsieur Cocktail (partenaire traiteur cocktail) → fil commercial, à noter par la réception', detail: { partner: 'Monsieur Cocktail' } };
  }

  // 4c) DEMANDE D'AFFAIRES ENVOYÉE PAR LA CENTRALE BEST WESTERN -> suivi_commercial.
  //     La Corniche est un BW Plus : ses chargés de compte nous transmettent des demandes de
  //     séminaire/groupe avec une référence `BY-xxxxxxx`. Canal récurrent et productif en
  //     volume (8 dossiers en base). Placé avant la règle 5, qui ne peut pas voir le type
  //     d'événement (« Convention, Séminaire ») : il est dans le corps, hors des ~255 car.
  //     de `bodyPreview`. L'objet, lui, est stable.
  //     ⚠️ ACTION `none` — VOULU (Martin 2026-07-23) : « on classe en attendant la réponse ».
  //     Surtout PAS `commercial_followup` (fiche + relance + brouillon de pré-qualif auto) :
  //     sur ces demandes la première question n'est pas « que manque-t-il au brief ? » mais
  //     « est-ce qu'on peut seulement l'accueillir ? ». Vécu ce jour sur BY-1881460 — la salle
  //     de séminaire était déjà prise par un autre client sur l'une des deux dates ; ouvrir une
  //     fiche et envoyer des questions au prospect avant de le savoir aurait été à côté.
  //     La fiche se monte à la main, une fois la faisabilité connue.
  if (rx.bwFrom.test(from) && rx.bwLead.test(subj)) {
    return {
      category: 'commercial',
      action: 'none',
      reason: 'Demande d’affaires de la centrale Best Western → vérifier la faisabilité (salle, chambres) avant d’ouvrir un dossier',
      detail: { canal: 'Best Western', ref: subj.match(/\bBY-\d{6,}\b/i)?.[0]?.toUpperCase() || null },
    };
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
