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
import { ArrowLeft, Plus, Minus, CreditCard, Banknote, BedDouble, Users, Utensils, Lock, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

// ── Types ────────────────────────────────────────────────────────────────────
type MenuItem = { source: "plat" | "boisson"; ref_id: string; nom: string; prix: number };
type MenuGroup = { key: string; label: string; items: MenuItem[] };
type OrderRow = { id: string; source: string; ref_id: string | null; nom: string; prix: number; qty: number };
type Order = {
  id: string; table_id: string | null; reservation_id: string | null;
  couvert_nom: string | null; statut: string; total: number;
  payment_method: string | null; room_ref: string | null;
};
const ORDER_COLS = "id,table_id,reservation_id,couvert_nom,statut,total,payment_method,room_ref";
type ResaLite = { id: string; nom: string; couverts: number; heure: string; table_id: string | null; presence: string | null };

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
  const [resas, setResas] = useState<ResaLite[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  // Commande en cours
  const [active, setActive] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderRow[]>([]);
  const [payMethod, setPayMethod] = useState<"tpe" | "espece" | "chambre" | null>(null);
  const [roomRef, setRoomRef] = useState("");
  const [busy, setBusy] = useState(false);

  // ── Chargement de la carte (une fois) ──────────────────────────────────────
  useEffect(() => {
    Promise.all([
      supabase.from("rooftop_plats").select("id,section,nom,prix,ordre,actif").eq("hotel_id", hotelId).eq("actif", true).order("ordre"),
      supabase.from("wifi_bar").select("id,categorie,nom,ordre,actif").eq("hotel_id", hotelId).eq("actif", true).order("ordre"),
      supabase.from("wifi_tiles").select("config").eq("slug", barSlug).eq("hotel_id", hotelId).maybeSingle(),
    ]).then(([{ data: plats }, { data: bar }, { data: tile }]) => {
      const groups: MenuGroup[] = [];
      // Plats
      const platsBy = (sec: string) => ((plats as { id: string; section: string; nom: string; prix: string | null }[]) || [])
        .filter(p => p.section === sec)
        .map(p => ({ source: "plat" as const, ref_id: p.id, nom: p.nom, prix: toNum(p.prix) }));
      const sale = platsBy("sale"), sucre = platsBy("sucre");
      if (sale.length) groups.push({ key: "sale", label: "🍽️ Salé", items: sale });
      if (sucre.length) groups.push({ key: "sucre", label: "🍨 Sucré", items: sucre });
      // Boissons : prix par catégorie (config.categories_prix)
      const cfg = (tile?.config ?? {}) as { categories_prix?: Record<string, string>; categories_ordre?: string[]; categories_masquees?: string[] };
      const catPrix = cfg.categories_prix ?? {};
      const masquees = new Set(cfg.categories_masquees ?? []);
      const barItems = (bar as { id: string; categorie: string; nom: string }[]) || [];
      const cats = [...new Set([...(cfg.categories_ordre ?? []), ...barItems.map(b => b.categorie)])];
      for (const cat of cats) {
        if (masquees.has(cat)) continue;
        const list = barItems.filter(b => b.categorie === cat);
        if (!list.length) continue;
        const prix = toNum(catPrix[cat]);
        groups.push({
          key: `bar-${cat}`,
          label: `🥂 ${cat}${prix ? ` · ${euro(prix)}` : ""}`,
          items: list.map(b => ({ source: "boisson" as const, ref_id: b.id, nom: b.nom, prix })),
        });
      }
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
      ((tData as { id: string; nom: string }[]) || []).forEach(t => { tmap[t.id] = t.nom; });
      setTables(tmap);
      setResas(((rData as ResaLite[]) || []).filter(r => r.presence !== "no_show"));
      setOrders((oData as Order[]) || []);
      setLoading(false);
    });
  }, [hotelId, date]);

  useEffect(() => { reload(); }, [reload]);

  const total = items.reduce((s, i) => s + i.prix * i.qty, 0);

  // ── Ouvrir / reprendre une addition ─────────────────────────────────────────
  const openOrder = async (resa: ResaLite | null) => {
    setBusy(true);
    const { data, error } = await supabase.from("rooftop_orders").insert({
      hotel_id: hotelId, date_service: date,
      table_id: resa?.table_id ?? null, reservation_id: resa?.id ?? null,
      couvert_nom: resa?.nom ?? null,
    }).select(ORDER_COLS).single();
    setBusy(false);
    if (error) { toast.error(error.message || "Erreur"); return; }
    setOrders(prev => [...prev, data as Order]);
    setActive(data as Order); setItems([]); setPayMethod(null);
  };

  const reopenOrder = async (order: Order) => {
    setBusy(true);
    const { data } = await supabase.from("rooftop_order_items")
      .select("id,source,ref_id,nom,prix,qty").eq("order_id", order.id).order("created_at");
    setBusy(false);
    setItems(((data as OrderRow[]) || []).map(r => ({ ...r, prix: Number(r.prix) })));
    setActive(order); setPayMethod(null);
  };

  // ── Lignes de commande (persistées à chaque geste) ──────────────────────────
  const addLine = async (mi: MenuItem) => {
    if (!active || active.statut === "encaissee") return;
    const existing = items.find(i => i.source === mi.source && i.ref_id === mi.ref_id && i.nom === mi.nom);
    if (existing) { await changeQty(existing, 1); return; }
    const { data, error } = await supabase.from("rooftop_order_items").insert({
      order_id: active.id, source: mi.source, ref_id: mi.ref_id, nom: mi.nom, prix: mi.prix, qty: 1,
    }).select("id,source,ref_id,nom,prix,qty").single();
    if (error) { toast.error("Erreur"); return; }
    setItems(prev => [...prev, { ...(data as OrderRow), prix: Number((data as OrderRow).prix) }]);
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

  // ── Encaissement (coquille : on enregistre la méthode) ──────────────────────
  const encaisser = async () => {
    if (!active || !payMethod) return;
    if (payMethod === "chambre" && !roomRef.trim()) { toast.error("N° de chambre requis pour le transfert"); return; }
    const label = payMethod === "tpe" ? "TPE (carte)" : payMethod === "espece" ? "Espèces" : `Transfert chambre ${roomRef.trim()}`;
    if (!(await confirmDialog(`Encaisser ${euro(total)} — ${label} ?`))) return;
    setBusy(true);
    const { error } = await supabase.from("rooftop_orders").update({
      statut: "encaissee", payment_method: payMethod,
      room_ref: payMethod === "chambre" ? roomRef.trim() : null,
      total, closed_at: new Date().toISOString(),
    }).eq("id", active.id);
    setBusy(false);
    if (error) { toast.error(error.message || "Erreur"); return; }
    setOrders(prev => prev.map(o => o.id === active.id ? { ...o, statut: "encaissee", total } : o));
    toast.success(`Encaissé · ${label} ✓`);
    setActive(null); setItems([]); setPayMethod(null); setRoomRef("");
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

  const closeActive = () => { setActive(null); setItems([]); setPayMethod(null); setRoomRef(""); };

  const orderByResa = new Map<string, Order>();
  orders.forEach(o => { if (o.reservation_id) orderByResa.set(o.reservation_id, o); });
  const walkinOrders = orders.filter(o => !o.reservation_id);

  // ════════════════════════════════════════════════════════════════════════════
  // VUE COMMANDE (table ouverte)
  // ════════════════════════════════════════════════════════════════════════════
  if (active) {
    const tableNom = active.table_id ? tables[active.table_id] : null;
    const locked = active.statut === "encaissee";
    const methodLabel = active.payment_method === "tpe" ? "TPE (carte)"
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
                      <button key={`${mi.source}-${mi.ref_id}`} onClick={() => addLine(mi)}
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
                        <p className="text-[11px] text-slate-400 tabular-nums">{euro(i.prix)}</p>
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
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-slate-500">Total</span>
                  <span className="text-lg font-bold text-[#013a5c] tabular-nums">{euro(total)}</span>
                </div>

                {/* Méthodes d'encaissement */}
                <div className="grid grid-cols-3 gap-2">
                  <MethodBtn active={payMethod === "tpe"} onClick={() => setPayMethod("tpe")} icon={<CreditCard size={16} />} label="TPE" />
                  <MethodBtn active={payMethod === "espece"} onClick={() => setPayMethod("espece")} icon={<Banknote size={16} />} label="Espèces" />
                  <MethodBtn active={payMethod === "chambre"} onClick={() => setPayMethod("chambre")} icon={<BedDouble size={16} />} label="Chambre" />
                </div>
                {payMethod === "chambre" && (
                  <Input value={roomRef} onChange={e => setRoomRef(e.target.value)} placeholder="N° de chambre"
                    className="h-11 text-sm mt-2" />
                )}

                <Button onClick={encaisser} disabled={busy || items.length === 0 || !payMethod}
                  className="w-full mt-3 h-12 text-[15px] bg-[#004e7c] hover:bg-[#003d61] text-white active:scale-[0.98]">
                  Encaisser {euro(total)}
                </Button>
                <p className="mt-2 text-[10px] text-slate-400 text-center">
                  Coquille : la méthode est enregistrée, aucun débit ni envoi Mews pour l&apos;instant. Une fois encaissée, l&apos;addition est verrouillée.
                </p>
              </div>
            </div>
          </div>
        )}
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
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Service du</span>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-10 w-44 text-sm" />
        </div>
        <Button onClick={() => openOrder(null)} disabled={busy} className="h-11 bg-[#004e7c] hover:bg-[#003d61] text-white gap-1 active:scale-[0.97]">
          <Plus size={14} /> Vente au comptoir
        </Button>
      </div>

      {loading ? (
        <p className="text-center text-sm text-slate-400 py-6">Chargement…</p>
      ) : (
        <>
          {/* Réservations du jour */}
          {resas.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-6">Aucune réservation ce jour-là.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {resas.map(r => {
                const order = orderByResa.get(r.id);
                const tableNom = r.table_id ? tables[r.table_id] : null;
                const encaissee = order?.statut === "encaissee";
                return (
                  <button key={r.id} disabled={busy}
                    onClick={() => order ? reopenOrder(order) : openOrder(r)}
                    className={`text-left rounded-2xl border p-4 min-h-[100px] shadow-sm transition active:scale-[0.98] ${
                      encaissee ? "border-slate-200 bg-slate-50 opacity-70"
                        : order ? "border-emerald-300 bg-emerald-50 hover:shadow-md"
                        : "border-slate-200 bg-white hover:-translate-y-0.5 hover:shadow-md hover:border-[#004e7c]/40"}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{tableNom || "Sans table"}</span>
                      {encaissee ? <span className="text-[10px] font-medium text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">Encaissée</span>
                        : order ? <span className="text-[10px] font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">Ouverte</span>
                        : <span className="text-[10px] font-medium text-[#004e7c] bg-blue-50 px-2 py-0.5 rounded-full">Ouvrir</span>}
                    </div>
                    <p className="mt-1.5 font-semibold text-[14px] text-slate-700 leading-tight truncate">{r.nom}</p>
                    <p className="mt-0.5 text-[12px] text-slate-400 tabular-nums flex items-center gap-1">
                      {r.heure} · <Users size={11} /> {r.couverts}
                      {order && order.total > 0 && <span className="ml-auto font-medium text-slate-600">{euro(Number(order.total))}</span>}
                    </p>
                  </button>
                );
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
                    <button key={o.id} disabled={busy} onClick={() => reopenOrder(o)}
                      className={`text-left rounded-2xl border p-4 min-h-[100px] shadow-sm transition active:scale-[0.98] ${encaissee ? "border-slate-200 bg-slate-50 opacity-70" : "border-emerald-300 bg-emerald-50 hover:shadow-md"}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Comptoir</span>
                        {encaissee ? <span className="text-[10px] font-medium text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">Encaissée</span>
                          : <span className="text-[10px] font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">Ouverte</span>}
                      </div>
                      <p className="mt-1.5 text-[12px] text-slate-400 tabular-nums">{o.total > 0 ? euro(Number(o.total)) : "—"}</p>
                    </button>
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
