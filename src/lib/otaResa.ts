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

  // Petit-déjeuner inclus ? (champ « Prestation »). "Room only" = non.
  const prestation = fieldAfter(lines, /^Prestation\s*:/i);
  let breakfast: boolean | null = null;
  if (prestation) {
    if (/room only|sans petit|logement seul|seule/i.test(prestation)) breakfast = false;
    else if (/petit[- ]?déjeuner|breakfast|demi[- ]?pension|pension compl/i.test(prestation)) breakfast = true;
  }

  const nightsRaw = fieldAfter(lines, /^Durée\s*:/i);
  const guestsRaw = fieldAfter(lines, /^Nb de personnes\s*:/i);
  const ratePlan = fieldAfter(lines, /^Tarif\s*:/i);

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
    cancelDateISO, freeCancelDaysBefore, penalty, firstNightAmount,
    nights: nightsRaw ? (parseInt(nightsRaw, 10) || null) : null,
    guests: guestsRaw ? (parseInt(guestsRaw, 10) || null) : null,
    roomType, breakfast, ratePlan, chargeAmount,
    amount: fieldAfter(lines, /^Montant total du séjour/i),
    refundable, cancelText, genius, payment, vccChargeableFrom, specialRequests,
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
  agency: string;
  ref: string | null;
  guestName: string | null;
  guestLast: string | null;
  checkInISO: string | null;
  nights: number | null;
  room: string | null;
  tsCovered: boolean;        // l'agence prend en charge la taxe de séjour
  debitAtArrival: boolean;   // débiter à l'arrivée (pas de pré-autorisation)
  cardLast4: string | null;
};

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
    agency: 'Djocatravel',
    ref: fieldAfter(lines, /^REF fournisseur/i) || subject.match(/Paiement\s+(\d{6,})/i)?.[1] || null,
    guestName, guestLast, checkInISO,
    nights: nightsRaw ? (parseInt(nightsRaw, 10) || null) : null,
    room,
    tsCovered: /prenons en charge[\s\S]{0,50}taxe de séjour|taxe de séjour[\s\S]{0,30}(pris|charge)/i.test(hay),
    debitAtArrival: /débiter.{0,30}(arrivée|à l['’ ]?arriv)/i.test(hay) || /pas.{0,15}pré[- ]?auto/i.test(hay),
    cardLast4: cardNum ? cardNum.slice(-4) : null,
  };
}

// Note de contrôle réception — format court langage réception (Martin 2026-07-05) :
//   Chambre · [SANS PDJ] · OTA FLEX/NANR · VCC à déb. jj/mm · RSP TS <montant> · [GENIUS] · 1ER SÉJOUR
// - PDJ inclus = défaut maison → on ne l'écrit PAS (seule l'exception « SANS PDJ » compte).
// - tarif = canal (OTA si Booking/Expedia) + annulable/NANR ; le libellé D-Edge est ignoré.
// - RSP TS = taxe de séjour réglée sur place (code réception) ; tsByAgency = prise en charge
//   agence (Djoca précise « TS incluse avec la CCV ») → prime sur le « sur place ».
export function controlNote(
  r: OtaResa, dejaVenu: boolean | null, cityTax?: number | null, tsByAgency = false,
): string {
  const bits: string[] = [];
  if (r.roomType) bits.push(r.roomType);
  if (r.breakfast === false) bits.push('SANS PDJ');
  const chan = /booking|expedia|hotelbeds|agoda|hotels?\.com/i.test(r.source || '') ? 'OTA ' : '';
  if (r.refundable === true) bits.push(`${chan}FLEX`);
  else if (r.refundable === false) bits.push(`${chan}NANR`);
  if (r.payment === 'vcc') {
    bits.push(r.vccChargeableFrom ? `VCC à déb. ${ddmm(r.vccChargeableFrom)}` : 'VCC');
    if (tsByAgency) bits.push('TS incluse (prise en charge agence — ne PAS facturer client)');
    else bits.push(cityTax != null ? `RSP TS ${cityTax.toFixed(2).replace('.', ',')} €` : 'RSP TS');
  } else if (r.payment === 'charge_card') {
    bits.push(`DÉBITER LA CARTE CLIENT${r.amount ? ` ${r.amount}` : ''}`);
  } else if (r.payment === 'hotel_collect') {
    bits.push('HÔTEL COLLECT — tout encaisser sur place');
  } else if (r.payment === 'on_site') {
    bits.push('À RÉGLER SUR PLACE (héberg. + TS)');
  } else if (r.payment === 'prepaid') {
    bits.push('PRÉPAYÉ en ligne');
  } else if (r.payment === 'ota_billed') {
    bits.push('FACTURÉ OTA');
  }
  if (r.genius) bits.push('GENIUS');
  if (dejaVenu === true) bits.push('DÉJÀ VENU');
  else if (dejaVenu === false) bits.push('1ER SÉJOUR');
  return bits.join(' · ');
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
