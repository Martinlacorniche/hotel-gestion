"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ThemedBackground } from "@/components/ThemedBackground";
import { PageHeader } from "@/components/PageHeader";
import { confirmDialog } from "@/components/ConfirmDialog";
import { useAuth } from "@/context/AuthContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Martini, Plus, Trash2, CalendarX2, Users, Ban, Armchair, Check, Clock, X, ChevronLeft, ChevronRight, ChevronDown, BarChart3, CreditCard, Banknote, BedDouble } from "lucide-react";
import { ventileAll, totauxFromBuckets, round2, type TvaType, type TvaTotaux } from "@/lib/rooftopTva";
import toast from "react-hot-toast";
import { RooftopCarteTab, BlacklistTab, CarteLienPublic, VOILES_ID } from "@/components/rooftop/RooftopEditors";
import { PosTab } from "@/components/rooftop/RooftopPos";
import { FichesTab } from "@/components/rooftop/RooftopFiches";

export default function RooftopPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [user, authLoading, router]);

  if (authLoading || !user) return null;

  return (
    <div className="min-h-screen">
      <ThemedBackground />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <PageHeader
          icon={Martini}
          title="Rooftop"
          subtitle="Les Voiles · Réservations, carte & réglages"
          iconClassName="bg-amber-50 text-amber-700"
        />

        <Tabs defaultValue="resas">
          <TabsList className="w-full mb-6">
            <TabsTrigger value="resas" className="flex-1">Réservations</TabsTrigger>
            <TabsTrigger value="pos" className="flex-1">POS</TabsTrigger>
            <TabsTrigger value="fiches" className="flex-1">Fiches</TabsTrigger>
            <TabsTrigger value="carte" className="flex-1">Carte</TabsTrigger>
            <TabsTrigger value="gestion" className="flex-1">Gestion</TabsTrigger>
            <TabsTrigger value="reglages" className="flex-1">Réglages</TabsTrigger>
          </TabsList>

          <TabsContent value="resas"><ResasTab hotelId={VOILES_ID} /></TabsContent>
          <TabsContent value="pos"><PosTab hotelId={VOILES_ID} /></TabsContent>
          <TabsContent value="fiches"><FichesTab hotelId={VOILES_ID} /></TabsContent>
          <TabsContent value="carte"><RooftopCarteTab hotelId={VOILES_ID} /></TabsContent>
          <TabsContent value="gestion"><GestionTab hotelId={VOILES_ID} /></TabsContent>
          <TabsContent value="reglages"><ReglagesTab hotelId={VOILES_ID} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers date
// ─────────────────────────────────────────────────────────────
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDate(s: string): string {
  try {
    return new Date(`${s}T00:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  } catch { return s; }
}

// ─────────────────────────────────────────────────────────────
// TAB RÉSERVATIONS — plan de salle (bulles) du jour
// ─────────────────────────────────────────────────────────────
type Resa = {
  id: string;
  date_resa: string;
  heure: string;
  couverts: number;
  nom: string;
  telephone: string | null;
  email: string | null;
  message: string | null;
  statut: string;
  table_id: string | null;
  presence: string | null;
};
type ActiveTable = { id: string; nom: string; couverts: number; ordre: number };

function ResasTab({ hotelId }: { hotelId: string }) {
  const today = useMemo(todayStr, []);
  const [date, setDate] = useState(today);
  const [resas, setResas] = useState<Resa[]>([]);
  const [tables, setTables] = useState<ActiveTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [openTable, setOpenTable] = useState<string | null>(null);
  const [closedPeriods, setClosedPeriods] = useState<{ debut: string; fin: string }[]>([]);
  const [services, setServices] = useState<string[]>([]);

  // Édition de la note sur une résa existante (brouillon par résa + id en cours d'enregistrement).
  const [noteEdits, setNoteEdits] = useState<Record<string, string>>({});
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);

  // Création d'une résa au clic sur une table libre
  const [bookingTable, setBookingTable] = useState<string | null>(null);
  const emptyForm = { nom: "", couverts: "2", heure: "", tel: "", email: "", message: "" };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // Réservations + tables du jour
  useEffect(() => {
    setLoading(true);
    setOpenTable(null);
    setBookingTable(null);
    Promise.all([
      supabase.from("rooftop_reservations").select("*").eq("hotel_id", hotelId).eq("date_resa", date).order("heure"),
      supabase.from("rooftop_tables").select("id,nom,couverts,ordre").eq("hotel_id", hotelId).eq("actif", true).order("ordre"),
    ]).then(([{ data: rData }, { data: tData }]) => {
      setResas((rData as Resa[]) || []);
      setTables((tData as ActiveTable[]) || []);
      setLoading(false);
    });
  }, [hotelId, date]);

  // Jours fermés (pour la bannière) + heures de service (pour le formulaire)
  useEffect(() => {
    supabase.from("rooftop_closures").select("date_debut,date_fin").eq("hotel_id", hotelId)
      .then(({ data }) => setClosedPeriods(((data as { date_debut: string; date_fin: string }[]) || []).map(c => ({ debut: c.date_debut, fin: c.date_fin }))));
    supabase.from("rooftop_services").select("heure").eq("hotel_id", hotelId).eq("actif", true).order("ordre")
      .then(({ data }) => setServices(((data as { heure: string | null }[]) || []).map(s => (s.heure || "").trim()).filter(Boolean)));
  }, [hotelId]);

  // Occupation : table → réservation active
  const resaByTable = new Map<string, Resa>();
  resas.filter(r => r.statut !== "annulee" && r.table_id).forEach(r => resaByTable.set(r.table_id as string, r));

  const reservedCount = tables.filter(t => resaByTable.has(t.id)).length;
  const couvertsReserved = tables.reduce((s, t) => s + (resaByTable.has(t.id) ? (resaByTable.get(t.id)!.couverts || 0) : 0), 0);
  const freeTables = tables.filter(t => !resaByTable.has(t.id));
  const aPlacer = resas.filter(r => r.statut !== "annulee" && (!r.table_id || !tables.some(t => t.id === r.table_id)));
  const dayClosed = closedPeriods.some(p => date >= p.debut && date <= p.fin);
  const shiftDate = (delta: number) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + delta);
    setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  };

  const cancelResa = async (r: Resa) => {
    if (!(await confirmDialog(`Annuler la réservation de ${r.nom} ?`))) return;
    setResas(prev => prev.map(x => x.id === r.id ? { ...x, statut: "annulee" } : x));
    setOpenTable(null);
    await supabase.from("rooftop_reservations").update({ statut: "annulee" }).eq("id", r.id);
    toast.success("Réservation annulée");
    // Proposer de prévenir le client par email.
    if (r.email && await confirmDialog(`Prévenir ${r.email} de l'annulation par email ?`)) {
      fetch("/api/rooftop/cancel-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nom: r.nom, email: r.email, date: r.date_resa, heure: r.heure, couverts: r.couverts }),
      })
        .then(res => res.ok ? toast.success("Client prévenu par email") : toast.error("Mail non envoyé"))
        .catch(() => toast.error("Mail non envoyé"));
    }
  };

  const reassignResa = async (r: Resa, tableId: string) => {
    setResas(prev => prev.map(x => x.id === r.id ? { ...x, table_id: tableId } : x));
    setOpenTable(tableId);
    const { error } = await supabase.from("rooftop_reservations").update({ table_id: tableId }).eq("id", r.id);
    if (error) { toast.error("Erreur"); return; }
    toast.success("Table changée ✓");
  };

  // Pointe le client comme arrivé (ou annule le pointage).
  const markPresence = async (r: Resa, value: "arrive" | null) => {
    setResas(prev => prev.map(x => x.id === r.id ? { ...x, presence: value } : x));
    const { error } = await supabase.from("rooftop_reservations").update({ presence: value }).eq("id", r.id);
    if (error) { toast.error("Erreur"); return; }
    toast.success(value === "arrive" ? "Client pointé arrivé ✓" : "Pointage retiré");
  };

  // No-show : pointe le lapin ET bascule le client en blacklist.
  const markNoShow = async (r: Resa) => {
    if (!(await confirmDialog(`Marquer ${r.nom} en no-show et l'ajouter à la blacklist ?`))) return;
    setResas(prev => prev.map(x => x.id === r.id ? { ...x, presence: "no_show" } : x));
    setOpenTable(null);
    const { error } = await supabase.from("rooftop_reservations").update({ presence: "no_show" }).eq("id", r.id);
    if (error) { toast.error("Erreur"); return; }
    const { error: blErr } = await supabase.from("rooftop_blacklist").insert({
      hotel_id: hotelId, email: r.email || null, nom: r.nom || null,
      motif: `No-show ${fmtDate(r.date_resa)}`,
    });
    if (blErr) toast.error("No-show pointé, mais blacklist non enregistrée");
    else toast.success("No-show → client blacklisté 🚫");
  };

  // Ouvre le mini-formulaire de création sur une table libre.
  const startBooking = (t: ActiveTable) => {
    setOpenTable(null);
    setBookingTable(t.id);
    setForm({ ...emptyForm, couverts: String(t.couverts), heure: (services[0] || "").slice(0, 5) });
  };

  // Ajoute / modifie la note d'une résa existante (allergie, occasion, demande spéciale…).
  const saveNote = async (r: Resa) => {
    const val = (noteEdits[r.id] ?? r.message ?? "").trim();
    setSavingNoteId(r.id);
    const { error } = await supabase
      .from("rooftop_reservations")
      .update({ message: val || null })
      .eq("id", r.id);
    setSavingNoteId(null);
    if (error) { toast.error(error.message || "Erreur"); return; }
    setResas(prev => prev.map(x => (x.id === r.id ? { ...x, message: val || null } : x)));
    setNoteEdits(prev => { const n = { ...prev }; delete n[r.id]; return n; });
    toast.success("Note enregistrée ✓");
  };

  // Crée une réservation sur la table cliquée (walk-in / téléphone).
  const submitBooking = async (t: ActiveTable) => {
    const nom = form.nom.trim();
    if (!nom) { toast.error("Nom requis"); return; }
    const heure = form.heure.trim();
    if (!heure) { toast.error("Heure requise"); return; }
    const couverts = parseInt(form.couverts, 10) || t.couverts;
    setSaving(true);
    const { data, error } = await supabase.from("rooftop_reservations").insert({
      hotel_id: hotelId, date_resa: date, heure, couverts,
      nom, telephone: form.tel.trim() || null, email: form.email.trim() || null,
      message: form.message.trim() || null, statut: "confirmee", table_id: t.id,
    }).select().single();
    setSaving(false);
    if (error) {
      const bl = error.message?.toLowerCase().includes("blacklist");
      const closed = error.message?.includes("indisponible");
      // Blacklist / jour fermé : le staff peut FORCER, avec alerte.
      if (bl || closed) {
        const warn = bl
          ? `⚠️ ${nom} est blacklisté (no-show passé). Forcer la réservation quand même ?`
          : `⚠️ Ce jour est fermé à la réservation en ligne. Forcer quand même ?`;
        if (!(await confirmDialog(warn))) return;
        setSaving(true);
        const { data: forced, error: fErr } = await supabase.rpc("rooftop_book_staff", {
          p_hotel: hotelId, p_date: date, p_heure: heure, p_pax: couverts,
          p_nom: nom, p_tel: form.tel.trim(), p_email: form.email.trim(),
          p_message: form.message.trim(), p_table: t.id,
        });
        setSaving(false);
        if (fErr) { toast.error(fErr.message || "Erreur"); return; }
        setResas(prev => [...prev, forced as Resa]);
        setBookingTable(null);
        setOpenTable(t.id);
        toast.success("Réservation forcée ✓");
        return;
      }
      toast.error(error.message || "Erreur");
      return;
    }
    setResas(prev => [...prev, data as Resa]);
    setBookingTable(null);
    setOpenTable(t.id);
    toast.success("Réservation créée ✓");
  };

  return (
    <div className="space-y-6">
      <CarteLienPublic />
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Plan de salle</span>
            <button onClick={() => shiftDate(-1)} title="Jour précédent"
              className="h-10 w-10 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 active:scale-95 transition">
              <ChevronLeft size={18} />
            </button>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-10 w-44 text-sm" />
            <button onClick={() => shiftDate(1)} title="Jour suivant"
              className="h-10 w-10 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 active:scale-95 transition">
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="font-semibold tabular-nums">{reservedCount}</span>
            <span className="text-slate-400">/ {tables.length} tables réservées</span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1.5">
              <Users size={14} className="text-slate-400" />
              <span className="font-semibold tabular-nums">{couvertsReserved}</span>
              <span className="text-slate-400">couverts</span>
            </span>
          </div>
        </div>

        {dayClosed && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 text-xs font-medium border-b border-amber-100">
            <Ban size={13} /> Vente en ligne fermée ce jour-là.
          </div>
        )}

        {loading ? (
          <div className="p-6 text-center text-slate-400 text-sm">Chargement…</div>
        ) : tables.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">Aucune table active — configurez-les dans l&apos;onglet « Tables ».</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5 p-4">
            {tables.map(t => {
              const r = resaByTable.get(t.id);
              if (r) {
                const isOpen = openTable === t.id;
                const arrived = r.presence === "arrive";
                const noShow = r.presence === "no_show";
                const grad = noShow ? "from-slate-500 to-slate-700"
                  : arrived ? "from-emerald-600 to-emerald-800"
                  : "from-[#00618f] to-[#013a5c]";
                return (
                  <div
                    key={t.id}
                    className={`rounded-2xl shadow-md transition-all duration-300 bg-gradient-to-br ${grad} text-white ${
                      isOpen ? "col-span-2 sm:col-span-3 md:col-span-4 ring-2 ring-[#C6A972] ring-offset-2" : "cursor-pointer hover:-translate-y-0.5 hover:shadow-lg"
                    }`}
                  >
                    <button
                      type="button" onClick={() => setOpenTable(isOpen ? null : t.id)}
                      className="group w-full text-left p-4 flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/70">{t.nom}</span>
                        <p className="mt-1.5 font-semibold text-[15px] leading-tight truncate">{r.nom}</p>
                        <p className="mt-0.5 text-[12px] text-white/80 tabular-nums">{r.heure} · {r.couverts} couv.</p>
                        {arrived && <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold bg-white/20 rounded-full px-2 py-0.5"><Check size={10} /> Arrivé</span>}
                        {noShow && <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold bg-white/20 rounded-full px-2 py-0.5"><Ban size={10} /> No-show</span>}
                      </div>
                      {isOpen
                        ? <X size={16} className="text-white/70 shrink-0" />
                        : <Users size={14} className="text-white/70 shrink-0 transition-transform group-hover:scale-110" />}
                    </button>

                    {isOpen && (
                      <div className="px-3 pb-3">
                        <div className="rounded-xl bg-white p-3 text-slate-700">
                          <div className="text-[13px] space-y-0.5">
                            {r.telephone && <p>📞 {r.telephone}</p>}
                            {r.email && <p>✉️ {r.email}</p>}
                            {!r.telephone && !r.email && <p className="text-slate-400 italic">Aucun contact renseigné.</p>}
                          </div>
                          {(() => {
                            const draft = noteEdits[r.id] ?? r.message ?? "";
                            const changed = draft.trim() !== (r.message ?? "").trim();
                            return (
                              <div className="mt-2.5">
                                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Note</label>
                                <textarea
                                  value={draft} rows={2}
                                  onChange={e => setNoteEdits(prev => ({ ...prev, [r.id]: e.target.value }))}
                                  placeholder="Ajouter une note (allergie, occasion, demande…)"
                                  className="mt-1 w-full resize-none rounded-lg border border-slate-200 px-2.5 py-2 text-[13px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-[#004e7c]"
                                />
                                {changed && (
                                  <button
                                    onClick={() => saveNote(r)} disabled={savingNoteId === r.id}
                                    className="mt-1.5 inline-flex items-center gap-1.5 min-h-[38px] rounded-lg border border-[#004e7c] text-[#004e7c] hover:bg-[#004e7c]/5 px-3 py-1.5 text-[13px] font-semibold transition active:scale-[0.97] disabled:opacity-50"
                                  >
                                    {savingNoteId === r.id ? "Enregistrement…" : "Enregistrer la note"}
                                  </button>
                                )}
                              </div>
                            );
                          })()}
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {arrived ? (
                              <button onClick={() => markPresence(r, null)}
                                className="inline-flex items-center gap-1.5 min-h-[44px] rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3.5 py-2 text-[13px] font-semibold transition active:scale-[0.97]">
                                <Check size={15} /> Arrivé — annuler
                              </button>
                            ) : (
                              <button onClick={() => markPresence(r, "arrive")}
                                className="inline-flex items-center gap-1.5 min-h-[44px] rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50 px-3.5 py-2 text-[13px] font-semibold transition active:scale-[0.97]">
                                <Check size={15} /> Arrivé
                              </button>
                            )}
                            {!noShow && (
                              <button onClick={() => markNoShow(r)}
                                className="inline-flex items-center gap-1.5 min-h-[44px] rounded-lg border border-red-200 text-red-500 hover:bg-red-50 px-3.5 py-2 text-[13px] font-semibold transition active:scale-[0.97]">
                                <Ban size={15} /> No-show
                              </button>
                            )}
                            {freeTables.length > 0 && (
                              <select
                                value="" onChange={e => { if (e.target.value) reassignResa(r, e.target.value); }}
                                className="min-h-[44px] rounded-lg border border-slate-200 bg-white text-sm px-2.5 focus:outline-none focus:border-[#004e7c]"
                              >
                                <option value="">Changer de table…</option>
                                {freeTables.map(ft => <option key={ft.id} value={ft.id}>{ft.nom} ({ft.couverts} couv.)</option>)}
                              </select>
                            )}
                            <button onClick={() => cancelResa(r)}
                              className="inline-flex items-center gap-1.5 min-h-[44px] rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50 px-3.5 py-2 text-[13px] font-semibold transition active:scale-[0.97]">
                              <Ban size={15} /> Annuler
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }
              const isBooking = bookingTable === t.id;
              if (isBooking) {
                return (
                  <div key={t.id} className="col-span-2 sm:col-span-3 md:col-span-4 rounded-2xl border-2 border-[#004e7c] bg-white p-4 shadow-md">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#004e7c]">
                        Nouvelle réservation · {t.nom} <span className="text-slate-400 font-normal">({t.couverts} couv. max)</span>
                      </span>
                      <button onClick={() => setBookingTable(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Input autoFocus placeholder="Nom du client *" value={form.nom}
                        onChange={e => setForm(f => ({ ...f, nom: e.target.value }))}
                        onKeyDown={e => e.key === "Enter" && submitBooking(t)}
                        className="h-11 text-sm col-span-2 sm:col-span-2" />
                      <Input type="number" min="1" placeholder="Couv." value={form.couverts}
                        onChange={e => setForm(f => ({ ...f, couverts: e.target.value }))}
                        className="h-11 text-sm text-center" />
                      {/* Staff = heure LIBRE (walk-in / téléphone à toute heure) ; les services
                          configurés restent proposés en suggestions via datalist. */}
                      <input type="time" value={form.heure} list="rooftop-service-slots"
                        onChange={e => setForm(f => ({ ...f, heure: e.target.value }))}
                        className="h-11 rounded-md border border-slate-200 bg-white text-sm px-2 text-center focus:outline-none focus:border-[#004e7c]" />
                      {services.length > 0 && (
                        <datalist id="rooftop-service-slots">
                          {services.map(h => <option key={h} value={h} />)}
                        </datalist>
                      )}
                      <Input placeholder="Téléphone" value={form.tel}
                        onChange={e => setForm(f => ({ ...f, tel: e.target.value }))} className="h-11 text-sm col-span-2" />
                      <Input placeholder="Email" value={form.email}
                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="h-11 text-sm col-span-2" />
                      <Input placeholder="Note (optionnel)" value={form.message}
                        onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                        onKeyDown={e => e.key === "Enter" && submitBooking(t)}
                        className="h-11 text-sm col-span-2 sm:col-span-3" />
                      <Button onClick={() => submitBooking(t)} disabled={saving || !form.nom.trim()}
                        className="h-11 col-span-2 sm:col-span-1 bg-[#004e7c] hover:bg-[#003d61] text-white gap-1 active:scale-[0.97]">
                        <Check size={16} /> Créer
                      </Button>
                    </div>
                  </div>
                );
              }
              return (
                <button
                  key={t.id} type="button" onClick={() => startBooking(t)}
                  title="Toucher pour réserver cette table"
                  className="text-left rounded-2xl border border-slate-200 bg-white p-4 min-h-[104px] shadow-sm transition-transform duration-150 active:scale-[0.98] active:border-[#004e7c] hover:border-[#004e7c]/40 hover:shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t.nom}</span>
                    <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Libre</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{t.couverts} couv.</p>
                  <span className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-[#004e7c]"><Plus size={13} /> Réserver</span>
                </button>
              );
            })}
          </div>
        )}

        {aPlacer.length > 0 && (
          <div className="border-t border-amber-100 bg-amber-50/50 p-4">
            <p className="text-[12px] font-semibold text-amber-700 mb-2">À placer ({aPlacer.length})</p>
            <ul className="space-y-1.5">
              {aPlacer.map(r => (
                <li key={r.id} className="flex items-center gap-2 text-sm">
                  <span className="text-slate-700">{r.nom}</span>
                  <span className="text-slate-400 text-[12px]">· {r.couverts} couv. · {r.heure}</span>
                  {freeTables.length > 0 && (
                    <select value="" onChange={e => { if (e.target.value) reassignResa(r, e.target.value); }}
                      className="ml-auto h-11 rounded-lg border border-slate-200 bg-white text-sm px-2.5 focus:outline-none focus:border-[#004e7c]">
                      <option value="">Placer à…</option>
                      {freeTables.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
                    </select>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB TABLES — inventaire des tables disponibles du rooftop
// ─────────────────────────────────────────────────────────────
type RooftopTable = { id: string; nom: string; couverts: number; actif: boolean; ordre: number };

function TablesTab({ hotelId }: { hotelId: string }) {
  const [tables, setTables] = useState<RooftopTable[]>([]);
  const [newNom, setNewNom] = useState("");
  const [newCouverts, setNewCouverts] = useState("2");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    supabase.from("rooftop_tables").select("*").eq("hotel_id", hotelId).order("ordre")
      .then(({ data }) => setTables((data as RooftopTable[]) || []));
  }, [hotelId]);

  const totalActif = tables.filter(t => t.actif).reduce((s, t) => s + (t.couverts || 0), 0);
  const nbActif = tables.filter(t => t.actif).length;

  const add = async () => {
    const nom = newNom.trim();
    const couverts = parseInt(newCouverts, 10) || 0;
    if (!nom) return;
    setAdding(true);
    const ordre = tables.length;
    const { data, error } = await supabase.from("rooftop_tables")
      .insert({ hotel_id: hotelId, nom, couverts, actif: true, ordre })
      .select().single();
    setAdding(false);
    if (error) { toast.error(error.message ?? "Erreur"); return; }
    setTables(prev => [...prev, data as RooftopTable]);
    setNewNom(""); setNewCouverts("2");
    toast.success("Table ajoutée ✓");
  };

  const patch = (id: string, field: "nom" | "couverts", value: string) => {
    setTables(prev => prev.map(t => t.id === id
      ? { ...t, [field]: field === "couverts" ? (parseInt(value, 10) || 0) : value }
      : t));
  };

  const persist = async (t: RooftopTable) => {
    const { error } = await supabase.from("rooftop_tables")
      .update({ nom: t.nom.trim(), couverts: t.couverts }).eq("id", t.id);
    if (error) toast.error("Erreur d'enregistrement");
  };

  const toggleActif = async (t: RooftopTable) => {
    const val = !t.actif;
    setTables(prev => prev.map(x => x.id === t.id ? { ...x, actif: val } : x));
    await supabase.from("rooftop_tables").update({ actif: val }).eq("id", t.id);
  };

  const remove = async (id: string) => {
    if (!(await confirmDialog("Supprimer cette table ?"))) return;
    setTables(prev => prev.filter(t => t.id !== id));
    await supabase.from("rooftop_tables").delete().eq("id", id);
    toast.success("Table supprimée");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-slate-500 leading-snug">
          <Armchair size={14} className="inline -mt-0.5 mr-1 text-slate-400" />
          Les tables disponibles du rooftop. Décochez une table pour la retirer temporairement.
        </p>
        <span className="text-sm text-slate-600">
          <span className="font-semibold tabular-nums">{nbActif}</span> tables ·
          <span className="font-semibold tabular-nums"> {totalActif}</span> couverts actifs
        </span>
      </div>

      <div className="flex gap-2 bg-white rounded-xl border border-slate-200 p-4">
        <Input placeholder="Nom / n° de table (ex. T1, Lounge)" value={newNom}
          onChange={e => setNewNom(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}
          className="h-9 text-sm flex-1" />
        <Input type="number" min="1" placeholder="Couv." value={newCouverts}
          onChange={e => setNewCouverts(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}
          className="h-9 w-20 text-sm text-center" />
        <Button onClick={add} disabled={adding || !newNom.trim()} size="sm"
          className="h-9 px-3 bg-[#004e7c] hover:bg-[#003d61] text-white gap-1">
          <Plus size={14} /> Ajouter
        </Button>
      </div>

      {tables.length === 0 ? (
        <p className="text-center text-sm text-slate-400 py-6">Aucune table configurée.</p>
      ) : (
        <ul className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-50">
          {tables.map(t => (
            <li key={t.id} className={`flex items-center gap-3 px-4 py-3 ${t.actif ? "" : "opacity-50"}`}>
              <button
                onClick={() => toggleActif(t)}
                title={t.actif ? "Active" : "Inactive"}
                className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition border ${t.actif ? "bg-[#004e7c] border-[#004e7c]" : "border-slate-300"}`}
              >
                {t.actif && <Check size={10} className="text-white" />}
              </button>
              <Input value={t.nom} onChange={e => patch(t.id, "nom", e.target.value)} onBlur={() => persist(t)}
                className="h-8 text-sm flex-1" />
              <div className="flex items-center gap-1.5 shrink-0">
                <Input type="number" min="0" value={String(t.couverts)}
                  onChange={e => patch(t.id, "couverts", e.target.value)} onBlur={() => persist(t)}
                  className="h-8 w-16 text-sm text-center tabular-nums" />
                <span className="text-[11px] text-slate-400">couv.</span>
              </div>
              <button onClick={() => remove(t.id)} className="text-slate-200 hover:text-red-400 transition shrink-0" title="Supprimer">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB RÉGLAGES — services (rotation future) + jours fermés (plages)
// ─────────────────────────────────────────────────────────────
type Closure = { id: string; date_debut: string; date_fin: string; motif: string | null };
type Service = { id: string; nom: string; heure: string | null; actif: boolean; ordre: number };

// Section repliable « clic pour découvrir » (réglages compacts).
function Section({ icon, title, subtitle, defaultOpen, children }: {
  icon: ReactNode; title: string; subtitle?: string; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50 active:scale-[0.995] transition">
        <span className="text-slate-500">{icon}</span>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">{title}</span>
          {subtitle && <p className="text-[11px] text-slate-400 truncate">{subtitle}</p>}
        </div>
        <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB GESTION — stats du jour + résumé clôture + data du mois
// ─────────────────────────────────────────────────────────────
const euroG = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
type DayStats = { ca: number; nb: number; parPaiement: { tpe: number; espece: number; chambre: number }; tva: TvaTotaux };
type MonthStats = { ca: number; nb: number; byDay: { date: string; ca: number }[]; ttc10: number; ttc20: number };

function GestionTab({ hotelId }: { hotelId: string }) {
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const [date, setDate] = useState(today);
  const [loading, setLoading] = useState(true);
  const [day, setDay] = useState<DayStats | null>(null);
  const [month, setMonth] = useState<MonthStats | null>(null);
  const shiftDate = (delta: number) => {
    const dd = new Date(date + "T00:00:00");
    dd.setDate(dd.getDate() + delta);
    setDate(`${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}-${String(dd.getDate()).padStart(2, "0")}`);
  };

  useEffect(() => {
    setLoading(true);
    (async () => {
      const d = new Date(date + "T00:00:00");
      const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      const lastD = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const last = `${lastD.getFullYear()}-${String(lastD.getMonth() + 1).padStart(2, "0")}-${String(lastD.getDate()).padStart(2, "0")}`;

      const { data: mData } = await supabase.from("rooftop_orders")
        .select("id,total,payment_method,date_service")
        .eq("hotel_id", hotelId).eq("statut", "encaissee")
        .gte("date_service", first).lte("date_service", last);
      const mOrds = (mData as { id: string; total: number; payment_method: string | null; date_service: string }[]) || [];

      // ── Jour ──
      const dayOrds = mOrds.filter(o => o.date_service === date);
      const dayIds = dayOrds.map(o => o.id);
      const parPaiement = { tpe: 0, espece: 0, chambre: 0 };
      let lignes: { ttc: number; type: TvaType }[] = [];
      if (dayIds.length) {
        const [{ data: itemsData }, { data: paysData }] = await Promise.all([
          supabase.from("rooftop_order_items").select("prix,qty,source,tva_type,order_id").in("order_id", dayIds),
          supabase.from("rooftop_order_payments").select("order_id,method,amount").in("order_id", dayIds),
        ]);
        const paysByOrder = new Map<string, { method: string; amount: number }[]>();
        ((paysData as { order_id: string; method: string; amount: number }[]) || []).forEach(p => {
          const a = paysByOrder.get(p.order_id) ?? []; a.push(p); paysByOrder.set(p.order_id, a);
        });
        dayOrds.forEach(o => {
          const ps = paysByOrder.get(o.id);
          if (ps && ps.length) ps.forEach(p => { const m = p.method as keyof typeof parPaiement; if (m in parPaiement) parPaiement[m] += Number(p.amount) || 0; });
          else { const m = o.payment_method as keyof typeof parPaiement; if (m in parPaiement) parPaiement[m] += Number(o.total) || 0; }
        });
        lignes = ((itemsData as { prix: number; qty: number; source: string; tva_type: TvaType | null }[]) || []).map(it => ({
          ttc: round2((Number(it.prix) || 0) * (it.qty || 1)),
          type: (it.tva_type ?? (it.source === "plat" ? "food" : "soft")) as TvaType,
        }));
      }
      setDay({
        ca: round2(dayOrds.reduce((s, o) => s + (Number(o.total) || 0), 0)),
        nb: dayOrds.length,
        parPaiement: { tpe: round2(parPaiement.tpe), espece: round2(parPaiement.espece), chambre: round2(parPaiement.chambre) },
        tva: totauxFromBuckets(ventileAll(lignes)),
      });

      // ── Mois (CA par jour) ──
      const byDayMap = new Map<string, number>();
      mOrds.forEach(o => byDayMap.set(o.date_service, (byDayMap.get(o.date_service) ?? 0) + (Number(o.total) || 0)));
      const byDay = [...byDayMap.entries()].map(([date, ca]) => ({ date, ca: round2(ca) })).sort((a, b) => b.date.localeCompare(a.date));

      // Ventilation TVA du MOIS → TTC encaissé par taux (10% / 20%). Items liés par order_id
      // uniquement → on récupère par lots de 150 ids (URL courte).
      const mIds = mOrds.map(o => o.id);
      const mItems: { prix: number; qty: number; source: string; tva_type: TvaType | null }[] = [];
      for (let i = 0; i < mIds.length; i += 150) {
        const { data: chunk } = await supabase.from("rooftop_order_items")
          .select("prix,qty,source,tva_type").in("order_id", mIds.slice(i, i + 150));
        if (chunk) mItems.push(...(chunk as typeof mItems));
      }
      const mTva = totauxFromBuckets(ventileAll(mItems.map(it => ({
        ttc: round2((Number(it.prix) || 0) * (it.qty || 1)),
        type: (it.tva_type ?? (it.source === "plat" ? "food" : "soft")) as TvaType,
      }))));
      setMonth({
        ca: round2(mOrds.reduce((s, o) => s + (Number(o.total) || 0), 0)),
        nb: mOrds.length, byDay,
        ttc10: round2(mTva.ht10 + mTva.tva10),
        ttc20: round2(mTva.ht20 + mTva.tva20),
      });
      setLoading(false);
    })();
  }, [hotelId, date]);

  const moisLabel = new Date(date + "T00:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const jourLabel = new Date(date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const maxDayCa = Math.max(1, ...(month?.byDay ?? []).map(x => x.ca));

  return (
    <div className="space-y-6">
      {/* ── NAVIGATION DATE ── */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => shiftDate(-1)} title="Jour précédent" className="h-10 w-10 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 active:scale-95 transition"><ChevronLeft size={18} /></button>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-10 w-44 text-sm" />
        <button onClick={() => shiftDate(1)} title="Jour suivant" className="h-10 w-10 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 active:scale-95 transition"><ChevronRight size={18} /></button>
        <span className="ml-1 text-sm font-semibold text-[#013a5c] capitalize">{date === today ? "Aujourd'hui" : jourLabel}</span>
      </div>

      {loading || !day || !month ? (
        <p className="text-center text-sm text-slate-400 py-8">Chargement…</p>
      ) : (
        <>
      {/* ── JOUR ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-2"><BarChart3 size={14} /> Résumé du jour</p>
        <div className="grid md:grid-cols-2 gap-4 items-start">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">CA TTC du jour</span>
              <span className="text-2xl font-bold text-[#013a5c] tabular-nums">{euroG(day.ca)}</span>
            </div>
            <p className="mt-1 text-[12px] text-slate-400">{day.nb} addition{day.nb > 1 ? "s" : ""} encaissée{day.nb > 1 ? "s" : ""}</p>
            <ul className="mt-3 space-y-1.5 text-sm border-t border-slate-100 pt-3">
              <li className="flex justify-between"><span className="text-slate-500 flex items-center gap-1.5"><CreditCard size={14} /> Carte (TPE)</span><span className="font-medium tabular-nums">{euroG(day.parPaiement.tpe)}</span></li>
              <li className="flex justify-between"><span className="text-slate-500 flex items-center gap-1.5"><Banknote size={14} /> Espèces</span><span className="font-medium tabular-nums">{euroG(day.parPaiement.espece)}</span></li>
              <li className="flex justify-between"><span className="text-slate-500 flex items-center gap-1.5"><BedDouble size={14} /> Transfert chambre</span><span className="font-medium tabular-nums">{euroG(day.parPaiement.chambre)}</span></li>
            </ul>
          </div>
          <div className="bg-white rounded-xl border border-[#004e7c]/30 p-4">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#004e7c]">Ventilation TVA du jour</span>
            <table className="mt-2 w-full text-sm">
              <thead><tr className="text-[11px] uppercase tracking-wider text-slate-400"><th className="text-left font-medium pb-1">Taux</th><th className="text-right font-medium pb-1">Base HT</th><th className="text-right font-medium pb-1">TVA</th><th className="text-right font-medium pb-1">TTC</th></tr></thead>
              <tbody className="tabular-nums">
                <tr><td className="text-slate-500 py-0.5">10%</td><td className="text-right">{euroG(day.tva.ht10)}</td><td className="text-right">{euroG(day.tva.tva10)}</td><td className="text-right">{euroG(round2(day.tva.ht10 + day.tva.tva10))}</td></tr>
                <tr><td className="text-slate-500 py-0.5">20%</td><td className="text-right">{euroG(day.tva.ht20)}</td><td className="text-right">{euroG(day.tva.tva20)}</td><td className="text-right">{euroG(round2(day.tva.ht20 + day.tva.tva20))}</td></tr>
                <tr className="border-t border-slate-100 font-semibold text-[#013a5c]"><td className="py-1">Total</td><td className="text-right">{euroG(day.tva.totalHt)}</td><td className="text-right">{euroG(day.tva.totalTva)}</td><td className="text-right">{euroG(day.tva.totalTtc)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── CE MOIS ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2 capitalize">{moisLabel}</p>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">CA TTC du mois</span>
            <span className="text-2xl font-bold text-[#013a5c] tabular-nums">{euroG(month.ca)}</span>
          </div>
          {/* TTC encaissé ventilé par taux de TVA sur le mois en cours */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="rounded-lg bg-[#004e7c]/[0.06] border border-[#004e7c]/15 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">TTC encaissé · 20%</div>
              <div className="mt-0.5 text-lg font-bold text-[#013a5c] tabular-nums">{euroG(month.ttc20)}</div>
            </div>
            <div className="rounded-lg bg-[#004e7c]/[0.06] border border-[#004e7c]/15 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">TTC encaissé · 10%</div>
              <div className="mt-0.5 text-lg font-bold text-[#013a5c] tabular-nums">{euroG(month.ttc10)}</div>
            </div>
          </div>
          {month.byDay.length === 0 ? (
            <p className="text-sm text-slate-400">Aucune vente ce mois-ci.</p>
          ) : (
            <ul className="space-y-1.5">
              {month.byDay.map(row => (
                <li key={row.date} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 text-slate-500 capitalize">{new Date(row.date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</span>
                  <span className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><span className="block h-full bg-[#004e7c]/70 rounded-full" style={{ width: `${Math.round((row.ca / maxDayCa) * 100)}%` }} /></span>
                  <span className="w-20 text-right font-medium tabular-nums text-slate-700">{euroG(row.ca)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-slate-400">{month.nb} addition{month.nb > 1 ? "s" : ""} encaissée{month.nb > 1 ? "s" : ""} sur le mois.</p>
        </div>
      </div>
        </>
      )}
    </div>
  );
}

function ReglagesTab({ hotelId }: { hotelId: string }) {
  // Services
  const [services, setServices] = useState<Service[]>([]);
  const [newSvcNom, setNewSvcNom] = useState("");
  const [newSvcHeure, setNewSvcHeure] = useState("");
  const [addingSvc, setAddingSvc] = useState(false);

  // Jours fermés
  const [closures, setClosures] = useState<Closure[]>([]);
  const [closureFrom, setClosureFrom] = useState("");
  const [closureTo, setClosureTo] = useState("");
  const [closureMotif, setClosureMotif] = useState("");
  const [addingClosure, setAddingClosure] = useState(false);

  useEffect(() => {
    supabase.from("rooftop_services").select("*").eq("hotel_id", hotelId).order("ordre")
      .then(({ data }) => setServices((data as Service[]) || []));
    supabase.from("rooftop_closures").select("id,date_debut,date_fin,motif").eq("hotel_id", hotelId).order("date_debut")
      .then(({ data }) => setClosures((data as Closure[]) || []));
  }, [hotelId]);

  // ── Services ──
  const addService = async () => {
    const nom = newSvcNom.trim();
    if (!nom) return;
    setAddingSvc(true);
    const { data, error } = await supabase.from("rooftop_services")
      .insert({ hotel_id: hotelId, nom, heure: newSvcHeure.trim() || null, actif: true, ordre: services.length })
      .select().single();
    setAddingSvc(false);
    if (error) { toast.error(error.message ?? "Erreur"); return; }
    setServices(prev => [...prev, data as Service]);
    setNewSvcNom(""); setNewSvcHeure("");
    toast.success("Service ajouté ✓");
  };

  const patchSvc = (id: string, field: "nom" | "heure", value: string) =>
    setServices(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));

  const persistSvc = async (s: Service) => {
    const { error } = await supabase.from("rooftop_services")
      .update({ nom: s.nom.trim(), heure: s.heure?.trim() || null }).eq("id", s.id);
    if (error) toast.error("Erreur d'enregistrement");
  };

  const toggleSvcActif = async (s: Service) => {
    const val = !s.actif;
    setServices(prev => prev.map(x => x.id === s.id ? { ...x, actif: val } : x));
    await supabase.from("rooftop_services").update({ actif: val }).eq("id", s.id);
  };

  const removeService = async (id: string) => {
    if (!(await confirmDialog("Supprimer ce service ?"))) return;
    setServices(prev => prev.filter(s => s.id !== id));
    await supabase.from("rooftop_services").delete().eq("id", id);
    toast.success("Service supprimé");
  };

  // ── Fermetures : une PÉRIODE = une ligne (plus de génération jour-par-jour) ──
  const addClosure = async () => {
    const from = closureFrom.trim();
    if (!from) return;
    const to = closureTo.trim() || from; // « Au » optionnel → journée seule
    if (to < from) { toast.error("La date de fin est avant le début"); return; }
    setAddingClosure(true);
    const { data, error } = await supabase.from("rooftop_closures")
      .insert({ hotel_id: hotelId, date_debut: from, date_fin: to, motif: closureMotif.trim() || null })
      .select("id,date_debut,date_fin,motif").single();
    setAddingClosure(false);
    if (error) {
      // La contrainte anti-chevauchement (exclusion gist) rejette une période qui recoupe une existante.
      toast.error(/exclu|overlap|conflic/i.test(error.message || "")
        ? "Cette période recoupe une fermeture déjà enregistrée"
        : (error.message ?? "Erreur"));
      return;
    }
    setClosures(prev => [...prev, data as Closure].sort((a, b) => a.date_debut.localeCompare(b.date_debut)));
    setClosureFrom(""); setClosureTo(""); setClosureMotif("");
    toast.success("Fermeture enregistrée ✓");
  };

  const removeClosure = async (id: string) => {
    if (!(await confirmDialog("Rouvrir cette période à la réservation ?"))) return;
    setClosures(prev => prev.filter(c => c.id !== id));
    await supabase.from("rooftop_closures").delete().eq("id", id);
    toast.success("Période rouverte");
  };

  return (
    <div className="space-y-3">
      <Section icon={<Armchair size={14} />} title="Tables" subtitle="Plan de salle & capacité">
        <TablesTab hotelId={hotelId} />
      </Section>

      <Section icon={<Clock size={14} />} title="Services" subtitle="Horaires de service (rotation)">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-[11px] text-slate-400 mb-3">Aujourd&apos;hui un seul service ; ajoutez-en pour préparer une rotation.</p>
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <Input value={newSvcNom} onChange={e => setNewSvcNom(e.target.value)}
            placeholder="Nom (ex. 2e service)" onKeyDown={e => e.key === "Enter" && addService()} className="h-9 flex-1 min-w-[140px] text-sm" />
          <Input value={newSvcHeure} onChange={e => setNewSvcHeure(e.target.value)}
            placeholder="Heure (ex. 21h)" onKeyDown={e => e.key === "Enter" && addService()} className="h-9 w-28 text-sm" />
          <Button onClick={addService} disabled={addingSvc || !newSvcNom.trim()} size="sm" className="h-9 bg-[#004e7c] hover:bg-[#003d61] text-white gap-1">
            <Plus size={14} /> Ajouter
          </Button>
        </div>
        {services.length === 0 ? (
          <p className="text-sm text-slate-400">Aucun service.</p>
        ) : (
          <ul className="divide-y divide-slate-50 border border-slate-100 rounded-lg">
            {services.map(s => (
              <li key={s.id} className={`flex items-center gap-2 px-3 py-2 ${s.actif ? "" : "opacity-50"}`}>
                <button
                  onClick={() => toggleSvcActif(s)} title={s.actif ? "Actif" : "Inactif"}
                  className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition border ${s.actif ? "bg-[#004e7c] border-[#004e7c]" : "border-slate-300"}`}
                >
                  {s.actif && <Check size={10} className="text-white" />}
                </button>
                <Input value={s.nom} onChange={e => patchSvc(s.id, "nom", e.target.value)} onBlur={() => persistSvc(s)} className="h-8 text-sm flex-1" />
                <Input value={s.heure ?? ""} onChange={e => patchSvc(s.id, "heure", e.target.value)} onBlur={() => persistSvc(s)} placeholder="heure" className="h-8 w-24 text-sm text-center" />
                <button onClick={() => removeService(s.id)} className="text-slate-200 hover:text-red-400 transition shrink-0" title="Supprimer">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      </Section>

      <Section icon={<CalendarX2 size={14} />} title="Jours fermés" subtitle="Fermetures de la vente en ligne">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-500">Du</span>
            <Input type="date" value={closureFrom} onChange={e => setClosureFrom(e.target.value)} className="h-9 w-40 text-sm" />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-500">Au (optionnel)</span>
            <Input type="date" value={closureTo} min={closureFrom || undefined} onChange={e => setClosureTo(e.target.value)} className="h-9 w-40 text-sm" />
          </label>
          <Input value={closureMotif} onChange={e => setClosureMotif(e.target.value)}
            placeholder="Motif (optionnel)" onKeyDown={e => e.key === "Enter" && addClosure()} className="h-9 flex-1 min-w-[140px] text-sm" />
          <Button onClick={addClosure} disabled={addingClosure || !closureFrom.trim()} size="sm" className="h-9 bg-[#004e7c] hover:bg-[#003d61] text-white gap-1">
            <Plus size={14} /> Fermer
          </Button>
        </div>
        {closures.length === 0 ? (
          <p className="text-sm text-slate-400">Aucun jour fermé.</p>
        ) : (
          <ul className="divide-y divide-slate-50 border border-slate-100 rounded-lg">
            {closures.map(c => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                <span className="text-sm text-slate-700 capitalize">
                  {c.date_debut === c.date_fin ? fmtDate(c.date_debut) : `Du ${fmtDate(c.date_debut)} au ${fmtDate(c.date_fin)}`}
                </span>
                {c.motif && <span className="text-[12px] text-slate-400 italic truncate">{c.motif}</span>}
                <button onClick={() => removeClosure(c.id)} className="ml-auto text-slate-200 hover:text-red-400 transition shrink-0" title="Rouvrir">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      </Section>

      <Section icon={<Ban size={14} />} title="Blacklist" subtitle="Clients bloqués / no-show">
        <BlacklistTab hotelId={hotelId} />
      </Section>
    </div>
  );
}
