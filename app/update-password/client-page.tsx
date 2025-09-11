'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Eye, EyeOff } from 'lucide-react'


export default function UpdatePasswordClientPage() {
  const searchParams = useSearchParams();
  const [newPassword, setNewPassword] = useState('');
  const [status, setStatus] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [showPwd, setShowPwd] = useState(false)


  // 🔐 Restaurer la session si access_token présent
  useEffect(() => {
    const accessToken = searchParams.get('access_token');
    const type = searchParams.get('type');

    console.log('🔎 URL:', window.location.href);
  console.log('🔐 access_token:', accessToken);
  console.log('🔐 type:', type);

    if (accessToken && type === 'recovery') {
      console.log('🔑 Tentative de récupération de session avec token :', accessToken);
      supabase.auth
        .exchangeCodeForSession(accessToken)
        .then(({ data, error }) => {
 console.log('🧪 Résultat exchangeCodeForSession');
      console.log('data:', data);
      console.log('error:', error);
          if (error) {
            console.error('Erreur exchangeCodeForSession:', error.message);
            setStatus('❌ Erreur session : ' + error.message);
          } else {
            console.log('✅ Session restaurée avec succès.');
          }
        });
    }
  }, [searchParams]);

  // 🔁 Sécurité : écouter les changements de session en fallback
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('🪝 Auth event:', event, session);
    });

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      console.error('Erreur updateUser:', error.message);
      setStatus('❌ Erreur : ' + error.message);
    } else {
      setStatus('✅ Mot de passe mis à jour avec succès !');
      setIsSubmitted(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
      <div className="bg-white p-6 rounded shadow-md w-full max-w-md text-center">
        <h1 className="text-xl font-bold mb-4">🔐 Réinitialisation du mot de passe</h1>
        {!isSubmitted ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
  <input
    type={showPwd ? 'text' : 'password'}
    placeholder="Nouveau mot de passe"
    className="w-full p-2 pr-10 border border-gray-300 rounded"
    value={newPassword}
    onChange={(e) => setNewPassword(e.target.value)}
    required
    aria-label="Nouveau mot de passe"
  />
  <button
    type="button"
    onClick={() => setShowPwd((s) => !s)}
    className="absolute inset-y-0 right-2 flex items-center"
    aria-label={showPwd ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
  >
    {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
  </button>
</div>

            <button
              type="submit"
              className="w-full bg-indigo-600 text-white p-2 rounded hover:bg-indigo-700 transition"
            >
              🔁 Mettre à jour
            </button>
          </form>
       ) : (
  <div>
    <p className="text-green-700 font-medium">{status}</p>
    <div className="mt-6">
      <a
        href="/login"
        className="inline-block bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 transition"
      >
        🔑 Se connecter
      </a>
    </div>
  </div>
)}

        {status && !isSubmitted && <p className="mt-4 text-sm text-red-600">{status}</p>}
      </div>
    </div>
  );
}
