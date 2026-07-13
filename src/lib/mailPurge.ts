import { listFolderIdsBefore, permanentDeleteBatch, findInboxFolderId } from '@/lib/graphMailbox';
import { hotelConfig } from '@/lib/mailAssistant';

// Purge de stockage (Martin 2026-07-10) : « on ne lit pas les indésirables, mais on vide la
// boîte tous les 3 jours, pensons à la planète » + « mails supprimés, faut pas laisser traîner ».
//   · Courrier indésirable → 3 jours
//   · Éléments supprimés   → 7 jours
//   · Éditions du PMS Hotsoft (Corniche) → 4 jours (Martin 2026-07-13)
//
// Pourquoi une suppression DÉFINITIVE et pas un `move` vers la corbeille : déplacer ne libère
// aucun stockage (le mail reste dans la boîte, juste ailleurs). `permanentDelete` retire
// vraiment l'élément — c'est tout l'intérêt.
//
// Pourquoi un DÉLAI et pas « tout, tout de suite » : Outlook classe parfois un vrai client en
// indésirable, et une suppression humaine peut être une erreur. Le délai laisse une fenêtre de
// repêchage manuel avant l'effacement, et les dossiers ne grossissent jamais au-delà.
//
// On ne lit RIEN : la requête ne demande que l'id et la date (cf `listFolderIdsBefore`).
// La BOÎTE DE RÉCEPTION elle-même n'est jamais touchée. Seuls sont purgés : 'junkemail',
// 'deleteditems', et le dossier de classement « Hotsoft » (des éditions du PMS rééditables à
// volonté — pas du courrier). Aucun mail reçu d'un tiers n'est jamais purgé.

export const JUNK_RETENTION_DAYS = 3;
// Corbeille : « mails supprimés, faut pas laisser traîner » (Martin 2026-07-10). 7 jours, c'est
// un filet court : au-delà, la récupération d'une suppression par erreur devient impossible.
export const TRASH_RETENTION_DAYS = 7;

// Garde-fou : plafond par dossier et par passage. Graph limite le débit — mesuré ~1,8 s par
// paquet de 20 — donc 100 suppressions ≈ 9 s. En régime de croisière un cycle ne représente que
// quelques dizaines de mails (3 j de spam, 7 j de corbeille) : le plafond ne sert que de
// coupe-circuit si un filtre part en vrille.
//
// Si un passage est malgré tout coupé par le timeout de la plateforme, rien n'est perdu : les
// suppressions déjà envoyées sont définitives et le cron suivant reprend où il s'était arrêté.
// L'arriéré initial (5 387 mails dans la corbeille Corniche) a été résorbé à la main.
const MAX_PER_RUN = 100;
const PAGE = 50;

export type PurgeResult = {
  hotel: string;
  mailbox: string;
  folder: string;
  deleted: number;
  oldest: string | null;
  capped: boolean;
  errors: number;
};

export function purgeJunk(hotelKey: string, retentionDays = JUNK_RETENTION_DAYS): Promise<PurgeResult> {
  return purgeFolder(hotelKey, 'junkemail', retentionDays);
}

export function purgeTrash(hotelKey: string, retentionDays = TRASH_RETENTION_DAYS): Promise<PurgeResult> {
  return purgeFolder(hotelKey, 'deleteditems', retentionDays);
}

// Éditions automatiques du PMS Hotsoft (La Corniche) : feuille de caisse, situation HT/TTC,
// Guests, Emergency Report… L'hôtel se les envoie chaque jour à sa propre boîte — 12 353 mails
// empilés. « On supprime au-delà de 4 jours » (Martin 2026-07-13) : elles sont rééditables depuis
// Hotsoft à tout moment, la copie mail n'est qu'un tampon de quelques jours.
export const PMS_REPORTS_RETENTION_DAYS = 4;
export const PMS_REPORTS_FOLDER = 'Hotsoft';

// Le dossier n'existe qu'à La Corniche → purge à 0 ailleurs, sans erreur.
export async function purgePmsReports(
  hotelKey: string, retentionDays = PMS_REPORTS_RETENTION_DAYS,
): Promise<PurgeResult> {
  const cfg = hotelConfig(hotelKey);
  if (!cfg) throw new Error(`hôtel inconnu: ${hotelKey}`);

  const folderId = await findInboxFolderId(cfg.mailbox, PMS_REPORTS_FOLDER);
  if (!folderId) {
    return { hotel: cfg.key, mailbox: cfg.mailbox, folder: PMS_REPORTS_FOLDER, deleted: 0, oldest: null, capped: false, errors: 0 };
  }
  const res = await purgeFolder(hotelKey, folderId, retentionDays);
  return { ...res, folder: PMS_REPORTS_FOLDER };
}

async function purgeFolder(hotelKey: string, folder: string, retentionDays: number): Promise<PurgeResult> {
  const cfg = hotelConfig(hotelKey);
  if (!cfg) throw new Error(`hôtel inconnu: ${hotelKey}`);

  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const res: PurgeResult = { hotel: cfg.key, mailbox: cfg.mailbox, folder, deleted: 0, oldest: null, capped: false, errors: 0 };

  // Un message qui résiste à la suppression resterait dans le dossier, et la page suivante nous
  // le resservirait à l'infini. On mémorise ses ids : une page qui n'en contient plus que des
  // connus n'a plus rien à purger.
  const failed = new Set<string>();

  while (res.deleted < MAX_PER_RUN) {
    const page = await listFolderIdsBefore(cfg.mailbox, folder, cutoff, PAGE);
    const todo = page.filter((m) => !failed.has(m.id)).slice(0, MAX_PER_RUN - res.deleted);
    if (todo.length === 0) break;
    if (!res.oldest) res.oldest = todo[0].received;

    const ko = await permanentDeleteBatch(cfg.mailbox, todo.map((m) => m.id));
    ko.forEach((id) => failed.add(id));
    res.deleted += todo.length - ko.length;
    if (ko.length) console.error('[mail-purge]', cfg.mailbox, folder, `${ko.length} suppressions en échec`);
  }
  res.capped = res.deleted >= MAX_PER_RUN;
  res.errors = failed.size;
  return res;
}
