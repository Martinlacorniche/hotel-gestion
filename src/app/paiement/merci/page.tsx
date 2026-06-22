// Page publique de retour après un paiement réussi (success_url Stripe).
// Le client (non connecté) y atterrit après avoir payé.
export default function PaiementMerciPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-2xl">✓</div>
        <h1 className="text-xl font-semibold text-slate-800 mb-1">Paiement reçu</h1>
        <p className="text-sm text-slate-500">Merci, votre paiement a bien été enregistré. Un reçu vous a été envoyé par email.</p>
        <p className="text-xs text-slate-400 mt-4">Best Western Plus La Corniche</p>
      </div>
    </div>
  );
}
