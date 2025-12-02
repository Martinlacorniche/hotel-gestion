'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  ChevronLeft, ChevronRight, PlusCircle, Filter, CalendarDays, Car, 
  NotebookText, ShoppingCart, KeyRound, UserPlus, Settings, LogOut, 
  Stamp, Grid, Save, Edit2, Trash2, CheckCircle, XCircle, Search, ExternalLink,
  Wrench // Icône pour maintenance
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { v4 as uuidv4 } from 'uuid';
import { format as formatDate } from 'date-fns';
import { fr as frLocale } from 'date-fns/locale';
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// --- TYPES & UTILITAIRES ---

interface CustomUser {
  id: string;
  email: string;
  name: string;
  role: string;
  service?: string;
}

function windDirectionToText(deg: number) {
  const dirs = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return dirs[Math.round(deg / 45) % 8];
}

function bgColorForWeather(code: number) {
  if (code === 0) return "bg-gradient-to-br from-amber-50 via-white to-sky-100";
  if ([1, 2, 3].includes(code)) return "bg-gradient-to-br from-slate-50 via-white to-sky-50";
  if (code >= 80 && code <= 82) return "bg-gradient-to-br from-sky-100 via-white to-slate-200";
  if (code >= 95) return "bg-gradient-to-br from-purple-100 via-white to-slate-300";
  return "bg-gradient-to-br from-slate-50 via-white to-slate-100";
}

function weatherLabel(code: number) {
  if (code === 0) return "Ensoleillé";
  if ([1, 2].includes(code)) return "Peu nuageux";
  if (code === 3) return "Nuageux";
  if (code >= 45 && code <= 48) return "Brume / brouillard";
  if (code >= 51 && code <= 67) return "Pluie fine";
  if (code >= 71 && code <= 77) return "Neige";
  if (code >= 80 && code <= 82) return "Averses";
  if (code >= 95) return "Orageux";
  return "Conditions variables";
}

function weatherIconSVG(code: number) {
  if (code === 0) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="5" fill="#FDB813" />
      </svg>
    );
  }
  if ([1, 2].includes(code)) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="10" r="4" fill="#FDB813" />
        <ellipse cx="14" cy="15" rx="6" ry="3.5" fill="#BCCCDC" />
      </svg>
    );
  }
  if (code === 3) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <ellipse cx="12" cy="13" rx="7" ry="4" fill="#A0AEC0" />
      </svg>
    );
  }
  if (code >= 51 && code <= 82) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <ellipse cx="12" cy="11" rx="7" ry="4" fill="#A0AEC0" />
        <line x1="9" y1="16" x2="9" y2="20" stroke="#2563EB" strokeWidth="2" />
        <line x1="13" y1="16" x2="13" y2="20" stroke="#2563EB" strokeWidth="2" />
        <line x1="17" y1="16" x2="17" y2="20" stroke="#2563EB" strokeWidth="2" />
      </svg>
    );
  }
  if (code >= 95) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <ellipse cx="12" cy="10" rx="7" ry="4" fill="#A0AEC0" />
        <polygon points="10,14 14,14 12,20" fill="#F59E0B" />
      </svg>
    );
  }
  return null;
}

// --- COMPOSANT PRINCIPAL ---

