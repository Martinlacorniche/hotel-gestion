import { NextResponse } from 'next/server';

// POST /api/mews/webhook
//
// Récepteur des notifications Mews (Integration Events). Déclaré au formulaire
// de certification : https://consigneshtbm.com/api/mews/webhook
//
// Événements demandés : réservation modifiée, chambre modifiée, blocage de
// chambre, client créé/modifié, paiement modifié.
//
// RÈGLE D'OR d'un webhook : répondre 200 TOUT DE SUITE, quoi qu'il arrive.
// Mews réémet en cas d'échec puis finit par désactiver le hook — un traitement
// lent ou une exception non rattrapée, et on perd la notification. On accuse
// donc réception, et le travail réel se fera plus tard, en asynchrone (le
// contenu de la notification est de toute façon minimal : Mews annonce QU'IL
// s'est passé quelque chose, pas quoi — il faut de toute façon relire l'objet
// par l'API).
//
// État : réception + trace. Le câblage des actions (rafraîchir l'occupation,
// réveiller la borne, mettre à jour la caisse) viendra quand les tokens de
// production seront émis.

export const dynamic = 'force-dynamic';

// Mews peut appeler l'URL en GET pour vérifier qu'elle répond avant d'activer
// le hook : on ne le laisse pas tomber sur un 405.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'mews-webhook' });
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    // Garde-fou : on ne se fait pas noyer par un corps aberrant.
    const body = raw.length > 100_000 ? raw.slice(0, 100_000) : raw;

    let payload: unknown;
    try { payload = JSON.parse(body); } catch { payload = body; }

    // Mews envoie soit un événement seul, soit un lot : { Events: [...] }.
    const events = (payload as { Events?: unknown[] })?.Events ?? [payload];
    console.log(`[mews-webhook] ${events.length} événement(s)`, JSON.stringify(payload).slice(0, 2000));
  } catch (e) {
    // Même en cas de pépin de notre côté, on accuse réception : réessayer ne
    // servirait à rien et Mews finirait par couper le hook.
    console.error('[mews-webhook] erreur de lecture', e);
  }

  return NextResponse.json({ ok: true });
}
