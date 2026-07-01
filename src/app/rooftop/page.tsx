"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ThemedBackground } from "@/components/ThemedBackground";
import { PageHeader } from "@/components/PageHeader";
import { confirmDialog } from "@/components/ConfirmDialog";
import { useAuth } from "@/context/AuthContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Martini, Plus, Trash2, CalendarX2, Users, Ban, Armchair, Check, Clock, X } from "lucide-react";
import toast from "react-hot-toast";
import { RooftopCarteTab, BlacklistTab, VOILES_ID } from "@/components/rooftop/RooftopEditors";

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
            <TabsTrigger value="carte" className="flex-1">Carte</TabsTrigger>
            <TabsTrigger value="reglages" className="flex-1">Réglages</TabsTrigger>
            <TabsTrigger value="blacklist" className="flex-1">Blacklist</TabsTrigger>
          </TabsList>

          <TabsContent value="resas"><ResasTab hotelId={VOILES_ID} /></TabsContent>
          <TabsContent value="carte"><RooftopCarteTab hotelId={VOILES_ID} /></TabsContent>
          <TabsContent value="reglages"><ReglagesTab hotelId={VOILES_ID} /></TabsContent>
          <TabsContent value="blacklist"><BlacklistTab hotelId={VOILES_ID} /></TabsContent>
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
function toYmd(d: Date): string {
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
};
type ActiveTable = { id: string; nom: string; couverts: number; ordre: number };

