"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { addDays, format, startOfWeek, isWithinInterval, addWeeks, differenceInCalendarDays } from 'date-fns';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { useRouter } from 'next/navigation';
import { 
  Lock, Unlock, ArrowDown, ArrowUp, Plus, Calendar as CalendarIcon, 
  ChevronLeft, ChevronRight, Filter, Printer, Share2, Scissors, Trash2, 
  User, Clock, AlertCircle, Wrench, Copy // <--- AJOUTE "Copy" ICI
} from 'lucide-react';
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';

// --- CONFIGURATION DES COULEURS MODERNISÉES (Style "Badge") ---
const SERVICE_ROWS = [
  { id: 'service-direction', name: 'Direction', color: 'bg-red-50' },
  { id: 'service-front', name: 'Front office', color: 'bg-blue-50' },
  { id: 'service-housekeeping', name: 'Housekeeping', color: 'bg-emerald-50' },
  { id: 'service-fb', name: 'F&B', color: 'bg-amber-50' },
];

const SHIFT_OPTIONS = [
  // RECEPTION (Bleu / Indigo)
  { label: "Réception matin", value: "Réception matin", color: "bg-sky-100 border-l-[5px] border-sky-600 text-sky-900 shadow-sm" },
  { label: "Réception soir", value: "Réception soir", color: "bg-indigo-100 border-l-[5px] border-indigo-600 text-indigo-900 shadow-sm" },
  { label: "Night", value: "Night", color: "bg-slate-800 border-l-[5px] border-indigo-400 text-white shadow-md" }, // Night reste sombre pour le contraste

  // HOUSEKEEPING (Vert / Teal)
  { label: "Housekeeping Chambre", value: "Housekeeping Chambre", color: "bg-emerald-100 border-l-[5px] border-emerald-600 text-emerald-900 shadow-sm" },
  { label: "Housekeeping Communs", value: "Housekeeping Communs", color: "bg-teal-100 border-l-[5px] border-teal-600 text-teal-900 shadow-sm" },
  
  // F&B (Ambre / Orange)
  { label: "Petit Déjeuner", value: "Petit Déjeuner", color: "bg-amber-100 border-l-[5px] border-amber-500 text-amber-900 shadow-sm" },
  { label: "Les Voiles", value: "Les Voiles", color: "bg-blue-900 border-l-[5px] border-amber-400 text-white shadow-md" },
  
  // MAINTENANCE & DIVERS
  { label: "Maintenance", value: "Maintenance", color: "bg-orange-100 border-l-[5px] border-orange-600 text-orange-900 shadow-sm" },
  { label: "Extra", value: "Extra", color: "bg-fuchsia-100 border-l-[5px] border-fuchsia-600 text-fuchsia-900 shadow-sm" },
  { label: "Présence", value: "Présence", color: "bg-violet-100 border-l-[5px] border-violet-600 text-violet-900 shadow-sm" },
  { label: "École", value: "École", color: "bg-lime-100 border-l-[5px] border-lime-600 text-lime-900 shadow-sm" },

  // ABSENCES (Rouge / Rose)
  { label: "CP", value: "CP", color: "bg-pink-100 border-l-[5px] border-pink-500 text-pink-900 opacity-90" },
  { label: "Maladie", value: "Maladie", color: "bg-red-100 border-l-[5px] border-red-500 text-red-900 opacity-90" },
  { label: "Injustifié", value: "Injustifié", color: "bg-red-200 border-l-[5px] border-red-700 text-red-950 font-bold" },
  { label: "Repos", value: "Repos", color: "bg-slate-50 border border-dashed border-slate-300 text-slate-400 opacity-60" },
];

const getShiftColor = (shift) => SHIFT_OPTIONS.find(opt => opt.value === shift)?.color || 'bg-gray-50 border border-gray-200 text-gray-700';

const getCellEntries = (entries, userId, dateStr) => {
  if (!Array.isArray(entries)) return { draft: null, published: null };
  const draft = entries.find(e => e.user_id === userId && e.date === dateStr && e.status === 'draft') || null;
  const published = entries.find(e => e.user_id === userId && e.date === dateStr && e.status === 'published') || null;
  return { draft, published };
};

const getEntry = (entries = [], userId, dateStr, preferDraft = false, isAdminFlag = false) => {
  if (!Array.isArray(entries)) return null;
  if (!isAdminFlag) {
    return entries.find(p => p.user_id === userId && p.date === dateStr && p.status === 'published') || null;
  }
  if (preferDraft) {
    const draft = entries.find(p => p.user_id === userId && p.date === dateStr && p.status === 'draft');
    if (draft) return draft;
  }
  return entries.find(p => p.user_id === userId && p.date === dateStr && p.status === 'published') ||
         entries.find(p => p.user_id === userId && p.date === dateStr && p.status === 'draft') || null;
};

