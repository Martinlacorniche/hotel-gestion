import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCaissePrefill } from "@/lib/mews";

// Pré-remplit les cases PMS de la caisse (Voiles) depuis les encaissements Mews
// du jour, ventilés par ligne (TPE CB / Amex / Espèces / ANCV / Virement) et par
// shift (matin 6h-14h, soir sinon). LECTURE SEULE. Idempotent : le staff peut
// cliquer plusieurs fois par jour, on renvoie l'état Mews à l'instant T.

export const dynamic = "force-dynamic";

// Voiles = seul établissement sous Mews (La Corniche n'y est pas).
const VOILES_ID = "ded6e6fb-ff3c-4fa8-ad07-403ee316be53";

export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
    const { data: userData } = await supabaseAdmin.auth.getUser(token);
    if (!userData?.user) return NextResponse.json({ ok: false, error: "Session invalide" }, { status: 401 });

    const { hotelId, date } = (await req.json()) as { hotelId?: string; date?: string };
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ ok: false, error: "Date invalide" }, { status: 400 });
    }
    if (hotelId !== VOILES_ID) {
      return NextResponse.json({ ok: false, error: "Pré-remplissage Mews disponible pour Les Voiles uniquement." }, { status: 400 });
    }

    const prefill = await getCaissePrefill(date);
    return NextResponse.json({ ok: true, prefill });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
