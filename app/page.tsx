
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, PlusCircle, Filter, CalendarDays, Car, NotebookText, ShoppingCart, KeyRound, UserPlus, Settings, LogOut } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { v4 as uuidv4 } from 'uuid';
import { format as formatDate } from 'date-fns';
import { fr as frLocale } from 'date-fns/locale';
import Link from "next/link";




interface CustomUser {
  id: string;
  email: string;
  name: string;
  role: string;
  service?: string; // si tu l’utilises
}


export default function HotelDashboard() {
  const { user: rawUser, logout, isLoading } = useAuth();
const user = rawUser as CustomUser | null;

const isAdmin = user?.role === 'admin';
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
  const { error } = await supabase
    .from('objets_trouves')
    .update({ [field]: value })
    .eq('id', id);

  if (error) {
    console.error(`Erreur mise à jour du champ ${field} :`, error.message);
    return;
  }

  // Mettre à jour localement
  const updated = objetsTrouves.map((o) =>
    o.id === id ? { ...o, [field]: value } : o
  );
  setObjetsTrouves(updated);
};

const deleteObjet = async (id: string) => {
  const { error } = await supabase
    .from('objets_trouves')
    .delete()
    .eq('id', id);
    

  if (error) {
    console.error('Erreur suppression objet trouvé :', error.message);
    return;
  }

  setObjetsTrouves((prev) => prev.filter((o) => o.id !== id));
};


const formatSafeDate = (dateStr: string | undefined) => {
  if (!dateStr || isNaN(Date.parse(dateStr))) return 'Date invalide';
  return formatDate(new Date(dateStr), 'dd MMMM yyyy', { locale: frLocale });
};
const [objetsTrouves, setObjetsTrouves] = useState<any[]>([]);





useEffect(() => {
  supabase.from('hotels').select('id, nom, has_parking').then(({ data }) => {
    setHotels(data || []);
    // NE TOUCHE PAS selectedHotelId ici !
    // Le setSelectedHotelId ne doit JAMAIS être ici
  });
}, []);




useEffect(() => {
  if (hotelId) {
    supabase.from('hotels').select('id, nom, has_parking').eq('id', hotelId).single()
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

  

  const [newConsigne, setNewConsigne] = useState({
  texte: '',
  service: 'Tous les services',
  date: '',
  valide: false,
  utilisateur_id: null,
  date_fin: ''   // ✅ nouveau champ
});


  const [newTaxi, setNewTaxi] = useState({
  type: 'Taxi',
  chambre: '',
  dateAction: '',
  heure: '',
  statut: 'Prévu' // 👈 ajoute cette ligne
});



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
  utilisateur_id: newConsigne.utilisateur_id || null,
  hotel_id: hotelId,
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
  utilisateur_id: null,
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
      .insert({ ...newObjet, createdAt: new Date().toISOString(), hotel_id: hotelId })
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

  setNewConsigne({ ...consigne });
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
      if (!t.valide) return true;
      return validationDate && current <= validationDate;
    })
    .filter((t) => filterService === 'Tous' || t.service === filterService);

  return visibles.sort((a, b) => {
    // Priorité : non validé d'abord, puis par date décroissante
    if (a.valide !== b.valide) return a.valide ? 1 : -1;
    return new Date(b.date_action).getTime() - new Date(a.date_action).getTime();
  });
}, [tickets, sortBy, filterService, selectedDate]);



