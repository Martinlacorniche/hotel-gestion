"use client";

// POS Rooftop (Les Voiles) — COQUILLE. À partir des réservations du jour :
// ouvrir une table → prise de commande sur la carte (plats + boissons) →
// encaissement TPE externe / espèce / transfert chambre. Aucun débit réel
// (pas de Stripe) ni push Mews : on enregistre la commande + la méthode.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { confirmDialog } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { VOILES_ID } from "@/components/rooftop/RooftopEditors";
import { ArrowLeft, Plus, Minus, CreditCard, Banknote, BedDouble, Users, Utensils, Lock, Trash2, FileText, Mail, ClipboardList, X, ChevronLeft, ChevronRight } from "lucide-react";
import { tvaTypeForCategorie, ventileAll, totauxFromBuckets, round2, type TvaType, type TvaTotaux } from "@/lib/rooftopTva";
import toast from "react-hot-toast";

// ── Types ────────────────────────────────────────────────────────────────────
type MenuItem = { source: "plat" | "boisson"; ref_id: string | null; nom: string; prix: number; tvaType: TvaType };
type MenuGroup = { key: string; label: string; items: MenuItem[] };
type OrderRow = { id: string; source: string; ref_id: string | null; nom: string; prix: number; qty: number; tva_type: TvaType | null };
type Order = {
  id: string; table_id: string | null; reservation_id: string | null;
  couvert_nom: string | null; statut: string; total: number;
  payment_method: string | null; room_ref: string | null;
  numero: string | null; client_nom: string | null; client_email: string | null;
};
const ORDER_COLS = "id,table_id,reservation_id,couvert_nom,statut,total,payment_method,room_ref,numero,client_nom,client_email";
type ResaLite = { id: string; nom: string; couverts: number; heure: string; table_id: string | null; presence: string | null };
type Payment = { id: string; method: string; amount: number; room_ref: string | null };
type Cloture = {
  nbAdditions: number;
  totalTtc: number;
  parPaiement: { tpe: number; espece: number; chambre: number };
  parType: { soft: number; food: number; alcool: number };
  tva: TvaTotaux;
};

