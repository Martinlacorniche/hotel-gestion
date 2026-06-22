import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getStripeForHotel, senderFor } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';

// POST /api/paiements/create — TPE virtuel : crée un LIEN DE PAIEMENT Stripe
// (Checkout, PAS de facture → le PMS de l'hôtel reste la facture légale + TVA :
// Hotsoft à la Corniche, Mews aux Voiles), renvoie le lien, et l'envoie par
// email si demandé. Réservé admin/superadmin.
// Body: { hotelId, amount (€), description, email, clientNom?, leadId?, sendEmail }
export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin', 'admin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const amount = Number(body.amount);
  const description = String(body.description || '').trim();
  const email = String(body.email || '').trim();
  const clientNom = String(body.clientNom || '').trim();
  const hotelId = body.hotelId ? String(body.hotelId) : null;
  const leadId = body.leadId ? String(body.leadId) : null;
  const sendEmail = body.sendEmail !== false;

  if (!amount || amount <= 0) return NextResponse.json({ error: 'Montant invalide' }, { status: 400 });
  if (sendEmail && !email) return NextResponse.json({ error: 'Email requis pour envoyer la demande' }, { status: 400 });

  // Nom de l'utilisateur (audit)
  const { data: me } = await supabaseAdmin.from('users').select('name').eq('id_auth', auth.userId).single();
  const createdBy = (me?.name as string) || 'Staff';

  const origin = req.headers.get('origin') || 'http://localhost:3000';
  const cents = Math.round(amount * 100);
  const label = description || 'Paiement';

  try {
    const stripe = getStripeForHotel(hotelId);
    // Lien de paiement Checkout : encaissement seul, émet un reçu (pas de facture fiscale).
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price_data: { currency: 'eur', unit_amount: cents, product_data: { name: label } }, quantity: 1 }],
      customer_email: email || undefined,
      metadata: { type: 'manuel', lead_id: leadId || '', hotel_id: hotelId || '' },
      payment_intent_data: { description: label, metadata: { lead_id: leadId || '' } },
      success_url: `${origin}/paiement/merci`,
      cancel_url: `${origin}/paiement/annule`,
    });

    const { data: row, error } = await supabaseAdmin.from('payments').insert({
      hotel_id: hotelId, type: 'manuel', lead_id: leadId,
      amount, currency: 'eur', description: description || null,
      client_nom: clientNom || null, email: email || null,
      status: 'open',
      stripe_checkout_id: session.id,
      hosted_invoice_url: session.url,
      created_by: createdBy,
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Envoi du lien par email (Resend). ⚠️ Le SDK ne throw pas : il renvoie { error }.
    let emailed = false;
    let emailError: string | null = null;
    if (sendEmail && email) {
      if (!process.env.RESEND_API_KEY) {
        emailError = 'RESEND_API_KEY absente (serveur à redémarrer ?)';
      } else {
        try {
          const resend = new Resend(process.env.RESEND_API_KEY);
          const { error: mailErr } = await resend.emails.send({
            from: senderFor(hotelId),
            to: email,
            subject: `Demande de paiement — ${euro(amount)} · Best Western Plus La Corniche`,
            html: paymentEmailHtml({ clientNom, amount, description, url: session.url! }),
          });
          if (mailErr) emailError = (mailErr as { message?: string }).message || String(mailErr);
          else emailed = true;
        } catch (e2) {
          emailError = e2 instanceof Error ? e2.message : 'Erreur envoi email';
        }
        if (emailError) console.warn('Email Resend non envoyé :', emailError);
      }
    }

    return NextResponse.json({ ok: true, url: session.url, emailed, emailError, payment: row });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erreur Stripe';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function euro(n: number) {
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

// Template email de demande de paiement (table-based + styles inline = compatible
// clients mail). Mention explicite « pas une facture » → pas de confusion avec le PMS.
function paymentEmailHtml({ clientNom, amount, description, url }: { clientNom: string; amount: number; description: string; url: string }) {
  const name = clientNom ? ` ${escapeHtml(clientNom)}` : '';
  const desc = description ? ` pour <strong>${escapeHtml(description)}</strong>` : '';
  return `
  <div style="background:#f4f6f8;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6e9ee;">
        <tr><td style="background:#004e7c;padding:22px 28px;">
          <div style="color:#ffffff;font-size:17px;font-weight:bold;letter-spacing:.3px;">Best Western Plus La Corniche</div>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 14px;font-size:15px;color:#222;">Bonjour${name},</p>
          <p style="margin:0 0 22px;font-size:14px;color:#555;line-height:1.55;">Voici votre demande de paiement${desc}. Vous pouvez régler en toute sécurité par carte bancaire en cliquant sur le bouton ci-dessous.</p>
          <div style="text-align:center;margin:0 0 4px;">
            <div style="font-size:12px;color:#9aa3ad;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Montant à régler</div>
            <div style="font-size:32px;font-weight:bold;color:#004e7c;">${euro(amount)}</div>
          </div>
          <div style="text-align:center;margin:24px 0;">
            <a href="${url}" style="background:#004e7c;color:#ffffff;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">Régler ${euro(amount)}</a>
          </div>
          <p style="margin:18px 0 0;font-size:12px;color:#9aa3ad;line-height:1.55;text-align:center;">Paiement 100&nbsp;% sécurisé via Stripe. Ce message est une demande de paiement et ne constitue pas une facture&nbsp;: celle-ci vous sera remise par l'hôtel.</p>
        </td></tr>
        <tr><td style="background:#fafbfc;padding:16px 28px;border-top:1px solid #eef1f4;">
          <div style="font-size:12px;color:#9aa3ad;">Best Western Plus La Corniche · Toulon</div>
        </td></tr>
      </table>
    </td></tr></table>
  </div>`;
}
