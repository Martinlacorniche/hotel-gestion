import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  createBlock, setBlockRooms, setBlockPrices, deleteBlock,
  chambresVendables, categorieParNumero,
} from "@/lib/mewsBlocks";

// Crée (ou retire) l'allotement Mews d'un groupe — Les Voiles uniquement.
//
// POST   { groupeId }  → pose le bloc, ses chambres et ses prix
// DELETE { groupeId }  → retire le bloc, les chambres retournent à la vente
//
// ⚠️ La Corniche tourne sur HotSoft : seules les chambres Voiles du groupe sont
// alloties. Un mariage à cheval sur les deux hôtels ne verra donc que sa part
// Voiles bloquée ici — l'autre reste à traiter dans HotSoft.
//
// Vérification PAR L'EFFET : on relit la disponibilité avant et après. L'API ne
// sait pas relister les blocs (`availabilityBlocks/getAll` renvoie 0), donc c'est
// la seule preuve que le bloc travaille — et c'est la plus parlante.

export const dynamic = "force-dynamic";

const VOILES = "ded6e6fb-ff3c-4fa8-ad07-403ee316be53";

// Veille du départ : un séjour 25→27 occupe les nuits du 25 et du 26.
const derniereNuit = (depart: string) =>
  new Date(new Date(`${depart}T12:00:00Z`).getTime() - 864e5).toISOString().slice(0, 10);

async function auth(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  return data?.user ?? null;
}

