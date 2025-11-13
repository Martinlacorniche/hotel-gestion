
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
import { ChevronLeft, ChevronRight, PlusCircle, Filter, CalendarDays, Car, NotebookText, ShoppingCart, KeyRound, UserPlus, Settings, LogOut, Stamp, Grid, Save } from 'lucide-react';
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




interface CustomUser {
  id: string;
  email: string;
  name: string;
  role: string;
  service?: string; // si tu l’utilises
}


export default function HotelDashboard() {
  const { user: rawUser, logout, isLoading } = useAuth();
    const [open, setOpen] = useState(false);

const user = rawUser as CustomUser | null;
const [showValidatedConsignes, setShowValidatedConsignes] = useState(false);
const [showValidatedTickets, setShowValidatedTickets] = useState(false);
const PLAY_URL =
    "https://play.google.com/store/apps/details?id=com.martinvitte.hotelstoulonborddemer&utm_source=emea_Med";
  const APPLE_URL =
    "https://apps.apple.com/app/hotels-toulon-bord-de-mer/id6751883454";




const isAdmin = user?.role === 'admin';
const [showUserDropdown, setShowUserDropdown] = useState(false);
const userDropdownRef = useRef<HTMLDivElement | null>(null);
useEffect(() => {
  function handleClickOutside(event: MouseEvent) {
    if (userDropdownRef.current && !userDropdownRef.current.contains(event.target as Node)) {
      setShowUserDropdown(false);
    }
  }

  if (showUserDropdown) {
    document.addEventListener("mousedown", handleClickOutside);
  } else {
    document.removeEventListener("mousedown", handleClickOutside);
  }

  return () => {
    document.removeEventListener("mousedown", handleClickOutside);
  };
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

  // Si c'est le guest_review → garder 1 décimale
  const isGuestReview = suffix.includes("/10");

  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: isGuestReview ? 1 : 0,
    maximumFractionDigits: isGuestReview ? 1 : 0,
  }).format(n) + suffix;
};
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(new Date());
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
  date_fin: ''   // ✅ nouveau champ
});

  const [showConsigneModal, setShowConsigneModal] = useState(false);
  const [showTaxiModal, setShowTaxiModal] = useState(false);
  const [editConsigneIndex, setEditConsigneIndex] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<'priorite' | 'date'>('priorite');
  const [showUserModal, setShowUserModal] = useState(false);
const [newUser, setNewUser] = useState<{
  name: string;
  email: string;
  role: string;
  password: string;
  hotel_id?: string; // <--- AJOUTE ICI
}>({
  name: '',
  email: '',
  role: 'employe',
  password: '',
  hotel_id: selectedHotelId || hotels[0]?.id || '', // Valeur initiale (optionnel)
});
const [showUsersList, setShowUsersList] = useState(false);
const [users, setUsers] = useState<any[]>([]);
// Modal "Clôturer"
const [closeModal, setCloseModal] = useState<{
  open: boolean;
  user: any | null;
  date: string;
}>({ open: false, user: null, date: new Date().toISOString().slice(0,10) });

