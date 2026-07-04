'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useSelectedHotel } from '@/context/SelectedHotelContext';
import { useAuth } from '@/context/AuthContext';

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
  const { selectedHotelId, setSelectedHotelId, initialized } = useSelectedHotel();
  const { user, isLoading } = useAuth();
  const [hotels, setHotels] = useState<Hotel[]>([]);

  // Charge la liste des hôtels UNE FOIS LA SESSION AUTH PRÊTE. Sinon (bug mobile /
  // tablette) le fetch pouvait partir avant la restauration de session → RLS
  // renvoie une liste vide, sans retry → `currentHotel` restait nul → menu du rail
  // incomplet (items conditionnés par l'hôtel masqués) jusqu'à un rechargement.
  // On dépend de `isLoading`/`user?.id` pour (re)fetcher dès que l'auth est prête
  // et à chaque changement d'utilisateur (login/logout).
  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;
    supabase
      .from('hotels')
      .select(select)
      .then(({ data }) => {
        if (!cancelled) setHotels((data as unknown as Hotel[]) || []);
      });
    return () => { cancelled = true; };
  }, [select, isLoading, user?.id]);

  // Dernier recours : si l'init du contexte est terminée (auth chargée) et que
  // l'user n'a AUCUN hôtel attribué (ex. superadmin), on retombe sur le 1er hôtel.
  // Effet SÉPARÉ avec deps fraîches → plus de closure périmée. C'était l'ancien
  // bug : le `.then()` lisait un `selectedHotelId` figé à '' et écrasait à chaque
  // refresh le choix de l'user par list[0] (Les Voiles).
  useEffect(() => {
    if (!initialized || selectedHotelId) return;
    if (hotels[0]?.id) setSelectedHotelId(hotels[0].id);
  }, [initialized, selectedHotelId, hotels, setSelectedHotelId]);

  const currentHotel = useMemo(
    () => hotels.find((h) => h.id === selectedHotelId) || null,
    [hotels, selectedHotelId],
  );

  return { hotels, selectedHotelId, setSelectedHotelId, currentHotel };
}
