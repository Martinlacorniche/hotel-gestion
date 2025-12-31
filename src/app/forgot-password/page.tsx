'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Input } from '@/components/ui/input';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleReset = async () => {
    if (!email) {
      setMessage('Veuillez entrer votre adresse email.');
      return;
    }

    setLoading(true);
    setMessage('');

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });

    if (error) {
      setMessage(`❌ Erreur : ${error.message}`);
    } else {
      setMessage('✅ Un email de réinitialisation a été envoyé. Vérifiez votre boîte mail.');
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
      <div className="bg-white p-6 rounded shadow-md w-full max-w-sm">
        <h1 className="text-xl font-bold mb-4">🔑 Mot de passe oublié</h1>

        <p className="text-sm text-gray-600 mb-4">
          Entrez votre adresse email et nous vous enverrons un lien pour réinitialiser votre mot de passe.
        </p>

        <Input
          type="email"
          placeholder="Votre adresse email"
          className="mb-3"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <button
          onClick={handleReset}
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-md font-semibold"
        >
          {loading ? 'Envoi en cours...' : 'Envoyer le lien'}
        </button>

        {message && (
          <p
            className={`mt-4 text-sm text-center ${
              message.startsWith('✅') ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {message}
          </p>
        )}

        <p className="text-sm text-center mt-6">
          <a
            href="/login"
            className="text-blue-600 underline hover:text-blue-800"
          >
            ← Retour à la connexion
          </a>
        </p>
      </div>
    </div>
  );
}
