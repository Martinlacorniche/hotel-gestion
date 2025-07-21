"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { addDays, format, startOfWeek, isWithinInterval, differenceInCalendarDays } from 'date-fns';

import { useRouter } from 'next/navigation';
import { Lock, Unlock, ArrowDown, ArrowUp, Plus } from 'lucide-react';
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { fr } from 'date-fns/locale';







const SERVICE_ROWS = [
  { id: 'service-direction', name: 'Direction', color: 'bg-red-100' },
  { id: 'service-front', name: 'Front office', color: 'bg-blue-100' },
  { id: 'service-housekeeping', name: 'Housekeeping', color: 'bg-green-100' },
  { id: 'service-fb', name: 'F&B', color: 'bg-yellow-100' },
];

const SHIFT_OPTIONS = [
  { label: "Réception matin", value: "Réception matin", color: "bg-blue-100 text-blue-900" },
  { label: "Réception soir", value: "Réception soir", color: "bg-indigo-500 text-white" },
  { label: "Night", value: "Night", color: "bg-gray-200 text-gray-800" },
  { label: "Présence", value: "Présence", color: "bg-violet-400 text-violet-900" },
  { label: "Housekeeping Chambre", value: "Housekeeping Chambre", color: "bg-green-100 text-green-800" },
  { label: "Housekeeping Communs", value: "Housekeeping Communs", color: "bg-green-200 text-green-900" },
  { label: "Petit Déjeuner", value: "Petit Déjeuner", color: "bg-yellow-100 text-yellow-900" },
  { label: "Extra", value: "Extra", color: "bg-purple-100 text-purple-900" },
  { label: "CP", value: "CP", color: "bg-pink-100 text-pink-700" },
  { label: "Maladie", value: "Maladie", color: "bg-red-100 text-red-800" },
  { label: "Injustifié", value: "Injustifié", color: "bg-orange-100 text-orange-900" },
  { label: "Repos", value: "Repos", color: "bg-gray-200 text-gray-400" },
  { label: "Les Voiles", value: "Les Voiles", color: "bg-White-200 text-black-400" },
];

const getShiftColor = (shift) => SHIFT_OPTIONS.find(opt => opt.value === shift)?.color || '';

const getEntry = (entries = [], userId, date) => {
  if (!Array.isArray(entries)) return null;
  return entries.find(p => p.user_id === userId && p.date === format(date, 'yyyy-MM-dd'));
};

