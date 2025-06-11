'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Session, User } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  logout: () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
  // Récupère la session
  supabase.auth.getSession().then(async ({ data: { session } }) => {
    const authUser = session?.user;
    if (authUser) {
      // ➕ Requête vers ta table "users"
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id_auth', authUser.id)
        .single();

      setUser({
        ...authUser,
        role: userData?.role,
        name: userData?.name,
      });
    } else {
      setUser(null);
    }
  });

  // Listener Supabase
  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      supabase
        .from('users')
        .select('*')
        .eq('id_auth', session.user.id)
        .single()
        .then(({ data: userData }) => {
          setUser({
            ...session.user,
            role: userData?.role,
            name: userData?.name,
          });
        });
    } else {
      setUser(null);
    }
  });

  return () => {
    listener.subscription.unsubscribe();
  };
}, []);


  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
