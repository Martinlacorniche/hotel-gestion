// Pose dans Mews la réservation d'un invité de groupe, avec sa note de contrôle.
//
// Appelée par le webhook Stripe à la confirmation, et en rattrapage depuis le
// back-office. Idempotente : une réservation déjà poussée n'est jamais recréée —
// un doublon dans le PMS mobiliserait une chambre du bloc pour rien.

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { categorieParNumero } from '@/lib/mewsBlocks';
import { creerResaGroupe, noteGroupe, poserNoteGroupe } from '@/lib/mewsGroupResa';
import { callMews } from '@/lib/mews';

const VOILES = 'ded6e6fb-ff3c-4fa8-ad07-403ee316be53';

export type PushResult = {
  skipped?: string;
  reservationId?: string; customerId?: string; noteId?: string | null; note?: string;
};

export async function pushGroupeResaToMews(id: string): Promise<PushResult> {
  const { data: r } = await supabaseAdmin
    .from('groupe_reservations')
    .select('id, groupe_id, groupe_chambre_id, statut, nom, prenom, email, tel, date_arrivee, date_depart, config_lit, nb_personnes, mews_reservation_id')
    .eq('id', id).single();
  if (!r) return { skipped: 'réservation introuvable' };
  if (r.mews_reservation_id) return { skipped: 'déjà dans Mews' };
  if (r.statut !== 'confirmee') return { skipped: `statut ${r.statut}` };

  const { data: gc } = await supabaseAdmin
    .from('groupe_chambres').select('chambre_id, hotel_id, tarif_nuit').eq('id', r.groupe_chambre_id).single();
  if (!gc) return { skipped: 'chambre du bloc introuvable' };
  if (gc.hotel_id !== VOILES) return { skipped: 'chambre hors Voiles (La Corniche est sur HotSoft)' };

  const { data: g } = await supabaseAdmin
    .from('groupes')
    .select('nom, mews_block_id, mews_rate_id, taxe_sejour_mode, taxe_sejour_montant')
    .eq('id', r.groupe_id).single();
  if (!g?.mews_block_id || !g.mews_rate_id) return { skipped: 'le groupe n’a pas d’allotement dans Mews' };

  // ⚠️ `groupe_chambres.chambre_id` pointe sur `room_units`, pas sur `chambres`.
  const { data: ru } = await supabaseAdmin
    .from('room_units').select('numero').eq('id', gc.chambre_id).single();
  const cat = ru ? (await categorieParNumero()).get(String(ru.numero).trim()) : undefined;
  if (!cat) return { skipped: 'catégorie Mews introuvable pour cette chambre' };

  const nbPers = Math.max(1, Number(r.nb_personnes) || 1);
  const { customerId, reservationId } = await creerResaGroupe({
    nom: String(r.nom || '').trim() || 'Invité', prenom: String(r.prenom || '').trim(),
    email: r.email, tel: r.tel,
    arrivee: r.date_arrivee as string, depart: r.date_depart as string,
    categoryId: cat, rateId: g.mews_rate_id as string, blockId: g.mews_block_id as string,
    nbPersonnes: nbPers,
  });

  // On consigne AVANT d'écrire la note : si la note échoue, la réservation reste
  // rattachée et l'opération ne sera pas rejouée (ce qui créerait un doublon).
  await supabaseAdmin.from('groupe_reservations')
    .update({ mews_reservation_id: reservationId, mews_customer_id: customerId, pms_done: true })
    .eq('id', r.id);

  // Le nom lisible de la catégorie, pour que la note dise « confort » et non un GUID.
  let categorieNom = '';
  try {
    const rc = await callMews<{ ResourceCategories?: { Id: string; Names?: Record<string, string> }[] }>(
      'resourceCategories/getAll',
      { ServiceIds: [process.env.MEWS_STAY_SERVICE_ID || '9475cd2d-5fa3-4a8a-9abb-aaa9008717f2'], Limitation: { Count: 50 } },
    );
    const c = (rc.ResourceCategories ?? []).find((x) => x.Id === cat);
    categorieNom = c?.Names?.fr || c?.Names?.['fr-FR'] || c?.Names?.en || '';
  } catch { /* la note se contentera du reste */ }

  const nuits = Math.max(1, Math.round(
    (new Date(`${r.date_depart}T12:00:00Z`).getTime() - new Date(`${r.date_arrivee}T12:00:00Z`).getTime()) / 864e5));
  // Réglé ou pas ? La réponse est factuelle, pas déductible du paramétrage : un
  // groupe en paiement différé peut avoir des invités qui ont payé et d'autres non.
  // On regarde donc s'il existe un encaissement abouti pour CETTE réservation.
  const { data: pay } = await supabaseAdmin
    .from('payments').select('id').eq('groupe_reservation_id', r.id).eq('status', 'paid').limit(1);
  const paye = !!pay?.length;

  const note = noteGroupe({
    categorieNom, groupeNom: String(g.nom),
    paye,
    tsMode: (g.taxe_sejour_mode as 'incluse' | 'ajoutee' | null) ?? null,
    tsMontant: g.taxe_sejour_montant != null ? Number(g.taxe_sejour_montant) : null,
    nuits, nbPersonnes: nbPers, configLit: r.config_lit as string | null,
  });
  const noteId = await poserNoteGroupe(reservationId, note).catch(() => null);
  if (noteId) await supabaseAdmin.from('groupe_reservations').update({ mews_note_id: noteId }).eq('id', r.id);

  return { reservationId, customerId, noteId, note };
}