export default function PlanningPage() {
  const { user, isLoading } = useAuth();
  const isAdmin = user?.role === 'admin';

  

  const router = useRouter();
  const [hotels, setHotels] = useState([]);
const [selectedHotelId, setSelectedHotelId] = useState(user?.hotel_id || '');
const [currentHotel, setCurrentHotel] = useState(null);
const hotelId = isAdmin ? selectedHotelId : user?.hotel_id;


  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [planningEntries, setPlanningEntries] = useState([]);
  const [cpRequests, setCpRequests] = useState([]);
  const [showCpAdminModal, setShowCpAdminModal] = useState(false);
const [showCpModal, setShowCpModal] = useState(false);
const [cpStartDate, setCpStartDate] = useState('');
const [cpEndDate, setCpEndDate] = useState('');
const [cpComment, setCpComment] = useState('');
const [isSendingCp, setIsSendingCp] = useState(false);

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const [shiftInput, setShiftInput] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [useAsDefault, setUseAsDefault] = useState(false);
  const [defaultHours, setDefaultHours] = useState({});

  const [draggedShift, setDraggedShift] = useState(null);

  const [cutMode, setCutMode] = useState(false);

  const loadCpRequests = async () => {
  const { data, error } = await supabase
    .from('cp_requests')
    .select('*')
    .order('created_at', { ascending: false });
  setCpRequests(data || []);
};

  // Pour accepter une demande (change juste le statut)
const handleAcceptCp = async (req) => {
  await supabase.from('cp_requests').update({ status: 'approved' }).eq('id', req.id);
  loadCpRequests(); // recharge la liste après modification
};

// Pour refuser une demande (change juste le statut)
const handleRefuseCp = async (req) => {
  await supabase.from('cp_requests').update({ status: 'refused' }).eq('id', req.id);
  loadCpRequests();
};

// Pour supprimer une demande (supprime la ligne)
const handleDeleteCp = async (id) => {
  await supabase.from('cp_requests').delete().eq('id', id);
  loadCpRequests();
};
const handleSendCpRequest = async () => {
  if (!cpStartDate || !cpEndDate) {
    alert('Merci de renseigner les deux dates.');
    return;
  }
  setIsSendingCp(true);
  const { error } = await supabase.from('cp_requests').insert([{
    user_id: user.id_auth,
    start_date: cpStartDate,
    end_date: cpEndDate,
    commentaire: cpComment,
    status: 'pending',
    created_at: new Date().toISOString(),
    hotel_id: hotelId,
  }]);
  setIsSendingCp(false);
  if (error) {
    alert("Erreur lors de l'envoi. Réessaye.");
  } else {
    setShowCpModal(false);
    setCpStartDate('');
    setCpEndDate('');
    setCpComment('');
    alert('Demande de congé envoyée !');
  }
};


  const [duplicationSource, setDuplicationSource] = useState(null); // salarié cliqué
const [duplicationTargetIds, setDuplicationTargetIds] = useState([]);
const [targetStartDate, setTargetStartDate] = useState(null); // date du lundi de destination
const [isDuplicationModalOpen, setIsDuplicationModalOpen] = useState(false);
const openDuplicationModal = (user) => {
  setDuplicationSource(user);
  setDuplicationTargetIds([user.id_auth]); // Par défaut, sélectionne soi-même
  setTargetStartDate(currentWeekStart);
  setIsDuplicationModalOpen(true);
};

const exportPDF = () => {
  const doc = new jsPDF();
  const month = currentWeekStart.getMonth();
  const year = currentWeekStart.getFullYear();

  // Calcule les bornes du mois
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);

  // Filtre les shifts du mois affiché
  const entriesForMonth = planningEntries.filter(entry => {
    const entryDate = new Date(entry.date);
    return entryDate >= start && entryDate <= end;
  });

  // Fonctions de tri
  const isWorked = (type) => !['Repos', 'CP', 'Maladie', 'Injustifié'].includes(type);
  const isCp = (type) => type === 'CP';
  const isMaladie = (type) => type === 'Maladie';
  const isInjustifie = (type) => type === 'Injustifié';

  // Regroupe par salarié
  const userStats = users.map(user => {
    const entries = entriesForMonth.filter(e => e.user_id === user.id_auth);

    let workedDays = 0, workedHours = 0, cp = 0, maladie = 0, injustifie = 0;

    for (const entry of entries) {
      if (isWorked(entry.shift)) {
        workedDays++;
        if (entry.start_time && entry.end_time) {
          const [sh, sm] = entry.start_time.split(":").map(Number);
          const [eh, em] = entry.end_time.split(":").map(Number);
          let minutes = (eh * 60 + em) - (sh * 60 + sm);
          if (minutes < 0) minutes += 24 * 60; // Shift nuit
          workedHours += minutes / 60;
        }
      }
      if (isCp(entry.shift)) cp++;
      if (isMaladie(entry.shift)) maladie++;
      if (isInjustifie(entry.shift)) injustifie++;
    }

    return {
      nom: user.name || user.email,
      workedDays,
      workedHours: Math.round(workedHours * 100) / 100,
      cp,
      maladie,
      injustifie,
    };
  });

  // Génère le PDF
  doc.text(`Récapitulatif du mois de ${month + 1}/${year}`, 14, 15);
  autoTable(doc,{
    startY: 22,
    head: [[
      "Salarié",
      "Jours travaillés",
      "Heures travaillées",
      "CP",
      "Maladie",
      "Injustifié"
    ]],
    body: userStats.map(u => [
      u.nom,
      u.workedDays,
      u.workedHours,
      u.cp,
      u.maladie,
      u.injustifie
    ]),
    theme: "grid",
    styles: { fontSize: 10 },
    headStyles: { fillColor: [245, 85, 85] }
  });
  doc.save(`recap-heures-${month + 1}-${year}.pdf`);
};

