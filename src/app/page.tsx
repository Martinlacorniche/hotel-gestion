'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { confirmDialog } from '@/components/ConfirmDialog';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { SectionHeader } from '@/components/ui/section-header';
import { FilterMenu } from '@/components/ui/filter-menu';
import { AddButton } from '@/components/ui/add-button';
import { Pill } from '@/components/ui/pill';
import { SelectField } from '@/components/ui/select-field';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  ChevronLeft, ChevronRight, PlusCircle, Filter,
  Save, Edit2, Trash2, CheckCircle, XCircle, Search, ExternalLink,
  MessageCircle, Send, // Conversation consignes
  Pin, ListChecks, // en-têtes colonnes (design-system)
  DoorOpen, Car, BarChart3, Luggage, // en-têtes colonne 3 + objets trouvés
  Wallet, BedDouble, Tag, Star // icônes KPI
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useSelectedHotel } from '@/context/SelectedHotelContext';
import { v4 as uuidv4 } from 'uuid';
import { format as formatDate } from 'date-fns';
import { fr as frLocale } from 'date-fns/locale';
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";

// --- OUTILS / MENU ---
// Liste partagée avec la sidebar (AppShell) — définie dans src/lib/tools.ts

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
  const { user: rawUser, isLoading } = useAuth();
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
        // Open-Meteo injoignable (réseau) : le widget reste en "Chargement...",
        // rien d'autre n'est impacté — pas une erreur applicative.
        console.warn("Météo indisponible :", e);
        setMeteoMorning(null); setMeteoAfternoon(null); setSeaTemp(null); setSunTimes(null);
      }
    }
    load();
  }, [selectedDate]);

  const mainMeteo = meteoAfternoon || meteoMorning;
  const hasMeteo = !!(meteoMorning || meteoAfternoon);

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
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

  const [hotels, setHotels] = useState<any[]>([]);
  // Hôtel sélectionné = contexte global partagé avec la sidebar (rail) et toutes
  // les pages → un switch ici suit partout, et inversement.
  const { selectedHotelId } = useSelectedHotel();
  // Le défaut (hôtel attribué de l'user) est désormais résolu par
  // SelectedHotelContext — plus de logique de défaut dupliquée ici.

  const [currentHotel, setCurrentHotel] = useState<any | null>(null);
  const hotelId = selectedHotelId || (user as any)?.default_hotel_id || (user as any)?.hotel_id;

  const formatNumber = (n: number | null, suffix: string = "") => {
  if (n === null || n === undefined || isNaN(n)) return "-";
  // On détecte si c'est une note Guest pour garder 1 décimale
  const isGuestReview = suffix.includes("/10");
  
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: isGuestReview ? 1 : 0,
    maximumFractionDigits: isGuestReview ? 1 : 0,
  }).format(n);
};

  const router = useRouter();
  const [tickets, setTickets] = useState<any[]>([]);
  const [consignes, setConsignes] = useState<any[]>([]);
  const [consignesLoading, setConsignesLoading] = useState(false);
  const [taxis, setTaxis] = useState<any[]>([]);
  // Chambres libérées — mini champ "au checkout je tape 12" → transmis aux
  // équipes (bandeau du jour dans l'app). Éphémère : affiché le jour même
  // uniquement, purge auto en base après 48h. Masqué tant que la chaîne notif
  // n'est pas activée (flag absent de Netlify, comme la capture à ses débuts).
  const LIBERATIONS_ENABLED = process.env.NEXT_PUBLIC_LIBERATIONS_ENABLED === '1';
  const [liberations, setLiberations] = useState<any[]>([]);
  // Les Voiles : les chambres libérées remontent automatiquement de Mews (poller
  // → INSERT chambres_liberees → notif housekeeping). La réception n'a donc plus
  // rien à saisir → on masque l'encart manuel (gardé pour La Corniche, manuelle).
  const [liberationInput, setLiberationInput] = useState('');
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

  // Chat consigne (style SMS)
  const [chatConsigne, setChatConsigne] = useState<any | null>(null);
  const [chatInput, setChatInput] = useState('');
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editingReplyText, setEditingReplyText] = useState('');

  useEffect(() => {
    if (chatConsigne && chatScrollRef.current) {
      requestAnimationFrame(() => {
        if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      });
    }
  }, [chatConsigne?.id]);
  
  const [users, setUsers] = useState<any[]>([]);

  // Flash infos (nouveautés ciblées, lues une fois)
  const [flashQueue, setFlashQueue] = useState<any[]>([]);
  const [showFlashCreate, setShowFlashCreate] = useState(false);
  const [flashMsg, setFlashMsg] = useState('');
  const [flashTargets, setFlashTargets] = useState<string[]>([]);
  const [flashSending, setFlashSending] = useState(false);

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
    if (!(await confirmDialog('Supprimer cet objet ?'))) return;
    const { error } = await supabase.from('objets_trouves').delete().eq('id', id);
    if (error) { toast.error('Suppression impossible : ' + error.message); return; }
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

  // Taux d'occupation prévisionnel (Les Voiles uniquement) — cache rempli par
  // /api/mews/refresh-occupancy (cron). Lecture seule du cache, aucun appel Mews ici.
  const [occupancy, setOccupancy] = useState<any[] | null>(null);
  useEffect(() => {
    const isVoiles = currentHotel?.nom?.trim() === 'Les Voiles';
    if (!isVoiles || !hotelId) { setOccupancy(null); return; }
    const currentMonth = formatDate(new Date(), 'yyyy-MM');
    supabase
      .from('mews_occupancy')
      // `*` : tolère l'absence des colonnes revenu tant que la migration 66 n'est
      // pas appliquée (dégrade en saisie manuelle au lieu de planter la lecture).
      .select('*')
      .eq('hotel_id', hotelId)
      .gte('month', currentMonth)
      .order('month', { ascending: true })
      .then(({ data }) => setOccupancy(data || []));
  }, [currentHotel, hotelId]);

  const formatSafeDate = (dateStr: string | undefined) => {
    if (!dateStr || isNaN(Date.parse(dateStr))) return 'Date invalide';
    return formatDate(new Date(dateStr), 'dd MMMM', { locale: frLocale });
  };

  // --- CHAMBRES LIBÉRÉES -----------------------------------------------------
  useEffect(() => {
    if (!hotelId) return;
    const today = formatDate(new Date(), 'yyyy-MM-dd');
    supabase
      .from('chambres_liberees')
      .select('*')
      .eq('hotel_id', hotelId)
      .gte('created_at', `${today}T00:00:00`)
      .order('created_at', { ascending: false })
      .then(({ data }) => setLiberations(data ?? []));
    // Purge paresseuse : un post-it, pas un registre — rien ne traîne > 48h.
    supabase
      .from('chambres_liberees')
      .delete()
      .lt('created_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString())
      .then(() => {});
  }, [hotelId]);

  const sendLiberation = async (e: React.FormEvent) => {
    e.preventDefault();
    const rooms = liberationInput.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!rooms.length || !hotelId) return;
    const { data, error } = await supabase
      .from('chambres_liberees')
      .insert({ hotel_id: hotelId, chambres: rooms, auteur: user?.name || 'Anonyme' })
      .select()
      .single();
    if (error) { toast.error('Envoi impossible : ' + error.message); return; }
    setLiberations((prev) => [data, ...prev]);
    setLiberationInput('');
    toast.success(`Chambre${rooms.length > 1 ? 's' : ''} ${rooms.join(', ')} transmise${rooms.length > 1 ? 's' : ''} aux équipes`);
  };

  // La récep saisit au fil des départs (« ils tapent 12, ça envoie 12 ») et Mews
  // insère à chaque check-out : le schéma « 1 ligne = 1 transmission » ne tient
  // plus, on est à ~20 lignes/jour. On agrège la journée en UNE liste de
  // chambres dédoublonnée et triée — c'est la tournée du housekeeping, pas un
  // journal d'envois.
  const dayRooms = useMemo(() => (
    [...new Set(liberations.flatMap((l) => (l.chambres ?? []) as string[]))]
      .sort((a, b) => {
        const na = parseInt(a, 10), nb = parseInt(b, 10);
        if (Number.isNaN(na) && Number.isNaN(nb)) return a.localeCompare(b);
        if (Number.isNaN(na)) return 1;   // « recouche » & co. en fin de liste
        if (Number.isNaN(nb)) return -1;
        return na - nb;
      })
  ), [liberations]);

  // On retire une CHAMBRE, pas une transmission : personne ne raisonne en
  // « l'envoi de 9h04 ». Elle peut vivre dans plusieurs lignes → on la retire
  // de toutes, et une ligne vidée disparaît.
  const removeRoom = async (num: string) => {
    const rows = liberations.filter((l) => ((l.chambres ?? []) as string[]).includes(num));
    if (!rows.length) return;
    for (const l of rows) {
      const rest = ((l.chambres ?? []) as string[]).filter((n) => n !== num);
      if (rest.length) await supabase.from('chambres_liberees').update({ chambres: rest }).eq('id', l.id);
      else await supabase.from('chambres_liberees').delete().eq('id', l.id);
    }
    setLiberations((prev) => prev
      .map((l) => (rows.some((r) => r.id === l.id)
        ? { ...l, chambres: ((l.chambres ?? []) as string[]).filter((n) => n !== num) }
        : l))
      .filter((l) => ((l.chambres ?? []) as string[]).length > 0));
  };

  const [objetsTrouves, setObjetsTrouves] = useState<any[]>([]);
  const [showAllObjets, setShowAllObjets] = useState(false);
  const [searchObjets, setSearchObjets] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

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
      // Le daf est écarté à la source : il ne travaille pas dans l'hôtel et
      // n'a donc rien à faire dans les destinataires de flash info, les
      // assignations de consigne ni les anniversaires. Son seul outil est
      // l'écran Tendance de l'app mobile.
      const { data, error } = await supabase
        .from('users').select('*').eq('hotel_id', hotelId).neq('role', 'daf');
      if (!error) setUsers(data || []);
    };
    if (hotelId) fetchUsers();
  }, [hotelId]);

  // ── Flash infos (nouveautés) ──
  const isSuperadmin = user?.role === 'superadmin';
  const activeUsers = users.filter((u: any) => u.active !== false);

  useEffect(() => {
    const uid = (user as any)?.id_auth || user?.id;
    if (!uid) return;
    supabase.from('flash_infos').select('*').eq('active', true).order('created_at', { ascending: false })
      .then(({ data }) => {
        const unread = (data || []).filter((f: any) => {
          const targeted = !f.target_ids || f.target_ids.length === 0 || f.target_ids.includes(uid);
          const read = Array.isArray(f.read_by) && f.read_by.includes(uid);
          return targeted && !read;
        });
        setFlashQueue(unread);
      });
  }, [user]);

  const dismissFlash = async () => {
    const uid = (user as any)?.id_auth || user?.id;
    const f = flashQueue[0];
    if (f && uid) {
      const newRead = Array.isArray(f.read_by) ? [...f.read_by, uid] : [uid];
      await supabase.from('flash_infos').update({ read_by: newRead }).eq('id', f.id);
    }
    setFlashQueue(prev => prev.slice(1));
  };

  const createFlash = async () => {
    if (!flashMsg.trim()) { toast.error('Message vide'); return; }
    setFlashSending(true);
    const { error } = await supabase.from('flash_infos').insert({
      hotel_id: hotelId || null, message: flashMsg.trim(), active: true,
      target_ids: flashTargets.length ? flashTargets : null, read_by: [],
      push: false, // pop-up web silencieux : pas de notif mobile
    });
    setFlashSending(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Nouveauté publiée');
    setShowFlashCreate(false); setFlashMsg(''); setFlashTargets([]);
  };

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
    if (error) { toast.error('Suppression impossible : ' + error.message); return; }
    setDemandes((prev) => prev.filter((d) => d.id !== id));
  };

  const deleteChauffeur = async (id: string) => {
    if (!(await confirmDialog("Supprimer ce chauffeur ?"))) return;
    const { error } = await supabase.from("chauffeurs").delete().eq("id", id);
    if (error) { toast.error("Erreur suppression : " + error.message); return; }
    setChauffeurs((prev) => prev.filter((c) => c.id !== id));
  };

  const createChauffeur = async () => {
    if (!newChauffeur.trim()) return;
    const { data, error } = await supabase.from("chauffeurs").insert([{ nom: newChauffeur.trim(), hotel_id: hotelId }]).select().single();
    if (error) { toast.error("Erreur : " + error.message); return; }
    setChauffeurs(prev => [...prev, data]);
    setNewChauffeur('');
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

  const sendReply = async () => {
    if (!chatConsigne || chatInput.trim() === '') return;
    const reply = {
      id: uuidv4(),
      auteur: user?.name || 'Anonyme',
      auteur_id: user?.id || null,
      texte: chatInput.trim(),
      created_at: new Date().toISOString(),
    };
    const newReplies = [...(chatConsigne.replies || []), reply];
    const { error } = await supabase.from('consignes').update({ replies: newReplies }).eq('id', chatConsigne.id);
    if (error) { toast.error('Erreur envoi : ' + error.message); return; }
    setConsignes(prev => prev.map(c => c.id === chatConsigne.id ? { ...c, replies: newReplies } : c));
    setChatConsigne((prev: any) => prev ? { ...prev, replies: newReplies } : null);
    setChatInput('');
    requestAnimationFrame(() => {
      if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    });
  };

  const startEditReply = (r: any) => {
    setEditingReplyId(r.id);
    setEditingReplyText(r.texte);
  };

  const cancelEditReply = () => {
    setEditingReplyId(null);
    setEditingReplyText('');
  };

  const saveEditReply = async () => {
    if (!chatConsigne || !editingReplyId) return;
    const trimmed = editingReplyText.trim();
    if (trimmed === '') return;
    const current = Array.isArray(chatConsigne.replies) ? chatConsigne.replies : [];
    const newReplies = current.map((r: any) =>
      r.id === editingReplyId ? { ...r, texte: trimmed, edited_at: new Date().toISOString() } : r
    );
    const { error } = await supabase.from('consignes').update({ replies: newReplies }).eq('id', chatConsigne.id);
    if (error) { toast.error('Erreur édition : ' + error.message); return; }
    setConsignes(prev => prev.map(c => c.id === chatConsigne.id ? { ...c, replies: newReplies } : c));
    setChatConsigne((prev: any) => prev ? { ...prev, replies: newReplies } : null);
    setEditingReplyId(null);
    setEditingReplyText('');
  };

  const deleteReply = async (replyId: string) => {
    if (!chatConsigne) return;
    if (!(await confirmDialog('Supprimer ce message ?'))) return;
    const current = Array.isArray(chatConsigne.replies) ? chatConsigne.replies : [];
    const newReplies = current.filter((r: any) => r.id !== replyId);
    const { error } = await supabase.from('consignes').update({ replies: newReplies }).eq('id', chatConsigne.id);
    if (error) { toast.error('Erreur suppression : ' + error.message); return; }
    setConsignes(prev => prev.map(c => c.id === chatConsigne.id ? { ...c, replies: newReplies } : c));
    setChatConsigne((prev: any) => prev ? { ...prev, replies: newReplies } : null);
    if (editingReplyId === replyId) cancelEditReply();
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
    const q = searchQuery.trim().toLowerCase();
    const visibles = tickets.filter((t) => {
      if (q) {
        const hay = `${t.titre || ''} ${t.auteur || ''} ${t.service || ''}`.toLowerCase();
        return hay.includes(q);
      }
      const actionDate = t.date_action ? new Date(t.date_action) : null;
      const endDate = t.date_fin ? new Date(t.date_fin) : actionDate;
      const validationDate = t.date_validation ? new Date(t.date_validation) : null;
      const current = new Date(formatDate(selectedDate, 'yyyy-MM-dd'));
      if (!actionDate || isNaN(actionDate.getTime())) return false;
      if (!endDate || current < actionDate || current > endDate) return false;
      if (t.valide) {
        if (!showValidatedTickets) return false;
        return !!validationDate && current <= validationDate;
      }
      return true;
    }).filter((t) => q ? true : filterService === 'Tous' || t.service === filterService);

    return visibles.sort((a, b) => {
      if (a.valide !== b.valide) return a.valide ? 1 : -1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [tickets, filterService, selectedDate, showValidatedTickets, searchQuery]);

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
    const q = searchQuery.trim().toLowerCase();
    let visibles = consignes.filter((c) => {
      if (q) {
        const hay = `${c.texte || ''} ${c.auteur || ''}`.toLowerCase();
        return hay.includes(q);
      }
      const creationDate = c.date_creation ? new Date(c.date_creation) : null;
      const endDate = c.date_fin ? new Date(c.date_fin) : creationDate;
      const validationDate = c.date_validation ? new Date(c.date_validation) : null;
      const current = new Date(formatDate(selectedDate, 'yyyy-MM-dd'));
      if (!creationDate || isNaN(creationDate.getTime())) return false;
      if (!endDate || current < creationDate || current > endDate) return false;
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
  }, [consignes, selectedDate, showValidatedConsignes, searchQuery]);

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

const birthdayMessage = useMemo(() => {
  if (!user || !selectedDate) return null;
  
  const selectedMD = format(selectedDate, 'MM-dd');
  const currentYear = selectedDate.getFullYear();
  
  // On filtre les utilisateurs qui fêtent leur anniversaire ce jour-là
  const celebratingUsers = users.filter(u => u.birth_date && u.birth_date.slice(5) === selectedMD);

  if (celebratingUsers.length === 0) return null;

  // CORRECTION : On compare u.id_auth avec user.id (issu de useAuth)
  const isItMe = celebratingUsers.find(u => u.id_auth === (user?.id));

  if (isItMe) {
    const age = currentYear - parseInt(isItMe.birth_date.split('-')[0]);
    return {
      type: 'me',
      text: `🎂 Joyeux anniversaire ! Tu fêtes tes ${age} ans aujourd'hui !`
    };
  }

  // Cas pour les autres collègues
  const others = celebratingUsers.map(u => {
    const birthYear = parseInt(u.birth_date.split('-')[0]);
    const age = currentYear - birthYear;
    return `${u.name} (${age} ans)`;
  });

  return {
    type: 'others',
    text: `🎉 Aujourd'hui, anniversaire de ${others.join(' & ')}`
  };
}, [users, selectedDate, user]);

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
    
    <div className="min-h-screen relative text-slate-900 p-4 md:p-6 font-sans overflow-hidden">
      
      {/* --- EFFET AQUARELLE (ARRIÈRE-PLAN) --- */}
      {/* Couleurs pilotées par le thème user (cf. applyTheme dans AuthContext). */}
      <div className="fixed inset-0 -z-10 h-full w-full" style={{ background: 'var(--bg-base, #f8fafc)' }}>
        <div
          className="absolute top-[-10%] left-[-10%] h-[500px] w-[500px] rounded-full blur-[120px]"
          style={{ background: 'var(--bg-blob-1, rgba(199, 210, 254, 0.40))' }}
        />
        <div
          className="absolute bottom-[-10%] right-[-10%] h-[600px] w-[600px] rounded-full blur-[120px]"
          style={{ background: 'var(--bg-blob-2, rgba(186, 230, 253, 0.40))' }}
        />
        <div
          className="absolute top-[40%] left-[40%] h-[400px] w-[400px] rounded-full blur-[100px]"
          style={{ background: 'var(--bg-blob-3, rgba(243, 232, 255, 0.50))' }}
        />
      </div>
      {/* -------------------------------------- */}
      
      {/* BANDEAU ANNIVERSAIRE — pleine largeur au-dessus du header */}
      {birthdayMessage && (
        <div className={`mb-6 px-5 py-3 rounded-2xl text-sm font-bold flex items-center gap-3 shadow-lg transition-all border-l-4 ${
          birthdayMessage.type === 'me'
          ? "bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 text-white border-white animate-pulse"
          : "bg-white text-slate-700 border-amber-400 shadow-amber-100/50"
        }`}>
          <span className="text-xl">
            {birthdayMessage.type === 'me' ? '👑' : '🎈'}
          </span>
          {birthdayMessage.text}
        </div>
      )}

      {/* --- HEADER : 3 zones (gauche / centre date / droite actions) --- */}
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center w-full mb-8 gap-4">

        {/* Zone gauche : Bonjour */}
        <div className="flex flex-col gap-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 truncate">
            Bonjour, {(user as any).emoji ? `${(user as any).emoji} ` : ''}{user.name}
          </h1>
          <div className="flex items-center gap-2.5 text-sm text-slate-500">
            <span>Voici ce qui se passe aujourd'hui à l'hôtel.</span>
          </div>
        </div>

        {/* Zone centre : Date — largeur fixe, label centré, ne saute pas selon le jour */}
        <div className="justify-self-center">
          <div className="flex items-center bg-white rounded-full shadow-sm border border-slate-200 px-1 py-1">
            <Button variant="ghost" size="icon" onClick={() => changeDay(-1)} className="h-8 w-8 rounded-full hover:bg-slate-100">
              <ChevronLeft className="w-4 h-4 text-slate-600" />
            </Button>
            <button
              onClick={() => setShowCalendar(true)}
              className="h-8 w-[220px] text-center text-sm font-semibold text-slate-700 hover:text-[var(--brand)] transition-colors first-letter:uppercase"
            >
              {format(selectedDate, 'eeee d MMMM yyyy', { locale: fr })}
            </button>
            <Button variant="ghost" size="icon" onClick={() => changeDay(1)} className="h-8 w-8 rounded-full hover:bg-slate-100">
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </Button>
          </div>
        </div>

        {/* Zone droite : Météo du jour (remontée ici, à la place de l'ancien menu) */}
        {hasMeteo && mainMeteo && (
          <div className="justify-self-end w-full md:w-auto">
            <div className={`flex items-center gap-3 rounded-2xl px-3.5 py-2 shadow-sm border border-white/60 ${bgColorForWeather(mainMeteo.weathercode)}`}>
              <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm shrink-0">
                {weatherIconSVG(mainMeteo.weathercode)}
              </div>
              <div className="leading-tight">
                <div className="text-2xl font-extrabold text-slate-800">{mainMeteo.temperature}°</div>
                <div className="text-[10px] text-slate-500 -mt-0.5">{weatherLabel(mainMeteo.weathercode)}</div>
              </div>
              <div className="flex items-stretch gap-3 border-l border-white/70 pl-3">
                {meteoMorning && (
                  <div className="text-center">
                    <div className="text-[9px] uppercase font-bold text-slate-400">Matin</div>
                    <div className="text-sm font-bold text-slate-700">{meteoMorning.temperature}°</div>
                    <div className="flex items-center justify-center gap-0.5 text-[9px] text-slate-500">
                      <svg width="10" height="10" viewBox="0 0 24 24" style={{ transform: `rotate(${meteoMorning.winddirection + 180}deg)` }}><path d="M12 2 L15 8 H9 L12 2 Z M11 8 V20 H13 V8 H11 Z" fill="currentColor" /></svg>
                      {Math.round(meteoMorning.windspeed)}
                    </div>
                  </div>
                )}
                {meteoAfternoon && (
                  <div className="text-center">
                    <div className="text-[9px] uppercase font-bold text-slate-400">Aprem</div>
                    <div className="text-sm font-bold text-slate-700">{meteoAfternoon.temperature}°</div>
                    <div className="flex items-center justify-center gap-0.5 text-[9px] text-slate-500">
                      <svg width="10" height="10" viewBox="0 0 24 24" style={{ transform: `rotate(${meteoAfternoon.winddirection + 180}deg)` }}><path d="M12 2 L15 8 H9 L12 2 Z M11 8 V20 H13 V8 H11 Z" fill="currentColor" /></svg>
                      {Math.round(meteoAfternoon.windspeed)}
                    </div>
                  </div>
                )}
              </div>
              {(seaTemp || sunTimes) && (
                <div className="hidden sm:flex flex-col gap-0.5 border-l border-white/70 pl-3 text-[10px] text-slate-600 font-medium whitespace-nowrap">
                  {seaTemp != null && <span>🌊 {seaTemp.toFixed(1)}°</span>}
                  {sunTimes && <span>☀️ {sunTimes.sunrise}–{sunTimes.sunset}</span>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* --- BARRE DE RECHERCHE GLOBALE --- */}
      <div className="relative mb-6 w-full max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Rechercher…"
          className="w-full pl-9 pr-9 py-2 rounded-xl border border-slate-200 bg-white shadow-sm text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--brand)] transition"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
          >
            <XCircle className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* --- GRID MAIN --- */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_2fr_1.2fr] gap-6">
        
        {/* COL 1 : CONSIGNES */}
        <div className="flex flex-col gap-4">
            <SectionHeader
                icon={Pin}
                title="Consignes"
                count={consignesVisibles.length}
                action={(
                  <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowValidatedConsignes(!showValidatedConsignes)}
                        className={`text-xs px-2 py-1 rounded-md transition-colors ${showValidatedConsignes ? 'bg-[var(--brand-bg)] text-[var(--brand)] font-medium' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                        {showValidatedConsignes ? 'Masquer validées' : 'Voir validées'}
                    </button>
                    <AddButton
                        label="Nouvelle consigne"
                        onClick={() => {
                            setNewConsigne({ texte: '', service: 'Tous les services', date: '', valide: false, utilisateurs_ids: [], date_fin: '', });
                            setEditConsigneIndex(null);
                            setShowConsigneModal(true);
                        }}
                    />
                  </div>
                )}
            />

            <div className="flex flex-col gap-3">
                {consignesVisibles.map((c, idx) => {
                    const replyCount = Array.isArray(c.replies) ? c.replies.length : 0;
                    return (
                    <div
                        key={idx}
                        onClick={() => { setChatConsigne(c); setChatInput(''); }}
                        className={`group relative p-5 rounded-2xl border transition-all duration-300 cursor-pointer ${c.valide ? 'bg-slate-50 border-slate-100 opacity-60' : 'bg-white border-slate-100 shadow-sm hover:shadow-md hover:border-[var(--brand)]'}`}
                    >
                        <div className="flex justify-between items-start mb-2">
                             <div className="flex items-center gap-2">
                                 {/* Avatar/Badge Auteur */}
                                <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500 uppercase">
                                    {c.auteur ? c.auteur.substring(0,2) : 'AN'}
                                </div>
                                <span className="text-xs text-slate-400">{formatSafeDate(c.created_at)}</span>
                             </div>

                             {/* Actions au survol */}
                             <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200" onClick={(e) => e.stopPropagation()}>
                                <button onClick={() => modifierConsigne(idx)} className="p-1.5 hover:bg-slate-100 rounded text-slate-400 hover:text-[var(--brand)] transition"><Edit2 className="w-3.5 h-3.5" /></button>
                                {!c.valide && (
                                    <button onClick={() => validerConsigne(idx)} className="p-1.5 hover:bg-green-50 rounded text-slate-400 hover:text-green-600 transition" title="Valider"><CheckCircle className="w-3.5 h-3.5" /></button>
                                )}
                             </div>
                        </div>

                        <div className={`text-sm text-slate-700 whitespace-pre-wrap break-words leading-relaxed ${c.valide ? 'line-through text-slate-400' : ''}`}>
                            {c.texte}
                        </div>

                        {/* Pied de carte : conversation */}
                        <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                            <span className="text-slate-400 italic">— {(() => { const u = users.find((x: any) => x.name === c.auteur); return (u as any)?.emoji ? `${(u as any).emoji} ` : ''; })()}{c.auteur || 'Anonyme'}</span>
                            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full transition ${replyCount > 0 ? 'bg-[var(--brand-bg)] text-[var(--brand)] font-medium' : 'text-slate-400 group-hover:bg-slate-100'}`}>
                                <MessageCircle className="w-3 h-3" />
                                {replyCount > 0 ? `${replyCount} réponse${replyCount > 1 ? 's' : ''}` : 'Répondre'}
                            </span>
                        </div>
                    </div>
                    );
                })}
                {consignesVisibles.length === 0 && <div className="text-center py-10 text-slate-400 text-sm bg-white rounded-2xl border border-dashed border-slate-200">Rien à signaler 🎉</div>}
            </div>
        </div>

        {/* COL 2 : TICKETS (TO DO) */}
        <div className="flex flex-col gap-4">
            <SectionHeader
                icon={ListChecks}
                title="To Do"
                count={ticketsVisibles.length}
                action={(
                  <div className="flex items-center gap-2">
                    {/* Filtre service */}
                    <FilterMenu
                        value={filterService}
                        options={['Tous', 'Réception', 'Housekeeping', 'F&B', 'Maintenance']}
                        onChange={setFilterService}
                    />
                     <button
                        onClick={() => setShowValidatedTickets(!showValidatedTickets)}
                        className={`text-xs px-2 py-1 rounded-md transition-colors ${showValidatedTickets ? 'bg-[var(--brand-bg)] text-[var(--brand)] font-medium' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                        {showValidatedTickets ? 'Masquer' : 'Voir'} faits
                    </button>
                    <AddButton
                        label="Nouvelle tâche"
                        onClick={() => {
                            setNewTicket({ titre: '', service: 'Réception', dateAction: formatDate(selectedDate, 'yyyy-MM-dd'), priorite: 'Moyenne', date_fin: '' });
                            setEditTicketIndex(null);
                            setShowTicketModal(true);
                        }}
                    />
                  </div>
                )}
            />

            <div className="flex flex-col gap-3">
                {ticketsVisibles.map((t, idx) => (
                    <div key={idx} className={`group relative p-4 rounded-2xl border transition-all duration-300 ${t.valide ? 'bg-slate-50 border-slate-100 opacity-50' : 'bg-white border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-0.5'}`}>
                        
                        <div className="flex justify-between items-start mb-2">
                             <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">{etiquette(t.service)}</span>
                             <Pill tone={t.priorite === 'Haute' ? 'danger' : t.priorite === 'Moyenne' ? 'warn' : 'good'}>
                                {t.priorite}
                             </Pill>
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
                                className="p-1.5 text-slate-400 hover:text-[var(--brand)] hover:bg-[var(--brand-bg)] rounded-md transition-colors"
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

        {/* COL 3 : SIDEBAR (KPIs, Taxis, Chambres libérées) — météo remontée dans le header */}
        <div className="flex flex-col gap-4">

            {/* En-tête fantôme : aligne la 1ʳᵉ carte avec celles de Consignes/Tickets
                (même composant SectionHeader, rendu invisible → hauteur identique). */}
            <div className="hidden lg:block" aria-hidden>
              <SectionHeader icon={Pin} title="." count="." className="invisible" />
            </div>

            {/* CHAMBRES LIBÉRÉES — compact : champ seul, liste du jour au survol.
                Masqué pour Les Voiles : alimenté automatiquement par Mews. */}
            {LIBERATIONS_ENABLED && currentHotel?.nom?.trim() !== 'Les Voiles' && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
                 <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2"><DoorOpen className="w-4 h-4 text-slate-400" />Chambres libérées</h3>
                    {dayRooms.length > 0 && (
                      <div className="relative group">
                        <Pill tone="neutral" className="cursor-default">{dayRooms.length} auj.</Pill>
                        <div className="absolute right-0 top-full z-20 hidden w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg group-hover:block">
                          <div className="flex flex-wrap gap-1.5">
                            {dayRooms.map((num) => (
                              <button
                                key={num}
                                onClick={() => removeRoom(num)}
                                title="Retirer cette chambre"
                                className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-sm font-bold text-slate-700 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                              >
                                {num}
                              </button>
                            ))}
                          </div>
                          {liberations[0] && (
                            <p className="mt-2.5 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
                              Dernière à {new Date(liberations[0].created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                              {liberations[0].auteur ? ` — ${liberations[0].auteur}` : ''} · clique une chambre pour la retirer
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                 </div>
                 <form onSubmit={sendLiberation} className="flex gap-2">
                    <input
                      value={liberationInput}
                      onChange={(e) => setLiberationInput(e.target.value)}
                      placeholder="Ex. 12  ou  12 14 22"
                      className="min-w-0 flex-1 h-9 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
                    />
                    <button
                      type="submit"
                      disabled={!liberationInput.trim()}
                      style={{ background: 'var(--brand)' }}
                      className="h-9 rounded-lg px-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                    >
                      Envoyer
                    </button>
                 </form>
            </div>
            )}

            {/* TAXIS / REVEILS */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
                 <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2"><Car className="w-4 h-4 text-slate-400" />Taxis &amp; Réveils</h3>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setShowChauffeurModal(true)} className="w-6 h-6 bg-slate-100 hover:bg-slate-200 rounded-full flex items-center justify-center text-slate-600 transition" title="Gérer les chauffeurs VTC">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                      </button>
                      <button onClick={() => {
                          setNewTaxi({ type: 'Taxi', chambre: '', heure: '', statut: 'Prévu', dateAction: formatDate(selectedDate, 'yyyy-MM-dd'), prix:'', chauffeur:'' });
                          setEditDemandeIndex(null);
                          setShowTaxiModal(true);
                      }} className="w-6 h-6 bg-slate-100 hover:bg-slate-200 rounded-full flex items-center justify-center text-slate-600 transition">
                          <PlusCircle className="w-4 h-4" />
                      </button>
                    </div>
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
                                }} className="text-slate-300 hover:text-[var(--brand)]"><Edit2 className="w-3 h-3"/></button>
                                <button onClick={async () => { if (await confirmDialog('Supprimer ?')) deleteDemande(d.id); }} className="text-slate-300 hover:text-red-500"><XCircle className="w-3 h-3"/></button>
                             </div>
                        </div>
                    ))}
                    {demandesVisibles.length === 0 && <div className="text-xs text-slate-400 text-center py-2">Aucun taxi / réveil</div>}
                 </div>

                 {/* Récap VTC mensuel */}
                 {Object.keys(totalVTCMoisParChauffeur).length > 0 && (
                   <div className="mt-4 pt-3 border-t border-slate-100">
                     <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">VTC ce mois</p>
                     <div className="space-y-1">
                       {Object.entries(totalVTCMoisParChauffeur).map(([nom, total]) => (
                         <div key={nom} className="flex justify-between items-center text-xs">
                           <span className="text-slate-600">{nom}</span>
                           <span className="font-bold text-slate-800">{(total as number).toLocaleString('fr-FR')} €</span>
                         </div>
                       ))}
                     </div>
                   </div>
                 )}
            </div>

            {/* KPIS - VERSION CLEAN & MODERNE */}
             <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-slate-400" />Performance
                    </h3>
                    {isAdmin && (
                        <Pill tone="brand" className="animate-pulse">Mode Édition</Pill>
                    )}
                </div>

                <div className="flex flex-col gap-6">
                    {[
                      // `bar` : barre de progression vers l'objectif — pertinent pour le CA
                      // et le taux d'occupation (cumulatifs), pas pour la note/le prix moyen.
                      { key: "ca", label: "Chiffre d'affaires", suffix: "€", icon: Wallet, bar: true },
                      { key: "taux_occupation", label: "Taux d'occupation", suffix: "%", icon: BedDouble, bar: true },
                      { key: "prix_moyen", label: "Prix Moyen", suffix: "€", icon: Tag, bar: false },
                      { key: "guest_review", label: "Note Guest", suffix: "/10", icon: Star, bar: false },
                    ].map((def, i) => {
                      // Les Voiles : CA / taux d'occupation / prix moyen remplis en
                      // direct depuis le cache Mews du mois sélectionné (lecture seule).
                      // La Corniche et la Note Guest restent en saisie manuelle.
                      const isVoiles = currentHotel?.nom?.trim() === 'Les Voiles';
                      const selMonth = formatDate(selectedDate, 'yyyy-MM');
                      const liveRow = isVoiles ? occupancy?.find((o: any) => o.month === selMonth) : undefined;
                      const liveVal =
                        def.key === 'taux_occupation' ? liveRow?.occupancy :
                        def.key === 'ca' ? liveRow?.heberg_ttc :
                        def.key === 'prix_moyen' ? liveRow?.prix_moyen :
                        undefined;
                      const isLiveTO = liveVal != null;   // « live » = valeur Mews (non éditable)
                      const value = isLiveTO ? liveVal : kpis?.[def.key];
                      const target = kpis?.[`${def.key}_objectif`];
                      const progress = value && target ? Math.min(100, (value / target) * 100) : 0;
                      
                      // Couleurs barre
                      let barColor = "bg-[var(--brand)]";
                      if (progress >= 100) barColor = "bg-emerald-500";
                      else if (progress < 50) barColor = "bg-orange-400";

                      return (
                        <div key={i} className="flex items-center gap-4">
                            {/* Icône carrée */}
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm bg-slate-100 text-slate-500">
                                <def.icon className="w-5 h-5" />
                            </div>

                            {/* Contenu */}
                            <div className="flex-1">
                                <div className="flex justify-between items-end mb-1">
                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">{def.label}</span>
                                    {def.bar && <span className={`text-xs font-bold ${progress >= 100 ? 'text-emerald-600' : 'text-slate-400'}`}>{progress.toFixed(0)}%</span>}
                                </div>

                                <div className="flex items-baseline gap-1.5">
                                    {/* VALEUR ACTUELLE (Editable si Admin) */}
<div className="relative group">
    {isAdmin && !isLiveTO ? (
        <input
            type="number"
            className="w-24 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-[var(--brand)] text-xl font-bold text-slate-800 outline-none transition-all p-0 m-0"
            value={value ?? ""}
            placeholder="0"
            onChange={(e) => setKpis((prev:any) => ({ ...prev, [def.key]: Number(e.target.value) }))}
        />
    ) : (
        // MODIFICATION ICI : on passe def.suffix en 2ème argument
        <span className="text-xl font-bold text-slate-800">{formatNumber(value, def.suffix)}</span>
    )}
    <span className="text-sm text-slate-500 font-medium ml-0.5">
  {/* On n'affiche pas le suffixe si c'est la note guest, pour éviter le "8.9/10/9" */}
  {def.key === 'guest_review' ? '' : def.suffix}
</span>
</div>

{/* SEPARATEUR & OBJECTIF */}
<span className="text-slate-300 text-lg font-light">/</span>

<div className="relative group">
     {isAdmin ? (
        <input 
            type="number" 
            className="w-16 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-[var(--brand)] text-sm font-medium text-slate-400 outline-none transition-all p-0 m-0" 
            value={target ?? ""} 
            placeholder="Obj"
            onChange={(e) => setKpis((prev:any) => ({ ...prev, [`${def.key}_objectif`]: Number(e.target.value) }))} 
        />
    ) : (
        // MODIFICATION ICI AUSSI (optionnel mais recommandé pour la cohérence)
        <span className="text-sm font-medium text-slate-400">{formatNumber(target, def.suffix)}</span>
    )}
</div>
                                </div>

                                {/* Barre de progression — uniquement pour les KPI cumulatifs (CA, TO) */}
                                {def.bar && (
                                <div className="mt-2 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all duration-1000 ease-out ${barColor}`}
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                                )}
                            </div>
                        </div>
                      );
                    })}
                </div>

                {isAdmin && (
                    <div className="flex justify-end mt-6">
                         <Button size="sm" className="bg-[var(--brand)] hover:brightness-110 text-white shadow-md transition-all hover:-translate-y-0.5" onClick={async () => {
                             const payload = { hotel_id: hotelId, mois: selectedDate.getMonth() + 1, annee: selectedDate.getFullYear(), ...kpis };
                             await supabase.from("kpis").upsert(payload, { onConflict: "hotel_id,mois,annee" });
                             toast.success("Données mises à jour");
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
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Luggage className="w-5 h-5 text-slate-400" />Objets trouvés</h2>
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                    <div className="relative flex-1">
                        <Search className="absolute left-2 top-2.5 w-4 h-4 text-slate-400" />
                        <input 
                            className="pl-8 pr-4 py-2 text-sm border border-slate-200 rounded-full w-full focus:ring-2 focus:ring-[var(--brand)] focus:outline-none"
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
                        <span className={`inline-block h-3 w-3 rounded-full transition ${showAllObjets ? "bg-[var(--brand)]" : "bg-slate-400"}`} />
                        <span className="whitespace-nowrap select-none font-medium text-slate-600">{showAllObjets ? 'Tout masquer' : 'Tout afficher'}</span>
                    </button>

                    <div className="flex items-center gap-2">
                        <a href="https://resort.mylhost.com/login" target="_blank" className="text-xs font-bold text-orange-600 bg-orange-50 px-3 py-2 rounded-full hover:bg-orange-100 transition flex items-center gap-1">
                             LHOST <ExternalLink className="w-3 h-3"/>
                        </a>
                        <Button
    size="sm"
    onClick={() => setShowObjetModal(true)}
    style={{ background: 'var(--brand)' }}
    className="text-white rounded-full shadow-sm hover:brightness-110"
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
                                         <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${o[field] ? 'bg-[var(--brand)] border-[var(--brand)]' : 'border-slate-300 bg-white'}`}>
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
    className="text-slate-400 hover:text-[var(--brand)]"
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

         {isSuperadmin && (
            <div className="flex justify-end">
               <button onClick={() => setShowFlashCreate(true)} className="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-[var(--brand)] bg-white border border-slate-200 px-4 py-2 rounded-xl hover:shadow-sm transition">
                  📣 Communiquer une nouveauté
               </button>
            </div>
         )}

         {/* Footer Apps — discret (installation ponctuelle, pas un besoin quotidien) */}
         <div className="text-center py-6 mt-4 border-t border-slate-100">
             <h3 className="text-slate-400 text-[11px] mb-3 font-medium uppercase tracking-widest">Application mobile</h3>
             <div className="flex flex-wrap justify-center gap-3">
                 <a href={PLAY_URL} target="_blank" className="group flex items-center gap-2.5 bg-white px-3 py-2 rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition">
                     <QRCodeSVG value={PLAY_URL} size={40} />
                     <div className="text-left">
                         <div className="text-[10px] text-slate-400">Disponible sur</div>
                         <div className="text-sm font-semibold text-slate-600">Google Play</div>
                     </div>
                 </a>
                 <a href={APPLE_URL} target="_blank" className="group flex items-center gap-2.5 bg-white px-3 py-2 rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition">
                     <QRCodeSVG value={APPLE_URL} size={40} />
                     <div className="text-left">
                         <div className="text-[10px] text-slate-400">Disponible sur</div>
                         <div className="text-sm font-semibold text-slate-600">App Store</div>
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
                <SelectField
                    value={newTaxi.type}
                    options={['Taxi', 'Réveil', 'VTC']}
                    onChange={(v) => setNewTaxi({ ...newTaxi, type: v })}
                />
                <input type="date" className="border rounded-lg px-3 py-2" value={newTaxi.dateAction} onChange={(e) => setNewTaxi({ ...newTaxi, dateAction: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
                 <Input type="time" value={newTaxi.heure} onChange={(e) => setNewTaxi({ ...newTaxi, heure: e.target.value })} />
                 <Input placeholder="Chambre #" value={newTaxi.chambre} onChange={(e) => setNewTaxi({ ...newTaxi, chambre: e.target.value })} />
            </div>
            {newTaxi.type === "VTC" && (
                <div className="space-y-2 bg-slate-50 p-3 rounded-lg">
                     <Input type="number" placeholder="Prix (€)" value={newTaxi.prix} onChange={(e) => setNewTaxi({ ...newTaxi, prix: e.target.value })} />
                     <SelectField
                        value={newTaxi.chauffeur || ""}
                        placeholder="Choisir chauffeur"
                        options={chauffeurs.map((c) => ({ value: String(c.id), label: c.nom }))}
                        onChange={(v) => setNewTaxi({ ...newTaxi, chauffeur: v })}
                     />
                </div>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={() => setShowTaxiModal(false)}>Annuler</Button>
              <Button onClick={createDemande} className="bg-[var(--brand)] text-white hover:brightness-110">{editDemandeIndex !== null ? 'Modifier' : 'Créer'}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Chauffeurs VTC */}
      {showChauffeurModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-sm space-y-4 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-800">Chauffeurs VTC</h2>
              <button onClick={() => setShowChauffeurModal(false)} className="text-slate-400 hover:text-slate-700"><XCircle className="w-5 h-5" /></button>
            </div>

            {/* Liste existante */}
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {chauffeurs.length === 0 && <p className="text-xs text-slate-400 text-center py-3">Aucun chauffeur enregistré</p>}
              {chauffeurs.map(c => (
                <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-sm font-medium text-slate-700">{c.nom}</span>
                  <button onClick={() => deleteChauffeur(c.id)} className="text-slate-300 hover:text-red-500 transition-colors"><XCircle className="w-4 h-4" /></button>
                </div>
              ))}
            </div>

            {/* Ajout */}
            <div className="flex gap-2 pt-1 border-t border-slate-100">
              <Input
                placeholder="Nom du chauffeur"
                value={newChauffeur}
                onChange={e => setNewChauffeur(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createChauffeur()}
                className="text-sm"
              />
              <Button onClick={createChauffeur} disabled={!newChauffeur.trim()} className="bg-[var(--brand)] text-white hover:brightness-110 shrink-0">
                Ajouter
              </Button>
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
                    <SelectField
                        className="mt-1"
                        value={newTicket.service}
                        options={['Réception', 'Housekeeping', 'F&B', 'Maintenance']}
                        onChange={(v) => setNewTicket({ ...newTicket, service: v })}
                    />
                 </div>
                 <div>
                    <label className="text-xs text-slate-500 font-bold uppercase">Priorité</label>
                    <SelectField
                        className="mt-1"
                        value={newTicket.priorite}
                        options={['Basse', 'Moyenne', 'Haute']}
                        onChange={(v) => setNewTicket({ ...newTicket, priorite: v })}
                    />
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
              <Button onClick={createTicket} className="bg-[var(--brand)] text-white hover:brightness-110">{editTicketIndex !== null ? 'Modifier' : 'Créer'}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Chat Consigne (style SMS) */}
      {chatConsigne && (() => {
        const replies = Array.isArray(chatConsigne.replies) ? chatConsigne.replies : [];
        const formatChatTime = (iso: string) => {
          if (!iso || isNaN(Date.parse(iso))) return '';
          const d = new Date(iso);
          const today = new Date();
          const sameDay = d.toDateString() === today.toDateString();
          return sameDay
            ? formatDate(d, 'HH:mm', { locale: frLocale })
            : formatDate(d, 'dd MMM HH:mm', { locale: frLocale });
        };
        const initials = (n?: string) => (n ? n.substring(0, 2).toUpperCase() : 'AN');
        const meId = user?.id;
        return (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col h-[85vh] animate-in fade-in zoom-in duration-200 overflow-hidden">
              {/* Header */}
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-white">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[var(--brand-bg)] flex items-center justify-center text-xs font-bold text-[var(--brand)]">
                    {initials(chatConsigne.auteur)}
                  </div>
                  <div className="leading-tight">
                    <div className="text-sm font-semibold text-slate-800">{chatConsigne.auteur || 'Anonyme'}</div>
                    <div className="text-[11px] text-slate-400">Consigne du {formatSafeDate(chatConsigne.created_at)}</div>
                  </div>
                </div>
                <button
                  onClick={() => { setChatConsigne(null); setChatInput(''); }}
                  className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-700 transition"
                  aria-label="Fermer"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              {/* Fil de discussion */}
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-4 bg-slate-50 space-y-3">
                {/* Bulle d'origine (toujours à gauche) */}
                <div className="flex items-end gap-2">
                  <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600 shrink-0">
                    {initials(chatConsigne.auteur)}
                  </div>
                  <div className="max-w-[75%]">
                    <div className="text-[10px] text-slate-400 mb-0.5 ml-1">{chatConsigne.auteur || 'Anonyme'}</div>
                    <div className="bg-white border border-slate-200 text-slate-800 px-3 py-2 rounded-2xl rounded-bl-sm text-sm whitespace-pre-wrap break-words shadow-sm">
                      {chatConsigne.texte}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 ml-1">{formatChatTime(chatConsigne.created_at)}</div>
                  </div>
                </div>

                {/* Réponses */}
                {replies.map((r: any) => {
                  const mine = meId && r.auteur_id === meId;
                  const isEditing = editingReplyId === r.id;
                  return (
                    <div key={r.id} className={`group/msg flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${mine ? 'bg-[var(--brand-bg)] text-[var(--brand)]' : 'bg-slate-200 text-slate-600'}`}>
                        {initials(r.auteur)}
                      </div>
                      <div className="max-w-[75%]">
                        <div className={`text-[10px] text-slate-400 mb-0.5 ${mine ? 'text-right mr-1' : 'ml-1'}`}>{r.auteur}</div>

                        {isEditing ? (
                          <div className={`p-2 rounded-2xl shadow-sm ${mine ? 'bg-[var(--brand)] rounded-br-sm' : 'bg-white border border-slate-200 rounded-bl-sm'}`}>
                            <textarea
                              value={editingReplyText}
                              onChange={(e) => setEditingReplyText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEditReply(); }
                                if (e.key === 'Escape') { e.preventDefault(); cancelEditReply(); }
                              }}
                              autoFocus
                              rows={2}
                              className={`w-full resize-none outline-none text-sm rounded-lg px-2 py-1 ${mine ? 'bg-[var(--brand-bg)]0 text-white placeholder-indigo-200' : 'bg-slate-50 text-slate-800'}`}
                            />
                            <div className="flex justify-end gap-2 mt-1">
                              <button
                                onClick={cancelEditReply}
                                className={`text-[11px] px-2 py-0.5 rounded ${mine ? 'text-indigo-100 hover:bg-[var(--brand-bg)]0' : 'text-slate-500 hover:bg-slate-100'}`}
                              >
                                Annuler
                              </button>
                              <button
                                onClick={saveEditReply}
                                disabled={editingReplyText.trim() === ''}
                                className={`text-[11px] px-2 py-0.5 rounded font-medium ${mine ? 'bg-white text-[var(--brand)] hover:bg-[var(--brand-bg)] disabled:opacity-50' : 'bg-[var(--brand)] text-white hover:brightness-110 disabled:opacity-50'}`}
                              >
                                Enregistrer
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className={`relative px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words shadow-sm ${mine ? 'bg-[var(--brand)] text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'}`}>
                            {r.texte}
                            {mine && (
                              <div className={`absolute top-1/2 -translate-y-1/2 ${mine ? '-left-14' : '-right-14'} flex gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity`}>
                                <button
                                  onClick={() => startEditReply(r)}
                                  className="p-1 rounded-full bg-white shadow text-slate-500 hover:text-[var(--brand)] hover:bg-slate-50 transition"
                                  title="Modifier"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => deleteReply(r.id)}
                                  className="p-1 rounded-full bg-white shadow text-slate-500 hover:text-red-600 hover:bg-slate-50 transition"
                                  title="Supprimer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        <div className={`text-[10px] text-slate-400 mt-0.5 ${mine ? 'text-right mr-1' : 'ml-1'}`}>
                          {formatChatTime(r.created_at)}
                          {r.edited_at ? <span className="italic"> · modifié</span> : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Composer */}
              <div className="border-t border-slate-100 p-3 bg-white">
                <div className="flex items-end gap-2">
                  <textarea
                    placeholder="Votre réponse..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendReply();
                      }
                    }}
                    rows={1}
                    className="flex-1 resize-none bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2 text-sm focus:ring-2 focus:ring-[var(--brand)] focus:border-[var(--brand)] outline-none max-h-32"
                  />
                  <button
                    onClick={sendReply}
                    disabled={chatInput.trim() === ''}
                    className="bg-[var(--brand)] hover:brightness-110 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-full w-10 h-10 flex items-center justify-center shadow-md transition shrink-0"
                    aria-label="Envoyer"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                <div className="text-[10px] text-slate-400 mt-1 ml-2">Entrée pour envoyer · Shift+Entrée pour aller à la ligne</div>
              </div>
            </div>
          </div>
        );
      })()}

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
                className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-[var(--brand)] focus:border-[var(--brand)] outline-none resize-none text-sm bg-slate-50"
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
                                    className="rounded text-[var(--brand)] focus:ring-[var(--brand)]" 
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
                                <span key={id} className="bg-[var(--brand-bg)] text-[var(--brand)] px-2 py-0.5 rounded-full text-[10px] font-bold border border-[var(--brand)]">
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
                        className="rounded text-[var(--brand)] focus:ring-[var(--brand)]"
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
              <Button onClick={createConsigne} className="bg-[var(--brand)] text-white hover:brightness-110 shadow-md">
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
                className="bg-[var(--brand)] text-white hover:brightness-110 shadow-md"
              >
                {editObjetIndex !== null ? 'Modifier' : 'Créer'}
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

      {/* Pop-up nouveauté (lue une fois) */}
      {flashQueue.length > 0 && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-7 border border-slate-100 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">📣</span>
              <h2 className="text-lg font-extrabold text-slate-800">Nouveauté</h2>
            </div>
            <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{flashQueue[0].message}</p>
            <div className="flex justify-end mt-6">
              <Button onClick={dismissFlash} className="btn-brand text-white">Compris 👍</Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal création nouveauté (superadmin) */}
      {showFlashCreate && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-7 border border-slate-100">
            <h2 className="text-lg font-extrabold text-slate-800 mb-4">📣 Communiquer une nouveauté</h2>
            <textarea value={flashMsg} onChange={(e) => setFlashMsg(e.target.value)} rows={4} placeholder="Ton message aux équipes…" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[var(--brand)] resize-none" />
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Destinataires</span>
                <button onClick={() => setFlashTargets(flashTargets.length === activeUsers.length ? [] : activeUsers.map((u: any) => u.id_auth))} className="text-xs font-semibold text-[var(--brand)]">{flashTargets.length === activeUsers.length ? 'Aucun' : 'Tous'}</button>
              </div>
              <div className="max-h-48 overflow-y-auto grid grid-cols-2 gap-1 bg-slate-50 rounded-xl p-2 border border-slate-100">
                {activeUsers.map((u: any) => {
                  const sel = flashTargets.includes(u.id_auth);
                  return (
                    <button key={u.id_auth} onClick={() => setFlashTargets(sel ? flashTargets.filter(x => x !== u.id_auth) : [...flashTargets, u.id_auth])} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-left transition ${sel ? 'bg-[var(--brand-bg)] text-[var(--brand)] font-semibold' : 'hover:bg-white text-slate-600'}`}>
                      <span className={`w-3.5 h-3.5 rounded shrink-0 ${sel ? 'bg-[var(--brand)]' : 'border border-slate-300'}`} />
                      <span className="truncate">{u.name || u.email}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">Aucun sélectionné = tout le monde.</p>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setShowFlashCreate(false)}>Annuler</Button>
              <Button onClick={createFlash} disabled={flashSending} className="btn-brand text-white">{flashSending ? 'Envoi…' : 'Publier'}</Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}