const openCloseModal = (u: any) => {
  setCloseModal({
    open: true,
    user: u,
    date: new Date().toISOString().slice(0,10),
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
  // On NE TOUCHE PAS à employment_start_date pour préserver l’historique
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


const [editIndex, setEditIndex] = useState<number | null>(null);
const [editObjetIndex, setEditObjetIndex] = useState<number | null>(null);
const [ticketsLoading, setTicketsLoading] = useState(false);
const [demandes, setDemandes] = useState<any[]>([]);
const [editDemandeIndex, setEditDemandeIndex] = useState<number | null>(null);
const [newDemande, setNewDemande] = useState({
  type: 'Taxi',
  nom: '',
  chambre: '',
  heure: '',
});


const toggleObjetCheckbox = async (id: string, field: string, value: boolean) => {
  const current = objetsTrouves.find((o) => o.id === id);
  if (!current) return;

  const nextLocal = { ...current, [field]: value };
  const allCheckedAfter =
    !!nextLocal.ficheLhost && !!nextLocal.paiementClient && !!nextLocal.colisEnvoye;

  // payload à pousser en base
  const payload: any = { [field]: value };

  // si toutes cochées maintenant → on fige completedAt (sert à masquer dès le lendemain)
  if (allCheckedAfter && !current.completedAt) {
    payload.completedAt = new Date().toISOString();
  }
  // si on décoche après coup, on peut remettre completedAt à null (optionnel)
  if (!allCheckedAfter && current.completedAt) {
    payload.completedAt = null;
  }

  const { error } = await supabase.from('objets_trouves').update(payload).eq('id', id);
  if (error) {
    console.error(`Erreur mise à jour du champ ${field} :`, error.message);
    return;
  }

  setObjetsTrouves((prev) => prev.map((o) => (o.id === id ? { ...o, ...payload } : o)));
};
// --- Suppression d'un objet trouvé
const deleteObjet = async (id: string) => {
  if (!id) return;
  if (!confirm('Supprimer cet objet ?')) return;

  const { error } = await supabase
    .from('objets_trouves')
    .delete()
    .eq('id', id);

  if (error) {
    alert('Suppression impossible : ' + error.message);
    return;
  }
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
  return formatDate(new Date(dateStr), 'dd MMMM yyyy', { locale: frLocale });
};
const [objetsTrouves, setObjetsTrouves] = useState<any[]>([]);
const [showAllObjets, setShowAllObjets] = useState(false);
const [searchObjets, setSearchObjets] = useState('');





useEffect(() => {
  supabase.from('hotels').select('id, nom, has_parking, has_coworking')
.then(({ data }) => {
    setHotels(data || []);
    // NE TOUCHE PAS selectedHotelId ici !
    // Le setSelectedHotelId ne doit JAMAIS être ici
  });
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
      .from('objets_trouves')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('date', { ascending: false });

    if (error) {
      console.error('Erreur chargement objets trouvés :', error.message);
    } else {
      setObjetsTrouves(data || []);
    }
  };

  if (hotelId) fetchObjetsTrouves();
}, [hotelId]);

useEffect(() => {
  const fetchUsers = async () => {
    if (!hotelId) return;
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('hotel_id', hotelId);
    if (error) {
      console.error('Erreur chargement utilisateurs :', error.message);
    } else {
      setUsers(data || []);
    }
  };

  if (hotelId) fetchUsers();
}, [hotelId]);

useEffect(() => {
  const fetchTickets = async () => {
    setTicketsLoading(true);
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('date_action', { ascending: true });
    if (error) {
      console.error('Erreur chargement tickets :', error.message);
    } else {
      setTickets(data || []);
    }
    setTicketsLoading(false);
  };

  if (hotelId) fetchTickets();
}, [hotelId]);



useEffect(() => {
  let isMounted = true;

  const fetchDemandes = async () => {
    const { data, error } = await supabase
      .from('demandes')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('heure', { ascending: true });

    if (error) {
      console.error('Erreur chargement demandes :', error.message);
    } else if (isMounted) {
      setDemandes(data || []);
    }
  };

  if (hotelId) fetchDemandes();

  return () => {
    isMounted = false;
  };
}, [hotelId]);

useEffect(() => {
  if (!hotelId) return;
  const fetchChauffeurs = async () => {
    const { data, error } = await supabase
      .from('chauffeurs')
      .select('*')
      .eq('hotel_id', hotelId);
    if (!error) setChauffeurs(data || []);
  };
  fetchChauffeurs();
}, [hotelId]);



useEffect(() => {
  const fetchConsignes = async () => {
    setConsignesLoading(true);
    const { data, error } = await supabase
      .from('consignes')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('created_at', { ascending: false })


    if (error) {
      console.error('Erreur chargement consignes :', error.message);
    } else {
      setConsignes(data || []);
    }

    setConsignesLoading(false);
  };

  if (hotelId) fetchConsignes();
}, [hotelId]);



  const [filterService, setFilterService] = useState<string>('Tous');

  

  const [newConsigne, setNewConsigne] = useState<{
  texte: string;
  service?: string;
  date?: string;
  valide: boolean;
  utilisateurs_ids: string[];   // ⬅️ tableau d'IDs
  date_fin: string;
}>({
  texte: '',
  service: 'Tous les services',
  date: '',
  valide: false,
  utilisateurs_ids: [],
  date_fin: ''
});



  const [newTaxi, setNewTaxi] = useState({
  type: 'Taxi',
  chambre: '',
  dateAction: '',
  heure: '',
  prix: '',
  chauffeur: '',
  statut: 'Prévu'
});

const [chauffeurs, setChauffeurs] = useState<any[]>([]);
const [showChauffeurModal, setShowChauffeurModal] = useState(false);
const [newChauffeur, setNewChauffeur] = useState('');



  const [showObjetModal, setShowObjetModal] = useState(false);

const [newObjet, setNewObjet] = useState({
  date: '',
  chambre: '',
  nomClient: '',
  objet: '',
  ficheLhost: false,
  paiementClient: false,
  colisEnvoye: false,
});



  const changeDay = (direction: number) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(selectedDate.getDate() + direction);
    setSelectedDate(newDate);
  };
const createTicket = async () => {
  if (newTicket.titre.trim() === '') return;

  const ticketToSave = {
  titre: newTicket.titre,
  service: newTicket.service,
  priorite: newTicket.priorite,
  date_action: newTicket.dateAction,
  date_fin: newTicket.date_fin || null,   // ✅ nouveau champ
  valide: false,
  auteur: (user && 'name' in user) ? (user as any).name : 'Anonyme',
  hotel_id: hotelId,
};


  if (editTicketIndex !== null) {
    const id = tickets[editTicketIndex].id;
    const { error } = await supabase
      .from('tickets')
      .update(ticketToSave)
      .eq('id', id);

    if (error) {
      console.error('Erreur modification ticket :', error.message);
      return;
    }

    const updated = [...tickets];
    updated[editTicketIndex] = { ...updated[editTicketIndex], ...ticketToSave };
    setTickets(updated);
    setEditTicketIndex(null);
  } else {
    const { data, error } = await supabase
      .from('tickets')
      .insert(ticketToSave)
      .select();

    if (error) {
      console.error('Erreur création ticket :', error.message);
      return;
    }

    setTickets((prev) => [...prev, ...(data || [])]);
  }

  // Reset
  setNewTicket({
  titre: '',
  service: 'Réception',
  dateAction: formatDate(selectedDate, 'yyyy-MM-dd'),
  priorite: 'Moyenne',
  date_fin: ''
});

  setShowTicketModal(false);
};


const handleCreateUser = async () => {
  const { email, password, name, role } = newUser;

  // 1. Crée l'utilisateur dans Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signUp({
  email,
  password,
  options: {
    data: {
      name,
      role,
      hotel_id: newUser.hotel_id,
    }
  }
});

  if (authError || !authData.user) {
    console.error("Erreur création utilisateur Auth :", authError?.message);
    alert("Erreur création utilisateur Auth : " + (authError?.message ?? ''));
    return;
  }
  if (!newUser.hotel_id) {
  alert('Merci de sélectionner un hôtel.');
  return;
}


  // 2. Enregistre dans la table "users"
  const { error: insertError } = await supabase.from('users').insert([{
    email,
    name,
    role,
    id_auth: authData.user.id,
    hotel_id: newUser.hotel_id,
  }]);

  if (insertError) {
    console.error("Erreur insertion table users :", insertError.message);
    alert("Erreur insertion table users : " + insertError.message);
    return;
  }

  const { data: configs } = await supabase.from('planning_config').select('ordre');
  const maxOrdre = configs && configs.length
    ? Math.max(...configs.map(cfg => cfg.ordre || 0))
    : 0;

  await supabase.from('planning_config').insert([{
  user_id: authData.user.id,
  hotel_id: newUser.hotel_id, // <-- impératif ici !
  ordre: maxOrdre + 1,
}]);


  // 4. MAJ liste + fermeture modal
  setUsers((prev) => [...prev, { name, email, role, id_auth: authData.user.id, hotel_id: newUser.hotel_id }]);
  setShowUserModal(false);
  setNewUser({ name: '', email: '', password: '', role: 'employe', hotel_id: hotels[0]?.id || '', });
};


 


 const createConsigne = async () => {
  if (newConsigne.texte.trim() === '') return;

const consigneToInsert = {
  texte: newConsigne.texte,
  auteur: user?.name || 'Anonyme',
  date_fin: newConsigne.date_fin || null,
  valide: false,
  // ⬇️ tableau multi-utilisateurs (champ Supabase text[])
  utilisateurs_ids: newConsigne.utilisateurs_ids ?? [],
  hotel_id: hotelId,
  date_creation: formatDate(selectedDate, 'yyyy-MM-dd'),
};






  if (editConsigneIndex !== null) {
    // édition
    const id = consignes[editConsigneIndex].id;
    const { error } = await supabase
      .from('consignes')
      .update(consigneToInsert)
      .eq('id', id);

    if (error) {
      console.error('Erreur modification consigne :', error.message);
      return;
    }

    const updated = [...consignes];
    updated[editConsigneIndex] = { ...updated[editConsigneIndex], ...consigneToInsert };
    setConsignes(updated);
    setEditConsigneIndex(null);
  } else {
    // création
    const { data, error } = await supabase
      .from('consignes')
      .insert(consigneToInsert)
      .select();

    if (error) {
      console.error('Erreur création consigne :', error.message);
      return;
    }

    setConsignes((prev) => [...prev, ...(data || [])]);
  }

 setNewConsigne({
  texte: '',
  date: new Date().toISOString().split('T')[0],
  valide: false,
  utilisateurs_ids: [],
  date_fin: ''
});


  setShowConsigneModal(false);
};

const createDemande = async () => {
  if (!newTaxi.heure || !newTaxi.chambre || !selectedDate) return;

  const demandeToSave = {
  type: newTaxi.type,
  nom: '',
  chambre: newTaxi.chambre,
  heure: newTaxi.heure,
  date: newTaxi.dateAction,
  prix: newTaxi.type === "VTC" ? parseFloat(newTaxi.prix) : null,
  chauffeur_id: newTaxi.type === "VTC" ? newTaxi.chauffeur : null,
  valide: false,
  hotel_id: hotelId,
};


  if (editDemandeIndex !== null) {
    const id = demandes[editDemandeIndex].id;
    const { error } = await supabase
      .from('demandes')
      .update(demandeToSave)
      .eq('id', id);

    if (error) {
      console.error('Erreur modification demande :', error.message);
      return;
    }

    const updated = [...demandes];
    updated[editDemandeIndex] = { ...updated[editDemandeIndex], ...demandeToSave };
    setDemandes(updated);
    setEditDemandeIndex(null);
  } else {
    const { data, error } = await supabase
      .from('demandes')
      .insert(demandeToSave)
      .select();

    if (error) {
      console.error('Erreur création demande :', error.message);
      return;
    }

    setDemandes((prev) => [...prev, ...(data || [])]);
  }

  setNewTaxi({ type: 'Taxi', chambre: '', dateAction: '', heure: '', statut: 'Prévu' });
  setEditDemandeIndex(null);
  setShowTaxiModal(false);
};


