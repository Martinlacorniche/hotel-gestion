'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const STORAGE_KEY = 'selectedHotelId';

export type Hotel = { id: string; nom: string; [key: string]: unknown };

/**
 * Encapsule le scope "hôtel courant" partagé par la quasi-totalité des écrans :
 * - état `selectedHotelId` initialisé depuis localStorage
 * - persistance localStorage à chaque changement
 * - chargement de la liste des hôtels + sélection du premier par défaut
 * - dérivation de `currentHotel` depuis la liste (pas de requête en plus)
 *
 * Remplace le bloc copié-collé dans ~11 pages.
 *
 * @param select colonnes à charger sur `hotels` (défaut "id, nom").
 *               Passe p.ex. "id, nom, logo_url" si l'écran a besoin de plus.
 */
export function useHotelScope(select: string = 'id, nom') {
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [selectedHotelId, setSelectedHotelIdState] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem(STORAGE_KEY) || '';
    }
    return '';
  });

  const setSelectedHotelId = (id: string) => {
    setSelectedHotelIdState(id);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, id);
    }
  };

  useEffect(() => {
    supabase
      .from('hotels')
      .select(select)
      .then(({ data }) => {
        const list = (data as unknown as Hotel[]) || [];
        setHotels(list);
        // Sélectionne le premier hôtel par défaut si rien n'est encore choisi.
        setSelectedHotelIdState((prev) => {
          if (prev) return prev;
          const first = list[0]?.id || '';
          if (first && typeof window !== 'undefined') {
            window.localStorage.setItem(STORAGE_KEY, first);
          }
          return first;
        });
      });
  }, [select]);

  const currentHotel = useMemo(
    () => hotels.find((h) => h.id === selectedHotelId) || null,
    [hotels, selectedHotelId]
  );

  return { hotels, selectedHotelId, setSelectedHotelId, currentHotel };
}
