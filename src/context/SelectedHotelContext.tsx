'use client';

// État global de l'hôtel sélectionné, partagé par TOUS les écrans + la sidebar.
// Avant : chaque useHotelScope avait son propre useState → changer d'hôtel sur
// une page ne mettait pas à jour le rail (et inversement). Ici l'id vit dans un
// seul contexte : tout consommateur réagit au même changement.
// La liste des hôtels (et ses colonnes) reste chargée par useHotelScope, qui ne
// partage QUE l'id sélectionné — chaque page garde donc son `select` spécifique.
//
// Le DÉFAUT est résolu ici (et nulle part ailleurs) : dernier choix délibéré en
// localStorage → sinon hôtel attribué de l'user (default_hotel_id puis hotel_id).
// Les pages ne doivent plus poser de fallback "premier hôtel" : ça écrasait le
// choix de l'user par le 1er hôtel de la base (Les Voiles) à chaque refresh.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';

const STORAGE_KEY = 'selectedHotelId';
// Purge unique : le bug "list[0] écrase le choix" (cf. useHotelScope) a pollué
// le localStorage de tous les users avec le 1er hôtel. On vide la clé une seule
// fois par navigateur pour repartir sur l'hôtel attribué.
const RESET_FLAG = 'selectedHotelId.reset.v1';

interface SelectedHotelState {
  selectedHotelId: string;
  setSelectedHotelId: (id: string) => void;
  /** true une fois le défaut initial résolu (auth chargée). Tant que c'est false,
   *  ne PAS poser de fallback "premier hôtel" : on ne connaît pas encore l'user. */
  initialized: boolean;
}

const SelectedHotelContext = createContext<SelectedHotelState | null>(null);

export function SelectedHotelProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  // Démarre vide (identique serveur/client) puis restaure depuis le localStorage
  // APRÈS hydratation — sinon le HTML serveur ('') diffère du client → mismatch.
  const [selectedHotelId, setId] = useState<string>('');
  const [initialized, setInitialized] = useState(false);
  const hydratedRef = useRef(false);
  const resolvedForRef = useRef<string | null | undefined>(undefined);

  // 1) Après hydratation : purge unique de l'ancienne valeur corrompue, puis
  //    restauration du dernier choix DÉLIBÉRÉ depuis le localStorage.
  useEffect(() => {
    if (!window.localStorage.getItem(RESET_FLAG)) {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.setItem(RESET_FLAG, '1');
    }
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setId(saved);
    hydratedRef.current = true;
  }, []);

  // 2) Défaut = hôtel attribué de l'user, une fois l'auth chargée — uniquement
  //    si aucun choix n'existe déjà (le localStorage garde la priorité, donc
  //    "le dernier choisi" survit au refresh). Rejoué si l'user change (login).
  useEffect(() => {
    if (isLoading || !hydratedRef.current) return;
    const uid = user?.id ?? null;
    if (resolvedForRef.current === uid) return; // déjà résolu pour cet user
    resolvedForRef.current = uid;
    setId((prev) => {
      if (prev) return prev; // localStorage (choix délibéré) a déjà gagné
      const def = user?.default_hotel_id || user?.hotel_id || '';
      if (def) window.localStorage.setItem(STORAGE_KEY, def);
      return def;
    });
    setInitialized(true);
  }, [isLoading, user]);

  const setSelectedHotelId = useCallback((id: string) => {
    setId(id);
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, id);
  }, []);

  return (
    <SelectedHotelContext.Provider value={{ selectedHotelId, setSelectedHotelId, initialized }}>
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
  return { selectedHotelId: '', setSelectedHotelId: () => {}, initialized: false };
}
