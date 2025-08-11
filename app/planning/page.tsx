"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { addDays, format, startOfWeek, isWithinInterval, differenceInCalendarDays } from 'date-fns';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { useRouter } from 'next/navigation';
import { Lock, Unlock, ArrowDown, ArrowUp, Plus } from 'lucide-react';
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';








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
const [showMyCpModal, setShowMyCpModal] = useState(false);
const [hasSeenMyCpNotif, setHasSeenMyCpNotif] = useState(false);

  const handleSendCpRequest = async () => {
  if (!user || !cpStartDate || !cpEndDate || !hotelId) return;
  


  setIsSendingCp(true);

  const { error } = await supabase.from('cp_requests').insert({
    user_id: user.id_auth || user.id,
    start_date: cpStartDate,
    end_date: cpEndDate,
    commentaire: cpComment,
    status: 'pending',
    hotel_id: hotelId,
  });

  setIsSendingCp(false);

  if (!error) {
    setSuccessMessage("Demande envoyée ✅");
    setShowCpModal(false);
    setCpComment('');
    // recharge pour voir la demande apparaître
    loadCpRequests();
  } else {
    alert("Erreur lors de l'envoi : " + error.message);
  }
};


  const router = useRouter();
  const [hotels, setHotels] = useState([]);
const [selectedHotelId, setSelectedHotelId] = useState(() => {
  if (typeof window !== "undefined") {
    const fromStorage = window.localStorage.getItem('selectedHotelId');
    if (fromStorage) return fromStorage;
  }
  if (user && user.hotel_id) return user.hotel_id;
  return '';
});
const [currentHotel, setCurrentHotel] = useState(null);
const hotelId = selectedHotelId || user?.hotel_id || '';

useEffect(() => {
  const hotelName = currentHotel?.nom ? ` — ${currentHotel.nom}` : '';
  document.title = `Planning${hotelName}`; // adapte “Planning” -> “Parking”, “Commandes”, ...
}, [currentHotel]);

// Persiste le choix à chaque changement
useEffect(() => {
  if (selectedHotelId && typeof window !== "undefined") {
    window.localStorage.setItem('selectedHotelId', selectedHotelId);
  }
}, [selectedHotelId]);

  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
  const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
  monday.setHours(0,0,0,0);
  return monday;
});


  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [planningEntries, setPlanningEntries] = useState([]);
  const [cpRequests, setCpRequests] = useState([]);
  const [showCpAdminModal, setShowCpAdminModal] = useState(false);
  const [showAllCp, setShowAllCp] = useState(false);
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
const [nbWeeksSource, setNbWeeksSource] = useState(1);
const [nbWeeksTarget, setNbWeeksTarget] = useState(1);


  const [draggedShift, setDraggedShift] = useState(null);
const handleDeleteCp = async (id) => {
  const confirmDelete = confirm("Supprimer cette demande ?");
  if (!confirmDelete) return;

  const { error } = await supabase
    .from('cp_requests')
    .delete()
    .eq('id', id);

  if (error) {
    alert("Erreur lors de la suppression : " + error.message);
  } else {
    loadCpRequests();
  }
};

const handleRefuseCp = async (req) => {
  const confirmRefuse = confirm("Refuser cette demande de CP ?");
  if (!confirmRefuse) return;

  const { error } = await supabase
    .from('cp_requests')
    .update({ status: 'refused' })
    .eq('id', req.id);

  if (error) {
    alert("Erreur lors du refus : " + error.message);
  } else {
    loadCpRequests();
  }
};

  const [cutMode, setCutMode] = useState(false);

  const loadCpRequests = async () => {
  if (!hotelId || typeof hotelId !== "string" || hotelId.length < 10) return;
  const { data, error } = await supabase
    .from('cp_requests')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('created_at', { ascending: false });
  setCpRequests(data || []);
};


