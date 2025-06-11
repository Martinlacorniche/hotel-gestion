'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('employe');
  const [errorMsg, setErrorMsg] = useState('');
  const router = useRouter();

  const handleRegister = async () => {
    // 1. Créer le compte Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError || !authData.user) {
      setErrorMsg(authError?.message || "Erreur d'inscription");
      return;
    }

    // 2. Ajouter l'utilisateur dans la table personnalisée
    const { error: insertError } = await supabase.from('users').insert([
      {
        email,
        name,
        role,
        id_auth: authData.user.id,
      },
    ]);

    if (insertError) {
      setErrorMsg(insertError.message);
      return;
    }

    router.push('/');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
      <div className="bg-white p-6 rounded shadow-md w-full max-w-sm">
        <h1 className="text-xl font-bold mb-4">Créer un compte</h1>
        <Input placeholder="Nom" value={name} onChange={(e) => setName(e.target.value)} className="mb-2" />
        <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="mb-2" />
        <Input type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} className="mb-4" />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full border rounded px-2 py-2 mb-4">
          <option value="employe">Employé</option>
          <option value="admin">Admin</option>
        </select>
        {errorMsg && <p className="text-red-500 text-sm mb-4">{errorMsg}</p>}
        <Button onClick={handleRegister} className="w-full">S'inscrire</Button>
      </div>
    </div>
  );
}
