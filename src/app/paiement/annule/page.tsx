// Page publique de retour si le client abandonne le paiement (cancel_url Stripe).
export default function PaiementAnnulePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-2xl">×</div>
        <h1 className="text-xl font-semibold text-slate-800 mb-1">Paiement annulé</h1>
        <p className="text-sm text-slate-500">Votre paiement n&apos;a pas été finalisé. Vous pouvez réessayer depuis le lien reçu.</p>
        <p className="text-xs text-slate-400 mt-4">Best Western Plus La Corniche</p>
      </div>
    </div>
  );
}
