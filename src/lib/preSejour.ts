// Formulaire PRÉ-SÉJOUR LoungeUp (La Corniche).
//
// Contre-intuitif : ces mails ne sont PAS la copie de ce qu'on envoie au client. Ce sont les
// formulaires que le CLIENT a remplis, remontés à l'hôtel (« Nouvelle demande : Pré-Séjour »).
// Backtest 2026-07-13 : 36 % d'entre eux portent une attente particulière du client
// (« King size, non smoking room please if possible »…) que personne ne lisait — 1 600 mails
// empilés dans un dossier.
//
// Règle Martin (2026-07-13) : « on vérifie les pré-séjour si il y a une info importante,
// le reste ça dégage. » → tout l'enjeu est de définir « importante » :
//   · une DEMANDE du client (attentes particulières, options payantes, facturation) → note
//   · une réponse d'enquête (distance, mode de transport, motif du séjour, fidélité) → bruit
// Rien d'important → le mail dégage.

export type PreSejour = {
  guest: string | null;
  email: string | null;
  phone: string | null;
  room: string | null;
  arrival: string | null;      // jj-mm-aaaa tel qu'affiché par LoungeUp
  departure: string | null;
  resaRef: string | null;
  arrivalTime: string | null;  // « 15:00:00 » = valeur par défaut du formulaire
  expectations: string | null; // attentes particulières (champ libre)
  breakfast: string | null;
  lateCheckout: string | null;
  companyInvoice: string | null;
  negotiatedRates: string | null;
};

// Un champ non renseigné vaut « / » chez LoungeUp (et « Non merci » sur les opt-in marketing).
function isEmpty(v: string | null): boolean {
  if (!v) return true;
  const s = v.trim();
  return s === '' || s === '/' || /^non merci$/i.test(s);
}

// L'heure d'arrivée est pré-remplie à 15:00 (heure de check-in) : ce n'est pas une demande.
// Toute AUTRE heure est une information que la réception doit voir (arrivée tardive surtout).
const DEFAULT_ARRIVAL_TIME = '15:00';

// LoungeUp écrit tantôt « 22:00:00 », tantôt « 22:00 » → on normalise en HH:MM (sans quoi un
// simple strip des secondes transforme « 22:00 » en « 22 »).
function hhmm(v: string | null): string | null {
  const m = (v || '').match(/(\d{1,2})\s*[:h]\s*(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

// Le client répond parfois « Pas particulièrement » / « Non » au champ libre : ce n'est pas
// une demande, ça ne remonte pas à la réception.
// ⚠️ On déplie les accents AVANT de tester : `\w` ne les couvre pas en JS, donc un motif comme
// `pas particuli\w*` ne matche PAS « pas particulièrement » (il cale sur le « è »).
function isNoAnswer(v: string): boolean {
  const s = v.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.!\s]+$/, '');
  return isEmpty(s) || s === '-' ||
    /^(pas particulier\w*|non|rien|aucune?|neant|no|nothing|ras|n\/?a)$/.test(s);
}

// « √ 20€, Quantité : 1. Total : 20€ » → « ×1 (20€) ». Le client a déjà PAYÉ l'option : il faut
// la reporter sur la résa, donc la quantité et le total sont ce qui compte.
function optionSummary(v: string): string {
  const qty = v.match(/Quantit[ée]\s*:\s*(\d+)/i)?.[1];
  const total = v.match(/Total\s*:\s*([\d.,]+\s*€)/i)?.[1];
  if (qty && total) return `×${qty} (${total.replace(/\s+/g, '')})`;
  return v.replace(/^√\s*/, '').trim();
}

// getMessageText (graphMailbox) remplace CHAQUE balise par un saut de ligne : le libellé et la
// valeur atterrissent donc sur deux lignes. On gère les deux formes, « Label :\nvaleur » et
// « Label : valeur », pour ne pas dépendre du rendu HTML de LoungeUp.
function field(lines: string[], aliases: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inline = line.match(/^(.{2,70}?)\s*:\s*(.+)$/);
    const label = inline ? inline[1] : line.replace(/\s*:\s*$/, '');
    if (!aliases.test(label)) continue;
    const value = inline ? inline[2] : (lines[i + 1] ?? '');
    // Une ligne suivante qui est elle-même un libellé = champ vide.
    if (!inline && /:\s*$/.test(value)) return null;
    return value.trim() || null;
  }
  return null;
}