export default function HotelDashboard() {
  const { user: rawUser, logout, isLoading } = useAuth();
  const [open, setOpen] = useState(false);
  const [sunTimes, setSunTimes] = useState<{sunrise:string, sunset:string} | null>(null);

  const user = rawUser as CustomUser | null;
  const [showValidatedConsignes, setShowValidatedConsignes] = useState(false);
  const [showValidatedTickets, setShowValidatedTickets] = useState(false);
  
  const PLAY_URL = "https://play.google.com/store/apps/details?id=com.martinvitte.hotelstoulonborddemer&utm_source=emea_Med";
  const APPLE_URL = "https://apps.apple.com/app/hotels-toulon-bord-de-mer/id6751883454";

  const [meteoMorning, setMeteoMorning] = useState<any | null>(null);
  const [meteoAfternoon, setMeteoAfternoon] = useState<any | null>(null);
  const [seaTemp, setSeaTemp] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());

  // --- EFFETS (Loaders) ---

  useEffect(() => {
    async function load() {
      try {
        const dateStr = formatDate(selectedDate, "yyyy-MM-dd");

        // Prévisions
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=43.117&longitude=5.933&hourly=temperature_2m,weathercode,windspeed_10m,winddirection_10m&timezone=Europe%2FParis&start_date=${dateStr}&end_date=${dateStr}`
        );
        const data = await res.json();

        const morningTime = `${dateStr}T09:00`;
        const afternoonTime = `${dateStr}T15:00`;

        const idxMorning = data.hourly.time.indexOf(morningTime);
        const idxAfternoon = data.hourly.time.indexOf(afternoonTime);

        if (idxMorning !== -1) {
          setMeteoMorning({
            temperature: data.hourly.temperature_2m[idxMorning],
            weathercode: data.hourly.weathercode[idxMorning],
            windspeed: data.hourly.windspeed_10m[idxMorning],
            winddirection: data.hourly.winddirection_10m[idxMorning],
          });
        } else setMeteoMorning(null);

        if (idxAfternoon !== -1) {
          setMeteoAfternoon({
            temperature: data.hourly.temperature_2m[idxAfternoon],
            weathercode: data.hourly.weathercode[idxAfternoon],
            windspeed: data.hourly.windspeed_10m[idxAfternoon],
            winddirection: data.hourly.winddirection_10m[idxAfternoon],
          });
        } else setMeteoAfternoon(null);

        // Mer
        const sea = await fetch(
          `https://marine-api.open-meteo.com/v1/marine?latitude=43.117&longitude=5.933&hourly=sea_surface_temperature&timezone=Europe%2FParis&start_date=${dateStr}&end_date=${dateStr}`
        );
        const seaData = await sea.json();
        const seaTime = `${dateStr}T12:00`;
        const seaIdx = seaData.hourly.time.indexOf(seaTime);
        if (seaIdx !== -1) setSeaTemp(seaData.hourly.sea_surface_temperature[seaIdx]);
        else setSeaTemp(null);

        // Soleil
        const sun = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=43.117&longitude=5.933&daily=sunrise,sunset&timezone=Europe%2FParis&start_date=${dateStr}&end_date=${dateStr}`
        );
        const sunData = await sun.json();
        setSunTimes({
          sunrise: sunData.daily.sunrise[0].slice(11, 16),
          sunset: sunData.daily.sunset[0].slice(11, 16),
        });
      } catch (e) {
        console.error("Erreur météo :", e);
        setMeteoMorning(null); setMeteoAfternoon(null); setSeaTemp(null); setSunTimes(null);
      }
    }
    load();
  }, [selectedDate]);

  const mainMeteo = meteoAfternoon || meteoMorning;
  const hasMeteo = !!(meteoMorning || meteoAfternoon);

  const isAdmin = user?.role === 'admin';
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const userDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target as Node)) {
        setShowUserDropdown(false);
      }
    }
    if (showUserDropdown) document.addEventListener("mousedown", handleClickOutside);
    else document.removeEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showUserDropdown]);

  const [hotels, setHotels] = useState([]);
  const [selectedHotelId, setSelectedHotelId] = useState(() => {
    if (typeof window !== 'undefined') {
      const fromStorage = window.localStorage.getItem('selectedHotelId');
      if (fromStorage) return fromStorage;
    }
    if (user && user.hotel_id) return user.hotel_id;
    return '';
  });

  useEffect(() => {
    if (selectedHotelId && typeof window !== 'undefined') {
      window.localStorage.setItem('selectedHotelId', selectedHotelId);
    }
  }, [selectedHotelId]);

  const [currentHotel, setCurrentHotel] = useState(null);
  const hotelId = selectedHotelId || user?.hotel_id;

  const formatNumber = (n: number | null, suffix: string = "") => {
    if (n === null || n === undefined || isNaN(n)) return "-";
    const isGuestReview = suffix.includes("/10");
    return new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: isGuestReview ? 1 : 0,
      maximumFractionDigits: isGuestReview ? 1 : 0,
    }).format(n) + suffix;
  };

  const router = useRouter();
  const [tickets, setTickets] = useState<any[]>([]);
  const [consignes, setConsignes] = useState<any[]>([]);
  const [consignesLoading, setConsignesLoading] = useState(false);
  const [taxis, setTaxis] = useState<any[]>([]);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [newTicket, setNewTicket] = useState({
    titre: '',
    service: 'Réception',
    dateAction: formatDate(new Date(), 'yyyy-MM-dd'),
    priorite: 'Moyenne',
    date_fin: ''
  });

  const [showConsigneModal, setShowConsigneModal] = useState(false);
  const [showTaxiModal, setShowTaxiModal] = useState(false);
  const [editConsigneIndex, setEditConsigneIndex] = useState<number | null>(null);
  
  const [showUserModal, setShowUserModal] = useState(false);
  const [newUser, setNewUser] = useState<{
    name: string; email: string; role: string; password: string; hotel_id?: string;
  }>({
    name: '', email: '', role: 'employe', password: '',
    hotel_id: selectedHotelId || hotels[0]?.id || '',
  });
  const [showUsersList, setShowUsersList] = useState(false);
  const [users, setUsers] = useState<any[]>([]);

  // Modal Clôturer
  const [closeModal, setCloseModal] = useState<{
    open: boolean; user: any | null; date: string;
  }>({ open: false, user: null, date: new Date().toISOString().slice(0,10) });

  const openCloseModal = (u: any) => {
    setCloseModal({
      open: true, user: u, date: new Date().toISOString().slice(0,10),
    });
  };

  const doCloseUser = async () => {
    if (!closeModal.user || !closeModal.date) return;
    const u = closeModal.user;
    const { error: upErr } = await supabase
      .from('users')
      .update({ active: false, employment_end_date: closeModal.date })
      .eq('id_auth', u.id_auth);
    if (upErr) { alert("Erreur clôture : " + upErr.message); return; }

    const { error: banErr } = await supabase.rpc('ban_user', { p_user_id: u.id_auth });
    if (banErr) { alert("Erreur ban : " + banErr.message); return; }

    setUsers(prev => prev.map(x =>
      x.id_auth === u.id_auth ? { ...x, active:false, employment_end_date: closeModal.date } : x
    ));
    setCloseModal({ open:false, user:null, date:new Date().toISOString().slice(0,10) });
    alert("Salarié clôturé ✅");
  };

  const reactivateUser = async (u: any) => {
    const { error: upErr } = await supabase
      .from('users')
      .update({ active: true, employment_end_date: null })
      .eq('id_auth', u.id_auth);
    if (upErr) { alert("Erreur réactivation : " + upErr.message); return; }

    const { error: unbanErr } = await supabase.rpc('unban_user', { p_user_id: u.id_auth });
    if (unbanErr) { alert("Erreur unban : " + unbanErr.message); return; }

    setUsers(prev => prev.map(x =>
      x.id_auth === u.id_auth ? { ...x, active: true, employment_end_date: null } : x
    ));
    alert("Utilisateur réactivé ✅");
  };

  const [showCalendar, setShowCalendar] = useState(false);
  const [editObjetIndex, setEditObjetIndex] = useState<number | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [demandes, setDemandes] = useState<any[]>([]);
  const [editDemandeIndex, setEditDemandeIndex] = useState<number | null>(null);
  const [newDemande, setNewDemande] = useState({
    type: 'Taxi', nom: '', chambre: '', heure: '',
  });

  const toggleObjetCheckbox = async (id: string, field: string, value: boolean) => {
    const current = objetsTrouves.find((o) => o.id === id);
    if (!current) return;
    const nextLocal = { ...current, [field]: value };
    const allCheckedAfter = !!nextLocal.ficheLhost && !!nextLocal.paiementClient && !!nextLocal.colisEnvoye;

    const payload: any = { [field]: value };
    if (allCheckedAfter && !current.completedAt) {
      payload.completedAt = new Date().toISOString();
    }
    if (!allCheckedAfter && current.completedAt) {
      payload.completedAt = null;
    }
    const { error } = await supabase.from('objets_trouves').update(payload).eq('id', id);
    if (error) {
      console.error(`Erreur mise à jour ${field} :`, error.message); return;
    }
    setObjetsTrouves((prev) => prev.map((o) => (o.id === id ? { ...o, ...payload } : o)));
  };

  const deleteObjet = async (id: string) => {
    if (!id) return;
    if (!confirm('Supprimer cet objet ?')) return;
    const { error } = await supabase.from('objets_trouves').delete().eq('id', id);
    if (error) { alert('Suppression impossible : ' + error.message); return; }
    setObjetsTrouves((prev) => prev.filter((o) => o.id !== id));
  };

  const [kpis, setKpis] = useState<any | null>(null);

  useEffect(() => {
    const fetchKpis = async () => {
      if (!hotelId) return;
      const { data, error } = await supabase
        .from("kpis")
        .select("*")
        .eq("hotel_id", hotelId)
        .eq("mois", selectedDate.getMonth() + 1)
        .eq("annee", selectedDate.getFullYear())
        .single();
      if (!error) setKpis(data);
      else setKpis(null);
    };
    fetchKpis();
  }, [hotelId, selectedDate]);

  const formatSafeDate = (dateStr: string | undefined) => {
    if (!dateStr || isNaN(Date.parse(dateStr))) return 'Date invalide';
    return formatDate(new Date(dateStr), 'dd MMMM', { locale: frLocale });
  };

  const [objetsTrouves, setObjetsTrouves] = useState<any[]>([]);
  const [showAllObjets, setShowAllObjets] = useState(false);
  const [searchObjets, setSearchObjets] = useState('');

  useEffect(() => {
    supabase.from('hotels').select('id, nom, has_parking, has_coworking')
      .then(({ data }) => { setHotels(data || []); });
  }, []);

  useEffect(() => {
    if (hotelId) {
      supabase.from('hotels').select('id, nom, has_parking, has_coworking')
        .eq('id', hotelId).single()
        .then(({ data }) => setCurrentHotel(data));
    }
  }, [hotelId]);

  useEffect(() => {
    const name = currentHotel?.nom?.trim();
    document.title = name ? `Accueil — ${name}` : 'Accueil';
  }, [currentHotel]);

  useEffect(() => {
    const fetchObjetsTrouves = async () => {
      const { data, error } = await supabase
        .from('objets_trouves').select('*').eq('hotel_id', hotelId).order('date', { ascending: false });
      if (!error) setObjetsTrouves(data || []);
    };
    if (hotelId) fetchObjetsTrouves();
  }, [hotelId]);

  useEffect(() => {
    const fetchUsers = async () => {
      if (!hotelId) return;
      const { data, error } = await supabase.from('users').select('*').eq('hotel_id', hotelId);
      if (!error) setUsers(data || []);
    };
    if (hotelId) fetchUsers();
  }, [hotelId]);

  useEffect(() => {
    const fetchTickets = async () => {
      setTicketsLoading(true);
      const { data, error } = await supabase.from('tickets').select('*').eq('hotel_id', hotelId).order('date_action', { ascending: true });
      if (!error) setTickets(data || []);
      setTicketsLoading(false);
    };
    if (hotelId) fetchTickets();
  }, [hotelId]);

  useEffect(() => {
    let isMounted = true;
    const fetchDemandes = async () => {
      const { data, error } = await supabase
        .from('demandes').select('*').eq('hotel_id', hotelId).order('heure', { ascending: true });
      if (!error && isMounted) setDemandes(data || []);
    };
    if (hotelId) fetchDemandes();
    return () => { isMounted = false; };
  }, [hotelId]);

  useEffect(() => {
    if (!hotelId) return;
    const fetchChauffeurs = async () => {
      const { data, error } = await supabase.from('chauffeurs').select('*').eq('hotel_id', hotelId);
      if (!error) setChauffeurs(data || []);
    };
    fetchChauffeurs();
  }, [hotelId]);

  useEffect(() => {
    const fetchConsignes = async () => {
      setConsignesLoading(true);
      const { data, error } = await supabase
        .from('consignes').select('*').eq('hotel_id', hotelId).order('created_at', { ascending: false });
      if (!error) setConsignes(data || []);
      setConsignesLoading(false);
    };
    if (hotelId) fetchConsignes();
  }, [hotelId]);

  const [filterService, setFilterService] = useState<string>('Tous');

  const [newConsigne, setNewConsigne] = useState<{
    texte: string; service?: string; date?: string; valide: boolean; utilisateurs_ids: string[]; date_fin: string;
  }>({
    texte: '', service: 'Tous les services', date: '', valide: false, utilisateurs_ids: [], date_fin: ''
  });

  const [newTaxi, setNewTaxi] = useState({
    type: 'Taxi', chambre: '', dateAction: '', heure: '', prix: '', chauffeur: '', statut: 'Prévu'
  });

  const [chauffeurs, setChauffeurs] = useState<any[]>([]);
  const [showChauffeurModal, setShowChauffeurModal] = useState(false);
  const [newChauffeur, setNewChauffeur] = useState('');

  const [showObjetModal, setShowObjetModal] = useState(false);
  const [newObjet, setNewObjet] = useState({
    date: '', chambre: '', nomClient: '', objet: '', ficheLhost: false, paiementClient: false, colisEnvoye: false,
  });

  const changeDay = (direction: number) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(selectedDate.getDate() + direction);
    setSelectedDate(newDate);
  };

  const createTicket = async () => {
    if (newTicket.titre.trim() === '') return;
    const ticketToSave = {
      titre: newTicket.titre, service: newTicket.service, priorite: newTicket.priorite,
      date_action: newTicket.dateAction, date_fin: newTicket.date_fin || null,
      valide: false, auteur: (user && 'name' in user) ? (user as any).name : 'Anonyme', hotel_id: hotelId,
    };

    if (editTicketIndex !== null) {
      const id = tickets[editTicketIndex].id;
      const { error } = await supabase.from('tickets').update(ticketToSave).eq('id', id);
      if (error) return;
      const updated = [...tickets];
      updated[editTicketIndex] = { ...updated[editTicketIndex], ...ticketToSave };
      setTickets(updated);
      setEditTicketIndex(null);
    } else {
      const { data, error } = await supabase.from('tickets').insert(ticketToSave).select();
      if (!error) setTickets((prev) => [...prev, ...(data || [])]);
    }
    setNewTicket({
      titre: '', service: 'Réception', dateAction: formatDate(selectedDate, 'yyyy-MM-dd'),
      priorite: 'Moyenne', date_fin: ''
    });
    setShowTicketModal(false);
  };

  const handleCreateUser = async () => {
    const { email, password, name, role } = newUser;
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email, password,
      options: { data: { name, role, hotel_id: newUser.hotel_id } }
    });
    if (authError || !authData.user) { alert("Erreur Auth : " + (authError?.message ?? '')); return; }
    if (!newUser.hotel_id) { alert('Merci de sélectionner un hôtel.'); return; }

    const { error: insertError } = await supabase.from('users').insert([{
      email, name, role, id_auth: authData.user.id, hotel_id: newUser.hotel_id,
    }]);
    if (insertError) { alert("Erreur table users : " + insertError.message); return; }

    const { data: configs } = await supabase.from('planning_config').select('ordre');
    const maxOrdre = configs && configs.length ? Math.max(...configs.map(cfg => cfg.ordre || 0)) : 0;
    await supabase.from('planning_config').insert([{
      user_id: authData.user.id, hotel_id: newUser.hotel_id, ordre: maxOrdre + 1,
    }]);

    setUsers((prev) => [...prev, { name, email, role, id_auth: authData.user.id, hotel_id: newUser.hotel_id }]);
    setShowUserModal(false);
    setNewUser({ name: '', email: '', password: '', role: 'employe', hotel_id: hotels[0]?.id || '', });
  };

  const createConsigne = async () => {
    if (newConsigne.texte.trim() === '') return;
    const consigneToInsert = {
      texte: newConsigne.texte, auteur: user?.name || 'Anonyme', date_fin: newConsigne.date_fin || null,
      valide: false, utilisateurs_ids: [], // Nettoyé : plus d'assignation
      hotel_id: hotelId, date_creation: formatDate(selectedDate, 'yyyy-MM-dd'),
    };

    if (editConsigneIndex !== null) {
      const id = consignes[editConsigneIndex].id;
      const { error } = await supabase.from('consignes').update(consigneToInsert).eq('id', id);
      if (error) return;
      const updated = [...consignes];
      updated[editConsigneIndex] = { ...updated[editConsigneIndex], ...consigneToInsert };
      setConsignes(updated);
      setEditConsigneIndex(null);
    } else {
      const { data, error } = await supabase.from('consignes').insert(consigneToInsert).select();
      if (!error) setConsignes((prev) => [...prev, ...(data || [])]);
    }
    setNewConsigne({
      texte: '', date: new Date().toISOString().split('T')[0], valide: false, utilisateurs_ids: [], date_fin: ''
    });
    setShowConsigneModal(false);
  };

  const createDemande = async () => {
    if (!newTaxi.heure || !newTaxi.chambre || !selectedDate) return;
    const demandeToSave = {
      type: newTaxi.type, nom: '', chambre: newTaxi.chambre, heure: newTaxi.heure,
      date: newTaxi.dateAction, prix: newTaxi.type === "VTC" ? parseFloat(newTaxi.prix) : null,
      chauffeur_id: newTaxi.type === "VTC" ? newTaxi.chauffeur : null, valide: false, hotel_id: hotelId,
    };

    if (editDemandeIndex !== null) {
      const id = demandes[editDemandeIndex].id;
      const { error } = await supabase.from('demandes').update(demandeToSave).eq('id', id);
      if (error) return;
      const updated = [...demandes];
      updated[editDemandeIndex] = { ...updated[editDemandeIndex], ...demandeToSave };
      setDemandes(updated);
      setEditDemandeIndex(null);
    } else {
      const { data, error } = await supabase.from('demandes').insert(demandeToSave).select();
      if (!error) setDemandes((prev) => [...prev, ...(data || [])]);
    }
    setNewTaxi({ type: 'Taxi', chambre: '', dateAction: '', heure: '', statut: 'Prévu', prix:'', chauffeur:'' });
    setEditDemandeIndex(null);
    setShowTaxiModal(false);
  };

  const validerDemande = async (index: number) => {
    const id = demandes[index].id;
    const date_validation = formatDate(selectedDate, 'yyyy-MM-dd');
    const { error } = await supabase.from('demandes').update({ valide: true, date_validation }).eq('id', id);
    if (error) return;
    const updated = [...demandes];
    updated[index].valide = true;
    updated[index].date_validation = date_validation;
    setDemandes(updated);
  };

  const deleteDemande = async (id: string) => {
    const { error } = await supabase.from('demandes').delete().eq('id', id);
    if (error) { alert('Suppression impossible : ' + error.message); return; }
    setDemandes((prev) => prev.filter((d) => d.id !== id));
  };

  const deleteChauffeur = async (id: string) => {
    if (!confirm("Supprimer ce chauffeur ?")) return;
    const { error } = await supabase.from("chauffeurs").delete().eq("id", id);
    if (error) { alert("Erreur suppression : " + error.message); return; }
    setChauffeurs((prev) => prev.filter((c) => c.id !== id));
  };

  const createTaxi = () => {
    if (!newTaxi.chambre || !newTaxi.dateAction) return;
    setTaxis([...taxis, { ...newTaxi }]);
    setNewTaxi({ type: 'Taxi', chambre: '', dateAction: '', heure: '', statut: 'Prévu', prix:'', chauffeur:'' });
    setShowTaxiModal(false);
  };

  const createObjetTrouve = async () => {
    if (!newObjet.date || !newObjet.chambre || !newObjet.nomClient || !newObjet.objet) return;
    if (editObjetIndex !== null) {
      const objetToUpdate = objetsTrouves[editObjetIndex];
      const { error } = await supabase.from('objets_trouves').update(newObjet).eq('id', objetToUpdate.id);
      if (error) return;
      const updated = [...objetsTrouves];
      updated[editObjetIndex] = { ...objetToUpdate, ...newObjet };
      setObjetsTrouves(updated);
      setEditObjetIndex(null);
    } else {
      const { data, error } = await supabase.from('objets_trouves').insert({
        ...newObjet, createdAt: new Date().toISOString(), completedAt: null, hotel_id: hotelId
      }).select();
      if (!error) setObjetsTrouves((prev) => [...prev, ...(data || [])]);
    }
    setNewObjet({
      date: '', chambre: '', nomClient: '', objet: '', ficheLhost: false, paiementClient: false, colisEnvoye: false,
    });
    setShowObjetModal(false);
  };

  const validerConsigne = async (indexVisible: number) => {
    const consigne = consignesVisibles[indexVisible];
    const id = consigne.id;
    const { error } = await supabase.from('consignes').update({ valide: true, date_validation: formatDate(selectedDate, 'yyyy-MM-dd') }).eq('id', id);
    if (error) return;
    const originalIndex = consignes.findIndex(c => c.id === id);
    if (originalIndex === -1) return;
    const updated = [...consignes];
    updated[originalIndex].valide = true;
    updated[originalIndex].date_validation = formatDate(selectedDate, 'yyyy-MM-dd');
    setConsignes(updated);
  };

  const modifierConsigne = (indexVisible: number) => {
    const consigne = consignesVisibles[indexVisible];
    const originalIndex = consignes.findIndex(c => c.id === consigne.id);
    if (originalIndex === -1) return;

    setNewConsigne({
      texte: consigne.texte ?? '', 
      service: consigne.service ?? 'Tous les services',
      date: consigne.date ?? consigne.date_creation ?? '', 
      valide: !!consigne.valide,
      date_fin: consigne.date_fin ?? '',
      // RESTAURATION DE LA LOGIQUE D'ASSIGNATION :
      utilisateurs_ids: Array.isArray(consigne.utilisateurs_ids) 
        ? consigne.utilisateurs_ids 
        : (consigne.utilisateur_id ? [String(consigne.utilisateur_id)] : []),
    });
    setEditConsigneIndex(originalIndex);
    setShowConsigneModal(true);
  };

  const [editTicketIndex, setEditTicketIndex] = useState<number | null>(null);

  const etiquette = (service: string) => {
    const map: any = {
      'Réception': '📘 Réception', 'Housekeeping': '🧹 Housekeeping', 'F&B': '🍽️ F&B', 'Maintenance': '🛠️ Maintenance', 'Tous les services': '👥 Tous les services',
    };
    return map[service] || service;
  };

  const validerTicket = async (index: number) => {
    const t = tickets[index];
    const dateValidation = format(selectedDate, 'yyyy-MM-dd');
    const { error } = await supabase.from('tickets').update({ valide: true, date_validation: dateValidation }).eq('id', t.id);
    if (error) return;
    const updated = [...tickets];
    updated[index] = { ...t, valide: true, date_validation: dateValidation };
    setTickets(updated);
  };

  const priorityColor = (p: string) => {
    if (p === 'Haute') return 'bg-red-50 text-red-700 border border-red-100';
    if (p === 'Moyenne') return 'bg-orange-50 text-orange-700 border border-orange-100';
    return 'bg-green-50 text-green-700 border border-green-100';
  };

  const ticketsVisibles = useMemo(() => {
    const visibles = tickets.filter((t) => {
      const actionDate = t.date_action ? new Date(t.date_action) : null;
      const endDate = t.date_fin ? new Date(t.date_fin) : actionDate;
      const validationDate = t.date_validation ? new Date(t.date_validation) : null;
      const current = new Date(formatDate(selectedDate, 'yyyy-MM-dd'));
      if (!actionDate || isNaN(actionDate.getTime())) return false;
      if (current < actionDate || current > endDate) return false;
      if (t.valide) {
        if (!showValidatedTickets) return false;
        return !!validationDate && current <= validationDate;
      }
      return true;
    }).filter((t) => filterService === 'Tous' || t.service === filterService);

    return visibles.sort((a, b) => {
      if (a.valide !== b.valide) return a.valide ? 1 : -1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [tickets, filterService, selectedDate, showValidatedTickets]);

  const demandesVisibles = useMemo(() => {
    const selected = formatDate(selectedDate, 'yyyy-MM-dd');
    return demandes.filter((d) => d.date === selected);
  }, [demandes, selectedDate]);

  const totalVTCMoisParChauffeur = useMemo(() => {
    const mois = selectedDate.getMonth();
    const annee = selectedDate.getFullYear();
    const duMois = demandes.filter(d => {
      if (d.type !== "VTC" || !d.date) return false;
      const dDate = new Date(d.date);
      return dDate.getMonth() === mois && dDate.getFullYear() === annee;
    });
    return duMois.reduce((acc, d) => {
      const chauffeur = chauffeurs.find(c => c.id === d.chauffeur_id)?.nom || "Sans chauffeur";
      acc[chauffeur] = (acc[chauffeur] || 0) + (d.prix || 0);
      return acc;
    }, {} as Record<string, number>);
  }, [demandes, selectedDate, chauffeurs]);

  const consignesVisibles = useMemo(() => {
    let visibles = consignes.filter((c) => {
      const creationDate = c.date_creation ? new Date(c.date_creation) : null;
      const endDate = c.date_fin ? new Date(c.date_fin) : creationDate;
      const validationDate = c.date_validation ? new Date(c.date_validation) : null;
      const current = new Date(formatDate(selectedDate, 'yyyy-MM-dd'));
      if (!creationDate || isNaN(creationDate.getTime())) return false;
      if (current < creationDate || current > endDate) return false;
      if (c.valide) {
        if (!showValidatedConsignes) return false;
        return validationDate && current <= validationDate;
      }
      return true;
    });
    return visibles.sort((a, b) => {
      if (a.valide !== b.valide) return a.valide ? 1 : -1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [consignes, selectedDate, showValidatedConsignes]);

  const taxisVisibles = useMemo(() => {
    const currentDate = format(selectedDate, 'yyyy-MM-dd');
    return taxis.filter((t) => t.dateAction === currentDate);
  }, [taxis, selectedDate]);

  const objetsVisibles = useMemo(() => {
    const today = new Date();
    const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const todayOnly = day(today);
    const q = searchObjets.trim().toLowerCase();

    return objetsTrouves.filter((o) => {
      const created = o.createdAt ? new Date(o.createdAt) : (o.date ? new Date(o.date) : null);
      if (!created || isNaN(+created)) return false;
      const createdOnly = day(created);
      const sameDayAsCreation = createdOnly.getTime() === todayOnly.getTime();
      const anyChecked = !!o.ficheLhost || !!o.paiementClient || !!o.colisEnvoye;
      const allChecked = !!o.ficheLhost && !!o.paiementClient && !!o.colisEnvoye;
      let visible = showAllObjets || sameDayAsCreation || anyChecked;
      if (allChecked && !showAllObjets) {
        const completed = o.completedAt ? new Date(o.completedAt) : createdOnly;
        const completedOnly = day(completed);
        const diffDays = (todayOnly.getTime() - completedOnly.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays >= 1) visible = false;
      }
      if (!visible) return false;
      if (q) {
        const hay = `${o.objet || ''} ${o.nomClient || ''} ${o.chambre || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db - da;
    });
  }, [objetsTrouves, showAllObjets, searchObjets]);

  useEffect(() => {
    if (isLoading) return;
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      const isResetPage = path.includes('/update-password') || path.includes('/reset-password');
      if (!user && !isResetPage) router.push('/login');
    }
  }, [user, isLoading]);

  if (!user) return <div className="p-10 text-center text-gray-500 flex items-center justify-center min-h-screen">Chargement de l'application...</div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-6 font-sans">
      
      {/* --- HEADER --- */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between w-full mb-8 gap-4">
        
        <div className="flex flex-col">
           <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Bonjour, {user.name}
           </h1>
           <p className="text-sm text-slate-500">
             Voici ce qui se passe aujourd'hui à l'hôtel.
           </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
          {/* Navigation Date */}
          <div className="flex items-center bg-white rounded-full shadow-sm border border-slate-200 px-1 py-1">
            <Button variant="ghost" size="icon" onClick={() => changeDay(-1)} className="h-8 w-8 rounded-full hover:bg-slate-100">
              <ChevronLeft className="w-4 h-4 text-slate-600" />
            </Button>
            <button onClick={() => setShowCalendar(true)} className="px-4 text-sm font-semibold text-slate-700 hover:text-indigo-600 transition-colors">
              {format(selectedDate, 'eeee d MMMM', { locale: fr })}
            </button>
            <Button variant="ghost" size="icon" onClick={() => changeDay(1)} className="h-8 w-8 rounded-full hover:bg-slate-100">
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </Button>
          </div>

           {/* Sélecteur Hôtel */}
           {hotels.length > 1 && (
            <div className="flex bg-white rounded-full shadow-sm border border-slate-200 p-1">
              {hotels.map((h: any) => (
                <button
                  key={h.id}
                  onClick={() => setSelectedHotelId(h.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 ${
                    h.id === selectedHotelId 
                      ? "bg-indigo-600 text-white shadow-md" 
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {h.nom}
                </button>
              ))}
            </div>
          )}

           {/* Apps Menu */}
           <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="bg-white shadow-sm rounded-full border-slate-200">
                <Grid className="w-4 h-4 text-slate-600" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 p-2 grid grid-cols-2 gap-2">
              <a href="/planning" target="_blank" className="col-span-2 flex items-center gap-3 p-2 hover:bg-slate-50 rounded-md transition-colors">
                  <div className="bg-indigo-50 p-2 rounded-md"><CalendarDays className="w-4 h-4 text-indigo-600"/></div>
                  <span className="text-sm font-medium">Planning</span>
              </a>
              {currentHotel?.has_parking && (
                <a href="/parking" target="_blank" className="flex flex-col items-center justify-center p-3 bg-green-50 hover:bg-green-100 rounded-lg text-green-700 gap-1">
                  <Car className="w-5 h-5" /> <span className="text-xs font-medium">Parking</span>
                </a>
              )}
               {currentHotel?.has_coworking && (
                <a href="/fidelite" target="_blank" className="flex flex-col items-center justify-center p-3 bg-purple-50 hover:bg-purple-100 rounded-lg text-purple-700 gap-1">
                  <Stamp className="w-5 h-5" /> <span className="text-xs font-medium">Co-Work</span>
                </a>
              )}
              <a href="/commandes" target="_blank" className="flex flex-col items-center justify-center p-3 bg-orange-50 hover:bg-orange-100 rounded-lg text-orange-700 gap-1">
                <ShoppingCart className="w-5 h-5" /> <span className="text-xs font-medium">Commandes</span>
              </a>
              <a href={`/trousseau?hotel_id=${hotelId}`} target="_blank" className="flex flex-col items-center justify-center p-3 bg-cyan-50 hover:bg-cyan-100 rounded-lg text-cyan-700 gap-1">
                <KeyRound className="w-5 h-5" /> <span className="text-xs font-medium">Identifiants</span>
              </a>
              <a href={`/repertoire?hotel_id=${hotelId}`} target="_blank" className="flex flex-col items-center justify-center p-3 bg-blue-50 hover:bg-blue-100 rounded-lg text-blue-700 gap-1">
                <NotebookText className="w-5 h-5" /> <span className="text-xs font-medium">Contacts</span>
              </a>
               <a href={`/process?hotel_id=${hotelId}`} target="_blank" className="flex flex-col items-center justify-center p-3 bg-gray-50 hover:bg-gray-100 rounded-lg text-gray-700 gap-1">
                <Settings className="w-5 h-5" /> <span className="text-xs font-medium">Process</span>
              </a>
              {/* Maintenance - Corniche uniquement */}
              {currentHotel?.nom?.toLowerCase().includes("corniche") && (
                <a href={`/maintenance?hotel_id=${hotelId}`} target="_blank" className="flex flex-col items-center justify-center p-3 bg-yellow-50 hover:bg-yellow-100 rounded-lg text-yellow-700 gap-1">
                  <Wrench className="w-5 h-5" /> <span className="text-xs font-medium">Maintenance</span>
                </a>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Logout */}
          <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full" onClick={logout}>
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* --- GRID MAIN --- */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_2fr_1.2fr] gap-6">
        
        {/* COL 1 : CONSIGNES */}
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  📌 Consignes
                  <span className="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded-full">{consignesVisibles.length}</span>
                </h2>
                <div className="flex items-center gap-3">
                    <button 
                        onClick={() => setShowValidatedConsignes(!showValidatedConsignes)}
                        className={`text-xs px-2 py-1 rounded-md transition-colors ${showValidatedConsignes ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                        {showValidatedConsignes ? 'Masquer validées' : 'Voir validées'}
                    </button>
                    <Button 
                        size="sm" 
                        className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow shadow-indigo-200"
                        onClick={() => {
                            setNewConsigne({ texte: '', service: 'Tous les services', date: '', valide: false, utilisateurs_ids: [], date_fin: '', });
                            setEditConsigneIndex(null);
                            setShowConsigneModal(true);
                        }}
                    >
                        <PlusCircle className="w-4 h-4 mr-1" /> Ajouter
                    </Button>
                </div>
            </div>

            <div className="flex flex-col gap-3">
                {consignesVisibles.map((c, idx) => (
                    <div key={idx} className={`group relative p-5 rounded-2xl border transition-all duration-300 ${c.valide ? 'bg-slate-50 border-slate-100 opacity-60' : 'bg-white border-slate-100 shadow-sm hover:shadow-md hover:border-indigo-100'}`}>
                        <div className="flex justify-between items-start mb-2">
                             <div className="flex items-center gap-2">
                                 {/* Avatar/Badge Auteur */}
                                <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500 uppercase">
                                    {c.auteur ? c.auteur.substring(0,2) : 'AN'}
                                </div>
                                <span className="text-xs text-slate-400">{formatSafeDate(c.created_at)}</span>
                             </div>
                             
                             {/* Actions au survol */}
                             <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200">
                                <button onClick={() => modifierConsigne(idx)} className="p-1.5 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600 transition"><Edit2 className="w-3.5 h-3.5" /></button>
                                {!c.valide && (
                                    <button onClick={() => validerConsigne(idx)} className="p-1.5 hover:bg-green-50 rounded text-slate-400 hover:text-green-600 transition" title="Valider"><CheckCircle className="w-3.5 h-3.5" /></button>
                                )}
                             </div>
                        </div>

                        <div className={`text-sm text-slate-700 whitespace-pre-wrap break-words leading-relaxed ${c.valide ? 'line-through text-slate-400' : ''}`}>
                            {c.texte}
                        </div>
                    </div>
                ))}
                {consignesVisibles.length === 0 && <div className="text-center py-10 text-slate-400 text-sm bg-white rounded-2xl border border-dashed border-slate-200">Rien à signaler 🎉</div>}
            </div>
        </div>

        {/* COL 2 : TICKETS (TO DO) */}
        <div className="flex flex-col gap-4">
             <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  🎟️ To Do
                  <span className="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded-full">{ticketsVisibles.length}</span>
                </h2>
                <div className="flex items-center gap-2">
                    {/* Filtre service */}
                    <select 
                        className="text-xs bg-white border border-slate-200 rounded-full px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        value={filterService} onChange={(e) => setFilterService(e.target.value)}
                    >
                        <option value="Tous">Tous</option>
                        <option value="Réception">Réception</option>
                        <option value="Housekeeping">Housekeeping</option>
                        <option value="F&B">F&B</option>
                        <option value="Maintenance">Maintenance</option>
                    </select>
                     <button 
                        onClick={() => setShowValidatedTickets(!showValidatedTickets)}
                        className={`text-xs px-2 py-1 rounded-md transition-colors ${showValidatedTickets ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                        {showValidatedTickets ? 'Masquer' : 'Voir'} faits
                    </button>
                    <Button 
                        size="sm" 
                        className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow shadow-indigo-200 w-8 h-8 p-0 flex items-center justify-center"
                        onClick={() => {
                            setNewTicket({ titre: '', service: 'Réception', dateAction: formatDate(selectedDate, 'yyyy-MM-dd'), priorite: 'Moyenne', date_fin: '' });
                            setEditTicketIndex(null);
                            setShowTicketModal(true);
                        }}
                    >
                        <PlusCircle className="w-5 h-5" />
                    </Button>
                </div>
            </div>

            <div className="flex flex-col gap-3">
                {ticketsVisibles.map((t, idx) => (
                    <div key={idx} className={`group relative p-4 rounded-2xl border transition-all duration-300 ${t.valide ? 'bg-slate-50 border-slate-100 opacity-50' : 'bg-white border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-0.5'}`}>
                        
                        <div className="flex justify-between items-start mb-2">
                             <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">{etiquette(t.service)}</span>
                             <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${priorityColor(t.priorite)}`}>
                                {t.priorite}
                             </span>
                        </div>

                        <div className={`text-sm font-medium leading-snug break-words ${t.valide ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
                            {t.titre}
                        </div>

                        <div className="mt-3 flex justify-end items-center gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200">
                            <button 
                                onClick={() => {
                                    const realIndex = tickets.findIndex(ticket => ticket.id === t.id);
                                    if (realIndex === -1) return;
                                    setNewTicket({ ...t });
                                    setEditTicketIndex(realIndex);
                                    setShowTicketModal(true);
                                }}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                            >
                                <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {!t.valide && (
                                <Button size="sm" variant="ghost" className="h-7 text-xs text-green-600 hover:text-green-700 hover:bg-green-50 px-2" onClick={() => {
                                    const realIndex = tickets.findIndex(ticket => ticket.id === t.id);
                                    if (realIndex !== -1) validerTicket(realIndex);
                                }}>
                                    <CheckCircle className="w-3.5 h-3.5 mr-1" /> Fait
                                </Button>
                            )}
                        </div>
                    </div>
                ))}
                 {ticketsVisibles.length === 0 && <div className="text-center py-10 text-slate-400 text-sm bg-white rounded-2xl border border-dashed border-slate-200">Tout est propre ✨</div>}
            </div>
        </div>

        {/* COL 3 : SIDEBAR (Météo, KPIs, Taxis) */}
        <div className="flex flex-col gap-6">
            
            {/* METEO WIDGET */}
            <div className={`rounded-3xl p-4 shadow-sm border border-white/50 ${mainMeteo ? bgColorForWeather(mainMeteo.weathercode) : "bg-white"}`}>
                 <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                         <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-sm">
                            {mainMeteo ? weatherIconSVG(mainMeteo.weathercode) : <div className="w-4 h-4 bg-gray-200 rounded-full animate-pulse"/>}
                         </div>
                         <div>
                            <div className="text-xs font-bold text-slate-700 uppercase tracking-wide">Météo</div>
                            <div className="text-[10px] text-slate-500">{formatDate(selectedDate, "d MMMM")}</div>
                         </div>
                    </div>
                 </div>

                 {hasMeteo ? (
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            {meteoMorning && (
                                <div className="bg-white/60 rounded-2xl p-2 flex flex-col items-center text-center">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">Matin</span>
                                    <span className="text-lg font-bold text-slate-800">{meteoMorning.temperature}°</span>
                                    <span className="text-[10px] text-slate-500 leading-tight">{weatherLabel(meteoMorning.weathercode)}</span>
                                    <div className="flex items-center justify-center gap-1 mt-1 text-[10px] text-slate-600">
                                        <svg width="14" height="14" viewBox="0 0 24 24" style={{ transform: `rotate(${meteoMorning.winddirection + 180}deg)` }}>
                                             <path d="M12 2 L15 8 H9 L12 2 Z M11 8 V20 H13 V8 H11 Z" fill="currentColor"/>
                                        </svg>
                                        <span>{Math.round(meteoMorning.windspeed)} km/h</span>
                                    </div>
                                </div>
                            )}
                             {meteoAfternoon && (
                                <div className="bg-white/60 rounded-2xl p-2 flex flex-col items-center text-center">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">Aprem</span>
                                    <span className="text-lg font-bold text-slate-800">{meteoAfternoon.temperature}°</span>
                                    <span className="text-[10px] text-slate-500 leading-tight">{weatherLabel(meteoAfternoon.weathercode)}</span>
                                    <div className="flex items-center justify-center gap-1 mt-1 text-[10px] text-slate-600">
                                        <svg width="14" height="14" viewBox="0 0 24 24" style={{ transform: `rotate(${meteoAfternoon.winddirection + 180}deg)` }}>
                                             <path d="M12 2 L15 8 H9 L12 2 Z M11 8 V20 H13 V8 H11 Z" fill="currentColor"/>
                                        </svg>
                                        <span>{Math.round(meteoAfternoon.windspeed)} km/h</span>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="flex justify-between items-center px-2 text-xs text-slate-600 font-medium">
                             {seaTemp && <span>🌊 {seaTemp.toFixed(1)}°C</span>}
                             {sunTimes && <span>☀️ {sunTimes.sunrise} - {sunTimes.sunset}</span>}
                        </div>
                    </div>
                 ) : ( <div className="text-xs text-center py-2 text-slate-400">Chargement...</div>)}
            </div>

            {/* TAXIS / REVEILS */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
                 <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-slate-800">🚖 Taxis & Réveils</h3>
                    <button onClick={() => {
                        setNewTaxi({ type: 'Taxi', chambre: '', heure: '', statut: 'Prévu', dateAction: formatDate(selectedDate, 'yyyy-MM-dd'), prix:'', chauffeur:'' });
                        setEditDemandeIndex(null);
                        setShowTaxiModal(true);
                    }} className="w-6 h-6 bg-slate-100 hover:bg-slate-200 rounded-full flex items-center justify-center text-slate-600 transition">
                        <PlusCircle className="w-4 h-4" />
                    </button>
                 </div>
                 
                 <div className="space-y-2">
                    {demandesVisibles.map((d, idx) => (
                        <div key={idx} className={`flex justify-between items-center p-2 rounded-lg border-l-4 text-sm ${
                            d.statut === 'À prévoir' ? 'border-orange-400 bg-orange-50' : 
                            d.statut === 'Fait' ? 'border-green-500 bg-slate-50 opacity-60' : 
                            'border-blue-500 bg-white shadow-sm'
                        }`}>
                             <div className="flex flex-col">
                                <span className="font-bold text-slate-700">
                                    {d.heure?.slice(0, 5)} <span className="font-normal text-slate-500">- Ch. {d.chambre}</span>
                                </span>
                                <span className="text-[10px] text-slate-400 uppercase tracking-wide">{d.type}</span>
                             </div>

                             <div className="flex items-center gap-1">
                                <select 
                                    value={d.statut || 'À prévoir'}
                                    onChange={async (e) => {
                                        const newStatut = e.target.value;
                                        await supabase.from('demandes').update({ statut: newStatut }).eq('id', d.id);
                                        const realIndex = demandes.findIndex(dd => dd.id === d.id);
                                        if (realIndex !== -1) {
                                            const updated = [...demandes]; updated[realIndex].statut = newStatut; setDemandes(updated);
                                        }
                                    }}
                                    className="text-[10px] bg-transparent border-none focus:ring-0 text-slate-600 font-medium text-right"
                                >
                                    <option value="À prévoir">À prévoir</option>
                                    <option value="Prévu">Prévu</option>
                                    <option value="Fait">Fait</option>
                                </select>
                                <button onClick={() => {
                                     const realIndex = demandes.findIndex(dd => dd.id === d.id);
                                     if (realIndex === -1) return;
                                     setNewTaxi({ type: d.type ?? 'Taxi', chambre: d.chambre ?? '', heure: d.heure ?? '', prix: d.prix ?? '', chauffeur: d.chauffeur_id ?? '', statut: d.statut ?? 'Prévu', dateAction: d.date ?? formatDate(selectedDate, 'yyyy-MM-dd') });
                                     setEditDemandeIndex(realIndex); setShowTaxiModal(true);
                                }} className="text-slate-300 hover:text-indigo-600"><Edit2 className="w-3 h-3"/></button>
                                <button onClick={() => { if(confirm('Supprimer ?')) deleteDemande(d.id); }} className="text-slate-300 hover:text-red-500"><XCircle className="w-3 h-3"/></button>
                             </div>
                        </div>
                    ))}
                    {demandesVisibles.length === 0 && <div className="text-xs text-slate-400 text-center py-2">Aucun taxi / réveil</div>}
                 </div>
            </div>

            {/* KPIS - VERSION CLEAN & MODERNE */}
             <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        📊 Performance
                    </h3>
                    {isAdmin && (
                        <div className="text-[10px] text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full font-medium animate-pulse">
                            Mode Édition
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-6">
                    {[
                      { key: "ca", label: "Chiffre d'affaires", suffix: "€", icon: "💰", color: "bg-yellow-50 text-yellow-600" },
                      { key: "taux_occupation", label: "Taux d'occupation", suffix: "%", icon: "🛏️", color: "bg-blue-50 text-blue-600" },
                      { key: "prix_moyen", label: "Prix Moyen", suffix: "€", icon: "🏷️", color: "bg-emerald-50 text-emerald-600" },
                      { key: "guest_review", label: "Note Guest", suffix: "/10", icon: "⭐", color: "bg-purple-50 text-purple-600" },
                    ].map((def, i) => {
                      const value = kpis?.[def.key];
                      const target = kpis?.[`${def.key}_objectif`];
                      const progress = value && target ? Math.min(100, (value / target) * 100) : 0;
                      
                      // Couleurs barre
                      let barColor = "bg-indigo-500";
                      if (progress >= 100) barColor = "bg-emerald-500";
                      else if (progress < 50) barColor = "bg-orange-400";

                      return (
                        <div key={i} className="flex items-center gap-4">
                            {/* Icône carrée */}
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shadow-sm ${def.color}`}>
                                {def.icon}
                            </div>

                            {/* Contenu */}
                            <div className="flex-1">
                                <div className="flex justify-between items-end mb-1">
                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">{def.label}</span>
                                    <span className={`text-xs font-bold ${progress >= 100 ? 'text-emerald-600' : 'text-slate-400'}`}>{progress.toFixed(0)}%</span>
                                </div>

                                <div className="flex items-baseline gap-1.5">
                                    {/* VALEUR ACTUELLE (Editable si Admin) */}
                                    <div className="relative group">
                                        {isAdmin ? (
                                            <input 
                                                type="number" 
                                                className="w-24 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 text-xl font-bold text-slate-800 outline-none transition-all p-0 m-0" 
                                                value={value ?? ""} 
                                                placeholder="0"
                                                onChange={(e) => setKpis((prev:any) => ({ ...prev, [def.key]: Number(e.target.value) }))} 
                                            />
                                        ) : (
                                            <span className="text-xl font-bold text-slate-800">{formatNumber(value)}</span>
                                        )}
                                        <span className="text-sm text-slate-500 font-medium ml-0.5">{def.suffix}</span>
                                    </div>

                                    {/* SEPARATEUR & OBJECTIF */}
                                    <span className="text-slate-300 text-lg font-light">/</span>
                                    
                                    <div className="relative group">
                                         {isAdmin ? (
                                            <input 
                                                type="number" 
                                                className="w-16 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 text-sm font-medium text-slate-400 outline-none transition-all p-0 m-0" 
                                                value={target ?? ""} 
                                                placeholder="Obj"
                                                onChange={(e) => setKpis((prev:any) => ({ ...prev, [`${def.key}_objectif`]: Number(e.target.value) }))} 
                                            />
                                        ) : (
                                            <span className="text-sm font-medium text-slate-400">{formatNumber(target)}</span>
                                        )}
                                    </div>
                                </div>

                                {/* Barre de progression */}
                                <div className="mt-2 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                    <div 
                                        className={`h-full rounded-full transition-all duration-1000 ease-out ${barColor}`} 
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                      );
                    })}
                </div>

                {isAdmin && (
                    <div className="flex justify-end mt-6">
                         <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md transition-all hover:-translate-y-0.5" onClick={async () => {
                             const payload = { hotel_id: hotelId, mois: selectedDate.getMonth() + 1, annee: selectedDate.getFullYear(), ...kpis };
                             await supabase.from("kpis").upsert(payload, { onConflict: "hotel_id,mois,annee" });
                             alert("Données mises à jour ✅");
                         }}>
                            <Save />
                         </Button>
                    </div>
                )}
             </div>
        </div>
      </div>

      {/* --- SECTION BASSE : Objets & Admin --- */}
      <div className="mt-8 grid grid-cols-1 gap-8">
         
         {/* Objets Trouvés */}
         <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
             <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                <h2 className="text-lg font-bold text-slate-800">🧳 Objets trouvés</h2>
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                    <div className="relative flex-1">
                        <Search className="absolute left-2 top-2.5 w-4 h-4 text-slate-400" />
                        <input 
                            className="pl-8 pr-4 py-2 text-sm border border-slate-200 rounded-full w-full focus:ring-2 focus:ring-indigo-500 focus:outline-none" 
                            placeholder="Rechercher..." 
                            value={searchObjets} onChange={(e) => setSearchObjets(e.target.value)}
                        />
                    </div>
                    {/* Switch "Tout afficher" */}
                    <button 
                        type="button"
                        role="switch"
                        aria-checked={showAllObjets}
                        onClick={() => setShowAllObjets(!showAllObjets)}
                        className="group flex items-center gap-1.5 text-xs bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-full transition"
                    >
                        <span className={`inline-block h-3 w-3 rounded-full transition ${showAllObjets ? "bg-indigo-600" : "bg-slate-400"}`} />
                        <span className="whitespace-nowrap select-none font-medium text-slate-600">{showAllObjets ? 'Tout masquer' : 'Tout afficher'}</span>
                    </button>

                    <div className="flex items-center gap-2">
                        <a href="https://resort.mylhost.com/login" target="_blank" className="text-xs font-bold text-orange-600 bg-orange-50 px-3 py-2 rounded-full hover:bg-orange-100 transition flex items-center gap-1">
                             LHOST <ExternalLink className="w-3 h-3"/>
                        </a>
                        <Button 
    size="sm" 
    onClick={() => setShowObjetModal(true)} 
    className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow shadow-indigo-200"
>
    <PlusCircle className="w-4 h-4 mr-1"/> Ajouter
</Button>
                    </div>
                </div>
             </div>

             <div className="grid grid-cols-1 gap-3">
                {objetsVisibles.map((o, idx) => {
                    const complet = o.ficheLhost && o.paiementClient && o.colisEnvoye;
                    return (
                        <div key={o.id ?? idx} className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl border ${complet ? 'bg-slate-50 border-slate-100 opacity-50' : 'bg-white border-slate-100'}`}>
                             <div className="flex flex-col">
                                 <span className="text-sm font-bold text-slate-800">{o.objet}</span>
                                 <div className="flex items-center gap-2 text-xs text-slate-500">
                                     <span>{format(new Date(o.date), 'dd MMM')}</span>
                                     <span>•</span>
                                     <span>Ch. {o.chambre}</span>
                                     <span>•</span>
                                     <span>{o.nomClient}</span>
                                 </div>
                             </div>
                             
                             <div className="flex items-center gap-4 flex-wrap">
                                 {['ficheLhost', 'paiementClient', 'colisEnvoye'].map(field => (
                                     <label key={field} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                                         <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${o[field] ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 bg-white'}`}>
                                             {o[field] && <CheckCircle className="w-3 h-3 text-white" />}
                                         </div>
                                         <input type="checkbox" className="hidden" checked={!!o[field]} onChange={(e) => toggleObjetCheckbox(o.id, field, e.target.checked)} />
                                         <span className="text-slate-600">{field === 'ficheLhost' ? 'LHOST' : field === 'paiementClient' ? 'Paiement' : 'Envoyé'}</span>
                                     </label>
                                 ))}
                                 <div className="w-px h-4 bg-slate-200 mx-2 hidden sm:block"></div>
                                 <div className="flex gap-2">
                                    <button 
    onClick={() => { 
        setNewObjet({ ...o }); 
        // CORRECTION : On cherche le vrai index dans la liste principale 'objetsTrouves'
        const realIndex = objetsTrouves.findIndex(item => item.id === o.id);
        setEditObjetIndex(realIndex); 
        setShowObjetModal(true); 
    }} 
    className="text-slate-400 hover:text-indigo-600"
>
    <Edit2 className="w-4 h-4"/>
</button>
                                    <button onClick={() => deleteObjet(o.id)} className="text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4"/></button>
                                 </div>
                             </div>
                        </div>
                    )
                })}
             </div>
         </div>

         {/* Admin Section */}
         {user.role === 'admin' && (
            <div className="bg-slate-100 rounded-2xl p-6 border border-slate-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="font-bold text-slate-700">Administration</h2>
                    <div className="flex gap-2">
                         <Button variant="outline" size="sm" onClick={() => setShowUserModal(true)}>Créer utilisateur</Button>
                         <Button variant="outline" size="sm" onClick={() => setShowUsersList(!showUsersList)}>{showUsersList ? 'Masquer' : 'Gérer'} utilisateurs</Button>
                    </div>
                </div>
                {showUsersList && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3"> {/* RETOUR AUX 2 COLONNES ICI */}
                         {[...users].sort((a, b) => {
                             // 1. Déterminer si clôturé
                             const isClosedA = a.active === false || (a.employment_end_date && new Date(a.employment_end_date) < new Date());
                             const isClosedB = b.active === false || (b.employment_end_date && new Date(b.employment_end_date) < new Date());
                             
                             // 2. Tri par Statut (Actifs en premier)
                             if (isClosedA !== isClosedB) return isClosedA ? 1 : -1;
                             
                             // 3. Tri Alphabétique sur le nom
                             return (a.name || '').localeCompare(b.name || '');
                         }).map((u, idx) => {
                             const isClosed = u.active === false || (u.employment_end_date && new Date(u.employment_end_date) < new Date());
                             
                             return (
                                 <div key={u.id || idx} className={`p-3 rounded-lg border flex flex-col gap-2 shadow-sm transition-all ${isClosed ? 'bg-slate-200 border-slate-300 opacity-70' : 'bg-white border-slate-200'}`}>
                                     <div className="flex justify-between items-start">
                                         <div>
                                             <div className="font-bold text-sm text-slate-800 flex items-center gap-2">
                                                {u.name}
                                                {isClosed && <span className="text-[10px] bg-slate-300 text-slate-600 px-1.5 rounded">Clôturé</span>}
                                             </div>
                                             <div className="text-xs text-slate-500">{u.email}</div>
                                         </div>
                                         <div className="text-xs font-medium bg-slate-50 px-2 py-1 rounded text-slate-600 border border-slate-100">
                                             {u.role}
                                         </div>
                                     </div>
                                     
                                     <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100/50 mt-1">
                                         {/* Sélecteur d'hôtel */}
                                         <select
                                            className="text-[11px] border border-slate-200 rounded px-2 py-1 bg-slate-50 focus:ring-2 focus:ring-indigo-500 outline-none w-full max-w-[120px]"
                                            value={u.hotel_id || ""}
                                            onChange={async (e) => {
                                              const newHotelId = e.target.value;
                                              const { error } = await supabase.from('users').update({ hotel_id: newHotelId }).eq('id_auth', u.id_auth);
                                              if (error) { alert("Erreur update: " + error.message); return; }
                                              setUsers(prev => prev.map((user) => user.id_auth === u.id_auth ? { ...user, hotel_id: newHotelId } : user));
                                            }}
                                          >
                                            {hotels.map((h: any) => (
                                              <option value={h.id} key={h.id}>{h.nom}</option>
                                            ))}
                                          </select>

                                         {/* Boutons Actions */}
                                         {!isClosed ? 
                                            <Button size="sm" variant="destructive" className="h-7 text-[10px] px-2" onClick={() => openCloseModal(u)}>Clôturer</Button> :
                                            <Button size="sm" variant="outline" className="h-7 text-[10px] px-2 text-green-600 border-green-200 hover:bg-green-50 bg-white" onClick={() => reactivateUser(u)}>Réactiver</Button>
                                         }
                                     </div>
                                 </div>
                             );
                         })}
                    </div>
                )}
            </div>
         )}

         {/* Footer Apps */}
         <div className="text-center py-10">
             <h3 className="text-slate-400 text-sm mb-6 font-medium uppercase tracking-widest">Télécharger l'application mobile</h3>
             <div className="flex flex-wrap justify-center gap-6">
                 <a href={PLAY_URL} target="_blank" className="group flex items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition">
                     <QRCodeSVG value={PLAY_URL} size={60} />
                     <div className="text-left">
                         <div className="text-xs text-slate-500">Disponible sur</div>
                         <div className="font-bold text-slate-800">Google Play</div>
                     </div>
                 </a>
                 <a href={APPLE_URL} target="_blank" className="group flex items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition">
                     <QRCodeSVG value={APPLE_URL} size={60} />
                     <div className="text-left">
                         <div className="text-xs text-slate-500">Disponible sur</div>
                         <div className="font-bold text-slate-800">App Store</div>
                     </div>
                 </a>
             </div>
         </div>
      </div>

      {/* --- MODALES --- */}
      
      {/* Modal Taxi */}
      {showTaxiModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-md space-y-4 animate-in fade-in zoom-in duration-200">
            <h2 className="text-xl font-bold text-slate-800">Nouveau Taxi / Réveil</h2>
            <div className="grid grid-cols-2 gap-3">
                <select className="border rounded-lg px-3 py-2" value={newTaxi.type} onChange={(e) => setNewTaxi({ ...newTaxi, type: e.target.value })}>
                    <option value="Taxi">Taxi</option><option value="Réveil">Réveil</option><option value="VTC">VTC</option>
                </select>
                <input type="date" className="border rounded-lg px-3 py-2" value={newTaxi.dateAction} onChange={(e) => setNewTaxi({ ...newTaxi, dateAction: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
                 <Input type="time" value={newTaxi.heure} onChange={(e) => setNewTaxi({ ...newTaxi, heure: e.target.value })} />
                 <Input placeholder="Chambre #" value={newTaxi.chambre} onChange={(e) => setNewTaxi({ ...newTaxi, chambre: e.target.value })} />
            </div>
            {newTaxi.type === "VTC" && (
                <div className="space-y-2 bg-slate-50 p-3 rounded-lg">
                     <Input type="number" placeholder="Prix (€)" value={newTaxi.prix} onChange={(e) => setNewTaxi({ ...newTaxi, prix: e.target.value })} />
                     <select className="w-full border rounded px-2 py-2 text-sm" value={newTaxi.chauffeur || ""} onChange={(e) => setNewTaxi({ ...newTaxi, chauffeur: e.target.value })}>
                        <option value="">Choisir chauffeur</option>
                        {chauffeurs.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                     </select>
                </div>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={() => setShowTaxiModal(false)}>Annuler</Button>
              <Button onClick={createDemande} className="bg-indigo-600 text-white hover:bg-indigo-700">{editDemandeIndex !== null ? 'Modifier' : 'Créer'}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ticket */}
      {showTicketModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-md space-y-4 animate-in fade-in zoom-in duration-200">
            <h2 className="text-xl font-bold text-slate-800">Nouvelle tâche</h2>
            <Input placeholder="Titre de la tâche..." className="text-lg font-medium" value={newTicket.titre} onChange={(e) => setNewTicket({ ...newTicket, titre: e.target.value })} />
            
            <div className="grid grid-cols-2 gap-3">
                 <div>
                    <label className="text-xs text-slate-500 font-bold uppercase">Service</label>
                    <select className="w-full border rounded-lg px-3 py-2 mt-1" value={newTicket.service} onChange={(e) => setNewTicket({ ...newTicket, service: e.target.value })}>
                        <option>Réception</option><option>Housekeeping</option><option>F&B</option><option>Maintenance</option>
                    </select>
                 </div>
                 <div>
                    <label className="text-xs text-slate-500 font-bold uppercase">Priorité</label>
                    <select className="w-full border rounded-lg px-3 py-2 mt-1" value={newTicket.priorite} onChange={(e) => setNewTicket({ ...newTicket, priorite: e.target.value })}>
                        <option>Basse</option><option>Moyenne</option><option>Haute</option>
                    </select>
                 </div>
            </div>
            
            <div>
                <label className="text-xs text-slate-500 font-bold uppercase">Date d'action</label>
                <Input type="date" className="mt-1" value={newTicket.dateAction} onChange={(e) => setNewTicket({ ...newTicket, dateAction: e.target.value })} />
            </div>

            <div className="pt-2 border-t border-slate-100">
                <label className="flex items-center gap-2 text-sm text-slate-700 mb-2 cursor-pointer">
                    <input type="checkbox" checked={!!newTicket.date_fin} onChange={(e) => setNewTicket({...newTicket, date_fin: e.target.checked ? formatDate(selectedDate, 'yyyy-MM-dd') : ''})}/>
                    Répéter cette tâche jusqu'au...
                </label>
                {newTicket.date_fin && <Input type="date" value={newTicket.date_fin} onChange={(e) => setNewTicket({ ...newTicket, date_fin: e.target.value })} />}
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={() => { setShowTicketModal(false); setEditTicketIndex(null); }}>Annuler</Button>
              <Button onClick={createTicket} className="bg-indigo-600 text-white hover:bg-indigo-700">{editTicketIndex !== null ? 'Modifier' : 'Créer'}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Consigne (Corrigé : Filtre Actifs + Tri Alpha) */}
      {showConsigneModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-md space-y-4 animate-in fade-in zoom-in duration-200">
            <h2 className="text-xl font-bold text-slate-800">Passer une consigne</h2>
            
            {/* Zone de texte */}
            <textarea 
                placeholder="Écrivez votre message ici..." 
                value={newConsigne.texte} 
                onChange={(e) => setNewConsigne({ ...newConsigne, texte: e.target.value })} 
                rows={5} 
                className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none text-sm bg-slate-50"
            />
            
            {/* Sélecteur Utilisateurs */}
            <div className="relative" ref={userDropdownRef}>
                <label className="text-xs text-slate-500 font-bold uppercase mb-1 block">Assigner à (Verrouiller)</label>
                <Button variant="outline" className="w-full justify-between text-slate-600 font-normal text-sm h-10 bg-white border-slate-200" onClick={() => setShowUserDropdown((prev) => !prev)}>
                    {newConsigne.utilisateurs_ids.length > 0 ? `${newConsigne.utilisateurs_ids.length} personne(s)` : "Sélectionner..."}
                    <span className="ml-2 text-xs">▼</span>
                </Button>
                
                {/* Liste déroulante FILTRÉE et TRIÉE */}
                {showUserDropdown && (
                    <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto border rounded-lg bg-white shadow-xl p-1">
                        {users
                            // 1. FILTRE : Uniquement les actifs
                            .filter(u => {
                                const isClosed = u.active === false || (u.employment_end_date && new Date(u.employment_end_date) < new Date());
                                return !isClosed;
                            })
                            // 2. TRI : Alphabétique
                            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                            .map((u) => (
                            <label key={u.id_auth} className="flex items-center gap-2 px-2 py-2 hover:bg-slate-50 rounded cursor-pointer text-sm">
                                <input 
                                    type="checkbox" 
                                    className="rounded text-indigo-600 focus:ring-indigo-500" 
                                    checked={newConsigne.utilisateurs_ids.includes(u.id_auth)} 
                                    onChange={(e) => {
                                        if (e.target.checked) setNewConsigne({ ...newConsigne, utilisateurs_ids: [...newConsigne.utilisateurs_ids, u.id_auth] });
                                        else setNewConsigne({ ...newConsigne, utilisateurs_ids: newConsigne.utilisateurs_ids.filter((id) => id !== u.id_auth) });
                                    }}
                                />
                                <span>{u.name}</span>
                            </label>
                        ))}
                        {users.filter(u => u.active !== false).length === 0 && (
                            <div className="text-xs text-slate-400 text-center py-2">Aucun utilisateur actif</div>
                        )}
                    </div>
                )}

                {/* Badges des utilisateurs sélectionnés (On affiche tout le monde ici, même les anciens s'ils étaient déjà sélectionnés) */}
                {newConsigne.utilisateurs_ids.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                        {newConsigne.utilisateurs_ids.map((id) => {
                            const user = users.find((u) => u.id_auth === id);
                            return (
                                <span key={id} className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full text-[10px] font-bold border border-indigo-100">
                                    {user?.name || "Inconnu"}
                                </span>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Date de fin */}
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input 
                        type="checkbox" 
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                        checked={!!newConsigne.date_fin} 
                        onChange={(e) => setNewConsigne({...newConsigne, date_fin: e.target.checked ? formatDate(selectedDate, 'yyyy-MM-dd') : ''})}
                    />
                    <span className="font-medium">Répéter cette consigne jusqu'au...</span>
                </label>
                {newConsigne.date_fin && (
                    <Input 
                        type="date" 
                        className="mt-2 bg-white h-9" 
                        value={newConsigne.date_fin} 
                        onChange={(e) => setNewConsigne({ ...newConsigne, date_fin: e.target.value })} 
                    />
                )}
            </div>

            <div className="flex justify-end gap-2 mt-4 pt-2 border-t border-slate-100">
              <Button variant="ghost" onClick={() => { setShowConsigneModal(false); setEditConsigneIndex(null); }}>Annuler</Button>
              <Button onClick={createConsigne} className="bg-indigo-600 text-white hover:bg-indigo-700 shadow-md">
                  {editConsigneIndex !== null ? 'Modifier' : 'Envoyer'}
              </Button>
            </div>
          </div>
        </div>
      )}

{/* Modal Objet Trouvé (MANQUANT RÉINTÉGRÉ) */}
      {showObjetModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-md space-y-4 animate-in fade-in zoom-in duration-200">
            <h2 className="text-xl font-bold text-slate-800">Nouvel objet trouvé</h2>
            
            <div className="grid grid-cols-2 gap-3">
               <Input 
                 type="date" 
                 value={newObjet.date} 
                 onChange={(e) => setNewObjet({ ...newObjet, date: e.target.value })} 
               />
               <Input 
                 placeholder="Chambre" 
                 value={newObjet.chambre} 
                 onChange={(e) => setNewObjet({ ...newObjet, chambre: e.target.value })} 
               />
            </div>
            
            <Input 
              placeholder="Nom du client" 
              value={newObjet.nomClient} 
              onChange={(e) => setNewObjet({ ...newObjet, nomClient: e.target.value })} 
            />
            <Input 
              placeholder="Description de l'objet" 
              value={newObjet.objet} 
              onChange={(e) => setNewObjet({ ...newObjet, objet: e.target.value })} 
            />

            <div className="flex justify-end gap-2 mt-4">
              <Button 
                variant="ghost" 
                onClick={() => { 
                  setShowObjetModal(false); 
                  setEditObjetIndex(null); 
                }}
              >
                Annuler
              </Button>
              <Button 
                onClick={createObjetTrouve} 
                className="bg-indigo-600 text-white hover:bg-indigo-700 shadow-md"
              >
                {editObjetIndex !== null ? 'Modifier' : 'Créer'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal User Create */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-md space-y-4">
                <h2 className="text-xl font-bold text-slate-800">Créer un utilisateur</h2>
                <Input placeholder="Nom complet" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} />
                <Input type="email" placeholder="Email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
                <Input type="password" placeholder="Mot de passe" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
                <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="w-full border rounded px-3 py-2">
                    <option value="employe">Employé</option><option value="admin">Admin</option>
                </select>
                {isAdmin && hotels.length > 0 && (
                    <select className="w-full border rounded px-3 py-2" value={newUser.hotel_id || ''} onChange={(e) => setNewUser({ ...newUser, hotel_id: e.target.value })}>
                        <option value="">Hôtel...</option>{hotels.map((h:any) => <option key={h.id} value={h.id}>{h.nom}</option>)}
                    </select>
                )}
                <div className="flex justify-end gap-2 mt-4">
                    <Button variant="ghost" onClick={() => setShowUserModal(false)}>Annuler</Button>
                    <Button onClick={handleCreateUser}>Créer</Button>
                </div>
            </div>
        </div>
      )}
      {/* Modal Clôturer Salarié (Restauré) */}
      {closeModal.open && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in zoom-in duration-200">
            <div className="bg-white rounded-2xl p-6 shadow-2xl w-full max-w-md space-y-4">
            <h2 className="text-lg font-bold text-slate-800">Clôturer un salarié</h2>
            <div className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100">
                Salarié : <span className="font-bold text-slate-900">{closeModal.user?.name || closeModal.user?.email}</span>
            </div>

            <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Date de fin de contrat</label>
                <input
                    type="date"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 outline-none"
                    value={closeModal.date}
                    onChange={e => setCloseModal(m => ({ ...m, date: e.target.value }))}
                />
            </div>

            <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setCloseModal({ open:false, user:null, date:new Date().toISOString().slice(0,10) })}>
                Annuler
                </Button>
                <Button variant="destructive" onClick={doCloseUser}>
                Confirmer la clôture
                </Button>
            </div>
            </div>
        </div>
      )}

      {/* Modal Calendrier */}
      {showCalendar && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white p-6 rounded-2xl shadow-2xl">
                <Calendar mode="single" selected={selectedDate} onSelect={(d) => { setSelectedDate(d ?? new Date()); setShowCalendar(false); }} locale={fr} />
                <div className="flex justify-end mt-4"><Button variant="ghost" onClick={() => setShowCalendar(false)}>Fermer</Button></div>
            </div>
        </div>
      )}
      
    </div>
  );
}