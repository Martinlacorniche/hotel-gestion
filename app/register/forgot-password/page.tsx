'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  const handleReset = async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://consigneshtbm.com/update-password',
    });

    if (error) {
      setMessage(`Erreur : ${error.message}`);
    } else {
      setMessage('Un email de réinitialisation a été envoyé.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
      <div className="bg-white p-6 rounded shadow-md w-full max-w-sm">
        <h1 className="text-xl font-bold mb-4">Mot de passe oublié</h1>
        <Input
          type="email"
          placeholder="Votre adresse email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4"
        />
        <Button onClick={handleReset} className="w-full">Envoyer le lien</Button>
        {message && <p className="mt-4 text-sm text-center">{message}</p>}
      </div>
    </div>
  );
}
