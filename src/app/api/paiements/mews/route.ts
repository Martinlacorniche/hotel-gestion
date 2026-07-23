import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { pushPaymentToMews } from "@/lib/mews";
import { HOTEL_MAIL_CONFIG } from "@/lib/mailAssistant";

// Transmet un encaissement Stripe au folio du client dans Mews (Les Voiles).
//
// Remplace un geste manuel : jusqu'ici la réception encaissait, puis recopiait le
// règlement dans le PMS et cochait « PMS fait » sur la page /encaissement.
//
// `payments/addExternal` N'ENCAISSE RIEN — l'argent est déjà pris par Stripe. On
// consigne dans Mews un règlement fait ailleurs, pour que le folio soit soldé.
//
// Garde-fous : paiement RÉGLÉ uniquement · Voiles uniquement (La Corniche est sur
// HotSoft) · jamais deux fois (un doublon sur un folio se solde par un
// remboursement à tort) · le montant vient de la BASE, jamais du corps de requête.

export const dynamic = "force-dynamic";

const VOILES_ID = HOTEL_MAIL_CONFIG.find((h) => h.key === "voiles")!.hotelId;

export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
    const { data: userData } = await supabaseAdmin.auth.getUser(token);
    if (!userData?.user) return NextResponse.json({ ok: false, error: "Session invalide" }, { status: 401 });

    const { paymentId, customerId, reservationId } =
      (await req.json()) as { paymentId?: string; customerId?: string; reservationId?: string };
    if (!paymentId || !customerId) {
      return NextResponse.json({ ok: false, error: "paymentId et customerId requis" }, { status: 400 });
    }

    const { data: p, error } = await supabaseAdmin
      .from("payments")
      .select("id, hotel_id, amount, currency, status, method, client_nom, description, stripe_payment_intent_id, mews_payment_id")
      .eq("id", paymentId)
      .single();
    if (error || !p) return NextResponse.json({ ok: false, error: "Encaissement introuvable" }, { status: 404 });

    if (p.mews_payment_id) {
      return NextResponse.json({ ok: true, mewsPaymentId: p.mews_payment_id, already: true });
    }
    if (p.hotel_id !== VOILES_ID) {
      return NextResponse.json({ ok: false, error: "Mews n'existe qu'aux Voiles (La Corniche est sur HotSoft)" }, { status: 400 });
    }
    if (p.status !== "paid") {
      return NextResponse.json({ ok: false, error: "L'encaissement n'est pas réglé" }, { status: 400 });
    }
    const amount = Number(p.amount);
    if (!(amount > 0)) return NextResponse.json({ ok: false, error: "Montant invalide" }, { status: 400 });

    // Le compte est choisi ici (rattrapage), puis on délègue à la fonction
    // centrale — même chemin que le push automatique du webhook.
    await supabaseAdmin.from("payments").update({
      mews_customer_id: customerId, mews_reservation_id: reservationId ?? null,
    }).eq("id", p.id);
    const { id, skipped } = await pushPaymentToMews(p.id);
    if (skipped) return NextResponse.json({ ok: false, error: `Non transmis : ${skipped}` }, { status: 400 });

    return NextResponse.json({ ok: true, mewsPaymentId: id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
