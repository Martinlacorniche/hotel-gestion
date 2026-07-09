import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { senderFor } from "@/lib/stripe";
import { renderFactureBuffer, type FactureLigne } from "@/app/rooftop/FacturePDF";
import {
  ventileLine, addBuckets, emptyBuckets, totauxFromBuckets, round2, type TvaType,
} from "@/lib/rooftopTva";

// Émission d'une facture réglementaire depuis une addition du POS Rooftop :
// numéro séquentiel (RPC transactionnelle), ventilation TVA, rendu PDF serveur,
// envoi mail au client (PDF en pièce jointe) + copie à l'équipe. Idempotent :
// si l'addition a déjà un numéro, on ré-émet la MÊME facture (aucun nouveau n°).

export const dynamic = "force-dynamic";

const PREFIX: Record<string, string> = {
  "ded6e6fb-ff3c-4fa8-ad07-403ee316be53": "V", // Les Voiles
  "f9d59e56-9a2f-433e-bcf4-f9753f105f32": "C", // La Corniche
};

const eur = (n: number) => n.toFixed(2).replace(".", ",") + " €";

function tvaLabel(t: TvaType): string {
  return t === "alcool" ? "10/20%" : "10%";
}

function payLabel(method: string | null, roomRef: string | null): string | null {
  if (method === "cb" || method === "tpe") return "Carte bancaire (CB)";
  if (method === "amex") return "Carte bancaire (Amex)";
  if (method === "espece") return "Espèces";
  if (method === "chambre") return `Transfert sur chambre ${roomRef ?? ""}`.trim();
  if (method === "multi") return "Paiement multiple";
  return null;
}

