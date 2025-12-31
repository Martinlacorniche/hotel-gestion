"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { 
  format, parseISO, addMonths, subMonths, startOfMonth, endOfMonth, 
  eachDayOfInterval, isSameDay, isWithinInterval, isAfter, isBefore, 
  isValid, differenceInCalendarDays, max, min, endOfDay, startOfDay 
} from "date-fns";
import { fr } from "date-fns/locale";
import { 
  ChevronLeft, ChevronRight, User, Calendar as CalendarIcon, Info, 
  Trash2, Edit2, PlusCircle, Save 
} from "lucide-react";

export default function ParkingPage() {
  const [parkings, setParkings] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [clientName, setClientName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedParking, setSelectedParking] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [popupReservation, setPopupReservation] = useState<any | null>(null);
  
  // Tooltip state
  const [hoverTip, setHoverTip] = useState<null | {
    left: number; top: number;
    content: { client: string; start: string; end: string; }
  }>(null);

  useEffect(() => {
    fetchParkings();
    fetchReservations();
  }, []);

  useEffect(() => {
    document.title = 'Parking';
  }, []);

  // --- DATA FETCHING ---

  async function fetchParkings() {
    const { data, error } = await supabase.from("parkings").select("*").order('name');
    if (!error && data) {
      // Renommage spécifique (optionnel selon ton besoin)
      const renamed = data.map(p => {
        if (p.name === "Box1") return { ...p, name: "Box9" };
        if (p.name === "Box2") return { ...p, name: "Box24" };
        return p;
      });
      setParkings(renamed);
      if (!selectedParking && renamed.length > 0) setSelectedParking(renamed[0].id);
    }
  }

  async function fetchReservations() {
    const { data, error } = await supabase.from("parking_reservations").select("*");
    if (!error && data) setReservations(data);
  }

  // --- ACTIONS ---

  async function handleReservation() {
    if (!selectedParking || !clientName || !startDate || !endDate) {
      setMessage("Tous les champs sont obligatoires.");
      return;
    }

    const s = parseISO(startDate);
    const e = parseISO(endDate);
    if (!isValid(s) || !isValid(e) || isAfter(s, e)) {
      setMessage("Dates invalides (début > fin ?).");
      return;
    }

    // Vérification chevauchement
    const overlapping = reservations.some((r) => {
      if (editingId && r.id === editingId) return false;
      if (r.parking_id !== selectedParking) return false;
      if (!r.start_date || !r.end_date) return false;

      const rs = parseISO(r.start_date);
      const re = parseISO(r.end_date);
      if (!isValid(rs) || !isValid(re)) return false;

      return !(isAfter(s, re) || isBefore(e, rs));
    });

    if (overlapping) {
      setMessage("❌ Déjà réservé.");
      setTimeout(() => setMessage(""), 3000);
      return;
    }

    const payload = { 
      parking_id: selectedParking, 
      client_name: clientName, 
      start_date: startDate, 
      end_date: endDate 
    };

    if (editingId) {
      const { error } = await supabase
        .from("parking_reservations")
        .update(payload)
        .eq("id", editingId);

      if (!error) {
        setMessage("✅ Mis à jour !");
        resetForm();
        fetchReservations();
      }
    } else {
      const { error } = await supabase
        .from("parking_reservations")
        .insert(payload);

      if (!error) {
        setMessage("✅ Enregistré !");
        resetForm();
        fetchReservations();
      }
    }
    setTimeout(() => setMessage(""), 3000);
  }

  async function handleDelete(id: string) {
    if(!confirm("Supprimer cette réservation ?")) return;
    const { error } = await supabase.from("parking_reservations").delete().eq("id", id);
    if (!error) {
      setMessage("🗑️ Supprimé !");
      fetchReservations();
      setPopupReservation(null);
      setTimeout(() => setMessage(""), 3000);
    }
  }

  function handleEdit(reservation: any) {
    setClientName(reservation.client_name);
    setStartDate(reservation.start_date);
    setEndDate(reservation.end_date);
    setSelectedParking(reservation.parking_id);
    setEditingId(reservation.id);
    setPopupReservation(null);
  }

  function resetForm() {
    setClientName("");
    setStartDate("");
    setEndDate("");
    setEditingId(null);
  }

  // --- TOOLTIP & STYLE CALCULATIONS ---

  function showTip(e: React.MouseEvent<HTMLDivElement>, r: any) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const TIP_W = 220;
    const TIP_H = 70;
    const MARGIN = 10;
    
    let top = rect.top - TIP_H - MARGIN;
    let left = rect.left + rect.width / 2;
    
    // Empêcher de sortir de l'écran
    if (top < 0) top = rect.bottom + MARGIN;
    const maxLeft = window.innerWidth - TIP_W / 2 - MARGIN;
    left = Math.max(TIP_W / 2 + MARGIN, Math.min(maxLeft, left));

    setHoverTip({
      left,
      top,
      content: { client: r.client_name, start: r.start_date, end: r.end_date }
    });
  }

  function hideTip() {
    setHoverTip(null);
  }

  // Calcul mathématique pour le style "Gantt"
  function getReservationStyle(r: any, monthStart: Date, monthEnd: Date, totalDaysInMonth: number) {
    const rStart = parseISO(r.start_date);
    const rEnd = endOfDay(parseISO(r.end_date));

    // On coupe ce qui dépasse du mois
    const effectiveStart = max([rStart, monthStart]);
    const effectiveEnd = min([rEnd, monthEnd]);

    if (isBefore(effectiveEnd, effectiveStart)) return null;

    const startOffsetDays = differenceInCalendarDays(effectiveStart, monthStart);
    const durationDays = differenceInCalendarDays(effectiveEnd, effectiveStart) + 1;

    const leftPercent = (startOffsetDays / totalDaysInMonth) * 100;
    const widthPercent = (durationDays / totalDaysInMonth) * 100;

    return {
        left: `calc(${leftPercent}% + 2px)`,
        width: `calc(${widthPercent}% - 4px)` // -4px pour laisser une petite marge blanche entre blocs collés
    };
  }

  const monthDays = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
      
      {/* --- HEADER & TOOLBAR --- */}
      <div className="shrink-0 p-4 md:px-6 md:pt-6 md:pb-2 space-y-4 bg-slate-50 z-40">
        
        {/* Ligne 1 : Titre + Navigation Mois */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-4">
                <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
                    🅿️ Parking
                </h1>
                <div className="hidden md:flex gap-2">
                     <span className="px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 text-[10px] font-bold border border-indigo-100">
                        Box9 (H1.86 L2.3)
                     </span>
                     <span className="px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 text-[10px] font-bold border border-indigo-100">
                        Box24 (H1.84 L2.22)
                     </span>
                </div>
            </div>

            {/* Navigation Mois */}
            <div className="flex items-center bg-white rounded-full shadow-sm border px-1 py-1">
                <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="h-8 w-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-600">
                    <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-4 text-sm font-bold text-slate-800 w-32 text-center capitalize">
                    {format(currentMonth, 'MMMM yyyy', { locale: fr })}
                </span>
                <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="h-8 w-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-600">
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>
        </div>

        {/* Ligne 2 : Barre de Commande */}
        <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row items-center gap-2">
            {/* Selecteur Parking */}
            <div className="flex bg-slate-100 p-1 rounded-xl shrink-0 overflow-x-auto max-w-full">
                {parkings.map(p => (
                    <button
                        key={p.id}
                        onClick={() => setSelectedParking(p.id)}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${selectedParking === p.id ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        {p.name}
                    </button>
                ))}
            </div>

            <div className="w-px h-6 bg-slate-200 hidden md:block mx-1"></div>

            {/* Inputs */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2 w-full">
                <div className="relative">
                    <User className="absolute left-2.5 top-2 w-4 h-4 text-slate-400" />
                    <input 
                        className="w-full h-8 pl-9 pr-3 text-sm bg-slate-50 border-transparent focus:bg-white focus:border-indigo-500 border rounded-lg outline-none transition-all placeholder:text-slate-400" 
                        placeholder="Nom du client" 
                        value={clientName} 
                        onChange={e => setClientName(e.target.value)} 
                    />
                </div>
                <div className="relative">
                    <CalendarIcon className="absolute left-2.5 top-2 w-4 h-4 text-slate-400" />
                    <input 
                        type="date" 
                        className="w-full h-8 pl-9 pr-3 text-sm bg-slate-50 border-transparent focus:bg-white focus:border-indigo-500 border rounded-lg outline-none transition-all text-slate-600" 
                        value={startDate} 
                        onChange={e => setStartDate(e.target.value)} 
                    />
                </div>
                <div className="relative">
                    <CalendarIcon className="absolute left-2.5 top-2 w-4 h-4 text-slate-400" />
                    <input 
                        type="date" 
                        className="w-full h-8 pl-9 pr-3 text-sm bg-slate-50 border-transparent focus:bg-white focus:border-indigo-500 border rounded-lg outline-none transition-all text-slate-600" 
                        value={endDate} 
                        onChange={e => setEndDate(e.target.value)} 
                    />
                </div>
            </div>

            {/* Bouton Action */}
            <button 
                onClick={handleReservation}
                className="h-8 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg shadow-md shadow-indigo-200 transition-all flex items-center gap-2 shrink-0 whitespace-nowrap"
            >
                {editingId ? <Save className="w-4 h-4" /> : <PlusCircle className="w-4 h-4" />}
                {editingId ? "Mettre à jour" : "Réserver"}
            </button>
            
            {message && (
                <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full animate-pulse whitespace-nowrap hidden md:inline-block">
                    {message}
                </span>
            )}
        </div>
      </div>

      {/* --- PLANNING TABLE (GANTT) --- */}
      <div className="flex-1 overflow-hidden px-4 md:px-6 pb-6">
         <div className="h-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col relative">
            <div className="overflow-auto flex-1">
                <table className="w-full border-collapse">
                    {/* En-tête Jours */}
                    <thead className="bg-slate-50 sticky top-0 z-30">
                        <tr>
                            {/* Colonne fixe Nom (Largeur forcée w-24 pour matcher l'offset) */}
                            <th className="p-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 sticky left-0 bg-slate-50 z-40 w-28 min-w-[7rem]">
                                Box
                            </th>
                            {monthDays.map((day) => (
                                <th key={day.toISOString()} className="p-1 text-center border-b border-slate-200 min-w-[36px]">
                                    <div className="flex flex-col items-center">
                                        <span className="text-[10px] font-semibold text-slate-400 uppercase">{format(day, 'EEEEE', {locale: fr})}</span>
                                        <span className={`text-sm font-bold ${isSameDay(day, new Date()) ? 'bg-indigo-600 text-white w-6 h-6 rounded-full flex items-center justify-center shadow-sm' : 'text-slate-700'}`}>
                                            {format(day, 'd')}
                                        </span>
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    
                    {/* Corps du tableau (Overlay Gantt) */}
                    <tbody className="divide-y divide-slate-100 relative">
                        {parkings.map(p => {
                            // Filtrer les résas pertinentes pour ce parking et ce mois
                            const monthStart = startOfMonth(currentMonth);
                            const monthEnd = endOfMonth(currentMonth);
                            const totalDays = monthDays.length;
                            
                            const relevantReservations = reservations.filter(r => 
                                r.parking_id === p.id &&
                                r.start_date && r.end_date &&
                                (isWithinInterval(parseISO(r.start_date), {start: monthStart, end: monthEnd}) ||
                                isWithinInterval(parseISO(r.end_date), {start: monthStart, end: monthEnd}) ||
                                (isBefore(parseISO(r.start_date), monthStart) && isAfter(parseISO(r.end_date), monthEnd)))
                            );

                            return (
                            <tr key={p.id} className="group bg-white hover:bg-slate-50/30 transition-colors relative h-14">
                                {/* Colonne Nom (Sticky Left) */}
                                <td className="p-3 sticky left-0 bg-white group-hover:bg-slate-50 z-20 border-r border-slate-100 font-bold text-sm text-slate-700 h-full w-28 min-w-[7rem]">
                                    <div className="flex items-center h-full">{p.name}</div>
                                </td>

                                {/* Grille de fond (Cellules vides) */}
                                {monthDays.map(day => (
                                    <td key={day.toISOString()} className="p-0 relative h-full border-r border-slate-50 last:border-r-0 z-10 pointer-events-none">
                                        {/* Petit repère visuel discret */}
                                    </td>
                                ))}

                                {/* OVERLAY : Les blocs lissés */}
                                {/* offset left-28 pour correspondre à la largeur w-28 de la 1ère colonne */}
                                <td className="absolute inset-y-0 left-28 right-0 z-20 h-full p-0 pointer-events-none" colSpan={totalDays}>
                                     <div className="relative w-full h-full">
                                        {relevantReservations.map(r => {
                                            const style = getReservationStyle(r, monthStart, monthEnd, totalDays);
                                            if (!style) return null;

                                            return (
                                                <div 
                                                    key={r.id}
                                                    style={style}
                                                    onClick={() => setPopupReservation(r)}
                                                    onMouseEnter={(e) => showTip(e, r)}
                                                    onMouseLeave={hideTip}
                                                    // BLOC GANTT : Indigo, lissé, ombre portée
                                                    className="absolute top-2 bottom-2 bg-indigo-100 border border-indigo-300 text-indigo-900 rounded-lg shadow-sm cursor-pointer hover:bg-indigo-200 hover:shadow-md transition-all hover:z-30 hover:scale-[1.01] flex items-center justify-center px-2 pointer-events-auto overflow-hidden"
                                                >
                                                    <span className="text-[11px] font-bold truncate tracking-tight w-full text-center">
                                                        {r.client_name}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                     </div>
                                </td>
                            </tr>
                        )})}
                    </tbody>
                </table>
            </div>
         </div>
      </div>

      {/* --- MODALE DETAILS --- */}
      {popupReservation && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in zoom-in duration-200">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-xs border border-slate-100">
            <h3 className="font-bold text-lg mb-4 text-slate-800 flex items-center gap-2">
                <Info className="w-5 h-5 text-indigo-500" /> Réservation
            </h3>
            <div className="space-y-3 text-sm text-slate-600 bg-slate-50 p-4 rounded-xl border border-slate-100 mb-4">
                <p><span className="font-bold text-slate-400 uppercase text-xs w-10 inline-block">Qui</span> <span className="font-bold text-slate-800 text-base">{popupReservation.client_name}</span></p>
                <p><span className="font-bold text-slate-400 uppercase text-xs w-10 inline-block">Box</span> {parkings.find(p => p.id === popupReservation.parking_id)?.name}</p>
                <div className="h-px bg-slate-200 my-2"></div>
                <p className="flex justify-between"><span>Début</span> <span className="font-mono font-bold">{format(parseISO(popupReservation.start_date), 'dd MMM', {locale: fr})}</span></p>
                <p className="flex justify-between"><span>Fin</span> <span className="font-mono font-bold">{format(parseISO(popupReservation.end_date), 'dd MMM', {locale: fr})}</span></p>
            </div>
            
            <div className="flex justify-between gap-2">
              <button className="px-3 py-2 rounded-lg text-slate-500 font-bold hover:bg-slate-50 transition text-xs" onClick={() => setPopupReservation(null)}>Fermer</button>
              <div className="flex gap-2">
                  <button className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition text-xs flex items-center gap-1 shadow-sm" onClick={() => handleEdit(popupReservation)}><Edit2 className="w-3 h-3"/> Editer</button>
                  <button className="px-3 py-2 rounded-lg bg-red-50 text-red-600 font-bold hover:bg-red-100 transition text-xs flex items-center gap-1" onClick={() => handleDelete(popupReservation.id)}><Trash2 className="w-3 h-3"/> Suppr.</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- TOOLTIP --- */}
      {hoverTip && (
        <div
            className="fixed z-[100] pointer-events-none bg-slate-900/90 backdrop-blur text-white px-3 py-2 rounded-lg shadow-xl text-xs border border-slate-700 transform -translate-x-1/2"
            style={{ left: hoverTip.left, top: hoverTip.top }}
        >
            <div className="font-bold text-indigo-200 mb-0.5 text-center">{hoverTip.content.client}</div>
            <div className="opacity-90 font-mono text-[10px] whitespace-nowrap">{format(parseISO(hoverTip.content.start), 'dd/MM')} → {format(parseISO(hoverTip.content.end), 'dd/MM')}</div>
        </div>
      )}

    </div>
  );
}