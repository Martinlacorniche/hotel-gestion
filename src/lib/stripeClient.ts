import { loadStripe, type Stripe } from '@stripe/stripe-js';

// Stripe.js côté navigateur (TPE virtuel). Un compte Stripe par hôtel → on charge
// la BONNE clé publique selon l'hôtel sélectionné. Les clés NEXT_PUBLIC_* sont
// inlinées au build : sûres à exposer (clés publiques uniquement).

const CORNICHE = 'f9d59e56-9a2f-433e-bcf4-f9753f105f32';
const VOILES = 'ded6e6fb-ff3c-4fa8-ad07-403ee316be53';

const PUB_KEYS: Record<string, string | undefined> = {
  [CORNICHE]: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  [VOILES]: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_VOILES,
};

// Cache des promesses loadStripe par clé (une instance par compte).
const cache = new Map<string, Promise<Stripe | null>>();

export function stripePromiseFor(hotelId: string | null | undefined): Promise<Stripe | null> | null {
  const key = PUB_KEYS[hotelId ?? ''] || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key) return null;
  if (!cache.has(key)) cache.set(key, loadStripe(key));
  return cache.get(key)!;
}
