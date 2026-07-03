import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getStripeForHotel, senderFor } from '@/lib/stripe';

// Cron « paiement programmé » des groupes (mode différé). Deux passes en un appel :
//   1. ENVOI  : résas paiement_differe dont le groupe.date_envoi_paiement <= today
//               et pas encore envoyées → crée un lien Stripe (par booking × hôtel),
//               l'email au client, et marque payment_link_sent_at.
//   2. RELÂCHE : résas paiement_differe dont le lien a > 48h et non payées → annule
//               (libère la chambre) + mail client + alerte équipe.
// Auth : header x-cron-secret (repli x-mews-poll-secret). À déclencher 1×/jour.

export const dynamic = 'force-dynamic';

const SITE_BW = process.env.NEXT_PUBLIC_SITE_BW_URL || 'https://sitehtbm.netlify.app';
const HOLD_HOURS = 48;

function parisToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const euro = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));

type Row = {
  id: string; booking_ref: string; email: string; nom: string; prenom: string | null;
  date_arrivee: string; date_depart: string; groupe_id: string; payment_link_sent_at: string | null;
  groupe_chambres: { hotel_id: string; tarif_nuit: number; room_units: { numero: string } | null } | null;
  groupes: { nom: string; code_acces: string; date_envoi_paiement: string | null } | null;
};

// Mail charte HTBM (navy + doré).
function htbmMail(title: string, bodyHtml: string) {
  return `
  <div style="font-family:Georgia,'Times New Roman',serif;max-width:560px;margin:0 auto;color:#1e293b;">
    <div style="background:#004e7c;padding:20px 28px;border-radius:12px 12px 0 0;">
      <p style="margin:0;color:#C6A972;font-size:11px;letter-spacing:.12em;text-transform:uppercase;">Best Western Plus · La Corniche</p>
      <h1 style="margin:6px 0 0;color:#fff;font-size:20px;">${title}</h1>
    </div>
    <div style="background:#f8fafc;padding:22px 28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;font-family:Helvetica,Arial,sans-serif;">
      ${bodyHtml}
    </div>
  </div>`;
}

