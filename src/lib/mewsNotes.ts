// Notes de RÉSERVATION dans Mews (« Note (Général) », celle que la réception lit).
//
// ⚠️ CORRECTION D'UNE CROYANCE TENACE (2026-07-23). Depuis le 2026-07-04 on tenait
// pour acquis que la note de réservation n'était « ni lisible ni écrivable » par le
// Connector, et tout un plan B en découlait : l'assistant rédigeait la note, la
// réception la recopiait à la main dans le PMS. C'était faux. L'erreur venait de la
// piste suivie : on testait `reservations/update` avec un champ `Notes` — que Mews
// ignore effectivement en silence — au lieu de chercher la bonne famille d'opérations.
//
// La note vit dans `serviceOrderNotes` (une réservation EST un service order) :
//   · lecture  `serviceOrderNotes/getAll`   { ServiceOrderIds: [...] }
//   · création `serviceOrderNotes/add`      { ServiceOrderNotes: [{ ServiceOrderId, Type, Text }] }
//   · modif    `serviceOrderNotes/update`   { ServiceOrderNoteUpdates: [{ ServiceOrderNoteId, Text: { Value } }] }
//   · suppr.   `serviceOrderNotes/delete`   { ServiceOrderNoteIds: [...] }
// Elle apparaît AUSSI dans `reservations/getAll` sous un bloc `Notes` de la réponse
// (à côté de `Reservations`) quand on demande `Extent: { Notes: true }`.
// Les quatre opérations sont ouvertes sur le scope de production — aller-retour
// complet vérifié en réel le 2026-07-23 (ajout, modification, suppression).

import { callMews } from '@/lib/mews';

export type MewsNote = {
  Id: string;
  OrderId: string;
  Text: string;
  Type: string;          // 'General' | 'ChannelManager'
  CreatedUtc?: string;
  UpdatedUtc?: string;
};

export async function getReservationNotes(reservationId: string): Promise<MewsNote[]> {
  const res = await callMews<{ ServiceOrderNotes?: MewsNote[] }>('serviceOrderNotes/getAll', {
    ServiceOrderIds: [reservationId], Limitation: { Count: 50 },
  });
  return res.ServiceOrderNotes ?? [];
}

export async function addReservationNote(reservationId: string, text: string): Promise<string | null> {
  const res = await callMews<{ ServiceOrderNotes?: { Id: string }[] }>('serviceOrderNotes/add', {
    ServiceOrderNotes: [{ ServiceOrderId: reservationId, Type: 'General', Text: text }],
  });
  return res.ServiceOrderNotes?.[0]?.Id ?? null;
}

export async function updateReservationNote(noteId: string, text: string): Promise<void> {
  await callMews('serviceOrderNotes/update', {
    ServiceOrderNoteUpdates: [{ ServiceOrderNoteId: noteId, Text: { Value: text } }],
  });
}

export async function deleteReservationNotes(noteIds: string[]): Promise<void> {
  if (!noteIds.length) return;
  await callMews('serviceOrderNotes/delete', { ServiceOrderNoteIds: noteIds });
}

// ── Ce qu'on a le droit d'effacer ────────────────────────────────────────────
// Règle RESTRICTIVE, validée par Martin le 2026-07-23 après inventaire de 422 notes
// réelles (juillet→septembre). La répartition explique la prudence :
//   · 17 % sont machine (ChannelManager, « Preferred Language », bloc Expedia)
//   · 68 % sont NOTRE format de contrôle, tapé à la main par la réception
//   · 15 % sont des notes humaines hors format — et celles-là sont critiques :
//     « Personne à mobilité réduite, ascenseur nécessaire », « NO SHOW > on ne
//     rembourse pas », « PEC TS cb 1118 : facture à libeller à… », « ANCV 2 PAX
//     refus paiement PDJ ». En effacer une seule serait plus grave que tout le
//     bénéfice de l'automatisation.
// → on ne supprime QUE ce qui est formellement reconnu comme généré par une machine.
//   Tout le reste est laissé intact ; notre note s'ajoute à côté.
const AUTO_LANGUE = /^\s*preferred language\b/i;
const AUTO_OTA = /business model|point of sale|smoking type|travel purpose/i;

export function isAutoNote(n: MewsNote): boolean {
  if (n.Type === 'ChannelManager') return true;
  const t = String(n.Text || '').replace(/\s+/g, ' ').trim();
  return AUTO_LANGUE.test(t) || AUTO_OTA.test(t);
}

export type NoteSyncResult = {
  noteId: string | null;
  mode: 'created' | 'updated' | 'unchanged';
  deleted: number;
};

// Pose (ou met à jour) NOTRE note de contrôle sur une réservation, et fait le
// ménage des notes automatiques.
//
// `knownNoteId` = l'identifiant de la note qu'on a nous-même écrite lors d'un
// passage précédent. On met à jour CELLE-LÀ plutôt que d'en empiler une seconde.
// On ne la reconnaît volontairement PAS à son texte : l'inventaire contient des
// notes de contrôle tapées par l'équipe qu'aucune regex raisonnable n'attrape
// (« SGL RGT/P PREMIER SEJOUR »), et se tromper reviendrait à écraser leur travail.
export async function syncControlNote(params: {
  reservationId: string;
  text: string;
  knownNoteId?: string | null;
  purgeAuto?: boolean;
}): Promise<NoteSyncResult> {
  const { reservationId, text, knownNoteId, purgeAuto = true } = params;
  const notes = await getReservationNotes(reservationId);

  let deleted = 0;
  if (purgeAuto) {
    const auto = notes.filter(isAutoNote).map((n) => n.Id);
    if (auto.length) { await deleteReservationNotes(auto); deleted = auto.length; }
  }

  const mine = knownNoteId ? notes.find((n) => n.Id === knownNoteId) : undefined;
  if (mine) {
    if (String(mine.Text || '').trim() === text.trim()) return { noteId: mine.Id, mode: 'unchanged', deleted };
    await updateReservationNote(mine.Id, text);
    return { noteId: mine.Id, mode: 'updated', deleted };
  }
  const id = await addReservationNote(reservationId, text);
  return { noteId: id, mode: 'created', deleted };
}