const validerDemande = async (index: number) => {
  const id = demandes[index].id;
  const date_validation = formatDate(selectedDate, 'yyyy-MM-dd');

  const { error } = await supabase
    .from('demandes')
    .update({ valide: true, date_validation })
    .eq('id', id);

  if (error) {
    console.error('Erreur validation demande :', error.message);
    return;
  }

  const updated = [...demandes];
  updated[index].valide = true;
  updated[index].date_validation = date_validation;
  setDemandes(updated);
};
const deleteDemande = async (id: string) => {
  const { error } = await supabase
    .from('demandes')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Erreur suppression demande :', error.message);
    alert('Suppression impossible : ' + error.message); // 👈 visible
    return;
  }


  setDemandes((prev) => prev.filter((d) => d.id !== id));
};
const deleteChauffeur = async (id: string) => {
  if (!confirm("Supprimer ce chauffeur ?")) return;
  const { error } = await supabase.from("chauffeurs").delete().eq("id", id);
  if (error) {
    alert("Erreur suppression chauffeur : " + error.message);
    return;
  }
  setChauffeurs((prev) => prev.filter((c) => c.id !== id));
};

  const createTaxi = () => {
    if (!newTaxi.chambre || !newTaxi.dateAction) return;
    setTaxis([...taxis, { ...newTaxi }]);
    setNewTaxi({ type: 'Taxi', chambre: '', dateAction: '', heure: '', statut: 'Prévu' });
    setShowTaxiModal(false);
  };

  const createObjetTrouve = async () => {
  if (!newObjet.date || !newObjet.chambre || !newObjet.nomClient || !newObjet.objet) return;

  if (editObjetIndex !== null) {
    const objetToUpdate = objetsTrouves[editObjetIndex];
    const { error } = await supabase
      .from('objets_trouves')
      .update(newObjet)
      .eq('id', objetToUpdate.id);

    if (error) {
      console.error('Erreur modification objet trouvé :', error.message);
      return;
    }

    const updated = [...objetsTrouves];
    updated[editObjetIndex] = { ...objetToUpdate, ...newObjet };
    setObjetsTrouves(updated);
    setEditObjetIndex(null);
  } else {
    const { data, error } = await supabase
  .from('objets_trouves')
  .insert({
    ...newObjet,
    createdAt: new Date().toISOString(),
    completedAt: null,          // 👈 important pour “cacher dès le lendemain”
    hotel_id: hotelId
  })
  .select();

    if (error) {
      console.error('Erreur création objet trouvé :', error.message);
      return;
    }

    setObjetsTrouves((prev) => [...prev, ...(data || [])]);
  }

  // Reset
  setNewObjet({
    date: '', chambre: '', nomClient: '', objet: '',
    ficheLhost: false, paiementClient: false, colisEnvoye: false,
  });
  setShowObjetModal(false);
};



  const validerConsigne = async (indexVisible: number) => {
  const consigne = consignesVisibles[indexVisible];
  const id = consigne.id;

  const { error } = await supabase
    .from('consignes')
    .update({ valide: true, date_validation: formatDate(selectedDate, 'yyyy-MM-dd') })
    .eq('id', id);

  if (error) {
    console.error('Erreur validation consigne :', error.message);
    return;
  }

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
  utilisateurs_ids: Array.isArray(consigne.utilisateurs_ids)
    ? consigne.utilisateurs_ids
    : (consigne.utilisateur_id ? [String(consigne.utilisateur_id)] : []),
});

  setEditConsigneIndex(originalIndex); // 🔁 index réel
  setShowConsigneModal(true);
};


const [nouvelleConsigne, setNouvelleConsigne] = useState({
  texte: '',
  date: format(new Date(), 'yyyy-MM-dd'),
  valide: false,
});

const [editTicketIndex, setEditTicketIndex] = useState<number | null>(null);



  const etiquette = (service: string) => {
    const map: any = {
      'Réception': '📘 Réception',
      'Housekeeping': '🧹 Housekeeping',
      'F&B': '🍽️ F&B',
      'Maintenance': '🛠️ Maintenance',
      'Tous les services': '👥 Tous les services',
    };
    return map[service] || service;
  };

  const validerTicket = async (index: number) => {
  const t = tickets[index];
  const dateValidation = format(selectedDate, 'yyyy-MM-dd');

  const { error } = await supabase
    .from('tickets')
    .update({ valide: true, date_validation: dateValidation })
    .eq('id', t.id);

  if (error) {
    console.error('Erreur validation ticket :', error.message);
    return;
  }

  const updated = [...tickets];
  updated[index] = { ...t, valide: true, date_validation: dateValidation };
  setTickets(updated);
};



  const priorityColor = (p: string) => {
    if (p === 'Haute') return 'bg-red-500';
    if (p === 'Moyenne') return 'bg-orange-400';
    return 'bg-green-500';
  };

  const ticketsVisibles = useMemo(() => {
  const visibles = tickets
    .filter((t) => {
      const actionDate = t.date_action ? new Date(t.date_action) : null;
      const endDate = t.date_fin ? new Date(t.date_fin) : actionDate;
      const validationDate = t.date_validation ? new Date(t.date_validation) : null;
      const current = new Date(formatDate(selectedDate, 'yyyy-MM-dd'));

      if (!actionDate || isNaN(actionDate.getTime())) return false;
      if (current < actionDate || current > endDate) return false;

      // 🔀 Même règle que consignes : si validé → n’afficher que si switch ON,
      // et seulement jusqu’à la date de validation incluse
      if (t.valide) {
        if (!showValidatedTickets) return false;
        return !!validationDate && current <= validationDate;
      }

      return true;
    })
    .filter((t) => filterService === 'Tous' || t.service === filterService);

  // ✅ Tri : non validés d’abord, puis par date de création décroissante
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

    // Filtrage : afficher validées seulement si switch activé
    if (c.valide) {
      if (!showValidatedConsignes) return false;
      return validationDate && current <= validationDate;
    }

    return true;
  });

  // ✅ Tri : non validées en premier, validées en bas
  return visibles.sort((a, b) => {
    if (a.valide !== b.valide) {
      return a.valide ? 1 : -1; // validées après
    }
    // tri interne par date de création décroissante
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}, [consignes, selectedDate, showValidatedConsignes]);













  const taxisVisibles = useMemo(() => {
    const currentDate = format(selectedDate, 'yyyy-MM-dd');
    return taxis.filter((t) => t.dateAction === currentDate);
  }, [taxis, selectedDate]);

  const objetsActifs = useMemo(() => {
  const now = new Date();
  return objetsTrouves.filter((o) => {
    const created = new Date(o.createdAt);
    return (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24) <= 30;
  });
}, [objetsTrouves]);

