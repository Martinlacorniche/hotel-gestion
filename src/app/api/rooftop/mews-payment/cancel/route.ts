import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cancelPayment } from "@/lib/mews";

// Annule dans Mews un règlement du POS Rooftop déjà poussé (correction d'erreur).
// Appelé quand on retire une ligne de règlement synchronisée : on passe le
// paiement Mews à 'Canceled'. Idempotent côté « rien à faire » : si la ligne n'a
// pas de mews_payment_id, on renvoie ok sans rien toucher.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
    const { data: userData } = await supabaseAdmin.auth.getUser(token);
    if (!userData?.user) return NextResponse.json({ ok: false, error: "Session invalide" }, { status: 401 });

    const { paymentId } = (await req.json()) as { paymentId?: string };
    if (!paymentId) return NextResponse.json({ ok: false, error: "paymentId requis" }, { status: 400 });

    const { data: pay, error } = await supabaseAdmin
      .from("rooftop_order_payments")
      .select("id, mews_payment_id")
      .eq("id", paymentId)
      .single();
    if (error || !pay) return NextResponse.json({ ok: false, error: "Règlement introuvable" }, { status: 404 });

    // Rien à annuler côté Mews.
    if (!pay.mews_payment_id) return NextResponse.json({ ok: true, canceled: false });

    // Annulation Mews. Si elle échoue (note clôturée côté PMS p.ex.), on remonte
    // l'erreur : le client NE supprimera PAS la ligne locale → pas de désync.
    await cancelPayment(pay.mews_payment_id);

    // Trace : on vide l'Id Mews (la ligne va être supprimée par le client, mais si
    // la suppression échoue on ne re-tentera pas une annulation déjà faite).
    await supabaseAdmin
      .from("rooftop_order_payments")
      .update({ mews_payment_id: null })
      .eq("id", pay.id);

    return NextResponse.json({ ok: true, canceled: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
