'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Loader2, ShieldCheck, Wifi, Check } from 'lucide-react';
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
    <div className="mx-auto w-full max-w-sm">
      {/* Boîtier TPE */}
      <div className="rounded-[26px] bg-gradient-to-b from-slate-800 to-slate-900 p-4 shadow-xl ring-1 ring-black/20">
        {/* Écran : montant à régler */}
        <div className="rounded-2xl bg-gradient-to-b from-slate-700 to-slate-800 px-5 py-4 ring-1 ring-white/5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold tracking-[0.2em] text-slate-400">MONTANT À RÉGLER</span>
            <Wifi className="w-4 h-4 text-emerald-400/80" />
          </div>
          <div className="mt-1 font-mono text-4xl font-bold tracking-tight text-emerald-300 tabular-nums">
            {euro(amount)}
          </div>
        </div>

        {/* Insertion carte */}
        <div className="mt-4">
          <span className="text-[10px] font-semibold tracking-[0.18em] text-slate-400 mb-1.5 block px-1">CARTE BANCAIRE</span>
          <div className="w-full rounded-xl bg-white px-3.5 py-3.5 ring-1 ring-white/10">
            <CardElement options={CARD_STYLE} onReady={() => setReady(true)} />
          </div>
        </div>

        {/* Touche de validation */}
        <button onClick={pay} disabled={!canPay}
          className="mt-4 h-14 w-full rounded-2xl text-base font-bold text-white bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] transition disabled:bg-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/40">
          {busy
            ? <><Loader2 className="w-5 h-5 animate-spin" /> Traitement…</>
            : <><Check className="w-5 h-5" /> {amount > 0 ? `Valider ${euro(amount)}` : 'Saisir un montant'}</>}
        </button>
      </div>

      <p className="mt-3 text-center text-xs text-slate-400 inline-flex items-center justify-center gap-1.5 w-full">
        <ShieldCheck className="w-4 h-4 text-emerald-600" /> Saisie sécurisée Stripe — la carte ne transite jamais par nos serveurs.
      </p>
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