export default function PlanningPage() {
  const { user, isLoading } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [showMyCpModal, setShowMyCpModal] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const datepickerButtonRef = useRef<HTMLButtonElement | null>(null);
  const datepickerRef = useRef<HTMLDivElement | null>(null);

  // Fermeture au clic extérieur
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!isDatePickerOpen) return;
      const pop = datepickerRef.current;
      const btn = datepickerButtonRef.current;
      const target = e.target as Node;
      if (pop && !pop.contains(target) && btn && !btn.contains(target)) {
        setIsDatePickerOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsDatePickerOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isDatePickerOpen]);

  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishSelectedUserIds, setPublishSelectedUserIds] = useState<string[]>([]);
  const [publishFrom, setPublishFrom] = useState<string>('');
  const [publishUntil, setPublishUntil] = useState<string>('');
  const lastLoadId = useRef(0);
  const lastReloadId = useRef(0);

  const handlePublish = async () => {
    if (publishSelectedUserIds.length === 0 || !hotelId) return;
    let q = supabase.from('planning_entries').select('*').eq('hotel_id', hotelId).eq('status', 'draft').in('user_id', publishSelectedUserIds);
    if (publishFrom) q = q.gte('date', publishFrom);
    if (publishUntil) q = q.lte('date', publishUntil);

    const { data: drafts, error: draftsErr } = await q;
    if (draftsErr) { toast.error("Erreur lecture brouillons"); return; }
    if (!drafts || drafts.length === 0) { toast('Aucun brouillon à publier.'); return; }

    const pickLatest = (a: any, b: any) => (a?.created_at && b?.created_at && new Date(a.created_at) >= new Date(b.created_at) ? a : b);
    const map = new Map<string, any>();
    for (const d of drafts) {
      const key = `${d.hotel_id}|${d.user_id}|${d.date}|published`;
      map.set(key, map.has(key) ? pickLatest(map.get(key), d) : d);
    }

    const toPublish = Array.from(map.values()).map(({ id, status, ...d }) => ({ ...d, status: 'published', published_at: new Date().toISOString() }));
    const { error: insErr } = await supabase.from('planning_entries').upsert(toPublish, { onConflict: ['hotel_id', 'user_id', 'date', 'status'] });
    if (insErr) { toast.error("Erreur publication"); return; }

    let del = supabase.from('planning_entries').delete().eq('hotel_id', hotelId).eq('status', 'draft').in('user_id', publishSelectedUserIds);
    if (publishFrom) del = del.gte('date', publishFrom);
    if (publishUntil) del = del.lte('date', publishUntil);
    await del;

    await reloadEntries();
    toast.success("Publication effectuée ✅");
  };

  const handleSendCpRequest = async () => {
    if (!user || !cpStartDate || !cpEndDate || !hotelId) return;
    setIsSendingCp(true);
    const { error } = await supabase.from('cp_requests').insert({
      user_id: user.id_auth || user.id, start_date: cpStartDate, end_date: cpEndDate, commentaire: cpComment, status: 'pending', hotel_id: hotelId,
    });
    setIsSendingCp(false);
    if (!error) {
      setSuccessMessage("Demande envoyée ✅"); setShowCpModal(false); setCpComment(''); loadCpRequests();
    } else { alert("Erreur envoi : " + error.message); }
  };

  const router = useRouter();
  const [hotels, setHotels] = useState([]);
  const [selectedHotelId, setSelectedHotelId] = useState(() => {
    if (typeof window !== "undefined") {
      const fromStorage = window.localStorage.getItem('selectedHotelId');
      if (fromStorage) return fromStorage;
    }
    return user && user.hotel_id ? user.hotel_id : '';
  });
  const [currentHotel, setCurrentHotel] = useState(null);
  const hotelId = selectedHotelId || user?.hotel_id || '';

  const reloadEntries = async () => {
    if (!hotelId) return;
    const myReloadId = ++lastReloadId.current;
    const weekStart = startOfWeek(currentWeekStart, { weekStartsOn: 1 });
    const weekEnd = addDays(weekStart, 6);
    const atNoon = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
    const fetchFrom = format(new Date(atNoon(weekStart).getTime() - 14 * 24 * 3600 * 1000), 'yyyy-MM-dd');
    const fetchTo = format(new Date(atNoon(weekEnd).getTime() + 42 * 24 * 3600 * 1000), 'yyyy-MM-dd');

    const base = supabase.from('planning_entries').select('*').eq('hotel_id', hotelId).gte('date', fetchFrom).lte('date', fetchTo).order('date', { ascending: true });
    const q = isAdmin ? base.in('status', ['draft', 'published']) : base.eq('status', 'published');
    const { data, error } = await q;
    if (error) return;
    if (myReloadId !== lastReloadId.current) return;
    setPlanningEntries(data || []);
  };

  useEffect(() => {
    if (!isAdmin) setPlanningEntries(prev => prev.filter(e => e.status === 'published'));
  }, [isAdmin]);

  useEffect(() => {
    const hotelName = currentHotel?.nom ? ` — ${currentHotel.nom}` : '';
    document.title = `Planning${hotelName}`;
  }, [currentHotel]);

  useEffect(() => {
    if (selectedHotelId && typeof window !== "undefined") window.localStorage.setItem('selectedHotelId', selectedHotelId);
  }, [selectedHotelId]);

  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
    monday.setHours(0, 0, 0, 0);
    return monday;
  });

  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [handlerUsers, setHandlerUsers] = useState<Record<string, { id_auth: string; name?: string; email?: string }>>({});
  const [planningEntries, setPlanningEntries] = useState([]);
  const [cpRequests, setCpRequests] = useState([]);

  const decidedCount = user 
    ? cpRequests.filter(r => (r.user_id === (user.id_auth || user.id)) && (r.status === "approved" || r.status === "refused")).length 
    : 0;
    
  const seenKey = `cpSeenCount:${user?.id_auth || user?.id}:${hotelId}`;
  const [hasSeenMyCpNotif, setHasSeenMyCpNotif] = useState(() => {
    if (typeof window === "undefined") return false;
    const seen = Number(window.localStorage.getItem(seenKey) || "0");
    return decidedCount <= seen;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    const seen = Number(window.localStorage.getItem(seenKey) || "0");
    setHasSeenMyCpNotif(decidedCount <= seen);
  }, [decidedCount, user, hotelId]);

  const entriesView = useMemo(() => (isAdmin ? planningEntries : planningEntries.filter(e => e.status === 'published')), [planningEntries, isAdmin]);

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
  const prefillFromEntryRef = useRef(false);
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [useAsDefault, setUseAsDefault] = useState(false);
  const [doNotTouch, setDoNotTouch] = useState(false);
  const [defaultHours, setDefaultHours] = useState({});
  const [nbWeeksSource, setNbWeeksSource] = useState(1);
  const [nbWeeksTarget, setNbWeeksTarget] = useState(1);
  const [draggedShift, setDraggedShift] = useState(null);

  const handleDeleteCp = async (id) => {
    if (!confirm("Supprimer cette demande ?")) return;
    const { error } = await supabase.from('cp_requests').delete().eq('id', id);
    if (error) alert("Erreur suppression : " + error.message); else loadCpRequests();
  };

  const handleRefuseCp = async (req) => {
    if (!confirm("Refuser cette demande ?")) return;
    const { error } = await supabase.from('cp_requests').update({
      status: 'refused', handled_by: user.id_auth, handled_at: new Date().toISOString(), handled_by_name: user?.name || user?.email || null,
    }).eq('id', req.id);
    if (error) alert("Erreur refus : " + error.message); else loadCpRequests();
  };

  const [cutMode, setCutMode] = useState(false);

  const loadCpRequests = async () => {
    if (!hotelId || hotelId.length < 10) return;
    const { data } = await supabase.from('cp_requests').select('*').eq('hotel_id', hotelId).order('created_at', { ascending: false });
    setCpRequests(data || []);
    const handlerIds = (data || []).map(r => r.handled_by).filter(Boolean) as string[];
    loadCpHandlers(handlerIds);
  };

  const loadCpHandlers = async (ids: string[]) => {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0) return;
    const { data } = await supabase.from('users').select('id_auth, name, email').in('id_auth', unique);
    const map: Record<string, any> = {};
    (data || []).forEach(u => { map[u.id_auth] = u; });
    setHandlerUsers(prev => ({ ...prev, ...map }));
  };

  const handleAcceptCp = async (req) => {
    const start = new Date(req.start_date);
    const end = new Date(req.end_date);
    if (!confirm(`Valider CP du ${req.start_date} au ${req.end_date} ?`)) return;

    const { data: existing } = await supabase.from('planning_entries').select('id,date').eq('user_id', req.user_id).eq('hotel_id', hotelId);
    const daysCount = differenceInCalendarDays(end, start) + 1;
    const allDates = Array.from({ length: daysCount }, (_, i) => format(addDays(start, i), 'yyyy-MM-dd'));
    const existingByDate = new Map((existing || []).map(e => [e.date, e.id]));
    const conflictingDates = allDates.filter(d => existingByDate.has(d));
    const freeDates = allDates.filter(d => !existingByDate.has(d));

    let replaceConflicts = true;
    if (conflictingDates.length > 0) {
      replaceConflicts = confirm(`Conflits sur ${conflictingDates.length} jour(s). Remplacer ?`);
    }

    if (replaceConflicts && conflictingDates.length > 0) {
      await supabase.from('planning_entries').delete().in('id', conflictingDates.map(d => existingByDate.get(d)));
    }

    const datesToInsert = replaceConflicts ? allDates : freeDates;
    if (datesToInsert.length > 0) {
      await supabase.from('planning_entries').insert(datesToInsert.map(dateStr => ({
        user_id: req.user_id, date: dateStr, shift: 'CP', start_time: '00:00', end_time: '00:00', hotel_id: hotelId
      })));
    }

    await supabase.from('cp_requests').update({
      status: 'approved', handled_by: user.id_auth, handled_at: new Date().toISOString(), handled_by_name: user?.name || user?.email || null,
    }).eq('id', req.id);

    await loadCpRequests();
    await reloadEntries();
  };

  const [duplicationSource, setDuplicationSource] = useState(null);
  const [duplicationTargetIds, setDuplicationTargetIds] = useState([]);
  const [targetStartDate, setTargetStartDate] = useState(null);
  const [isDuplicationModalOpen, setIsDuplicationModalOpen] = useState(false);

  const openDuplicationModal = (user) => {
    setDuplicationSource(user);
    setDuplicationTargetIds([user.id_auth]);
    setTargetStartDate(currentWeekStart);
    setIsDuplicationModalOpen(true);
  };

  const exportPDF = async () => {
  const month = currentWeekStart.getMonth();
  const year  = currentWeekStart.getFullYear();
  const displayDate = new Date(year, month, 1);

  const moisFR  = displayDate.toLocaleDateString('fr-FR', { month: 'long' });
  const moisCap = moisFR.charAt(0).toUpperCase() + moisFR.slice(1);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  const parseYMDLocal = (s?: string | null) => {
    if (!s) return null;
    const [yy, mm, dd] = s.split('-').map(Number);
    return new Date(yy, (mm || 1) - 1, dd || 1, 12, 0, 0);
  };

  const monthStart = new Date(year, month, 1, 0, 0, 0);
  const monthEnd   = new Date(year, month + 1, 0, 23, 59, 59);
  const fromStr    = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const toStr      = `${year}-${String(month + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2,'0')}`;

  const userIds = users.map(u => u.id_auth).filter(Boolean);
  const { data: monthEntries, error: monthErr } = await supabase
    .from('planning_entries')
    .select('*')
    .eq('hotel_id', hotelId)
    .in('user_id', userIds)
    .gte('date', fromStr)
    .lte('date', toStr);

  const sourceEntries = monthErr ? entriesView : (monthEntries ?? []);
  const filtered = sourceEntries.filter(e => {
    const d = parseYMDLocal(e.date);
    return d && d >= monthStart && d <= monthEnd;
  });

  const byUserDate = new Map<string, any>();
  const pickBetter = (a: any, b: any) => {
    if (a?.status === 'published' && b?.status !== 'published') return a;
    if (b?.status === 'published' && a?.status !== 'published') return b;
    return (new Date(b?.created_at) >= new Date(a?.created_at)) ? b : a;
  };
  for (const e of filtered) {
    const key = `${e.user_id}|${e.date}`;
    byUserDate.set(key, byUserDate.has(key) ? pickBetter(byUserDate.get(key), e) : e);
  }
  const entriesForMonth = Array.from(byUserDate.values());

  const parseYMD = (s?: string | null) => {
    if (!s) return null;
    const [yy, mm, dd] = s.split('-').map(Number);
    return new Date(yy, (mm || 1) - 1, dd || 1, 23, 59, 59);
  };

  const overlapsMonth = (u: any) => {
    const start = u.employment_start_date ? new Date(u.employment_start_date) : null;
    const end   = parseYMD(u.employment_end_date);
    if (end && end < monthStart) return false;
    if (start && start > monthEnd) return false;
    return true;
  };

  const orderedUsersByOrd = [...users].sort((a, b) => (a.ordre ?? 9999) - (b.ordre ?? 9999));
  const exportUsers = orderedUsersByOrd.filter(overlapsMonth);

  const shiftColors: any = {
    'Réception matin': [173, 216, 230], 'Réception soir': [30, 144, 255], 'Night': [0, 0, 0],
    'Présence': [238, 130, 238], 'Housekeeping Chambre': [144, 238, 144], 'Housekeeping Communs': [0, 128, 0],
    'Petit Déjeuner': [255, 255, 102], 'Extra': [216, 191, 216], 'CP': [255, 182, 193],
    'Maladie': [255, 99, 71], 'Injustifié': [255, 165, 0], 'Repos': [220, 220, 220],
    'Les Voiles': [0, 0, 0], 'École': [102, 205, 170], 'Maintenance': [255, 215, 180],
  };

  const abbreviateShift = (shift: string) => {
    if(!shift) return '';
    const map:any = { 'Réception matin':'RM', 'Réception soir':'RS', 'Night':'N', 'Présence':'P', 'Housekeeping Chambre':'HC', 'Housekeeping Communs':'HCo', 'Petit Déjeuner':'PD', 'Extra':'E', 'CP':'CP', 'Maladie':'M', 'Injustifié':'I', 'Repos':'R', 'Les Voiles':'LV', 'École':'ECO', 'Maintenance':'MAI' };
    return map[shift] || shift.substring(0,2).toUpperCase();
  };

  const userStats = exportUsers.map(user => {
    const uEntries = entriesForMonth.filter(e => e.user_id === user.id_auth);
    let workedDays = 0, workedHours = 0, cp = 0, maladie = 0, injustifie = 0, repas = 0;
    for (const entry of uEntries) {
      if (!['Repos', 'CP', 'Maladie', 'Injustifié', 'École'].includes(entry.shift)) {
        workedDays++;
        if (entry.start_time && entry.end_time) {
          const [sh, sm] = entry.start_time.split(":").map(Number);
          const [eh, em] = entry.end_time.split(":").map(Number);
          let m = (eh * 60 + em) - (sh * 60 + sm);
          if (m < 0) m += 1440;
          workedHours += m / 60;
          if (m > 300) repas++;
        }
      }
      if (entry.shift === 'CP') cp++;
      if (entry.shift === 'Maladie') maladie++;
      if (entry.shift === 'Injustifié') injustifie++;
    }
    return [user.name || user.email, workedDays, Math.round(workedHours * 100) / 100, cp, maladie, injustifie, repas];
  });

  doc.setFontSize(14);
  doc.text(`Récapitulatif du mois ${moisCap} ${year}`, 40, 40);
  autoTable(doc, {
    startY: 60, head: [["Salarié", "Jours", "Heures", "CP", "Maladie", "Injust.", "Ind. Repas"]],
    body: userStats, theme: "grid", styles: { fontSize: 10 }, headStyles: { fillColor: [245, 85, 85] },
  });

  doc.addPage('a4', 'landscape');
  const daysInMonth = Array.from({ length: monthEnd.getDate() }, (_, i) => i + 1);
  const planningTable = exportUsers.map(user => {
    const row = [user.name || user.email];
    for (let d = 1; d <= daysInMonth.length; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const entry = entriesForMonth.find(e => e.user_id === user.id_auth && e.date === dateStr);
      row.push(entry ? abbreviateShift(entry.shift) : '');
    }
    return row;
  });

  doc.setFontSize(12);
  doc.text(`Planning détaillé - ${moisCap} ${year}`, 40, 40);
  autoTable(doc, {
    startY: 60, head: [["Salarié", ...daysInMonth.map(String)]], body: planningTable,
    theme: "grid", styles: { fontSize: 7, cellWidth: 'wrap' }, headStyles: { fillColor: [66, 133, 244] },
    didParseCell: function (data) {
      if (data.section === 'body' && data.column.index > 0) {
        const shiftName = data.cell.raw;
        const fullKey = Object.keys(shiftColors).find(k => abbreviateShift(k) === shiftName);
        if (fullKey && shiftColors[fullKey]) data.cell.styles.fillColor = shiftColors[fullKey];
      }
      if (data.section === 'head' && data.column.index > 0) {
        const date = new Date(year, month, data.column.index);
        if (date.getDay() === 0 || date.getDay() === 6) data.cell.styles.fillColor = [200, 200, 200];
      }
    }
  });

  doc.save(`Planning_${moisCap}_${year}.pdf`);
};

  const closeDuplicationModal = () => { setIsDuplicationModalOpen(false); setDuplicationSource(null); };
  const targetWeekStart = targetStartDate ? startOfWeek(targetStartDate, { weekStartsOn: 1 }) : null;
  const targetWeekEnd = targetWeekStart ? addDays(targetWeekStart, 6) : null;
  const quarterHours = ['00', '15', '30', '45'];

  const handleShiftDrop = async (targetUserId, targetDate) => {
    if (!isAdmin || !draggedShift || !hotelId) return;
    const { userId: sourceUserId, date: sourceDate } = draggedShift;
    const existingTarget = planningEntries.find(e => e.user_id === targetUserId && e.date === targetDate && e.status === 'draft');
    if (existingTarget && !confirm("Écraser le shift existant ?")) { setDraggedShift(null); return; }

    const sourceEntry = planningEntries.find(e => e.user_id === sourceUserId && e.date === sourceDate && e.status === 'draft') ||
                        planningEntries.find(e => e.user_id === sourceUserId && e.date === sourceDate && e.status === 'published');
    if (!sourceEntry) return;

    await supabase.from('planning_entries').upsert({
      user_id: targetUserId, date: targetDate, shift: sourceEntry.shift, start_time: sourceEntry.start_time, end_time: sourceEntry.end_time,
      hotel_id: hotelId, status: 'draft', do_not_touch: !!sourceEntry.do_not_touch,
    }, { onConflict: ['hotel_id', 'user_id', 'date', 'status'] });

    if (cutMode) {
       await supabase.from('planning_entries').delete().eq('user_id', sourceUserId).eq('date', sourceDate).eq('status', sourceEntry.status || 'draft');
    }
    await reloadEntries(); setDraggedShift(null);
  };

  const handleDuplicateMultiWeeks = async () => {
    if (!duplicationSource || !targetStartDate || !duplicationTargetIds.length || !hotelId) return;
    let allEntries = [];
    for (let t = 0; t < nbWeeksTarget; t++) {
      const sourceIndex = t % nbWeeksSource;
      const sStart = addDays(startOfWeek(currentWeekStart, { weekStartsOn: 1 }), sourceIndex * 7); sStart.setHours(12, 0, 0, 0);
      const sEnd = addDays(sStart, 6); sEnd.setHours(23, 59, 59, 999);
      const tStart = addDays(startOfWeek(targetStartDate, { weekStartsOn: 1 }), t * 7); tStart.setHours(12, 0, 0, 0);

      const shiftsToCopy = planningEntries.filter(e => { const d = new Date(e.date); d.setHours(12,0,0,0); return e.user_id === duplicationSource.id_auth && d >= sStart && d <= sEnd; });
      for (const targetId of duplicationTargetIds) {
        allEntries = allEntries.concat(shiftsToCopy.map(e => {
          const orig = new Date(e.date); orig.setHours(12,0,0,0);
          const diff = differenceInCalendarDays(orig, sStart);
          return {
            user_id: targetId, date: addDays(tStart, diff).toISOString().slice(0, 10), shift: e.shift, start_time: e.start_time, end_time: e.end_time,
            hotel_id: hotelId, status: 'draft', do_not_touch: !!e.do_not_touch
          };
        }));
      }
    }
    const { error } = await supabase.from('planning_entries').upsert(allEntries, { onConflict: ['hotel_id', 'user_id', 'date', 'status'] });
    if (error) { toast.error("Erreur duplication"); } else { await reloadEntries(); toast.success("Duplication réussie"); closeDuplicationModal(); }
  };

  const [successMessage, setSuccessMessage] = useState('');
  const goToPreviousWeek = () => { const m = startOfWeek(addDays(currentWeekStart, -7), { weekStartsOn: 1 }); m.setHours(0, 0, 0, 0); setCurrentWeekStart(m); };
  const goToNextWeek = () => { const m = startOfWeek(addDays(currentWeekStart, 7), { weekStartsOn: 1 }); m.setHours(0, 0, 0, 0); setCurrentWeekStart(m); };
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i)), [currentWeekStart]);

  const todayMidnight = new Date(new Date().setHours(0, 0, 0, 0));
  const isActive = (r) => new Date(r.end_date) >= todayMidnight;
  const pendingReqs = cpRequests.filter(r => r.status === 'pending' && isActive(r));
  const visibleRequests = showAllCp ? cpRequests : pendingReqs;

  const normalizeTime = (t) => { if (!t) return ''; const [h='0', m='0'] = t.split(':'); return `${String(parseInt(h)).padStart(2,'0')}:${String(parseInt(m)).padStart(2,'0')}`; };
  const toHHmm = (t) => (t ? String(t).slice(0, 5) : '');
  const toHHmmss = (t) => { if (!t) return null; const s = String(t); if (s.length === 8) return s; if (s.length === 5) return s + ':00'; const [h='0', m='0'] = s.split(':'); return `${String(parseInt(h)).padStart(2,'0')}:${String(parseInt(m)).padStart(2,'0')}:00`; };

  const calculateDuration = (start, end) => {
    if (!start || !end) return '0h00';
    const [sh, sm] = start.split(':').map(Number); const [eh, em] = end.split(':').map(Number);
    let diff = (eh * 60 + em) - (sh * 60 + sm); if (diff < 0) diff += 1440;
    return `${Math.floor(diff / 60)}h${String(diff % 60).padStart(2, '0')}`;
  };

  const getWeeklyHours = (userId) => {
    const userEntries = entriesView.filter(e => e.user_id === userId && weekDates.some(d => format(d, 'yyyy-MM-dd') === e.date));
    const total = userEntries.filter(e => !['Repos', 'Injustifié'].includes(e.shift)).reduce((acc, e) => {
      if (!e.start_time || !e.end_time) return acc;
      const [sh, sm] = e.start_time.split(':').map(Number); const [eh, em] = e.end_time.split(':').map(Number);
      let m = (eh * 60 + em) - (sh * 60 + sm); if (m < 0) m += 1440;
      return acc + m;
    }, 0);
    return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`;
  };

  const getWorkingDays = (userId) => {
    const userEntries = entriesView.filter(e => e.user_id === userId && weekDates.some(d => format(d, 'yyyy-MM-dd') === e.date));
    return new Set(userEntries.filter(e => e.shift && !['Repos', 'Maladie', 'CP', 'Injustifié'].includes(e.shift)).map(e => e.date)).size;
  };

  useEffect(() => {
    supabase.from('hotels').select('id, nom').then(({ data }) => {
      setHotels(data || []); if (!selectedHotelId && data?.[0]) setSelectedHotelId(data[0].id);
    });
  }, [isAdmin]);

  useEffect(() => {
    if (selectedHotelId) supabase.from('hotels').select('id, nom').eq('id', selectedHotelId).single().then(({ data }) => setCurrentHotel(data));
  }, [selectedHotelId]);

  useEffect(() => { if (hotelId) loadInitialData(); }, [hotelId, currentWeekStart]);
  useEffect(() => { if (isAdmin) loadCpRequests(); }, [isAdmin, hotelId]);
  useEffect(() => { if (user) loadInitialData(); }, [user]);

  const moveRow = async (index, direction) => {
    const newRows = [...rows]; const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newRows.length) return;
    [newRows[index], newRows[targetIndex]] = [newRows[targetIndex], newRows[index]];
    setRows(newRows);
    const updates = []; let ordre = 0;
    for (const row of newRows) {
      if (row.id_auth) updates.push(supabase.from('planning_config').update({ ordre }).eq('user_id', row.id_auth).eq('hotel_id', hotelId));
      else if (row.id) updates.push(supabase.from('planning_config').update({ ordre }).eq('service_id', row.id).eq('hotel_id', hotelId));
      ordre++;
    }
    await Promise.all(updates); await loadInitialData();
  };

  const loadInitialData = async () => {
    if (!hotelId || hotelId.length < 10) return;
    const myLoadId = ++lastLoadId.current;
    const weekStart = startOfWeek(currentWeekStart, { weekStartsOn: 1 });
    const weekEnd = addDays(weekStart, 6);
    const atNoon = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
    const fetchFrom = format(new Date(atNoon(weekStart).getTime() - 14 * 86400000), 'yyyy-MM-dd');
    const fetchTo = format(new Date(atNoon(weekEnd).getTime() + 42 * 86400000), 'yyyy-MM-dd');

    const entriesQuery = supabase.from('planning_entries').select('*').eq('hotel_id', hotelId).in('status', isAdmin ? ['draft', 'published'] : ['published']).gte('date', fetchFrom).lte('date', fetchTo).order('date', { ascending: true });
    
    const [usersRes, configRes, entriesRes, cpRes, defRes] = await Promise.all([
      supabase.from('users').select('id_auth, name, email, hotel_id, role, ordre, employment_start_date, employment_end_date').eq('hotel_id', hotelId),
      supabase.from('planning_config').select('*').eq('hotel_id', hotelId),
      entriesQuery,
      supabase.from('cp_requests').select('*').eq('hotel_id', hotelId),
      supabase.from('default_shift_hours').select('*')
    ]);

    if (myLoadId !== lastLoadId.current) return;

    const usersData = usersRes.data || [];
    const configData = configRes.data || [];
    const entriesData = entriesRes.data || [];
    
    const usersWithOrder = usersData.map(u => ({ ...u, ordre: configData.find(c => c.user_id === u.id_auth)?.ordre ?? 9999 }));
    
    const usersVisible = usersWithOrder.filter(u => {
       const end = u.employment_end_date ? new Date(u.employment_end_date) : null;
       if (end && end < atNoon(weekStart)) {
         // Check if entries this week
         return entriesData.some(e => e.user_id === u.id_auth && new Date(e.date) >= atNoon(weekStart) && new Date(e.date) <= atNoon(weekEnd));
       }
       return true;
    });

    const serviceRows = configData.filter(c => c.service_id && c.hotel_id === hotelId).map((c, i) => ({
      ...SERVICE_ROWS.find(s => s.id === c.service_id), ...c, id: c.service_id, ordre: c.ordre ?? i
    }));

    const defMap = {}; defRes.data?.forEach(d => defMap[d.shift_name] = { start: d.start_time, end: d.end_time });
    
    setUsers(usersWithOrder);
    setPlanningEntries(isAdmin ? entriesData : entriesData.filter(e => e.status === 'published'));
    setCpRequests(cpRes.data || []);
    setRows([...serviceRows, ...usersVisible].sort((a, b) => (a.ordre ?? 9999) - (b.ordre ?? 9999)));
    setDefaultHours(defMap);
  };

  useEffect(() => {
    if (!shiftInput || prefillFromEntryRef.current) { prefillFromEntryRef.current = false; return; }
    if (defaultHours[shiftInput]) { setStartTime(defaultHours[shiftInput].start); setEndTime(defaultHours[shiftInput].end); }
  }, [shiftInput, defaultHours]);

  const handleDeleteShift = async (entryId) => {
    if (!hotelId) return;
    await supabase.from('planning_entries').delete().eq('id', entryId);
    await reloadEntries();
  };

  const handleCellClick = (userId, date, currentEntry) => {
    if (!isAdmin) return;
    setEditingCell({ userId, date, entryId: currentEntry?.id ?? null, status: currentEntry?.status ?? 'draft' });
    if (currentEntry) {
      prefillFromEntryRef.current = true;
      setStartTime(toHHmm(currentEntry.start_time) || '09:00'); setEndTime(toHHmm(currentEntry.end_time) || '17:00');
    } else { prefillFromEntryRef.current = false; setStartTime('09:00'); setEndTime('17:00'); }
    setShiftInput(currentEntry?.shift || ''); setDoNotTouch(!!currentEntry?.do_not_touch); setShowShiftModal(true);
  };

  const saveShift = async () => {
    if (!editingCell || !hotelId) return;
    const { userId, date, entryId } = editingCell;
    const start = toHHmmss(startTime); const end = toHHmmss(endTime);
    if (entryId) {
      await supabase.from('planning_entries').update({ shift: shiftInput || null, start_time: start, end_time: end, do_not_touch: doNotTouch }).eq('id', entryId);
    } else {
      await supabase.from('planning_entries').upsert({ user_id: userId, date, shift: shiftInput || null, start_time: start, end_time: end, hotel_id: hotelId, status: 'draft', do_not_touch: doNotTouch }, { onConflict: ['hotel_id', 'user_id', 'date', 'status'] });
    }
    if (useAsDefault && shiftInput) await supabase.from('default_shift_hours').upsert({ shift_name: shiftInput, start_time: start, end_time: end }, { onConflict: ['shift_name'] });
    await reloadEntries(); setEditingCell(null); setShiftInput(''); setShowShiftModal(false); setUseAsDefault(false); setDoNotTouch(false);
  };

  if (isLoading) return <div className="p-10 text-center text-gray-500">Chargement...</div>;
  if (!user) { router.push('/login'); return null; }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 px-4 md:px-8 py-6 max-w-[1600px] mx-auto">
        
        {/* HEADER FLOTTANT */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8">
           {/* GAUCHE: Hotel & Titre */}
           <div className="flex items-center gap-4">
              {hotels.length > 0 && (
                 <select 
                    className="bg-slate-50 border border-slate-200 text-slate-700 text-sm font-semibold py-2 px-4 rounded-xl outline-none focus:ring-2 focus:ring-indigo-100"
                    value={selectedHotelId} 
                    onChange={(e) => setSelectedHotelId(e.target.value)}
                 >
                    {hotels.map(h => <option key={h.id} value={h.id}>{h.nom}</option>)}
                 </select>
              )}
              <h1 className="text-2xl font-bold text-slate-800 tracking-tight">{currentHotel?.nom || 'Planning'}</h1>
           </div>

           {/* CENTRE: Navigation Semaine (Pill Design) */}
           <div className="flex items-center bg-slate-100 p-1 rounded-full shadow-inner">
              <button onClick={goToPreviousWeek} className="p-2 hover:bg-white rounded-full text-slate-500 hover:text-slate-800 transition shadow-sm"><ChevronLeft className="w-5 h-5"/></button>
              <div className="relative">
                <button ref={datepickerButtonRef} onClick={() => setIsDatePickerOpen(!isDatePickerOpen)} className="px-6 py-2 text-sm font-bold text-slate-700 hover:text-indigo-600 transition flex items-center gap-2">
                   <CalendarIcon className="w-4 h-4 text-slate-400"/>
                   {format(currentWeekStart, 'dd MMMM', { locale: fr })} - {format(addDays(currentWeekStart, 6), 'dd MMMM', { locale: fr })}
                </button>
                {isDatePickerOpen && (
                  <div ref={datepickerRef} className="absolute top-12 left-1/2 -translate-x-1/2 bg-white border border-slate-100 rounded-2xl shadow-xl z-50 p-2 animate-in fade-in zoom-in duration-200">
                    <DatePicker inline selected={currentWeekStart} onChange={(date) => { const m = startOfWeek(date, { weekStartsOn: 1 }); m.setHours(0,0,0,0); setCurrentWeekStart(m); setIsDatePickerOpen(false); }} locale={fr} calendarStartDay={1} />
                  </div>
                )}
              </div>
              <button onClick={goToNextWeek} className="p-2 hover:bg-white rounded-full text-slate-500 hover:text-slate-800 transition shadow-sm"><ChevronRight className="w-5 h-5"/></button>
           </div>

           {/* DROITE: Actions User */}
           {!isAdmin && (
             <div className="flex items-center gap-3">
                <button onClick={() => setShowCpModal(true)} className="flex items-center gap-2 bg-yellow-50 text-yellow-700 px-4 py-2 rounded-xl font-semibold hover:bg-yellow-100 transition">
                   <Plus className="w-4 h-4"/> Demander CP
                </button>
                <button onClick={() => { setShowMyCpModal(true); if (typeof window !== "undefined") window.localStorage.setItem(seenKey, String(decidedCount)); setHasSeenMyCpNotif(true); }} className="relative bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-xl font-semibold hover:bg-slate-50 transition">
                   Mes demandes
                   {!hasSeenMyCpNotif && cpRequests.some(r => (r.user_id === user.id_auth || r.user_id === user.id) && (r.status === 'approved' || r.status === 'refused')) && (
                      <span className="absolute -top-1 -right-1 bg-red-500 w-3 h-3 rounded-full border-2 border-white"></span>
                   )}
                </button>
             </div>
           )}
        </div>

        {successMessage && <div className="mb-6 p-4 bg-green-50 text-green-700 rounded-xl flex items-center gap-2 border border-green-100"><CheckCircle className="w-5 h-5"/> {successMessage}</div>}

        {/* BARRE D'OUTILS ADMIN (Flottante) */}
        {isAdmin && (
          <div className="mb-6 p-2 bg-slate-50 rounded-2xl border border-slate-100 flex flex-wrap items-center gap-2 justify-between">
              <div className="flex items-center gap-2">
                  <button onClick={() => setIsUnlocked(!isUnlocked)} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${isUnlocked ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-200' : 'bg-slate-100 text-slate-400'}`}>
                      {isUnlocked ? <Unlock className="w-4 h-4"/> : <Lock className="w-4 h-4"/>}
                      {isUnlocked ? 'Édition activée' : 'Lecture seule'}
                  </button>
                  <button onClick={() => setCutMode(!cutMode)} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${cutMode ? 'bg-red-50 text-red-600 ring-1 ring-red-100' : 'hover:bg-white hover:text-slate-700 text-slate-500'}`}>
                      <Scissors className="w-4 h-4"/> {cutMode ? 'Mode Couper' : 'Couper'}
                  </button>
                  
                  {/* BOUTON MODIFIÉ ICI : "Demandes CP" au lieu de "Absences" */}
                  <button onClick={() => setShowCpAdminModal(true)} className="relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-white hover:text-slate-700 text-slate-500 transition">
                      <div className="relative">
                        <span className="absolute -top-1 -right-1 flex h-2 w-2">
                          {cpRequests.filter(r => r.status === 'pending').length > 0 && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>}
                          {cpRequests.filter(r => r.status === 'pending').length > 0 && <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>}
                        </span>
                        <AlertCircle className="w-4 h-4"/>
                      </div>
                      Demandes CP
                  </button>
              </div>

              <div className="flex items-center gap-2">
                  <button onClick={exportPDF} className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition" title="Exporter PDF"><Printer className="w-5 h-5"/></button>
                  <button onClick={() => { setPublishSelectedUserIds(users.map(u => u.id_auth)); setPublishUntil(format(addDays(startOfWeek(currentWeekStart, { weekStartsOn: 1 }), 6), 'yyyy-MM-dd')); setShowPublishModal(true); }} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md shadow-indigo-200 hover:shadow-lg transition hover:-translate-y-0.5">
                      <Share2 className="w-4 h-4"/> Publier
                  </button>
              </div>
          </div>
        )}

        {/* --- TABLEAU --- */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto max-h-[75vh]">
            <table className="min-w-full border-collapse">
              <thead className="bg-slate-50 sticky top-0 z-20 shadow-sm">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 bg-slate-50">Salarié</th>
                  {weekDates.map(date => (
                    <th key={date.toISOString()} className="px-2 py-4 text-center min-w-[140px] border-b border-slate-200 bg-slate-50">
                      <div className="flex flex-col items-center">
                        <span className="text-xs font-bold text-slate-400 uppercase">{format(date, 'EEEE', { locale: fr })}</span>
                        <span className="text-lg font-bold text-slate-800">{format(date, 'dd')}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, index) => {
                  const rowBgClass = row.id && row.color ? row.color : 'bg-white';
                  
                  return (
                  <tr key={row.id || row.id_auth} className={`group transition-colors`}>
                    {/* COLONNE SALARIÉ */}
                    <td className={`px-6 py-4 whitespace-nowrap sticky left-0 z-10 border-r border-slate-100 ${rowBgClass}`}>
                      <div className="flex items-center justify-between">
                         <div className="flex flex-col">
                            <span className={`font-bold text-sm ${row.id ? 'text-slate-900 uppercase tracking-wider' : 'text-slate-700'}`}>{row.name || row.email}</span>
                            {row.id_auth && (
                               <div className="flex items-center gap-2 mt-1">
                                  <span className="bg-slate-100 text-slate-500 text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
                                     <Clock className="w-3 h-3"/> {getWeeklyHours(row.id_auth)}
                                  </span>
                                  {/* BOUTON DUPLIQUER CORRIGÉ ICI (Icône Copy) */}
                                  {isAdmin && (
                                    <button onClick={() => openDuplicationModal(row)} className="text-slate-400 hover:text-indigo-600 transition-colors" title="Dupliquer la semaine">
                                        <Copy className="w-3.5 h-3.5"/>
                                    </button>
                                  )}
                               </div>
                            )}
                         </div>
                         {isAdmin && isUnlocked && (
                            <div className="opacity-0 group-hover:opacity-100 flex flex-col ml-2">
                               <button onClick={() => moveRow(index, 'up')} className="text-slate-300 hover:text-slate-600"><ArrowUp className="w-4 h-4"/></button>
                               <button onClick={() => moveRow(index, 'down')} className="text-slate-300 hover:text-slate-600"><ArrowDown className="w-4 h-4"/></button>
                            </div>
                         )}
                      </div>
                    </td>

                    {/* CELLULES JOURS */}
                    {weekDates.map(date => {
                       const formatted = format(date, 'yyyy-MM-dd');
                       
                       const renderBubble = (entry, icon, isDraft = false) => (
                          <div 
                             draggable={isAdmin}
                             onDragStart={() => isAdmin && setDraggedShift({ userId: row.id_auth, date: formatted })}
                             onClick={() => isAdmin && handleCellClick(row.id_auth, formatted, entry)}
                             // STYLE COMBO : Fond coloré + Barre latérale + Centré
                             className={`
                                relative group/shift cursor-pointer select-none rounded-r-md rounded-l-sm mb-1.5 
                                transition-all duration-200 hover:scale-[1.02] hover:shadow-md hover:z-10
                                flex flex-col items-center justify-center text-center min-h-[52px] px-1
                                ${getShiftColor(entry?.shift || '')}
                             `}
                          >
                             {/* Titre du shift */}
                             <div className="font-bold text-[11px] leading-tight w-full break-words">
                                {entry?.shift}
                             </div>
                             
                             {/* Heures */}
                             {entry?.shift !== 'Repos' && entry?.start_time && (
                                <div className="text-[10px] font-mono opacity-90 mt-1 font-semibold">
                                   {entry.start_time.slice(0,5)} - {entry.end_time.slice(0,5)}
                                </div>
                             )}

                             {/* Icône Cadenas */}
                             {entry?.do_not_touch && <span className="absolute top-0.5 right-1 text-[8px] opacity-60">🔒</span>}

                             {/* Bouton Suppression */}
                             {isAdmin && entry?.id && (
                                <button 
                                   onClick={(e) => { e.stopPropagation(); handleDeleteShift(entry.id); }} 
                                   className="absolute -top-1.5 -right-1.5 bg-white text-red-500 rounded-full p-0.5 opacity-0 group-hover/shift:opacity-100 shadow-sm border border-red-100 transition-all hover:bg-red-50 hover:scale-110 z-20"
                                >
                                   <Trash2 className="w-3 h-3"/>
                                </button>
                             )}

                        {isAdmin && isDraft && (
                                <span className="absolute top-0.5 left-1 text-[8px] opacity-90 text-amber-900 bg-amber-200/50 px-1 rounded-full border border-amber-300 font-bold">📝</span>
                             )}

                          </div>
                       );

                       let content = null;
                       if (row.id_auth) {
                          if (isAdmin) {
                             const { draft, published } = getCellEntries(planningEntries, row.id_auth, formatted);
                             if (!draft && !published) {
                                content = <div onClick={() => handleCellClick(row.id_auth, formatted, null)} onDrop={() => handleShiftDrop(row.id_auth, formatted)} onDragOver={(e) => e.preventDefault()} className="h-full w-full min-h-[40px] rounded-lg border border-dashed border-slate-200 hover:bg-white/50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer"><Plus className="w-4 h-4 text-slate-300"/></div>;
                             } else {
                                content = (
    <div className="flex flex-col gap-1">
        {draft && renderBubble(draft, '📝', true)} {/* <-- Passer true pour isDraft */}
        {published && renderBubble(published, '')}
    </div>
);
                             }
                          } else {
                             const entry = getEntry(entriesView, row.id_auth, formatted, false, false);
                             content = entry ? renderBubble(entry, '') : null;
                          }
                       }

                       return (
                          <td key={`${row.id || row.id_auth}-${date.toISOString()}`} className={`px-2 py-2 align-top border-b border-slate-50 bg-opacity-30 min-h-[80px] ${rowBgClass}`} onDragOver={(e) => e.preventDefault()} onDrop={() => handleShiftDrop(row.id_auth, formatted)}>
                             {content}
                          </td>
                       );
                    })}
                  </tr>
                );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* --- MODALES (Style Modernisé) --- */}
      
      {/* PUBLISH MODAL */}
      {showPublishModal && (
         <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl p-8 shadow-2xl w-full max-w-lg border border-slate-100">
               <h2 className="text-2xl font-bold text-slate-800 mb-6">📢 Publier le planning</h2>
               <div className="space-y-4 bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-6">
                  <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Du</label>
                        <input type="date" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" value={publishFrom} onChange={e => setPublishFrom(e.target.value)} />
                     </div>
                     <div>
                        <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Au</label>
                        <input type="date" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" value={publishUntil} onChange={e => setPublishUntil(e.target.value)} />
                     </div>
                  </div>
                  <p className="text-xs text-slate-500 text-center mt-2">Si vide = tout publier pour les sélectionnés.</p>
               </div>
               
               <div className="mb-6">
                  <div className="flex justify-between items-center mb-2">
                     <span className="text-sm font-bold text-slate-700">Salariés concernés</span>
                     <div className="flex gap-2">
                        <button className="text-xs text-indigo-600 font-semibold hover:underline" onClick={() => setPublishSelectedUserIds(users.map(u => u.id_auth))}>Tous</button>
                        <button className="text-xs text-slate-400 hover:text-slate-600" onClick={() => setPublishSelectedUserIds([])}>Aucun</button>
                     </div>
                  </div>
                  <div className="max-h-40 overflow-y-auto border border-slate-100 rounded-xl p-2 bg-slate-50/50">
                     {users
  .filter(u => {
    // Garder seulement les utilisateurs sans date de fin OU avec une date de fin dans le futur/aujourd'hui
    const endDate = u.employment_end_date ? new Date(u.employment_end_date) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Comparaison à la journée
    
    // Si la date de fin n'existe pas OU si la date de fin est >= à aujourd'hui, on garde l'utilisateur
    return !endDate || endDate >= today;
  })
  .sort((a,b) => (a.name||'').localeCompare(b.name||''))
  .map(u => (
    <label key={u.id_auth} className="flex items-center gap-3 p-2 hover:bg-white rounded-lg cursor-pointer transition">
      <input type="checkbox" className="rounded text-indigo-600 focus:ring-indigo-500 border-gray-300" checked={publishSelectedUserIds.includes(u.id_auth)} onChange={e => setPublishSelectedUserIds(prev => e.target.checked ? [...prev, u.id_auth] : prev.filter(id => id !== u.id_auth))} />
      <span className="text-sm text-slate-700 font-medium">{u.name || u.email}</span>
    </label>
  ))
}
                  </div>
               </div>
               <div className="flex justify-end gap-3">
                  <button onClick={() => setShowPublishModal(false)} className="px-5 py-2.5 rounded-xl text-slate-500 font-bold hover:bg-slate-50 transition">Annuler</button>
                  <button onClick={() => { handlePublish(); setShowPublishModal(false); }} disabled={publishSelectedUserIds.length === 0} className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition disabled:opacity-50">Publier</button>
               </div>
            </div>
         </div>
      )}

      {/* SHIFT MODAL */}
      {showShiftModal && editingCell && (
         <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in zoom-in duration-200">
            <div className="bg-white p-6 rounded-3xl shadow-2xl w-full max-w-md space-y-5 border border-slate-100">
               <h2 className="text-xl font-extrabold text-slate-800">Modifier le shift</h2>
               
               <div>
                  <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Type de shift</label>
                  <select className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500 transition" value={shiftInput} onChange={(e) => setShiftInput(e.target.value)}>
                     <option value="">- Sélectionner -</option>
                     {SHIFT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
               </div>

               <div className="grid grid-cols-2 gap-4">
                  <div>
                     <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Début</label>
                     <select value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500">
                        {[...Array(24).keys()].flatMap(h => quarterHours.map(m => `${String(h).padStart(2,'0')}:${m}`)).map(t => <option key={t} value={t}>{t}</option>)}
                     </select>
                  </div>
                  <div>
                     <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Fin</label>
                     <select value={endTime} onChange={e => setEndTime(e.target.value)} className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500">
                        {[...Array(24).keys()].flatMap(h => quarterHours.map(m => `${String(h).padStart(2,'0')}:${m}`)).map(t => <option key={t} value={t}>{t}</option>)}
                     </select>
                  </div>
               </div>

               <div className="flex flex-col gap-3 bg-slate-50 p-3 rounded-xl">
                  <label className="flex items-center gap-3 cursor-pointer">
                     <input type="checkbox" className="rounded text-indigo-600 w-4 h-4" checked={useAsDefault} onChange={(e) => setUseAsDefault(e.target.checked)} />
                     <span className="text-sm text-slate-600 font-medium">Sauvegarder comme horaires par défaut</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                     <input type="checkbox" className="rounded text-red-500 w-4 h-4" checked={doNotTouch} onChange={(e) => setDoNotTouch(e.target.checked)} />
                     <span className="text-sm text-slate-600 font-medium flex items-center gap-1">Ne pas toucher <span className="text-xs bg-red-100 text-red-600 px-1 rounded">FIXE</span></span>
                  </label>
               </div>
               
               {shiftInput !== 'Repos' && <div className="text-right text-xs font-bold text-slate-400">Durée : {calculateDuration(startTime, endTime)}</div>}

               <div className="flex justify-end gap-3 pt-2">
                  <button className="px-5 py-2.5 rounded-xl text-slate-500 font-bold hover:bg-slate-50 transition" onClick={() => { setShowShiftModal(false); setEditingCell(null); }}>Annuler</button>
                  <button className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition" onClick={saveShift}>Enregistrer</button>
               </div>
            </div>
         </div>
      )}

     {/* DUPLICATION MODAL */}
      {isDuplicationModalOpen && (
         <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-md border border-slate-100">
               <h2 className="text-lg font-extrabold text-slate-800 mb-4 flex items-center gap-2">
                   <Copy className="w-5 h-5 text-indigo-500"/> Dupliquer
               </h2>
               
               <div className="space-y-4">
                  <div>
                     <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Cibles (Salariés actifs)</label>
                     <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl p-2 bg-slate-50">
                        {users
                           // 1. FILTRE : On garde seulement les actifs (Pas de "active: false" et pas de date de fin passée)
                           .filter(u => {
                               const isClosed = u.active === false || (u.employment_end_date && new Date(u.employment_end_date) < new Date());
                               return !isClosed;
                           })
                           // 2. TRI : Ordre alphabétique
                           .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                           .map(u => (
                           <label key={u.id_auth} className="flex items-center gap-2 p-2 hover:bg-white rounded-lg cursor-pointer transition-colors">
                              <input 
                                type="checkbox" 
                                className="rounded text-indigo-600 focus:ring-indigo-500 border-gray-300" 
                                checked={duplicationTargetIds.includes(u.id_auth)} 
                                onChange={e => e.target.checked ? setDuplicationTargetIds([...duplicationTargetIds, u.id_auth]) : setDuplicationTargetIds(duplicationTargetIds.filter(id => id !== u.id_auth))} 
                              />
                              <span className="text-sm font-medium text-slate-700">{u.name}</span>
                           </label>
                        ))}
                        {users.filter(u => u.active !== false && (!u.employment_end_date || new Date(u.employment_end_date) >= new Date())).length === 0 && (
                            <div className="text-xs text-slate-400 text-center py-2">Aucun autre salarié actif</div>
                        )}
                     </div>
                  </div>
                  
                  <div>
                     <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Semaine de début du collage</label>
                     <input type="date" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm" value={targetStartDate ? format(targetStartDate, 'yyyy-MM-dd') : ''} onChange={e => setTargetStartDate(startOfWeek(new Date(e.target.value), { weekStartsOn: 1 }))} />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                     <div><label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Nb. Semaines Source</label><input type="number" min="1" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" value={nbWeeksSource} onChange={e => setNbWeeksSource(parseInt(e.target.value))} /></div>
                     <div><label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Nb. Semaines Cible</label><input type="number" min="1" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" value={nbWeeksTarget} onChange={e => setNbWeeksTarget(parseInt(e.target.value))} /></div>
                  </div>
               </div>
               
               <div className="flex justify-end gap-3 mt-6">
                  <button onClick={closeDuplicationModal} className="px-4 py-2 rounded-xl text-slate-500 font-bold hover:bg-slate-50 text-sm">Annuler</button>
                  <button onClick={handleDuplicateMultiWeeks} className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold shadow hover:bg-indigo-700 text-sm transition-transform hover:-translate-y-0.5">Dupliquer</button>
               </div>
            </div>
         </div>
      )}

      {/* CP MODALS */}
      {showCpModal && (
         <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl p-8 shadow-2xl w-full max-w-md border border-yellow-100">
               <h2 className="text-2xl font-bold text-yellow-800 mb-6">🏝️ Demande de CP</h2>
               <div className="space-y-4">
                  <div><label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Du</label><input type="date" className="w-full border border-slate-200 rounded-xl px-3 py-2" value={cpStartDate} onChange={e => setCpStartDate(e.target.value)} /></div>
                  <div><label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Au</label><input type="date" className="w-full border border-slate-200 rounded-xl px-3 py-2" value={cpEndDate} onChange={e => setCpEndDate(e.target.value)} /></div>
                  <div><label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Motif</label><textarea className="w-full border border-slate-200 rounded-xl px-3 py-2 resize-none" rows={3} value={cpComment} onChange={e => setCpComment(e.target.value)} /></div>
               </div>
               <div className="flex justify-end gap-3 mt-6">
                  <button onClick={() => setShowCpModal(false)} className="px-5 py-2.5 rounded-xl text-slate-500 font-bold hover:bg-slate-50">Annuler</button>
                  <button onClick={handleSendCpRequest} disabled={isSendingCp} className="px-5 py-2.5 rounded-xl bg-yellow-500 text-white font-bold shadow hover:bg-yellow-600">Envoyer</button>
               </div>
            </div>
         </div>
      )}

      {showCpAdminModal && (
         <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl p-6 shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
               <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold text-slate-800">Gestion des Absences</h2>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-600 bg-slate-50 px-3 py-1 rounded-full cursor-pointer"><input type="checkbox" checked={showAllCp} onChange={() => setShowAllCp(!showAllCp)}/> Voir l'historique</label>
               </div>
               
               <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                  {visibleRequests.length === 0 ? <div className="text-center py-10 text-slate-400">Aucune demande en cours.</div> : visibleRequests.map(req => (
                     <div key={req.id} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row justify-between gap-4 hover:shadow-md transition">
                        <div>
                           <div className="font-bold text-slate-800">{users.find(u => u.id_auth === req.user_id)?.name || '...'}</div>
                           <div className="text-sm text-slate-600 mt-1">Du <span className="font-semibold">{format(new Date(req.start_date), 'dd MMM')}</span> au <span className="font-semibold">{format(new Date(req.end_date), 'dd MMM')}</span></div>
                           {req.commentaire && <div className="text-xs text-slate-400 italic mt-1">"{req.commentaire}"</div>}
                           {(req.status !== 'pending') && <div className="text-[10px] text-slate-400 mt-2 uppercase font-bold tracking-wider">{req.status === 'approved' ? 'Accepté' : 'Refusé'} par {req.handled_by_name || 'Admin'}</div>}
                        </div>
                        <div className="flex items-center gap-2">
                           {req.status === 'pending' && (
                              <>
                                 <button onClick={() => handleAcceptCp(req)} className="bg-green-50 text-green-600 hover:bg-green-100 px-3 py-1.5 rounded-lg text-xs font-bold transition">Valider</button>
                                 <button onClick={() => handleRefuseCp(req)} className="bg-red-50 text-red-600 hover:bg-red-100 px-3 py-1.5 rounded-lg text-xs font-bold transition">Refuser</button>
                              </>
                           )}
                           <button onClick={() => handleDeleteCp(req.id)} className="text-slate-300 hover:text-red-500 p-2"><Trash2 className="w-4 h-4"/></button>
                        </div>
                     </div>
                  ))}
               </div>
               <div className="flex justify-end mt-4 pt-4 border-t border-slate-50"><button onClick={() => setShowCpAdminModal(false)} className="px-4 py-2 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200">Fermer</button></div>
            </div>
         </div>
      )}

      {showMyCpModal && (
         <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl p-6 shadow-2xl w-full max-w-md">
               <div className="flex justify-between items-center mb-4"><h2 className="text-lg font-bold text-slate-800">Mes demandes</h2><button onClick={() => setShowMyCpModal(false)} className="text-slate-400 hover:text-slate-800">✕</button></div>
               <div className="space-y-2 max-h-60 overflow-y-auto">
                  {cpRequests.filter(r => (r.user_id === user.id_auth || r.user_id === user.id)).map(r => (
                     <div key={r.id} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <div><div className="text-sm font-semibold text-slate-700">{format(new Date(r.start_date), 'dd/MM')} → {format(new Date(r.end_date), 'dd/MM')}</div><div className="text-xs text-slate-400">{r.status === 'pending' ? 'En attente' : r.status === 'approved' ? 'Validé' : 'Refusé'}</div></div>
                        <div className={`w-3 h-3 rounded-full ${r.status === 'approved' ? 'bg-green-500' : r.status === 'refused' ? 'bg-red-500' : 'bg-yellow-400'}`}></div>
                     </div>
                  ))}
               </div>
            </div>
         </div>
      )}

    </div>
  );
}