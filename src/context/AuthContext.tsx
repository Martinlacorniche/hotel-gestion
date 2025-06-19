'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { User } from '@supabase/supabase-js';

interface ExtendedUser extends User {
  role?: string;
  name?: string;
}

interface AuthContextType {
  user: ExtendedUser | null;
  isLoading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  logout: () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<ExtendedUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const authUser = session?.user;

      if (authUser) {
        const { data: userData } = await supabase
          .from('users')
          .select('*')
          .eq('id_auth', authUser.id)
          .single();

        setUser(userData ? {
          ...authUser,
          role: userData.role,
          name: userData.name,
        } : null);
      } else {
        setUser(null);
      }

      setIsLoading(false);
    };

    loadUser();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        supabase
          .from('users')
          .select('*')
          .eq('id_auth', session.user.id)
          .single()
          .then(({ data: userData }) => {
            setUser(userData ? {
              ...session.user,
              role: userData.role,
              name: userData.name,
            } : null);
          });
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
    <AuthContext.Provider value={{ user, isLoading, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