function ResasTab({ hotelId }: { hotelId: string }) {
  const today = useMemo(todayStr, []);
  const [date, setDate] = useState(today);
  const [resas, setResas] = useState<Resa[]>([]);
  const [tables, setTables] = useState<ActiveTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [openTable, setOpenTable] = useState<string | null>(null);
  const [closedDays, setClosedDays] = useState<Set<string>>(new Set());

  // Réservations + tables du jour
  useEffect(() => {
    setLoading(true);
    setOpenTable(null);
    Promise.all([
      supabase.from("rooftop_reservations").select("*").eq("hotel_id", hotelId).eq("date_resa", date).order("heure"),
      supabase.from("rooftop_tables").select("id,nom,couverts,ordre").eq("hotel_id", hotelId).eq("actif", true).order("ordre"),
    ]).then(([{ data: rData }, { data: tData }]) => {
      setResas((rData as Resa[]) || []);
      setTables((tData as ActiveTable[]) || []);
      setLoading(false);
    });
  }, [hotelId, date]);

  // Jours fermés (pour la bannière)
  useEffect(() => {
    supabase.from("rooftop_closures").select("date_fermee").eq("hotel_id", hotelId)
      .then(({ data }) => setClosedDays(new Set(((data as { date_fermee: string }[]) || []).map(c => c.date_fermee))));
  }, [hotelId]);

  // Occupation : table → réservation active
  const resaByTable = new Map<string, Resa>();
  resas.filter(r => r.statut !== "annulee" && r.table_id).forEach(r => resaByTable.set(r.table_id as string, r));

  const reservedCount = tables.filter(t => resaByTable.has(t.id)).length;
  const couvertsReserved = tables.reduce((s, t) => s + (resaByTable.has(t.id) ? (resaByTable.get(t.id)!.couverts || 0) : 0), 0);
  const freeTables = tables.filter(t => !resaByTable.has(t.id));
  const aPlacer = resas.filter(r => r.statut !== "annulee" && (!r.table_id || !tables.some(t => t.id === r.table_id)));
  const dayClosed = closedDays.has(date);

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

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Plan de salle</span>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-8 w-40 text-sm" />
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
                return (
                  <div
                    key={t.id}
                    className={`rounded-2xl shadow-md transition-all duration-300 bg-gradient-to-br from-[#00618f] to-[#013a5c] text-white ${
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
                            {r.message && <p className="italic text-slate-500">« {r.message} »</p>}
                            {!r.telephone && !r.email && !r.message && <p className="text-slate-400 italic">Aucun contact renseigné.</p>}
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {freeTables.length > 0 && (
                              <select
                                value="" onChange={e => { if (e.target.value) reassignResa(r, e.target.value); }}
                                className="h-8 rounded-md border border-slate-200 bg-white text-sm px-2 focus:outline-none focus:border-[#004e7c]"
                              >
                                <option value="">Changer de table…</option>
                                {freeTables.map(ft => <option key={ft.id} value={ft.id}>{ft.nom} ({ft.couverts} couv.)</option>)}
                              </select>
                            )}
                            <button onClick={() => cancelResa(r)}
                              className="inline-flex items-center gap-1 rounded-md border border-amber-200 text-amber-600 hover:bg-amber-50 px-2 py-1 text-[12px] font-semibold transition">
                              <Ban size={13} /> Annuler
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }
              return (
                <div key={t.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t.nom}</span>
                    <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Libre</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{t.couverts} couv.</p>
                </div>
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
                      className="ml-auto h-7 rounded border border-slate-200 bg-white text-[12px] px-1 focus:outline-none focus:border-[#004e7c]">
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
type Closure = { id: string; date_fermee: string; motif: string | null };
type Service = { id: string; nom: string; heure: string | null; actif: boolean; ordre: number };

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
    supabase.from("rooftop_closures").select("*").eq("hotel_id", hotelId).order("date_fermee")
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

  // ── Jours fermés (plage de dates) ──
  const addClosure = async () => {
    const from = closureFrom.trim();
    if (!from) return;
    const to = closureTo.trim() || from;
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    if (end < start) { toast.error("La date de fin est avant le début"); return; }
    // Garde-fou : max ~92 jours d'un coup
    const spanDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    if (spanDays > 92) { toast.error("Plage trop longue (92 jours max)"); return; }

    const rows: { hotel_id: string; date_fermee: string; motif: string | null }[] = [];
    for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
      rows.push({ hotel_id: hotelId, date_fermee: toYmd(cur), motif: closureMotif.trim() || null });
    }
    setAddingClosure(true);
    // ignoreDuplicates : les jours déjà fermés sont ignorés silencieusement.
    const { data, error } = await supabase.from("rooftop_closures")
      .upsert(rows, { onConflict: "hotel_id,date_fermee", ignoreDuplicates: true })
      .select();
    setAddingClosure(false);
    if (error) { toast.error(error.message ?? "Erreur"); return; }
    const added = (data as Closure[]) || [];
    setClosures(prev => [...prev, ...added].sort((a, b) => a.date_fermee.localeCompare(b.date_fermee)));
    setClosureFrom(""); setClosureTo(""); setClosureMotif("");
    toast.success(added.length > 0 ? `${added.length} jour${added.length > 1 ? "s" : ""} fermé${added.length > 1 ? "s" : ""} ✓` : "Ces jours étaient déjà fermés");
  };

  const removeClosure = async (id: string) => {
    if (!(await confirmDialog("Rouvrir ce jour à la réservation ?"))) return;
    setClosures(prev => prev.filter(c => c.id !== id));
    await supabase.from("rooftop_closures").delete().eq("id", id);
    toast.success("Jour rouvert");
  };

  return (
    <div className="space-y-6">
      {/* ── TABLES ────────────────────────────────────── */}
      <TablesTab hotelId={hotelId} />

      {/* ── SERVICES ──────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1">
          <Clock size={14} /> Services
        </p>
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

      {/* ── JOURS FERMÉS (plages) ─────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">
          <CalendarX2 size={14} /> Jours fermés (vente en ligne)
        </p>
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
                <span className="text-sm text-slate-700 capitalize">{fmtDate(c.date_fermee)}</span>
                {c.motif && <span className="text-[12px] text-slate-400 italic truncate">{c.motif}</span>}
                <button onClick={() => removeClosure(c.id)} className="ml-auto text-slate-200 hover:text-red-400 transition shrink-0" title="Rouvrir">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