export function parsePreSejour(body: string): PreSejour {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);

  const stay = lines.find((l) => /^Chambre\s+\S+\s+du\s+/i.test(l)) || '';
  const stayM = stay.match(/^Chambre\s+(\S+)\s+du\s+([\d-]+)\s+au\s+([\d-]+)/i);
  const contact = lines.find((l) => l.includes('@') && l.includes('|')) || '';

  // Le nom du client est la ligne qui précède la ligne de contact « email | téléphone ».
  const ci = lines.indexOf(contact);
  const guest = ci > 0 ? lines[ci - 1] : (field(lines, /^Nom$/i) || null);

  return {
    guest: guest && !guest.includes('@') ? guest : null,
    email: contact.split('|')[0]?.trim() || field(lines, /^Adresse email$|^Email$/i),
    phone: contact.split('|')[1]?.trim() || field(lines, /^T[ée]l[ée]phone$/i),
    room: stayM?.[1] ?? null,
    arrival: stayM?.[2] ?? null,
    departure: stayM?.[3] ?? null,
    resaRef: lines.find((l) => /^R[ée]servation\s+\S+/i.test(l))?.split(/\s+/)[1] ?? null,
    // « J'aimerais m'enregistrer à … » = variante du libellé selon la version du formulaire.
    arrivalTime: field(lines, /heure d.?arriv[ée]e|m.?enregistrer [àa]|check.?in time/i),
    expectations: field(lines, /attentes particuli[èe]res|special requests|demandes particuli/i),
    breakfast: field(lines, /petit.?d[ée]jeuner/i),
    lateCheckout: field(lines, /late check.?out|d[ée]part tardif/i),
    companyInvoice: field(lines, /facture au nom de votre entreprise/i),
    negotiatedRates: field(lines, /tarifs n[ée]goci[ée]s/i),
  };
}

// Les signaux qui méritent l'attention de la réception. Tout le reste du formulaire
// (distance parcourue, mode de transport, motif du séjour, opt-in fidélité) est de l'enquête
// marketing : ça ne remonte pas.
export function preSejourFlags(p: PreSejour): string[] {
  const flags: string[] = [];

  const t = hhmm(p.arrivalTime);
  if (t && t !== DEFAULT_ARRIVAL_TIME) flags.push(`ARRIVÉE ${t}`);

  if (!isEmpty(p.breakfast)) flags.push(`PDJ ${optionSummary(p.breakfast!)}`);
  if (!isEmpty(p.lateCheckout)) flags.push(`LATE C/O ${optionSummary(p.lateCheckout!)}`);
  if (!isEmpty(p.companyInvoice)) flags.push('FACTURE ENTREPRISE');
  if (!isEmpty(p.negotiatedRates)) flags.push('⚠️ VEUT DES TARIFS NÉGOCIÉS (lead commercial)');

  const exp = (p.expectations || '').trim();
  if (!isEmpty(exp) && !isNoAnswer(exp)) flags.push(`ATTENTES : ${exp}`);

  return flags;
}

export function isPreSejourActionable(p: PreSejour): boolean {
  return preSejourFlags(p).length > 0;
}

// Note réception, format court (même esprit que controlNote) :
//   #032 NAKHLEH arr. 13-07 · ARRIVÉE 22:30 · ATTENTES : King size, non smoking
export function preSejourNote(p: PreSejour): string {
  const head = [
    p.room ? `#${p.room}` : null,
    p.guest,
    p.arrival ? `arr. ${p.arrival.slice(0, 5)}` : null,
  ].filter(Boolean).join(' ');
  const flags = preSejourFlags(p);
  return [head, ...flags].filter(Boolean).join(' · ');
}
