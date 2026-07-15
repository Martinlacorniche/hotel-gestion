"use client";

// Plan de salle unifié Rooftop (Les Voiles) — fusionne Réservations + POS en un
// seul écran de service. Chaque table physique porte son cycle de vie
// (libre → réservée → arrivée/ouverte → encaissée), la prise de réservation, la
// note et l'encaissement se font au même endroit. Réutilise les tables/RPC/
// endpoints existants (rooftop_reservations, rooftop_tables, rooftop_orders +
// items + payments, RPC rooftop_book_staff, /api/rooftop/mews-payment,
// /api/rooftop/reservation-email). NE remplace PAS les onglets existants.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { confirmDialog } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { VOILES_ID } from "@/components/rooftop/RooftopEditors";
import { tvaTypeForCategorie, round2, type TvaType } from "@/lib/rooftopTva";
import toast from "react-hot-toast";
import {
  ChevronLeft, ChevronRight, Plus, Minus, Trash2, CreditCard, Banknote, BedDouble,
  CalendarPlus, Users, Clock, ArrowLeft, X, Check, UserCheck, UserX,
} from "lucide-react";

// ── Types (alignés sur PosTab / ResasTab) ─────────────────────────────────────
type Table = { id: string; nom: string; couverts: number; ordre: number };
type Resa = {
  id: string; nom: string; couverts: number; heure: string; telephone: string | null;
  email: string | null; message: string | null; table_id: string | null;
  presence: string | null; statut: string; date_resa: string;
};
type Order = {
  id: string; table_id: string | null; reservation_id: string | null;
  couvert_nom: string | null; statut: string; total: number;
};
const ORDER_COLS = "id,table_id,reservation_id,couvert_nom,statut,total";
type OrderRow = { id: string; source: string; ref_id: string | null; nom: string; prix: number; qty: number; tva_type: TvaType | null };
type Payment = { id: string; method: string; amount: number; room_ref: string | null; mews_payment_id?: string | null };
type MenuItem = { source: "plat" | "boisson"; ref_id: string | null; nom: string; prix: number; tvaType: TvaType };
type PayMethod = "cb" | "amex" | "espece" | "chambre";

type TState = "free" | "reserved" | "arrived" | "open";
type TileInfo = { table: Table; state: TState; order: Order | null; resa: Resa | null; next: Resa | null; total: number };

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

// Habillage par état (couleurs sémantiques, distinctes de l'accent charte).
const STATE_STYLE: Record<TState, { label: string; border: string; pill: string; dot: string }> = {
  free:     { label: "Libre",      border: "border-slate-200",   pill: "bg-slate-100 text-slate-500",     dot: "bg-slate-400" },
  reserved: { label: "Réservée",   border: "border-indigo-200",  pill: "bg-indigo-50 text-indigo-700",    dot: "bg-indigo-500" },
  arrived:  { label: "Arrivés",    border: "border-emerald-200", pill: "bg-emerald-50 text-emerald-700",  dot: "bg-emerald-500" },
  open:     { label: "Ouverte",    border: "border-emerald-300", pill: "bg-emerald-50 text-emerald-700",  dot: "bg-emerald-500" },
};

