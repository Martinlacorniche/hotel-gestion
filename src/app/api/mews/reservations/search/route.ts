import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { callMews } from "@/lib/mews";

// Recherche d'une réservation par NOM, pour rattacher un encaissement au bon
// client dans Mews (Les Voiles uniquement — La Corniche tourne sur HotSoft).
//
// Pourquoi ne pas utiliser `customers/search` de Mews : testé le 2026-07-23, il
// IGNORE le texte envoyé — il renvoie les mêmes 12 clients en maison quelle que
// soit la requête, même absurde. Inutilisable comme moteur de recherche.
// On liste donc les réservations d'une fenêtre glissante et on filtre nous-mêmes.
//
// ⚠️ `reservations/getAll` refuse les fenêtres > 100 jours. On prend −30 / +65 :
// assez large pour couvrir un client en maison, une arrivée prochaine et un
// départ récent (les trois cas d'un encaissement au comptoir).

export const dynamic = "force-dynamic";

const JOURS_AVANT = 30;
const JOURS_APRES = 65;

type MewsResa = {
  Id: string; CustomerId: string; State: string;
  StartUtc: string; EndUtc: string;
  AssignedResourceId?: string | null; Number?: string;
};
type MewsCustomer = { Id: string; FirstName?: string; LastName?: string; Email?: string };
type MewsResource = { Id: string; Name?: string };

// Comparaison insensible aux accents et à la casse : « bella baci » doit trouver
// « Soundous Bella Baci », et « pastuchenko » ne doit pas rater « Pastushenko ».
const norm = (s: string) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
    const { data: userData } = await supabaseAdmin.auth.getUser(token);
    if (!userData?.user) return NextResponse.json({ ok: false, error: "Session invalide" }, { status: 401 });

    const { q } = (await req.json()) as { q?: string };
    const needle = norm(q || "");
    if (needle.length < 2) return NextResponse.json({ ok: true, results: [] });

    const now = Date.now();
    const data = await callMews<{
      Reservations?: MewsResa[]; Customers?: MewsCustomer[]; Resources?: MewsResource[];
    }>("reservations/getAll", {
      StartUtc: new Date(now - JOURS_AVANT * 864e5).toISOString(),
      EndUtc: new Date(now + JOURS_APRES * 864e5).toISOString(),
      TimeFilter: "Colliding",
      // On exclut les annulations : on n'encaisse pas sur un séjour annulé.
      States: ["Confirmed", "Started", "Processed", "Optional"],
      Extent: { Reservations: true, Customers: true, Resources: true },
      Limitation: { Count: 1000 },
    });

    const clients = new Map((data.Customers ?? []).map((c) => [c.Id, c]));
    const chambres = new Map((data.Resources ?? []).map((r) => [r.Id, r.Name ?? ""]));

    const results = (data.Reservations ?? [])
      .map((r) => {
        const c = clients.get(r.CustomerId);
        const nom = `${c?.FirstName ?? ""} ${c?.LastName ?? ""}`.trim();
        return {
          reservationId: r.Id,
          customerId: r.CustomerId,          // = le compte à créditer (AccountType « Customer »)
          nom,
          email: c?.Email ?? null,
          arrivee: r.StartUtc.slice(0, 10),
          depart: r.EndUtc.slice(0, 10),
          chambre: r.AssignedResourceId ? chambres.get(r.AssignedResourceId) ?? null : null,
          etat: r.State,
          numero: r.Number ?? null,
        };
      })
      .filter((x) => x.nom && norm(x.nom).includes(needle))
      // En maison d'abord (c'est le cas courant au comptoir), puis par arrivée.
      .sort((a, b) => {
        const p = (e: string) => (e === "Started" ? 0 : e === "Confirmed" ? 1 : 2);
        return p(a.etat) - p(b.etat) || a.arrivee.localeCompare(b.arrivee);
      })
      .slice(0, 25);

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