export async function POST(req: NextRequest) {
  try {
    if (!(await auth(req))) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
    const { groupeId } = (await req.json()) as { groupeId?: string };
    if (!groupeId) return NextResponse.json({ ok: false, error: "groupeId requis" }, { status: 400 });

    const { data: g } = await supabaseAdmin
      .from("groupes")
      .select("id, nom, date_arrivee, date_depart, date_limite, mews_block_id")
      .eq("id", groupeId).single();
    if (!g) return NextResponse.json({ ok: false, error: "Groupe introuvable" }, { status: 404 });
    if (g.mews_block_id) {
      return NextResponse.json({ ok: false, error: "Ce groupe a déjà un allotement dans Mews" }, { status: 400 });
    }

    // Les chambres du bloc, côté Voiles seulement, avec leur tarif.
    const { data: gc } = await supabaseAdmin
      .from("groupe_chambres")
      .select("chambre_id, tarif_nuit, hotel_id")
      .eq("groupe_id", g.id).eq("hotel_id", VOILES);
    if (!gc?.length) {
      return NextResponse.json({ ok: false, error: "Aucune chambre des Voiles dans ce groupe" }, { status: 400 });
    }
    // ⚠️ `groupe_chambres.chambre_id` pointe sur `room_units`, PAS sur `chambres`.
    // Le module Groupes a son propre inventaire (room_units / room_types) ; la table
    // `chambres` sert aux serrures et aux consignes. Confondre les deux renvoie zéro
    // correspondance et crée un allotement VIDE, qui ne retient rien (vécu au test).
    // Bonne nouvelle : `room_units` colle à Mews numéro pour numéro ET catégorie
    // pour catégorie (Confort 11·16·21·25·34, Vue Mer 12·22·31·32·33·35·36,
    // Single 14·15·23·24).
    const { data: chambres } = await supabaseAdmin
      .from("room_units").select("id, numero").in("id", gc.map((c) => c.chambre_id));
    const numeroDe = new Map((chambres ?? []).map((c) => [c.id, String(c.numero)]));

    // Une seule table de correspondance numéro → catégorie, traversée deux fois :
    // pour compter les chambres, et pour retenir leur prix.
    const catParNumero = await categorieParNumero();
    const parCat = new Map<string, number>();
    // Prix par catégorie : on retient le tarif le PLUS ÉLEVÉ du bloc pour cette
    // catégorie. Côté PMS le tarif est porté par la catégorie, pas par la chambre :
    // deux Confort à deux prix différents ne peuvent pas coexister. Prendre le plus
    // haut évite de brader ; l'écart éventuel se règle à la facturation.
    const prixParCat = new Map<string, number>();
    let ignorees = 0;
    for (const c of gc) {
      const num = numeroDe.get(c.chambre_id);
      const cat = num ? catParNumero.get(num.trim()) : undefined;
      if (!cat) { ignorees++; continue; }   // « Cuisine », « Bureau » : pas vendables
      parCat.set(cat, (parCat.get(cat) ?? 0) + 1);
      prixParCat.set(cat, Math.max(prixParCat.get(cat) ?? 0, Number(c.tarif_nuit) || 0));
    }
    if (!parCat.size) {
      return NextResponse.json({ ok: false, error: "Aucune correspondance de chambre dans Mews" }, { status: 400 });
    }

    const nuit1 = g.date_arrivee as string;
    const nuitN = derniereNuit(g.date_depart as string);
    const avant = await chambresVendables(nuit1);

    const { blockId, rateId } = await createBlock({
      nom: g.nom as string, arrivee: nuit1, depart: g.date_depart as string,
      dateLimite: (g.date_limite as string | null) ?? null,
    });

    // On consigne AVANT de poursuivre : si la suite échoue, le bloc reste
    // joignable. Sans cet identifiant il serait définitivement hors de portée.
    await supabaseAdmin.from("groupes")
      .update({ mews_block_id: blockId, mews_rate_id: rateId }).eq("id", g.id);

    await setBlockRooms(blockId, nuit1, nuitN,
      [...parCat].map(([categoryId, chambres]) => ({ categoryId, chambres })));
    if (rateId) {
      await setBlockPrices(rateId, nuit1, nuitN,
        [...prixParCat].map(([categoryId, prix]) => ({ categoryId, prix })));
    }
    await supabaseAdmin.from("groupes")
      .update({ mews_sync_at: new Date().toISOString() }).eq("id", g.id);

    const apres = await chambresVendables(nuit1);
    return NextResponse.json({
      ok: true, blockId, rateId,
      chambres: [...parCat.values()].reduce((a, b) => a + b, 0), ignorees,
      categories: [...parCat].map(([id, n]) => ({ categoryId: id, chambres: n })),
      // La preuve que le bloc travaille : la disponibilité a reculé d'autant.
      vendablesAvant: avant, vendablesApres: apres, retirees: avant - apres,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await auth(req))) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
    const { groupeId } = (await req.json()) as { groupeId?: string };
    const { data: g } = await supabaseAdmin
      .from("groupes").select("id, date_arrivee, mews_block_id").eq("id", groupeId!).single();
    if (!g?.mews_block_id) return NextResponse.json({ ok: false, error: "Aucun allotement à retirer" }, { status: 400 });

    await deleteBlock(g.mews_block_id as string);
    await supabaseAdmin.from("groupes")
      .update({ mews_block_id: null, mews_rate_id: null, mews_sync_at: null }).eq("id", g.id);
    const apres = await chambresVendables(g.date_arrivee as string);
    return NextResponse.json({ ok: true, vendablesApres: apres });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}

// PUT = RESYNCHRONISER un allotement existant. Indispensable dès qu'on retire ou
// ajoute des chambres au bloc côté outil : sans ça le PMS garde l'ancienne
// quantité et deux vérités divergent en silence — l'inventaire retenu dans Mews
// ne correspond plus à ce que la page invité propose.
//
// C'est possible sans rien recréer parce que `services/updateAvailability` prend
// une valeur ABSOLUE et non un delta : réenvoyer l'état voulu suffit, l'opération
// est donc rejouable autant de fois qu'on veut.
export async function PUT(req: NextRequest) {
  try {
    if (!(await auth(req))) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
    const { groupeId } = (await req.json()) as { groupeId?: string };
    const { data: g } = await supabaseAdmin
      .from("groupes")
      .select("id, date_arrivee, date_depart, mews_block_id, mews_rate_id")
      .eq("id", groupeId!).single();
    if (!g?.mews_block_id) return NextResponse.json({ ok: false, error: "Ce groupe n'a pas d'allotement" }, { status: 400 });

    const { data: gc } = await supabaseAdmin
      .from("groupe_chambres").select("chambre_id, tarif_nuit").eq("groupe_id", g.id).eq("hotel_id", VOILES);
    const { data: ru } = await supabaseAdmin
      .from("room_units").select("id, numero").in("id", (gc ?? []).map((c) => c.chambre_id));
    const numeroDe = new Map((ru ?? []).map((c) => [c.id, String(c.numero)]));
    const catParNumero = await categorieParNumero();

    const parCat = new Map<string, number>();
    const prixParCat = new Map<string, number>();
    for (const c of gc ?? []) {
      const cat = catParNumero.get(String(numeroDe.get(c.chambre_id) ?? "").trim());
      if (!cat) continue;
      parCat.set(cat, (parCat.get(cat) ?? 0) + 1);
      prixParCat.set(cat, Math.max(prixParCat.get(cat) ?? 0, Number(c.tarif_nuit) || 0));
    }

    const nuit1 = g.date_arrivee as string;
    const nuitN = derniereNuit(g.date_depart as string);
    const avant = await chambresVendables(nuit1);

    // ⚠️ Les catégories RETIRÉES du bloc doivent être remises à zéro explicitement.
    // Se contenter d'envoyer les catégories restantes laisserait l'ancienne
    // quantité en place pour celles qui ont disparu — des chambres retenues pour
    // un groupe qui n'en veut plus, invendables et invisibles.
    const toutes = new Set([...parCat.keys(), ...catParNumero.values()]);
    await setBlockRooms(g.mews_block_id as string, nuit1, nuitN,
      [...toutes].map((categoryId) => ({ categoryId, chambres: parCat.get(categoryId) ?? 0 })));
    if (g.mews_rate_id) {
      await setBlockPrices(g.mews_rate_id as string, nuit1, nuitN,
        [...prixParCat].map(([categoryId, prix]) => ({ categoryId, prix })));
    }
    await supabaseAdmin.from("groupes").update({ mews_sync_at: new Date().toISOString() }).eq("id", g.id);

    const apres = await chambresVendables(nuit1);
    return NextResponse.json({
      ok: true, chambres: [...parCat.values()].reduce((a, b) => a + b, 0),
      vendablesAvant: avant, vendablesApres: apres,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