export function FloorTab({ hotelId }: { hotelId: string }) {
  const today = useMemo(todayStr, []);
  const [date, setDate] = useState(today);
  const barSlug = hotelId === VOILES_ID ? "rooftop" : "bar";

  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [resas, setResas] = useState<Resa[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderTotals, setOrderTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

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

  // Formulaire réservation
  const emptyForm = { nom: "", tel: "", email: "", heure: "20:00", couverts: 2, message: "" };
  const [form, setForm] = useState(emptyForm);
  const [reserveTableId, setReserveTableId] = useState<string | null>(null);

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

  // ── Tables + résas + additions du jour ──────────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true);
    const [{ data: tData }, { data: rData }, { data: oData }] = await Promise.all([
      supabase.from("rooftop_tables").select("id,nom,couverts,ordre").eq("hotel_id", hotelId).eq("actif", true).order("ordre"),
      supabase.from("rooftop_reservations").select("id,nom,couverts,heure,telephone,email,message,table_id,presence,statut,date_resa")
        .eq("hotel_id", hotelId).eq("date_resa", date).neq("statut", "annulee").order("heure"),
      supabase.from("rooftop_orders").select(ORDER_COLS).eq("hotel_id", hotelId).eq("date_service", date).order("created_at"),
    ]);
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
    setResas(((rData as Resa[]) || []).filter(r => r.presence !== "no_show"));
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
  const tiles: TileInfo[] = useMemo(() => tables.map(t => {
    const tResas = resas.filter(r => r.table_id === t.id);
    const order = orders.find(o => o.table_id === t.id && o.statut === "ouverte") || null;
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
    const total = order ? (orderTotals[order.id] || 0) : 0;
    return { table: t, state, order, resa, next, total };
  }), [tables, resas, orders, orderTotals]);

  const selected = tiles.find(t => t.table.id === selId) || null;
  const totalItems = items.reduce((s, i) => s + i.prix * i.qty, 0);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = round2(totalItems - paid);

  // ── Ouvrir / reprendre une note ─────────────────────────────────────────────
  const createOrder = async (fields: { table_id: string | null; reservation_id: string | null; couvert_nom: string | null }) => {
    setBusy(true);
    const { data, error } = await supabase.from("rooftop_orders").insert({ hotel_id: hotelId, date_service: date, ...fields }).select(ORDER_COLS).single();
    setBusy(false);
    if (error) { toast.error(error.message || "Erreur"); return; }
    const o = data as Order;
    setOrders(prev => [...prev, o]);
    setActive(o); setItems([]); setPayments([]); setPayMethod(null); setPayAmount(""); setRoomRef("");
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
  };

  const closeActive = () => { setActive(null); setItems([]); setPayments([]); setPayMethod(null); setPayAmount(""); setRoomRef(""); };

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
    if (!active) return;
    if (!payMethod) { toast.error("Choisir un mode de paiement"); return; }
    if (payMethod === "chambre" && !roomRef.trim()) { toast.error("N° de chambre requis pour le transfert"); return; }
    const amt = round2(payAmount.trim() ? toNum(payAmount) : remaining);
    if (amt <= 0) { toast.error("Montant invalide"); return; }
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

  // ── Réservation (RPC forçage + email de confirmation) ───────────────────────
  const markPresence = async (r: Resa, value: "arrive" | null) => {
    setResas(prev => prev.map(x => x.id === r.id ? { ...x, presence: value } : x));
    const { error } = await supabase.from("rooftop_reservations").update({ presence: value }).eq("id", r.id);
    if (error) toast.error("Erreur");
  };

  const markNoShow = async (r: Resa) => {
    if (!(await confirmDialog(`Marquer ${r.nom} en no-show et l'ajouter à la blacklist ?`))) return;
    await supabase.from("rooftop_reservations").update({ presence: "no_show" }).eq("id", r.id);
    const { error: blErr } = await supabase.from("rooftop_blacklist").insert({
      hotel_id: hotelId, email: r.email || null, nom: r.nom || null,
      motif: `No-show ${date}`,
    });
    if (blErr) toast.error("No-show pointé, mais blacklist non enregistrée");
    else toast.success("No-show → client blacklisté 🚫");
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

  const openReserve = (t: Table) => {
    setReserveTableId(t.id);
    setForm({ ...emptyForm, couverts: t.couverts });
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

  // ── Clôture (sécurisée : bloque s'il reste à encaisser, ne supprime rien) ────
  const cloture = async () => {
    const open = orders.filter(o => o.statut === "ouverte");
    const aEncaisser = open.filter(o => (orderTotals[o.id] || 0) > 0);
    if (aEncaisser.length) {
      toast.error(`Clôture impossible : ${aEncaisser.length} table(s) encore à encaisser. Encaisse-les d'abord — rien n'est supprimé.`, { duration: 6000 });
      return;
    }
    const encaissees = orders.filter(o => o.statut === "encaissee");
    const ca = encaissees.reduce((s, o) => s + (orderTotals[o.id] || 0), 0);
    toast.success(`Service clôturé · ${encaissees.length} addition(s) · ${euro(ca)}. Règlements déjà remontés dans Mews.`, { duration: 6000 });
  };

  // ── Rendu ───────────────────────────────────────────────────────────────────
  const selTile = selected;

  return (
    <div className="space-y-5">
      {/* Barre service */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Service</span>
          <button onClick={() => shiftDate(-1)} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><ChevronLeft className="w-4 h-4" /></button>
          <input type="date" value={date} onChange={e => setDate(e.target.value || today)} className="border rounded-lg px-2 h-10 text-sm bg-white" />
          <button onClick={() => shiftDate(1)} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><ChevronRight className="w-4 h-4" /></button>
          {date !== today && <button onClick={() => setDate(today)} className="text-xs font-semibold text-[var(--brand)] ml-1">Aujourd&apos;hui</button>}
        </div>
        <button onClick={cloture} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 h-10 text-sm font-semibold text-slate-600 hover:bg-slate-50">
          <Check className="w-4 h-4" /> Clôture du service
        </button>
      </div>

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
                    className={`text-left rounded-2xl border bg-white p-4 min-h-[116px] flex flex-col gap-2 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${sel ? "border-slate-900 ring-2 ring-slate-900" : s.border}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-[10.5px] font-extrabold uppercase tracking-wide text-slate-400 leading-tight break-words">{ti.table.nom}</span>
                      <span className={`shrink-0 whitespace-nowrap text-[9.5px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full inline-flex items-center gap-1.5 ${s.pill}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
                      </span>
                    </div>
                    {ti.state === "open" ? (
                      <>
                        <div className="text-[15px] font-bold text-slate-800 leading-tight line-clamp-2 break-words">{ti.order?.couvert_nom || "Sur place"}</div>
                        <div className="mt-auto flex items-end justify-between gap-2">
                          <span className="text-xs text-slate-400 inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" />{ti.table.couverts}</span>
                          <span className="text-[18px] font-extrabold tabular-nums text-slate-900">{euro(ti.total)}</span>
                        </div>
                      </>
                    ) : ti.resa ? (
                      <>
                        <div className="text-[15px] font-bold text-slate-800 leading-tight line-clamp-2 break-words">{ti.resa.nom}</div>
                        <div className="mt-auto text-xs text-slate-400 inline-flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" />{ti.resa.heure} · {ti.resa.couverts} couv.
                        </div>
                      </>
                    ) : (
                      <div className="mt-auto text-xs text-slate-300">Disponible</div>
                    )}
                    {ti.next && <div className="text-[9.5px] font-bold text-indigo-500 inline-flex items-center gap-1 bg-indigo-50 self-start px-2 py-0.5 rounded-full"><Clock className="w-2.5 h-2.5" /> suite {ti.next.heure}</div>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Volet table */}
        <aside className="rounded-2xl border border-slate-200 bg-white overflow-hidden lg:sticky lg:top-4">
          {!selTile ? (
            <div className="p-10 text-center text-slate-400 text-sm">Touche une table pour la piloter.</div>
          ) : mode === "reserve" ? (
            <ReservePanel table={selTile.table} form={form} setForm={setForm} onCancel={() => setMode("none")} onSubmit={submitReserve} busy={busy} />
          ) : active ? (
            <OrderPanel
              table={selTile.table} active={active} items={items} menu={menu}
              payments={payments} payMethod={payMethod} setPayMethod={setPayMethod}
              payAmount={payAmount} setPayAmount={setPayAmount} roomRef={roomRef} setRoomRef={setRoomRef}
              totalItems={totalItems} paid={paid} remaining={remaining} busy={busy}
              onBack={() => { closeActive(); }} addLine={addLine} changeQty={changeQty} editPrice={editPrice}
              addPayment={addPayment} removePayment={removePayment} cancelOrder={cancelOrder}
            />
          ) : (
            <TablePanel ti={selTile}
              onWalkin={() => openWalkin(selTile.table)}
              onReserve={() => openReserve(selTile.table)}
              onSeat={() => selTile.resa && openFromResa(selTile.resa)}
              onNoShow={() => selTile.resa && markNoShow(selTile.resa)}
              onCancelResa={() => selTile.resa && cancelResa(selTile.resa)}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

// ── Sous-panneaux ─────────────────────────────────────────────────────────────
function PanelHead({ table, sub, right }: { table: Table; sub: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
      <div><div className="text-xl font-extrabold text-slate-800">{table.nom}</div><div className="text-xs text-slate-500 mt-0.5">{sub}</div></div>
      {right}
    </div>
  );
}

function TablePanel({ ti, onWalkin, onReserve, onSeat, onNoShow, onCancelResa }: {
  ti: TileInfo; onWalkin: () => void; onReserve: () => void; onSeat: () => void; onNoShow: () => void; onCancelResa: () => void;
}) {
  const s = STATE_STYLE[ti.state];
  return (
    <div className="flex flex-col">
      <PanelHead table={ti.table} sub={`${ti.table.couverts} couverts · ${s.label}`} />
      <div className="p-5 space-y-4">
        {ti.resa && (
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5 text-sm">
            <div className="font-semibold text-slate-800">{ti.resa.nom}</div>
            <div className="text-slate-500 mt-0.5">{ti.resa.heure} · {ti.resa.couverts} couverts{ti.resa.telephone ? ` · ${ti.resa.telephone}` : ""}</div>
            {ti.resa.email && <div className="text-slate-400 text-xs mt-0.5">{ti.resa.email}</div>}
            {ti.resa.message && <div className="text-slate-500 text-xs mt-1.5 italic">« {ti.resa.message} »</div>}
          </div>
        )}
      </div>
      <div className="mt-auto p-4 border-t border-slate-100 space-y-2">
        {ti.state === "free" && (
          <div className="flex gap-2">
            <Button variant="brand" className="flex-1 h-12" onClick={onWalkin}>Ouvrir une note</Button>
            <Button className="flex-1 h-12 bg-indigo-600 hover:bg-indigo-700 text-white" onClick={onReserve}><CalendarPlus className="w-4 h-4 mr-1.5" />Réserver</Button>
          </div>
        )}
        {(ti.state === "reserved" || ti.state === "arrived") && (
          <>
            <Button variant="brand" className="w-full h-12" onClick={onSeat}><UserCheck className="w-4 h-4 mr-1.5" />Installer & ouvrir la note</Button>
            <div className="flex gap-2">
              <Button className="flex-1 h-10 bg-slate-100 hover:bg-slate-200 text-slate-600" onClick={onCancelResa}>Annuler la résa</Button>
              <Button className="flex-1 h-10 bg-rose-50 hover:bg-rose-100 text-rose-600" onClick={onNoShow}><UserX className="w-4 h-4 mr-1.5" />No-show</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OrderPanel(props: {
  table: Table; active: Order; items: OrderRow[]; menu: MenuItem[]; payments: Payment[];
  payMethod: PayMethod | null; setPayMethod: (m: PayMethod | null) => void;
  payAmount: string; setPayAmount: (s: string) => void; roomRef: string; setRoomRef: (s: string) => void;
  totalItems: number; paid: number; remaining: number; busy: boolean;
  onBack: () => void; addLine: (mi: MenuItem) => void; changeQty: (r: OrderRow, d: number) => void; editPrice: (r: OrderRow, v: string) => void;
  addPayment: () => void; removePayment: (p: Payment) => void; cancelOrder: () => void;
}) {
  const { table, items, menu, payments, payMethod, setPayMethod, payAmount, setPayAmount, roomRef, setRoomRef, totalItems, paid, remaining } = props;
  const METHODS: { k: PayMethod; label: string; icon: typeof CreditCard }[] = [
    { k: "cb", label: "CB", icon: CreditCard }, { k: "amex", label: "Amex", icon: CreditCard },
    { k: "espece", label: "Espèces", icon: Banknote }, { k: "chambre", label: "Chambre", icon: BedDouble },
  ];
  return (
    <div className="flex flex-col max-h-[calc(100vh-120px)]">
      <PanelHead table={table} sub={props.active.couvert_nom || "Sur place"}
        right={<button onClick={props.onBack} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100"><ArrowLeft className="w-4 h-4" /></button>} />
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Note */}
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Note</div>
          {items.length === 0 ? <div className="text-slate-400 text-sm py-3 text-center">Note vide — ajoute un article.</div> : (
            <div className="divide-y divide-slate-100">
              {items.map(row => (
                <div key={row.id} className="flex items-center gap-2 py-2">
                  <button onClick={() => props.changeQty(row, -1)} className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50"><Minus className="w-3.5 h-3.5" /></button>
                  <span className="w-6 text-center font-bold tabular-nums text-sm">{row.qty}</span>
                  <button onClick={() => props.changeQty(row, 1)} className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50"><Plus className="w-3.5 h-3.5" /></button>
                  <span className="flex-1 text-sm text-slate-700 truncate">{row.nom}</span>
                  <input defaultValue={String(row.prix)} onBlur={e => props.editPrice(row, e.target.value)}
                    className="w-16 h-8 text-right text-sm border border-slate-200 rounded-lg px-2 tabular-nums" />
                  <span className="text-xs text-slate-400">€</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Carte (quick-keys) */}
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
        {/* Règlements déjà saisis */}
        {payments.length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Réglé</div>
            <div className="space-y-1.5">
              {payments.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 text-sm bg-emerald-50/60 rounded-lg px-3 py-1.5">
                  <span className="text-slate-600">{p.method === "chambre" ? `Chambre ${p.room_ref}` : p.method.toUpperCase()}</span>
                  <span className="tabular-nums font-semibold">{euro(p.amount)}</span>
                  <button onClick={() => props.removePayment(p)} className="text-slate-300 hover:text-rose-500"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {/* Pied encaissement */}
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
          <Button variant="brand" className="h-12 px-5" disabled={props.busy || totalItems <= 0} onClick={props.addPayment}>Encaisser</Button>
        </div>
        <button onClick={props.cancelOrder} className="w-full text-xs text-slate-400 hover:text-rose-500 inline-flex items-center justify-center gap-1.5 pt-1">
          <Trash2 className="w-3.5 h-3.5" /> Supprimer l&apos;addition
        </button>
      </div>
    </div>
  );
}

function ReservePanel({ table, form, setForm, onCancel, onSubmit, busy }: {
  table: Table; form: { nom: string; tel: string; email: string; heure: string; couverts: number; message: string };
  setForm: (f: { nom: string; tel: string; email: string; heure: string; couverts: number; message: string }) => void;
  onCancel: () => void; onSubmit: () => void; busy: boolean;
}) {
  return (
    <div className="flex flex-col">
      <PanelHead table={table} sub="Prise de réservation"
        right={<button onClick={onCancel} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>} />
      <div className="p-5 space-y-3">
        <label className="block"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Nom *</span>
          <Input value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })} placeholder="Nom du client" className="h-11 mt-1" /></label>
        <label className="block"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Email — confirmation</span>
          <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="client@email.com" className="h-11 mt-1" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Heure *</span>
            <Input type="time" value={form.heure} onChange={e => setForm({ ...form, heure: e.target.value })} className="h-11 mt-1" /></label>
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
        <Button variant="brand" className="flex-1 h-12" disabled={busy} onClick={onSubmit}>Confirmer la réservation</Button>
        <Button className="h-12 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600" onClick={onCancel}>Annuler</Button>
      </div>
    </div>
  );
}
