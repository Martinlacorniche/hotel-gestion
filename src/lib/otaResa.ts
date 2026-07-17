// Parseur des mails de réservation D-EDGE (Booking.com / Expedia via no-reply@d-edge.com).
// DÉTERMINISTE (pas de LLM) : le mail D-EDGE est structuré « label / valeur » (une ligne
// chacun après conversion HTML→texte). Calé sur de VRAIS mails 2026-07 (Booking + Expedia,
// nouvelle / annulation). Cf. memory project_assistant_mails_voiles.
//
// Règle apprise (Martin) : le libellé « Tarif : OTA BB » ne dit PAS si c'est annulable.
// Le caractère Flex vs NANR se lit dans les « Conditions d'annulation » :
//   « annuler gratuitement jusqu'à N jour(s) avant » = FLEX (annulable) ;
//   « non remboursable / aucun remboursement »       = NANR.
// Le paiement : carte de crédit virtuelle (VCC, débitable à partir d'une date) vs payé
// en ligne (prépayé) vs « facturé à l'OTA » (Expedia).

// vcc         = carte virtuelle (Booking VCC OU Expedia Collect / Expedia Virtual Card) → CCV
//               couvre l'hébergement, PAS la taxe de séjour → TS à encaisser sur place.
// hotel_collect = règlement sur place / prise en charge (OTA) → tout encaisser sur place.
// charge_card = résa directe NANR : l'hôtel doit DÉBITER la carte du client (« Montant à débiter »).
// on_site     = réservation DIRECTE (moteur de l'hôtel) non prépayée → tout régler sur place.
// prepaid     = payé en ligne. ota_billed = facturé à l'OTA sans CCV (rare).
export type OtaPayment = 'vcc' | 'hotel_collect' | 'charge_card' | 'on_site' | 'prepaid' | 'ota_billed' | 'unknown';

export type OtaResa = {
  ref: string | null;             // Réf. D-EDGE (ex. 7QL1DE)
  source: string | null;          // Booking.com | Expedia | …
  kind: 'nouvelle' | 'modification' | 'annulation';
  guestName: string | null;       // "latifa chraibi"
  guestFirst: string | null;
  guestLast: string | null;
  email: string | null;
  phone: string | null;
  arrival: string | null;         // date FR brute ("vendredi 31 juillet 2026")
  arrivalISO: string | null;      // "2026-07-31" (pour matcher la résa Mews)
  departure: string | null;
  departureISO: string | null;
  bookedAtISO: string | null;     // "2026-07-10T10:01" — Date/Heure de réservation (heure de Paris)
  cancelDateISO: string | null;   // date d'annulation (annulations)
  freeCancelDaysBefore: number | null; // annulation gratuite jusqu'à N jour(s) avant l'arrivée
  penalty: string | null;         // pénalité citée (ex. « première nuit »)
  firstNightAmount: string | null; // montant 1ère nuit (récap), pour l'annulation hors délai
  nights: number | null;
  guests: number | null;
  roomType: string | null;        // "Chambre Double - Confort" / "Double room - Superior…"
  breakfast: boolean | null;      // petit-déjeuner inclus ? (Prestation)
  ratePlan: string | null;        // "OTA BB"
  amount: string | null;          // "112,50 €"
  chargeAmount: string | null;    // montant à débiter sur la carte (résa directe NANR)
  refundable: boolean | null;     // true=Flex, false=NANR, null=inconnu
  cancelText: string | null;      // phrase brute des conditions d'annulation
  genius: boolean;
  payment: OtaPayment;
  vccChargeableFrom: string | null; // yyyy-mm-dd
  specialRequests: string | null;
  // Société pour laquelle le séjour est réservé, quand l'OTA le dit dans les commentaires
  // (« This is a corporate booking for EXAIL ROBOTICS »). Sert à annoncer une facture société
  // à l'arrivée (Martin 2026-07-17) → rendu « SOCIÉTÉ <nom> » en fin de note.
  company: string | null;
};

// Valeur d'un champ « Label : valeur » — inline après « : » ou sur la ligne suivante.
function fieldAfter(lines: string[], label: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (!label.test(lines[i])) continue;
    const inline = lines[i].split(':').slice(1).join(':').trim();
    if (inline) return inline;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim()) return lines[j].trim();
    }
    return null;
  }
  return null;
}

const FR_MONTHS: Record<string, string> = {
  janvier: '01', janv: '01', février: '02', fevrier: '02', févr: '02', fevr: '02',
  mars: '03', avril: '04', avr: '04', mai: '05', juin: '06',
  juillet: '07', juil: '07', août: '08', aout: '08', septembre: '09', sept: '09',
  octobre: '10', oct: '10', novembre: '11', nov: '11', décembre: '12', decembre: '12', déc: '12', dec: '12',
};

// "vendredi 31 juillet 2026" / "04 juil. 2026" → "2026-07-31" (formats D-EDGE). null sinon.
function frDateToISO(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2})\s+([A-Za-zàâäéèêëîïôöûüç]+)\.?\s+(\d{4})/);
  if (!m) return null;
  const mm = FR_MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
}

// « Date/Heure de réservation : 10 juil. 2026 - 10:01 (Paris) » → "2026-07-10T10:01".
// Sert à rapprocher deux résas passées au même moment par le même acheteur (résas liées).
// Toutes les résas D-Edge portent l'heure de Paris : on compare des chaînes comparables,
// inutile de gérer les fuseaux.
function bookedAtToISO(s: string | null): string | null {
  const day = frDateToISO(s);
  if (!day) return null;
  const t = (s || '').match(/(\d{1,2})\s*[:h]\s*(\d{2})/);
  return t ? `${day}T${t[1].padStart(2, '0')}:${t[2]}` : day;
}

function splitName(full: string | null): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: null, last: parts[0] };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

