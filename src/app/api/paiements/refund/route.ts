import { NextResponse } from 'next/server';
import { getStripeForHotel } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';

// POST /api/paiements/refund  — rembourse un paiement (total).
// Body: { paymentId }. Réservé admin/superadmin.
export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin', 'admin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }
  const paymentId = String(body.paymentId || '');
  const reason = String(body.reason || '').trim();
  if (!paymentId) return NextResponse.json({ error: 'paymentId manquant' }, { status: 400 });
  if (!reason) return NextResponse.json({ error: 'Motif du remboursement obligatoire' }, { status: 400 });

  const { data: pay, error } = await supabaseAdmin.from('payments').select('*').eq('id', paymentId).single();
  if (error || !pay) return NextResponse.json({ error: 'Paiement introuvable' }, { status: 404 });
  if (pay.status !== 'paid') return NextResponse.json({ error: 'Seul un paiement réglé peut être remboursé' }, { status: 400 });
  if (!pay.stripe_payment_intent_id) return NextResponse.json({ error: 'Référence de paiement Stripe absente' }, { status: 400 });

  // Nom de l'utilisateur (audit)
  const { data: me } = await supabaseAdmin.from('users').select('name').eq('id_auth', auth.userId).single();
  const refundedBy = (me?.name as string) || 'Staff';

  try {
    const stripe = getStripeForHotel(pay.hotel_id);
    await stripe.refunds.create({ payment_intent: pay.stripe_payment_intent_id });
    // Le webhook confirmera le statut ; on marque déjà en optimiste + audit.
    await supabaseAdmin.from('payments').update({
      status: 'refunded', refunded_at: new Date().toISOString(),
      refunded_by: refundedBy, refund_reason: reason,
    }).eq('id', paymentId);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erreur Stripe';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
