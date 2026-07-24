import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { addRooftopCharges } from "@/lib/mews";
import { ventileAll, round2, type TvaType } from "@/lib/rooftopTva";

// Push des CHARGES d'une addition Rooftop vers Mews (orders/add).
//
// Complément de `mews-payment` : jusqu'ici seul le règlement partait, le folio
// « Rooftop 2026 » accumulait donc des paiements sans contrepartie et l'équipe
// ressaisissait les consommations à la main le lendemain.
//
// Source de vérité = les lignes en base (rooftop_order_items), jamais le corps
// de la requête. Idempotent : si l'addition porte déjà un mews_order_id, on ne
// repousse pas — c'est indispensable, `orderItems/cancel` étant fermé (401),
// une charge postée en double ne pourrait pas être annulée par l'API.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // Auth : token de session du staff (route interne), comme mews-payment.
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
    const { data: userData } = await supabaseAdmin.auth.getUser(token);
    if (!userData?.user) return NextResponse.json({ ok: false, error: "Session invalide" }, { status: 401 });

    const { orderId } = (await req.json()) as { orderId?: string };
    if (!orderId) return NextResponse.json({ ok: false, error: "orderId requis" }, { status: 400 });

    const { data: order, error } = await supabaseAdmin
      .from("rooftop_orders")
      .select("id, statut, date_service, numero, mews_order_id")
      .eq("id", orderId)
      .single();
    if (error || !order) return NextResponse.json({ ok: false, error: "Addition introuvable" }, { status: 404 });

    // Idempotence : déjà poussée.
    if (order.mews_order_id) {
      return NextResponse.json({ ok: true, mewsOrderId: order.mews_order_id, already: true });
    }

    // On ne pousse qu'une addition SOLDÉE : tant qu'elle est ouverte, ses lignes
    // bougent encore, et une charge postée ne peut plus être annulée.
    if (order.statut !== "encaissee") {
      return NextResponse.json({ ok: true, skipped: true, reason: "addition non soldée" });
    }

    // ⚠️ Rien d'antérieur à la mise en service (2026-07-23). Ces additions-là ont
    // été RESSAISIES À LA MAIN dans le PMS par l'équipe : les pousser créerait un
    // doublon en face de leur saisie, daté d'aujourd'hui de surcroît (Mews ignore
    // la date de consommation). `orderItems/cancel` étant fermé, ce doublon ne se
    // retirerait plus qu'à la main dans Mews. Le garde vit ICI et pas seulement
    // dans l'écran : c'est une bêtise irréversible, elle ne doit pas dépendre du
    // bouton par lequel on arrive.
    if (order.date_service < "2026-07-23") {
      return NextResponse.json({ ok: true, skipped: true, reason: "service antérieur au push automatique — déjà saisi à la main" });
    }

    // ⚠️ Un transfert chambre n'est PAS poussé côté règlement (décision Martin :
    // risque d'impayé). Poser la charge sur le compte Rooftop sans le paiement en
    // face déséquilibrerait le folio → on saute l'addition entière.
    const { data: pays } = await supabaseAdmin
      .from("rooftop_order_payments").select("method").eq("order_id", order.id);
    if ((pays ?? []).some((p) => p.method === "chambre")) {
      return NextResponse.json({ ok: true, skipped: true, reason: "transfert chambre — non poussé" });
    }

    const { data: items } = await supabaseAdmin
      .from("rooftop_order_items").select("prix, qty, tva_type").eq("order_id", order.id);
    if (!items?.length) return NextResponse.json({ ok: true, skipped: true, reason: "addition vide" });

    // Ventilation par taux, puis retour au TTC : Mews attend du brut (gross pricing).
    const b = ventileAll(items.map((it) => ({
      ttc: Number(it.prix) * Number(it.qty || 1),
      type: (it.tva_type || "soft") as TvaType,
    })));
    const ttc10 = round2(b.ht10 + b.tva10);
    const ttc20 = round2(b.ht20 + b.tva20);

    const { id, lines } = await addRooftopCharges({
      ttc10, ttc20,
      externalPrefix: `POS-${order.date_service}-${order.numero ?? order.id.slice(0, 8)}`,
    });

    // Consigner l'Id Mews (best-effort : la charge est déjà dans Mews même si ce
    // update échoue — mais alors l'idempotence ne tient plus, d'où le log).
    if (id) {
      const { error: upErr } = await supabaseAdmin
        .from("rooftop_orders").update({ mews_order_id: id }).eq("id", order.id);
      if (upErr) console.error("mews-charges: mews_order_id non consigné", order.id, upErr.message);
    }

    return NextResponse.json({ ok: true, mewsOrderId: id, lines, ttc10, ttc20 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
