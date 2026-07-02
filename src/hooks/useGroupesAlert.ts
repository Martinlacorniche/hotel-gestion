'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// Compteur « groupes à traiter » pour le badge de la sidebar.
// Même logique que la pastille de /commercial et /groupes : réservations de groupe
// CONFIRMÉES non encore vues (`vu_backoffice=false`) + ANNULATIONS pas encore
// retirées du PMS (`pms_done=false`), restreint aux groupes ayant une chambre dans
// un hôtel accessible. La sidebar reste montée en permanence → on rafraîchit à
// chaque navigation via `refreshKey` (typiquement le pathname).
export function useGroupesAlert(hotelIds: string[], refreshKey?: string): number {
  const [count, setCount] = useState(0);
  const key = hotelIds.join(',');

  useEffect(() => {
    if (!key) { setCount(0); return; }
    let cancelled = false;
    (async () => {
      const ids = key.split(',');
      const { data: gc } = await supabase
        .from('groupe_chambres').select('groupe_id').in('hotel_id', ids);
      const gids = [...new Set((gc || []).map((r: { groupe_id: string }) => r.groupe_id))];
      if (!gids.length) { if (!cancelled) setCount(0); return; }
      const [c1, c2] = await Promise.all([
        supabase.from('groupe_reservations').select('id', { count: 'exact', head: true })
          .in('groupe_id', gids).eq('statut', 'confirmee').eq('vu_backoffice', false),
        supabase.from('groupe_reservations').select('id', { count: 'exact', head: true })
          .in('groupe_id', gids).eq('statut', 'annulee').eq('pms_done', false),
      ]);
      if (!cancelled) setCount((c1.count || 0) + (c2.count || 0));
    })();
    return () => { cancelled = true; };
  }, [key, refreshKey]);

  return count;
}
