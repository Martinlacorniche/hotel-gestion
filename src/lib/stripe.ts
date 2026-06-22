import Stripe from 'stripe';

// Stripe multi-compte (un compte Stripe par hôtel). Server-only.
// La Corniche et Les Voiles ont chacun leur propre compte Stripe → on route la
// clé secrète + le secret webhook selon l'hôtel concerné par le paiement.

const HOTELS: Record<string, { name: string; secretEnv: string; webhookEnv: string }> = {
  // La Corniche
  'f9d59e56-9a2f-433e-bcf4-f9753f105f32': { name: 'corniche', secretEnv: 'STRIPE_SECRET_KEY',        webhookEnv: 'STRIPE_WEBHOOK_SECRET' },
  // Les Voiles
  'ded6e6fb-ff3c-4fa8-ad07-403ee316be53': { name: 'voiles',   secretEnv: 'STRIPE_SECRET_KEY_VOILES', webhookEnv: 'STRIPE_WEBHOOK_SECRET_VOILES' },
};
// Hôtel par défaut si non reconnu (Corniche).
const DEFAULT_HOTEL = 'f9d59e56-9a2f-433e-bcf4-f9753f105f32';

const cache = new Map<string, Stripe>();

// Client Stripe du compte par défaut (Corniche).
export function getStripe(): Stripe {
  return getStripeForHotel(DEFAULT_HOTEL);
}

// Client Stripe du compte de l'hôtel donné.
export function getStripeForHotel(hotelId: string | null | undefined): Stripe {
  const conf = (hotelId && HOTELS[hotelId]) || HOTELS[DEFAULT_HOTEL];
  const key = process.env[conf.secretEnv];
  if (!key) throw new Error(`Clé Stripe manquante (${conf.secretEnv}) pour l'hôtel ${conf.name}`);
  if (!cache.has(conf.secretEnv)) cache.set(conf.secretEnv, new Stripe(key));
  return cache.get(conf.secretEnv)!;
}

// Tous les secrets webhook configurés (pour vérifier une signature quel que soit le compte émetteur).
export function getWebhookSecrets(): string[] {
  return [...new Set(Object.values(HOTELS).map(h => process.env[h.webhookEnv]))].filter(Boolean) as string[];
}

// Expéditeur Resend par hôtel : même domaine vérifié (send.hotel-corniche.com),
// mais nom affiché adapté (« Les Voiles » vs « La Corniche ») tant qu'on n'a pas
// de domaine Voiles dédié.
const SENDERS: Record<string, string> = {
  'f9d59e56-9a2f-433e-bcf4-f9753f105f32': 'Best Western Plus La Corniche <paiement@send.hotel-corniche.com>',
  'ded6e6fb-ff3c-4fa8-ad07-403ee316be53': 'Les Voiles <paiement@send.hotel-corniche.com>',
};
export function senderFor(hotelId: string | null | undefined): string {
  return (hotelId && SENDERS[hotelId]) || SENDERS[DEFAULT_HOTEL];
}
