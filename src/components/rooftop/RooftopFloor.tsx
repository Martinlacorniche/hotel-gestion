"use client";

// Plan de salle unifié Rooftop (Les Voiles) — fusionne Réservations + POS en un
// seul écran de service. Chaque table physique porte son cycle de vie
// (libre → réservée → arrivée/ouverte → encaissée), la prise de réservation, la
// note et l'encaissement se font au même endroit. Réutilise les tables/RPC/
// endpoints existants (rooftop_reservations, rooftop_tables, rooftop_orders +
// items + payments, RPC rooftop_book_staff, /api/rooftop/mews-payment,
// /api/rooftop/reservation-email). A REMPLACÉ les onglets Réservations et POS,
// supprimés le 2026-07-16 : c'est désormais le seul écran de service.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabaseClient";
import { confirmDialog } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { VOILES_ID, CarteLienCompact } from "@/components/rooftop/RooftopEditors";
import { tvaTypeForCategorie, round2, ventileAll, totauxFromBuckets, type TvaType, type TvaTotaux } from "@/lib/rooftopTva";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import toast from "react-hot-toast";
import {
  ChevronLeft, ChevronRight, Plus, Minus, Trash2, CreditCard, Banknote, BedDouble,
  CalendarPlus, Users, Clock, ArrowLeft, X, Check, UserCheck, UserX, Mail, Lock, Ban,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
type Table = { id: string; nom: string; couverts: number; ordre: number };
type Resa = {
  id: string; nom: string; couverts: number; heure: string; telephone: string | null;
  email: string | null; message: string | null; table_id: string | null;
  presence: string | null; statut: string; date_resa: string;
};
type Order = {
  id: string; table_id: string | null; reservation_id: string | null;
  couvert_nom: string | null; statut: string; total: number;
  numero: string | null; client_nom: string | null; client_email: string | null;
  payment_method: string | null; room_ref: string | null;
};
const ORDER_COLS = "id,table_id,reservation_id,couvert_nom,statut,total,numero,client_nom,client_email,payment_method,room_ref";

// Libellé du règlement d'une addition soldée. 'tpe' = legacy (= CB).
function methodLabel(o: Order): string | null {
  switch (o.payment_method) {
    case "multi": return "Paiement multiple";
    case "cb": case "tpe": return "CB";
    case "amex": return "Amex";
    case "espece": return "Espèces";
    case "chambre": return `Transfert chambre ${o.room_ref ?? ""}`.trim();
    default: return null;
  }
}
const PAY_LABEL: Record<string, string> = { cb: "CB", tpe: "CB", amex: "Amex", espece: "Espèces" };
type OrderRow = { id: string; source: string; ref_id: string | null; nom: string; prix: number; qty: number; tva_type: TvaType | null };
type Payment = { id: string; method: string; amount: number; room_ref: string | null; mews_payment_id?: string | null };
type MenuItem = { source: "plat" | "boisson"; ref_id: string | null; nom: string; prix: number; tvaType: TvaType };
type PayMethod = "cb" | "amex" | "espece" | "chambre";

// Récap figé à la clôture. Calculé avec le MÊME moteur TVA que les factures
// (rooftopTva) — le dupliquer en SQL le ferait diverger.
type Recap = {
  nbAdditions: number; totalTtc: number;
  parPaiement: { cb: number; amex: number; espece: number; chambre: number };
  parType: { soft: number; food: number; alcool: number };
  tva: TvaTotaux;
};
type ClotureRow = {
  id: string; closed_at: string; closed_by_nom: string | null;
  nb_additions: number; ca_ttc: number; recap: Recap | null;
};

type TState = "free" | "reserved" | "arrived" | "open";
// `orders` = TOUTES les notes ouvertes de la table (une table peut en porter
// plusieurs : addition séparée). `order` est celle qu'on ouvre au clic.
type TileInfo = { table: Table; state: TState; order: Order | null; orders: Order[]; resa: Resa | null; next: Resa | null; total: number };

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

// Habillage par état. Une table occupée est une tuile PLEINE (dégradé) : d'un
// coup d'œil, le service voit ce qui est pris et ce qui reste. Le blanc est
// réservé au libre — c'est le vide qui doit ressortir en creux, pas l'inverse.
type StateSkin = {
  label: string; card: string; nom: string; pill: string; dot: string;
  sub: string; next: string; money: string;
};
const STATE_STYLE: Record<TState, StateSkin> = {
  free: {
    label: "Libre",
    card: "bg-white border-slate-200",
    nom: "text-slate-800", pill: "bg-slate-100 text-slate-500", dot: "bg-slate-400",
    sub: "text-slate-400", next: "bg-indigo-50 text-indigo-600", money: "text-slate-900",
  },
  reserved: {
    label: "Réservée",
    card: "border-transparent bg-gradient-to-br from-[#00618f] to-[#013a5c] text-white",
    nom: "text-white", pill: "bg-white/20 text-white", dot: "bg-white",
    sub: "text-white/75", next: "bg-white/20 text-white", money: "text-white",
  },
  arrived: {
    label: "Arrivés",
    card: "border-transparent bg-gradient-to-br from-emerald-600 to-emerald-800 text-white",
    nom: "text-white", pill: "bg-white/20 text-white", dot: "bg-white",
    sub: "text-white/75", next: "bg-white/20 text-white", money: "text-white",
  },
  open: {
    label: "Ouverte",
    card: "border-transparent bg-gradient-to-br from-amber-500 to-amber-700 text-white",
    nom: "text-white", pill: "bg-white/20 text-white", dot: "bg-white",
    sub: "text-white/75", next: "bg-white/20 text-white", money: "text-white",
  },
};
const SELECTED_RING = "ring-2 ring-[#C6A972] ring-offset-2";

// Boutons secondaires du volet. IMPÉRATIF : variant="ghost", sinon le dégradé
// de marque du variant par défaut reste sous le texte (tailwind-merge ne le
// remplace pas — c'est une bg-image, pas une bg-color) et le libellé devient
// illisible.
const BTN_SOFT = "border border-slate-200 bg-white hover:bg-slate-50 text-slate-700";
const BTN_BLUE = "border border-[#00618f]/25 bg-[#00618f]/5 hover:bg-[#00618f]/10 text-[#00618f]";
const BTN_ROSE = "border border-rose-200 bg-white hover:bg-rose-50 text-rose-600";

export function FloorTab({ hotelId, headerSlot }: { hotelId: string; headerSlot?: HTMLElement | null }) {
  const { user } = useAuth();
  const canReopen = user?.role === "admin" || user?.role === "superadmin";
  const today = useMemo(todayStr, []);
  // Fenêtre de clôture = J ou J-1. Le J-1 couvre le service de nuit clôturé
  // après minuit. Le vrai verrou est dans la RPC (migration 83) ; ici on ne
  // fait que l'expliquer avant le clic.
  const yesterday = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const [date, setDate] = useState(today);
  const barSlug = hotelId === VOILES_ID ? "rooftop" : "bar";

  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [resas, setResas] = useState<Resa[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderTotals, setOrderTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // Périodes de fermeture (bannière) + heures de service (formulaire de résa).
  const [closedPeriods, setClosedPeriods] = useState<{ debut: string; fin: string }[]>([]);
  const [services, setServices] = useState<string[]>([]);

  // Clôture du jour affiché (null = service ouvert). Verrou réel côté base.
  const [clotureRow, setClotureRow] = useState<ClotureRow | null>(null);
  const [recapOpen, setRecapOpen] = useState(false);
  const closed = clotureRow !== null;

  // Sélection + panneau
  const [selId, setSelId] = useState<string | null>(null);
  const [mode, setMode] = useState<"none" | "reserve">("none");

  // Note active (addition ouverte)
  const [active, setActive] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderRow[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [payMethod, setPayMethod] = useState<PayMethod | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [roomRef, setRoomRef] = useState("");
  const [busy, setBusy] = useState(false);

  // Formulaire réservation (création OU édition)
  const emptyForm = { nom: "", tel: "", email: "", heure: "20:00", couverts: 2, message: "" };
  const [form, setForm] = useState(emptyForm);
  const [reserveTableId, setReserveTableId] = useState<string | null>(null);
  const [editResaId, setEditResaId] = useState<string | null>(null);

  // Facture (édition + envoi mail)
  const [clientNom, setClientNom] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [invoicing, setInvoicing] = useState(false);

  // ── Carte (une fois) ────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      supabase.from("wifi_bar").select("id,categorie,nom,ordre,actif").eq("hotel_id", hotelId).eq("actif", true).order("ordre"),
      supabase.from("wifi_tiles").select("config").eq("slug", barSlug).eq("hotel_id", hotelId).maybeSingle(),
    ]).then(([{ data: bar }, { data: tile }]) => {
      const cfg = (tile?.config ?? {}) as {
        categories_prix?: Record<string, string>; categories_ordre?: string[];
        categories_masquees?: string[]; categories_tva?: Record<string, string>;
      };
      const catPrix = cfg.categories_prix ?? {};
      const catTva = cfg.categories_tva ?? {};
      const masquees = new Set(cfg.categories_masquees ?? []);
      const barItems = (bar as { id: string; categorie: string; nom: string }[]) || [];
      const cats = [...new Set([...(cfg.categories_ordre ?? []), ...barItems.map(b => b.categorie)])];
      const out: MenuItem[] = [];
      for (const cat of cats) {
        if (masquees.has(cat)) continue;
        if (!barItems.some(b => b.categorie === cat)) continue;
        out.push({ source: "boisson", ref_id: null, nom: `Eat & Drink · ${cat}`, prix: toNum(catPrix[cat]), tvaType: tvaTypeForCategorie(cat, catTva) });
      }
      setMenu(out);
    });
  }, [hotelId, barSlug]);

  // ── Fermetures + heures de service (ne dépendent pas de la date) ────────────
  useEffect(() => {
    supabase.from("rooftop_closures").select("date_debut,date_fin").eq("hotel_id", hotelId)
      .then(({ data }) => setClosedPeriods(((data as { date_debut: string; date_fin: string }[]) || [])
        .map(c => ({ debut: c.date_debut, fin: c.date_fin }))));
    supabase.from("rooftop_services").select("heure").eq("hotel_id", hotelId).eq("actif", true).order("ordre")
      .then(({ data }) => setServices(((data as { heure: string | null }[]) || [])
        .map(s => (s.heure || "").trim()).filter(Boolean)));
  }, [hotelId]);

  const dayClosed = closedPeriods.some(p => date >= p.debut && date <= p.fin);

  // ── Tables + résas + additions du jour ──────────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true);
    const [{ data: tData }, { data: rData }, { data: oData }, { data: cData }] = await Promise.all([
      supabase.from("rooftop_tables").select("id,nom,couverts,ordre").eq("hotel_id", hotelId).eq("actif", true).order("ordre"),
      supabase.from("rooftop_reservations").select("id,nom,couverts,heure,telephone,email,message,table_id,presence,statut,date_resa")
        .eq("hotel_id", hotelId).eq("date_resa", date).neq("statut", "annulee").order("heure"),
      supabase.from("rooftop_orders").select(ORDER_COLS).eq("hotel_id", hotelId).eq("date_service", date).order("created_at"),
      supabase.from("rooftop_service_cloture").select("id,closed_at,closed_by_nom,nb_additions,ca_ttc,recap")
        .eq("hotel_id", hotelId).eq("date_service", date).maybeSingle(),
    ]);
    setClotureRow((cData as ClotureRow) ?? null);
    const ords = (oData as Order[]) || [];
    // Total en cours des additions OUVERTES (somme des lignes). Les encaissées ont order.total.
    const openIds = ords.filter(o => o.statut === "ouverte").map(o => o.id);
    const totals: Record<string, number> = {};
    ords.forEach(o => { if (o.statut === "encaissee") totals[o.id] = Number(o.total) || 0; });
    if (openIds.length) {
      const { data: its } = await supabase.from("rooftop_order_items").select("order_id,prix,qty").in("order_id", openIds);
      ((its as { order_id: string; prix: number; qty: number }[]) || []).forEach(it => {
        totals[it.order_id] = (totals[it.order_id] || 0) + (Number(it.prix) || 0) * (it.qty || 1);
      });
    }
    setTables((tData as Table[]) || []);
    // On garde les no-show en mémoire (les tuiles les excluent) : sinon un
    // no-show pointé par erreur devient irrattrapable depuis cet onglet.
    setResas((rData as Resa[]) || []);
    setOrders(ords);
    setOrderTotals(totals);
    setLoading(false);
  }, [hotelId, date]);

  useEffect(() => { reload(); }, [reload]);

  const shiftDate = (delta: number) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + delta);
    setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  };

  // ── État de chaque table (le cœur du plan-plateau) ──────────────────────────
  // Une résa dont l'addition a été encaissée est TERMINÉE : elle ne bloque plus
  // la table (sinon elle resterait "arrivée" après paiement).
  const doneResaIds = useMemo(() => new Set(
    orders.filter(o => o.statut === "encaissee" && o.reservation_id).map(o => o.reservation_id)
  ), [orders]);

  const tiles: TileInfo[] = useMemo(() => {
    return tables.map(t => {
    const tResas = resas.filter(r => r.table_id === t.id && r.presence !== "no_show" && !doneResaIds.has(r.id));
    const tOrders = orders.filter(o => o.table_id === t.id && o.statut === "ouverte");
    const order = tOrders[0] || null;
    let state: TState = "free";
    let resa: Resa | null = null;
    let next: Resa | null = null;
    if (order) {
      state = "open";
      next = tResas.find(r => r.id !== order.reservation_id) || null;
    } else if (tResas.length) {
      resa = tResas[0];
      state = resa.presence === "arrive" ? "arrived" : "reserved";
      next = tResas[1] || null;
    }
    // Le montant de la tuile couvre toutes les notes de la table : c'est ce que
    // la table doit, pas ce que doit la première addition.
    const total = tOrders.reduce((s, o) => s + (orderTotals[o.id] || 0), 0);
    return { table: t, state, order, orders: tOrders, resa, next, total };
    });
  }, [tables, resas, orders, orderTotals, doneResaIds]);

  const selected = tiles.find(t => t.table.id === selId) || null;
  const totalItems = items.reduce((s, i) => s + i.prix * i.qty, 0);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = round2(totalItems - paid);

  // La tuile et la clôture lisent orderTotals, que seul reload() alimentait :
  // sans ça, une note ouverte et garnie dans la session courante restait à 0 €
  // sur le plan (et ne bloquait pas la clôture).
  useEffect(() => {
    if (!active || active.statut === "encaissee") return;
    setOrderTotals(prev => prev[active.id] === totalItems ? prev : { ...prev, [active.id]: totalItems });
  }, [active, totalItems]);

  // ── Ouvrir / reprendre une note ─────────────────────────────────────────────
  const createOrder = async (fields: { table_id: string | null; reservation_id: string | null; couvert_nom: string | null }) => {
    // La base refuserait de toute façon (policies RESTRICTIVE, migration 81) —
    // autant le dire clairement plutôt que de laisser passer une erreur RLS.
    if (closed) { toast.error("Service clôturé — la caisse de ce jour est verrouillée."); return; }
    setBusy(true);
    const { data, error } = await supabase.from("rooftop_orders").insert({ hotel_id: hotelId, date_service: date, ...fields }).select(ORDER_COLS).single();
    setBusy(false);
    if (error) { toast.error(error.message || "Erreur"); return; }
    const o = data as Order;
    setOrders(prev => [...prev, o]);
    setActive(o); setItems([]); setPayments([]); setPayMethod(null); setPayAmount(""); setRoomRef("");
    setClientNom(fields.couvert_nom ?? ""); setClientEmail("");
  };

  const openWalkin = (t: Table) => createOrder({ table_id: t.id, reservation_id: null, couvert_nom: null });

  const openFromResa = async (r: Resa) => {
    if (r.presence !== "arrive") await markPresence(r, "arrive");
    await createOrder({ table_id: r.table_id, reservation_id: r.id, couvert_nom: r.nom });
  };

  const reopenOrder = async (order: Order) => {
    setBusy(true);
    const [{ data }, { data: pays }] = await Promise.all([
      supabase.from("rooftop_order_items").select("id,source,ref_id,nom,prix,qty,tva_type").eq("order_id", order.id).order("created_at"),
      supabase.from("rooftop_order_payments").select("id,method,amount,room_ref,mews_payment_id").eq("order_id", order.id).order("created_at"),
    ]);
    setBusy(false);
    setItems(((data as OrderRow[]) || []).map(r => ({ ...r, prix: Number(r.prix) })));
    setPayments(((pays as Payment[]) || []).map(p => ({ ...p, amount: Number(p.amount) })));
    setActive(order); setPayMethod(null); setPayAmount(""); setRoomRef("");
    setClientNom(order.client_nom ?? order.couvert_nom ?? ""); setClientEmail(order.client_email ?? "");
  };

  const closeActive = useCallback(() => { setActive(null); setItems([]); setPayments([]); setPayMethod(null); setPayAmount(""); setRoomRef(""); setClientNom(""); setClientEmail(""); }, []);

  // Changer de jour ne doit pas laisser ouverte — et modifiable — l'addition
  // d'un autre jour dans le volet.
  useEffect(() => { closeActive(); setSelId(null); setMode("none"); }, [date, closeActive]);

  // Vente au comptoir (sans table) — plusieurs peuvent coexister.
  const openCounter = () => { setSelId(null); setMode("none"); createOrder({ table_id: null, reservation_id: null, couvert_nom: null }); };

  // ── Lignes (persistées à chaque geste) ──────────────────────────────────────
  const addLine = async (mi: MenuItem) => {
    if (!active || active.statut === "encaissee") return;
    const existing = items.find(i => i.source === mi.source && i.nom === mi.nom && i.prix === mi.prix);
    if (existing) { await changeQty(existing, 1); return; }
    const { data, error } = await supabase.from("rooftop_order_items").insert({
      order_id: active.id, source: mi.source, ref_id: mi.ref_id, nom: mi.nom, prix: mi.prix, qty: 1, tva_type: mi.tvaType,
    }).select("id,source,ref_id,nom,prix,qty,tva_type").single();
    if (error) { toast.error("Erreur"); return; }
    setItems(prev => [...prev, { ...(data as OrderRow), prix: Number((data as OrderRow).prix) }]);
  };

  const changeQty = async (row: OrderRow, delta: number) => {
    if (!active || active.statut === "encaissee") return;
    const qty = row.qty + delta;
    if (qty <= 0) {
      if (!(await confirmDialog(`Retirer « ${row.nom} » de l'addition ?`))) return;
      setItems(prev => prev.filter(i => i.id !== row.id));
      await supabase.from("rooftop_order_items").delete().eq("id", row.id);
      return;
    }
    setItems(prev => prev.map(i => i.id === row.id ? { ...i, qty } : i));
    await supabase.from("rooftop_order_items").update({ qty }).eq("id", row.id);
  };

  const editPrice = async (row: OrderRow, value: string) => {
    if (!active || active.statut === "encaissee") return;
    const prix = toNum(value);
    if (prix === row.prix) return;
    setItems(prev => prev.map(i => i.id === row.id ? { ...i, prix } : i));
    const { error } = await supabase.from("rooftop_order_items").update({ prix }).eq("id", row.id);
    if (error) toast.error("Erreur montant");
  };

  // ── Encaissement (partiel/multi + push Mews) ────────────────────────────────
  const syncPaymentToMews = async (paymentId: string) => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) { toast.error("Règlement OK, mais session expirée pour la synchro Mews"); return; }
      const res = await fetch("/api/rooftop/mews-payment", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paymentId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { toast.error("Règlement OK, mais non synchronisé dans Mews"); return; }
      if (json.mewsPaymentId) setPayments(prev => prev.map(p => p.id === paymentId ? { ...p, mews_payment_id: json.mewsPaymentId } : p));
    } catch { toast.error("Règlement OK, mais push Mews échoué (réseau)"); }
  };

  const addPayment = async () => {
    if (!active || active.statut === "encaissee") return;
    if (closed) { toast.error("Service clôturé — la caisse de ce jour est verrouillée."); return; }
    if (!payMethod) { toast.error("Choisir un mode de paiement"); return; }
    if (payMethod === "chambre" && !roomRef.trim()) { toast.error("N° de chambre requis pour le transfert"); return; }
    if (remaining <= 0) { toast.error("Addition déjà soldée"); return; }
    const amt = round2(payAmount.trim() ? toNum(payAmount) : remaining);
    if (amt <= 0) { toast.error("Montant invalide"); return; }
    if (amt > remaining + 0.005) { toast.error(`Montant supérieur au reste à payer (${euro(remaining)})`); return; }
    setBusy(true);
    const { data, error } = await supabase.from("rooftop_order_payments").insert({
      order_id: active.id, hotel_id: hotelId, date_service: date,
      method: payMethod, amount: amt, room_ref: payMethod === "chambre" ? roomRef.trim() : null,
    }).select("id,method,amount,room_ref,mews_payment_id").single();
    if (error) { setBusy(false); toast.error(error.message || "Erreur"); return; }
    const row = data as Payment;
    const next = [...payments, { ...row, amount: Number(row.amount) }];
    setPayments(next);
    setPayAmount(""); setPayMethod(null); setRoomRef("");
    const newPaid = next.reduce((s, p) => s + p.amount, 0);
    if (row.method === "cb" || row.method === "amex" || row.method === "espece") void syncPaymentToMews(row.id);
    if (newPaid + 0.005 >= totalItems) {
      const { error: e2 } = await supabase.from("rooftop_orders").update({
        statut: "encaissee", total: totalItems, closed_at: new Date().toISOString(),
        payment_method: next.length > 1 ? "multi" : next[0].method,
        room_ref: next.find(p => p.method === "chambre")?.room_ref ?? null,
      }).eq("id", active.id);
      setBusy(false);
      if (e2) { toast.error(e2.message || "Erreur"); return; }
      toast.success("Addition soldée ✓");
      closeActive(); setSelId(null); await reload();
    } else {
      setBusy(false);
      toast.success(`Réglé ${euro(amt)} · reste ${euro(round2(totalItems - newPaid))}`);
    }
  };

  const removePayment = async (p: Payment) => {
    if (!active || active.statut === "encaissee") return;
    if (p.mews_payment_id) {
      if (!(await confirmDialog("Ce règlement est enregistré dans Mews. Le retirer va aussi l'annuler dans Mews. Continuer ?"))) return;
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) { toast.error("Session expirée"); return; }
      try {
        const res = await fetch("/api/rooftop/mews-payment/cancel", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ paymentId: p.id }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) { toast.error(json.error || "Annulation Mews impossible — à corriger dans le PMS"); return; }
      } catch { toast.error("Annulation Mews échouée (réseau) — ligne conservée"); return; }
    }
    setPayments(prev => prev.filter(x => x.id !== p.id));
    await supabase.from("rooftop_order_payments").delete().eq("id", p.id);
  };

  const cancelOrder = async () => {
    if (!active || active.statut === "encaissee") return;
    if (items.length > 0 && !(await confirmDialog(`Cette addition contient ${items.length} article${items.length > 1 ? "s" : ""}. Supprimer l'addition ?`))) return;
    setBusy(true);
    const { error } = await supabase.from("rooftop_orders").delete().eq("id", active.id);
    setBusy(false);
    if (error) { toast.error(error.message || "Erreur"); return; }
    toast.success("Addition supprimée");
    closeActive(); setSelId(null); await reload();
  };

  // Facture PDF réglementaire envoyée par mail (route serveur existante).
  const sendFacture = async () => {
    if (!active || items.length === 0) return;
    if (!clientEmail.trim()) { toast.error("Email du client requis"); return; }
    setInvoicing(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) { toast.error("Session expirée"); return; }
      const res = await fetch("/api/rooftop/facture", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderId: active.id, clientNom, clientEmail }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { toast.error(json.error || "Échec facture"); return; }
      toast.success(`Facture ${json.numero} envoyée ✓`);
      setActive(prev => prev ? { ...prev, numero: json.numero, client_nom: clientNom, client_email: clientEmail } : prev);
      setOrders(prev => prev.map(o => o.id === active!.id ? { ...o, numero: json.numero, client_nom: clientNom, client_email: clientEmail } : o));
    } catch { toast.error("Erreur réseau"); } finally { setInvoicing(false); }
  };

  // ── Réservation (RPC forçage + email de confirmation) ───────────────────────
  const markPresence = async (r: Resa, value: "arrive" | null) => {
    setResas(prev => prev.map(x => x.id === r.id ? { ...x, presence: value } : x));
    const { error } = await supabase.from("rooftop_reservations").update({ presence: value }).eq("id", r.id);
    if (error) toast.error("Erreur");
  };

  const markNoShow = async (r: Resa) => {
    if (!(await confirmDialog(`Marquer ${r.nom} en no-show et l'ajouter à la blacklist ?`))) return;
    // Ne pas blacklister si le pointage lui-même a échoué : on se retrouverait
    // avec un client banni sans no-show enregistré.
    const { error: pErr } = await supabase.from("rooftop_reservations").update({ presence: "no_show" }).eq("id", r.id);
    if (pErr) { toast.error("No-show non enregistré — client NON blacklisté"); return; }
    const { error: blErr } = await supabase.from("rooftop_blacklist").insert({
      hotel_id: hotelId, email: r.email || null, nom: r.nom || null,
      motif: `No-show ${r.date_resa}`,
    });
    if (blErr) toast.error("No-show pointé, mais blacklist non enregistrée");
    else toast.success("No-show → client blacklisté 🚫");
    setSelId(null); await reload();
  };

  // Déplacer une résa sur une autre table (jamais sur une table déjà prise :
  // la liste proposée ne contient que les tuiles libres).
  const moveResa = async (r: Resa, toTableId: string) => {
    const t = tables.find(x => x.id === toTableId);
    if (!t) return;
    if (t.couverts < r.couverts && !(await confirmDialog(
      `${t.nom} n'a que ${t.couverts} couverts pour ${r.couverts} personnes. Déplacer quand même ?`))) return;
    setBusy(true);
    const { error } = await supabase.from("rooftop_reservations").update({ table_id: toTableId }).eq("id", r.id);
    setBusy(false);
    if (error) { toast.error(error.message || "Erreur"); return; }
    toast.success(`${r.nom} déplacé sur ${t.nom} ✓`);
    setSelId(toTableId); await reload();
  };

  // Rattraper un no-show pointé par erreur. Le pointage avait blacklisté le
  // client : le dé-pointer sans nettoyer la blacklist le laisserait banni.
  const annulerNoShow = async (r: Resa) => {
    if (!(await confirmDialog(`Annuler le no-show de ${r.nom} ? Le client sera aussi retiré de la blacklist.`))) return;
    setBusy(true);
    const { error } = await supabase.from("rooftop_reservations").update({ presence: null }).eq("id", r.id);
    if (error) { setBusy(false); toast.error(error.message || "Erreur"); return; }
    const base = supabase.from("rooftop_blacklist").delete()
      .eq("hotel_id", hotelId).eq("motif", `No-show ${r.date_resa}`);
    // markNoShow écrit email si dispo, sinon nom (`.eq(col, null)` ne marche pas).
    const { data: del, error: blErr } = await (r.email ? base.eq("email", r.email) : base.eq("nom", r.nom)).select("id");
    setBusy(false);
    if (blErr) toast.error("No-show annulé, mais blacklist non nettoyée — à vérifier dans Réglages");
    else if (!del?.length) toast.success("No-show annulé (aucune entrée blacklist correspondante)");
    else toast.success("No-show annulé — client retiré de la blacklist ✓");
    setSelId(null); await reload();
  };

  const cancelResa = async (r: Resa) => {
    if (!(await confirmDialog(`Annuler la réservation de ${r.nom} ?`))) return;
    await supabase.from("rooftop_reservations").update({ statut: "annulee" }).eq("id", r.id);
    toast.success("Réservation annulée");
    if (r.email && await confirmDialog(`Prévenir ${r.email} de l'annulation par email ?`)) {
      fetch("/api/rooftop/cancel-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nom: r.nom, email: r.email, date: r.date_resa, heure: r.heure, couverts: r.couverts }),
      }).then(res => res.ok ? toast.success("Client prévenu par email") : toast.error("Mail non envoyé")).catch(() => toast.error("Mail non envoyé"));
    }
    setSelId(null); await reload();
  };

  const sendConfirmEmail = (r: { nom: string; email: string; telephone: string; heure: string; couverts: number; message: string; table: string }) => {
    if (!r.email) return;
    fetch("/api/rooftop/reservation-email", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom: r.nom, email: r.email, telephone: r.telephone, date, heure: r.heure, couverts: r.couverts, message: r.message, table: r.table }),
    }).then(res => res.ok ? toast.success("Mail de confirmation envoyé") : toast.error("Mail non envoyé")).catch(() => toast.error("Mail non envoyé"));
  };

  const openReserve = (t: Table, resa?: Resa) => {
    setReserveTableId(t.id);
    setEditResaId(resa?.id ?? null);
    setForm(resa
      ? { nom: resa.nom, tel: resa.telephone ?? "", email: resa.email ?? "", heure: resa.heure, couverts: resa.couverts, message: resa.message ?? "" }
      // Heure par défaut = 1er service configuré (Réglages), pas une constante.
      : { ...emptyForm, heure: (services[0] || emptyForm.heure).slice(0, 5), couverts: t.couverts });
    setMode("reserve");
  };

  const submitReserve = async () => {
    const t = tables.find(x => x.id === reserveTableId);
    if (!t) return;
    const nom = form.nom.trim();
    if (!nom) { toast.error("Nom requis"); return; }
    const heure = form.heure.trim();
    if (!heure) { toast.error("Heure requise"); return; }
    const couverts = form.couverts || t.couverts;
    // Édition d'une résa existante.
    if (editResaId) {
      setBusy(true);
      const { error } = await supabase.from("rooftop_reservations").update({
        heure, couverts, nom, telephone: form.tel.trim() || null,
        email: form.email.trim() || null, message: form.message.trim() || null, table_id: t.id,
      }).eq("id", editResaId);
      setBusy(false);
      if (error) { toast.error(error.message || "Erreur"); return; }
      toast.success("Réservation modifiée ✓");
      setMode("none"); setEditResaId(null); setSelId(t.id); await reload();
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("rooftop_reservations").insert({
      hotel_id: hotelId, date_resa: date, heure, couverts, nom,
      telephone: form.tel.trim() || null, email: form.email.trim() || null,
      message: form.message.trim() || null, statut: "confirmee", table_id: t.id,
    }).select().single();
    if (error) {
      const bl = error.message?.toLowerCase().includes("blacklist");
      const closed = error.message?.includes("indisponible");
      if (bl || closed) {
        const warn = bl ? `⚠️ ${nom} est blacklisté (no-show passé). Forcer la réservation quand même ?`
                        : `⚠️ Ce jour est fermé à la réservation en ligne. Forcer quand même ?`;
        if (!(await confirmDialog(warn))) { setBusy(false); return; }
        const { error: fErr } = await supabase.rpc("rooftop_book_staff", {
          p_hotel: hotelId, p_date: date, p_heure: heure, p_pax: couverts,
          p_nom: nom, p_tel: form.tel.trim(), p_email: form.email.trim(), p_message: form.message.trim(), p_table: t.id,
        });
        setBusy(false);
        if (fErr) { toast.error(fErr.message || "Erreur"); return; }
        toast.success("Réservation forcée ✓");
        sendConfirmEmail({ nom, email: form.email.trim(), telephone: form.tel.trim(), heure, couverts, message: form.message.trim(), table: t.nom });
        setMode("none"); setSelId(t.id); await reload();
        return;
      }
      setBusy(false); toast.error(error.message || "Erreur"); return;
    }
    setBusy(false);
    toast.success("Réservation créée ✓");
    sendConfirmEmail({ nom, email: form.email.trim(), telephone: form.tel.trim(), heure, couverts, message: form.message.trim(), table: t.nom });
    setMode("none"); setSelId(t.id); await reload();
  };

  // ── Clôture ─────────────────────────────────────────────────────────────────
  // Le garde-fou « reste à encaisser » et l'unicité vivent dans la RPC
  // rooftop_cloturer_service (migration 81) : ni un double-clic, ni un 2e poste,
  // ni un client bugué ne peuvent clôturer un service encore en cours ni créer
  // deux clôtures. Ici on ne fait que calculer le récap à figer.
  const buildRecap = async (): Promise<Recap> => {
    const { data: ords } = await supabase.from("rooftop_orders").select("id,total,payment_method")
      .eq("hotel_id", hotelId).eq("date_service", date).eq("statut", "encaissee");
    const rows = ((ords as { id: string; total: number; payment_method: string | null }[]) || []);
    const ids = rows.map(o => o.id);
    const parPaiement = { cb: 0, amex: 0, espece: 0, chambre: 0 };
    const parType = { soft: 0, food: 0, alcool: 0 };
    let lignes: { ttc: number; type: TvaType }[] = [];
    // 'tpe' (legacy) compte comme CB.
    const norm = (m: string): keyof typeof parPaiement | null =>
      m === "tpe" ? "cb" : (m === "cb" || m === "amex" || m === "espece" || m === "chambre") ? m : null;
    if (ids.length) {
      const [{ data: itemsData }, { data: paysData }] = await Promise.all([
        supabase.from("rooftop_order_items").select("prix,qty,source,tva_type,order_id").in("order_id", ids),
        supabase.from("rooftop_order_payments").select("order_id,method,amount").in("order_id", ids),
      ]);
      const its = ((itemsData as { prix: number; qty: number; source: string; tva_type: TvaType | null }[]) || []);
      lignes = its.map(it => {
        const type: TvaType = it.tva_type ?? (it.source === "plat" ? "food" : "soft");
        const ttc = round2((Number(it.prix) || 0) * (it.qty || 1));
        // Une formule ALCOOL vaut moitié food, moitié alcool (clé comptable).
        if (type === "alcool") { parType.food += ttc / 2; parType.alcool += ttc / 2; }
        else parType[type] += ttc;
        return { ttc, type };
      });
      const paysByOrder = new Map<string, { method: string; amount: number }[]>();
      ((paysData as { order_id: string; method: string; amount: number }[]) || []).forEach(p => {
        const arr = paysByOrder.get(p.order_id) ?? []; arr.push(p); paysByOrder.set(p.order_id, arr);
      });
      // Repli legacy : addition soldée sans ligne de paiement (avant migration
      // 65) → on impute son total à payment_method.
      rows.forEach(o => {
        const ps = paysByOrder.get(o.id);
        if (ps?.length) ps.forEach(p => { const m = norm(p.method); if (m) parPaiement[m] += Number(p.amount) || 0; });
        else { const m = norm(o.payment_method || ""); if (m) parPaiement[m] += Number(o.total) || 0; }
      });
    }
    return {
      nbAdditions: rows.length,
      totalTtc: round2(rows.reduce((s, o) => s + (Number(o.total) || 0), 0)),
      parPaiement: {
        cb: round2(parPaiement.cb), amex: round2(parPaiement.amex),
        espece: round2(parPaiement.espece), chambre: round2(parPaiement.chambre),
      },
      parType: { soft: round2(parType.soft), food: round2(parType.food), alcool: round2(parType.alcool) },
      tva: totauxFromBuckets(ventileAll(lignes)),
    };
  };

  const doCloture = async () => {
    // Déjà clôturé : on ne rejoue rien, on réaffiche le récap figé.
    if (closed) { setRecapOpen(true); return; }
    setBusy(true);
    const recap = await buildRecap();
    const { data, error } = await supabase.rpc("rooftop_cloturer_service", {
      p_hotel: hotelId, p_date: date, p_nb: recap.nbAdditions, p_ca: recap.totalTtc, p_recap: recap,
    });
    setBusy(false);
    if (error) { toast.error(error.message || "Clôture impossible"); return; }
    const res = data as { status: string; nb?: number; cloture?: ClotureRow };
    if (res.status === "reste") {
      toast.error(`Clôture impossible : ${res.nb} table(s) encore à encaisser. Encaisse-les d'abord — rien n'est supprimé.`, { duration: 6000 });
      await reload(); return;
    }
    if (res.status === "refuse") { toast.error("Session expirée"); return; }
    if (res.status === "trop_ancien") { toast.error("Ce service est trop ancien pour être clôturé (J et J-1 seulement).", { duration: 6000 }); return; }
    if (res.status === "futur") { toast.error("On ne clôture pas un service à venir."); return; }
    setClotureRow(res.cloture ?? null);
    setRecapOpen(true);
    toast.success(res.status === "deja" ? "Service déjà clôturé" : "Service clôturé ✓");
    closeActive(); setSelId(null); await reload();
  };

  // Rouvrir : supprime la ligne de clôture, ce qui lève le verrou en base.
  // Réservé admin/superadmin (policy delete côté RLS — le bouton n'est qu'un
  // raccourci, pas la sécurité).
  const rouvrirService = async () => {
    if (!clotureRow) return;
    if (!(await confirmDialog("Rouvrir le service ? La caisse de ce jour redeviendra modifiable et le récap figé sera supprimé."))) return;
    setBusy(true);
    const { error } = await supabase.from("rooftop_service_cloture").delete().eq("id", clotureRow.id);
    setBusy(false);
    if (error) { toast.error(error.message || "Réouverture refusée"); return; }
    toast.success("Service rouvert");
    setRecapOpen(false); await reload();
  };

  // ── Rendu ───────────────────────────────────────────────────────────────────
  const selTile = selected;
  const counterOrders = orders.filter(o => o.table_id === null && o.statut === "ouverte");
  // Additions soldées du service : la table est repartie libre, mais l'addition
  // doit rester consultable (relire, vérifier le règlement, renvoyer la facture).
  // Résas orphelines : sans table, ou sur une table supprimée/désactivée
  // (table_id est en `on delete set null`). Sans cette bande, elles seraient
  // invisibles — aucune tuile ne les porte.
  const aPlacer = resas.filter(r => r.presence !== "no_show"
    && (!r.table_id || !tables.some(t => t.id === r.table_id)) && !doneResaIds.has(r.id));
  const noShows = resas.filter(r => r.presence === "no_show");
  const freeTables = tiles.filter(t => t.state === "free").map(t => t.table);
  const paidOrders = orders.filter(o => o.statut === "encaissee");
  const paidCa = paidOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const tableNom = (id: string | null) => tables.find(t => t.id === id)?.nom ?? null;
  const reserveTable = tables.find(x => x.id === reserveTableId) || null;
  const facture = { clientNom, setClientNom, clientEmail, setClientEmail, invoicing, sendFacture };

  const clotureOuverte = date === today || date === yesterday;

  // Date + clôture : projetées dans le header de la page (au-dessus des onglets)
  // pour ne pas manger une ligne au-dessus du plan de salle. Repli en place si
  // aucun emplacement n'est fourni.
  const serviceControls = (
    <>
      {date !== today && (
        <button onClick={() => setDate(today)} className="text-xs font-semibold text-[var(--brand)] px-1">Aujourd&apos;hui</button>
      )}
      <div className="flex items-center gap-1">
        <button onClick={() => shiftDate(-1)} aria-label="Jour précédent"
          className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"><ChevronLeft className="w-4 h-4" /></button>
        <input type="date" value={date} onChange={e => setDate(e.target.value || today)}
          className="border border-slate-200 rounded-lg px-2 h-10 text-sm bg-white" />
        <button onClick={() => shiftDate(1)} aria-label="Jour suivant"
          className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <button onClick={doCloture} disabled={busy || (!closed && !clotureOuverte)}
        title={!closed && !clotureOuverte
          ? (date > today ? "On ne clôture pas un service à venir."
                          : "Service trop ancien : la clôture n'est possible que le jour même ou le lendemain.")
          : undefined}
        className={`inline-flex items-center gap-2 rounded-lg border px-3.5 h-10 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed ${
          closed ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                 : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
        {closed ? <><Lock className="w-4 h-4" /> Service clôturé</> : <><Check className="w-4 h-4" /> Clôture du service</>}
      </button>
    </>
  );

  return (
    <div className="space-y-5">
      {headerSlot
        ? createPortal(serviceControls, headerSlot)
        : <div className="flex items-center justify-end gap-2 flex-wrap">{serviceControls}</div>}

      {closed && clotureRow && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-800">
          <Lock className="w-4 h-4 shrink-0" />
          <span>
            <b>Service clôturé</b> à {new Date(clotureRow.closed_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            {clotureRow.closed_by_nom ? ` par ${clotureRow.closed_by_nom}` : ""} — la caisse de ce jour est verrouillée.
          </span>
          <button onClick={() => setRecapOpen(true)} className="font-bold underline underline-offset-2">Voir le récap</button>
          {canReopen && (
            <button onClick={rouvrirService} disabled={busy} className="ml-auto font-semibold text-emerald-700/70 hover:text-emerald-900 disabled:opacity-50">
              Rouvrir le service
            </button>
          )}
        </div>
      )}

      {dayClosed && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] font-medium text-amber-800">
          <Ban className="w-4 h-4 shrink-0" />
          Vente en ligne fermée ce jour-là — l&apos;équipe peut quand même réserver (une confirmation sera demandée).
        </div>
      )}

      <ClotureRecapDialog open={recapOpen} onOpenChange={setRecapOpen} row={clotureRow} date={date} />

      <div className="grid lg:grid-cols-[1fr_minmax(340px,380px)] gap-5 items-start">
        {/* Plan de salle */}
        <div>
          {loading ? (
            <div className="py-16 text-center text-slate-400 text-sm">Chargement…</div>
          ) : tables.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 text-sm">
              Aucune table active. Ajoute des tables dans <b>Réglages → Plan de salle</b>.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {tiles.map(ti => {
                const s = STATE_STYLE[ti.state];
                const sel = ti.table.id === selId;
                return (
                  <button key={ti.table.id}
                    onClick={() => { setSelId(ti.table.id); setMode("none"); closeActive(); if (ti.order) reopenOrder(ti.order); }}
                    className={`text-left rounded-2xl border p-4 min-h-[116px] flex flex-col gap-2 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg ${s.card} ${sel ? SELECTED_RING : ""}`}>
                    <div className="flex flex-col items-start gap-1.5">
                      <span className={`w-full text-[12px] font-extrabold uppercase tracking-wide leading-tight ${ti.state === "free" ? "text-slate-600" : "text-white/70"}`}>{ti.table.nom}</span>
                      <span className={`whitespace-nowrap text-[9.5px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full inline-flex items-center gap-1.5 ${s.pill}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
                      </span>
                    </div>
                    {ti.state === "open" ? (
                      <>
                        <div className={`text-[15px] font-bold leading-tight line-clamp-2 break-words ${s.nom}`}>
                          {ti.orders.length > 1 ? `${ti.orders.length} additions` : (ti.order?.couvert_nom || "Sur place")}
                        </div>
                        <div className="mt-auto flex items-end justify-between gap-2">
                          <span className={`text-xs inline-flex items-center gap-1 ${s.sub}`}><Users className="w-3.5 h-3.5" />{ti.table.couverts}</span>
                          <span className={`text-[18px] font-extrabold tabular-nums ${s.money}`}>{euro(ti.total)}</span>
                        </div>
                      </>
                    ) : ti.resa ? (
                      <>
                        <div className={`text-[15px] font-bold leading-tight line-clamp-2 break-words ${s.nom}`}>{ti.resa.nom}</div>
                        <div className={`mt-auto text-xs inline-flex items-center gap-1.5 ${s.sub}`}>
                          <Clock className="w-3.5 h-3.5" />{ti.resa.heure} · {ti.resa.couverts} couv.
                        </div>
                      </>
                    ) : (
                      <div className="mt-auto text-xs text-slate-300">Disponible</div>
                    )}
                    {ti.next && <div className={`text-[9.5px] font-bold inline-flex items-center gap-1 self-start px-2 py-0.5 rounded-full ${s.next}`}><Clock className="w-2.5 h-2.5" /> suite {ti.next.heure}</div>}
                  </button>
                );
              })}
            </div>
          )}

          {/* À placer : résas qu'aucune tuile ne porte (table supprimée/désactivée) */}
          {aPlacer.length > 0 && (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <div className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-2.5">
                À placer ({aPlacer.length})
              </div>
              <div className="space-y-2">
                {aPlacer.map(r => (
                  <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white border border-amber-100 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-slate-800 truncate">{r.nom}</div>
                      <div className="text-xs text-slate-400">{r.heure} · {r.couverts} couv.{r.telephone ? ` · ${r.telephone}` : ""}</div>
                    </div>
                    {freeTables.length > 0 ? (
                      <SelectField value="" placeholder="Placer à…" className="h-9 w-44 shrink-0"
                        options={freeTables.map(ft => ({ value: ft.id, label: `${ft.nom} · ${ft.couverts} couv.` }))}
                        onChange={id => moveResa(r, id)} />
                    ) : (
                      <span className="text-xs text-amber-700 font-semibold">Aucune table libre</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No-show du jour : hors du plan, mais rattrapables */}
          {noShows.length > 0 && (
            <div className="mt-5">
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">No-show ({noShows.length})</div>
              <div className="flex flex-wrap gap-2">
                {noShows.map(r => (
                  <div key={r.id} className="inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <UserX className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-[12px] font-bold text-slate-500 truncate max-w-[10rem]">
                      {r.nom}<span className="font-medium text-slate-400"> · {r.heure}</span>
                    </span>
                    <button onClick={() => annulerNoShow(r)} disabled={busy}
                      className="text-[11px] font-bold text-[var(--brand)] hover:underline disabled:opacity-50">
                      Annuler
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comptoir : ventes sans table, plusieurs en parallèle */}
          <div className="mt-5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Comptoir</span>
              {!closed && (
                <button onClick={openCounter} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)] hover:underline">
                  <Plus className="w-4 h-4" /> Nouvelle vente
                </button>
              )}
            </div>
            {counterOrders.length === 0 ? (
              <div className="text-xs text-slate-400">Aucune vente au comptoir en cours.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                {counterOrders.map(o => (
                  <button key={o.id} onClick={() => { setSelId(null); setMode("none"); reopenOrder(o); }}
                    className={`text-left rounded-2xl border p-4 min-h-[92px] flex flex-col gap-2 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg ${STATE_STYLE.open.card} ${active?.id === o.id ? SELECTED_RING : ""}`}>
                    <span className="text-[12px] font-extrabold uppercase tracking-wide text-white/70">Comptoir</span>
                    <div className="text-[14px] font-bold text-white truncate">{o.couvert_nom || "Vente"}</div>
                    <div className="mt-auto text-[17px] font-extrabold tabular-nums text-white">{euro(orderTotals[o.id] || 0)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Encaissées : consultation seule (facture renvoyable) */}
          {paidOrders.length > 0 && (
            <div className="mt-5">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Encaissées</span>
                <span className="text-xs text-slate-400">
                  {paidOrders.length} addition{paidOrders.length > 1 ? "s" : ""} · <b className="text-slate-600 tabular-nums">{euro(paidCa)}</b>
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {paidOrders.map(o => (
                  <button key={o.id} onClick={() => { setSelId(null); setMode("none"); reopenOrder(o); }}
                    className={`inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-left transition hover:border-slate-300 hover:shadow-sm ${active?.id === o.id ? SELECTED_RING : "border-slate-200"}`}>
                    <Lock className="w-3 h-3 text-emerald-600 shrink-0" />
                    <span className="text-[12px] font-bold text-slate-600 truncate max-w-[9rem]">
                      {tableNom(o.table_id) ?? "Comptoir"}
                      {o.couvert_nom ? <span className="font-medium text-slate-400"> · {o.couvert_nom}</span> : null}
                    </span>
                    <span className="text-[13px] font-extrabold tabular-nums text-slate-800">{euro(Number(o.total) || 0)}</span>
                    {o.numero && <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full shrink-0">Facturée</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Volet contextuel */}
        <aside className="rounded-2xl border border-slate-200 bg-white overflow-hidden lg:sticky lg:top-4">
          {active ? (
            <OrderPanel
              siblings={active.table_id ? orders.filter(o => o.table_id === active.table_id && o.statut === "ouverte") : []}
              onSwitch={reopenOrder}
              onAddOrder={() => active.table_id && createOrder({ table_id: active.table_id, reservation_id: null, couvert_nom: null })}
              table={tables.find(t => t.id === active.table_id) ?? null} active={active} items={items} menu={menu}
              serviceClosed={closed}
              payments={payments} payMethod={payMethod} setPayMethod={setPayMethod}
              payAmount={payAmount} setPayAmount={setPayAmount} roomRef={roomRef} setRoomRef={setRoomRef}
              totalItems={totalItems} paid={paid} remaining={remaining} busy={busy} facture={facture}
              onBack={() => { closeActive(); }} addLine={addLine} changeQty={changeQty} editPrice={editPrice}
              addPayment={addPayment} removePayment={removePayment} cancelOrder={cancelOrder}
            />
          ) : mode === "reserve" && reserveTable ? (
            <ReservePanel table={reserveTable} editing={!!editResaId} form={form} setForm={setForm} services={services}
              onCancel={() => { setMode("none"); setEditResaId(null); }} onSubmit={submitReserve} busy={busy} />
          ) : selTile ? (
            <TablePanel ti={selTile}
              freeTables={freeTables}
              onWalkin={() => openWalkin(selTile.table)}
              onReserve={() => openReserve(selTile.table)}
              onEditResa={() => selTile.resa && openReserve(selTile.table, selTile.resa)}
              onSeat={() => selTile.resa && openFromResa(selTile.resa)}
              onUnseat={() => selTile.resa && markPresence(selTile.resa, null)}
              onNoShow={() => selTile.resa && markNoShow(selTile.resa)}
              onCancelResa={() => selTile.resa && cancelResa(selTile.resa)}
              onMoveResa={id => selTile.resa && moveResa(selTile.resa, id)}
            />
          ) : (
            <div className="p-10 text-center text-slate-400 text-sm">Touche une table pour la piloter.</div>
          )}
        </aside>
      </div>

      {/* Pense-bête équipes */}
      <CarteLienCompact />
    </div>
  );
}

// ── Récap de clôture ──────────────────────────────────────────────────────────
// Chiffres à LIRE (report compta / caisse). Rien n'est envoyé d'ici : les
// encaissements sont partis dans Mews à l'encaissement, un par règlement.
function RecapLigne({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? "border-t border-slate-200 mt-1 pt-2" : ""}`}>
      <span className={strong ? "text-sm font-bold text-slate-700" : "text-[13px] text-slate-500"}>{label}</span>
      <span className={`tabular-nums ${strong ? "text-base font-extrabold text-slate-900" : "text-[13px] font-semibold text-slate-700"}`}>{value}</span>
    </div>
  );
}

function ClotureRecapDialog({ open, onOpenChange, row, date }: {
  open: boolean; onOpenChange: (v: boolean) => void; row: ClotureRow | null; date: string;
}) {
  const r = row?.recap;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Récap du service · {date}</DialogTitle>
        </DialogHeader>
        {!r ? (
          <p className="text-sm text-slate-400 py-4 text-center">Aucun récap enregistré.</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Chiffre d&apos;affaires</div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-slate-500">{r.nbAdditions} addition{r.nbAdditions > 1 ? "s" : ""}</span>
                <span className="text-2xl font-extrabold tabular-nums text-slate-900">{euro(r.totalTtc)}</span>
              </div>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Par moyen de paiement</div>
              <RecapLigne label="CB" value={euro(r.parPaiement.cb)} />
              <RecapLigne label="Amex" value={euro(r.parPaiement.amex)} />
              <RecapLigne label="Espèces" value={euro(r.parPaiement.espece)} />
              <RecapLigne label="Transfert chambre" value={euro(r.parPaiement.chambre)} />
              <p className="text-[10px] text-slate-400 mt-1.5">
                CB, Amex et espèces sont déjà dans Mews (poussés à l&apos;encaissement). Le transfert chambre reste à passer à la main.
              </p>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">TVA collectée</div>
              <RecapLigne label="Base HT 10 %" value={euro(r.tva.ht10)} />
              <RecapLigne label="TVA 10 %" value={euro(r.tva.tva10)} />
              <RecapLigne label="Base HT 20 %" value={euro(r.tva.ht20)} />
              <RecapLigne label="TVA 20 %" value={euro(r.tva.tva20)} />
              <RecapLigne label="Total HT" value={euro(r.tva.totalHt)} />
              <RecapLigne label="Total TVA" value={euro(r.tva.totalTva)} />
              <RecapLigne label="Total TTC" value={euro(r.tva.totalTtc)} strong />
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Répartition des ventes</div>
              <RecapLigne label="Soft" value={euro(r.parType.soft)} />
              <RecapLigne label="Food" value={euro(r.parType.food)} />
              <RecapLigne label="Alcool" value={euro(r.parType.alcool)} />
              <p className="text-[10px] text-slate-400 mt-1.5">Une formule alcool compte moitié food, moitié alcool.</p>
            </div>

            {row?.closed_by_nom && (
              <p className="text-[11px] text-slate-400 text-center">
                Clôturé par {row.closed_by_nom} le {new Date(row.closed_at).toLocaleString("fr-FR")}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Sous-panneaux ─────────────────────────────────────────────────────────────
function PanelHead({ title, sub, right }: { title: string; sub: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
      <div><div className="text-xl font-extrabold text-slate-800">{title}</div><div className="text-xs text-slate-500 mt-0.5">{sub}</div></div>
      {right}
    </div>
  );
}

function TablePanel({ ti, freeTables, onWalkin, onReserve, onEditResa, onSeat, onUnseat, onNoShow, onCancelResa, onMoveResa }: {
  ti: TileInfo; freeTables: Table[]; onWalkin: () => void; onReserve: () => void; onEditResa: () => void;
  onSeat: () => void; onUnseat: () => void; onNoShow: () => void; onCancelResa: () => void; onMoveResa: (tableId: string) => void;
}) {
  const s = STATE_STYLE[ti.state];
  return (
    <div className="flex flex-col">
      <PanelHead title={ti.table.nom} sub={`${ti.table.couverts} couverts · ${s.label}`} />
      <div className="p-5 space-y-4">
        {ti.resa && (
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5 text-sm">
            <div className="font-semibold text-slate-800">{ti.resa.nom}</div>
            <div className="text-slate-500 mt-0.5">{ti.resa.heure} · {ti.resa.couverts} couverts{ti.resa.telephone ? ` · ${ti.resa.telephone}` : ""}</div>
            {ti.resa.email && <div className="text-slate-400 text-xs mt-0.5">{ti.resa.email}</div>}
            {ti.resa.message && <div className="text-slate-500 text-xs mt-1.5 italic">« {ti.resa.message} »</div>}
          </div>
        )}
        {ti.next && (
          <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-3 text-xs text-indigo-700">
            Prochaine réservation sur cette table à <b>{ti.next.heure}</b> — {ti.next.nom} ({ti.next.couverts})
          </div>
        )}
      </div>
      <div className="mt-auto p-4 border-t border-slate-100 space-y-2">
        {ti.state === "free" && (
          <div className="flex gap-2">
            <Button variant="brand" className="flex-1 h-12" onClick={onWalkin}>Ouvrir une note</Button>
            <Button variant="ghost" className={`flex-1 h-12 ${BTN_BLUE}`} onClick={onReserve}><CalendarPlus className="w-4 h-4 mr-1.5" />Réserver</Button>
          </div>
        )}
        {(ti.state === "reserved" || ti.state === "arrived") && (
          <>
            <Button variant="brand" className="w-full h-12" onClick={onSeat}><UserCheck className="w-4 h-4 mr-1.5" />{ti.state === "arrived" ? "Ouvrir la note" : "Installer & ouvrir la note"}</Button>
            {ti.state === "arrived" && (
              <Button variant="ghost" className={`w-full h-10 ${BTN_SOFT}`} onClick={onUnseat}>Marquer « non arrivé »</Button>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" className={`flex-1 h-10 ${BTN_SOFT}`} onClick={onEditResa}>Modifier la résa</Button>
              <Button variant="ghost" className={`flex-1 h-10 ${BTN_BLUE}`} onClick={onReserve}><CalendarPlus className="w-4 h-4 mr-1.5" />Autre créneau</Button>
            </div>
            {freeTables.length > 0 && (
              <SelectField value="" placeholder="Changer de table…" className="h-10"
                options={freeTables.map(ft => ({ value: ft.id, label: `${ft.nom} · ${ft.couverts} couv.` }))}
                onChange={onMoveResa} />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" className={`flex-1 h-10 ${BTN_SOFT}`} onClick={onCancelResa}>Annuler la résa</Button>
              <Button variant="ghost" className={`flex-1 h-10 ${BTN_ROSE}`} onClick={onNoShow}><UserX className="w-4 h-4 mr-1.5" />No-show</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OrderPanel(props: {
  siblings: Order[]; onSwitch: (o: Order) => void; onAddOrder: () => void; serviceClosed: boolean;
  table: Table | null; active: Order; items: OrderRow[]; menu: MenuItem[]; payments: Payment[];
  payMethod: PayMethod | null; setPayMethod: (m: PayMethod | null) => void;
  payAmount: string; setPayAmount: (s: string) => void; roomRef: string; setRoomRef: (s: string) => void;
  totalItems: number; paid: number; remaining: number; busy: boolean;
  facture: { clientNom: string; setClientNom: (s: string) => void; clientEmail: string; setClientEmail: (s: string) => void; invoicing: boolean; sendFacture: () => void };
  onBack: () => void; addLine: (mi: MenuItem) => void; changeQty: (r: OrderRow, d: number) => void; editPrice: (r: OrderRow, v: string) => void;
  addPayment: () => void; removePayment: (p: Payment) => void; cancelOrder: () => void;
}) {
  const { table, active, items, menu, payments, payMethod, setPayMethod, payAmount, setPayAmount, roomRef, setRoomRef, totalItems, paid, remaining, facture } = props;
  const METHODS: { k: PayMethod; label: string; icon: typeof CreditCard }[] = [
    { k: "cb", label: "CB", icon: CreditCard }, { k: "amex", label: "Amex", icon: CreditCard },
    { k: "espece", label: "Espèces", icon: Banknote }, { k: "chambre", label: "Chambre", icon: BedDouble },
  ];
  // Une addition soldée est un document comptable : plus aucune modification,
  // mais elle reste consultable et la facture reste renvoyable. Un service
  // clôturé verrouille tout pareil (le verrou dur est en base, migration 81).
  const locked = active.statut === "encaissee" || props.serviceClosed;
  return (
    <div className="flex flex-col max-h-[calc(100vh-120px)]">
      <PanelHead title={table?.nom ?? "Comptoir"} sub={active.couvert_nom || "Vente sur place"}
        right={<button onClick={props.onBack} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100"><ArrowLeft className="w-4 h-4" /></button>} />
      {locked && (
        <div className="flex items-center gap-2 px-5 py-2.5 bg-emerald-50 border-b border-emerald-100 text-[12px] font-semibold text-emerald-700">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          {active.statut === "encaissee"
            ? <>Encaissée{methodLabel(active) ? ` · ${methodLabel(active)}` : ""} — verrouillée</>
            : <>Service clôturé — caisse verrouillée</>}
        </div>
      )}
      {/* Additions séparées d'une même table : les onglets n'apparaissent qu'à
          partir de la 2ᵉ, pour ne pas charger le cas courant. */}
      {table && !locked && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-slate-100 bg-slate-50/60">
          {props.siblings.length > 1 && props.siblings.map((o, i) => (
            <button key={o.id} onClick={() => props.onSwitch(o)}
              className={`px-2.5 h-7 rounded-lg text-[11px] font-bold transition ${o.id === active.id ? "bg-white border border-slate-300 text-slate-800 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}>
              Add. {i + 1}
            </button>
          ))}
          <button onClick={props.onAddOrder}
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-[var(--brand)] hover:underline">
            <Plus className="w-3 h-3" /> {props.siblings.length > 1 ? "Addition" : "2ᵉ addition"}
          </button>
        </div>
      )}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Note */}
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Note</div>
          {items.length === 0 ? <div className="text-slate-400 text-sm py-3 text-center">{locked ? "Aucune ligne." : "Note vide — ajoute un article."}</div> : locked ? (
            <div className="divide-y divide-slate-50">
              {items.map(row => (
                <div key={row.id} className="flex items-center gap-2 py-2">
                  <span className="w-7 text-center text-sm tabular-nums text-slate-500">{row.qty}×</span>
                  <span className="flex-1 text-sm text-slate-700 truncate">{row.nom}</span>
                  <span className="text-sm font-semibold text-slate-700 tabular-nums">{euro(row.prix * row.qty)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {items.map(row => (
                <div key={row.id} className="flex items-center gap-2 py-2">
                  <button onClick={() => props.changeQty(row, -1)} className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50"><Minus className="w-3.5 h-3.5" /></button>
                  <span className="w-6 text-center font-bold tabular-nums text-sm">{row.qty}</span>
                  <button onClick={() => props.changeQty(row, 1)} className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50"><Plus className="w-3.5 h-3.5" /></button>
                  <span className="flex-1 text-sm text-slate-700 truncate">{row.nom}</span>
                  <input key={`${row.id}-${row.prix}`} defaultValue={String(row.prix)} onBlur={e => props.editPrice(row, e.target.value)}
                    className="w-16 h-8 text-right text-sm border border-slate-200 rounded-lg px-2 tabular-nums" />
                  <span className="text-xs text-slate-400">€</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Carte (quick-keys) */}
        {!locked && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Ajouter</div>
            <div className="grid grid-cols-2 gap-2">
              {menu.map((mi, i) => (
                <button key={i} onClick={() => props.addLine(mi)}
                  className="rounded-xl border border-slate-200 p-2.5 text-left hover:border-[var(--brand)] hover:bg-[var(--brand-bg)] transition">
                  <div className="text-[12.5px] font-semibold text-slate-700 leading-tight">{mi.nom}</div>
                  <div className="text-[11px] text-slate-400 tabular-nums mt-0.5">{euro(mi.prix)}</div>
                </button>
              ))}
            </div>
          </div>
        )}
        {/* Règlements déjà saisis */}
        {payments.length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Réglé</div>
            <div className="space-y-1.5">
              {payments.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 text-sm bg-emerald-50/60 rounded-lg px-3 py-1.5">
                  <span className="text-slate-600">{p.method === "chambre" ? `Chambre ${p.room_ref}` : (PAY_LABEL[p.method] ?? p.method.toUpperCase())}</span>
                  <span className="tabular-nums font-semibold">{euro(p.amount)}</span>
                  {!locked && <button onClick={() => props.removePayment(p)} className="text-slate-300 hover:text-rose-500"><X className="w-3.5 h-3.5" /></button>}
                </div>
              ))}
            </div>
          </div>
        )}
        {locked && (
          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-sm text-slate-500">Total</span>
            <span className="text-lg font-extrabold tabular-nums text-slate-900">{euro(Number(active.total) || totalItems)}</span>
          </div>
        )}
        {/* Facture par mail (PDF réglementaire) */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Facture</span>
            {active.numero && <span className="ml-auto text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">{active.numero} émise</span>}
          </div>
          <div className="space-y-2">
            <Input value={facture.clientNom} onChange={e => facture.setClientNom(e.target.value)} placeholder="Nom du client" className="h-10 text-sm" />
            <Input value={facture.clientEmail} onChange={e => facture.setClientEmail(e.target.value)} placeholder="Email du client" type="email" className="h-10 text-sm" />
            <Button onClick={facture.sendFacture} disabled={facture.invoicing || items.length === 0 || !facture.clientEmail.trim()} variant="brand" className="w-full h-10 gap-2">
              <Mail className="w-4 h-4" /> {active.numero ? "Renvoyer la facture" : "Éditer & envoyer la facture"}
            </Button>
            <p className="text-[10px] text-slate-400 text-center">TVA ventilée auto · PDF réglementaire joint au mail.</p>
          </div>
        </div>
      </div>
      {/* Pied encaissement — masqué sur une addition soldée */}
      {!locked && (
      <div className="border-t border-slate-100 p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-wide text-slate-500">{paid > 0 ? "Reste à payer" : "Total"}</span>
          <span className="text-2xl font-extrabold tabular-nums">{euro(paid > 0 ? remaining : totalItems)}</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {METHODS.map(m => (
            <button key={m.k} onClick={() => setPayMethod(m.k)}
              className={`rounded-lg border py-2 text-[11px] font-bold flex flex-col items-center gap-1 ${payMethod === m.k ? "border-[var(--brand)] bg-[var(--brand-bg)] text-[var(--brand)]" : "border-slate-200 text-slate-500"}`}>
              <m.icon className="w-4 h-4" />{m.label}
            </button>
          ))}
        </div>
        {payMethod === "chambre" && (
          <Input value={roomRef} onChange={e => setRoomRef(e.target.value)} placeholder="N° de chambre" className="h-10" />
        )}
        <div className="flex gap-2">
          <Input value={payAmount} onChange={e => setPayAmount(e.target.value)} inputMode="decimal"
            placeholder={`${remaining.toFixed(2)} (reste)`} className="h-12 flex-1 tabular-nums" />
          <Button variant="brand" className="h-12 px-5" disabled={props.busy || totalItems <= 0 || remaining <= 0 || !payMethod} onClick={props.addPayment}>
            Encaisser{remaining > 0 ? ` ${euro(round2(payAmount.trim() ? toNum(payAmount) : remaining))}` : ""}
          </Button>
        </div>
        <button onClick={props.cancelOrder} className="w-full text-xs text-slate-400 hover:text-rose-500 inline-flex items-center justify-center gap-1.5 pt-1">
          <Trash2 className="w-3.5 h-3.5" /> Supprimer l&apos;addition
        </button>
      </div>
      )}
    </div>
  );
}

function ReservePanel({ table, editing, form, setForm, services, onCancel, onSubmit, busy }: {
  table: Table; editing: boolean; form: { nom: string; tel: string; email: string; heure: string; couverts: number; message: string };
  setForm: (f: { nom: string; tel: string; email: string; heure: string; couverts: number; message: string }) => void;
  services: string[]; onCancel: () => void; onSubmit: () => void; busy: boolean;
}) {
  return (
    <div className="flex flex-col">
      <PanelHead title={table.nom} sub={editing ? "Modifier la réservation" : "Prise de réservation"}
        right={<button onClick={onCancel} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>} />
      <div className="p-5 space-y-3">
        <label className="block"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Nom *</span>
          <Input autoFocus value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })}
            onKeyDown={e => e.key === "Enter" && onSubmit()} placeholder="Nom du client" className="h-11 mt-1" /></label>
        <label className="block"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Email — confirmation</span>
          <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="client@email.com" className="h-11 mt-1" /></label>
        <div className="grid grid-cols-2 gap-3">
          {/* Heure LIBRE (walk-in, téléphone à toute heure) ; les services
              configurés ne sont que des suggestions. */}
          <label className="block"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Heure *</span>
            <Input type="time" list="rooftop-floor-slots" value={form.heure}
              onChange={e => setForm({ ...form, heure: e.target.value })} className="h-11 mt-1" />
            {services.length > 0 && (
              <datalist id="rooftop-floor-slots">{services.map(h => <option key={h} value={h} />)}</datalist>
            )}</label>
          <label className="block"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Couverts</span>
            <div className="flex items-center gap-2 mt-1">
              <button onClick={() => setForm({ ...form, couverts: Math.max(1, form.couverts - 1) })} className="w-11 h-11 rounded-lg border border-slate-200 text-slate-500"><Minus className="w-4 h-4 mx-auto" /></button>
              <span className="flex-1 text-center font-bold tabular-nums">{form.couverts}</span>
              <button onClick={() => setForm({ ...form, couverts: form.couverts + 1 })} className="w-11 h-11 rounded-lg border border-slate-200 text-slate-500"><Plus className="w-4 h-4 mx-auto" /></button>
            </div></label>
        </div>
        <label className="block"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Téléphone</span>
          <Input value={form.tel} onChange={e => setForm({ ...form, tel: e.target.value })} placeholder="06…" className="h-11 mt-1" /></label>
        <label className="block"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Note</span>
          <Input value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="Allergie, occasion…" className="h-11 mt-1" /></label>
        <div className="text-[11px] text-slate-400">Un mail de confirmation part au client dès validation.</div>
      </div>
      <div className="mt-auto p-4 border-t border-slate-100 flex gap-2">
        <Button variant="brand" className="flex-1 h-12" disabled={busy} onClick={onSubmit}>{editing ? "Enregistrer" : "Confirmer la réservation"}</Button>
        <Button variant="ghost" className={`h-12 px-4 ${BTN_SOFT}`} onClick={onCancel}>Annuler</Button>
      </div>
    </div>
  );
}
