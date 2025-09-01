"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { format, parseISO, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isWithinInterval, isAfter, isBefore, isValid } from "date-fns";

export default function ParkingPage() {
  const [parkings, setParkings] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [clientName, setClientName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedParking, setSelectedParking] = useState(null);
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [popupReservation, setPopupReservation] = useState(null);
  const [hoverTip, setHoverTip] = useState(null as null | {
  left: number; top: number;
  content: { client: string; start: string; end: string; }
});




  useEffect(() => {
    fetchParkings();
    fetchReservations();
  }, []);

  useEffect(() => {
  document.title = 'Parking';
}, []);

  async function fetchParkings() {
    const { data, error } = await supabase.from("parkings").select("*");
    if (!error) {
      const renamed = data.map(p => {
        if (p.name === "Box1") return { ...p, name: "Box9" };
        if (p.name === "Box2") return { ...p, name: "Box24" };
        return p;
      });
      setParkings(renamed);
    }
  }

  async function fetchReservations() {
    const { data, error } = await supabase.from("parking_reservations").select("*");
    if (!error) setReservations(data);
  }

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

  const overlapping = reservations.some((r) => {
    if (editingId && r.id === editingId) return false;
    if (r.parking_id !== selectedParking) return false;
    if (!r.start_date || !r.end_date) return false; // ignore données sales

    const rs = parseISO(r.start_date);
    const re = parseISO(r.end_date);
    if (!isValid(rs) || !isValid(re)) return false;

    // Chevauchement si s <= re && e >= rs (bornes inclusives)
    return !(isAfter(s, re) || isBefore(e, rs));
  });

  if (overlapping) {
    setMessage("❌ Déjà réservé sur cette période.");
    return;
  }

    if (editingId) {
      const { error } = await supabase
        .from("parking_reservations")
        .update({ parking_id: selectedParking, client_name: clientName, start_date: startDate, end_date: endDate })
        .eq("id", editingId);

      if (!error) {
        setMessage("✅ Réservation mise à jour !");
        resetForm();
        fetchReservations();
      }
    } else {
      const { error } = await supabase
        .from("parking_reservations")
        .insert({ parking_id: selectedParking, client_name: clientName, start_date: startDate, end_date: endDate });

      if (!error) {
        setMessage("✅ Réservation enregistrée !");
        resetForm();
        fetchReservations();
      }
    }
  }

  async function handleDelete(id) {
    const { error } = await supabase.from("parking_reservations").delete().eq("id", id);
    if (!error) {
      setMessage("🗑️ Réservation supprimée !");
      fetchReservations();
      setPopupReservation(null);
    }
  }

  function handleEdit(reservation) {
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
    setSelectedParking(null);
    setEditingId(null);
  }

  function showTip(e: React.MouseEvent<HTMLTableCellElement>, r: any) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();

  // Taille estimée du tooltip (pour éviter qu'il sorte de l'écran).
  const TIP_W = 220;
  const TIP_H = 80;
  const MARGIN = 8;

  // Choix haut/bas selon l'espace dispo
  const spaceAbove = rect.top;
  const spaceBelow = window.innerHeight - rect.bottom;
  const placeAbove = spaceAbove > spaceBelow;

  let top = placeAbove ? rect.top - TIP_H - MARGIN : rect.bottom + MARGIN;
  // Position horizontale centrée sur la cellule
  let left = rect.left + rect.width / 2;

  // Clamp horizontal pour ne jamais déborder
  const minLeft = TIP_W / 2 + MARGIN;
  const maxLeft = window.innerWidth - TIP_W / 2 - MARGIN;
  left = Math.max(minLeft, Math.min(maxLeft, left));

  // Clamp vertical de sécurité
  top = Math.max(MARGIN, Math.min(window.innerHeight - TIP_H - MARGIN, top));

  setHoverTip({
    left,
    top,
    content: { client: r.client_name, start: r.start_date, end: r.end_date }
  });
}

