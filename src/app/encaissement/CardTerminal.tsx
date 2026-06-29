'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Loader2, CreditCard, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { stripePromiseFor } from '@/lib/stripeClient';

const euro = (n: number) => Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` };
}

interface Props {
  hotelId: string;
  amount: number;            // euros (0 si vide)
  description: string;
  clientNom: string;
  email: string;
  onPaid: () => void;        // recharge l'historique
}

const CARD_STYLE = {
  style: {
    base: { fontSize: '16px', color: '#1e293b', '::placeholder': { color: '#94a3b8' } },
    invalid: { color: '#e11d48' },
  },
};

// Formulaire interne : DOIT être rendu dans <Elements> pour accéder à useStripe/useElements.
function CardForm({ hotelId, amount, description, clientNom, email, onPaid }: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const canPay = !!stripe && !!elements && ready && amount > 0 && !busy;

  async function pay() {
    if (!stripe || !elements) return;
    if (!amount || amount <= 0) return toast.error('Indique un montant.');
    const card = elements.getElement(CardElement);
    if (!card) return;
    setBusy(true);
    try {
      // 1) Tokenisation côté navigateur : la carte part chez Stripe, jamais chez nous.
      const { error: pmErr, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card', card,
        billing_details: { name: clientNom || undefined, email: email || undefined },
      });
      if (pmErr) { toast.error(pmErr.message || 'Carte invalide'); return; }

      // 2) Débit immédiat côté serveur (MOTO).
      const res = await fetch('/api/paiements/charge', {
        method: 'POST', headers: await authHeaders(),
        body: JSON.stringify({ hotelId, amount, description, clientNom, email, paymentMethodId: paymentMethod.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erreur');
      toast.success(`Carte débitée — ${euro(amount)}`);
      card.clear();
      onPaid();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <span className="text-xs font-medium text-slate-500 mb-1 block">Carte bancaire</span>
        <div className="w-full border rounded-lg px-3 py-3 bg-white">
          <CardElement options={CARD_STYLE} onReady={() => setReady(true)} />
        </div>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <span className="text-xs text-slate-400 inline-flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-600" /> Saisie sécurisée Stripe — la carte ne transite jamais par nos serveurs.
        </span>
        <button onClick={pay} disabled={!canPay}
          className="h-11 px-5 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition disabled:opacity-50 inline-flex items-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
          {amount > 0 ? `Débiter ${euro(amount)}` : 'Débiter la carte'}
        </button>
      </div>
    </div>
  );
}

// Wrapper : recharge la bonne clé publique quand l'hôtel change (key={hotelId}).
export default function CardTerminal(props: Props) {
  const promise = stripePromiseFor(props.hotelId);
  if (!promise) {
    return <p className="text-sm text-rose-600">Clé Stripe publique absente pour cet hôtel — terminal indisponible.</p>;
  }
  return (
    <Elements key={props.hotelId} stripe={promise}>
      <CardForm {...props} />
    </Elements>
  );
}