const closeDuplicationModal = () => {
  setIsDuplicationModalOpen(false);
  setDuplicationSource(null);
};
const targetWeekStart = targetStartDate ? startOfWeek(targetStartDate, { weekStartsOn: 1 }) : null;
const targetWeekEnd = targetWeekStart ? addDays(targetWeekStart, 6) : null;



  const quarterHours = ['00', '15', '30', '45'];

  const handleShiftDrop = async (targetUserId, targetDate) => {
  if (!isAdmin || !draggedShift) return;

  const { userId: sourceUserId, date: sourceDate } = draggedShift;

  



  const existingTarget = planningEntries.find(
    e => e.user_id === targetUserId && e.date === targetDate
  );

  if (existingTarget) {
    const confirmReplace = window.confirm("Un shift existe déjà à cette date. Le remplacer ?");
    if (!confirmReplace) {
      setDraggedShift(null);
      return;
    }
  }

  const sourceEntry = planningEntries.find(
    e => e.user_id === sourceUserId && e.date === sourceDate
  );
  if (!sourceEntry) return;

  const payload = {
    user_id: targetUserId,
    date: targetDate,
    shift: sourceEntry.shift,
    start_time: sourceEntry.start_time,
    end_time: sourceEntry.end_time,
    hotel_id: hotelId,
  };

  await supabase.from('planning_entries')
    .upsert(payload, { onConflict: ['user_id', 'date'] });

  if (cutMode) {
    await supabase.from('planning_entries')
      .delete()
      .eq('user_id', sourceUserId)
      .eq('date', sourceDate);
  }

  const { data: updatedEntries } = await supabase.from('planning_entries').select('*');
  setPlanningEntries(updatedEntries);

  setDraggedShift(null);
};

const handleDuplicateWeek = async () => {
  if (!duplicationSource || !targetStartDate || !duplicationTargetIds.length) return;

  const sourceStart = currentWeekStart;
  const sourceEnd = addDays(currentWeekStart, 6);
  const targetStart = startOfWeek(targetStartDate, { weekStartsOn: 1 });

  const shiftsToCopy = planningEntries.filter((entry) =>
    entry.user_id === duplicationSource.id_auth &&
    isWithinInterval(new Date(entry.date), {
      start: sourceStart,
      end: sourceEnd,
    })
  );

  console.log("shiftsToCopy dates : ", shiftsToCopy.map(e => e.date + ' (' + new Date(e.date).toLocaleDateString('fr-FR', { weekday: 'long' }) + ')'));

  let allEntries = [];
  for (const targetId of duplicationTargetIds) {
    allEntries = allEntries.concat(
      shiftsToCopy.map((entry) => {
        const originalDate = new Date(entry.date);
        const jsDay = originalDate.getDay();
        const newDate = addDays(targetStart, jsDay);
        console.log(
          `[DEBUG] Source: ${entry.date} (${originalDate.toLocaleDateString('fr-FR', { weekday: 'long' })})  =>  Cible: ${newDate.toISOString().slice(0,10)} (${newDate.toLocaleDateString('fr-FR', { weekday: 'long' })})`
        );
        return {
          user_id: targetId,
          date: newDate.toISOString().slice(0, 10),
          shift: entry.shift,
          start_time: entry.start_time,
          end_time: entry.end_time,
          hotel_id: hotelId,
        };
      })
    );
  }

  const { error } = await supabase
    .from('planning_entries')
    .upsert(allEntries, { onConflict: ['user_id', 'date'] });

  if (error) {
    alert("Erreur pendant la duplication.");
    console.error(error);
  } else {
    const { data: updated } = await supabase.from('planning_entries').select('*');
    setPlanningEntries(updated);
    setSuccessMessage('✅ Duplication réussie');
    closeDuplicationModal();
    setTimeout(() => setSuccessMessage(''), 3000);
  }
};