export function parseOtaResa(subject: string, body: string): OtaResa {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const hay = body;

  const kind: OtaResa['kind'] =
    /annulation de réservation/i.test(subject) || /Date\/Heure de l['’ ]?annulation/i.test(hay) ? 'annulation'
    : /modification de réservation/i.test(subject) ? 'modification'
    : 'nouvelle';

  const ref = fieldAfter(lines, /^Réf\.?\s*D-EDGE/i)
    || (subject.match(/\b([0-9A-Z]{6})\b/)?.[1] ?? null);

  const source = (fieldAfter(lines, /^Origine\s*:/i) || '').replace(/\s*\(\d+\)\s*$/, '').trim() || null;

  const guestName = fieldAfter(lines, /^Nom client\s*:/i);
  const { first: guestFirst, last: guestLast } = splitName(guestName);
  const arrival = fieldAfter(lines, /^Arrivée\s*:/i);
  const departure = fieldAfter(lines, /^Départ\s*:/i);

  // Chambre : ligne récap "1 Chambre Double…" (FR) ou "1 Double room - Superior…" (EN) →
  // sans le compteur. On exige un chiffre en tête (ligne du récapitulatif) et on exclut
  // les lignes petit-déj / taxe.
  let roomType: string | null = null;
  for (const l of lines) {
    const m = l.match(/^\d+\s+(.*(?:chambre|\broom\b|suite|twin|studio).*)$/i);
    if (m && !/petit|déjeuner|breakfast|\btax/i.test(m[1])) { roomType = m[1].trim(); break; }
  }

  const nightsRaw = fieldAfter(lines, /^Durée\s*:/i);
  const guestsRaw = fieldAfter(lines, /^Nb de personnes\s*:/i);
  const ratePlan = fieldAfter(lines, /^Tarif\s*:/i);

  // Petit-déjeuner. RÈGLE HÔTEL (Martin 2026-07-07) : toutes les résas OTA de l'hôtel sont
  // en PDJ INCLUS → jamais « SANS PDJ » sur une résa OTA. Sinon signal positif du tarif
  // (« Petit Déjeuner inclus/compris », code BB, demi-pension) ; « Prestation : Room only /
  // sans petit-déj » = non. ⚠️ « Chambre seule » = TYPE de chambre (single), PAS un plan
  // repas (bug vécu 2026-07-07 : « Prestation : Chambre seule » + tarif BB lu « sans PDJ »).
  const isOta = /booking|expedia|hotelbeds|agoda|hotels?\.com/i.test(source || '');
  const prestation = fieldAfter(lines, /^Prestation\s*:/i);
  let breakfast: boolean | null = null;
  if (isOta || /petit[- ]?déjeuner (?:inclus|compris)|breakfast included|[-( ]BB\b|demi[- ]?pension|pension compl/i.test(`${ratePlan || ''}\n${hay}`)) {
    breakfast = true;
  } else if (prestation && /room only|sans petit|logement seul/i.test(prestation)) {
    breakfast = false;
  }

  // Flex vs NANR : d'ABORD les conditions d'annulation (fiable, présent Booking).
  const cancelMatch = hay.match(/Conditions d['’ ]?annulation\s*:\s*([^\n]+)/i);
  const cancelText = cancelMatch ? cancelMatch[1].trim() : null;
  let refundable: boolean | null = null;
  if (/annuler gratuitement|annulation gratuite/i.test(hay)) refundable = true;
  else if (/non[\s-]?remboursable|aucun remboursement|non[- ]?refundable|ne pourra pas.{0,20}annul/i.test(hay)) refundable = false;
  // Fallback (ex. Expedia qui n'envoie pas les conditions) : indices dans le NOM du tarif.
  if (refundable === null && ratePlan) {
    if (/nanr|non[\s-]?remb|non[- ]?refundable|prépai|prepay|advance|early ?booking/i.test(ratePlan)) refundable = false;
    else if (/flex|remboursable|annulable|refundable/i.test(ratePlan)) refundable = true;
  }

  const genius = /booker_is_genius|genius rate[^\n]*:?\s*yes/i.test(hay);

  // Paiement — ⚠️ Expedia Collect = CCV (Expedia Virtual Card, activée AU CHECK-IN),
  // au même titre que la VCC Booking (règle Martin 2026-07-05). Chercher la carte virtuelle
  // AVANT « facturé à l'OTA » (le mail Expedia Collect dit les deux).
  let payment: OtaPayment = 'unknown';
  let vccChargeableFrom: string | null = null;
  if (/carte de crédit virtuelle|virtual credit card|expedia virtual card|expedia collect/i.test(hay)) {
    payment = 'vcc';
    vccChargeableFrom = hay.match(/débiter dès le\s*(\d{4}-\d{2}-\d{2})/i)?.[1]
      || hay.match(/VCC Activation Date\s*:\s*(\d{4}-\d{2}-\d{2})/i)?.[1]
      || (/from the time of check-?in|activ[ée].{0,20}check-?in|au check-?in/i.test(hay) ? 'check-in' : null);
  } else if (/hôtel collect|hotel collect/i.test(hay)) {
    payment = 'hotel_collect';
  } else if (/payé en ligne par le client/i.test(hay)) {
    payment = 'prepaid';
  } else if (/devra être facturé à/i.test(hay)) {
    payment = 'ota_billed';
  } else if (/montant à débiter|devez débiter la carte|débiter la carte bancaire/i.test(hay)) {
    payment = 'charge_card';   // résa directe NANR : l'hôtel débite la carte du client
  }
  const chargeAmount = payment === 'charge_card' ? fieldAfter(lines, /^Montant à débiter/i) : null;
  // Réservation DIRECTE (moteur de l'hôtel, ex. « Hôtels Toulon Bord De Mer ») non prépayée :
  // « Montant payé en ligne » > 0 → prépayé ; sinon → tout à régler sur place.
  if (payment === 'unknown' && /Moteur de réservation/i.test(hay)) {
    const paidRaw = fieldAfter(lines, /^Montant payé en ligne/i) || '0';
    const paid = parseFloat(paidRaw.replace(/[^\d,]/g, '').replace(',', '.')) || 0;
    payment = paid > 0 ? 'prepaid' : 'on_site';
  }

  const comm = fieldAfter(lines, /^Commentaires\s*:/i);
  const specialRequests = comm && !/carte de crédit virtuelle/i.test(comm) ? comm : null;

  // Horodatage de la réservation (⚠️ pas celui de l'annulation, dont le libellé est proche).
  const bookedAtISO = bookedAtToISO(fieldAfter(lines, /^Date\/Heure de r[ée]servation/i));

  // Annulation : date d'annulation + délai gratuit + pénalité (pour flaguer « à facturer »).
  const cancelDateISO = kind === 'annulation'
    ? frDateToISO(fieldAfter(lines, /^Date\/Heure de l['’ ]?annulation/i)) : null;
  const freeCancelDaysBefore = (() => {
    const m = hay.match(/annuler gratuitement[^.]*?(\d+)\s*jour/i) || hay.match(/gratuit[^.]*?(\d+)\s*jour/i);
    return m ? parseInt(m[1], 10) : null;
  })();
  const penalty = /première nuit|montant de la première nuit/i.test(hay) ? 'première nuit'
    : /totalité du séjour|montant total/i.test(hay) && refundable === false ? 'totalité' : null;
  // Montant 1ère nuit : 1er montant "xxx,xx" après la ligne chambre du récapitulatif.
  const firstNightAmount = (() => {
    const idx = roomType ? lines.findIndex((l) => l.includes(roomType)) : -1;
    if (idx < 0) return null;
    for (let i = idx + 1; i < Math.min(lines.length, idx + 8); i++) {
      const m = lines[i].match(/^(\d{1,3}(?:[  ]?\d{3})*,\d{2})\s*€?$/);
      if (m) return `${m[1]} €`;
    }
    return null;
  })();

  return {
    ref, source, kind,
    guestName, guestFirst, guestLast,
    email: fieldAfter(lines, /^Email client\s*:/i),
    phone: fieldAfter(lines, /^Téléphone\s*:/i),
    arrival, arrivalISO: frDateToISO(arrival),
    departure, departureISO: frDateToISO(departure),
    bookedAtISO, cancelDateISO, freeCancelDaysBefore, penalty, firstNightAmount,
    nights: nightsRaw ? (parseInt(nightsRaw, 10) || null) : null,
    guests: guestsRaw ? (parseInt(guestsRaw, 10) || null) : null,
    roomType, breakfast, ratePlan, chargeAmount,
    amount: fieldAfter(lines, /^Montant total du séjour/i),
    refundable, cancelText, genius, payment, vccChargeableFrom, specialRequests,
    // « This is a corporate booking for EXAIL ROBOTICS » — Booking le pose dans les
    // Commentaires ET dans « Informations Booking.com ». On s'arrête au premier point/retour
    // de ligne, sinon on ramasse la phrase suivante (« BED PREFERENCE:… »).
    company: (hay.match(/corporate booking for\s+([^\n.]{2,60})/i)?.[1] || '').trim() || null,
  };
}

// Note de contrôle réception (format court, à coller/copier). `dejaVenu` vient de Mews
// (Voiles only) ; null = information non disponible (ex. La Corniche, hors Mews).
//
// Taxe de séjour (règle Martin 2026-07-05) : liée au CCV. Quand le paiement est une
// carte de crédit virtuelle, la TS est quasi toujours à régler SUR PLACE (la CCV ne
// couvre que l'hébergement). Montant exact = total Mews − montant chargé sur la CCV —
// non calculable à la résa (CCV activée plus tard), d'où « à vérifier ». Hors VCC
// (prépayé plein / facturé OTA) on n'affirme rien sur la TS : la réception juge.
// jj/mm depuis un ISO yyyy-mm-dd (sinon renvoie tel quel, ex. "check-in").
export function ddmm(d: string | null): string {
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : (d || '');
}

// Prise en charge AGENCE (Djocatravel…) sur une résa OTA : l'agence fournit une carte à
// débiter et précise ce qu'elle couvre (souvent la taxe de séjour). ⚠️ On ne stocke JAMAIS
// le n° de carte complet — seulement les 4 derniers (la réception lit la carte dans le mail).
export type AgencyTakeover = {
  // 'cds_booking' = variante `bookings@cdsgroupe.com` « RAPPEL DE PAIEMENT … payée par
  // Booking » : PAS une prise en charge par carte agence — la chambre est sur la VCC
  // Booking, il n'y a RIEN à débiter, seule une confirmation de réception est attendue.
  // 'conferma' = Conferma Connect (`noreply@conferma.com`), plateforme de cartes virtuelles
  // des agences corporate (vu avec CWT, via Expedia). Le client N'A PAS la carte.
  provider: 'djoca' | 'goelett' | 'cds' | 'cds_booking' | 'uvet' | 'conferma';
  agency: string;
  ref: string | null;
  bookingRef: string | null; // réf Booking.com (Goelett / CDS)
  guestName: string | null;
  guestLast: string | null;
  checkInISO: string | null;
  nights: number | null;
  room: string | null;
  tsCovered: boolean;        // l'agence prend en charge la taxe de séjour
  debitAtArrival: boolean;   // débiter à l'arrivée / au check-in (pas de pré-autorisation)
  cardLast4: string | null;
  tsAmount: string | null;   // montant TS prépayé sur la carte agence (Goelett)
  roomAmount: string | null; // montant chambre couvert par l'OTA (Goelett → Booking)
  invoiceTo: string | null;  // entité à qui facturer (Goelett Sp. z o.o. / Ailleurs Business…)
  company?: string | null;   // société donneuse d'ordre (CDS corporate, ex. PAPREC HAVAS)
  // ⚠️ Plafond de PRÉAUTORISATION imposé par l'agence, en euros. Conferma/CWT : « ne pas
  // effectuer de préautorisation supérieure à 1 euro […] car cela pourrait entraîner le
  // BLOCAGE DE LA CARTE ». Un réceptionniste ne peut pas deviner ça → ça doit être dans la note.
  preAuthMaxEur?: number | null;
  totalAmount?: string | null; // coût total estimatif annoncé par l'agence
};

// Bloc « taxe de séjour » de la note réception selon l'agence de prise en charge :
//   Goelett = TS prépayée sur une 2e CCV dédiée → « CCV TS …xxxx » (débiter cette carte) ;
//   CDS/Ailleurs Business = carte agence (n° derrière un lien) → « CCV TS CDS — déb. check-in » ;
//   Djoca = TS incluse dans la prise en charge → « TS incl. agence ».
export function agencyTsBlock(t: AgencyTakeover): string {
  if (t.provider === 'goelett') return `CCV TS …${t.cardLast4 || '????'}`;
  if (t.provider === 'cds') return 'CCV TS CDS — déb. check-in';
  if (t.provider === 'cds_booking') return 'RSP TS';   // payé par Booking, TS non couverte
  return 'TS incl. agence';
}

export function parseAgencyTakeover(subject: string, body: string): AgencyTakeover {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const hay = body;
  const guestName = fieldAfter(lines, /^GUEST NAME/i);
  let guestLast: string | null = null;
  if (guestName) {
    const cleaned = guestName.replace(/^(Mr|Mme|M\.|Mrs?|Ms)\.?\s+/i, '').trim();
    guestLast = cleaned.match(/\b([A-ZÀ-Ÿ]{2,})\b/)?.[1] || cleaned.split(/\s+/)[0] || null;
  }
  const checkInRaw = fieldAfter(lines, /^CHECK ?IN DATE/i);
  const checkInISO = checkInRaw ? (checkInRaw.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || null) : null;
  const nightsRaw = fieldAfter(lines, /^NUMBERS? OF NIGHTS|NIGHTS?\s*\/\s*ROOMS/i);
  const room = lines.find((l) => /chambre|\broom\b/i.test(l) && !/GUEST|NUMBERS|NIGHTS/i.test(l)) || null;
  const cardNum = hay.match(/Num[ée]ro\s*:?\s*(\d[\d ]{10,})/i)?.[1]?.replace(/\s/g, '') || null;
  return {
    provider: 'djoca',
    agency: 'Djocatravel',
    ref: fieldAfter(lines, /^REF fournisseur/i) || subject.match(/Paiement\s+(\d{6,})/i)?.[1] || null,
    bookingRef: null,
    guestName, guestLast, checkInISO,
    nights: nightsRaw ? (parseInt(nightsRaw, 10) || null) : null,
    room,
    tsCovered: /prenons en charge[\s\S]{0,50}taxe de séjour|taxe de séjour[\s\S]{0,30}(pris|charge)/i.test(hay),
    debitAtArrival: /débiter.{0,30}(arrivée|à l['’ ]?arriv)/i.test(hay) || /pas.{0,15}pré[- ]?auto/i.test(hay),
    cardLast4: cardNum ? cardNum.slice(-4) : null,
    tsAmount: null,
    roomAmount: null,
    invoiceTo: null,
  };
}

// Prise en charge GOELETT (partenaire paiement de Booking) — format TOTALEMENT différent
// de Djoca : le nom client + les réfs sont dans le sujet, la carte virtuelle (VCC dédiée)
// ne couvre QUE la taxe de séjour, la chambre étant facturée à Booking. Calé sur un vrai
// mail 2026-07 (noreply-hotel@goelett.email). Règle (Martin 2026-07-06) : la TS est PRÉPAYÉE
// sur la carte Goelett → à DÉBITER, NE PAS facturer au client ; facture au nom de Goelett.
export function parseGoelett(subject: string, body: string): AgencyTakeover {
  const hay = body;
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);

  const guestName = subject.match(/paiement pour\s+(.+?)\s+pour la r[ée]servation/i)?.[1]?.trim()
    || hay.match(/Porte-cartes?\s+([A-Za-zÀ-ÿ' -]{3,40}?)\s+[\d.,]+\s*EUR/i)?.[1]?.trim() || null;
  let guestLast: string | null = null;
  if (guestName) {
    const toks = guestName.replace(/^(Mr|Mme|M\.|Mrs?|Ms)\.?\s+/i, '').trim().split(/\s+/);
    guestLast = toks[toks.length - 1] || null;
  }

  const ref = subject.match(/r[ée]servation\s+d['’ ]?h[ôo]tel\s+([A-Z0-9]{5,})/i)?.[1]
    || hay.match(/r[ée]servation dans Goelett[^:]*:\s*([A-Z0-9]{5,})/i)?.[1] || null;
  const bookingRef = hay.match(/r[ée]servation dans Booking\.com\s*:\s*(\d{6,})/i)?.[1] || null;

  const toISO = (d?: string) => {
    const m = d?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };
  const stay = subject.match(/du\s+(\d{2}\/\d{2}\/\d{4})\s+au\s+(\d{2}\/\d{2}\/\d{4})/i)
    || hay.match(/Dates du S[ée]jour\s*:?\s*(\d{2}\/\d{2}\/\d{4})\s*[-–]\s*(\d{2}\/\d{2}\/\d{4})/i);
  const checkInISO = toISO(stay?.[1]);
  const departISO = toISO(stay?.[2]);
  const nights = checkInISO && departISO
    ? Math.round((Date.parse(departISO) - Date.parse(checkInISO)) / 86400e3) || null : null;

  const room = lines.find((l) => /^chambre\s+(double|simple|twin|triple|deluxe|standard|familiale|sup)/i.test(l))
    ?.match(/^(chambre\s+[a-zà-ÿ]+(?:\s+sup[ée]rieure|\s+[a-zà-ÿ]+)?)/i)?.[1]?.trim() || null;

  // TS = montant ancré sur « … EUR - taxe de séjour » (précis), sinon « montant de X EUR ».
  const tsAmount = hay.match(/([\d.,]+)\s*EUR[^\n]{0,6}[-–][^\n]{0,6}taxe de s[ée]jour/i)?.[1]
    || hay.match(/d[ée]biter la carte[^.\n]{0,40}?montant de\s*([\d.,]+)\s*EUR/i)?.[1] || null;
  const roomAmount = hay.match(/montant restant de la r[ée]servation\s*([\d.,]+)\s*EUR/i)?.[1] || null;

  // n° VCC (16 chiffres) → NE GARDER QUE LES 4 DERNIERS, jamais le numéro complet.
  const cardNum = hay.match(/\b(\d{15,16})\b/)?.[1] || null;

  return {
    provider: 'goelett',
    agency: 'Goelett',
    ref, bookingRef,
    guestName, guestLast, checkInISO, nights, room,
    tsCovered: true,          // Goelett = TS toujours prépayée sur la carte dédiée
    debitAtArrival: false,    // « activée le jour de la résa, débitable immédiatement »
    cardLast4: cardNum ? cardNum.slice(-4) : null,
    tsAmount: tsAmount ? `${tsAmount} €` : null,
    roomAmount: roomAmount ? `${roomAmount} €` : null,
    invoiceTo: 'Goelett Sp. z o.o.',
  };
}

// Prise en charge CDS GROUPE / AILLEURS BUSINESS (agence corporate, ex. CCI Paris IdF).
// Une carte MasterCard virtuelle de l'agence couvre la taxe de séjour (+ petit-déj si non
// inclus) à débiter DÈS LE CHECK-IN. ⚠️ Le n° de carte est DERRIÈRE UN LIEN (pas dans le
// mail → pas de last-4). Facture à libeller à AILLEURS BUSINESS, envoyée à FACTURE@CDSGROUPE.COM.
// Ne rien réclamer au voyageur. Calé sur un vrai mail 2026-07 (noreply@ailleursbusiness.com).
export function parseCds(subject: string, body: string): AgencyTakeover {
  const hay = body;
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);

  // Sujet : « … - <REF> - <Nom voyageur> - jj/mm/aaaa »
  const parts = subject.split(/\s+-\s+/).map((s) => s.trim());
  const guestName = hay.match(/Nom du voyageur\s+([A-Za-zÀ-ÿ'’\- ]{3,40}?)\s*(?:Commentaire|Date|$)/i)?.[1]?.trim()
    || (parts.length >= 3 ? parts[2] : null);
  let guestLast: string | null = null;
  if (guestName) {
    const toks = guestName.replace(/^(Mr|Mme|M\.|Mrs?|Ms)\.?\s+/i, '').trim().split(/\s+/);
    guestLast = toks[toks.length - 1] || null;
  }

  const ref = hay.match(/R[ée]f[ée]rence CDS GROUPE\s+([A-Z0-9]{4,})/i)?.[1]
    || (parts.length >= 2 ? parts[1] : null);
  const bookingRef = hay.match(/r[ée]servation Booking\.com N[°ºo]\s*(\d{6,})/i)?.[1]
    || hay.match(/Booking\.com\s+[\d-]*?(\d{7,})/i)?.[1] || null;

  const dm = subject.match(/(\d{2})\/(\d{2})\/(\d{4})\s*$/);
  const checkInISO = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null;

  // « Type de tarif / chambre  ONLINE PAYMENT - genius - Chambre Double » (pas de « : » → regex directe).
  const rateLine = hay.match(/Type de tarif ?\/ ?chambre\s+([^\n]+)/i)?.[1] || '';
  const room = rateLine.match(/(Chambre\s+[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+)?)/i)?.[1]?.trim() || null;

  return {
    provider: 'cds',
    agency: 'CDS Groupe / Ailleurs Business',
    ref, bookingRef,
    guestName, guestLast, checkInISO, nights: null, room,
    tsCovered: true,
    debitAtArrival: true,     // « à partir du jour du check-in »
    cardLast4: null,          // n° derrière un lien, absent du mail
    tsAmount: null, roomAmount: null,
    invoiceTo: 'Ailleurs Business (FACTURE@CDSGROUPE.COM)',
  };
}

// UVET GBT (`hotelbookings@uvetgbt.com`) = agence corporate italienne, sous-licenciée American
// Express Global Business Travel. Découvert 2026-07-16 (résa CUOZZO). Parseur DÉDIÉ : sans lui,
// `parseTakeover` retomberait sur le parseur Djoca et produirait une note fausse (l'erreur déjà
// faite sur Goelett le 2026-07-07).
//
// Tout est dans le SUJET, en 5 blocs séparés par ` - ` :
//   « CONFIRMATION NR. 26/2839504 - H9S4KK - 724636660 - MR/MRS OLIMPIA CUOZZO
//     - CHECK-IN 13/07/2026 CHECK-OUT 16/07/2026 »
// Le corps ne porte QUE la consigne (« UVET GBT S.P.A. CREDIT CARD HEREBY ATTACHED TO BE CHARGED
// FOR THIS BOOKING ») : la carte est dans une PJ `CreditCard_<réf>.pdf` → aucun last-4 lisible
// (même situation que CDS, où le n° est derrière un lien).
//
// ⚠️ FENÊTRE D'ACCÈS COURTE, citée par le mail : le n° n'est accessible que 5 jours après la
// réservation, puis de J-1 avant l'arrivée jusqu'à J+2 après le départ → un mail traité trop tard
// = carte inaccessible. Vécu le 2026-07-16 : la réception a dû réclamer la carte le matin même du
// départ. D'où `debitAtArrival` et l'urgence portée dans la note.
export function parseUvet(subject: string, body: string): AgencyTakeover {
  const parts = subject.split(/\s+-\s+/).map((s) => s.trim());

  const ref = subject.match(/CONFIRMATION NR\.?\s*([\d/]+)/i)?.[1] || null;
  // 2e bloc = notre référence hôtel (ex. H9S4KK) ; 3e = le n° de dossier UVET.
  const bookingRef = parts[1]?.match(/^[A-Z0-9]{5,8}$/i) ? parts[1] : null;

  const guestName = subject.match(/MR\/MRS\s+([A-Za-zÀ-ÿ'’\- ]{3,40}?)\s*(?:-\s*CHECK-IN|$)/i)?.[1]?.trim() || null;
  let guestLast: string | null = null;
  if (guestName) {
    const toks = guestName.replace(/^(Mr|Mme|M\.|Mrs?|Ms)\.?\s+/i, '').trim().split(/\s+/);
    guestLast = toks[toks.length - 1] || null;
  }

  const ci = subject.match(/CHECK-IN\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  const co = subject.match(/CHECK-OUT\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  const checkInISO = ci ? `${ci[3]}-${ci[2]}-${ci[1]}` : null;
  const checkOutISO = co ? `${co[3]}-${co[2]}-${co[1]}` : null;

  let nights: number | null = null;
  if (checkInISO && checkOutISO) {
    const d = (Date.parse(checkOutISO) - Date.parse(checkInISO)) / 86400000;
    nights = Number.isFinite(d) && d > 0 ? d : null;
  }

  return {
    provider: 'uvet',
    agency: 'UVET GBT',
    ref, bookingRef,
    guestName, guestLast, checkInISO, nights, room: null,
    // Le mail dit « CREDIT CARD … TO BE CHARGED FOR THIS BOOKING » sans détailler le périmètre :
    // on n'AFFIRME donc pas que la taxe de séjour est couverte (règle maison : on n'invente pas
    // ce que l'agence n'écrit pas).
    tsCovered: false,
    debitAtArrival: true,
    cardLast4: null,           // carte en PJ (PDF) → pas de last-4 lisible dans le corps
    tsAmount: null, roomAmount: null,
    invoiceTo: null,
  };
}

// CONFERMA CONNECT (`noreply@conferma.com`) — 5e canal de prise en charge (2026-07-17).
// Plateforme de cartes virtuelles des agences corporate ; vu avec **CWT** (Carlson Wagonlit
// Travel) sur des résas passées via Expedia. Sujet : « Réservation -<réf Expedia> ».
// Le mail est un « Formulaire d'autorisation — Carte de crédit virtuelle tierce » :
//   · « Cette réservation doit être débitée sur la carte virtuelle » — **le client n'a PAS la carte** ;
//   · transaction **sans présentation de la carte** (CNP) ;
//   · ⚠️⚠️ **« ne pas effectuer de préautorisation sur la carte supérieure à 1 euro et ne pas
//     saisir le code de préautorisation, car cela pourrait entraîner le BLOCAGE de la carte »**
//     → piège coûteux, invisible pour un réceptionniste : la note DOIT le porter ;
//   · « Tout supplément non inclus dans le prix de la chambre doit être payé par le voyageur au
//     moment du départ » → la carte ne couvre QUE la chambre ⇒ **TS sur place** (tsCovered=false) ;
//   · « Le paiement de la commission est effectué comme d'habitude à Expedia ».
// ⚠️ N° de carte JAMAIS stocké (4 derniers max) — cf règle maison.
export function parseConferma(subject: string, body: string): AgencyTakeover {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const hay = body;

  // Réf Expedia : dans le sujet (« Réservation -2511874454 ») et dans « Numéro de confirmation ».
  const ref = subject.match(/-\s*(\d{6,})/)?.[1]
    || fieldAfter(lines, /^Num[ée]ro de confirmation/i)?.match(/\d{6,}/)?.[0] || null;

  const guestName = fieldAfter(lines, /^Nom du client/i);
  let guestLast: string | null = null;
  if (guestName) {
    // « Mr VALENTIN VELLA » → VELLA. Le nom est en capitales, le prénom aussi : on prend le
    // DERNIER mot une fois la civilité retirée.
    const cleaned = guestName.replace(/^(Mr|Mme|M\.|Mrs?|Ms)\.?\s+/i, '').trim();
    const toks = cleaned.split(/\s+/).filter(Boolean);
    guestLast = toks.length ? toks[toks.length - 1] : null;
  }

  // « mercredi, 22 juillet 2026 (22/07/2026) » → on prend la forme entre parenthèses, non ambiguë.
  const checkInRaw = fieldAfter(lines, /^Date d[’' ]?arriv[ée]e/i) || '';
  const dm = checkInRaw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const checkInISO = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null;

  const nightsRaw = fieldAfter(lines, /^Nombre de nuits/i);
  const nights = nightsRaw ? (parseInt(nightsRaw, 10) || null) : null;

  const totalRaw = fieldAfter(lines, /^Co[ûu]t total/i);
  const totalAmount = totalRaw?.match(/[\d.,]+\s*EUR|[\d.,]+\s*€/i)?.[0]?.trim() || totalRaw || null;

  // Agence donneuse d'ordre : « effectuée par CWT ». Le libellé est court et en capitales.
  const company = hay.match(/effectu[ée]e par\s*\n?\s*([A-Z][A-Za-z0-9 &.'-]{1,40})/)?.[1]?.trim() || null;

  // Plafond de préautorisation (« pas de préautorisation supérieure à 1 euro »).
  const preAuth = hay.match(/pr[ée]autorisation[^.]{0,40}?sup[ée]rieure?\s*à\s*(\d+(?:[.,]\d+)?)\s*euro/i)?.[1];
  const preAuthMaxEur = preAuth ? parseFloat(preAuth.replace(',', '.')) : null;

  return {
    provider: 'conferma',
    agency: company ? `Conferma / ${company}` : 'Conferma',
    ref, bookingRef: null,
    guestName, guestLast, checkInISO, nights, room: null,
    // La carte ne couvre QUE la chambre : « tout supplément non inclus … payé par le voyageur
    // au moment du départ » ⇒ la taxe de séjour reste à encaisser sur place.
    tsCovered: false,
    debitAtArrival: true,
    // ⚠️ PAS DE LAST-4 POSSIBLE : le n° de carte n'est PAS dans le mail (vérifié sur le HTML
    // brut des 4 mails du 2026-07-17 — seuls les LIBELLÉS « Numéro de carte / Visa / Mastercard
    // / expiration » y figurent). La carte est derrière le lien `confermaconnect.com/email/
    // booking?guid=…`. Même situation que CDS/Ailleurs Business.
    cardLast4: null,
    tsAmount: null, roomAmount: null,
    invoiceTo: null,
    company,
    preAuthMaxEur,
    totalAmount,
  };
}

// Résa SWILE (`travel@notification.swile.co`) = agence voyage d'affaires. Format PROPRE à
// Swile (pas D-Edge) : « réservation pour <NOM> du <date> au <date> », « Cette réservation
// est prépayée », « Montant : €X », « Type de chambre : … », + des « Demandes spécifiques »
// du voyageur (arrivée tardive, parking…). Prépayé → NE RIEN réclamer au voyageur pour la
// chambre, pas de facture au client. TS = À RÉGLER SUR PLACE (Martin 2026-07-15, cité du mail :
// « toute dépense non incluse… réglée directement sur place »). Retourne un OtaResa pour
// réutiliser controlNote / l'enrichissement Mews (déjà venu + TS exacte).
export function parseSwile(subject: string, body: string): OtaResa {
  const hay = body;
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);

  const ref = subject.match(/N[°ºo]\s*(\d{6,})/i)?.[1]
    || fieldAfter(lines, /^R[ée]f[ée]rence fournisseur/i)?.match(/\d{6,}/)?.[0] || null;

  const guestName = hay.match(/r[ée]servation pour\s+([A-Za-zÀ-ÿ'’ \-]+?)\s+du\s/i)?.[1]?.trim() || null;
  const toks = guestName ? guestName.split(/\s+/) : [];
  const guestFirst = toks.length ? toks[0] : null;
  const guestLast = toks.length ? toks[toks.length - 1] : null;

  const arrivalRaw = fieldAfter(lines, /^Arriv[ée]e/i);
  const departureRaw = fieldAfter(lines, /^D[ée]part/i);
  const roomType = fieldAfter(lines, /^Type de chambre/i);
  const guestsRaw = fieldAfter(lines, /^Nombre de voyageurs/i);

  const amountRaw = hay.match(/Montant\s*:?\s*€?\s*([\d]+[.,]\d{2})/i)?.[1] || null;
  const amount = amountRaw ? `${amountRaw.replace('.', ',')} €` : null;

  // Demandes spécifiques : les lignes à puce « - … » sous « Demandes spécifiques ».
  const reqs = lines.filter((l) => /^[-•]\s*/.test(l)).map((l) => l.replace(/^[-•]\s*/, '').trim());
  const specialRequests = reqs.length ? reqs.join(' ; ') : null;

  return {
    ref, source: 'Swile', kind: 'nouvelle',
    guestName, guestFirst, guestLast, email: null, phone: null,
    // Swile EST déjà un canal d'entreprise : le nom de la société employeuse n'est pas dans le
    // mail, et « SOCIÉTÉ » n'apprendrait rien de plus à la réception que « PRÉPAYÉ Swile ».
    company: null,
    arrival: arrivalRaw, arrivalISO: frDateToISO(arrivalRaw),
    departure: departureRaw, departureISO: frDateToISO(departureRaw),
    bookedAtISO: null, cancelDateISO: null, freeCancelDaysBefore: null,
    penalty: null, firstNightAmount: null,
    nights: null, guests: guestsRaw ? parseInt(guestsRaw, 10) || null : null,
    roomType, breakfast: true, ratePlan: null, amount, chargeAmount: null,
    refundable: null, cancelText: null, genius: false,
    payment: 'prepaid', vccChargeableFrom: null, specialRequests,
  };
}

// Variante CDS `bookings@cdsgroupe.com` : « RAPPEL DE PAIEMENT … CDS GROUPE - <REF> - <Nom> »
// avec « Mode de paiement : payée par Booking.com » → la chambre est sur la VCC Booking, il n'y
// a RIEN à débiter côté agence. Le mail veut juste qu'on CONFIRME LA RÉCEPTION (bouton/lien),
// sinon il revient tous les jours. ≠ Ailleurs Business (`parseCds`, carte agence à débiter).
export function parseCdsBooking(subject: string, body: string): AgencyTakeover {
  const hay = body;
  const parts = subject.split(/\s+-\s+/).map((s) => s.trim());
  const ref = hay.match(/R[ée]f\.?\s*CDS Groupe\s*:?\s*([A-Z0-9]{4,})/i)?.[1]
    || hay.match(/r[ée]servation CDS GROUPE N[°ºo]\s*([A-Z0-9]{4,})/i)?.[1]
    || (parts.length >= 4 ? parts[3] : null);
  const bookingRef = hay.match(/R[ée]f\.?\s*Fournisseur\s*:?\s*Booking\.com\s*([\d][\d-]{6,})/i)?.[1]
    || hay.match(/Booking\.com\s+([\d][\d-]{6,})/i)?.[1] || null;
  const guestName = hay.match(/Voyageur\(s\)\s*:?\s*([A-Za-zÀ-ÿ'’ \-]{3,40}?)\s*(?:Nombre|Soci[ée]t[ée]|R[ée]f|$)/i)?.[1]?.trim()
    || (parts.length >= 5 ? parts[4] : null);
  const guestLast = guestName ? guestName.split(/\s+/).pop() || null : null;
  const company = hay.match(/Soci[ée]t[ée]\s*:?\s*([A-Za-zÀ-ÿ0-9'’ &\-]{2,40}?)\s*(?:Arriv[ée]e|R[ée]f|$)/i)?.[1]?.trim() || null;
  const arrRaw = hay.match(/Arriv[ée]e\s*:?\s*[A-Za-zÀ-ÿ,]*\s*(\d{1,2}\s+[A-Za-zÀ-ÿ]+\.?\s+\d{4})/i)?.[1] || null;

  return {
    provider: 'cds_booking', agency: 'CDS Groupe',
    ref, bookingRef, guestName, guestLast,
    checkInISO: frDateToISO(arrRaw), nights: null, room: null,
    tsCovered: false, debitAtArrival: false, cardLast4: null,
    tsAmount: null, roomAmount: null, invoiceTo: null, company,
  };
}

// Type de chambre en CODE court réception : on garde le mot distinctif (Confort,
// Supérieure, Deluxe, Standard, Familiale…), pas « Chambre Double ». Ex :
//   « Chambre Double - Confort » → « confort » ; « Chambre double supérieure » → « supérieure ».
export function shortRoom(room: string | null): string {
  if (!room) return 'chambre';
  const words = room.split(/[^A-Za-zÀ-ÿ]+/).filter(Boolean);
  // Mots de liaison + équipements (douche, vue, mer…) = jetés. « Simple » = single, c'est
  // une CATÉGORIE valable (Martin 2026-07-07) → pas jeté. On préfère un mot de gamme
  // (confort, supérieure…) s'il y en a un ; sinon le 1er mot restant (souvent le type).
  const drop = new Set(['chambre', 'room', 'de', 'du', 'des', 'la', 'le', 'les', 'avec', 'the', 'a', 'of', 'et', 'and', 'non', 'smoking', 'fumeur', 'lit', 'bed', 'size', 'king', 'queen']);
  const amenity = new Set(['douche', 'bain', 'salle', 'vue', 'mer', 'jardin', 'balcon', 'terrasse', 'ville', 'cour', 'patio', 'eau', 'wc', 'shower', 'sea', 'view', 'grand', 'grande', 'extra', 'large']);
  const category = new Set(['supérieure', 'superieure', 'superior', 'confort', 'comfort', 'deluxe', 'luxe', 'prestige', 'standard', 'familiale', 'family', 'exécutive', 'executive', 'junior', 'suite', 'premium', 'classique', 'classic', 'économique', 'economique', 'economy']);
  const kept = words.filter((w) => !drop.has(w.toLowerCase()) && !amenity.has(w.toLowerCase()));
  const cat = kept.find((w) => category.has(w.toLowerCase()));
  const pick = cat || kept[0] || words[0] || 'chambre';
  return pick.toLowerCase();
}

// Note de contrôle réception — FORMAT GLOBAL EN CODES (Martin 2026-07-07). Squelette :
//   #<chambre> <FLEX|NANR> <paiement chambre> # <bloc taxe de séjour> <variables>
// Ex :  #confort NANR CCV # RSP TS 1,86€ GENIUS 1ER SÉJOUR
//       #supérieure NANR CCV # CCV TS …6624        (TS prépayée sur 2e CCV Goelett)
//       #familiale FLEX RSP # RSP TS               (résa directe, tout sur place)
// Codes chambre : CCV (carte virtuelle) · RSP (réglé sur place) · DÉBIT CB (débiter la carte
// client, NANR direct) · PRÉPAYÉ · OTA (facturé OTA). Bloc TS : RSP TS (sur place, +montant
// Mews si dispo) · CCV TS …xxxx (prépayée sur carte, ex. Goelett → débiter, pas le client) ·
// TS incl. agence (Djoca). PDJ inclus = défaut maison → non écrit (seul « SANS PDJ » compte).
// `linkedGuests` : clients d'AUTRES résas manifestement prises ensemble (mêmes dates, même
// canal, même horaire de réservation → cf `findLinkedResas`). Rendu « AVEC <NOM> » en fin de
// note, pour que la réception traite les chambres ensemble (Martin 2026-07-10).
export function controlNote(
  r: OtaResa, dejaVenu: boolean | null, cityTax?: number | null,
  tsOverride?: string | null, linkedGuests?: string[] | null,
): string {
  const s: string[] = [`#${shortRoom(r.roomType)}`];
  if (r.refundable === true) s.push('FLEX');
  else if (r.refundable === false) s.push('NANR');

  // paiement de la CHAMBRE
  switch (r.payment) {
    case 'vcc':          s.push(r.vccChargeableFrom ? `CCV déb.${ddmm(r.vccChargeableFrom)}` : 'CCV'); break;
    case 'charge_card':  s.push(`DÉBIT CB${r.chargeAmount ? ` ${r.chargeAmount}` : (r.amount ? ` ${r.amount}` : '')}`); break;
    case 'hotel_collect':
    case 'on_site':      s.push('RSP'); break;
    // Swile = prépayé par l'agence de voyage d'affaires → on nomme le canal (comme « OTA »).
    case 'prepaid':      s.push(r.source === 'Swile' ? 'PRÉPAYÉ Swile' : 'PRÉPAYÉ'); break;
    case 'ota_billed':   s.push('OTA'); break;
  }

  // bloc TAXE DE SÉJOUR (préfixé « # / » — le « / » sépare bien règlement chambre / règlement
  // TS, Martin 2026-07-15). tsOverride = prise en charge agence (agencyTsBlock) qui PRIME sur
  // le « sur place » ; sinon RSP TS + montant Mews exact quand dispo.
  const ts = tsOverride || (cityTax != null ? `RSP TS ${cityTax.toFixed(2).replace('.', ',')}€` : 'RSP TS');
  s.push(`# / ${ts}`);

  // variables
  if (r.breakfast === false) s.push('SANS PDJ');
  // Séjour réservé POUR une société (Booking le dit dans les commentaires) → la réception sait
  // qu'une facture société peut être réclamée à l'arrivée (Martin 2026-07-17).
  if (r.company) s.push(`SOCIÉTÉ ${r.company.toUpperCase()}`);
  // Genius volontairement PAS affiché : sans intérêt pour la réception (Martin 2026-07-09).
  if (dejaVenu === true) s.push('DÉJÀ VENU');
  else if (dejaVenu === false) s.push('1ER SÉJOUR');

  // Résa(s) liée(s) : « AVEC CAROL ABITBOL » (ou « AVEC X + 2 AUTRES » si l'acheteur a posé
  // plus de deux chambres — inutile d'allonger la note avec toute la liste).
  if (linkedGuests?.length) {
    const [first, ...rest] = linkedGuests;
    s.push(`AVEC ${first.toUpperCase()}${rest.length ? ` + ${rest.length} AUTRE${rest.length > 1 ? 'S' : ''}` : ''}`);
  }

  return s.join(' ');
}

// Champs d'une résa qui INTÉRESSENT la réception. Comparés entre la « Nouvelle réservation »
// et la « Modification » de même réf D-EDGE pour savoir ce qui a réellement bougé.
// `kind` est exclu (il diffère par construction), ainsi que les champs propres à l'annulation.
const RESA_DIFF_FIELDS = [
  'guestName', 'arrivalISO', 'departureISO', 'nights', 'guests', 'roomType', 'breakfast',
  'ratePlan', 'amount', 'chargeAmount', 'refundable', 'freeCancelDaysBefore', 'genius',
  'payment', 'vccChargeableFrom', 'specialRequests', 'company',
] as const;

const RESA_FIELD_LABELS: Record<string, string> = {
  guestName: 'nom', arrivalISO: 'arrivée', departureISO: 'départ', nights: 'nb de nuits',
  guests: 'nb de personnes', roomType: 'chambre', breakfast: 'petit-déjeuner', ratePlan: 'tarif',
  amount: 'montant', chargeAmount: 'montant à débiter', refundable: 'conditions d’annulation',
  freeCancelDaysBefore: 'délai d’annulation', genius: 'Genius', payment: 'paiement',
  vccChargeableFrom: 'date de débit CCV', specialRequests: 'demandes', company: 'société',
};

// Ce qui a changé entre deux états d'une même résa. Liste VIDE = la « modification » ne modifie
// rien (vécu le 2026-07-17, résa 1BI4XZ : D-Edge/Booking republie la résa à l'identique, seul
// l'en-tête du mail change). On compare les CHAMPS PARSÉS et pas le texte brut : le texte diffère
// toujours (« Nouvelle réservation n°X » vs « *** MODIFICATION DE RESERVATION N°X *** »).
export function resaDiff(before: OtaResa, after: OtaResa): string[] {
  return RESA_DIFF_FIELDS.filter((f) => before[f] !== after[f]).map((f) => RESA_FIELD_LABELS[f] || f);
}

// Annulation HORS DÉLAI ? (règle Martin 2026-07-05 : facturer si annulé hors délai).
// true = hors délai (à facturer), false = dans les temps (sans frais), null = indéterminable.
// Délai gratuit = arrivée − freeCancelDaysBefore ; annulé APRÈS ⇒ hors délai.
export function isLateCancellation(r: OtaResa): boolean | null {
  if (r.refundable === false) return true; // NANR : toujours dû
  if (!r.cancelDateISO || !r.arrivalISO) return null;
  if (r.freeCancelDaysBefore != null) {
    const arrival = new Date(`${r.arrivalISO}T00:00:00Z`).getTime();
    const deadline = arrival - r.freeCancelDaysBefore * 24 * 3600e3;
    const cancel = new Date(`${r.cancelDateISO}T00:00:00Z`).getTime();
    return cancel > deadline;
  }
  // Fenêtre inconnue (souvent absente du mail d'annulation) : annulé le JOUR d'arrivée
  // ou après = hors délai sous toute politique J-1 ; avant = on ne tranche pas.
  if (r.cancelDateISO >= r.arrivalISO) return true;
  return null;
}

// Note pour une ANNULATION : signale s'il faut facturer (hors délai / NANR) et sur quoi
// (CCV débitable, ou déjà payé à l'OTA). À copier par la réception.
export function cancellationNote(r: OtaResa): string {
  const bits = ['ANNULATION'];
  if (r.source) bits.push(r.source);
  const late = isLateCancellation(r);
  if (late === true) {
    bits.push('⚠️ HORS DÉLAI → À FACTURER');
    bits.push(r.penalty === 'totalité' ? 'totalité du séjour' : '1ère nuit due');
    if (r.penalty !== 'totalité' && r.firstNightAmount) bits.push(r.firstNightAmount);
    if (r.payment === 'vcc') bits.push('débiter la CCV');
    else if (r.payment === 'prepaid') bits.push('déjà payé à l’OTA (voir avec l’OTA)');
  } else if (late === false) {
    bits.push('sans frais (dans le délai)');
  } else {
    bits.push('délai à VÉRIFIER manuellement');
  }
  return bits.join(' · ');
}
