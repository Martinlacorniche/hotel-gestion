import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { pushGroupeResaToMews } from "@/lib/mewsGroupResaPush";

// Pose dans Mews la réservation d'un invité de groupe (Les Voiles).
// Appelée par le webhook Stripe à la confirmation, et disponible en rattrapage
// depuis le back-office pour les réservations déjà confirmées.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
    const { data: userData } = await supabaseAdmin.auth.getUser(token);
    if (!userData?.user) return NextResponse.json({ ok: false, error: "Session invalide" }, { status: 401 });

    const { reservationId } = (await req.json()) as { reservationId?: string };
    if (!reservationId) return NextResponse.json({ ok: false, error: "reservationId requis" }, { status: 400 });

    const out = await pushGroupeResaToMews(reservationId);
    if (out.skipped) return NextResponse.json({ ok: false, error: out.skipped }, { status: 400 });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
