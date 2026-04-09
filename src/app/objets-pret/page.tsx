"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, ChevronRight, Check, Clock, Loader2,
  Trash2, User, X, Package, Plus
} from "lucide-react";
import toast from "react-hot-toast";

type CurioItem = { id: string; nom: string; emoji: string | null; ordre: number; duree_heures: number; prix_reservation: number };
type Reservation = { id: string; objet_id: string; client_nom: string; chambre: string; debut: string; fin: string };

function toInputDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromInputDate(s: string): Date {
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, m - 1, day, 0, 0, 0, 0);
}
function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); }
function fmtDate(iso: string) { return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }); }

export default function ObjetsPretPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!authLoading && !user) router.push("/login"); }, [user, authLoading, router]);
  if (authLoading || !user) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="px-6 py-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-[#004e7c] flex items-center justify-center">
            <Package size={20} className="text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-slate-900 text-xl">Curiosités</h1>
            <p className="text-sm text-slate-400">Réservations des objets en prêt</p>
          </div>
        </div>
        <Gantt />
      </div>
    </div>
  );
}

function Gantt() {
  const [objets, setObjets] = useState<CurioItem[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [day, setDay] = useState<Date>(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [createModal, setCreateModal] = useState<{ objetId: string } | null>(null);
  const [detailResa, setDetailResa] = useState<Reservation | null>(null);

  const [nom, setNom] = useState("");
  const [chambre, setChambre] = useState("");
  const [debutDate, setDebutDate] = useState("");
  const [debutHeure, setDebutHeure] = useState("10:00");
  const [finDate, setFinDate] = useState("");
  const [finHeure, setFinHeure] = useState("12:00");
  const [selectedDuree, setSelectedDuree] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchResas = useCallback(async () => {
    const from = new Date(day); from.setHours(0, 0, 0, 0);
    const to = new Date(day); to.setHours(24, 0, 0, 0);
    const { data } = await supabase.from("wifi_reservations")
      .select("*").lte("debut", to.toISOString()).gte("fin", from.toISOString());
    if (data) setReservations(data);
  }, [day]);

  useEffect(() => {
    supabase.from("wifi_curiosites").select("id, nom, emoji, ordre, duree_heures, prix_reservation").order("ordre")
      .then(({ data }) => { if (data) setObjets(data); });
  }, []);
  useEffect(() => { fetchResas(); }, [fetchResas]);

  const prevDay = () => setDay(d => { const n = new Date(d); n.setDate(n.getDate() - 1); return n; });
  const nextDay = () => setDay(d => { const n = new Date(d); n.setDate(n.getDate() + 1); return n; });

  const openModal = (objetId: string, clickedHour?: number) => {
    const today = toInputDate(day);
    const h = clickedHour ?? 10;
    const hStr = String(h).padStart(2, "0") + ":00";
    const h2 = Math.min(h + 2, 23);
    const finD = h + 2 > 23 ? toInputDate(new Date(day.getTime() + 86400000)) : today;
    setCreateModal({ objetId });
    setNom(""); setChambre(""); setSelectedDuree(2);
    setDebutDate(today); setDebutHeure(hStr);
    setFinDate(finD); setFinHeure(String(h2).padStart(2, "0") + ":00");
  };

  const getBars = (objetId: string) => {
    const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day); dayEnd.setHours(24, 0, 0, 0);
    return reservations.filter(r => r.objet_id === objetId).map(r => {
      const debut = new Date(r.debut), fin = new Date(r.fin);
      const vs = Math.max(debut.getTime(), dayStart.getTime());
      const ve = Math.min(fin.getTime(), dayEnd.getTime());
      return { ...r, leftPct: (vs - dayStart.getTime()) / 86400000 * 100, widthPct: (ve - vs) / 86400000 * 100 };
    });
  };

  const createResa = async () => {
    if (!createModal || !nom.trim()) return;
    const debut = new Date(`${debutDate}T${debutHeure}:00`);
    const fin = new Date(`${finDate}T${finHeure}:00`);
    if (fin <= debut) { toast.error("La fin doit être après le début"); return; }

    setSaving(true);
    const { data, error } = await supabase.from("wifi_reservations").insert({
      objet_id: createModal.objetId, client_nom: nom.trim(), chambre: chambre.trim(),
      debut: debut.toISOString(), fin: fin.toISOString(),
    }).select().single();
    setSaving(false);
    if (error) { toast.error("Erreur"); return; }
    setReservations(prev => [...prev, data]);
    setCreateModal(null);
    toast.success("Réservation créée ✓");
  };

  const deleteResa = async (id: string) => {
    await supabase.from("wifi_reservations").delete().eq("id", id);
    setReservations(prev => prev.filter(r => r.id !== id));
    setDetailResa(null);
    toast.success("Libéré ✓");
  };

  const isToday = day.toDateString() === new Date().toDateString();
  const nowPct = isToday ? ((new Date().getHours() + new Date().getMinutes() / 60) / 24 * 100) : null;

  // Toutes les réservations visibles du jour, triées par heure
  const allResas = reservations
    .map(r => ({ ...r, objet: objets.find(o => o.id === r.objet_id) }))
    .sort((a, b) => new Date(a.debut).getTime() - new Date(b.debut).getTime());

  const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

  return (
    <div className="space-y-6">
      {/* Navigation jour */}
      <div className="flex items-center gap-3 bg-white rounded-2xl border border-slate-200 px-5 py-3 shadow-sm">
        <button onClick={prevDay} className="p-2 hover:bg-slate-100 rounded-xl transition"><ChevronLeft size={18} /></button>
        <input
          type="date" value={toInputDate(day)}
          onChange={e => { if (e.target.value) setDay(fromInputDate(e.target.value)); }}
          className="flex-1 text-base font-semibold text-slate-900 text-center bg-transparent border-none outline-none cursor-pointer"
        />
        <button onClick={nextDay} className="p-2 hover:bg-slate-100 rounded-xl transition"><ChevronRight size={18} /></button>
        {isToday && <span className="text-xs bg-[#004e7c]/10 text-[#004e7c] font-semibold px-3 py-1 rounded-full">Aujourd&apos;hui</span>}
      </div>

      {/* Gantt */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Header heures */}
        <div className="flex border-b border-slate-100">
          <div className="w-52 shrink-0 border-r border-slate-100 py-3 px-4">
            <span className="text-[10px] uppercase tracking-widest text-slate-400">Objet</span>
          </div>
          <div className="flex-1 relative">
            <div className="flex">
              {HOURS.map(h => (
                <div key={h} className="flex-1 text-center text-xs text-slate-400 py-3 font-medium border-r border-slate-50 last:border-0">{h}h</div>
              ))}
            </div>
          </div>
        </div>

        {/* Lignes objets */}
        {objets.map(objet => {
          const bars = getBars(objet.id);
          return (
            <div key={objet.id} className="flex border-b border-slate-50 last:border-0 group">
              <div className="w-52 shrink-0 border-r border-slate-100 px-4 py-3 flex items-center gap-2.5">
                <span className="text-xl shrink-0">{objet.emoji ?? "📦"}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate leading-tight">{objet.nom}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {objet.duree_heures > 0 && (
                      <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                        <Clock size={9} /> {objet.duree_heures < 24 ? `${objet.duree_heures}h` : `${Math.floor(objet.duree_heures / 24)}j`} max
                      </span>
                    )}
                    {objet.prix_reservation > 0 && (
                      <span className="text-[10px] text-[#C6A972] font-medium">{objet.prix_reservation} €</span>
                    )}
                  </div>
                </div>
              </div>
              <div
                className="flex-1 relative min-h-[72px] cursor-pointer hover:bg-blue-50/30 transition-colors"
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const hour = Math.floor(((e.clientX - rect.left) / rect.width) * 24);
                  openModal(objet.id, Math.max(0, Math.min(23, hour)));
                }}
              >
                {/* Grille toutes les 3h */}
                {[1,2,3,4,5,6,7].map(i => (
                  <div key={i} className="absolute top-0 bottom-0 border-r border-slate-100 pointer-events-none" style={{ left: `${i / 8 * 100}%` }} />
                ))}
                {/* Heure actuelle */}
                {nowPct !== null && (
                  <div className="absolute top-0 bottom-0 w-0.5 bg-red-400/60 pointer-events-none z-10" style={{ left: `${nowPct}%` }} />
                )}
                {/* Hint "+" au survol quand pas de résa */}
                {bars.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition pointer-events-none">
                    <Plus size={16} className="text-slate-300" />
                  </div>
                )}
                {/* Barres */}
                {bars.map(bar => (
                  <div
                    key={bar.id}
                    className="absolute top-4 bottom-4 rounded-lg overflow-hidden z-20 cursor-pointer transition-opacity hover:opacity-80"
                    style={{ left: `${bar.leftPct}%`, width: `${Math.max(bar.widthPct, 1.5)}%` }}
                    onClick={e => { e.stopPropagation(); setDetailResa(bar); }}
                  >
                    <div className="absolute inset-0 bg-[#004e7c]/10 border border-[#004e7c]/25 rounded-lg" />
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#004e7c] rounded-l-lg" />
                    <div className="relative flex items-center h-full px-2.5 pl-3 gap-1.5 overflow-hidden">
                      <p className="text-[#004e7c] text-[11px] font-semibold truncate">{bar.client_nom}</p>
                      <span className="text-[#004e7c]/50 text-[10px] shrink-0">· {bar.chambre}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {objets.length === 0 && (
          <p className="py-12 text-center text-sm text-slate-400">Aucun objet configuré dans Curiosités</p>
        )}
      </div>

      {/* Liste du jour */}
      {allResas.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Réservations du jour</p>
            <span className="text-xs bg-slate-100 text-slate-500 rounded-full px-2.5 py-0.5 font-medium">{allResas.length}</span>
          </div>
          <div className="divide-y divide-slate-50">
            {allResas.map(r => (
              <div key={r.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 transition group">
                <div className="text-xl shrink-0">{r.objet?.emoji ?? "📦"}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{r.objet?.nom}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <User size={11} /> {r.client_nom} — Ch.{r.chambre}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-slate-400">
                      <Clock size={11} />
                      {fmtDate(r.debut)} {fmtTime(r.debut)} → {fmtDate(r.fin)} {fmtTime(r.fin)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => deleteResa(r.id)}
                  className="opacity-0 group-hover:opacity-100 transition text-slate-300 hover:text-red-400 p-1.5 rounded-lg"
                  title="Libérer"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400 text-center">Cliquez sur une ligne du planning pour créer une réservation</p>

      {/* Modal création */}
      {createModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setCreateModal(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 text-lg">Nouvelle réservation</h3>
              <button onClick={() => setCreateModal(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <p className="text-sm text-slate-500 bg-slate-50 rounded-xl px-4 py-3 font-medium">
              {objets.find(o => o.id === createModal.objetId)?.emoji} {objets.find(o => o.id === createModal.objetId)?.nom}
            </p>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1.5">Nom client</label>
                  <Input value={nom} onChange={e => setNom(e.target.value)} placeholder="Jean Dupont" className="h-10" autoFocus />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1.5">Chambre</label>
                  <Input value={chambre} onChange={e => setChambre(e.target.value)} placeholder="12" className="h-10" />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1.5">Début</label>
                <div className="flex gap-2">
                  <input type="date" value={debutDate} onChange={e => { setDebutDate(e.target.value); if (!finDate || e.target.value > finDate) setFinDate(e.target.value); }} className="flex-1 h-10 text-sm border border-slate-200 rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-[#004e7c]/20" />
                  <input type="time" value={debutHeure} onChange={e => setDebutHeure(e.target.value)} className="w-28 h-10 text-sm border border-slate-200 rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-[#004e7c]/20" />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1.5">Durée rapide</label>
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3, 4, 6, 8, 12, 24, 48].map(h => (
                    <button key={h} type="button"
                      onClick={() => {
                        const debut = new Date(`${debutDate}T${debutHeure}:00`);
                        const fin = new Date(debut.getTime() + h * 3600000);
                        setFinDate(toInputDate(fin));
                        setFinHeure(String(fin.getHours()).padStart(2, "0") + ":" + String(fin.getMinutes()).padStart(2, "0"));
                        setSelectedDuree(h);
                      }}
                      className={`text-xs px-3.5 py-1.5 rounded-full border font-medium transition ${selectedDuree === h ? "bg-[#004e7c] border-[#004e7c] text-white" : "border-slate-200 text-slate-600 hover:bg-[#004e7c] hover:text-white hover:border-[#004e7c]"}`}
                    >
                      {h < 24 ? `${h}h` : h === 24 ? "24h" : "2 nuits"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-400 block mb-1.5">Fin (modifiable)</label>
                <div className="flex gap-2">
                  <input type="date" value={finDate} onChange={e => setFinDate(e.target.value)} className="flex-1 h-10 text-sm border border-slate-200 rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-[#004e7c]/20" />
                  <input type="time" value={finHeure} onChange={e => { setFinHeure(e.target.value); setSelectedDuree(null); }} className="w-28 h-10 text-sm border border-slate-200 rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-[#004e7c]/20" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <Button variant="ghost" className="flex-1" onClick={() => setCreateModal(null)}>Annuler</Button>
              <Button className="flex-1 bg-[#004e7c] hover:bg-[#003d61] text-white gap-2 h-11"
                disabled={!nom.trim() || saving} onClick={createResa}>
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                Confirmer
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal détail */}
      {detailResa && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDetailResa(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 text-lg">Réservation</h3>
              <button onClick={() => setDetailResa(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 space-y-3 text-sm">
              <div className="flex items-center gap-2.5 font-semibold text-slate-800 text-base">
                <span className="text-2xl">{objets.find(o => o.id === detailResa.objet_id)?.emoji}</span>
                {objets.find(o => o.id === detailResa.objet_id)?.nom}
              </div>
              <div className="flex items-center gap-2 text-slate-600">
                <User size={14} className="shrink-0" />
                <span>{detailResa.client_nom}</span>
                <span className="text-slate-400">·</span>
                <span>Chambre {detailResa.chambre}</span>
              </div>
              <div className="flex items-center gap-2 text-slate-500 text-xs">
                <Clock size={13} className="shrink-0" />
                {fmtDate(detailResa.debut)} {fmtTime(detailResa.debut)} → {fmtDate(detailResa.fin)} {fmtTime(detailResa.fin)}
              </div>
            </div>
            <Button className="w-full gap-2 bg-red-500 hover:bg-red-600 text-white h-11" onClick={() => deleteResa(detailResa.id)}>
              <Trash2 size={15} /> Libérer l&apos;objet
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