const demandesVisibles = useMemo(() => {
  const selected = formatDate(selectedDate, 'yyyy-MM-dd');
  return demandes.filter((d) => d.date === selected);
}, [demandes, selectedDate]);





 const consignesVisibles = useMemo(() => {
  const visibles = consignes.filter((c) => {
    const creationDate = c.date_creation ? new Date(c.date_creation) : null;
    const endDate = c.date_fin ? new Date(c.date_fin) : creationDate;
    const validationDate = c.date_validation ? new Date(c.date_validation) : null;
    const current = new Date(formatDate(selectedDate, 'yyyy-MM-dd'));

    if (!creationDate || isNaN(creationDate.getTime())) return false;
    if (current < creationDate || current > endDate) return false;
    if (!c.valide) return true;
    return validationDate && current <= validationDate;
  });

  return visibles.sort((a, b) => {
    if (a.valide !== b.valide) return a.valide ? 1 : -1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}, [consignes, selectedDate]);











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

  {/* Parking */}
  {currentHotel?.has_parking && (
    <a href="/parking" target="_blank" rel="noopener noreferrer">
      <Button className="bg-[#88C9B9] hover:bg-[#6FB9A6] text-white text-sm shadow flex items-center justify-center" title="Parking">
        <Car className="w-5 h-5" />
      </Button>
    </a>
  )}

  {/* Commandes */}
  <a href="/commandes" target="_blank" rel="noopener noreferrer">
    <Button className="bg-[#88C9B9] hover:bg-[#6FB9A6] text-white text-sm shadow flex items-center justify-center" title="Commandes">
      <ShoppingCart className="w-5 h-5" />
    </Button>
  </a>

  {/* Trousseau */}
  <a href={`/trousseau?hotel_id=${hotelId}`} target="_blank" rel="noopener noreferrer">
    <Button className="bg-[#88C9B9] hover:bg-[#6FB9A6] text-white text-sm shadow flex items-center justify-center" title="Trousseau">
      <KeyRound className="w-5 h-5" />
    </Button>
  </a>

  <a href={`/repertoire?hotel_id=${hotelId}`} target="_blank" rel="noopener noreferrer">
  <Button className="bg-[#88C9B9] hover:bg-[#6FB9A6] text-white text-sm shadow flex items-center justify-center" title="Répertoire">
    <NotebookText className="w-5 h-5" />
  </Button>
</a>
<a href={`/process?hotel_id=${hotelId}`} target="_blank" rel="noopener noreferrer">
    <Button
      className="bg-[#88C9B9] hover:bg-[#6FB9A6] text-white text-sm shadow flex items-center justify-center"
      title="Process"
    >
      <Settings className="w-5 h-5" />
    </Button>
  </a>

</div>
  </div>


        
        <div className="flex items-center space-x-2">
          
          
          <Button variant="outline" size="icon" onClick={() => changeDay(-1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="text-lg font-medium">
            {format(selectedDate, 'eeee d MMMM yyyy', { locale: fr })}
          </div>
       

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
              <button onClick={() => setShowConsigneModal(true)} className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-md flex items-center gap-2 shadow-sm">
                <PlusCircle className="w-4 h-4" /> Ajouter
              </button>
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
  {c.utilisateur_id && (
  <div className="text-xs text-gray-500">
    🔒 Assignée à : {users.find(u => u.id_auth === c.utilisateur_id)?.name || 'Inconnu'}
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
              <button className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-md flex items-center gap-2 shadow-sm" onClick={() => {
  setNewTicket({
    titre: '',
    service: 'Réception',
    dateAction: formatDate(selectedDate, 'yyyy-MM-dd'), // ✅ prend la date du calendrier
    priorite: 'Moyenne',
    date_fin: ''
  });
  setEditTicketIndex(null);
  setShowTicketModal(true);
}}>
                <PlusCircle className="w-4 h-4" /> Ajouter
              </button>
            </div>
            <div className="flex flex-col gap-3 mb-3">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-600">Trier par :</span>
                <button
  className="bg-green-100 text-green-800 hover:bg-green-200 px-4 py-2 rounded-full text-sm"
  onClick={() => setSortBy(sortBy === 'priorite' ? 'date' : 'priorite')}
>
  Trier par : {sortBy === 'priorite' ? 'Priorité' : 'Date'}
</button>


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
  <Button
  size="sm"
  variant="outline"
  onClick={() => {
    const realIndex = tickets.findIndex(ticket => ticket.id === t.id);
    if (realIndex === -1) return;

    setNewTicket({
  titre: t.titre,
  service: t.service,
  dateAction: t.date_action,
  priorite: t.priorite,
  date_fin: t.date_fin || ''
});

    setEditTicketIndex(realIndex);
    setShowTicketModal(true);
  }}
>
  ✏️ 
</Button>


  <Button
  size="sm"
  className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
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
          <Card>
            <CardContent className="p-2 flex flex-col items-center gap-2 !h-fit">
                            <div className="scale-95">
                <Calendar mode="single" selected={selectedDate} onSelect={setSelectedDate} locale={fr} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
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
    </div>
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
            <Input
              placeholder="#"
              value={newTaxi.chambre}
              onChange={(e) => setNewTaxi({ ...newTaxi, chambre: e.target.value })}
            />
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
            <select
  className="w-full border rounded px-2 py-1"
  value={newConsigne.utilisateur_id || ''}
  onChange={(e) =>
    setNewConsigne({
      ...newConsigne,
      utilisateur_id: e.target.value || null,
    })
  }
>
  

  <option value="">Aucun utilisateur assigné</option>
  {users.map((u) => (
    <option key={u.id_auth} value={u.id_auth}>
      {u.name} ({u.email})
    </option>
  ))}
</select>
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

      <div className="mt-6">
  <div className="flex justify-between items-center mb-2">
  <h2 className="text-lg font-bold">🧳 Objets trouvés</h2>
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

  <div className="space-y-2">

 {objetsActifs.map((o, idx) => {
  const complet = o.ficheLhost && o.paiementClient && o.colisEnvoye;
  return (
    <div
      key={idx}
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
            checked={o.ficheLhost}
            onChange={(e) => toggleObjetCheckbox(o.id, 'ficheLhost', e.target.checked)}
          />
          Fiche Lhost
        </label>
        <label className="flex items-center text-xs gap-1">
          <input
            type="checkbox"
            checked={o.paiementClient}
            onChange={(e) => toggleObjetCheckbox(o.id, 'paiementClient', e.target.checked)}
          />
          Paiement client
        </label>
        <label className="flex items-center text-xs gap-1">
          <input
            type="checkbox"
            checked={o.colisEnvoye}
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
        <button title="Supprimer" onClick={() => deleteObjet(o.id)}>
          🗑️
        </button>
      </div>
    </div>
  );
})}

</div>
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

              <Button
                size="sm"
                variant="destructive"
                onClick={async () => {
                  const userToDelete = users[idx];
                  const { error } = await supabase.from('users').delete().eq('id_auth', userToDelete.id_auth);
                  if (error) {
                    console.error('Erreur suppression utilisateur :', error.message);
                  } else {
                    const updated = users.filter((u) => u.id_auth !== userToDelete.id_auth);
                    setUsers(updated);
                  }
                }}
              >
                Supprimer
              </Button>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
)}


    
</div>
  );
}
