'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Eye, EyeOff } from 'lucide-react'


export default function UpdatePasswordClientPage() {
  const searchParams = useSearchParams();
  const [flow, setFlow] = useState<'invite' | 'recovery'>('recovery');
  const [newPassword, setNewPassword] = useState('');
  const [status, setStatus] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [showPwd, setShowPwd] = useState(false)
  // SÉCURITÉ : on n'autorise le changement QUE si le lien contient un token
  // recovery/invite — capturé au 1er rendu, AVANT que Supabase nettoie l'URL.
  // Sinon updateUser() modifierait la session déjà connectée (bug grave : on a
  // changé le mauvais compte en bricolant un lien sans token).
  const [recoveryReady, setRecoveryReady] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const u = window.location.hash + window.location.search;
    return /access_token=|[?&]code=|type=recovery|type=invite/.test(u);
  });


  // 🏷️ Détecter si on est sur un flow "invite" — soit via query string (?flow=invite),
  // soit via le fragment URL (#type=invite, format Supabase implicit flow).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (searchParams?.get('flow') === 'invite') { setFlow('invite'); return; }
    const hash = window.location.hash.replace(/^#/, '');
    const hashParams = new URLSearchParams(hash);
    if (hashParams.get('type') === 'invite') setFlow('invite');
  }, [searchParams]);

  // La session de récupération est établie automatiquement par Supabase
  // (detectSessionInUrl) à partir du token du lien. On écoute l'event en backup
  // pour confirmer `recoveryReady` (en plus de la détection au 1er rendu).
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setRecoveryReady(true);
    });
    return () => { listener?.subscription.unsubscribe(); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Garde-fou : sans session de récupération valide (lien sans token), on
    // refuse — sinon on changerait le mot de passe du compte déjà connecté.
    if (!recoveryReady) {
      setStatus('❌ Lien invalide ou expiré. Redemandez un email de réinitialisation.');
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      console.error('Erreur updateUser:', error.message);
      setStatus('❌ Erreur : ' + error.message);
    } else {
      setStatus(flow === 'invite' ? '✅ Compte activé ! Vous pouvez vous connecter.' : '✅ Mot de passe mis à jour avec succès !');
      setIsSubmitted(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
      <div className="bg-white p-6 rounded shadow-md w-full max-w-md text-center">
        <h1 className="text-xl font-bold mb-4">
          {flow === 'invite' ? '👋 Bienvenue !' : '🔐 Réinitialisation du mot de passe'}
        </h1>
        {flow === 'invite' && !isSubmitted && (
          <p className="text-sm text-gray-600 mb-4">
            Définissez le mot de passe de votre compte pour terminer la création.
          </p>
        )}
        {!recoveryReady ? (
          <div>
            <p className="text-red-600 text-sm font-medium">❌ Lien invalide ou expiré.</p>
            <p className="text-gray-500 text-xs mt-2">Ce lien ne contient pas de jeton de récupération valide. Redemandez un email de réinitialisation.</p>
            <a href="/forgot-password" className="inline-block mt-4 bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 transition text-sm">Redemander un lien</a>
          </div>
        ) : !isSubmitted ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
  <input
    type={showPwd ? 'text' : 'password'}
    placeholder={flow === 'invite' ? 'Choisissez votre mot de passe' : 'Nouveau mot de passe'}
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
              {flow === 'invite' ? '✅ Valider et accéder à l\'app' : '🔁 Mettre à jour'}
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
