import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { addExternalPayment, type MewsExternalPaymentType } from "@/lib/mews";

// Push d'un règlement du POS Rooftop vers Mews (payments/addExternal).
// N'ENCAISSE RIEN : consigne dans Mews un paiement déjà pris au TPE/en espèces,
// sur le compte « Rooftop 2026 » des Voiles. Le transfert chambre (method
// 'chambre') n'est PAS poussé (ce serait une charge → orders/add, scope fermé).
//
// Source de vérité = la ligne rooftop_order_payments (on relit le montant et le
// moyen en base, on ne fait pas confiance au corps client). Idempotent : si la
// ligne porte déjà un mews_payment_id, on ne repousse pas.

export const dynamic = "force-dynamic";

// Compte Mews « Rooftop 2026 » (Les Voiles) — AccountId validé prod 2026-07-04.
const ROOFTOP_ACCOUNT_ID =
  process.env.MEWS_ROOFTOP_ACCOUNT_ID || "d3451171-ce99-42cc-b412-b47c00f8a967";

// Moyen POS → type de paiement externe Mews. « Amex » est un type natif Mews
// (range dans sa propre catégorie comptable). 'tpe' = legacy (= CB).
const MEWS_TYPE: Record<string, MewsExternalPaymentType> = {
  tpe: "CreditCard",
  cb: "CreditCard",
  amex: "Amex",
  espece: "Cash",
};
const MEWS_LABEL: Record<string, string> = {
  tpe: "CB", cb: "CB", amex: "Amex", espece: "Espèces",
};

export async function POST(req: NextRequest) {
  try {
    // Auth : token de session du staff (route interne).
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
    const { data: userData } = await supabaseAdmin.auth.getUser(token);
    if (!userData?.user) return NextResponse.json({ ok: false, error: "Session invalide" }, { status: 401 });

    const { paymentId } = (await req.json()) as { paymentId?: string };
    if (!paymentId) return NextResponse.json({ ok: false, error: "paymentId requis" }, { status: 400 });

    // Relire la ligne en base (montant + moyen font foi).
    const { data: pay, error } = await supabaseAdmin
      .from("rooftop_order_payments")
      .select("id, method, amount, mews_payment_id, order_id, date_service")
      .eq("id", paymentId)
      .single();
    if (error || !pay) return NextResponse.json({ ok: false, error: "Règlement introuvable" }, { status: 404 });

    // Idempotence : déjà synchronisé.
    if (pay.mews_payment_id) {
      return NextResponse.json({ ok: true, mewsPaymentId: pay.mews_payment_id, already: true });
    }

    // Le transfert chambre n'est pas un paiement encaissé → jamais poussé.
    const type = MEWS_TYPE[pay.method];
    if (!type) return NextResponse.json({ ok: true, skipped: true, reason: `method ${pay.method} non poussée` });

    const amount = Number(pay.amount);
    if (!(amount > 0)) return NextResponse.json({ ok: false, error: "Montant invalide" }, { status: 400 });

    // Push Mews. ExternalIdentifier = id de la ligne (traçabilité + anti-doublon
    // lisible côté Mews). Notes = repère humain.
    const { id } = await addExternalPayment({
      accountId: ROOFTOP_ACCOUNT_ID,
      grossValue: amount,
      type,
      externalIdentifier: pay.id,
      notes: `Rooftop POS · ${pay.date_service} · ${MEWS_LABEL[pay.method] ?? pay.method}`,
    });

    // Consigner l'Id Mews (best-effort : le paiement est déjà dans Mews même si
    // ce update échoue — on renvoie l'Id pour que le client reflète l'état).
    if (id) {
      await supabaseAdmin
        .from("rooftop_order_payments")
        .update({ mews_payment_id: id })
        .eq("id", pay.id);
    }

    return NextResponse.json({ ok: true, mewsPaymentId: id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