const objetsVisibles = useMemo(() => {
  // Jour “courant” (date système, pas le calendrier)
  const today = new Date();
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const todayOnly = day(today);

  const q = searchObjets.trim().toLowerCase();

  return objetsTrouves
    .filter((o) => {
      const created = o.createdAt ? new Date(o.createdAt) : (o.date ? new Date(o.date) : null);
      if (!created || isNaN(+created)) return false;

      const createdOnly = day(created);

      const sameDayAsCreation = createdOnly.getTime() === todayOnly.getTime();
      const anyChecked = !!o.ficheLhost || !!o.paiementClient || !!o.colisEnvoye;
      const allChecked = !!o.ficheLhost && !!o.paiementClient && !!o.colisEnvoye;

      // base: visible si “tout afficher” OU jour de l’ajout OU au moins une case cochée
      let visible = showAllObjets || sameDayAsCreation || anyChecked;

      // règle “masquer à partir du lendemain” si les 3 sont cochées
      if (allChecked && !showAllObjets) {
        const completed = o.completedAt ? new Date(o.completedAt) : createdOnly;
        const completedOnly = day(completed);
        const diffDays =
          (todayOnly.getTime() - completedOnly.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays >= 1) {
          visible = false; // dès le lendemain de la complétion, on masque
        }
      }

      if (!visible) return false;

      // recherche (objet / nom / chambre)
      if (q) {
        const hay = `${o.objet || ''} ${o.nomClient || ''} ${o.chambre || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    })
    // tri: plus récents en haut (création descendante)
    .sort((a, b) => {
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

    if (!user && !isResetPage) {
      router.push('/login');
    }
  }
}, [user, isLoading]);

  if (!user) return <div className="p-4 text-center">Redirection...</div>;




  return (
    <div className="p-4">

     <div className="flex items-center justify-between w-full mb-4">
  <div className="flex items-center gap-4">
    <span className="text-xl font-semibold">Bonjour, {user.name}</span>
    {hotels.length > 0 && (
  <div className="ml-4 flex items-center gap-2">
  <label htmlFor="select-hotel" className="font-semibold text-gray-700"> Hôtel :</label>
  <div className="flex gap-2">
  {hotels.map((h) => (
    <Button
      key={h.id}
      variant={h.id === selectedHotelId ? "default" : "outline"}
      className={h.id === selectedHotelId ? "bg-[#88C9B9] text-white" : ""}
      onClick={() => setSelectedHotelId(h.id)}
    >
      {h.nom}
    </Button>
  ))}
</div>

</div>
)}


    <div className="flex gap-2 overflow-x-auto py-1">
  {/* Planning en premier */}
<a href="/planning" target="_blank" rel="noopener noreferrer">
  <Button
    className="bg-[#88C9B9] hover:bg-[#6FB9A6] text-white text-sm shadow flex items-center justify-center"
    title="Voir le planning"
  >
    <CalendarDays className="w-5 h-5" />
  </Button>
</a>

{/* Menu Modules */}
<DropdownMenu open={open} onOpenChange={setOpen}>
  <DropdownMenuTrigger asChild>
    <Button
      className="bg-[#88C9B9] hover:bg-[#6FB9A6] text-white text-sm shadow flex items-center justify-center"
      title="Apps"
    >
      <Grid className="w-5 h-5" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent
    align="start"
    className="grid grid-cols-2 gap-2 p-2 w-56 bg-white shadow-lg rounded-lg
               data-[state=open]:animate-in data-[state=closed]:animate-out 
               data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 
               data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95"
>
  {currentHotel?.has_parking && (
    <a href="/parking" target="_blank" rel="noopener noreferrer">
      <Button
        onClick={() => setOpen(false)}
        className="w-full h-16 flex flex-col items-center justify-center gap-1 bg-green-50 hover:bg-green-100"
      >
        <Car className="w-5 h-5 text-green-600" />
        <span className="text-xs text-green-700">Parking</span>
      </Button>
    </a>
  )}

  {currentHotel?.has_coworking && (
    <a href="/fidelite" target="_blank" rel="noopener noreferrer">
      <Button
        onClick={() => setOpen(false)}
        className="w-full h-16 flex flex-col items-center justify-center gap-1 bg-purple-50 hover:bg-purple-100"
      >
        <Stamp className="w-5 h-5 text-purple-600" />
        <span className="text-xs text-purple-700">Co-Work</span>
      </Button>
    </a>
  )}

  <a href="/commandes" target="_blank" rel="noopener noreferrer">
    <Button
      onClick={() => setOpen(false)}
      className="w-full h-16 flex flex-col items-center justify-center gap-1 bg-orange-50 hover:bg-orange-100"
    >
      <ShoppingCart className="w-5 h-5 text-orange-600" />
      <span className="text-xs text-orange-700">Commandes</span>
    </Button>
  </a>

  <a href={`/trousseau?hotel_id=${hotelId}`} target="_blank" rel="noopener noreferrer">
    <Button
      onClick={() => setOpen(false)}
      className="w-full h-16 flex flex-col items-center justify-center gap-1 bg-cyan-50 hover:bg-cyan-100"
    >
      <KeyRound className="w-5 h-5 text-cyan-600" />
      <span className="text-xs text-cyan-700">Identifiants</span>
    </Button>
  </a>

  <a href={`/repertoire?hotel_id=${hotelId}`} target="_blank" rel="noopener noreferrer">
    <Button
      onClick={() => setOpen(false)}
      className="w-full h-16 flex flex-col items-center justify-center gap-1 bg-blue-50 hover:bg-blue-100"
    >
      <NotebookText className="w-5 h-5 text-blue-600" />
      <span className="text-xs text-blue-700">Contacts</span>
    </Button>
  </a>

  <a href={`/process?hotel_id=${hotelId}`} target="_blank" rel="noopener noreferrer">
    <Button
      onClick={() => setOpen(false)}
      className="w-full h-16 flex flex-col items-center justify-center gap-1 bg-gray-50 hover:bg-gray-100"
    >
      <Settings className="w-5 h-5 text-gray-600" />
      <span className="text-xs text-gray-700">Process</span>
    </Button>
  </a>

  {/* Maintenance — visible uniquement pour La Corniche */}
{currentHotel?.nom?.toLowerCase().includes("corniche") && (
  <a href={`/maintenance?hotel_id=${hotelId}`} target="_blank" rel="noopener noreferrer">
    <Button
      onClick={() => setOpen(false)}
      className="w-full h-16 flex flex-col items-center justify-center gap-1 bg-yellow-50 hover:bg-yellow-100"
    >
      <span className="text-xl">🛠️</span>
      <span className="text-xs text-yellow-700">Maintenance</span>
    </Button>
  </a>
)}



</DropdownMenuContent>



</DropdownMenu>


</div>
  </div>


        
        <div className="flex items-center space-x-2">
          
          
          <Button variant="outline" size="icon" onClick={() => changeDay(-1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <button
  onClick={() => setShowCalendar(true)}
  className="text-lg font-medium px-3 py-1 rounded hover:bg-gray-100"
>
  {format(selectedDate, 'eeee d MMMM yyyy', { locale: fr })}
</button>

       

          <Button variant="outline" size="icon" onClick={() => changeDay(1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        {/* Boutons à droite */}
<div className="flex items-center gap-1">
  {user?.role === 'admin' && (
    <Button variant="destructive" title="Créer un utilisateur" onClick={() => setShowUserModal(true)}>
      <UserPlus className="w-5 h-5" />
    </Button>
  )}
  <Button variant="destructive" title="Déconnexion" onClick={logout}>
    <LogOut className="w-5 h-5" />
  </Button>
</div>

</div>






      <div className="grid grid-cols-1 md:grid-cols-[2fr_2fr_1fr] gap-4">
        {/* Colonne Consignes */}
        <Card>
          <CardContent className="p-4">
            <div className="flex justify-between items-center mb-2">
  <h2 className="text-lg font-bold">📌 Passage de Consignes</h2>

  <div className="flex items-center gap-2">
    {/* Switch compact + texte clickable */}
    <button
      type="button"
      role="switch"
      aria-checked={showValidatedConsignes}
      onClick={() => setShowValidatedConsignes(!showValidatedConsignes)}
      className="group flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-800"
      title="Afficher/Masquer les consignes validées"
    >
      <span className="whitespace-nowrap select-none">Afficher validées</span>
      <span
        className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
          showValidatedConsignes ? "bg-indigo-600" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
            showValidatedConsignes ? "translate-x-4" : "translate-x-1"
          }`}
        />
      </span>
    </button>

    {/* Bouton Ajouter compact */}
    <Button
      size="sm"
      className="bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm"
      onClick={() => {
        setNewConsigne({
          texte: '',
          service: 'Tous les services',
          date: '',
          valide: false,
          utilisateurs_ids: [],
          date_fin: '',
        });
        setEditConsigneIndex(null);
        setShowConsigneModal(true);
      }}
    >
      <PlusCircle className="w-4 h-4 mr-1" /> Ajouter
    </Button>
  </div>
</div>

            <div className="space-y-2">
              {consignesVisibles.map((c, idx) => (
                <div
  key={idx}
  className={`border p-3 rounded-lg shadow-sm space-y-1 break-words whitespace-pre-wrap overflow-hidden ${
    c.valide ? 'bg-gray-200 opacity-60' : 'bg-white'
  }`}
  style={{ wordBreak: 'break-word' }}
>


                  
                  <div className="font-light text-sm whitespace-pre-wrap break-words">
  {c.texte}
  {(Array.isArray(c.utilisateurs_ids) ? c.utilisateurs_ids.length > 0 : !!c.utilisateur_id) && (
  <div className="text-xs text-gray-600 flex items-center gap-1 flex-wrap">
    <span className="mr-1">🔒 Assignée à :</span>
    {(
      Array.isArray(c.utilisateurs_ids) && c.utilisateurs_ids.length > 0
        ? c.utilisateurs_ids
        : (c.utilisateur_id ? [String(c.utilisateur_id)] : [])
    )
      .map((id: string) => users.find((u) => u.id_auth === id)?.name || 'Inconnu')
      .filter(Boolean)
      .map((name, i) => (
        <span
          key={i}
          className="inline-block bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full"
        >
          {name}
        </span>
      ))}
  </div>
)}


</div>


                  <div className="text-sm text-gray-600 flex justify-between items-center">
                    <div>Créée le : {formatSafeDate(c.created_at)}</div>

                    <div className="flex gap-2">
                      <button onClick={() => modifierConsigne(idx)} className="text-sm" title="Modifier">✏️</button>
                      {!c.valide && (
  <Button size="sm" variant="outline" onClick={() => validerConsigne(idx)}>Valider</Button>
)}

                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Colonne Tickets */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex justify-between items-center mb-4">
  <h2 className="text-lg font-bold flex items-center gap-2">🎟️ To Do</h2>

  <div className="flex items-center gap-2">
    {/* 🔀 Switch : afficher/masquer tickets validés */}
    <button
      type="button"
      role="switch"
      aria-checked={showValidatedTickets}
      onClick={() => setShowValidatedTickets(!showValidatedTickets)}
      className="group flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-800"
      title="Afficher/Masquer les tickets validés"
    >
      <span className="whitespace-nowrap select-none">Afficher validés</span>
      <span
        className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
          showValidatedTickets ? "bg-indigo-600" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
            showValidatedTickets ? "translate-x-4" : "translate-x-1"
          }`}
        />
      </span>
    </button>

    {/* Bouton Ajouter existant */}
    <button
      className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-md flex items-center gap-2 shadow-sm"
      onClick={() => {
        setNewTicket({
          titre: '',
          service: 'Réception',
          dateAction: formatDate(selectedDate, 'yyyy-MM-dd'),
          priorite: 'Moyenne',
          date_fin: ''
        });
        setEditTicketIndex(null);
        setShowTicketModal(true);
      }}
    >
      <PlusCircle className="w-4 h-4" /> Ajouter
    </button>
  </div>
</div>

            <div className="flex flex-col gap-3 mb-3">
              <div className="flex items-center gap-2">
               
                


              </div>
              <select
                className="border rounded px-3 py-2 text-sm text-gray-700 bg-white"
                value={filterService}
                onChange={(e) => setFilterService(e.target.value)}>
                <option value="Tous">Tous les services</option>
                <option value="Réception">Réception</option>
                <option value="Housekeeping">Housekeeping</option>
                <option value="F&B">F&B</option>
                <option value="Maintenance">Maintenance</option>
              </select>
            </div>
            {ticketsVisibles.map((t, idx) => (
  <div
    key={idx}
    className={`border p-3 rounded-lg shadow-sm space-y-2 break-words whitespace-pre-wrap overflow-hidden ${
      t.valide ? 'bg-gray-200 opacity-60' : 'bg-white'
    }`}
    style={{ wordBreak: 'break-word' }}
  >
    <div className="text-xs text-gray-500 italic">{etiquette(t.service)}</div>

    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
      <div className="font-light text-sm break-words whitespace-pre-wrap flex-1">
  {t.titre}
</div>
      <span className={`text-white text-xs px-2 py-1 rounded ${priorityColor(t.priorite)}`}>
        {t.priorite}
      </span>
    </div>

    <div className="flex gap-2 justify-end mt-2">
  <button
  onClick={() => {
    const realIndex = tickets.findIndex(ticket => ticket.id === t.id);
    if (realIndex === -1) return;
    setNewTicket({ ...t });
    setEditTicketIndex(realIndex);
    setShowTicketModal(true);
  }}
  className="text-sm"
  title="Modifier"
>
  ✏️
</button>

<Button
  size="sm"
  variant="outline"
  onClick={() => {
    const realIndex = tickets.findIndex(ticket => ticket.id === t.id);
    if (realIndex !== -1) validerTicket(realIndex);
  }}
>
  Valider
</Button>

</div>

  </div>
))}

          </CardContent>
        </Card>

        {/* Calendrier et Taxis/Réveils */}
        <div className="space-y-4">
          {/* Tableau de bord KPIs */}
{/* Tableau de bord KPIs */}
<Card>
  <CardContent className="p-4">
    <h2 className="text-lg font-bold mb-4">📊 Tableau de bord</h2>

    {[
      { key: "ca", label: "CA", suffix: "€" },
      { key: "taux_occupation", label: "Taux d’occupation", suffix: "%" },
      { key: "prix_moyen", label: "Prix moyen", suffix: "€" },
      { key: "guest_review", label: "Guest review", suffix: "/10" },
    ].map((def, i) => {
      const value = kpis?.[def.key];
      const target = kpis?.[`${def.key}_objectif`];
      const progress = value && target ? Math.min(100, (value / target) * 100) : 0;

      return (
        <div key={i} className="mb-3">
          <div className="flex justify-between text-sm mb-1">
            <span>{def.label}</span>

            {isAdmin ? (
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  className="border rounded px-2 py-1 w-20 text-sm"
                  value={value ?? ""}
                  onChange={(e) =>
                    setKpis((prev) => ({ ...prev, [def.key]: Number(e.target.value) }))
                  }
                />
                /
                <input
                  type="number"
                  className="border rounded px-2 py-1 w-20 text-sm"
                  value={target ?? ""}
                  onChange={(e) =>
                    setKpis((prev) => ({ ...prev, [`${def.key}_objectif`]: Number(e.target.value) }))
                  }
                />
                
              </div>
            ) : (
              <span>
  {formatNumber(value, def.suffix)} / {formatNumber(target, def.suffix)}
</span>

            )}
          </div>

          <div className="relative w-full bg-gray-200 rounded-full h-3 mt-1 overflow-hidden">
  <div
    className={`h-3 rounded-full transition-all duration-500 ${
      progress >= 100
        ? "bg-green-500"
        : "bg-gradient-to-r from-indigo-500 to-purple-500"
    }`}
    style={{ width: `${progress}%` }}
  />
  <span className="absolute right-1 top-0 text-[10px] text-white font-bold">
    
  </span>
</div>

        </div>
      );
    })}
    {isAdmin && (
  <div className="flex justify-end mt-4">
    <Button
  className="bg-indigo-600 hover:bg-indigo-700 text-white shadow flex items-center gap-2"
  onClick={async () => {
    const payload = {
      hotel_id: hotelId,
      mois: selectedDate.getMonth() + 1,
      annee: selectedDate.getFullYear(),
      ...kpis,
    };
    const { error } = await supabase
      .from("kpis")
      .upsert(payload, { onConflict: "hotel_id,mois,annee" });
    if (error) {
      alert("Erreur sauvegarde: " + error.message);
    } 
  }}
>
  <Save className="w-5 h-5" />
  
</Button>


  </div>
)}

  </CardContent>
</Card>



          <Card>
            <CardContent className="px-4 py-1">
              <div className="flex justify-between items-center mb-2">
                <h2 className="text-lg font-bold">🚖 Taxis / Réveils</h2>
                <button
  onClick={() => {
  setNewTaxi({
    type: 'Taxi',
    chambre: '',
    heure: '',
    statut: 'Prévu',
    dateAction: formatDate(selectedDate, 'yyyy-MM-dd'),
  });
  setEditDemandeIndex(null);
  setShowTaxiModal(true);
}}

  className="bg-indigo-500 hover:bg-indigo-600 text-white px-2 py-2 rounded-md flex items-center gap-2 shadow-sm"
>
  <PlusCircle className="w-4 h-4" /> Ajouter
</button>
              </div>
              <div className="space-y-2">
                {demandesVisibles.map((d, idx) => (
  <div
    key={idx}
    className={`border p-2 rounded-md flex justify-between items-center
      ${
        d.statut === 'À prévoir'
          ? 'bg-orange-300'
          : d.statut === 'Prévu' || d.statut === 'Fait'
            ? 'bg-green-200'
            : 'bg-white'
      }
    `}
  >
    <span className="text-xs">{d.type} - #{d.chambre} à {d.heure?.slice(0, 5)}</span>

    <div className="flex items-center gap-2">
  {/* Statut */}
  <select
    className="text-sm border rounded px-2 py-1"
    value={d.statut || 'À prévoir'}
    onChange={async (e) => {
      const newStatut = e.target.value;
      const { error } = await supabase
        .from('demandes')
        .update({ statut: newStatut })
        .eq('id', d.id);

      if (error) {
        console.error('Erreur modification statut :', error.message);
        return;
      }

      // MAJ locale par id
      const realIndex = demandes.findIndex(dd => dd.id === d.id);
      if (realIndex === -1) return;
      const updated = [...demandes];
      updated[realIndex].statut = newStatut;
      setDemandes(updated);
    }}
  >
    <option value="À prévoir">À prévoir</option>
    <option value="Prévu">Prévu</option>
    <option value="Fait">Fait</option>
  </select>

  {/* ✏️ Modifier */}
  <button
    className="text-sm px-2 py-1 border rounded hover:bg-yellow-50"
    title="Modifier"
    onClick={() => {
      // ✅ TROUVE l’index réel dans 'demandes' à partir de l'id
      const realIndex = demandes.findIndex(dd => dd.id === d.id);
      if (realIndex === -1) return;

      setNewTaxi({
  type: d.type ?? 'Taxi',
  chambre: d.chambre ?? '',
  heure: d.heure ?? '',
  prix: d.prix ?? '',
  chauffeur: d.chauffeur_id ?? '',   // 👈 ajoute ça
  statut: d.statut ?? 'Prévu',
  dateAction: d.date ?? formatDate(selectedDate, 'yyyy-MM-dd'),
});

      setEditDemandeIndex(realIndex); // ✅ on stocke l’index RÉEL
      setShowTaxiModal(true);
    }}
  >
    ✏️
  </button>

  {/* 🗑️ Supprimer */}
  <button
    className="text-sm px-2 py-1 border rounded hover:bg-red-50"
    title="Supprimer"
    onClick={() => {
      if (confirm('Supprimer cette demande ?')) {
        deleteDemande(d.id);
      }
    }}
  >
    🗑️
  </button>
</div>

  </div>
))}



              </div>
              <div className="mt-4 text-sm font-semibold">
  {Object.entries(totalVTCMoisParChauffeur).map(([chauffeur, total]) => (
    <div key={chauffeur} className="flex justify-between">
      <span>{chauffeur}</span>
      <span>{total} €</span>
    </div>
  ))}
</div>

            </CardContent>
          </Card>
        </div>
      </div>


      {/* Modal Taxi */}
      {showTaxiModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg space-y-4 w-full max-w-md">
            <h2 className="text-xl font-bold">Nouveau Taxi / Réveil</h2>
            
            <select
              className="w-full border rounded px-2 py-1"
              value={newTaxi.type}
              onChange={(e) => setNewTaxi({ ...newTaxi, type: e.target.value })}
            >
              <option value="Taxi">Taxi</option>
              <option value="Réveil">Réveil</option>
              <option value="VTC">VTC</option>
            </select>
            <input
  type="date"
  className="border px-2 py-1 rounded"
  value={newTaxi.dateAction}
  onChange={(e) =>
    setNewTaxi({ ...newTaxi, dateAction: e.target.value })
  }
/>
            <Input
              type="time"
              value={newTaxi.heure}
              onChange={(e) => setNewTaxi({ ...newTaxi, heure: e.target.value })}
            />
            <textarea
  placeholder="#"
  className="w-full border rounded px-2 py-1"
  rows={2}   // tu peux ajuster le nombre de lignes visibles
  value={newTaxi.chambre}
  onChange={(e) => setNewTaxi({ ...newTaxi, chambre: e.target.value })}
/>

            {newTaxi.type === "VTC" && (
  <>
    <Input
      type="number"
      placeholder="Prix (€)"
      value={newTaxi.prix}
      onChange={(e) => setNewTaxi({ ...newTaxi, prix: e.target.value })}
    />
    <div className="flex items-center gap-2">
      <select
        className="w-full border rounded px-2 py-1"
        value={newTaxi.chauffeur || ""}
        onChange={(e) => setNewTaxi({ ...newTaxi, chauffeur: e.target.value })}
      >
        <option value="">Choisir un chauffeur</option>
        {chauffeurs.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nom}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        className="bg-indigo-500 text-white"
        onClick={() => setShowChauffeurModal(true)}
      >
        +
      </Button>
    </div>
  </>
)}


            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowTaxiModal(false)}>Annuler</Button>
              <Button onClick={createDemande}>
  {editDemandeIndex !== null ? 'Modifier' : 'Créer'}
</Button>

            </div>
          </div>
        </div>
      )}
    
      {showTicketModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg space-y-4 w-full max-w-md">
            <h2 className="text-xl font-bold">Nouvelle tache</h2>
            <Input placeholder="Titre" value={newTicket.titre} onChange={(e) => setNewTicket({ ...newTicket, titre: e.target.value })} />
            <Input type="date" value={newTicket.dateAction} onChange={(e) => setNewTicket({ ...newTicket, dateAction: e.target.value })} />
            <select className="w-full border rounded px-2 py-1" value={newTicket.service} onChange={(e) => setNewTicket({ ...newTicket, service: e.target.value })}>
              <option>Réception</option>
              <option>Housekeeping</option>
              <option>F&B</option>
              <option>Maintenance</option>
            </select>
            <select className="w-full border rounded px-2 py-1" value={newTicket.priorite} onChange={(e) => setNewTicket({ ...newTicket, priorite: e.target.value })}>
              <option>Basse</option>
              <option>Moyenne</option>
              <option>Haute</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    checked={!!newTicket.date_fin}
    onChange={(e) =>
      setNewTicket({
        ...newTicket,
        date_fin: e.target.checked ? formatDate(selectedDate, 'yyyy-MM-dd') : ''
      })
    }
  />
  Répéter jusqu'au :
</label>

{newTicket.date_fin && (
  <Input
    type="date"
    value={newTicket.date_fin}
    onChange={(e) => setNewTicket({ ...newTicket, date_fin: e.target.value })}
  />
)}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => {
  setShowTicketModal(false);
  setEditTicketIndex(null);
}}>
  Annuler
</Button>
              <Button onClick={createTicket}>
  {editTicketIndex !== null ? 'Modifier' : 'Créer'}
</Button>

            </div>
          </div>
        </div>
      )}
    

      {showConsigneModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg space-y-4 w-full max-w-md">
            <h2 className="text-xl font-bold">Nouvelle Consigne</h2>
            <textarea
  placeholder="Texte de la consigne"
  value={newConsigne.texte}
  onChange={(e) => setNewConsigne({ ...newConsigne, texte: e.target.value })}
  rows={4}
  className="w-full border rounded px-2 py-1"
/>
            <div className="relative" ref={userDropdownRef}>
  <label className="block text-sm font-medium mb-1">Assigner à</label>

  {/* Bouton pour ouvrir/fermer */}
  <Button
    variant="outline"
    className="w-full justify-between"
    onClick={() => setShowUserDropdown((prev) => !prev)}
  >
    {newConsigne.utilisateurs_ids.length > 0
      ? `${newConsigne.utilisateurs_ids.length} sélectionné(s)`
      : "Sélectionner des utilisateurs"}
    <span className="ml-2">▼</span>
  </Button>

  {/* Liste déroulante */}
  {showUserDropdown && (
    <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto border rounded bg-white shadow">
      {users.map((u) => (
        <label
          key={u.id_auth}
          className="flex items-center gap-2 px-2 py-1 hover:bg-gray-100 cursor-pointer"
        >
          <input
            type="checkbox"
            checked={newConsigne.utilisateurs_ids.includes(u.id_auth)}
            onChange={(e) => {
              if (e.target.checked) {
                setNewConsigne({
                  ...newConsigne,
                  utilisateurs_ids: [...newConsigne.utilisateurs_ids, u.id_auth],
                });
              } else {
                setNewConsigne({
                  ...newConsigne,
                  utilisateurs_ids: newConsigne.utilisateurs_ids.filter(
                    (id) => id !== u.id_auth
                  ),
                });
              }
            }}
          />
          <span>{u.name}</span>
        </label>
      ))}
    </div>
  )}

  {/* Badges des utilisateurs choisis */}
  <div className="flex flex-wrap gap-1 mt-2">
    {newConsigne.utilisateurs_ids.map((id) => {
      const user = users.find((u) => u.id_auth === id);
      return (
        <span
          key={id}
          className="bg-gray-100 px-2 py-0.5 rounded-full text-xs text-gray-700"
        >
          {user?.name || "Inconnu"}
        </span>
      );
    })}
  </div>
</div>


<label className="flex items-center gap-2 text-sm mt-2">
  <input
    type="checkbox"
    checked={!!newConsigne.date_fin}
    onChange={(e) =>
      setNewConsigne({
        ...newConsigne,
        date_fin: e.target.checked ? formatDate(selectedDate, 'yyyy-MM-dd') : ''
      })
    }
  />
  Répéter jusqu'au :
</label>

{newConsigne.date_fin && (
  <Input
    type="date"
    value={newConsigne.date_fin}
    onChange={(e) => setNewConsigne({ ...newConsigne, date_fin: e.target.value })}
  />
)}

            <div className="flex justify-end gap-2">
              <Button
  variant="outline"
  onClick={() => {
    setShowConsigneModal(false);
    setEditConsigneIndex(null);
  }}
>
  Annuler
</Button>

              <Button onClick={createConsigne}>
  {editConsigneIndex !== null ? 'Modifier' : 'Créer'}
</Button>

            </div>
          </div>
        </div>
      )}

   <div className="mt-8">
  <div className="flex justify-between items-center mb-2">
    <h2 className="text-lg font-bold">🧳 Objets trouvés</h2>
  </div>

  <div className="mb-4 flex items-center justify-between w-full">
    {/* gauche : recherche + switch */}
    <div className="flex items-center gap-2">
      <input
        className="border rounded px-2 py-1 text-sm"
        placeholder="Rechercher (objet, nom, chambre)"
        value={searchObjets}
        onChange={(e) => setSearchObjets(e.target.value)}
      />

      <button
        type="button"
        role="switch"
        aria-checked={showAllObjets}
        onClick={() => setShowAllObjets((v) => !v)}
        className="group flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-800"
        title="Afficher tous les objets"
      >
        <span className="whitespace-nowrap select-none">Tout afficher</span>
        <span
          className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
            showAllObjets ? 'bg-indigo-600' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
              showAllObjets ? 'translate-x-4' : 'translate-x-1'
            }`}
          />
        </span>
      </button>
    </div>

    {/* droite : LHOST + Ajouter */}
    <div className="flex items-center gap-2">
      <a
        href="https://resort.mylhost.com/login"
        target="_blank"
        rel="noopener noreferrer"
        className="text-orange-500 font-bold border border-orange-400 rounded px-3 py-1 text-xs hover:bg-orange-50 transition"
      >
        LHOST
      </a>

      <button
        onClick={() => setShowObjetModal(true)}
        className="bg-indigo-500 hover:bg-indigo-600 text-white px-2 py-2 rounded-md flex items-center gap-2 shadow-sm"
      >
        <PlusCircle className="w-4 h-4" /> Ajouter
      </button>
    </div>
  </div>
</div>



  <div className="space-y-2">

 {objetsVisibles.map((o, idx) => {
  const complet = o.ficheLhost && o.paiementClient && o.colisEnvoye;
  return (
    <div
      key={o.id ?? idx}
      className={`flex items-center justify-between gap-4 p-3 border rounded-md ${
        complet ? 'bg-gray-200 text-gray-500' : 'bg-white'
      }`}
    >
      <div className="flex-1 text-sm flex flex-wrap items-center gap-2">
        <span>{format(new Date(o.date), 'dd MMMM yyyy', { locale: fr })}</span>
        <span>- #{o.chambre}</span>
        <span>- {o.nomClient}</span>
        <span>- {o.objet}</span>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center text-xs gap-1">
          <input
            type="checkbox"
            checked={!!o.ficheLhost}
            onChange={(e) => toggleObjetCheckbox(o.id, 'ficheLhost', e.target.checked)}
          />
          Fiche Lhost
        </label>
        <label className="flex items-center text-xs gap-1">
          <input
            type="checkbox"
            checked={!!o.paiementClient}
            onChange={(e) => toggleObjetCheckbox(o.id, 'paiementClient', e.target.checked)}
          />
          Paiement client
        </label>
        <label className="flex items-center text-xs gap-1">
          <input
            type="checkbox"
            checked={!!o.colisEnvoye}
            onChange={(e) => toggleObjetCheckbox(o.id, 'colisEnvoye', e.target.checked)}
          />
          Colis envoyé
        </label>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <button
          title="Modifier"
          onClick={() => {
            setNewObjet({ ...o });
            setEditObjetIndex(idx);
            setShowObjetModal(true);
          }}
        >
          ✏️
        </button>
        <button title="Supprimer" onClick={() => deleteObjet(o.id)}>🗑️</button>
      </div>
    </div>
  );
})}


</div>


{showObjetModal && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className="bg-white p-6 rounded-lg space-y-4 w-full max-w-2xl">
      <h2 className="text-xl font-bold">Nouvel objet trouvé</h2>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <Input type="date" value={newObjet.date} onChange={(e) => setNewObjet({ ...newObjet, date: e.target.value })} />
        <Input placeholder="Chambre" value={newObjet.chambre} onChange={(e) => setNewObjet({ ...newObjet, chambre: e.target.value })} />
        <Input placeholder="Nom du client" value={newObjet.nomClient} onChange={(e) => setNewObjet({ ...newObjet, nomClient: e.target.value })} />
        <Input placeholder="Objet" value={newObjet.objet} onChange={(e) => setNewObjet({ ...newObjet, objet: e.target.value })} />
      </div>
      

      
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => {
  setShowObjetModal(false);
  setEditObjetIndex(null); // réinitialise l'édition
}}>
  Annuler
</Button>
        <Button onClick={createObjetTrouve}>
  {editObjetIndex !== null ? 'Modifier' : 'Créer'}
</Button>

      </div>
    </div>
  </div>
)}

{showUserModal && (
  <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
    <div className="bg-white p-6 rounded shadow-md w-full max-w-md">
      <h2 className="text-xl font-semibold mb-4">Créer un utilisateur</h2>
      
      <Input placeholder="Nom" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} className="mb-2" />
      <Input type="email" placeholder="Email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="mb-2" />
      <Input type="password" placeholder="Mot de passe temporaire" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className="mb-2" />
      <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="w-full border rounded px-2 py-2 mb-4">
        <option value="employe">Employé</option>
        <option value="admin">Admin</option>
      </select>
      {isAdmin && hotels.length > 0 && (
  <select
    className="w-full border rounded px-2 py-2 mb-4"
    value={newUser.hotel_id || ''}
    onChange={(e) => setNewUser({ ...newUser, hotel_id: e.target.value })}
  >
    <option value="">Sélectionner un hôtel</option>
    {hotels.map((h) => (
      <option key={h.id} value={h.id}>
        {h.nom}
      </option>
    ))}
  </select>
)}


      <div className="flex justify-end space-x-2">
        <Button variant="outline" onClick={() => setShowUserModal(false)}>Annuler</Button>
        <Button onClick={handleCreateUser}>Créer</Button>
      </div>
    </div>
  </div>
)}
{showChauffeurModal && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className="bg-white p-6 rounded-lg space-y-4 w-full max-w-sm">
      <h2 className="text-xl font-bold">Gestion des Chauffeurs</h2>

      {/* Liste des chauffeurs existants */}
      <div className="space-y-2 max-h-40 overflow-y-auto">
        {chauffeurs.map((c) => (
          <div key={c.id} className="flex justify-between items-center border px-2 py-1 rounded">
            <span>{c.nom}</span>
            <button
              className="text-red-500 text-sm"
              onClick={() => deleteChauffeur(c.id)}
            >
              🗑️
            </button>
          </div>
        ))}
        {chauffeurs.length === 0 && <div className="text-sm text-gray-500">Aucun chauffeur pour l’instant</div>}
      </div>

      {/* Formulaire d’ajout */}
      <Input
        placeholder="Nom du chauffeur"
        value={newChauffeur}
        onChange={(e) => setNewChauffeur(e.target.value)}
      />

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setShowChauffeurModal(false)}>Fermer</Button>
        <Button
          onClick={async () => {
            if (!newChauffeur.trim()) return;
            const { data, error } = await supabase
              .from('chauffeurs')
              .insert({ nom: newChauffeur, hotel_id: hotelId })
              .select();
            if (!error && data) {
              setChauffeurs([...chauffeurs, ...data]);
              setNewChauffeur('');
            }
          }}
        >
          Ajouter
        </Button>
      </div>
    </div>
  </div>
)}



