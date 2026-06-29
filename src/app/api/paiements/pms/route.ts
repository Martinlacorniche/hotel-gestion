import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePaymentAccess } from '@/lib/apiAuth';

// POST /api/paiements/pms — bascule « saisi dans le PMS » sur un paiement.
// Accès : admin/superadmin, ou rôle « user » pendant son shift.
// Body: { paymentId, done }
export async function POST(req: Request) {
  const auth = await requirePaymentAccess(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }
  const paymentId = String(body.paymentId || '');
  if (!paymentId) return NextResponse.json({ error: 'paymentId manquant' }, { status: 400 });

  const { error } = await supabaseAdmin.from('payments').update({ pms_done: !!body.done }).eq('id', paymentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
