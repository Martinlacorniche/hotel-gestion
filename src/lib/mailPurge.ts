import { listFolderIdsBefore, permanentDeleteMessage } from '@/lib/graphMailbox';
import { hotelConfig } from '@/lib/mailAssistant';

// Purge des INDÉSIRABLES (Martin 2026-07-10) : « on ne lit pas les indésirables, mais on vide
// la boîte tous les 3 jours, pensons à la planète ».
//
// Pourquoi une suppression DÉFINITIVE et pas un `move` vers la corbeille : déplacer ne libère
// aucun stockage (le mail reste dans la boîte, juste ailleurs). `permanentDelete` retire
// vraiment l'élément — c'est tout l'intérêt.
//
// Pourquoi un DÉLAI de 3 jours et pas « tout, tout de suite » : Outlook classe parfois un vrai
// client en indésirable. Les 3 jours laissent une fenêtre de repêchage manuel avant l'effacement,
// et le dossier ne grossit jamais au-delà de 3 jours de spam.
//
// On ne lit RIEN : la requête ne demande que l'id et la date (cf `listFolderIdsBefore`).

export const JUNK_RETENTION_DAYS = 3;

// Garde-fou : plafond d'un passage. Au-delà, on s'arrête et le prochain passage continuera.
// Évite qu'un bug de filtre ne parte en boucle sur des milliers de messages.
const MAX_PER_RUN = 300;
const PAGE = 50;

export type PurgeResult = {
  hotel: string;
  mailbox: string;
  deleted: number;
  oldest: string | null;
  capped: boolean;
  errors: number;
};

export async function purgeJunk(hotelKey: string, retentionDays = JUNK_RETENTION_DAYS): Promise<PurgeResult> {
  const cfg = hotelConfig(hotelKey);
  if (!cfg) throw new Error(`hôtel inconnu: ${hotelKey}`);

  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const res: PurgeResult = { hotel: cfg.key, mailbox: cfg.mailbox, deleted: 0, oldest: null, capped: false, errors: 0 };

  // Un message qui résiste à la suppression resterait dans le dossier, et la page suivante nous
  // le resservirait à l'infini. On mémorise ses ids : une page qui n'en contient plus que des
  // connus n'a plus rien à purger.
  const failed = new Set<string>();

  while (res.deleted < MAX_PER_RUN) {
    const batch = await listFolderIdsBefore(cfg.mailbox, 'junkemail', cutoff, PAGE);
    const todo = batch.filter((m) => !failed.has(m.id));
    if (todo.length === 0) break;
    if (!res.oldest) res.oldest = todo[0].received;

    for (const m of todo) {
      if (res.deleted >= MAX_PER_RUN) { res.capped = true; break; }
      try {
        await permanentDeleteMessage(cfg.mailbox, m.id);
        res.deleted++;
      } catch (e) {
        failed.add(m.id);
        console.error('[mail-purge] permanentDelete', cfg.mailbox, e);
      }
    }
    if (res.capped) break;
  }
  res.errors = failed.size;
  return res;
}