// Remplace la fonction existante handleAcceptCp par celle-ci
const handleAcceptCp = async (req) => {
  const start = new Date(req.start_date);
  const end = new Date(req.end_date);
  const userId = req.user_id;

  const ok = confirm(`Tu valides ce CP du ${req.start_date} au ${req.end_date} ?`);
  if (!ok) return;

  // 1) Récupérer tous les shifts existants de l'utilisateur sur la plage
  const { data: existing, error: exErr } = await supabase
    .from('planning_entries')
    .select('id,date')
    .eq('user_id', userId)
    .eq('hotel_id', hotelId);
  if (exErr) {
    alert("Erreur lecture planning : " + exErr.message);
    return;
  }

  // 2) Construire la liste des dates à traiter
  const daysCount = differenceInCalendarDays(end, start) + 1;
  const allDates = Array.from({ length: daysCount }, (_, i) =>
    format(addDays(start, i), 'yyyy-MM-dd')
  );

  const existingByDate = new Map((existing || []).map(e => [e.date, e.id]));
  const conflictingDates = allDates.filter(d => existingByDate.has(d));
  const freeDates       = allDates.filter(d => !existingByDate.has(d));

  // 3) Si conflits, une seule alerte récap
  let replaceConflicts = true;
  if (conflictingDates.length > 0) {
    replaceConflicts = confirm(
      `Un shift existe déjà pour ${conflictingDates.length} jour(s):\n` +
      conflictingDates.join('\n') +
      `\n\nVoulez-vous les remplacer ?`
    );
  }

  // 4) Préparer suppression (si on remplace)
  if (replaceConflicts && conflictingDates.length > 0) {
    const idsToDelete = conflictingDates.map(d => existingByDate.get(d));
    const { error: delErr } = await supabase
      .from('planning_entries')
      .delete()
      .in('id', idsToDelete);
    if (delErr) {
      alert("Erreur suppression anciens shifts : " + delErr.message);
      return;
    }
  }

  // 5) Préparer les insertions : jours libres + (éventuels) jours conflictuels
  const datesToInsert = replaceConflicts ? allDates : freeDates;
  const entriesToInsert = datesToInsert.map(dateStr => ({
    user_id: userId,
    date: dateStr,
    shift: 'CP',
    start_time: '00:00',
    end_time: '00:00',
    hotel_id: hotelId,
  }));

  if (entriesToInsert.length > 0) {
    const { error: insErr } = await supabase
      .from('planning_entries')
      .insert(entriesToInsert);
    if (insErr) {
      alert("Erreur insertion CP : " + insErr.message);
      return;
    }
  }

  // 6) Marquer la demande comme approved
  await supabase.from('cp_requests').update({ status: 'approved' }).eq('id', req.id);

  // 7) Rechargement local
  await loadCpRequests();
  const { data: updated } = await supabase
    .from('planning_entries')
    .select('*')
    .eq('hotel_id', hotelId);
  setPlanningEntries(updated || []);
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
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const month = currentWeekStart.getMonth();
  const year = currentWeekStart.getFullYear();

  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);

  const entriesForMonth = planningEntries.filter(entry => {
    const entryDate = new Date(entry.date);
    return entryDate >= start && entryDate <= end;
  });

  

  // Couleurs associées aux shifts (mêmes que dans ton planning)
  const shiftColors = {
    'Réception matin': [173, 216, 230], // bleu clair
    'Réception soir': [135, 206, 250], // indigo foncé
    'Night': [200, 200, 200], // gris
    'Présence': [238, 130, 238], // violet
    'Housekeeping Chambre': [144, 238, 144], // vert clair
    'Housekeeping Communs': [0, 128, 0], // vert foncé
    'Petit Déjeuner': [255, 255, 102], // jaune
    'Extra': [216, 191, 216], // mauve
    'CP': [255, 182, 193], // rose
    'Maladie': [255, 99, 71], // rouge clair
    'Injustifié': [255, 165, 0], // orange
    'Repos': [220, 220, 220], // gris clair
    'Les Voiles': [0, 0, 0], // noir
  };

  const abbreviateShift = (shift) => {
    switch (shift) {
      case 'Réception matin': return 'RM';
      case 'Réception soir': return 'RS';
      case 'Night': return 'N';
      case 'Présence': return 'P';
      case 'Housekeeping Chambre': return 'HC';
      case 'Housekeeping Communs': return 'HCo';
      case 'Petit Déjeuner': return 'PD';
      case 'Extra': return 'E';
      case 'CP': return 'CP';
      case 'Maladie': return 'M';
      case 'Injustifié': return 'I';
      case 'Repos': return 'R';
      case 'Les Voiles': return 'LV';
      default: return '';
    }
  };

  // PAGE 1 - Récapitulatif
  const userStats = users.map(user => {
    const entries = entriesForMonth.filter(e => e.user_id === user.id_auth);
    let workedDays = 0, workedHours = 0, cp = 0, maladie = 0, injustifie = 0;

    for (const entry of entries) {
      if (!['Repos', 'CP', 'Maladie', 'Injustifié'].includes(entry.shift)) {
        workedDays++;
        if (entry.start_time && entry.end_time) {
          const [sh, sm] = entry.start_time.split(":").map(Number);
          const [eh, em] = entry.end_time.split(":").map(Number);
          let minutes = (eh * 60 + em) - (sh * 60 + sm);
          if (minutes < 0) minutes += 24 * 60;
          workedHours += minutes / 60;
        }
      }
      if (entry.shift === 'CP') cp++;
      if (entry.shift === 'Maladie') maladie++;
      if (entry.shift === 'Injustifié') injustifie++;
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

  doc.setFontSize(14);
  doc.text(`Récapitulatif du mois ${month + 1}/${year}`, 40, 40);
  autoTable(doc, {
    startY: 60,
    head: [["Salarié", "Jours", "Heures", "CP", "Maladie", "Injust." ]],
    body: userStats.map(u => [u.nom, u.workedDays, u.workedHours, u.cp, u.maladie, u.injustifie]),
    theme: "grid",
    styles: { fontSize: 10 },
    headStyles: { fillColor: [245, 85, 85] },
  });

  // PAGE 2 - Planning avec couleurs
  doc.addPage('a4', 'landscape');
  const daysInMonth = Array.from({ length: end.getDate() }, (_, i) => i + 1);

  const planningTable = users.map(user => {
    const row = [user.name || user.email];
    for (let d = 1; d <= daysInMonth.length; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const entry = entriesForMonth.find(e => e.user_id === user.id_auth && e.date === dateStr);
      row.push(entry ? abbreviateShift(entry.shift) : '');
    }
    return row;
  });

  

  const headRow = ["Salarié", ...daysInMonth.map(d => String(d))];
  doc.setFontSize(12);
  doc.text(`Planning détaillé - ${month + 1}/${year}`, 40, 40);
  autoTable(doc, {
    startY: 60,
    head: [headRow],
    body: planningTable,
    theme: "grid",
    styles: { fontSize: 7, cellWidth: 'wrap' },
    headStyles: { fillColor: [66, 133, 244] },
    didParseCell: function (data) {
      if (data.section === 'body' && data.column.index > 0) {
        const shiftName = data.cell.raw;
        const fullShiftName = Object.keys(shiftColors).find(key => abbreviateShift(key) === shiftName);
        if (fullShiftName && shiftColors[fullShiftName]) {
          data.cell.styles.fillColor = shiftColors[fullShiftName];
        }
      }
    }
  });

  doc.save(`planning-${month + 1}-${year}.pdf`);
};




const closeDuplicationModal = () => {
  setIsDuplicationModalOpen(false);
  setDuplicationSource(null);
};
const targetWeekStart = targetStartDate ? startOfWeek(targetStartDate, { weekStartsOn: 1 }) : null;
const targetWeekEnd = targetWeekStart ? addDays(targetWeekStart, 6) : null;



  const quarterHours = ['00', '15', '30', '45'];

  const handleShiftDrop = async (targetUserId, targetDate) => {
  if (!isAdmin || !draggedShift || !hotelId) return;

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

  const { data: updatedEntries } = await supabase
  .from('planning_entries')
  .select('*')
  .eq('hotel_id', hotelId);
setPlanningEntries(updatedEntries || []);



  setDraggedShift(null);
};

const handleDuplicateMultiWeeks = async () => {
  if (!duplicationSource || !targetStartDate || !duplicationTargetIds.length || !hotelId) return;

  let allEntries = [];

  for (let t = 0; t < nbWeeksTarget; t++) {
    // Calcul semaine source correspondante (en cycle)
    const sourceIndex = t % nbWeeksSource;
    const sourceWeekStart = addDays(startOfWeek(currentWeekStart, { weekStartsOn: 1 }), sourceIndex * 7);
    sourceWeekStart.setHours(12, 0, 0, 0);
    const sourceWeekEnd = addDays(sourceWeekStart, 6);
    sourceWeekEnd.setHours(23, 59, 59, 999);

    // Semaine destination
    const targetWeekStart = addDays(startOfWeek(targetStartDate, { weekStartsOn: 1 }), t * 7);
    targetWeekStart.setHours(12, 0, 0, 0);

    // Filtrer shifts source
    const shiftsToCopy = planningEntries.filter((entry) => {
      const d = new Date(entry.date);
      d.setHours(12, 0, 0, 0);
      return (
        entry.user_id === duplicationSource.id_auth &&
        d >= sourceWeekStart &&
        d <= sourceWeekEnd
      );
    });

    // Dupliquer
    for (const targetId of duplicationTargetIds) {
      allEntries = allEntries.concat(
        shiftsToCopy.map((entry) => {
          const originalDate = new Date(entry.date);
          originalDate.setHours(12, 0, 0, 0);
          const dayDiff = differenceInCalendarDays(originalDate, sourceWeekStart);
          const newDate = addDays(targetWeekStart, dayDiff);

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
  }

  const { error } = await supabase
    .from('planning_entries')
    .upsert(allEntries, { onConflict: ['user_id', 'date'] });

  if (error) {
    toast.error("❌ Erreur pendant la duplication");
    console.error(error);
  } else {
    const { data: updated } = await supabase
      .from('planning_entries')
      .select('*')
      .eq('hotel_id', hotelId);
    setPlanningEntries(updated || []);

    toast.success(`✅ Duplication terminée (${nbWeeksSource} semaines source → ${nbWeeksTarget} cibles)`);
    closeDuplicationModal();
  }
};






const [successMessage, setSuccessMessage] = useState('');
const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
const goToPreviousWeek = () => {
  const monday = startOfWeek(addDays(currentWeekStart, -7), { weekStartsOn: 1 });
  monday.setHours(0, 0, 0, 0);
  setCurrentWeekStart(monday);
};

const goToNextWeek = () => {
  const monday = startOfWeek(addDays(currentWeekStart, 7), { weekStartsOn: 1 });
  monday.setHours(0, 0, 0, 0);
  setCurrentWeekStart(monday);
};


  const weekDates = useMemo(() => (
    Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i))
  ), [currentWeekStart]);
const visibleRequests = showAllCp
  ? cpRequests.filter(r => new Date(r.end_date) >= new Date(new Date().setHours(0, 0, 0, 0)))
  : cpRequests.filter(r =>
      r.status === 'pending' &&
      new Date(r.end_date) >= new Date(new Date().setHours(0, 0, 0, 0))
    );


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
    supabase.from('hotels').select('id, nom').then(({ data }) => {
      setHotels(data || []);
      // Si pas encore sélectionné, on met le premier hôtel de la liste
      if (!selectedHotelId && data && data.length > 0) {
        setSelectedHotelId(data[0].id);
      }
    });
  
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
  console.log('Update service', {service_id: row.id, hotelId, ordre});
  updates.push(
    supabase
      .from('planning_config')
      .update({ ordre })
      .eq('user_id', row.id_auth)
      .eq('hotel_id', hotelId)
  );
  ordre++;
} else if (row.id) {
  // Service (attention : service_id ET hotel_id)
  updates.push(
    supabase
      .from('planning_config')
      .update({ ordre })
      .eq('service_id', row.id)
      .eq('hotel_id', hotelId)
  );
  ordre++;
}

}


  await Promise.all(updates);

  // Recharge les données depuis la BDD
  await loadInitialData();
};





const loadInitialData = async () => {
  if (!hotelId || typeof hotelId !== "string" || hotelId.length < 10) return; 
  const [usersRes, configRes, entriesRes, cpRes, defaultShiftsRes] = await Promise.all([
    supabase.from('users').select('*').eq('hotel_id', hotelId),
supabase.from('planning_config').select('*').eq('hotel_id', hotelId),
supabase.from('planning_entries').select('*').eq('hotel_id', hotelId),
supabase.from('cp_requests').select('*').eq('hotel_id', hotelId),


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

  const serviceRows = configData
  .filter(c => c.service_id && c.hotel_id === hotelId)
  .map((conf, i) => {
    // Retrouve le nom/couleur depuis SERVICE_ROWS statique si besoin
    const srvStatic = SERVICE_ROWS.find(s => s.id === conf.service_id);
    return {
      ...srvStatic,
      ...conf,
      id: conf.service_id,
      ordre: conf.ordre ?? i
    };
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
    if (!hotelId || typeof hotelId !== "string" || hotelId.length < 10) return;
  await supabase.from('planning_entries').delete().eq('id', entryId);
  // Recharge le planning après suppression
  const { data: updatedEntries } = await supabase
  .from('planning_entries')
  .select('*')
  .eq('hotel_id', hotelId);
setPlanningEntries(updatedEntries || []);

};


  const handleCellClick = (userId, date, currentShift) => {
    if (!isAdmin) return;
    setEditingCell({ userId, date });
    setShiftInput(currentShift);
    setShowShiftModal(true);
  };

  const saveShift = async () => {
  if (!editingCell || !hotelId) return;
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
  const { data: updatedEntries } = await supabase
  .from('planning_entries')
  .select('*')
  .eq('hotel_id', hotelId);
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
      {hotels.length > 0 && (
  <div className="mb-6 flex items-center gap-4">
    <span className="font-semibold text-gray-700">Hôtel :</span>
    <div className="flex gap-2 flex-wrap">
      {hotels.map((h) => (
        <button
          key={h.id}
          onClick={() => setSelectedHotelId(h.id)}
          className={`px-4 py-2 rounded-lg shadow font-semibold border ${
            h.id === selectedHotelId
              ? 'bg-[#88C9B9] text-white border-[#88C9B9]'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
        >
          {h.nom}
        </button>
      ))}
    </div>
  </div>
)}


<h1 className="text-3xl font-bold mb-8 tracking-tight text-indigo-500">
  Planning {currentHotel?.nom || ''}
</h1>


{user?.role !== 'admin' && (
  <div className="mb-6 flex flex-wrap items-center gap-4">
    <button
      className="bg-yellow-100 hover:bg-yellow-200 text-yellow-900 rounded-xl px-4 py-2 font-semibold shadow"
      onClick={() => {
        setShowCpModal(true);
      }}
    >
      Demander un CP
    </button>

    <div className="relative">
      <button
        className="bg-yellow-100 hover:bg-yellow-200 text-yellow-900 rounded-xl px-4 py-2 font-semibold shadow"

        onClick={() => {
  setShowMyCpModal(true);
  setHasSeenMyCpNotif(true);
}}

      >
        Mes demandes
      </button>

      {!hasSeenMyCpNotif && cpRequests.some(r =>
  (r.user_id === user.id_auth || r.user_id === user.id) &&
  (r.status === 'approved' || r.status === 'refused')
) && (
  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
    !
  </span>
)}

    </div>
  </div>
)}






      {successMessage && (
  <div className="mb-4 text-green-600 font-medium text-sm">
    {successMessage}
  </div>
)}



      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-8">
  <button
    className="rounded-xl bg-white shadow px-4 py-2 text-gray-700 hover:bg-indigo-100 hover:text-indigo-700 transition font-semibold flex items-center gap-2"
    onClick={goToPreviousWeek}

  >
    <span className="text-lg">◀</span> Semaine précédente
  </button>
  <div className="relative">
  <button
    onClick={() => setIsDatePickerOpen(!isDatePickerOpen)}
    className="text-xl font-semibold tracking-tight bg-indigo-50 px-4 py-2 rounded-full shadow hover:bg-indigo-100 transition"
  >
    Semaine du {format(currentWeekStart, 'dd/MM/yyyy')}
  </button>
  {isDatePickerOpen && (
    <div className="absolute top-12 left-1/2 -translate-x-1/2 bg-white border rounded-lg shadow-lg z-50">
      <DatePicker
        inline
        selected={currentWeekStart}
        onChange={(date) => {
  const monday = startOfWeek(date, { weekStartsOn: 1 });
  monday.setHours(0,0,0,0);
  setCurrentWeekStart(monday);
}}

        locale={fr}
        calendarStartDay={1}
      />
    </div>
  )}
</div>

  <button
    className="rounded-xl bg-white shadow px-4 py-2 text-gray-700 hover:bg-indigo-100 hover:text-indigo-700 transition font-semibold flex items-center gap-2"
    onClick={goToNextWeek}

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
    {cpRequests.filter(r => r.status === 'pending').length > 0 && (
  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
    {cpRequests.filter(r => r.status === 'pending').length}
  </span>
)}

  </button>
)}
{showCpAdminModal && (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
    <div className="bg-white rounded-2xl p-8 shadow-2xl w-full max-w-xl space-y-6 border">
      <h2 className="text-2xl font-bold mb-4 text-yellow-900">Demandes de congé payés</h2>
      <div className="flex items-center justify-between">
  <label className="text-sm flex items-center gap-2">
    <input
      type="checkbox"
      checked={showAllCp}
      onChange={() => setShowAllCp(!showAllCp)}
    />
    Tout afficher
  </label>
</div>


      {visibleRequests.length === 0 ? (
        <div className="text-gray-500">Aucune demande en attente</div>
      ) : (
        <div className="max-h-96 overflow-y-auto space-y-2">
          {visibleRequests.map(req => (
            <div key={req.id} className="border p-4 rounded-xl flex flex-col gap-2 bg-yellow-50">
              <div>
                <span className="font-bold">{users.find(u => u.id_auth === req.user_id)?.name || 'Utilisateur'}</span>
              </div>
              <div>Du <span className="font-semibold">{format(new Date(req.start_date), 'dd-MM-yyyy')}</span> au <span className="font-semibold">{format(new Date(req.end_date), 'dd-MM-yyyy')}</span></div>
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
<div className="mb-4">
  <label className="block text-sm font-medium mb-1">Nombre de semaines source à copier</label>
  <input
    type="number"
    min="1"
    className="w-full border rounded px-2 py-1"
    value={nbWeeksSource}
    onChange={e => setNbWeeksSource(parseInt(e.target.value, 10) || 1)}
  />
</div>

<div className="mb-4">
  <label className="block text-sm font-medium mb-1">Nombre de semaines cible</label>
  <input
    type="number"
    min="1"
    className="w-full border rounded px-2 py-1"
    value={nbWeeksTarget}
    onChange={e => setNbWeeksTarget(parseInt(e.target.value, 10) || 1)}
  />
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
  onClick={handleDuplicateMultiWeeks}
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
  min={format(new Date(), 'yyyy-MM-dd')}
  className="w-full border px-3 py-2 rounded mb-4"
  value={cpStartDate}
  onChange={(e) => setCpStartDate(e.target.value)}
/>
      <label className="block mb-2 font-semibold">Dernier jour d'absence</label>
      <input
  type="date"
  min={cpStartDate || format(new Date(), 'yyyy-MM-dd')}
  className="w-full border px-3 py-2 rounded mb-4"
  value={cpEndDate}
  onChange={(e) => setCpEndDate(e.target.value)}
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
{showMyCpModal && (
  <div className="fixed inset-0 z-50 bg-black bg-opacity-30 flex items-center justify-center">
    <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-md">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold">📋 Mes demandes de congé</h2>
        <button
  className="text-sm text-gray-500 hover:text-black transition"
  onClick={() => setShowMyCpModal(false)}
>
  Fermer ✖
</button>
      </div>

      <ul className="space-y-2 text-sm">
        {cpRequests
  .filter(r =>
    (r.user_id === user.id_auth || r.user_id === user.id) &&
    new Date(r.end_date) >= new Date(new Date().setHours(0, 0, 0, 0))
  )
  .map(r => (

            <li key={r.id} className="border rounded p-2 bg-gray-50 flex justify-between items-center">
              <span>
                {format(new Date(r.start_date), 'dd-MM-yyyy')} → {format(new Date(r.end_date), 'dd-MM-yyyy')}
                {r.commentaire && (
                  <span className="text-xs text-gray-500 italic ml-2">
                    ({r.commentaire})
                  </span>
                )}
              </span>
              <span className={`text-sm font-semibold ${
                r.status === 'approved' ? 'text-green-600' :
                r.status === 'refused' ? 'text-red-600' :
                'text-yellow-600'
              }`}>
                {r.status === 'approved' ? '✔ Acceptée' :
                 r.status === 'refused' ? '✖ Refusée' :
                 '⏳ En attente'}
              </span>
            </li>
          ))}
      </ul>
    </div>
  </div>
)}

</div>
);
}

    

