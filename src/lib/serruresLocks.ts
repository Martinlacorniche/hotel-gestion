import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getHotelLocksMap } from '@/lib/tthotel';

export type LockMeta = { lockId: number; mac: string; buildNo: number; floorNo: number };

/**
 * Construit la liste {lockId, mac, buildNo, floorNo} de TOUTES les chambres
 * mappées (pour encoder un pass qui ouvre tout l'hôtel). Throw si une chambre
 * n'a pas ses infos hôtel côté TTHotel.
 */
export async function buildAllLocksMeta(): Promise<{ hotelId: string; locks: LockMeta[] }> {
  const { data: chambres, error } = await supabaseAdmin
    .from('chambres')
    .select('hotel_id, numero, tthotel_lock_id')
    .order('ordre', { ascending: true });
  if (error || !chambres || chambres.length === 0) {
    throw new Error(error?.message ?? 'aucune chambre mappée');
  }
  const map = await getHotelLocksMap();
  const locks = chambres.map((c) => {
    const info = map.get(c.tthotel_lock_id);
    if (!info || info.buildingNumber === undefined || info.floorNumber === undefined || !info.lockMac) {
      throw new Error(`Infos hôtel manquantes pour lockId ${c.tthotel_lock_id} (chambre ${c.numero})`);
    }
    return {
      lockId: c.tthotel_lock_id,
      mac: info.lockMac,
      buildNo: info.buildingNumber,
      floorNo: info.floorNumber,
    };
  });
  return { hotelId: chambres[0].hotel_id as string, locks };
}

/**
 * Numéros de carte ACTIFS d'un séjour : dérivés des jobs d'encodage `done`
 * référençant ce séjour, moins ceux marqués révoqués (`sejours.cartes_revoquees`).
 * Sert à savoir s'il reste une carte valide (ex. décider de clôturer le séjour).
 */
export async function sejourActiveCardNos(sejourId: string): Promise<string[]> {
  const { data: sej } = await supabaseAdmin
    .from('sejours')
    .select('cartes_revoquees')
    .eq('id', sejourId)
    .single();
  const revoked = new Set<string>(((sej?.cartes_revoquees as string[] | null) ?? []));

  const { data: jobs } = await supabaseAdmin
    .from('jobs_encodeur')
    .select('payload, resultat')
    .eq('action', 'write_card')
    .eq('statut', 'done')
    .order('created_at', { ascending: false })
    .limit(500);

  const cardNos = new Set<string>();
  for (const j of jobs ?? []) {
    const sids = (j.payload as { sejourIds?: string[] } | null)?.sejourIds ?? [];
    const cn = (j.resultat as { card_no?: string } | null)?.card_no;
    if (cn && sids.includes(sejourId) && !revoked.has(cn)) cardNos.add(cn);
  }
  return [...cardNos];
}

/** Date à `mois` mois dans le futur (par défaut la validité d'un pass = 12 mois). */
export function dateInMonths(mois: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + mois);
  return d;
}