function hideTip() {
  setHoverTip(null);
}

  const monthDays = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });

  return (
    <div className="max-w-6xl mx-auto p-6 bg-gray-50 rounded-xl shadow-md overflow-visible relative z-10">

      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6">
        <h1 className="text-3xl font-extrabold text-indigo-700">🚗 Réservation Parking</h1>
        <div className="bg-indigo-100 text-indigo-800 p-3 rounded-lg shadow text-sm mt-3 sm:mt-0">
          <p className="font-medium">📏 <strong>Box9</strong> — H: 1.86m, L: 2.3m, P: 5m</p>
          <p className="font-medium">📏 <strong>Box24</strong> — H: 1.84m, L: 2.22m, P: 4.76m</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="col-span-1">
          <label className="block text-sm text-gray-700 font-medium">Nom du client</label>
          <input className="w-full border border-gray-300 p-2 rounded-md" value={clientName} onChange={e => setClientName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm text-gray-700 font-medium">Date de début</label>
          <input type="date" className="w-full border border-gray-300 p-2 rounded-md" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm text-gray-700 font-medium">Date de fin</label>
          <input type="date" className="w-full border border-gray-300 p-2 rounded-md" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
      </div>

      <h2 className="text-xl font-semibold text-gray-800 mb-2">🅿️ Choisir une place</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
        {parkings.map(p => (
          <div key={p.id} className={`border rounded p-3 cursor-pointer ${selectedParking === p.id ? 'bg-indigo-100 border-indigo-500' : 'bg-white hover:bg-gray-50'}`}>
            <label className="flex items-center gap-2">
              <input type="radio" name="parking" value={p.id} checked={selectedParking === p.id} onChange={() => setSelectedParking(p.id)} /> {p.name}
            </label>
          </div>
        ))}
      </div>

      <button className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-md font-semibold transition" onClick={handleReservation}>
        {editingId ? "✏️ Mettre à jour" : "📌 Réserver"}
      </button>

      {message && <p className="mt-4 text-sm text-center text-green-700 font-medium">{message}</p>}

      <hr className="my-8" />
      <div className="flex justify-between items-center mb-4">
        <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="text-indigo-600 hover:underline">⬅ Mois précédent</button>
        <h2 className="text-xl font-bold text-gray-700">{format(currentMonth, 'MMMM yyyy')}</h2>
        <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="text-indigo-600 hover:underline">Mois suivant ➡</button>
      </div>

     <div className="relative z-20 overflow-x-auto overflow-y-visible rounded-lg border border-gray-200">

  <table className="table-auto w-full text-sm">
    <thead className="bg-gray-100 sticky top-0 z-20">
      <tr>
        <th className="border px-3 py-2 sticky left-0 bg-gray-100 z-30">Place</th>
        {monthDays.map((day) => (
          <th key={day.toISOString()} className="border px-3 py-2 whitespace-nowrap">
            {format(day, 'd')}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {parkings.map(p => (
        <tr key={p.id} className="text-center">
          <td className="border px-2 py-1 font-medium bg-gray-50 sticky left-0 z-10">
            {p.name}
          </td>

          {monthDays.map(day => {
            const r = reservations.find(r =>
  r.parking_id === p.id &&
  r.start_date && r.end_date && // garde-fou
  isWithinInterval(day, { start: parseISO(r.start_date), end: parseISO(r.end_date) })
);
            const isStart = r && isSameDay(day, parseISO(r.start_date));
            const isEnd   = r && isSameDay(day, parseISO(r.end_date));

            return (
              <td
  key={day.toISOString()}
  onClick={() => r && setPopupReservation(r)}
  onMouseEnter={(e) => r && showTip(e, r)}
  onMouseLeave={hideTip}
  className={[
    "border px-2 py-1 cursor-pointer select-none align-middle",
    r ? "bg-red-100 text-red-800" : "bg-green-50 text-green-800",
    r && isStart ? "rounded-l-full" : "",
    r && isEnd ? "rounded-r-full" : ""
  ].join(" ")}
>
  {r ? "🚫" : "✅"}
</td>

            );
          })}
        </tr>
      ))}
    </tbody>
  </table>
</div>



      {popupReservation && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl shadow-lg max-w-sm w-full">
            <h3 className="font-bold text-lg mb-4 text-indigo-700">🔍 Détails de la réservation</h3>
            <p><strong>Client :</strong> {popupReservation.client_name}</p>
            <p><strong>Place :</strong> {parkings.find(p => p.id === popupReservation.parking_id)?.name}</p>
            <p><strong>Du :</strong> {popupReservation.start_date}</p>
            <p><strong>Au :</strong> {popupReservation.end_date}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="bg-yellow-400 text-white px-3 py-1 rounded" onClick={() => handleEdit(popupReservation)}>✏️ Modifier</button>
              <button className="bg-red-500 text-white px-3 py-1 rounded" onClick={() => handleDelete(popupReservation.id)}>🗑️ Supprimer</button>
              <button className="bg-gray-300 px-3 py-1 rounded" onClick={() => setPopupReservation(null)}>Fermer</button>
            </div>
          </div>
        </div>
      )}
      {hoverTip && (
  <div
    className="fixed z-[99999] pointer-events-none"
    style={{ left: hoverTip.left, top: hoverTip.top, transform: 'translateX(-50%)' }}
    role="tooltip"
  >
    <div className="bg-white border border-gray-300 px-3 py-2 rounded-xl shadow-xl text-xs text-gray-900 whitespace-pre-line">
      <div className="font-semibold">{hoverTip.content.client}</div>
      <div>Du {hoverTip.content.start}</div>
      <div>Au {hoverTip.content.end}</div>
    </div>
  </div>
)}

    </div>
  );
}
