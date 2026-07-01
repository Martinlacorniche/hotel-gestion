import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { senderFor } from '@/lib/stripe';

const VOILES_ID = 'ded6e6fb-ff3c-4fa8-ad07-403ee316be53';

// POST /api/rooftop/cancel-email — prévient le client qu'une réservation du
// Rooftop des Voiles a été annulée. Appelé depuis le module interne /rooftop.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

  const nom = String(body.nom ?? '').trim();
  const email = String(body.email ?? '').trim();
  const heure = String(body.heure ?? '').trim();
  const couverts = Number(body.couverts) || 0;
  const date = String(body.date ?? '');
  if (!email) return NextResponse.json({ ok: false, error: 'email requis' }, { status: 400 });

  const dateFr = (() => {
    try {
      return new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });
    } catch { return date; }
  })();

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: senderFor(VOILES_ID),
    to: email,
    subject: `Annulation de votre table au Rooftop des Voiles — ${dateFr}`,
    html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #1e293b;">
        <div style="background: #013a5c; padding: 24px 32px; border-radius: 12px 12px 0 0; text-align: center;">
          <p style="margin: 0; color: #C6A972; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;">Rooftop · Les Voiles · Toulon</p>
          <h1 style="margin: 10px 0 0; color: #fff; font-size: 20px; font-weight: 700;">Réservation annulée</h1>
        </div>
        <div style="background: #ffffff; padding: 28px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="margin: 0 0 16px; font-size: 15px;">Bonjour ${nom || ''},</p>
          <p style="margin: 0 0 18px; font-size: 14px; color: #475569; line-height: 1.55;">
            Nous sommes navrés : votre réservation au Rooftop des Voiles pour le
            <strong style="text-transform: capitalize;"> ${dateFr}</strong>${heure ? ` à <strong>${heure}</strong>` : ''}${couverts ? ` (${couverts} personne(s))` : ''}
            a dû être annulée.
          </p>
          <p style="margin: 0 0 8px; font-size: 14px; color: #475569; line-height: 1.55;">
            Pour reprogrammer votre venue ou pour toute question, appelez-nous directement, on s'occupe de vous :
          </p>
          <div style="text-align: center; margin: 20px 0 6px;">
            <a href="tel:0494413623" style="background: #C6A972; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 15px; padding: 13px 28px; border-radius: 9999px; display: inline-block;">📞 04 94 41 36 23</a>
          </div>
          <p style="margin: 18px 0 0; font-size: 12px; color: #94a3b8; text-align: center;">Hôtel Les Voiles · 124 rue Gubler, Toulon</p>
        </div>
      </div>
    `,
  });

  if (error) {
    console.error('Resend error (rooftop cancel):', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
