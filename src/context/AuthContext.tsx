'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { User } from '@supabase/supabase-js';
import { applyTheme, applyFont, type ThemeId, type FontId } from '@/lib/themes';

interface ExtendedUser extends User {
  role?: string;
  name?: string;
  hotel_id?: string | null;
  emoji?: string | null;
  default_hotel_id?: string | null;
  theme?: ThemeId | null;
  font_family?: FontId | null;
}

interface AuthContextType {
  user: ExtendedUser | null;
  isLoading: boolean;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  logout: () => {},
  refreshUser: async () => {},
});

function mergeUserData(authUser: User, userData: Record<string, unknown> | null): ExtendedUser {
  // Si le fetch de public.users échoue (erreur transitoire, RLS,
  // CHECK contrainte sur une autre colonne, etc.), on garde quand même
  // l'auth user pour ne pas casser toute l'app. Mieux vaut un user sans
  // rôle qu'un user null qui force une déco.
  if (!userData) return authUser as ExtendedUser;
  return {
    ...authUser,
    role: userData.role as string | undefined,
    name: userData.name as string | undefined,
    hotel_id: userData.hotel_id as string | null | undefined,
    emoji: userData.emoji as string | null | undefined,
    default_hotel_id: userData.default_hotel_id as string | null | undefined,
    theme: userData.theme as ThemeId | null | undefined,
    font_family: userData.font_family as FontId | null | undefined,
  };
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<ExtendedUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUserData = async (authUser: User): Promise<ExtendedUser> => {
    const { data: userData, error } = await supabase
      .from('users')
      .select('*')
      .eq('id_auth', authUser.id)
      .single();
    if (error) {
      // Log explicite pour debug si le fetch user échoue
      console.warn('[AuthContext] fetch public.users a échoué :', error.message);
    }
    return mergeUserData(authUser, userData);
  };

  const refreshUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const merged = await fetchUserData(session.user);
      setUser(merged);
    }
  };

  // Applique le thème et la police de l'user à chaque changement de user
  useEffect(() => {
    applyTheme(user?.theme || 'classique');
    applyFont(user?.font_family || 'inter');
  }, [user?.theme, user?.font_family]);

  useEffect(() => {
    const loadUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const authUser = session?.user;
      if (authUser) {
        const merged = await fetchUserData(authUser);
        setUser(merged);
      } else {
        setUser(null);
      }
      setIsLoading(false);
    };

    loadUser();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        fetchUserData(session.user).then(setUser);
      } else {
        setUser(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