const [successMessage, setSuccessMessage] = useState('');

  const weekDates = useMemo(() => (
    Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i))
  ), [currentWeekStart]);

  const calculateDuration = (start, end) => {
  if (!start || !end) return '0h00';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);

  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;
  const diff = endMinutes - startMinutes;

  if (diff <= 0) return '0h00';

  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;

  return `${hours}h${String(minutes).padStart(2, '0')}`;
};



  const getWeeklyHours = (userId) => {
  const userEntries = planningEntries.filter(
    e => e.user_id === userId && weekDates.some(d => format(d, 'yyyy-MM-dd') === e.date)
  );

  const totalMinutes = userEntries
    .filter(e =>
      e.shift !== 'Repos' &&
      e.shift !== 'Injustifié'
    )
    .reduce((total, entry) => {
      if (!entry.start_time || !entry.end_time) return total;
      const [sh, sm] = entry.start_time.split(':').map(Number);
      const [eh, em] = entry.end_time.split(':').map(Number);
      const minutes = (eh * 60 + em) - (sh * 60 + sm);
      return total + (minutes > 0 ? minutes : 0);
    }, 0);

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours}h${String(minutes).padStart(2, '0')}`;
};


const getWorkingDays = (userId) => {
  const excludedShifts = ['Repos', 'Maladie', 'CP', 'Injustifié'];
  const userEntries = planningEntries.filter(
    e => e.user_id === userId && weekDates.some(d => format(d, 'yyyy-MM-dd') === e.date)
  );

  const daysWorked = userEntries
    .filter(e => e.shift && !excludedShifts.includes(e.shift))
    .map(e => e.date);

  return [...new Set(daysWorked)].length;
};

useEffect(() => {
  if (isAdmin) {
    supabase.from('hotels').select('id, nom').then(({ data }) => {
      setHotels(data || []);
      // Si pas encore sélectionné, on met le premier hôtel de la liste
      if (!selectedHotelId && data && data.length > 0) {
        setSelectedHotelId(data[0].id);
      }
    });
  }
}, [isAdmin]);

useEffect(() => {
  if (selectedHotelId) {
    supabase.from('hotels').select('id, nom').eq('id', selectedHotelId).single()
      .then(({ data }) => setCurrentHotel(data));
  }
}, [selectedHotelId]);

useEffect(() => {
  if (hotelId) loadInitialData();
  // eslint-disable-next-line
}, [hotelId]);


useEffect(() => {
  if (isAdmin) {
    loadCpRequests();
  }
}, [isAdmin]);


 useEffect(() => {
  if (!user) return;
  loadInitialData();
}, [user]);

const moveRow = async (index, direction) => {
  const newRows = [...rows];
  const targetIndex = direction === 'up' ? index - 1 : index + 1;

  if (targetIndex < 0 || targetIndex >= newRows.length) return;

  // Échange les lignes dans l'état local
  const temp = newRows[index];
  newRows[index] = newRows[targetIndex];
  newRows[targetIndex] = temp;

  setRows(newRows);

  // Met à jour TOUS les ordres en BDD (employés ET services)
  const updates = [];
  let ordre = 0;
  for (const row of newRows) {
    if (row.id_auth) {
      // Employé
      updates.push(
        supabase
          .from('planning_config')
          .update({ ordre })
          .eq('user_id', row.id_auth)
      );
      ordre++;
    } else if (row.id) {
      // Service
      updates.push(
        supabase
          .from('planning_config')
          .update({ ordre })
          .eq('service_id', row.id)
      );
      ordre++;
    }
  }

  await Promise.all(updates);

  // Recharge les données depuis la BDD
  await loadInitialData();
};





const loadInitialData = async () => {
  const [usersRes, configRes, entriesRes, cpRes, defaultShiftsRes] = await Promise.all([
    supabase.from('users').select('*').eq('hotel_id', hotelId),
supabase.from('planning_config').select('*').eq('hotel_id', hotelId),
supabase.from('planning_entries').select('*').eq('hotel_id', hotelId),
supabase.from('cp_requests').select('*').eq('status', 'pending').eq('hotel_id', hotelId),

    supabase.from('default_shift_hours').select('*')
  ]);

  const usersData = usersRes.data || [];
  const configData = configRes.data || [];
  const entriesData = entriesRes.data || [];
  const cpData = cpRes.data || [];
  const defaultShiftData = defaultShiftsRes.data || [];

  const usersWithOrder = usersData.map(u => {
    const conf = configData.find(c => c.user_id === u.id_auth);
    return { ...u, ordre: conf?.ordre ?? 9999 };
  });

  const existingServiceRows = configData.filter(c => c.service_id);
  const serviceRows = SERVICE_ROWS.map((srv, i) => {
    const conf = existingServiceRows.find(s => s.service_id === srv.id);
    return { ...srv, ordre: conf?.ordre ?? i };
  });

  const allRows = [...serviceRows, ...usersWithOrder].sort((a, b) => a.ordre - b.ordre);

  const defaultsMap = {};
  defaultShiftData.forEach(d => {
    defaultsMap[d.shift_name] = { start: d.start_time, end: d.end_time };
  });

  setUsers(usersWithOrder);
  setPlanningEntries(entriesData);
  setCpRequests(cpData);
  setRows(allRows);
  setDefaultHours(defaultsMap);
};


  useEffect(() => {
    if (shiftInput && defaultHours[shiftInput]) {
      setStartTime(defaultHours[shiftInput].start);
      setEndTime(defaultHours[shiftInput].end);
    }
  }, [shiftInput]);

  const handleDeleteShift = async (entryId) => {
  await supabase.from('planning_entries').delete().eq('id', entryId);
  // Recharge le planning après suppression
  const { data: updatedEntries } = await supabase.from('planning_entries').select('*');
  setPlanningEntries(updatedEntries);
};


  const handleCellClick = (userId, date, currentShift) => {
    if (!isAdmin) return;
    setEditingCell({ userId, date });
    setShiftInput(currentShift);
    setShowShiftModal(true);
  };

  const saveShift = async () => {
  if (!editingCell) return;
  const { userId, date } = editingCell;

  const payload = {
    user_id: userId,
    date,
    shift: shiftInput,
    start_time: startTime,
    end_time: endTime,
    hotel_id: hotelId,
  };

  const existing = planningEntries.find(p => p.user_id === userId && p.date === date);

  const upsertShift = existing
    ? supabase.from('planning_entries').update(payload).eq('user_id', userId).eq('date', date)
    : supabase.from('planning_entries').insert(payload);

  const defaultUpdate = useAsDefault && shiftInput
    ? supabase.from('default_shift_hours').upsert({
        shift_name: shiftInput,
        start_time: startTime,
        end_time: endTime,
      }, { onConflict: ['shift_name'] })
    : Promise.resolve();

  await Promise.all([upsertShift, defaultUpdate]);

  // Recharge uniquement les shifts (pas besoin de tout recharger)
  const { data: updatedEntries } = await supabase.from('planning_entries').select('*');
  setPlanningEntries(updatedEntries || []);

  // Met à jour localement les horaires par défaut (optionnel mais utile)
  if (useAsDefault && shiftInput) {
    setDefaultHours(prev => ({
      ...prev,
      [shiftInput]: { start: startTime, end: endTime }
    }));
  }

  // Reset de l'état
  setEditingCell(null);
  setShiftInput('');
  setShowShiftModal(false);
  setUseAsDefault(false);
};


  if (isLoading) return <div className="p-4">Chargement...</div>;
  if (!user) {
    router.push('/login');
    return null;
  }

  return (
    <div className="bg-white rounded-2xl shadow-2xl px-6 py-10 max-w-7xl mx-auto mt-10">
      {isAdmin && hotels.length > 0 && (
  <div className="mb-6 flex items-center gap-2">
    <label htmlFor="select-hotel" className="font-semibold text-gray-700">Hôtel :</label>
    <select
      id="select-hotel"
      value={selectedHotelId}
      onChange={e => setSelectedHotelId(e.target.value)}
      className="border rounded px-3 py-2"
    >
      {hotels.map(h => (
        <option key={h.id} value={h.id}>{h.nom}</option>
      ))}
    </select>
  </div>
)}
<h1 className="text-3xl font-bold mb-8 tracking-tight text-indigo-500">
  Planning {currentHotel?.nom || ''}
</h1>


      {user?.role !== 'admin' && (
  <button
    className="bg-yellow-100 hover:bg-yellow-200 text-yellow-900 rounded-xl px-4 py-2 font-semibold shadow mb-6"
    onClick={() => setShowCpModal(true)}
  >
    Demander un CP
  </button>
)}

      {successMessage && (
  <div className="mb-4 text-green-600 font-medium text-sm">
    {successMessage}
  </div>
)}

      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-8">
  <button
    className="rounded-xl bg-white shadow px-4 py-2 text-gray-700 hover:bg-indigo-100 hover:text-indigo-700 transition font-semibold flex items-center gap-2"
    onClick={() => setCurrentWeekStart(prev => addDays(prev, -7))}
  >
    <span className="text-lg">◀</span> Semaine précédente
  </button>
  <div className="text-xl font-semibold tracking-tight bg-indigo-50 px-4 py-2 rounded-full shadow">
    Semaine du {format(currentWeekStart, 'dd/MM/yyyy')}
  </div>
  <button
    className="rounded-xl bg-white shadow px-4 py-2 text-gray-700 hover:bg-indigo-100 hover:text-indigo-700 transition font-semibold flex items-center gap-2"
    onClick={() => setCurrentWeekStart(prev => addDays(prev, 7))}
  >
    Semaine suivante <span className="text-lg">▶</span>
  </button>
</div>



      {isAdmin && (
  <div className="flex items-center gap-2 mb-4">
    <button
  className="flex items-center gap-1 text-sm px-4 py-2 rounded-xl bg-gray-100 shadow hover:bg-indigo-50 hover:text-indigo-700 transition font-semibold"
  onClick={() => setIsUnlocked(!isUnlocked)}
>
  {isUnlocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
  {isUnlocked ? 'Déverrouillé' : 'Verrouillé'}
</button>


    <button
  onClick={() => setCutMode(!cutMode)}
  className={`text-sm px-4 py-2 rounded-xl shadow font-semibold transition ${
    cutMode ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700 hover:bg-indigo-50 hover:text-indigo-700'
  }`}
>
  {cutMode ? '✂️ Mode Couper activé' : 'Activer mode Couper'}
</button>
    {isAdmin && (
  <button
  onClick={exportPDF}
  className="px-4 py-2 bg-indigo-600 text-white rounded-xl shadow hover:bg-indigo-700 transition font-semibold"
>
  Export PDF
</button>

)}

{isAdmin && (
  <button
    onClick={() => setShowCpAdminModal(true)}
    className="relative bg-yellow-100 hover:bg-yellow-200 text-yellow-900 rounded-xl px-4 py-2 font-semibold shadow flex items-center gap-2"
  >
    Demandes de CP
    {cpRequests.length > 0 && (
      <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
        {cpRequests.length}
      </span>
    )}
  </button>
)}
{showCpAdminModal && (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
    <div className="bg-white rounded-2xl p-8 shadow-2xl w-full max-w-xl space-y-6 border">
      <h2 className="text-2xl font-bold mb-4 text-yellow-900">Demandes de congé payés</h2>
      {cpRequests.length === 0 ? (
        <div className="text-gray-500">Aucune demande en attente</div>
      ) : (
        <div className="max-h-96 overflow-y-auto space-y-2">
          {cpRequests.map(req => (
            <div key={req.id} className="border p-4 rounded-xl flex flex-col gap-2 bg-yellow-50">
              <div>
                <span className="font-bold">{users.find(u => u.id_auth === req.user_id)?.name || 'Utilisateur'}</span>
              </div>
              <div>Du <span className="font-semibold">{req.start_date}</span> au <span className="font-semibold">{req.end_date}</span></div>
              {req.commentaire && <div className="italic">{req.commentaire}</div>}
              <div>
                Statut : <span className="font-bold">
                  {req.status === "pending" ? "En attente" : req.status === "approved" ? "Acceptée" : "Refusée"}
                </span>
              </div>
              <div className="flex gap-2 mt-2">
                {req.status === "pending" && (
                  <>
                    <button
                      className="px-3 py-1 bg-green-500 text-white rounded shadow font-semibold"
                      onClick={() => handleAcceptCp(req)}
                    >Accepter</button>
                    <button
                      className="px-3 py-1 bg-red-500 text-white rounded shadow font-semibold"
                      onClick={() => handleRefuseCp(req)}
                    >Refuser</button>
                  </>
                )}
                <button
                  className="px-3 py-1 bg-gray-300 text-gray-700 rounded shadow font-semibold ml-auto"
                  onClick={() => handleDeleteCp(req.id)}
                >Supprimer</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <button
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl shadow font-semibold"
          onClick={() => setShowCpAdminModal(false)}
        >Fermer</button>
      </div>
    </div>
  </div>
)}

  </div>
)}

      <div className="overflow-x-auto">
        <table className="min-w-full bg-white rounded-2xl shadow-xl overflow-hidden">
          <thead>
  <tr className="bg-gray-50">
    <th className="px-4 py-3 text-left font-bold text-gray-700 text-base">Salarié</th>
    {weekDates.map(date => (
      <th
        key={date.toISOString()}
        className="px-4 py-3 text-center font-bold text-gray-700 text-base"
      >
        {format(date, 'EEEE dd/MM', { locale: fr })}
      </th>
    ))}
  </tr>
</thead>

          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id || row.id_auth} className={row.color || ''}>
                <td className="border p-2 font-semibold">
                  <div className="flex items-center justify-between">
                    <div>
  <div>{row.name || row.email}</div>
  {row.id_auth && (
    <div className="text-xs text-gray-600 mt-1 flex items-center gap-2">
  <span>{getWeeklyHours(row.id_auth)} — {getWorkingDays(row.id_auth)}j</span>

  {isAdmin && (
    <button
      onClick={() => openDuplicationModal(row)}
      className="text-indigo-600 hover:underline"
    >
      📋
    </button>
  )}
</div>

  )}
</div>

                    {isAdmin && isUnlocked && (
  <div className="flex flex-col gap-1">
    <button
      className="text-xs hover:text-black text-gray-500"
      onClick={async () => await moveRow(index, 'up')}
      title="Monter"
    >
      <ArrowUp className="w-4 h-4" />
    </button>
    <button
      className="text-xs hover:text-black text-gray-500"
      onClick={async () => await moveRow(index, 'down')}
      title="Descendre"
    >
      <ArrowDown className="w-4 h-4" />
    </button>
  </div>
)}

                  </div>
                </td>
                {weekDates.map(date => {
                  const formatted = format(date, 'yyyy-MM-dd');
                  const entry = row.id_auth ? getEntry(planningEntries, row.id_auth, formatted) : null;

                  return (
                    <td
  key={`${row.id || row.id_auth}-${date.toISOString()}`}
  className={
    row.id_auth
      ? `px-4 py-3 text-center text-sm bg-white rounded-xl transition hover:scale-[1.04] hover:z-10 cursor-pointer shadow-sm ${getShiftColor(entry?.shift || '')} ${isAdmin ? 'hover:bg-indigo-50' : ''}`
      : `px-4 py-3 text-center text-sm bg-gray-100 font-bold text-gray-700` // lignes “poste” sobres, grises, pas d'effet
  }
  onDragOver={(e) => e.preventDefault()}
  onDrop={() => handleShiftDrop(row.id_auth, formatted)}
>

                      {entry?.shift ? (
  <div
    draggable={isAdmin}
    onDragStart={() => setDraggedShift({ userId: row.id_auth, date: formatted })}
    onClick={() => handleCellClick(row.id_auth, formatted, entry?.shift)}
    className="cursor-pointer leading-tight relative group flex flex-col items-center"
  >
    <div className={`inline-block px-3 py-1 rounded-xl font-medium text-sm mb-1 shadow ${getShiftColor(entry?.shift || '')}`}>
      {entry.shift}
    </div>
    {entry.shift !== 'Repos' && (
      <div className="text-xs text-gray-700">
        {entry.start_time?.slice(0, 5)} - {entry.end_time?.slice(0, 5)}
      </div>
    )}
    {/* Croix admin ... */}
    {isAdmin && (
      <button
        onClick={e => {
          e.stopPropagation();
          handleDeleteShift(entry.id);
        }}
        title="Supprimer ce shift"
        className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full hover:bg-red-100"
        style={{ zIndex: 10 }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 20 20"
          fill="none"
          className="text-gray-400 hover:text-red-500"
          xmlns="http://www.w3.org/2000/svg"
        >
          <line x1="5" y1="5" x2="15" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <line x1="15" y1="5" x2="5" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>
    )}
  </div>
) : (


  isAdmin && row.id_auth ? (
    <button
      onClick={() => handleCellClick(row.id_auth, formatted, '')}
      className="text-gray-400 hover:text-black"
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => handleShiftDrop(row.id_auth, formatted)}
    >
      <Plus className="w-4 h-4 mx-auto" />
    </button>
  ) : null
)}


                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div> 
      {showShiftModal && editingCell && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className="bg-white p-6 rounded-lg space-y-4 w-full max-w-md">
      <h2 className="text-xl font-semibold">Modifier le shift</h2>

      {/* Sélecteur de shift */}
      <select
        className="w-full border px-3 py-2 rounded"
        value={shiftInput}
        onChange={(e) => setShiftInput(e.target.value)}
      >
        <option value="">-</option>
        {SHIFT_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Heures de début et fin */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-sm">Début</label>
          <select
            value={startTime}
            onChange={e => setStartTime(e.target.value)}
            className="w-full border px-2 py-1 rounded"
          >
            {[...Array(24).keys()].flatMap(h =>
              quarterHours.map(m =>
                `${String(h).padStart(2, '0')}:${m}`
              )
            ).map(time => (
              <option key={time} value={time}>{time}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm">Fin</label>
          <select
            value={endTime}
            onChange={e => setEndTime(e.target.value)}
            className="w-full border px-2 py-1 rounded"
          >
            {[...Array(24).keys()].flatMap(h =>
              quarterHours.map(m =>
                `${String(h).padStart(2, '0')}:${m}`
              )
            ).map(time => (
              <option key={time} value={time}>{time}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Case à cocher */}
      <div className="flex items-center gap-2 mt-2">
        <input
          type="checkbox"
          id="useDefault"
          checked={useAsDefault}
          onChange={(e) => setUseAsDefault(e.target.checked)}
        />
        <label htmlFor="useDefault" className="text-sm">
          Utiliser ces horaires comme valeur par défaut pour ce shift
        </label>
      </div>
      {shiftInput !== 'Repos' && (
  <div className="text-sm text-gray-700 text-right">
    Durée prévue : {calculateDuration(startTime, endTime)}
  </div>
)}




      {/* Boutons */}
      <div className="flex justify-end gap-2">
        <button
  className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 shadow hover:bg-indigo-50 hover:text-indigo-700 font-semibold"
  onClick={() => {
    setShowShiftModal(false);
    setEditingCell(null);
    setUseAsDefault(false);
  }}
>
  Annuler
</button>
<button
  className="px-4 py-2 rounded-xl bg-indigo-600 text-white shadow hover:bg-indigo-700 font-semibold"
  onClick={saveShift}
>
  Enregistrer
</button>

            </div>
          </div>
        </div>
      )}
    {isDuplicationModalOpen && (
  <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
    <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
      <h2 className="text-lg font-semibold mb-4">📋 Dupliquer la semaine</h2>

      {/* SELECT MULTI SALARIÉS */}
      <div className="mb-4">
  <label className="block text-sm font-medium mb-1">Vers quel(s) salarié(s) ?</label>
  <div className="space-y-1 max-h-48 overflow-y-auto border rounded p-2">
    {users.map((user) => (
      <label key={user.id_auth} className="flex items-center gap-2">
        <input
          type="checkbox"
          value={user.id_auth}
          checked={duplicationTargetIds.includes(user.id_auth)}
          onChange={e => {
            if (e.target.checked) {
              setDuplicationTargetIds([...duplicationTargetIds, user.id_auth]);
            } else {
              setDuplicationTargetIds(duplicationTargetIds.filter(id => id !== user.id_auth));
            }
          }}
        />
        <span>{user.name || `${user.first_name} ${user.last_name}` || user.email}</span>
      </label>
    ))}
  </div>
</div>


      {/* DATE PICKER */}
      <div className="mb-4">
  <label className="block text-sm font-medium mb-1">Semaine de destination</label>
  <input
  type="date"
  className="w-full border rounded px-2 py-1"
  value={
  targetStartDate
    ? targetStartDate.getFullYear().toString().padStart(4, "0")
      + "-" + (targetStartDate.getMonth() + 1).toString().padStart(2, "0")
      + "-" + targetStartDate.getDate().toString().padStart(2, "0")
    : ''
}

  onChange={e => {
    // Ici, option : tu forces toujours sur un lundi, OU tu laisses la date choisie
    // Pour forcer le lundi : 
    const d = new Date(e.target.value);
    setTargetStartDate(startOfWeek(d, { weekStartsOn: 1 }));
    // Si tu veux laisser la date exacte choisie par l'utilisateur (pas conseillé) :
    // setTargetStartDate(new Date(e.target.value));
  }}
/>

  <div className="text-xs text-gray-500 mt-1">
    
  </div>
  {targetWeekStart && targetWeekEnd && (
    <div className="mb-4 text-sm text-gray-700 bg-gray-100 rounded p-2">
      Semaine de destination :
      <span className="font-semibold ml-2">
        {format(targetWeekStart, "dd/MM/yyyy")} → {format(targetWeekEnd, "dd/MM/yyyy")}
      </span>
    </div>
  )}
</div>


      {/* BOUTONS */}
      <div className="flex justify-end gap-2 mt-6">
        <button
  onClick={closeDuplicationModal}
  className="px-4 py-2 text-sm rounded-xl bg-gray-100 text-gray-600 shadow hover:bg-indigo-50 hover:text-indigo-700 font-semibold"
>
  Annuler
</button>
        <button
  onClick={handleDuplicateWeek}
  className="px-4 py-2 text-sm rounded-xl bg-indigo-600 text-white shadow hover:bg-indigo-700 font-semibold"
>
  Dupliquer
</button>
      </div>
    </div>
  </div>
)}
{showCpModal && (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
    <div className="bg-white rounded-2xl p-8 shadow-2xl w-full max-w-md space-y-6 border">
      <h2 className="text-2xl font-bold mb-4 text-yellow-900">Demande de congé payé</h2>
      <label className="block mb-2 font-semibold">Premier jour d'absence</label>
      <input
        type="date"
        className="w-full border px-3 py-2 rounded mb-4"
        value={cpStartDate}
        onChange={e => setCpStartDate(e.target.value)}
      />
      <label className="block mb-2 font-semibold">Dernier jour d'absence</label>
      <input
        type="date"
        className="w-full border px-3 py-2 rounded mb-4"
        value={cpEndDate}
        onChange={e => setCpEndDate(e.target.value)}
      />
      <label className="block mb-2 font-semibold">Commentaire (optionnel)</label>
      <textarea
        className="w-full border px-3 py-2 rounded mb-4"
        value={cpComment}
        onChange={e => setCpComment(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setShowCpModal(false)}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl shadow font-semibold"
          disabled={isSendingCp}
        >Annuler</button>
        <button
          onClick={handleSendCpRequest}
          className="px-4 py-2 bg-yellow-500 text-white rounded-xl shadow font-semibold"
          disabled={isSendingCp}
        >Envoyer</button>
      </div>
    </div>
  </div>
)}
</div>
);
} 
    

