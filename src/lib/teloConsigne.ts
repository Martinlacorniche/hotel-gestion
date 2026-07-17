// Consigne automatique quand la salle TELO MARITIMO est réservée.
//
// POURQUOI : Telo Maritimo EST la salle du petit-déjeuner (Martin 2026-07-17). Une réservation
// de la salle a donc un impact d'exploitation qui ne se voit nulle part dans le module commercial :
// il faut prévenir les clients et les coworks, prévoir la mise en place, et — pour un event du
// soir — ne pas attribuer la chambre 2 (mitoyenne) et faire remettre la salle en état par le Night
// avant le petit-déjeuner du lendemain.
//
// QUAND : à la VALIDATION du dossier (Martin) — `/commercial` écrit `status: 'reserved'` dès que
// le lead passe à « Confirmé », et `'option'` sinon. **Pas de consigne sur une option** : un
// dossier qui tombe laisserait une consigne fantôme.
//
// IDEMPOTENT : `/commercial` supprime puis réinsère TOUTES les résas du lead à chaque
// enregistrement → cette fonction est rejouée à chaque sauvegarde. L'anti-doublon (une seule
// consigne « Telo » par jour et par hôtel) est donc indispensable, pas un confort.

import type { SupabaseClient } from '@supabase/supabase-js';

export const TELO_MARITIMO_ROOM_ID = '9c5b47c7-db30-40f3-84a5-c9c8a80df40c';
// Telo Maritimo est une salle de La Corniche (cf `seminar_rooms.hotel_id`) : la consigne
// appartient toujours à cet hôtel, quel que soit l'hôtel porté par le dossier commercial.
const CORNICHE_HOTEL_ID = 'f9d59e56-9a2f-433e-bcf4-f9753f105f32';

// Un event qui commence à 19h ou après = event du SOIR : le petit-déjeuner impacté est celui du
// LENDEMAIN, et le risque se déplace (bruit chambre 2, remise en état par le Night).
const EVENING_FROM_HOUR = 19;

export type TeloResa = {
  room_id: string;
  start_date: string;      // yyyy-mm-dd
  start_time: string | null;
  end_time: string | null;
  status: string;          // 'reserved' | 'option'
};

function hhmm(t: string | null): string | null {
  return t ? t.slice(0, 5) : null;
}

function isEvening(r: TeloResa): boolean {
  const start = hhmm(r.start_time);
  return start ? parseInt(start.slice(0, 2), 10) >= EVENING_FROM_HOUR : false;
}

function creneau(r: TeloResa): string {
  const start = hhmm(r.start_time);
  const end = hhmm(r.end_time);
  return start && end ? `${start}-${end}` : start || '';
}

// Texte validé par Martin le 2026-07-17 (« met de la politesse mais concis »).
//
// Prend TOUS les créneaux du jour, pas un seul : la salle peut être prise midi ET soir (cas réel
// Business Profilers le 28/09). Ne garder que le premier créneau perdrait l'avertissement du soir
// — chambre 2 et remise en état par le Night — qui est justement le plus risqué.
export function teloConsigneText(resasDuJour: TeloResa[], client: string | null): string {
  const who = client?.trim() ? `, ${client.trim()}` : '';
  const soirs = resasDuJour.filter(isEvening);
  const jours = resasDuJour.filter((r) => !isEvening(r));
  const h = (rs: TeloResa[]) => rs.map(creneau).filter(Boolean).join(' + ');

  // Soir uniquement : le petit-déjeuner impacté est celui du LENDEMAIN → le risque est le bruit
  // (chambre 2) et la salle laissée en l'état.
  if (soirs.length && !jours.length) {
    return `Bonjour, event en Telo ce soir (${h(soirs)}${who}) : merci de faire attention à l'attribution de la chambre 2, et de prévenir les clients. Night : remise en état de la salle après l'event, merci !`;
  }
  // Journée uniquement : la salle doit être libérée du petit-déjeuner et remise en place.
  if (jours.length && !soirs.length) {
    return `⚠️ Telo Maritimo réservée aujourd'hui (${h(jours)}${who}) — c'est la salle du petit-déjeuner. Prévenir les clients & les coworks, et vérifier si une mise en place est nécessaire sur la fiche de fonction.`;
  }
  // Les deux dans la même journée : on cumule, sinon on perd un des deux risques.
  return `⚠️ Telo Maritimo prise aujourd'hui (${h(jours)}) ET ce soir (${h(soirs)}${who}) — c'est la salle du petit-déjeuner. Prévenir les clients & les coworks, et vérifier la mise en place sur la fiche de fonction. Attention à l'attribution de la chambre 2. Night : remise en état de la salle après l'event, merci !`;
}

// Pose les consignes manquantes pour les résas Telo CONFIRMÉES. Renvoie le nombre de consignes
// créées (0 = tout était déjà en place, cas nominal d'un simple ré-enregistrement du dossier).
//
// ⚠️ Ne SUPPRIME jamais une consigne : si un dossier confirmé repasse en option ou est annulé,
// la consigne reste et devra être retirée à la main — on préfère une consigne en trop (que
// l'équipe valide en 2 s) à une consigne effacée alors que quelqu'un y a peut-être répondu.
export async function syncTeloConsignes(
  supabase: SupabaseClient,
  resas: TeloResa[],
  client: string | null,
): Promise<number> {
  const cibles = resas.filter((r) => r.room_id === TELO_MARITIMO_ROOM_ID && r.status === 'reserved');
  if (!cibles.length) return 0;

  // Une seule consigne par JOUR — mais qui porte TOUS les créneaux de la journée (le 28/09 est
  // pris midi ET soir) : deux consignes le même jour seraient du bruit, un seul créneau perdrait
  // un risque.
  const parJour = new Map<string, TeloResa[]>();
  for (const r of cibles) {
    const l = parJour.get(r.start_date) || [];
    l.push(r);
    parJour.set(r.start_date, l);
  }
  for (const l of parJour.values()) l.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

  const jours = [...parJour.keys()];
  const { data: existantes } = await supabase
    .from('consignes')
    .select('date_creation')
    .eq('hotel_id', CORNICHE_HOTEL_ID)
    .in('date_creation', jours)
    .ilike('texte', '%telo%');
  const dejaLa = new Set((existantes || []).map((c: { date_creation: string }) => c.date_creation));

  const aPoser = [...parJour.entries()]
    .filter(([d]) => !dejaLa.has(d))
    .map(([d, rs]) => ({
      texte: teloConsigneText(rs, client),
      auteur: 'Junior',
      date_creation: d,
      hotel_id: CORNICHE_HOTEL_ID,
      valide: false,
    }));
  if (!aPoser.length) return 0;

  const { error } = await supabase.from('consignes').insert(aPoser);
  if (error) throw error;
  return aPoser.length;
}