async function teamEmail(hotelId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('hotels').select('email_equipe').eq('id', hotelId).single();
  return data?.email_equipe || process.env.GROUPES_ALERT_EMAIL || process.env.ALERT_EMAIL || null;
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.MEWS_POLL_SECRET;
  const provided = req.headers.get('x-cron-secret') || req.headers.get('x-mews-poll-secret');
  if (!secret || provided !== secret) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 });

  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  const today = parisToday();
  const nowMs = Date.now();

  const { data, error } = await supabaseAdmin
    .from('groupe_reservations')
    .select('id, booking_ref, email, nom, prenom, date_arrivee, date_depart, groupe_id, payment_link_sent_at,' +
      ' groupe_chambres!inner ( hotel_id, tarif_nuit, room_units ( numero ) ),' +
      ' groupes!inner ( nom, code_acces, date_envoi_paiement )')
    .eq('statut', 'paiement_differe');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const rows = (data || []) as unknown as Row[];

  let envois = 0, relaches = 0;

  // ── 1) ENVOI des liens dus ──────────────────────────────────────────────────
  // Groupe par (booking_ref × hôtel) : une session Stripe (compte par hôtel).
  const toSend = rows.filter(r => !r.payment_link_sent_at && r.groupes?.date_envoi_paiement && r.groupes.date_envoi_paiement <= today);
  const byBookingHotel = new Map<string, Row[]>();
  for (const r of toSend) {
    const hid = r.groupe_chambres?.hotel_id;
    if (!hid) continue;
    const key = `${r.booking_ref}|${hid}`;
    (byBookingHotel.get(key) ?? byBookingHotel.set(key, []).get(key)!).push(r);
  }

  for (const [key, group] of byBookingHotel) {
    const hotelId = key.split('|')[1];
    const first = group[0];
    const lines = group.map(r => {
      const nights = nightsBetween(r.date_arrivee, r.date_depart);
      return { name: `${r.groupes?.nom} · Ch. ${r.groupe_chambres?.room_units?.numero ?? '?'} · ${nights} nuit(s)`, amount: Math.round(Number(r.groupe_chambres?.tarif_nuit) * nights * 100) };
    });
    const total = lines.reduce((s, l) => s + l.amount, 0);
    if (total <= 0 || !resend) continue;

    try {
      const stripe = getStripeForHotel(hotelId);
      const code = first.groupes?.code_acces;
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: lines.map(l => ({ price_data: { currency: 'eur', unit_amount: l.amount, product_data: { name: l.name } }, quantity: 1 })),
        customer_email: first.email,
        metadata: { type: 'groupe_resa', groupe_id: first.groupe_id, hotel_id: hotelId, booking_ref: first.booking_ref },
        success_url: `${SITE_BW}/groupe/${code}?r=${first.booking_ref}&paye=1`,
        cancel_url: `${SITE_BW}/groupe/${code}?r=${first.booking_ref}`,
      });
      const nowIso = new Date().toISOString();
      await supabaseAdmin.from('groupe_reservations')
        .update({ stripe_checkout_id: session.id, payment_link_sent_at: nowIso })
        .in('id', group.map(r => r.id));
      await supabaseAdmin.from('payments').insert({
        hotel_id: hotelId, type: 'groupe_resa', amount: total / 100, currency: 'eur',
        description: `${first.groupes?.nom} — ${lines.length} chambre(s) (paiement programmé)`,
        client_nom: `${first.prenom || ''} ${first.nom}`.trim(), email: first.email,
        status: 'open', stripe_checkout_id: session.id, hosted_invoice_url: session.url,
      });
      await resend.emails.send({
        from: senderFor(hotelId), to: first.email,
        subject: `Votre lien de paiement · ${first.groupes?.nom}`,
        html: htbmMail('Lien de paiement', `
          <p style="margin:0 0 14px;">Bonjour ${first.prenom || first.nom},</p>
          <p style="margin:0 0 16px;">Voici le lien pour régler votre réservation <strong>${first.groupes?.nom}</strong> (${euro(total / 100)}). Merci de procéder au paiement sous <strong>48&nbsp;heures</strong>, sans quoi la chambre sera automatiquement remise à disposition.</p>
          <p style="margin:0 0 6px;text-align:center;"><a href="${session.url}" style="display:inline-block;background:#C6A972;color:#1e293b;padding:12px 26px;border-radius:10px;text-decoration:none;font-weight:bold;">Payer ${euro(total / 100)}</a></p>`),
      });
      envois++;
    } catch (e) { console.error('paiement-programme envoi', key, e); }
  }

  // ── 2) RELÂCHE des impayés > 48h ────────────────────────────────────────────
  const toRelease = rows.filter(r => r.payment_link_sent_at && (nowMs - new Date(r.payment_link_sent_at).getTime()) > HOLD_HOURS * 3600e3);
  for (const r of toRelease) {
    const hotelId = r.groupe_chambres?.hotel_id;
    const { error: upErr } = await supabaseAdmin.from('groupe_reservations')
      .update({ statut: 'annulee', derniere_action: 'annulation', modified_at: new Date().toISOString(), vu_backoffice: false, pms_done: false })
      .eq('id', r.id).eq('statut', 'paiement_differe');
    if (upErr) { console.error('paiement-programme relache', r.id, upErr); continue; }
    relaches++;
    if (!resend) continue;
    const num = r.groupe_chambres?.room_units?.numero ?? '?';
    try {
      await resend.emails.send({
        from: senderFor(hotelId || ''), to: r.email,
        subject: `Réservation annulée · ${r.groupes?.nom}`,
        html: htbmMail('Réservation annulée', `
          <p style="margin:0 0 14px;">Bonjour ${r.prenom || r.nom},</p>
          <p style="margin:0 0 8px;">Faute de paiement dans le délai imparti, votre réservation pour <strong>${r.groupes?.nom}</strong> (chambre ${num}) a été annulée et la chambre remise à disposition.</p>
          <p style="margin:0;color:#94a3b8;font-size:12px;">Vous pouvez toujours réserver à nouveau si des disponibilités subsistent.</p>`),
      });
      const to = hotelId ? await teamEmail(hotelId) : null;
      if (to) await resend.emails.send({
        from: senderFor(hotelId || ''), to,
        subject: `⏰ Chambre relâchée (impayé) · ${r.groupes?.nom}`,
        html: htbmMail('Chambre relâchée', `
          <p style="margin:0 0 8px;">La réservation de <strong>${r.prenom || ''} ${r.nom}</strong> (chambre ${num}, ${r.groupes?.nom}) a été <strong>annulée automatiquement</strong> faute de paiement sous 48h.</p>
          <p style="margin:0;color:#e11d48;font-weight:600;font-size:13px;">À retirer du PMS si elle y avait été saisie.</p>`),
      });
    } catch (e) { console.error('paiement-programme mail relache', r.id, e); }
  }

  return NextResponse.json({ ok: true, differees: rows.length, envois, relaches });
}

export async function GET(req: NextRequest) { return POST(req); }
