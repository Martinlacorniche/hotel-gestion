import { NextResponse } from 'next/server';
import { getStripeForHotel } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePaymentAccess } from '@/lib/apiAuth';

// POST /api/paiements/charge — TPE virtuel : encaisse DIRECTEMENT une carte saisie
// sur place / au téléphone (MOTO), sans lien de paiement. La carte n'arrive jamais
// sur notre serveur : le navigateur l'a tokenisée chez Stripe (PaymentMethod), on
// ne reçoit que son id. Confirmation synchrone → on connaît le résultat tout de suite.
// Le PMS de l'hôtel reste la facture légale + TVA (pas de facture Stripe émise).
// Body: { hotelId, amount (€), description?, clientNom?, email?, paymentMethodId, leadId? }
// Accès : admin/superadmin, ou rôle « user » pendant son shift.
export async function POST(req: Request) {
  const auth = await requirePaymentAccess(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const amount = Number(body.amount);
  const description = String(body.description || '').trim();
  const email = String(body.email || '').trim();
  const clientNom = String(body.clientNom || '').trim();
  const hotelId = body.hotelId ? String(body.hotelId) : null;
  const leadId = body.leadId ? String(body.leadId) : null;
  const paymentMethodId = String(body.paymentMethodId || '').trim();

  if (!amount || amount <= 0) return NextResponse.json({ error: 'Montant invalide' }, { status: 400 });
  if (!paymentMethodId) return NextResponse.json({ error: 'Carte manquante' }, { status: 400 });

  // Nom de l'utilisateur (audit)
  const { data: me } = await supabaseAdmin.from('users').select('name').eq('id_auth', auth.userId).single();
  const createdBy = (me?.name as string) || 'Staff';

  const cents = Math.round(amount * 100);
  const label = description || 'Paiement carte';

  try {
    const stripe = getStripeForHotel(hotelId);

    // MOTO = la carte est saisie par le staff (pas le porteur en ligne) → pas de 3DS.
    // Nécessite que MOTO soit activé sur le compte Stripe (sinon Stripe refuse le flag) :
    // on retente alors sans MOTO pour ne pas bloquer les tests / cartes hors-SCA.
    const baseParams = {
      amount: cents,
      currency: 'eur',
      payment_method: paymentMethodId,
      confirm: true,
      description: label,
      receipt_email: email || undefined,
      // Pas de redirection 3DS possible côté terminal staff.
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' as const },
      metadata: { type: 'tpe', lead_id: leadId || '', hotel_id: hotelId || '', created_by: createdBy },
    };

    let intent;
    try {
      intent = await stripe.paymentIntents.create({
        ...baseParams,
        payment_method_options: { card: { moto: true } },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message.toLowerCase() : '';
      if (msg.includes('moto')) {
        // MOTO pas (encore) activé sur ce compte → on encaisse sans le flag.
        intent = await stripe.paymentIntents.create(baseParams);
      } else {
        throw e;
      }
    }

    if (intent.status !== 'succeeded') {
      // requires_action (3DS) ou autre : le porteur n'est pas là pour authentifier.
      // On annule pour ne pas laisser un PaymentIntent fantôme et on remonte l'info.
      try { if (intent.status === 'requires_action' || intent.status === 'requires_confirmation') await stripe.paymentIntents.cancel(intent.id); } catch { /* best effort */ }
      const reason = intent.status === 'requires_action'
        ? "La carte exige une authentification 3D Secure : impossible à valider sur place. Activez MOTO sur le compte Stripe, ou utilisez un lien de paiement."
        : `Paiement non abouti (statut Stripe : ${intent.status}).`;
      return NextResponse.json({ error: reason }, { status: 402 });
    }

    const { data: row, error } = await supabaseAdmin.from('payments').insert({
      hotel_id: hotelId, type: 'manuel', method: 'tpe', lead_id: leadId,
      amount, currency: 'eur', description: description || null,
      client_nom: clientNom || null, email: email || null,
      status: 'paid', paid_at: new Date().toISOString(),
      stripe_payment_intent_id: intent.id,
      created_by: createdBy,
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Répercute sur le dossier commercial lié (cumul des règlements), comme le webhook.
    if (leadId) {
      const { data: lead } = await supabaseAdmin.from('suivi_commercial').select('montant_paye').eq('id', leadId).single();
      const prev = Number(lead?.montant_paye || 0);
      await supabaseAdmin.from('suivi_commercial').update({ montant_paye: prev + amount }).eq('id', leadId);
    }

    return NextResponse.json({ ok: true, payment: row });
  } catch (e: unknown) {
    // Erreurs « carte refusée » de Stripe : message clair pour le staff.
    const err = e as { type?: string; message?: string; code?: string };
    const msg = err?.message || 'Erreur Stripe';
    const status = err?.type === 'StripeCardError' ? 402 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
