import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { senderFor } from '@/lib/stripe';

const VOILES_ID = 'ded6e6fb-ff3c-4fa8-ad07-403ee316be53';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://hotels-toulon-mer.com';

// POST /api/rooftop/reservation-email — confirmation d'une réservation de table
// au Rooftop des Voiles. Appelé depuis le module interne /rooftop (prise de résa
// par l'équipe). Porté depuis la vitrine Site-BW (même template) : notifie
// l'équipe + envoie une confirmation au client (si email), avec lien agenda.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

  const nom = String(body.nom ?? '').trim();
  const email = String(body.email ?? '').trim();
  const telephone = String(body.telephone ?? '').trim();
  const heure = String(body.heure ?? '').trim();
  const couverts = Number(body.couverts) || 0;
  const date = String(body.date ?? '');
  const message = String(body.message ?? '').trim();
  const table = String(body.table ?? '').trim();

  const dateFr = (() => {
    try {
      return new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });
    } catch { return date; }
  })();

  // Lien "Ajouter à mon agenda" (Google Calendar).
  const calLink = (() => {
    try {
      const m = String(heure).match(/(\d{1,2})\s*[h:]\s*(\d{0,2})/i);
      const h = m ? parseInt(m[1], 10) : 19;
      const min = m && m[2] ? parseInt(m[2], 10) : 0;
      const ymd = String(date).replace(/-/g, '');
      const pad = (n: number) => String(n).padStart(2, '0');
      const start = `${ymd}T${pad(h)}${pad(min)}00`;
      const end = `${ymd}T${pad(Math.min(h + 2, 23))}${pad(min)}00`;
      const p = new URLSearchParams({
        action: 'TEMPLATE',
        text: 'Rooftop Les Voiles — Table réservée',
        dates: `${start}/${end}`,
        details: `Réservation pour ${couverts} personne(s) à ${heure}.`,
        location: 'Hôtel Les Voiles, 124 rue Gubler, 83000 Toulon',
      });
      return `https://calendar.google.com/calendar/render?${p.toString()}`;
    } catch { return null; }
  })();

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = senderFor(VOILES_ID);

  // 1) Notif équipe.
  const { error: teamErr } = await resend.emails.send({
    from,
    to: 'contact-lesvoiles@htbm.fr',
    replyTo: email || undefined,
    subject: `🍸 Réservation Rooftop · ${dateFr} ${heure} — ${nom} (${couverts} pers.)`,
    html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #1e293b;">
        <div style="background: #004e7c; padding: 24px 32px; border-radius: 12px 12px 0 0;">
          <p style="margin: 0; color: #C6A972; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;">Rooftop Les Voiles · Réservation</p>
          <h1 style="margin: 8px 0 0; color: #fff; font-size: 20px; font-weight: 700;">${dateFr} · ${heure}</h1>
        </div>
        <div style="background: #f8fafc; padding: 28px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; color: #64748b; font-size: 12px; width: 120px;">Nom</td><td style="padding: 8px 0; font-weight: 600;">${nom}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b; font-size: 12px;">Couverts</td><td style="padding: 8px 0;">${couverts} personne(s)</td></tr>
            ${table ? `<tr><td style="padding: 8px 0; color: #64748b; font-size: 12px;">Table</td><td style="padding: 8px 0;">${table}</td></tr>` : ''}
            <tr><td style="padding: 8px 0; color: #64748b; font-size: 12px;">Date</td><td style="padding: 8px 0;">${dateFr}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b; font-size: 12px;">Heure</td><td style="padding: 8px 0;">${heure}</td></tr>
            ${telephone ? `<tr><td style="padding: 8px 0; color: #64748b; font-size: 12px;">Téléphone</td><td style="padding: 8px 0;">${telephone}</td></tr>` : ''}
            ${email ? `<tr><td style="padding: 8px 0; color: #64748b; font-size: 12px;">Email</td><td style="padding: 8px 0;"><a href="mailto:${email}" style="color: #004e7c;">${email}</a></td></tr>` : ''}
            ${message ? `<tr><td style="padding: 8px 0; color: #64748b; font-size: 12px; vertical-align: top;">Message</td><td style="padding: 8px 0; font-style: italic;">${message}</td></tr>` : ''}
          </table>
          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
            <p style="margin: 0; font-size: 11px; color: #94a3b8;">Réservation prise au comptoir Rooftop.</p>
          </div>
        </div>
      </div>
    `,
  });
  if (teamErr) console.error('Resend error (rooftop team):', teamErr);

  // 2) Confirmation client (best-effort).
  if (email) {
    const { error: clientErr } = await resend.emails.send({
      from,
      to: email,
      subject: `Votre table au Rooftop des Voiles — ${dateFr} à ${heure}`,
      html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #1e293b;">
        <div style="background: #013a5c; padding: 26px 32px; border-radius: 12px 12px 0 0; text-align: center;">
          <p style="margin: 0; color: #C6A972; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;">Rooftop · Les Voiles · Toulon</p>
          <h1 style="margin: 10px 0 0; color: #fff; font-size: 22px; font-weight: 700;">C'est réservé ! 🥂</h1>
        </div>
        <div style="background: #ffffff; padding: 28px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="margin: 0 0 16px; font-size: 15px;">Bonjour ${nom},</p>
          <p style="margin: 0 0 20px; font-size: 14px; color: #475569; line-height: 1.55;">
            Votre table vous attend au Rooftop des Voiles. On a hâte de vous accueillir face à la rade !
          </p>
          <table style="width: 100%; border-collapse: collapse; background: #f9f5ef; border-radius: 10px;">
            <tr><td style="padding: 12px 16px 4px; color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;">Quand</td></tr>
            <tr><td style="padding: 0 16px 12px; font-size: 16px; font-weight: 600; text-transform: capitalize;">${dateFr} · ${heure}</td></tr>
            <tr><td style="padding: 0 16px 4px; color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;">Pour</td></tr>
            <tr><td style="padding: 0 16px 14px; font-size: 15px;">${couverts} personne(s)</td></tr>
          </table>
          ${calLink ? `
          <div style="text-align: center; margin: 24px 0 8px;">
            <a href="${calLink}" style="background: #C6A972; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; padding: 13px 26px; border-radius: 9999px; display: inline-block;">📅 Ajouter à mon agenda</a>
          </div>` : ''}
          <div style="text-align: center; margin: 10px 0 0;">
            <a href="${SITE_URL}/rooftop-les-voiles" style="color: #004e7c; font-size: 13px; text-decoration: underline;">Revoir la carte du rooftop</a>
          </div>
          <p style="margin: 20px 0 0; font-size: 12px; color: #94a3b8; line-height: 1.55; text-align: center;">
            Un empêchement ? Appelez-nous au 04 94 41 36 23.<br/>Hôtel Les Voiles · 124 rue Gubler, Toulon
          </p>
        </div>
      </div>
      `,
    });
    if (clientErr) console.error('Resend error (rooftop client):', clientErr);
  }

  return NextResponse.json({ ok: !teamErr });
}
