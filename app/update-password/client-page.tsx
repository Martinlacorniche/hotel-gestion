'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function UpdatePasswordClientPage() {
  const searchParams = useSearchParams();
  const [newPassword, setNewPassword] = useState('');
  const [status, setStatus] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);

  // ✅ Essayer d'établir la session dès que possible
  useEffect(() => {
    const accessToken = searchParams.get('access_token');

    if (accessToken) {
      (async () => {
        const { error } = await supabase.auth.exchangeCodeForSession(accessToken);
        if (error) {
          console.error('Erreur lors de l’échange de session :', error.message);
          setStatus('❌ Erreur session : ' + error.message);
        } else {
          console.log('✅ Session restaurée avec access token.');
        }
      })();
    }
  }, [searchParams]);

  // ✅ Fallback : écoute si Supabase restaure une session plus tard (cas Netlify/NextJS)
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('🔁 Événement auth :', event);
      if (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') {
        setStatus('✅ Session active.');
      }
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
      setStatus('✅ Mot de passe mis à jour !');
      setIsSubmitted(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
      <div className="bg-white p-6 rounded shadow-md w-full max-w-md text-center">
        <h1 className="text-xl font-bold mb-4">🔐 Réinitialisation du mot de passe</h1>
        {!isSubmitted ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="password"
              placeholder="Nouveau mot de passe"
              className="w-full p-2 border border-gray-300 rounded"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <button
              type="submit"
              className="w-full bg-indigo-600 text-white p-2 rounded hover:bg-indigo-700 transition"
            >
              🔁 Mettre à jour
            </button>
          </form>
        ) : (
          <p className="text-green-700 font-medium">{status}</p>
        )}
        {status && !isSubmitted && <p className="mt-4 text-sm text-red-600">{status}</p>}
      </div>
    </div>
  );
}
