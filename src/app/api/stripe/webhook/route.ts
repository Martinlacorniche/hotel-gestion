import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { Resend } from 'resend';
import { getStripe, getWebhookSecrets, senderFor } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { pushPaymentToMews } from '@/lib/mews';

// Base publique du site invité (Site-BW) pour le lien « gérer ma réservation ».
const SITE_BW_BASE = process.env.NEXT_PUBLIC_SITE_BW_URL || 'https://sitehtbm.netlify.app';

// Email de confirmation au client une fois le paiement (obligatoire) validé.
async function sendGuestConfirmation(checkoutId: string, hotelId?: string | null) {
  if (!process.env.RESEND_API_KEY) return;
  const { data: resas } = await supabaseAdmin
    .from('groupe_reservations')
    .select('nom, prenom, email, booking_ref, date_arrivee, date_depart, groupe_id, groupe_chambres(room_units(numero, room_types(nom)))')
    .eq('stripe_checkout_id', checkoutId);
  if (!resas || resas.length === 0) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const first: any = resas[0];
  if (!first.email) return;
  const { data: g } = await supabaseAdmin.from('groupes').select('nom, code_acces').eq('id', first.groupe_id).single();
  const roomLabel = (r: { groupe_chambres?: unknown }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gc: any = Array.isArray(r.groupe_chambres) ? r.groupe_chambres[0] : r.groupe_chambres;
    const ru = Array.isArray(gc?.room_units) ? gc.room_units[0] : gc?.room_units;
    const rt = Array.isArray(ru?.room_types) ? ru.room_types[0] : ru?.room_types;
    return `Ch. ${ru?.numero ?? '?'}${rt?.nom ? ` · ${rt.nom}` : ''}`;
  };
  const roomRows = resas.map((r) =>
    `<tr><td style="padding:6px 10px;border:1px solid #e2e8f0;font-weight:600;">${roomLabel(r)}</td></tr>`).join('');
  const link = g?.code_acces ? `${SITE_BW_BASE}/groupe/${g.code_acces}?r=${first.booking_ref}` : '';
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: senderFor(hotelId),
    to: first.email,
    subject: `Réservation confirmée · ${g?.nom ?? ''}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1e293b;">
        <div style="background:#004e7c;padding:20px 28px;border-radius:12px 12px 0 0;">
          <p style="margin:0;color:#C6A972;font-size:11px;letter-spacing:.12em;text-transform:uppercase;">${g?.nom ?? ''}</p>
          <h1 style="margin:6px 0 0;color:#fff;font-size:20px;">Réservation confirmée — paiement reçu</h1>
        </div>
        <div style="background:#f8fafc;padding:22px 28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">
          <p style="margin:0 0 12px;">Bonjour ${first.prenom || first.nom}, votre paiement est confirmé. Récapitulatif :</p>
          <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
            <tr><td style="padding:6px 0;color:#64748b;font-size:12px;width:110px;">Séjour</td><td style="padding:6px 0;font-weight:600;">${first.date_arrivee} → ${first.date_depart}</td></tr>
          </table>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px;">${roomRows}</table>
          ${link ? `<p style="margin:4px 0 0;text-align:center;"><a href="${link}" style="background:#004e7c;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:bold;">Voir / gérer ma réservation</a></p>` : ''}
          <p style="margin:14px 0 0;color:#94a3b8;font-size:11px;text-align:center;">Votre code à 4 chiffres vous sera demandé pour modifier ou annuler.</p>
        </div>
      </div>`,
  });
}

// POST /api/stripe/webhook — Stripe notifie ici les paiements/échecs/remboursements.
// Webhook UNIQUE pour TOUS les comptes (Corniche, Voiles…) : on vérifie la
// signature contre chaque secret webhook configuré.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const secrets = getWebhookSecrets();
  if (secrets.length === 0) return NextResponse.json({ error: 'Aucun STRIPE_WEBHOOK_SECRET configuré' }, { status: 500 });

  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'Signature manquante' }, { status: 400 });

  const raw = await req.text();
  const stripe = getStripe();
  let event: Stripe.Event | null = null;
  for (const sec of secrets) {
    try { event = stripe.webhooks.constructEvent(raw, sig, sec); break; } catch { /* essaie le secret suivant */ }
  }
  if (!event) return NextResponse.json({ error: 'Webhook: signature invalide' }, { status: 400 });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.payment_status !== 'paid') break;
        const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id ?? null;
        const { data: pay } = await supabaseAdmin.from('payments')
          .update({ status: 'paid', paid_at: new Date().toISOString(), stripe_payment_intent_id: pi })
          .eq('stripe_checkout_id', s.id).select().single();
        // Le règlement est encaissé ET une réservation Mews a été rattachée à la
        // création → on le pose sur le folio du client, sans geste humain. C'est
        // la raison d'être du rattachement en amont : la réception n'a plus à
        // revenir cocher « PMS fait » ni à recopier le montant dans le PMS.
        // Best-effort : un échec Mews ne doit jamais faire retourner une erreur à
        // Stripe (il rejouerait le webhook). Le bouton de rattrapage reste là.
        if (pay?.id && pay?.mews_customer_id) {
          try {
            const { id: mewsId, skipped } = await pushPaymentToMews(pay.id);
            if (skipped) console.warn('Mews: encaissement non transmis —', skipped, pay.id);
            else console.log('Mews: encaissement posé sur le folio', mewsId);
          } catch (e) {
            console.error('Mews: push encaissement échoué', pay.id, e instanceof Error ? e.message : e);
          }
        }
        // Répercute sur le dossier commercial lié (cumul des règlements)
        if (pay?.lead_id) {
          const { data: lead } = await supabaseAdmin.from('suivi_commercial').select('montant_paye').eq('id', pay.lead_id).single();
          const prev = Number(lead?.montant_paye || 0);
          await supabaseAdmin.from('suivi_commercial').update({ montant_paye: prev + Number(pay.amount || 0) }).eq('id', pay.lead_id);
        }
        // Paiement invité d'un groupe : confirme toutes les chambres tenues par
        // cette session (multi-chambres d'un même hôtel = une session).
        const { data: confirmed } = await supabaseAdmin.from('groupe_reservations')
          .update({ statut: 'confirmee', derniere_action: 'creation', modified_at: new Date().toISOString() })
          .eq('stripe_checkout_id', s.id).in('statut', ['en_attente_paiement', 'paiement_differe']).select('id');
        // Email de confirmation au client (uniquement si on vient bien de confirmer une résa invité).
        if (confirmed && confirmed.length > 0) {
          try { await sendGuestConfirmation(s.id, pay?.hotel_id); } catch (e) { console.warn('Email confirmation invité:', e instanceof Error ? e.message : e); }
        }
        break;
      }
      case 'checkout.session.expired': {
        const s = event.data.object as Stripe.Checkout.Session;
        await supabaseAdmin.from('payments')
          .update({ status: 'canceled' }).eq('stripe_checkout_id', s.id).eq('status', 'open');
        // Libère les chambres tenues pour une résa invité non payée à temps.
        await supabaseAdmin.from('groupe_reservations')
          .update({ statut: 'expiree', modified_at: new Date().toISOString() })
          .eq('stripe_checkout_id', s.id).eq('statut', 'en_attente_paiement');
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
        if (pi) {
          await supabaseAdmin.from('payments')
            .update({ status: 'refunded', refunded_at: new Date().toISOString() })
            .eq('stripe_payment_intent_id', pi);
        }
        break;
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'erreur traitement';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
