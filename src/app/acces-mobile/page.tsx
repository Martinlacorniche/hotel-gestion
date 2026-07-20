"use client";

// Page d'aiguillage du rôle 'daf' : il n'a AUCUN accès au back-office web,
// son outil c'est l'application mobile Consignes. AppShell redirige ici toute
// tentative d'accès à une autre page (verrou deny-by-default).
// La page reste protégée : un visiteur non connecté est renvoyé au /login.

import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Smartphone, LogOut, Apple, Play } from "lucide-react";

export default function AccesMobilePage() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
        <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-[var(--brand-bg)] text-[var(--brand)] flex items-center justify-center">
          <Smartphone size={26} />
        </div>

        <h1 className="text-xl font-semibold text-slate-800">
          Ça se passe sur mobile
        </h1>
        <p className="mt-3 text-sm text-slate-500 leading-relaxed">
          Votre accès se fait depuis l&apos;application{" "}
          <strong>Hôtels Toulon Bord de Mer</strong>. Le site web n&apos;est pas
          utilisé pour votre profil.
        </p>

        {/* Sans ces liens la page est un cul-de-sac : l'invitation par email
            amène ici après création du mot de passe, et on annonçait « utilisez
            l'application » sans dire où la trouver. Les identifiants viennent de
            app.json ; l'id App Store (6751883454) a été résolu depuis le
            bundleId via l'API de lookup Apple. */}
        <div className="mt-6 flex flex-col gap-2">
          <a
            href="https://apps.apple.com/fr/app/hotels-toulon-bord-de-mer/id6751883454"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Apple size={16} /> Télécharger sur l&apos;App Store
          </a>
          <a
            href="https://play.google.com/store/apps/details?id=com.martinvitte.hotelstoulonborddemer"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Play size={16} /> Télécharger sur Google Play
          </a>
        </div>

        <p className="mt-4 text-xs text-slate-400 leading-relaxed">
          Connectez-vous dans l&apos;application avec ce même email et le mot de
          passe que vous venez de choisir.
        </p>

        {user?.email && (
          <p className="mt-5 text-xs text-slate-400">
            Connecté en tant que {user.name || user.email}
          </p>
        )}

        <div className="mt-6">
          <Button variant="ghost" onClick={() => logout()}>
            <LogOut size={14} className="mr-2" /> Se déconnecter
          </Button>
        </div>
      </div>
    </div>
  );
}
