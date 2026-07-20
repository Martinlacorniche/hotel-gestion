"use client";

// Page d'aiguillage du rôle 'daf' : il n'a AUCUN accès au back-office web,
// son outil c'est l'application mobile Consignes. AppShell redirige ici toute
// tentative d'accès à une autre page (verrou deny-by-default).
// La page reste protégée : un visiteur non connecté est renvoyé au /login.

import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Smartphone, LogOut } from "lucide-react";

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
          Votre accès se fait depuis l&apos;application mobile <strong>Consignes</strong>.
          Le site web n&apos;est pas utilisé pour votre profil.
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
