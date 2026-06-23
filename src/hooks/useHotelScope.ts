'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useSelectedHotel } from '@/context/SelectedHotelContext';

export type Hotel = { id: string; nom: string; [key: string]: unknown };

/**
 * Encapsule le scope "hôtel courant" partagé par la quasi-totalité des écrans :
 * - `selectedHotelId` vient désormais d'un CONTEXTE global (SelectedHotelContext)
 *   → changer d'hôtel sur une page met à jour la sidebar et toutes les autres
 *   pages montées qui utilisent ce hook (et inversement).
 * - chaque appel charge néanmoins sa propre liste d'hôtels avec ses colonnes
 *   (`select`), donc on ne partage que l'id, pas la forme des objets.
 *
 * @param select colonnes à charger sur `hotels` (défaut "id, nom").
 */
export function useHotelScope(select: string = 'id, nom') {
  const { selectedHotelId, setSelectedHotelId } = useSelectedHotel();
  const [hotels, setHotels] = useState<Hotel[]>([]);

  useEffect(() => {
    supabase
      .from('hotels')
      .select(select)
      .then(({ data }) => {
        const list = (data as unknown as Hotel[]) || [];
        setHotels(list);
        // Sélectionne le premier hôtel par défaut si rien n'est encore choisi.
        if (!selectedHotelId && list[0]?.id) setSelectedHotelId(list[0].id);
      });
    // selectedHotelId volontairement hors deps : on ne veut pas refetch à chaque
    // changement d'hôtel, et le défaut ci-dessus n'a besoin de tourner qu'au chargement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [select]);

  const currentHotel = useMemo(
    () => hotels.find((h) => h.id === selectedHotelId) || null,
    [hotels, selectedHotelId],
  );

  return { hotels, selectedHotelId, setSelectedHotelId, currentHotel };
}
