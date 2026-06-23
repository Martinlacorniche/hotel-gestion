'use client';

// État global de l'hôtel sélectionné, partagé par TOUS les écrans + la sidebar.
// Avant : chaque useHotelScope avait son propre useState → changer d'hôtel sur
// une page ne mettait pas à jour le rail (et inversement). Ici l'id vit dans un
// seul contexte : tout consommateur réagit au même changement.
// La liste des hôtels (et ses colonnes) reste chargée par useHotelScope, qui ne
// partage QUE l'id sélectionné — chaque page garde donc son `select` spécifique.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'selectedHotelId';

interface SelectedHotelState {
  selectedHotelId: string;
  setSelectedHotelId: (id: string) => void;
}

const SelectedHotelContext = createContext<SelectedHotelState | null>(null);

export function SelectedHotelProvider({ children }: { children: React.ReactNode }) {
  // Démarre vide (identique serveur/client) puis restaure depuis le localStorage
  // APRÈS hydratation — sinon le HTML serveur ('') diffère du client → mismatch.
  const [selectedHotelId, setId] = useState<string>('');
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setId(saved);
  }, []);

  const setSelectedHotelId = useCallback((id: string) => {
    setId(id);
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, id);
  }, []);

  return (
    <SelectedHotelContext.Provider value={{ selectedHotelId, setSelectedHotelId }}>
      {children}
    </SelectedHotelContext.Provider>
  );
}

// Hook bas niveau. La plupart des écrans passent par useHotelScope (qui ajoute la
// liste des hôtels + currentHotel). Renvoie un fallback hors provider (sécurité).
export function useSelectedHotel(): SelectedHotelState {
  const ctx = useContext(SelectedHotelContext);
  if (ctx) return ctx;
  // Hors provider (ne devrait pas arriver) : pas de partage, mais pas de crash.
  return { selectedHotelId: '', setSelectedHotelId: () => {} };
}