// Prix texte libre ("12", "8 €", "12,50") → nombre.
function toNum(s: string | null | undefined): number {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(",", ".").replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}
const euro = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function PosTab({ hotelId }: { hotelId: string }) {
  const today = useMemo(todayStr, []);
  const [date, setDate] = useState(today);
  const barSlug = hotelId === VOILES_ID ? "rooftop" : "bar";

  const [menu, setMenu] = useState<MenuGroup[]>([]);
  const [tables, setTables] = useState<Record<string, string>>({}); // id → nom
  const [tableList, setTableList] = useState<{ id: string; nom: string }[]>([]); // ordonné, pour le sélecteur
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [resas, setResas] = useState<ResaLite[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  // Commande en cours
  const [active, setActive] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderRow[]>([]);
  const [payMethod, setPayMethod] = useState<"tpe" | "espece" | "chambre" | null>(null);
  const [roomRef, setRoomRef] = useState("");
  const [payAmount, setPayAmount] = useState(""); // vide = solder le reste
  const [payments, setPayments] = useState<Payment[]>([]);
  const [busy, setBusy] = useState(false);

  // Facture (édition + envoi mail)
  const [clientNom, setClientNom] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [invoicing, setInvoicing] = useState(false);

  // Clôture de service (récap à reporter dans Mews)
  const [showCloture, setShowCloture] = useState(false);
  const [clotureLoading, setClotureLoading] = useState(false);
  const [cloture, setCloture] = useState<Cloture | null>(null);

  // ── Chargement de la carte (une fois) ──────────────────────────────────────
  useEffect(() => {
    Promise.all([
      supabase.from("wifi_bar").select("id,categorie,nom,ordre,actif").eq("hotel_id", hotelId).eq("actif", true).order("ordre"),
      supabase.from("wifi_tiles").select("config").eq("slug", barSlug).eq("hotel_id", hotelId).maybeSingle(),
    ]).then(([{ data: bar }, { data: tile }]) => {
      const groups: MenuGroup[] = [];
      // Offre « Eat & Drink » : la nourriture n'est PAS facturée séparément — elle
      // est incluse dans le prix de la formule (par catégorie de boisson). Le POS
      // ne propose donc que les catégories de boisson ; chaque tuile = une formule
      // « Eat & Drink · <cat> » au prix de la catégorie.
      const cfg = (tile?.config ?? {}) as {
        categories_prix?: Record<string, string>; categories_ordre?: string[];
        categories_masquees?: string[]; categories_tva?: Record<string, string>;
      };
      const catPrix = cfg.categories_prix ?? {};
      const catTva = cfg.categories_tva ?? {};
      const masquees = new Set(cfg.categories_masquees ?? []);
      const barItems = (bar as { id: string; categorie: string; nom: string }[]) || [];
      const cats = [...new Set([...(cfg.categories_ordre ?? []), ...barItems.map(b => b.categorie)])];
      const boissons: MenuItem[] = [];
      for (const cat of cats) {
        if (masquees.has(cat)) continue;
        if (!barItems.some(b => b.categorie === cat)) continue;
        boissons.push({
          source: "boisson",
          ref_id: null,
          nom: `Eat & Drink · ${cat}`,
          prix: toNum(catPrix[cat]),
          tvaType: tvaTypeForCategorie(cat, catTva),
        });
      }
      if (boissons.length) groups.push({ key: "boissons", label: "🥂 Boissons", items: boissons });
      setMenu(groups);
    });
  }, [hotelId, barSlug]);

  // ── Chargement des résas + tables + additions du jour ───────────────────────
  const reload = useCallback(() => {
    setLoading(true);
    setActive(null); setItems([]); setPayMethod(null);
    Promise.all([
      supabase.from("rooftop_tables").select("id,nom").eq("hotel_id", hotelId).eq("actif", true).order("ordre"),
      supabase.from("rooftop_reservations").select("id,nom,couverts,heure,table_id,presence,statut")
        .eq("hotel_id", hotelId).eq("date_resa", date).neq("statut", "annulee").order("heure"),
      supabase.from("rooftop_orders").select(ORDER_COLS)
        .eq("hotel_id", hotelId).eq("date_service", date).order("created_at"),
    ]).then(([{ data: tData }, { data: rData }, { data: oData }]) => {
      const tmap: Record<string, string> = {};
      const tlist = (tData as { id: string; nom: string }[]) || [];
      tlist.forEach(t => { tmap[t.id] = t.nom; });
      setTables(tmap);
      setTableList(tlist);
      setResas(((rData as ResaLite[]) || []).filter(r => r.presence !== "no_show"));
      setOrders((oData as Order[]) || []);
      setLoading(false);
    });
  }, [hotelId, date]);

  useEffect(() => { reload(); }, [reload]);

  const total = items.reduce((s, i) => s + i.prix * i.qty, 0);

  // ── Ouvrir / reprendre une addition ─────────────────────────────────────────
  const createOrder = async (fields: { table_id: string | null; reservation_id: string | null; couvert_nom: string | null }) => {
    setBusy(true);
    const { data, error } = await supabase.from("rooftop_orders").insert({
      hotel_id: hotelId, date_service: date, ...fields,
    }).select(ORDER_COLS).single();
    setBusy(false);
    if (error) { toast.error(error.message || "Erreur"); return; }
    setOrders(prev => [...prev, data as Order]);
    setActive(data as Order); setItems([]); setPayMethod(null); setPayments([]); setPayAmount("");
    setClientNom(fields.couvert_nom ?? ""); setClientEmail("");
  };

  // Depuis une réservation, ou vente au comptoir (resa = null).
  const openOrder = (resa: ResaLite | null) =>
    createOrder({ table_id: resa?.table_id ?? null, reservation_id: resa?.id ?? null, couvert_nom: resa?.nom ?? null });

  // Ouvrir une table choisie dans le sélecteur (walk-in, ou 2e addition d'une table).
  const openOrderForTable = (t: { id: string; nom: string }) => {
    setShowTablePicker(false);
    createOrder({ table_id: t.id, reservation_id: null, couvert_nom: null });
  };

  // Navigation jour par jour (flèches, plus rapide que le date-picker sur tablette).
  const shiftDate = (delta: number) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + delta);
    setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  };

  const reopenOrder = async (order: Order) => {
    setBusy(true);
    const [{ data }, { data: pays }] = await Promise.all([
      supabase.from("rooftop_order_items").select("id,source,ref_id,nom,prix,qty,tva_type").eq("order_id", order.id).order("created_at"),
      supabase.from("rooftop_order_payments").select("id,method,amount,room_ref").eq("order_id", order.id).order("created_at"),
    ]);
    setBusy(false);
    setItems(((data as OrderRow[]) || []).map(r => ({ ...r, prix: Number(r.prix) })));
    setPayments(((pays as Payment[]) || []).map(p => ({ ...p, amount: Number(p.amount) })));
    setActive(order); setPayMethod(null); setPayAmount("");
    setClientNom(order.client_nom ?? order.couvert_nom ?? ""); setClientEmail(order.client_email ?? "");
  };

  // ── Lignes de commande (persistées à chaque geste) ──────────────────────────
  const addLine = async (mi: MenuItem) => {
    if (!active || active.statut === "encaissee") return;
    // Fusionne avec une ligne identique NON modifiée (même nom + même prix), sinon
    // une ligne dont le montant a été ajusté resterait distincte.
    const existing = items.find(i => i.source === mi.source && i.nom === mi.nom && i.prix === mi.prix);
    if (existing) { await changeQty(existing, 1); return; }
    const { data, error } = await supabase.from("rooftop_order_items").insert({
      order_id: active.id, source: mi.source, ref_id: mi.ref_id, nom: mi.nom, prix: mi.prix, qty: 1, tva_type: mi.tvaType,
    }).select("id,source,ref_id,nom,prix,qty,tva_type").single();
    if (error) { toast.error("Erreur"); return; }
    setItems(prev => [...prev, { ...(data as OrderRow), prix: Number((data as OrderRow).prix) }]);
  };

  // Ajuste le montant unitaire d'une ligne (montant modifiable au service).
  const editPrice = async (row: OrderRow, value: string) => {
    if (!active || active.statut === "encaissee") return;
    const prix = toNum(value);
    if (prix === row.prix) return;
    setItems(prev => prev.map(i => i.id === row.id ? { ...i, prix } : i));
    const { error } = await supabase.from("rooftop_order_items").update({ prix }).eq("id", row.id);
    if (error) toast.error("Erreur montant");
  };

  const changeQty = async (row: OrderRow, delta: number) => {
    if (!active || active.statut === "encaissee") return;
    const qty = row.qty + delta;
    if (qty <= 0) {
      // Suppression d'une ligne déjà à l'addition → alerte.
      if (!(await confirmDialog(`Retirer « ${row.nom} » de l'addition ?`))) return;
      setItems(prev => prev.filter(i => i.id !== row.id));
      await supabase.from("rooftop_order_items").delete().eq("id", row.id);
      return;
    }
    setItems(prev => prev.map(i => i.id === row.id ? { ...i, qty } : i));
    await supabase.from("rooftop_order_items").update({ qty }).eq("id", row.id);
  };

  // ── Encaissement partiel / multi (coquille : on enregistre les règlements) ────
  // total, déjà réglé, reste à payer.
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = round2(total - paid);

  const addPayment = async () => {
    if (!active) return;
    if (!payMethod) { toast.error("Choisir un mode de paiement"); return; }
    if (payMethod === "chambre" && !roomRef.trim()) { toast.error("N° de chambre requis pour le transfert"); return; }
    // Montant : ce qui est saisi, sinon le reste à payer.
    const amt = round2(payAmount.trim() ? toNum(payAmount) : remaining);
    if (amt <= 0) { toast.error("Montant invalide"); return; }
    setBusy(true);
    const { data, error } = await supabase.from("rooftop_order_payments").insert({
      order_id: active.id, hotel_id: hotelId, date_service: date,
      method: payMethod, amount: amt, room_ref: payMethod === "chambre" ? roomRef.trim() : null,
    }).select("id,method,amount,room_ref").single();
    if (error) { setBusy(false); toast.error(error.message || "Erreur"); return; }
    const next = [...payments, { ...(data as Payment), amount: Number((data as Payment).amount) }];
    setPayments(next);
    setPayAmount(""); setPayMethod(null); setRoomRef("");
    const newPaid = next.reduce((s, p) => s + p.amount, 0);

    if (newPaid + 0.005 >= total) {
      // Addition soldée → verrouillée.
      const { error: e2 } = await supabase.from("rooftop_orders").update({
        statut: "encaissee", total, closed_at: new Date().toISOString(),
        payment_method: next.length > 1 ? "multi" : next[0].method,
        room_ref: next.find(p => p.method === "chambre")?.room_ref ?? null,
      }).eq("id", active.id);
      setBusy(false);
      if (e2) { toast.error(e2.message || "Erreur"); return; }
      setOrders(prev => prev.map(o => o.id === active.id ? { ...o, statut: "encaissee", total } : o));
      toast.success("Addition soldée ✓");
      closeActive();
    } else {
      setBusy(false);
      toast.success(`Réglé ${euro(amt)} · reste ${euro(round2(total - newPaid))}`);
    }
  };

  // Retirer un règlement saisi par erreur (tant que l'addition n'est pas verrouillée).
  const removePayment = async (p: Payment) => {
    if (!active || active.statut === "encaissee") return;
    setPayments(prev => prev.filter(x => x.id !== p.id));
    await supabase.from("rooftop_order_payments").delete().eq("id", p.id);
  };

  // Annuler/supprimer une addition ouverte. Si elle contient des lignes → alerte.
  const cancelOrder = async () => {
    if (!active || active.statut === "encaissee") return;
    if (items.length > 0 && !(await confirmDialog(
      `Cette addition contient ${items.length} article${items.length > 1 ? "s" : ""}. Supprimer l'addition ?`))) return;
    setBusy(true);
    const { error } = await supabase.from("rooftop_orders").delete().eq("id", active.id);
    setBusy(false);
    if (error) { toast.error(error.message || "Erreur"); return; }
    setOrders(prev => prev.filter(o => o.id !== active.id));
    toast.success("Addition supprimée");
    closeActive();
  };

  const closeActive = () => {
    setActive(null); setItems([]); setPayMethod(null); setRoomRef("");
    setClientNom(""); setClientEmail("");
  };

  // Fermer une addition OUVERTE directement depuis la liste du service (✕ sur la carte).
  const cancelOrderById = async (order: Order, e: React.MouseEvent) => {
    e.stopPropagation();
    if (order.statut === "encaissee") return;
    if (!(await confirmDialog("Fermer cette table ? L'addition ouverte (et ses lignes) sera supprimée."))) return;
    const { error } = await supabase.from("rooftop_orders").delete().eq("id", order.id);
    if (error) { toast.error(error.message || "Erreur"); return; }
    setOrders(prev => prev.filter(o => o.id !== order.id));
    toast.success("Table fermée");
  };

  // ── Facture : édition + envoi mail (PDF réglementaire côté serveur) ──────────
  const sendFacture = async () => {
    if (!active || items.length === 0) return;
    if (!clientEmail.trim()) { toast.error("Email du client requis"); return; }
    setInvoicing(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) { toast.error("Session expirée"); return; }
      const res = await fetch("/api/rooftop/facture", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderId: active.id, clientNom, clientEmail }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { toast.error(json.error || "Échec facture"); return; }
      toast.success(`Facture ${json.numero} envoyée ✓`);
      setActive(prev => prev ? { ...prev, numero: json.numero, client_nom: clientNom, client_email: clientEmail } : prev);
      setOrders(prev => prev.map(o => o.id === active.id ? { ...o, numero: json.numero, client_nom: clientNom, client_email: clientEmail } : o));
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setInvoicing(false);
    }
  };

  const factureBlock = () => (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 max-w-md">
      <div className="flex items-center gap-2">
        <FileText size={15} className="text-[#004e7c]" />
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Facture</span>
        {active?.numero && (
          <span className="ml-auto text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
            {active.numero} émise
          </span>
        )}
      </div>
      <Input value={clientNom} onChange={e => setClientNom(e.target.value)} placeholder="Nom du client" className="h-11 text-sm" />
      <Input value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="Email du client" type="email" className="h-11 text-sm" />
      <Button onClick={sendFacture} disabled={invoicing || items.length === 0 || !clientEmail.trim()}
        className="w-full h-11 bg-[#004e7c] hover:bg-[#003d61] text-white gap-2 active:scale-[0.98]">
        <Mail size={15} /> {active?.numero ? "Renvoyer la facture" : "Éditer & envoyer la facture"}
      </Button>
      <p className="text-[10px] text-slate-400 text-center">
        TVA ventilée automatiquement (soft/food 10%, alcool 10/20%). PDF réglementaire joint au mail.
      </p>
    </div>
  );

  // ── Clôture de service : ferme TOUTES les tables + récap du jour ─────────────
  const openCloture = async () => {
    // Clôturer = board à 0 : toutes les additions ouvertes sont fermées.
    // Confirmation si certaines portent des consommations non encaissées.
    const openIds = orders.filter(o => o.statut !== "encaissee").map(o => o.id);
    if (openIds.length) {
      const { data: withItems } = await supabase.from("rooftop_order_items")
        .select("order_id").in("order_id", openIds);
      const nonEmpty = new Set(((withItems as { order_id: string }[]) || []).map(x => x.order_id));
      const nonEmptyCount = openIds.filter(id => nonEmpty.has(id)).length;
      if (nonEmptyCount > 0 && !(await confirmDialog(
        `${nonEmptyCount} table(s) encore ouverte(s) avec des consommations NON encaissées.\nLa clôture va toutes les fermer (supprimées). Continuer ?`))) return;
      await supabase.from("rooftop_orders").delete().in("id", openIds);
      setOrders(prev => prev.filter(o => !openIds.includes(o.id)));
    }

    setShowCloture(true); setClotureLoading(true); setCloture(null);

    const { data: ords } = await supabase.from("rooftop_orders")
      .select("id,total,payment_method")
      .eq("hotel_id", hotelId).eq("date_service", date).eq("statut", "encaissee");
    const orderIds = (ords || []).map(o => o.id);
    let its: { prix: number; qty: number; source: string; tva_type: TvaType | null }[] = [];
    const parPaiement = { tpe: 0, espece: 0, chambre: 0 };
    if (orderIds.length) {
      const [{ data: itemsData }, { data: paysData }] = await Promise.all([
        supabase.from("rooftop_order_items").select("prix,qty,source,tva_type,order_id").in("order_id", orderIds),
        supabase.from("rooftop_order_payments").select("order_id,method,amount").in("order_id", orderIds),
      ]);
      its = (itemsData as typeof its) || [];
      // Regroupe les règlements par addition.
      const paysByOrder = new Map<string, { method: string; amount: number }[]>();
      ((paysData as { order_id: string; method: string; amount: number }[]) || []).forEach(p => {
        const arr = paysByOrder.get(p.order_id) ?? [];
        arr.push(p);
        paysByOrder.set(p.order_id, arr);
      });
      // Encaissements par moyen. Fallback legacy : addition encaissée SANS ligne de
      // paiement (soldée avant la migration 65) → on impute son total à payment_method.
      (ords || []).forEach(o => {
        const ps = paysByOrder.get(o.id);
        if (ps && ps.length) {
          ps.forEach(p => {
            const m = p.method as keyof typeof parPaiement;
            if (m in parPaiement) parPaiement[m] += Number(p.amount) || 0;
          });
        } else {
          const m = (o as { payment_method: string | null }).payment_method as keyof typeof parPaiement;
          if (m in parPaiement) parPaiement[m] += Number(o.total) || 0;
        }
      });
    }
    // Répartition des ventes : une formule ALCOOL = 50% food (10%) + 50% alcool (20%).
    // (La ventilation TVA, elle, part du ttc complet via ventileAll — inchangée.)
    const parType = { soft: 0, food: 0, alcool: 0 };
    const lignes = its.map(it => {
      const type: TvaType = it.tva_type ?? (it.source === "plat" ? "food" : "soft");
      const ttc = round2((Number(it.prix) || 0) * (it.qty || 1));
      if (type === "alcool") { parType.food += ttc / 2; parType.alcool += ttc / 2; }
      else parType[type] += ttc;
      return { ttc, type };
    });
    setCloture({
      nbAdditions: (ords || []).length,
      totalTtc: round2((ords || []).reduce((s, o) => s + (Number(o.total) || 0), 0)),
      parPaiement,
      parType: { soft: round2(parType.soft), food: round2(parType.food), alcool: round2(parType.alcool) },
      tva: totauxFromBuckets(ventileAll(lignes)),
    });
    setClotureLoading(false);
  };

  // Une table/résa peut porter PLUSIEURS additions (2e facture, roulement de table).
  const resaIds = new Set(resas.map(r => r.id));
  const ordersByResa = new Map<string, Order[]>();
  orders.forEach(o => {
    if (!o.reservation_id || !resaIds.has(o.reservation_id)) return;
    const arr = ordersByResa.get(o.reservation_id) ?? [];
    arr.push(o);
    ordersByResa.set(o.reservation_id, arr);
  });
  // Comptoir + additions « détachées » (résa annulée entre-temps) → toujours fermables.
  const walkinOrders = orders.filter(o => !o.reservation_id || !resaIds.has(o.reservation_id));

  // ════════════════════════════════════════════════════════════════════════════
  // VUE COMMANDE (table ouverte)
  // ════════════════════════════════════════════════════════════════════════════
  if (active) {
    const tableNom = active.table_id ? tables[active.table_id] : null;
    const locked = active.statut === "encaissee";
    const methodLabel = active.payment_method === "multi" ? "Paiement multiple"
      : active.payment_method === "tpe" ? "TPE (carte)"
      : active.payment_method === "espece" ? "Espèces"
      : active.payment_method === "chambre" ? `Transfert chambre ${active.room_ref ?? ""}`.trim()
      : null;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={closeActive} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-[#004e7c] transition">
            <ArrowLeft size={15} /> Retour au service
          </button>
          {!locked && (
            <button onClick={cancelOrder} disabled={busy}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-red-500 hover:bg-red-50 rounded-md px-2 py-1 transition">
              <Trash2 size={13} /> Annuler l&apos;addition
            </button>
          )}
        </div>

        <div className={`rounded-xl border px-4 py-3 ${locked ? "border-emerald-200 bg-emerald-50" : "border-[#004e7c]/30 bg-[#004e7c]/5"}`}>
          <p className="text-sm font-semibold text-[#013a5c]">
            {tableNom ? `Table ${tableNom}` : "Vente au comptoir"}
            {active.couvert_nom && <span className="text-slate-500 font-normal"> · {active.couvert_nom}</span>}
          </p>
          {locked && (
            <p className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700">
              <Lock size={12} /> Encaissée · {methodLabel} — verrouillée
            </p>
          )}
        </div>

        {locked ? (
          /* Vue lecture seule : une addition encaissée/transférée n'est plus modifiable */
          <div className="max-w-md bg-white rounded-xl border border-slate-200">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Addition</span>
            </div>
            {items.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-400">Aucune ligne.</p>
            ) : (
              <ul className="divide-y divide-slate-50">
                {items.map(i => (
                  <li key={i.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="w-6 text-center text-sm tabular-nums text-slate-500">{i.qty}×</span>
                    <p className="flex-1 min-w-0 text-[13px] text-slate-700 truncate">{i.nom}</p>
                    <span className="text-[13px] font-medium text-slate-700 tabular-nums">{euro(i.prix * i.qty)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
              <span className="text-sm text-slate-500">Total</span>
              <span className="text-lg font-bold text-[#013a5c] tabular-nums">{euro(Number(active.total) || total)}</span>
            </div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[1fr,340px] gap-4 items-start">
            {/* Carte */}
            <div className="space-y-4">
              {menu.length === 0 && <p className="text-sm text-slate-400">Carte vide — ajoutez des plats/boissons dans l&apos;onglet Carte.</p>}
              {menu.map(g => (
                <div key={g.key} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
                    <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">{g.label}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
                    {g.items.map(mi => (
                      <button key={`${mi.source}-${mi.ref_id ?? mi.nom}`} onClick={() => addLine(mi)}
                        className="text-left rounded-xl border border-slate-200 hover:border-[#004e7c] hover:bg-blue-50/50 active:scale-[0.97] active:bg-blue-50 transition p-3 min-h-[64px]">
                        <p className="text-[13px] font-medium text-slate-700 leading-tight line-clamp-2">{mi.nom}</p>
                        <p className="mt-1 text-[12px] text-slate-400 tabular-nums">{mi.prix ? euro(mi.prix) : "—"}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Ticket */}
            <div className="bg-white rounded-xl border border-slate-200 lg:sticky lg:top-4">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Addition</span>
              </div>
              {items.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-400">Touchez la carte pour ajouter.</p>
              ) : (
                <ul className="divide-y divide-slate-50 max-h-[46vh] overflow-y-auto">
                  {items.map(i => (
                    <li key={i.id} className="flex items-center gap-2 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-slate-700 truncate">{i.nom}</p>
                        {/* Montant unitaire modifiable au service */}
                        <div className="flex items-center gap-1 mt-0.5">
                          <input
                            key={`${i.id}-${i.prix}`}
                            type="text" inputMode="decimal"
                            defaultValue={String(i.prix)}
                            onBlur={e => editPrice(i, e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            className="w-16 h-7 rounded border border-slate-200 px-1.5 text-[12px] tabular-nums text-slate-600 focus:border-[#004e7c] focus:outline-none"
                            aria-label={`Prix unitaire de ${i.nom}`}
                          />
                          <span className="text-[11px] text-slate-400">€/u</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => changeQty(i, -1)} className="w-11 h-11 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 active:bg-slate-100 flex items-center justify-center"><Minus size={18} /></button>
                        <span className="w-7 text-center text-base font-medium tabular-nums">{i.qty}</span>
                        <button onClick={() => changeQty(i, 1)} className="w-11 h-11 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 active:bg-slate-100 flex items-center justify-center"><Plus size={18} /></button>
                      </div>
                      <span className="w-16 text-right text-[13px] font-medium text-slate-700 tabular-nums shrink-0">{euro(i.prix * i.qty)}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="px-4 py-3 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-500">Total</span>
                  <span className="text-lg font-bold text-[#013a5c] tabular-nums">{euro(total)}</span>
                </div>

                {/* Règlements déjà enregistrés (paiement partiel / multi) */}
                {payments.length > 0 && (
                  <div className="mb-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                    <ul className="space-y-1">
                      {payments.map(p => (
                        <li key={p.id} className="flex items-center justify-between text-[12px]">
                          <span className="text-slate-500">
                            {p.method === "tpe" ? "Carte" : p.method === "espece" ? "Espèces" : `Chambre${p.room_ref ? ` ${p.room_ref}` : ""}`}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="tabular-nums text-slate-600">{euro(p.amount)}</span>
                            <button onClick={() => removePayment(p)} title="Retirer ce règlement" className="text-slate-300 hover:text-red-500"><X size={13} /></button>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-200 text-sm">
                      <span className="text-slate-500">Reste à payer</span>
                      <span className="font-bold text-[#e11d48] tabular-nums">{euro(remaining)}</span>
                    </div>
                  </div>
                )}

                {/* Montant à encaisser — vide = solder le reste */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] uppercase tracking-wider text-slate-400 shrink-0">Montant</span>
                  <Input value={payAmount} onChange={e => setPayAmount(e.target.value)} inputMode="decimal"
                    placeholder={`Reste ${euro(remaining)}`} className="h-11 text-sm tabular-nums" />
                </div>

                {/* Mode de paiement (incl. transfert chambre) */}
                <div className="grid grid-cols-3 gap-2">
                  <MethodBtn active={payMethod === "tpe"} onClick={() => setPayMethod("tpe")} icon={<CreditCard size={16} />} label="TPE" />
                  <MethodBtn active={payMethod === "espece"} onClick={() => setPayMethod("espece")} icon={<Banknote size={16} />} label="Espèces" />
                  <MethodBtn active={payMethod === "chambre"} onClick={() => setPayMethod("chambre")} icon={<BedDouble size={16} />} label="Chambre" />
                </div>
                {payMethod === "chambre" && (
                  <Input value={roomRef} onChange={e => setRoomRef(e.target.value)} placeholder="N° de chambre"
                    className="h-11 text-sm mt-2" />
                )}

                <Button onClick={addPayment} disabled={busy || items.length === 0 || !payMethod || remaining <= 0}
                  className="w-full mt-3 h-12 text-[15px] bg-[#004e7c] hover:bg-[#003d61] text-white active:scale-[0.98]">
                  Encaisser {euro(round2(payAmount.trim() ? toNum(payAmount) : remaining))}
                </Button>
                <p className="mt-2 text-[10px] text-slate-400 text-center">
                  Règlements partiels/multiples possibles (laisse le montant vide pour solder). Coquille : aucun débit réel. Soldée → verrouillée.
                </p>
              </div>
            </div>
          </div>
        )}

        {(items.length > 0 || active.numero) && factureBlock()}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // VUE CLÔTURE DE SERVICE (récap à reporter dans Mews)
  // ════════════════════════════════════════════════════════════════════════════
  if (showCloture) {
    const c = cloture;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Clôture du service</p>
            <p className="text-sm font-semibold text-[#013a5c]">{new Date(date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</p>
          </div>
          <button onClick={() => setShowCloture(false)} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-[#004e7c] transition">
            <X size={15} /> Fermer
          </button>
        </div>

        {orders.some(o => o.statut !== "encaissee") && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            ⚠️ {orders.filter(o => o.statut !== "encaissee").length} addition(s) encore ouverte(s) — encaisse-les, ou ferme-les (✕ sur la carte), avant de clôturer le service. Elles ne sont pas comptées dans ce récap.
          </div>
        )}

        {clotureLoading || !c ? (
          <p className="text-center text-sm text-slate-400 py-8">Calcul…</p>
        ) : c.nbAdditions === 0 ? (
          <p className="text-center text-sm text-slate-400 py-8">Aucune addition encaissée ce jour-là.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-4 items-start">
            {/* CA + additions */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Chiffre d&apos;affaires TTC</span>
                <span className="text-2xl font-bold text-[#013a5c] tabular-nums">{euro(c.totalTtc)}</span>
              </div>
              <p className="mt-1 text-[12px] text-slate-400">{c.nbAdditions} addition{c.nbAdditions > 1 ? "s" : ""} encaissée{c.nbAdditions > 1 ? "s" : ""}</p>
            </div>

            {/* Par mode de paiement */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Encaissements</span>
              <ul className="mt-2 space-y-1.5 text-sm">
                <li className="flex justify-between"><span className="text-slate-500 flex items-center gap-1.5"><CreditCard size={14} /> Carte (TPE)</span><span className="font-medium tabular-nums">{euro(c.parPaiement.tpe)}</span></li>
                <li className="flex justify-between"><span className="text-slate-500 flex items-center gap-1.5"><Banknote size={14} /> Espèces</span><span className="font-medium tabular-nums">{euro(c.parPaiement.espece)}</span></li>
                <li className="flex justify-between"><span className="text-slate-500 flex items-center gap-1.5"><BedDouble size={14} /> Transfert chambre</span><span className="font-medium tabular-nums">{euro(c.parPaiement.chambre)}</span></li>
              </ul>
            </div>

            {/* Ventilation TVA (à reporter dans Mews) */}
            <div className="bg-white rounded-xl border border-[#004e7c]/30 p-4">
              <span className="text-xs font-semibold uppercase tracking-widest text-[#004e7c]">Ventilation TVA</span>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-slate-400">
                    <th className="text-left font-medium pb-1">Taux</th>
                    <th className="text-right font-medium pb-1">Base HT</th>
                    <th className="text-right font-medium pb-1">TVA</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  <tr><td className="text-slate-500 py-0.5">10%</td><td className="text-right">{euro(c.tva.ht10)}</td><td className="text-right">{euro(c.tva.tva10)}</td></tr>
                  <tr><td className="text-slate-500 py-0.5">20%</td><td className="text-right">{euro(c.tva.ht20)}</td><td className="text-right">{euro(c.tva.tva20)}</td></tr>
                  <tr className="border-t border-slate-100 font-semibold text-[#013a5c]"><td className="py-1">Total</td><td className="text-right">{euro(c.tva.totalHt)}</td><td className="text-right">{euro(c.tva.totalTva)}</td></tr>
                </tbody>
              </table>
            </div>

            {/* Par type de vente */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Répartition des ventes (TTC)</span>
              <ul className="mt-2 space-y-1.5 text-sm">
                <li className="flex justify-between"><span className="text-slate-500">Soft (10%)</span><span className="font-medium tabular-nums">{euro(c.parType.soft)}</span></li>
                <li className="flex justify-between"><span className="text-slate-500">Food (10%)</span><span className="font-medium tabular-nums">{euro(c.parType.food)}</span></li>
                <li className="flex justify-between"><span className="text-slate-500">Alcool (20%)</span><span className="font-medium tabular-nums">{euro(c.parType.alcool)}</span></li>
              </ul>
              <p className="mt-2 text-[10px] text-slate-400">Formule alcool : 50% food (10%) + 50% alcool (20%).</p>
            </div>
          </div>
        )}
        <p className="text-[11px] text-slate-400 text-center">Récap à reporter manuellement dans Mews en fin de service.</p>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // VUE SERVICE (liste des tables ouvrables)
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 mr-1">Service</span>
          <button onClick={() => shiftDate(-1)} title="Jour précédent"
            className="h-11 w-11 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 active:scale-95 transition">
            <ChevronLeft size={18} />
          </button>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-11 w-44 text-sm" />
          <button onClick={() => shiftDate(1)} title="Jour suivant"
            className="h-11 w-11 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 active:scale-95 transition">
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={openCloture} variant="outline" className="h-11 gap-1 border-[#004e7c]/30 text-[#004e7c] hover:bg-blue-50 active:scale-[0.97]">
            <ClipboardList size={14} /> Clôture du jour
          </Button>
          <Button onClick={() => setShowTablePicker(v => !v)} disabled={busy} className="h-11 bg-[#004e7c] hover:bg-[#003d61] text-white gap-1 active:scale-[0.97]">
            <Plus size={14} /> Ouvrir une table
          </Button>
          <Button onClick={() => openOrder(null)} disabled={busy} variant="outline" className="h-11 gap-1 border-slate-200 text-slate-600 hover:bg-slate-50 active:scale-[0.97]">
            <Utensils size={14} /> Vente au comptoir
          </Button>
        </div>
      </div>

      {/* Sélecteur de table (tablette : grosses cibles) */}
      {showTablePicker && (
        <div className="bg-white rounded-xl border border-[#004e7c]/30 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#004e7c]">Ouvrir quelle table ?</span>
            <button onClick={() => setShowTablePicker(false)} className="text-slate-400 hover:text-slate-600 p-1"><X size={16} /></button>
          </div>
          {tableList.length === 0 ? (
            <p className="text-sm text-slate-400">Aucune table active — à créer dans l&apos;onglet Réglages.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {tableList.map(t => (
                <button key={t.id} disabled={busy} onClick={() => openOrderForTable(t)}
                  className="h-16 rounded-xl border border-slate-200 hover:border-[#004e7c] hover:bg-blue-50 active:scale-[0.97] text-sm font-semibold text-slate-700 transition">
                  {t.nom}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-center text-sm text-slate-400 py-6">Chargement…</p>
      ) : (
        <>
          {/* Réservations du jour */}
          {resas.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-6">Aucune réservation ce jour-là.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {resas.flatMap(r => {
                const tableNom = r.table_id ? tables[r.table_id] : null;
                const rOrders = ordersByResa.get(r.id) ?? [];

                // Résa sans aucune addition → carte « Ouvrir »
                if (rOrders.length === 0) {
                  return [(
                    <button key={r.id} disabled={busy} onClick={() => openOrder(r)}
                      className="text-left rounded-2xl border p-4 min-h-[100px] shadow-sm transition active:scale-[0.98] border-slate-200 bg-white hover:-translate-y-0.5 hover:shadow-md hover:border-[#004e7c]/40">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{tableNom || "Sans table"}</span>
                        <span className="text-[10px] font-medium text-[#004e7c] bg-blue-50 px-2 py-0.5 rounded-full">Ouvrir</span>
                      </div>
                      <p className="mt-1.5 font-semibold text-[14px] text-slate-700 leading-tight truncate">{r.nom}</p>
                      <p className="mt-0.5 text-[12px] text-slate-400 tabular-nums flex items-center gap-1">
                        {r.heure} · <Users size={11} /> {r.couverts}
                      </p>
                    </button>
                  )];
                }

                // Une carte par addition (+ ✕ si ouverte), puis « Nouvelle addition ».
                const cards = rOrders.map((order, idx) => {
                  const encaissee = order.statut === "encaissee";
                  return (
                    <div key={order.id}
                      className={`relative rounded-2xl border p-4 min-h-[100px] shadow-sm transition ${
                        encaissee ? "border-slate-200 bg-slate-50 opacity-80" : "border-emerald-300 bg-emerald-50"}`}>
                      {!encaissee && (
                        <button onClick={e => cancelOrderById(order, e)} title="Fermer la table"
                          className="absolute top-2 right-2 text-slate-300 hover:text-red-500 transition p-1 rounded-md hover:bg-red-50">
                          <X size={14} />
                        </button>
                      )}
                      <button disabled={busy} onClick={() => reopenOrder(order)} className="block w-full text-left active:scale-[0.98]">
                        <div className="flex items-center justify-between pr-6">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            {tableNom || "Sans table"}{rOrders.length > 1 ? ` · add. ${idx + 1}` : ""}
                          </span>
                          {encaissee
                            ? <span className="text-[10px] font-medium text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">Encaissée</span>
                            : <span className="text-[10px] font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">Ouverte</span>}
                        </div>
                        <p className="mt-1.5 font-semibold text-[14px] text-slate-700 leading-tight truncate">{order.couvert_nom || r.nom}</p>
                        <p className="mt-0.5 text-[12px] text-slate-400 tabular-nums flex items-center gap-1">
                          {r.heure} · <Users size={11} /> {r.couverts}
                          {Number(order.total) > 0 && <span className="ml-auto font-medium text-slate-600">{euro(Number(order.total))}</span>}
                        </p>
                      </button>
                    </div>
                  );
                });
                return cards;
              })}
            </div>
          )}

          {/* Ventes au comptoir (sans résa) */}
          {walkinOrders.length > 0 && (
            <div className="pt-2">
              <p className="text-[12px] font-semibold text-slate-500 mb-2 flex items-center gap-1"><Utensils size={13} /> Ventes au comptoir</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {walkinOrders.map(o => {
                  const encaissee = o.statut === "encaissee";
                  return (
                    <div key={o.id}
                      className={`relative rounded-2xl border p-4 min-h-[100px] shadow-sm transition ${encaissee ? "border-slate-200 bg-slate-50 opacity-80" : "border-emerald-300 bg-emerald-50"}`}>
                      {!encaissee && (
                        <button onClick={e => cancelOrderById(o, e)} title="Fermer la vente"
                          className="absolute top-2 right-2 text-slate-300 hover:text-red-500 transition p-1 rounded-md hover:bg-red-50">
                          <X size={14} />
                        </button>
                      )}
                      <button disabled={busy} onClick={() => reopenOrder(o)} className="block w-full text-left active:scale-[0.98]">
                        <div className="flex items-center justify-between pr-6">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{o.couvert_nom ? "Table" : "Comptoir"}</span>
                          {encaissee ? <span className="text-[10px] font-medium text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">Encaissée</span>
                            : <span className="text-[10px] font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">Ouverte</span>}
                        </div>
                        {o.couvert_nom && <p className="mt-1.5 font-semibold text-[14px] text-slate-700 leading-tight truncate">{o.couvert_nom}</p>}
                        <p className="mt-0.5 text-[12px] text-slate-400 tabular-nums">{Number(o.total) > 0 ? euro(Number(o.total)) : "—"}</p>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MethodBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 rounded-lg border py-3 min-h-[60px] text-[13px] font-medium transition active:scale-[0.97] ${
        active ? "border-[#004e7c] bg-[#004e7c] text-white" : "border-slate-200 text-slate-600 hover:border-[#004e7c]/50"}`}>
      {icon}{label}
    </button>
  );
}