{user.role === 'admin' && (
  <div className="mt-6">
    <div className="flex items-center justify-between mb-2">
      <h2 className="text-lg font-bold">👥 Utilisateurs</h2>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showUsersList}
          onChange={() => setShowUsersList(!showUsersList)}
        />
        Afficher
      </label>
    </div>

    {showUsersList && (
      <div className="space-y-2">
        {users.map((u, idx) => (
          <div key={idx} className="border p-3 rounded-md flex justify-between items-center bg-white">
            <div>
              <div className="font-semibold">{u.name}</div>
              <div className="text-sm text-gray-500">{u.email} - {u.role}</div>
            </div>

            <div className="flex items-center gap-2">
              <select
                className="border rounded px-2 py-1"
                value={u.hotel_id || ""}
                onChange={async (e) => {
                  const newHotelId = e.target.value;
                  const { error } = await supabase
                    .from('users')
                    .update({ hotel_id: newHotelId })
                    .eq('id_auth', u.id_auth);

                  if (error) {
                    alert("Erreur lors du changement d'hôtel : " + error.message);
                    return;
                  }

                  setUsers((prev) =>
                    prev.map((user, i) =>
                      i === idx ? { ...user, hotel_id: newHotelId } : user
                    )
                  );
                }}
              >
                {hotels.map((h) => (
                  <option value={h.id} key={h.id}>{h.nom}</option>
                ))}
              </select>

             {(() => {
  const isClosed =
    (u.active === false) ||
    (u.employment_end_date && new Date(u.employment_end_date) < new Date());

  return (
    <div className="flex items-center gap-2">
      <span
        className={`text-xs px-2 py-1 rounded ${
          isClosed ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
        }`}
      >
        {isClosed ? 'Clôturé' : 'Actif'}
      </span>

      {!isClosed ? (
        <Button
          size="sm"
          variant="destructive"
          onClick={() => openCloseModal(u)}
        >
          Clôturer
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => reactivateUser(u)}
        >
          Réactiver
        </Button>
      )}
    </div>
  );
})()}


            </div>
          </div>
        ))}
      </div>
    )}
  </div>
)}