export async function POST(req: NextRequest) {
  try {
    // Auth : token de session du staff (route interne).
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
    const { data: userData } = await supabaseAdmin.auth.getUser(token);
    if (!userData?.user) return NextResponse.json({ ok: false, error: "Session invalide" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const orderId: string = body.orderId;
    const clientNom: string = (body.clientNom || "").trim();
    const clientEmail: string = (body.clientEmail || "").trim();
    const clientAdresse: string | null = (body.clientAdresse || "").trim() || null;
    if (!orderId) return NextResponse.json({ ok: false, error: "Addition manquante" }, { status: 400 });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail))
      return NextResponse.json({ ok: false, error: "Email client invalide" }, { status: 400 });

    // Addition + lignes + identité hôtel.
    const { data: order, error: oErr } = await supabaseAdmin
      .from("rooftop_orders")
      .select("id, hotel_id, date_service, payment_method, room_ref, numero, facturee_at")
      .eq("id", orderId).single();
    if (oErr || !order) return NextResponse.json({ ok: false, error: "Addition introuvable" }, { status: 404 });

    const { data: itemsData } = await supabaseAdmin
      .from("rooftop_order_items")
      .select("source, nom, prix, qty, tva_type")
      .eq("order_id", orderId).order("created_at");
    const items = (itemsData || []) as { source: string; nom: string; prix: number; qty: number; tva_type: TvaType | null }[];
    if (!items.length) return NextResponse.json({ ok: false, error: "Addition vide" }, { status: 400 });

    const { data: hotel } = await supabaseAdmin
      .from("hotels")
      .select("nom, raison_sociale, forme_juridique, capital, siret, tva_intra, rcs, adresse_facturation, iban, bic")
      .eq("id", order.hotel_id).single();

    // Règlements (paiements partiels/multiples) → libellé « Réglement » de la facture.
    const { data: paysData } = await supabaseAdmin
      .from("rooftop_order_payments")
      .select("method, amount, room_ref").eq("order_id", orderId).order("created_at");
    const pays = (paysData || []) as { method: string; amount: number; room_ref: string | null }[];
    const paiementLabel = pays.length
      ? pays.map(p => `${p.method === "tpe" ? "Carte" : p.method === "espece" ? "Espèces" : `Transfert chambre ${p.room_ref ?? ""}`.trim()} ${eur(Number(p.amount))}`).join(" + ")
      : payLabel(order.payment_method, order.room_ref);

    // Lignes + ventilation TVA.
    let buckets = emptyBuckets();
    const lignes: FactureLigne[] = items.map((it) => {
      const type: TvaType = it.tva_type ?? (it.source === "plat" ? "food" : "soft");
      const puTTC = Number(it.prix) || 0;
      const totalTTC = round2(puTTC * (it.qty || 1));
      buckets = addBuckets(buckets, ventileLine(totalTTC, type));
      return { designation: it.nom, qty: it.qty || 1, puTTC, tauxLabel: tvaLabel(type), totalTTC };
    });
    const ventilation = totauxFromBuckets(buckets);

    // Numéro séquentiel : réutilise l'existant, sinon en attribue un (atomique).
    const year = Number((order.date_service || "").slice(0, 4)) || new Date().getFullYear();
    let numero = order.numero as string | null;
    if (!numero) {
      const { data: num, error: nErr } = await supabaseAdmin.rpc("next_facture_num", {
        p_hotel: order.hotel_id, p_annee: year,
      });
      if (nErr || num == null) return NextResponse.json({ ok: false, error: "Numérotation impossible" }, { status: 500 });
      const prefix = PREFIX[order.hotel_id] || "F";
      numero = `${prefix}-${year}-${String(num).padStart(4, "0")}`;
    }

    // Date d'émission (jour de l'envoi, format FR).
    const dateEmission = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric",
    }).format(new Date());

    // Persiste facturation (n°, horodatage à la 1re émission, client).
    await supabaseAdmin.from("rooftop_orders").update({
      numero,
      facturee_at: order.facturee_at || new Date().toISOString(),
      client_nom: clientNom || null,
      client_email: clientEmail,
    }).eq("id", orderId);

    // Rendu PDF.
    const pdf = await renderFactureBuffer({
      hotelId: order.hotel_id,
      hotelNom: hotel?.nom || "",
      numero,
      dateEmission,
      vendeur: {
        raisonSociale: hotel?.raison_sociale ?? null,
        formeJuridique: hotel?.forme_juridique ?? null,
        capital: hotel?.capital ?? null,
        siret: hotel?.siret ?? null,
        tvaIntra: hotel?.tva_intra ?? null,
        rcs: hotel?.rcs ?? null,
        adresse: hotel?.adresse_facturation ?? null,
        iban: hotel?.iban ?? null,
        bic: hotel?.bic ?? null,
      },
      client: { nom: clientNom, email: clientEmail, adresse: clientAdresse },
      lignes,
      ventilation,
      paiement: paiementLabel,
    });

    // Envoi mail (client + copie équipe pour archivage compta).
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
    if (!resend) return NextResponse.json({ ok: false, error: "Envoi mail non configuré (RESEND_API_KEY)" }, { status: 500 });

    const teamEmail = (await supabaseAdmin.from("hotels").select("email_equipe").eq("id", order.hotel_id).single()).data?.email_equipe;
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
        <div style="background:#075985;color:#fff;padding:14px 18px;border-radius:12px 12px 0 0">
          <div style="font-size:13px;opacity:.9">${hotel?.raison_sociale || hotel?.nom || "Les Voiles"}</div>
          <div style="font-size:18px;font-weight:800">Votre facture ${numero}</div>
        </div>
        <div style="border:1px solid #e0f2fe;border-top:none;border-radius:0 0 12px 12px;padding:18px">
          <p style="margin:0 0 10px">Bonjour${clientNom ? ` ${clientNom}` : ""},</p>
          <p style="margin:0 0 12px">Vous trouverez votre facture <strong>${numero}</strong> en pièce jointe (total <strong>${eur(ventilation.totalTtc)}</strong>).</p>
          <p style="margin:0;font-size:12px;color:#94a3b8">Merci de votre visite — à très bientôt sur le Rooftop.</p>
        </div>
      </div>`;

    const { error: mailErr } = await resend.emails.send({
      from: senderFor(order.hotel_id),
      to: clientEmail,
      bcc: teamEmail ? [teamEmail] : undefined,
      subject: `Facture ${numero} — ${hotel?.nom || "Les Voiles"}`,
      html,
      attachments: [{ filename: `facture-${numero}.pdf`, content: pdf }],
    });
    if (mailErr) return NextResponse.json({ ok: false, error: mailErr.message || "Échec envoi" }, { status: 502 });

    return NextResponse.json({ ok: true, numero, total: ventilation.totalTtc });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