{closeModal.open && (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
    <div className="bg-white rounded-2xl p-6 shadow-2xl w-full max-w-md space-y-4">
      <h2 className="text-lg font-semibold">Clôturer un salarié</h2>
      <div className="text-sm text-gray-600">
        Salarié : <span className="font-medium">{closeModal.user?.name || closeModal.user?.email}</span>
      </div>

      <label className="block text-sm font-medium">Date de fin de contrat</label>
      <input
        type="date"
        className="w-full border rounded px-3 py-2"
        value={closeModal.date}
        onChange={e => setCloseModal(m => ({ ...m, date: e.target.value }))}
      />

      <div className="flex justify-end gap-2 pt-2">
        <button
          className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 shadow font-semibold"
          onClick={() => setCloseModal({ open:false, user:null, date:new Date().toISOString().slice(0,10) })}
        >
          Annuler
        </button>
        <button
          className="px-4 py-2 rounded-xl bg-red-600 text-white shadow font-semibold"
          onClick={doCloseUser}
        >
          Clôturer
        </button>
      </div>
    </div>
  </div>
)}

{showCalendar && (
  <div className="fixed inset-0 backdrop-blur-sm bg-white/30 flex items-center justify-center z-50">

    <div className="bg-white p-6 rounded-lg shadow-lg">
      <Calendar
        mode="single"
        selected={selectedDate}
        onSelect={(d) => {
          setSelectedDate(d ?? new Date());
          setShowCalendar(false);
        }}
        locale={fr}
      />
      <div className="flex justify-end mt-4">
        <Button variant="outline" onClick={() => setShowCalendar(false)}>
          Fermer
        </Button>
      </div>
    </div>
  </div>
)}


{/* Liens + QR codes vers les apps */}
<div className="mt-10">
  <h3 className="text-center text-lg font-semibold">Scannez pour télécharger</h3>

  <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-8 justify-items-center">
    {/* Android */}
    <div className="flex flex-col items-center gap-3">
      <div className="p-4 bg-white rounded-xl shadow">
        <QRCodeSVG value={PLAY_URL} size={100} includeMargin />
      </div>
      <span className="text-sm text-gray-600">App Android</span>
      <a href={PLAY_URL} target="_blank" rel="noopener noreferrer">
        <Button className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-xl shadow">
          Ouvrir dans le Play Store
        </Button>
      </a>
    </div>

    {/* iPhone */}
    <div className="flex flex-col items-center gap-3">
      <div className="p-4 bg-white rounded-xl shadow">
        <QRCodeSVG value={APPLE_URL} size={100} includeMargin />
      </div>
      <span className="text-sm text-gray-600">App iPhone</span>
      <a href={APPLE_URL} target="_blank" rel="noopener noreferrer">
        <Button className="bg-black hover:bg-gray-900 text-white px-6 py-3 rounded-xl shadow">
          Ouvrir dans l’App Store
        </Button>
      </a>
    </div>
  </div>

  
</div>
</div>


  );
}