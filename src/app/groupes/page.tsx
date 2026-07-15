'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '@/context/AuthContext';
import { useSelectedHotel } from '@/context/SelectedHotelContext';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { confirmDialog } from '@/components/ConfirmDialog';
import {
  Users, Plus, Trash2, Loader2, ArrowLeft, Pencil, X, Check, Copy, Link2,
  BedDouble, ImagePlus, Eye, EyeOff, Building2, CalendarDays, Hash, ExternalLink,
  Mail, Phone, Settings, BedSingle,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const BUCKET = 'groupe-images';

// Domaine du site public (Site-BW) où vit la page invité /groupe/[code].
// hotel-corniche.com fait une redirection Cloudflare qui jette le chemin → on
// cible le domaine Netlify qui sert réellement la page. Surchargeable via env
// (repasser à hotel-corniche.com quand il sera un vrai domaine custom Netlify).
const SITE_BW_BASE =
  process.env.NEXT_PUBLIC_SITE_BW_URL || 'https://sitehtbm.netlify.app';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------
interface Hotel { id: string; nom: string }

interface RoomType {
  id: string;
  hotel_id: string;
  nom: string;
  ordre: number;
  active: boolean;
}

interface Chambre {
  id: string;
  hotel_id: string;
  room_type_id: string | null;
  numero: string;
  pax_max: number;
  twinable: boolean;
  ordre: number;
  active: boolean;
}

interface GroupeChambre {
  id: string;
  groupe_id: string;
  chambre_id: string;
  hotel_id: string;
  tarif_nuit: number;
}

interface GroupeReservation {
  id: string;
  groupe_id: string;
  groupe_chambre_id: string;
  statut: string;
  nom: string;
  prenom: string | null;
  email: string;
  tel: string | null;
  date_arrivee: string;
  date_depart: string;
  config_lit: string | null;
  nb_personnes: number;
  pms_done: boolean;
  vu_backoffice: boolean;
  derniere_action: string;
  created_at: string;
  modified_at: string;
}

interface Groupe {
  id: string;
  nom: string;
  code_acces: string;
  date_arrivee: string;
  date_depart: string;
  date_limite: string;
  conditions_annulation: string | null;
  plan_visible: boolean;
  paiement_obligatoire?: boolean;
  mode_paiement?: string | null;
  date_envoi_paiement?: string | null;
  cover_image_url: string | null;
  message_accueil: string | null;
  contact_nom: string | null;
  contact_email: string | null;
  notes: string | null;
  statut: string;
  groupe_chambres: GroupeChambre[];
  groupe_reservations: GroupeReservation[];
}

// Sélection d'une chambre dans le bloc, en cours d'édition
interface RoomSel {
  id?: string;          // id de groupe_chambres si déjà dans le bloc
}

// Clé de catégorie pour le tarif : le type, ou un sentinel par hôtel pour les sans-type
function typeKeyOf(c: { room_type_id: string | null; hotel_id: string }) {
  return c.room_type_id || `__notype_${c.hotel_id}`;
}

// Tri par numéro de chambre, numérique-aware ("2" < "10" < "Suite")
function byNumero(a: { numero: string }, b: { numero: string }) {
  return (a.numero || '').localeCompare(b.numero || '', 'fr', { numeric: true, sensitivity: 'base' });
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function genCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I,O,0,1 ambigus
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function euro(n: number) {
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function pathFromPublicUrl(url: string): string | null {
  const marker = `/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : url.slice(i + marker.length);
}

function publicLink(code: string) {
  return `${SITE_BW_BASE}/groupe/${code}`;
}

// ============================================================================
// Page
// ============================================================================
export default function GroupesPage() {
  const { user, isLoading } = useAuth();
  const { selectedHotelId } = useSelectedHotel();
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [chambres, setChambres] = useState<Chambre[]>([]);
  const [groupes, setGroupes] = useState<Groupe[]>([]);
  const [loading, setLoading] = useState(true);

  const isSuperadmin = user?.role === 'superadmin';
  const isAdmin = isSuperadmin || user?.role === 'admin';

  // Mode d'affichage piloté par l'URL :
  //   (rien)       → récap des groupes (tuiles chrono) — la page d'accueil du module
  //   ?g=<id>      → gestion d'un groupe (deep-link depuis Commercial ou le récap)
  //   ?new=<lead>  → création d'un bloc rattaché à un dossier commercial
  //   ?create      → création d'un bloc autonome (depuis le récap, admin)
  //   ?config      → paramétrage « Chambres & types » (admins uniquement)
  const [detailId, setDetailId] = useState<string | null>(null);
  const [newLeadId, setNewLeadId] = useState<string | null>(null);
  const [configParam, setConfigParam] = useState(false);
  const [createParam, setCreateParam] = useState(false);
  const [urlReady, setUrlReady] = useState(false);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setDetailId(sp.get('g'));
    setNewLeadId(sp.get('new'));
    setConfigParam(sp.has('config'));
    setCreateParam(sp.has('create'));
    setUrlReady(true);
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Tous les rôles voient tous les hôtels : un bloc de groupe peut être
      // multi-hôtel (Corniche + Voiles) et rien n'est confidentiel ici. La
      // frontière de sécurité, c'est le rôle (création réservée aux admins),
      // pas le hotel_id de rattachement.
      const { data } = await supabase.from('hotels').select('id, nom').order('nom');
      setHotels((data || []) as Hotel[]);
    })();
  }, [user]);

  const hotelIds = useMemo(() => hotels.map(h => h.id), [hotels]);
  const hotelName = useCallback((id: string) => hotels.find(h => h.id === id)?.nom || '—', [hotels]);

  const loadAll = useCallback(async () => {
    if (hotelIds.length === 0) { setLoading(false); return; }
    setLoading(true);
    const [rt, ch, gr] = await Promise.all([
      supabase.from('room_types').select('*').in('hotel_id', hotelIds).order('ordre'),
      supabase.from('room_units').select('*').in('hotel_id', hotelIds).order('ordre'),
      supabase
        .from('groupes')
        .select('*, groupe_chambres(*), groupe_reservations(id, groupe_id, groupe_chambre_id, statut, nom, prenom, email, tel, date_arrivee, date_depart, config_lit, nb_personnes, pms_done, vu_backoffice, derniere_action, created_at, modified_at)')
        .order('date_arrivee', { ascending: true }),
    ]);
    if (rt.error) toast.error('Types : ' + rt.error.message);
    if (ch.error) toast.error('Chambres : ' + ch.error.message);
    if (gr.error) toast.error('Groupes : ' + gr.error.message);
    setRoomTypes((rt.data || []) as RoomType[]);
    setChambres((ch.data || []) as Chambre[]);
    // Tous les groupes sont visibles par tous les rôles (multi-hôtel, rien de
    // confidentiel). Chaque carte porte déjà le badge du/des hôtel(s) concerné(s).
    setGroupes((gr.data || []) as Groupe[]);
    setLoading(false);
  }, [hotelIds]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Récap filtré par l'hôtel sélectionné dans le rail global : un groupe
  // apparaît « côté Corniche » s'il a une chambre Corniche, « côté Voiles »
  // s'il a une chambre Voiles, des deux côtés s'il est multi-hôtel. Le state
  // `groupes` reste complet (détail/édition d'un groupe d'un autre hôtel OK).
  const recapGroupes = useMemo(() =>
    selectedHotelId
      ? groupes.filter(g => (g.groupe_chambres || []).some(c => c.hotel_id === selectedHotelId))
      : groupes,
    [groupes, selectedHotelId]);

  if (isLoading) {
    return <div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }
  if (!user) return <div className="p-8 text-center text-slate-500">Authentification requise.</div>;

  const configMode = configParam;
  const formOrDetailMode = !!detailId || !!newLeadId || createParam;
  const recapMode = !configMode && !formOrDetailMode;

  const headerBack = recapMode ? '/' : (newLeadId ? '/commercial' : '/groupes');
  const subtitle = recapMode
    ? 'Groupes & mariages — blocs de chambres'
    : configMode
      ? 'Paramétrage des chambres & types par hôtel'
      : 'Bloc de chambres — inscription en ligne';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <header className="mb-6 flex items-center gap-3">
          {/* Navigation intra-module en rechargement complet : le mode est lu
              depuis l'URL au montage (pas de soft-nav, sinon la vue ne suit pas). */}
          <a href={headerBack} className="text-slate-400 hover:text-slate-700 transition">
            <ArrowLeft className="w-5 h-5" />
          </a>
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-rose-100 text-rose-700">
            <Users className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-slate-800">Groupes &amp; mariages</h1>
            <p className="text-sm text-slate-500">{subtitle}</p>
          </div>
          {recapMode && (
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <a href="/groupes?create=1"
                className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 h-10 rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition shadow-sm">
                <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Nouveau groupe</span>
              </a>
              {isAdmin && (
                <a href="/groupes?config=1"
                  className="inline-flex items-center gap-1.5 text-sm font-medium px-3 h-10 rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 transition"
                  title="Chambres & types">
                  <Settings className="w-4 h-4" /> <span className="hidden sm:inline">Réglages</span>
                </a>
              )}
            </div>
          )}
        </header>

        {!urlReady || (loading && !configMode) ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
        ) : configMode ? (
          isAdmin ? (
            <ChambresTab
              hotels={hotels}
              roomTypes={roomTypes}
              chambres={chambres}
              user={user}
              onChanged={loadAll}
            />
          ) : (
            <Card><CardContent className="p-8 text-center text-slate-500 text-sm">
              Le paramétrage des chambres est réservé aux administrateurs.<br />
              <a href="/groupes" className="text-rose-600 underline">Retour aux groupes</a>
            </CardContent></Card>
          )
        ) : recapMode ? (
          <GroupesRecap groupes={recapGroupes} hotelName={hotelName} hotelsCount={hotels.length} />
        ) : (
          <GroupesTab
            hotels={hotels}
            roomTypes={roomTypes}
            chambres={chambres}
            groupes={groupes}
            initialDetailId={detailId}
            newLeadId={newLeadId}
            blankCreate={createParam}
            hotelName={hotelName}
            onChanged={loadAll}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Récap des groupes — tuiles triées chronologiquement (page d'accueil du module)
// ============================================================================
function GroupesRecap({ groupes, hotelName, hotelsCount }: {
  groupes: Groupe[];
  hotelName: (id: string) => string;
  hotelsCount: number;
}) {
  const today = format(new Date(), 'yyyy-MM-dd');

  // Statut calculé à partir des dates + du champ statut (clos/annulé).
  function statusOf(g: Groupe): { key: string; label: string; cls: string; weight: number } {
    if (g.statut === 'annule') return { key: 'annule', label: 'Annulé', cls: 'bg-slate-100 text-slate-500 border-slate-200', weight: 4 };
    if (g.statut === 'clos') return { key: 'clos', label: 'Clos', cls: 'bg-slate-100 text-slate-500 border-slate-200', weight: 3 };
    if (g.date_depart < today) return { key: 'passe', label: 'Passé', cls: 'bg-slate-100 text-slate-500 border-slate-200', weight: 2 };
    if (g.date_arrivee <= today && g.date_depart >= today) return { key: 'encours', label: 'En cours', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', weight: 0 };
    return { key: 'prevu', label: 'Prévu', cls: 'bg-rose-50 text-rose-700 border-rose-200', weight: 1 };
  }

  const cards = useMemo(() => {
    return groupes
      .map(g => {
        const st = statusOf(g);
        const resas = g.groupe_reservations || [];
        // Bulle = uniquement ce que le détail met en avant : réservations
        // confirmées nouvelles/modifiées + annulations à retirer du PMS.
        // (on ignore les états « morts » comme expiree, qui n'apparaissent nulle part)
        const unread =
          resas.filter(r => r.statut === 'confirmee' && !r.vu_backoffice).length +
          resas.filter(r => r.statut === 'annulee' && !r.pms_done).length;
        const confirmed = resas.filter(r => r.statut === 'confirmee').length;
        const nbChambres = (g.groupe_chambres || []).length;
        const hotelIds = [...new Set((g.groupe_chambres || []).map(c => c.hotel_id))];
        return { g, st, unread, confirmed, nbChambres, hotelIds };
      })
      .sort((a, b) =>
        a.st.weight !== b.st.weight
          ? a.st.weight - b.st.weight
          // À venir/en cours : du plus proche au plus lointain ; passés : plus récent d'abord
          : (a.st.weight <= 1
              ? a.g.date_arrivee.localeCompare(b.g.date_arrivee)
              : b.g.date_arrivee.localeCompare(a.g.date_arrivee)));
  }, [groupes, today]); // eslint-disable-line react-hooks/exhaustive-deps

  if (cards.length === 0) {
    return (
      <Card><CardContent className="p-10 text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-50 text-rose-300 flex items-center justify-center mb-4">
          <Users className="w-8 h-8" />
        </div>
        <p className="text-slate-600 font-medium">Aucun groupe pour le moment</p>
        <p className="text-sm text-slate-400 mt-1">
          Crée un bloc depuis « Nouveau groupe » ou depuis un dossier Commercial.
        </p>
      </CardContent></Card>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {cards.map(({ g, st, unread, confirmed, nbChambres, hotelIds }) => {
        const dim = st.weight >= 2;
        return (
          <a key={g.id} href={`/groupes?g=${g.id}`}
            className={`group relative block rounded-2xl border bg-white overflow-hidden shadow-sm hover:shadow-md hover:border-rose-200 transition-all ${dim ? 'opacity-70 hover:opacity-100' : ''}`}>
            {/* Bulle rouge : données nouvelles / modifiées non vues */}
            {unread > 0 && (
              <span className="absolute top-2 right-2 z-10 min-w-[22px] h-[22px] px-1.5 rounded-full bg-rose-600 text-white text-[11px] font-bold flex items-center justify-center shadow-md ring-2 ring-white">
                {unread}
              </span>
            )}
            {/* Couverture */}
            <div className="h-28 w-full relative bg-gradient-to-br from-rose-100 to-rose-50 flex items-center justify-center">
              {g.cover_image_url
                ? <img src={g.cover_image_url} alt="" className="absolute inset-0 w-full h-full object-cover" />
                : <Users className="w-9 h-9 text-rose-300" />}
              <span className={`absolute bottom-2 left-2 text-[11px] font-bold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
            </div>
            {/* Corps */}
            <div className="p-4">
              <h3 className="font-bold text-slate-800 truncate group-hover:text-rose-700 transition">{g.nom}</h3>
              <div className="mt-1.5 text-xs text-slate-500 flex items-center gap-1">
                <CalendarDays className="w-3.5 h-3.5 shrink-0" />
                {format(new Date(g.date_arrivee), 'dd MMM', { locale: fr })} → {format(new Date(g.date_depart), 'dd MMM yyyy', { locale: fr })}
              </div>
              {hotelsCount > 1 && hotelIds.length > 0 && (
                <div className="mt-1 text-[11px] text-slate-400 flex items-center gap-1 truncate">
                  <Building2 className="w-3 h-3 shrink-0" /> {hotelIds.map(hotelName).join(', ')}
                </div>
              )}
              <div className="mt-3 flex items-center gap-3 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1"><BedSingle className="w-3.5 h-3.5 text-slate-400" /> {confirmed}/{nbChambres} réservées</span>
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}

// ============================================================================
// Onglet GROUPES — liste + création / édition (allotement par chambre précise)
// ============================================================================
function GroupesTab({
  hotels, roomTypes, chambres, groupes, initialDetailId, newLeadId, blankCreate, hotelName, onChanged,
}: {
  hotels: Hotel[];
  roomTypes: RoomType[];
  chambres: Chambre[];
  groupes: Groupe[];
  initialDetailId: string | null;
  newLeadId: string | null;
  blankCreate?: boolean;
  hotelName: (id: string) => string;
  onChanged: () => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(!!newLeadId || !!blankCreate);
  const [editing, setEditing] = useState<Groupe | null>(null);
  const [saving, setSaving] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(initialDetailId);
  const formRef = useRef<HTMLDivElement>(null);

  const [nom, setNom] = useState('');
  const [dateArrivee, setDateArrivee] = useState('');
  const [dateDepart, setDateDepart] = useState('');
  const [dateLimite, setDateLimite] = useState('');
  const [conditions, setConditions] = useState('');
  const [planVisible, setPlanVisible] = useState(true);
  const [modePaiement, setModePaiement] = useState<'immediat' | 'differe' | 'optionnel' | 'aucun'>('immediat');
  const [dateEnvoiPaiement, setDateEnvoiPaiement] = useState('');
  const [messageAccueil, setMessageAccueil] = useState('');
  const [contactNom, setContactNom] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  // Sélection de chambres : chambre_id -> { id? }
  const [selected, setSelected] = useState<Record<string, RoomSel>>({});
  // Tarif par catégorie : typeKey (room_type_id ou "__notype_<hotelId>") -> tarif
  const [tarifByType, setTarifByType] = useState<Record<string, string>>({});
  const coverInputRef = useRef<HTMLInputElement>(null);

  // Création depuis un dossier commercial : /groupes?new=<leadId> ouvre le
  // formulaire pré-rempli avec les infos du dossier (nom, contact, dates).
  useEffect(() => {
    if (!newLeadId) return;
    (async () => {
      const { data } = await supabase
        .from('suivi_commercial')
        .select('nom_client, titre_demande, email, date_evenement, date_fin_evenement')
        .eq('id', newLeadId)
        .single();
      if (data) {
        setNom(data.titre_demande || data.nom_client || '');
        setContactNom(data.nom_client || '');
        setContactEmail(data.email || '');
        if (data.date_evenement) setDateArrivee(data.date_evenement);
        if (data.date_fin_evenement) setDateDepart(data.date_fin_evenement);
      }
      setShowForm(true);
    })();
  }, [newLeadId]);

  // ── Brouillon auto-sauvé (création) : ne plus rien perdre en changeant d'onglet
  // ou de page. Persistance à chaque frappe dans localStorage, restauration au
  // retour, nettoyage à l'enregistrement / annulation (voir resetForm).
  const DRAFT_KEY = 'groupes:new-draft';

  // Persiste le formulaire de CRÉATION (pas l'édition) tant qu'il est ouvert.
  useEffect(() => {
    if (typeof window === 'undefined' || !showForm || editing) return;
    const draft = {
      nom, dateArrivee, dateDepart, dateLimite, conditions, planVisible,
      modePaiement, dateEnvoiPaiement, messageAccueil, contactNom, contactEmail, notes,
      selected, tarifByType,
    };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* quota */ }
  }, [showForm, editing, nom, dateArrivee, dateDepart, dateLimite, conditions, planVisible,
      modePaiement, dateEnvoiPaiement, messageAccueil, contactNom, contactEmail, notes, selected, tarifByType]);

  // Restaure un brouillon au montage (sauf si on arrive depuis un dossier / édition).
  useEffect(() => {
    if (typeof window === 'undefined' || newLeadId || editing) return;
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      const hasContent = d && (d.nom || d.dateArrivee || d.dateDepart || (d.selected && Object.keys(d.selected).length));
      if (!hasContent) return;
      setNom(d.nom || ''); setDateArrivee(d.dateArrivee || ''); setDateDepart(d.dateDepart || ''); setDateLimite(d.dateLimite || '');
      setConditions(d.conditions || ''); setPlanVisible(d.planVisible ?? true);
      setModePaiement(d.modePaiement ?? 'immediat'); setDateEnvoiPaiement(d.dateEnvoiPaiement ?? '');
      setMessageAccueil(d.messageAccueil || ''); setContactNom(d.contactNom || ''); setContactEmail(d.contactEmail || ''); setNotes(d.notes || '');
      setSelected(d.selected || {}); setTarifByType(d.tarifByType || {});
      setShowForm(true);
      toast('Brouillon restauré', { icon: '📝' });
    } catch { /* json invalide */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roomTypeName = useCallback(
    (id: string | null) => roomTypes.find(rt => rt.id === id)?.nom || 'Sans type',
    [roomTypes],
  );
  const chambreById = useCallback((id: string) => chambres.find(c => c.id === id), [chambres]);

  function resetForm() {
    setEditing(null);
    setNom(''); setDateArrivee(''); setDateDepart(''); setDateLimite('');
    setConditions(''); setPlanVisible(true); setModePaiement('immediat'); setDateEnvoiPaiement(''); setMessageAccueil('');
    setContactNom(''); setContactEmail(''); setNotes('');
    setCoverUrl(null); setCoverFile(null);
    setSelected({}); setTarifByType({});
    if (coverInputRef.current) coverInputRef.current.value = '';
    // Le brouillon a rempli son rôle (enregistré ou annulé) → on le purge.
    if (typeof window !== 'undefined') { try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ } }
  }

  // Fermer le formulaire : en édition → retour au détail du groupe ;
  // en création (depuis un dossier) → retour au pipeline commercial.
  function closeForm() {
    const back = editing?.id ?? null;
    setShowForm(false);
    resetForm();
    if (back) { setDetailId(back); window.history.replaceState(null, '', `/groupes?g=${back}`); }
    // Création depuis un dossier commercial → retour au pipeline ;
    // création autonome (depuis le récap) → retour au récap des groupes.
    else window.location.href = newLeadId ? '/commercial' : '/groupes';
  }

  function startEdit(g: Groupe) {
    setEditing(g);
    setNom(g.nom);
    setDateArrivee(g.date_arrivee);
    setDateDepart(g.date_depart);
    setDateLimite(g.date_limite);
    setConditions(g.conditions_annulation || '');
    setPlanVisible(g.plan_visible);
    setModePaiement((g.mode_paiement as 'immediat' | 'differe' | 'optionnel' | 'aucun') ?? (g.paiement_obligatoire ? 'immediat' : 'aucun'));
    setDateEnvoiPaiement(g.date_envoi_paiement ?? '');
    setMessageAccueil(g.message_accueil || '');
    setContactNom(g.contact_nom || '');
    setContactEmail(g.contact_email || '');
    setNotes(g.notes || '');
    setCoverUrl(g.cover_image_url);
    setCoverFile(null);
    const sel: Record<string, RoomSel> = {};
    const tbt: Record<string, string> = {};
    for (const c of g.groupe_chambres || []) {
      sel[c.chambre_id] = { id: c.id };
      const ch = chambres.find(x => x.id === c.chambre_id);
      if (ch) tbt[typeKeyOf(ch)] = String(c.tarif_nuit);
    }
    setSelected(sel);
    setTarifByType(tbt);
    setShowForm(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function toggleRoom(chambreId: string) {
    setSelected(prev => {
      const next = { ...prev };
      if (next[chambreId]) delete next[chambreId];
      else next[chambreId] = {};
      return next;
    });
  }

  // Cocher / décocher toutes les chambres d'une catégorie
  function toggleType(ids: string[], on: boolean) {
    setSelected(prev => {
      const next = { ...prev };
      for (const id of ids) {
        if (on) { if (!next[id]) next[id] = {}; }
        else delete next[id];
      }
      return next;
    });
  }

  async function uploadCover(groupeId: string): Promise<string | null> {
    if (!coverFile) return coverUrl;
    const ext = (coverFile.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${groupeId}/cover-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, coverFile, { upsert: true });
    if (error) { toast.error('Photo : ' + error.message); return coverUrl; }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nom.trim()) return toast.error('Donne un nom au groupe.');
    if (!dateArrivee || !dateDepart) return toast.error('Indique les dates d’arrivée et de départ.');
    if (!dateLimite) return toast.error('Indique la date limite d’inscription.');
    if (dateDepart < dateArrivee) return toast.error('Le départ doit être après l’arrivée.');
    if (modePaiement === 'differe' && !dateEnvoiPaiement) return toast.error('Indique la date d’envoi du lien de paiement.');

    const entries = Object.entries(selected);
    if (entries.length === 0) return toast.error('Sélectionne au moins une chambre pour le bloc.');

    // Un tarif par catégorie utilisée
    const usedKeys = new Set(entries.map(([id]) => { const ch = chambreById(id); return ch ? typeKeyOf(ch) : null; }).filter(Boolean) as string[]);
    const missing = [...usedKeys].filter(k => { const v = tarifByType[k]; return v === undefined || v === '' || isNaN(parseFloat(v)); });
    if (missing.length) return toast.error('Indique un tarif pour chaque catégorie de chambre sélectionnée.');

    const editingId = editing?.id ?? null;
    setSaving(true);

    const meta = {
      nom: nom.trim(),
      date_arrivee: dateArrivee,
      date_depart: dateDepart,
      date_limite: dateLimite,
      conditions_annulation: conditions.trim() || null,
      plan_visible: planVisible,
      mode_paiement: modePaiement,
      date_envoi_paiement: modePaiement === 'differe' ? (dateEnvoiPaiement || null) : null,
      paiement_obligatoire: modePaiement === 'immediat', // compat route reserve actuelle
      message_accueil: messageAccueil.trim() || null,
      contact_nom: contactNom.trim() || null,
      contact_email: contactEmail.trim() || null,
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    try {
      let groupeId: string;

      if (editing) {
        groupeId = editing.id;
        const cover = await uploadCover(groupeId);
        const { error } = await supabase.from('groupes').update({ ...meta, cover_image_url: cover }).eq('id', groupeId);
        if (error) throw error;

        // Diff des chambres du bloc
        const bookedChambreIds = new Set(
          (editing.groupe_reservations || [])
            .filter(r => r.statut === 'confirmee')
            .map(r => (editing.groupe_chambres || []).find(c => c.id === r.groupe_chambre_id)?.chambre_id)
            .filter(Boolean) as string[]
        );
        const removed = (editing.groupe_chambres || []).filter(c => !selected[c.chambre_id]);
        for (const r of removed) {
          if (bookedChambreIds.has(r.chambre_id)) {
            toast.error(`Chambre ${chambreById(r.chambre_id)?.numero || ''} : déjà réservée, retrait du bloc bloqué.`);
            continue;
          }
          await supabase.from('groupe_chambres').delete().eq('id', r.id);
        }
        for (const [chambreId, sel] of entries) {
          const ch = chambreById(chambreId);
          if (!ch) continue;
          const tarif = parseFloat(tarifByType[typeKeyOf(ch)] || '') || 0;
          if (sel.id) {
            await supabase.from('groupe_chambres').update({ tarif_nuit: tarif }).eq('id', sel.id);
          } else {
            await supabase.from('groupe_chambres').insert({
              groupe_id: groupeId, chambre_id: chambreId, hotel_id: ch.hotel_id, tarif_nuit: tarif,
            });
          }
        }
        // Sync du dossier commercial lié (best-effort)
        const primaryHotelId = entries.length ? (chambreById(entries[0][0])?.hotel_id || null) : null;
        await supabase.from('suivi_commercial').update({
          nom_client: nom.trim(), titre_demande: contactNom.trim() || 'Groupe',
          email: contactEmail.trim() || null,
          date_evenement: dateArrivee, date_fin_evenement: dateDepart,
          ...(primaryHotelId ? { hotel_id: primaryHotelId } : {}),
        }).eq('groupe_id', groupeId);
        toast.success('Groupe mis à jour');
      } else {
        let code = genCode();
        const ins = await supabase.from('groupes').insert({ ...meta, code_acces: code }).select().single();
        let created = ins.data;
        if (ins.error) {
          if (ins.error.code === '23505') {
            code = genCode();
            const retry = await supabase.from('groupes').insert({ ...meta, code_acces: code }).select().single();
            if (retry.error) throw retry.error;
            created = retry.data;
          } else throw ins.error;
        }
        groupeId = (created as Groupe).id;

        const cover = await uploadCover(groupeId);
        if (cover) await supabase.from('groupes').update({ cover_image_url: cover }).eq('id', groupeId);

        const rows = entries.map(([chambreId]) => {
          const ch = chambreById(chambreId);
          return {
            groupe_id: groupeId,
            chambre_id: chambreId,
            hotel_id: ch?.hotel_id,
            tarif_nuit: ch ? (parseFloat(tarifByType[typeKeyOf(ch)] || '') || 0) : 0,
          };
        });
        const { error: chErr } = await supabase.from('groupe_chambres').insert(rows);
        if (chErr) throw chErr;

        // Rattachement au dossier commercial d'origine (créé en amont dans le
        // pipeline ; c'est lui qui porte devis + fiche de fonction).
        const primaryHotelId = rows[0]?.hotel_id || null;
        if (newLeadId) {
          const { error: leadErr } = await supabase.from('suivi_commercial').update({
            groupe_id: groupeId,
            date_evenement: dateArrivee, date_fin_evenement: dateDepart,
            ...(primaryHotelId ? { hotel_id: primaryHotelId } : {}),
          }).eq('id', newLeadId);
          if (leadErr) console.warn('Dossier commercial non lié :', leadErr.message);
        }
        toast.success(`Groupe créé — code ${code}`);
      }

      setShowForm(false);
      resetForm();
      await onChanged();
      const targetId = editingId ?? groupeId;
      setDetailId(targetId);
      window.history.replaceState(null, '', `/groupes?g=${targetId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      toast.error('Enregistrement : ' + msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(g: Groupe) {
    const hasResa = (g.groupe_reservations || []).some(r => r.statut === 'confirmee');
    const ok = await confirmDialog({
      title: 'Supprimer ce groupe ?',
      message: hasResa
        ? `"${g.nom}" a des réservations. La suppression effacera tout, y compris les inscriptions des invités.`
        : `"${g.nom}" sera définitivement supprimé.`,
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    if (g.cover_image_url) {
      const p = pathFromPublicUrl(g.cover_image_url);
      if (p) await supabase.storage.from(BUCKET).remove([p]);
    }
    const { error } = await supabase.from('groupes').delete().eq('id', g.id);
    if (error) return toast.error('Suppression : ' + error.message);
    toast.success('Groupe supprimé');
    await onChanged();
  }

  async function copyLink(code: string) {
    try {
      await navigator.clipboard.writeText(publicLink(code));
      toast.success('Lien copié');
    } catch {
      toast.error('Copie impossible — copiez à la main : ' + publicLink(code));
    }
  }

  // Chambres actives groupées par hôtel puis par catégorie (pour la sélection du bloc)
  const blocGroups = useMemo(() => {
    const out: { hotel: Hotel; groups: { key: string; name: string; rooms: Chambre[] }[] }[] = [];
    for (const h of hotels) {
      const rooms = chambres.filter(c => c.active && c.hotel_id === h.id);
      if (rooms.length === 0) continue;
      const byKey = new Map<string, { key: string; name: string; rooms: Chambre[] }>();
      for (const c of rooms) {
        const key = typeKeyOf(c);
        if (!byKey.has(key)) byKey.set(key, { key, name: roomTypeName(c.room_type_id), rooms: [] });
        byKey.get(key)!.rooms.push(c);
      }
      for (const grp of byKey.values()) grp.rooms.sort(byNumero);
      // Catégories triées par room_types.ordre (classique → premium), sans-type en dernier.
      const ordreOf = (key: string) => key.startsWith('__notype') ? 9999 : (roomTypes.find(rt => rt.id === key)?.ordre ?? 9999);
      out.push({ hotel: h, groups: [...byKey.values()].sort((a, b) => ordreOf(a.key) - ordreOf(b.key)) });
    }
    return out;
  }, [hotels, chambres, roomTypeName, roomTypes]);

  const nbSelected = Object.keys(selected).length;

  const detailGroup = detailId ? groupes.find(g => g.id === detailId) || null : null;
  if (detailGroup) {
    return (
      <GroupDetail
        group={detailGroup} chambres={chambres} roomTypes={roomTypes} hotelName={hotelName}
        onBack={() => { window.location.href = '/groupes'; }}
        onEdit={() => { setDetailId(null); startEdit(detailGroup); }}
        onDelete={async () => { await handleDelete(detailGroup); window.location.href = '/groupes'; }}
        onCopyLink={() => copyLink(detailGroup.code_acces)}
        onChanged={onChanged}
      />
    );
  }
  if (detailId && !detailGroup) {
    return (
      <Card><CardContent className="p-8 text-center text-slate-500 text-sm">
        Groupe introuvable ou accès non autorisé.
        <div className="mt-3"><a href="/commercial" className="text-rose-600 underline">Retour au commercial</a></div>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      {showForm && (
        <div ref={formRef}>
          <Card className={editing ? 'ring-2 ring-rose-300' : ''}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                  {editing ? <><Pencil className="w-4 h-4" /> Modifier le groupe</> : <><Plus className="w-4 h-4" /> Nouveau bloc de chambres</>}
                </h2>
                <button onClick={closeForm} className="text-slate-400 hover:text-slate-700" title="Fermer">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid md:grid-cols-2 gap-4">
                  <Field label="Nom du groupe *">
                    <input value={nom} onChange={e => setNom(e.target.value)} placeholder="Mariage Léa & Tom"
                      className="w-full border rounded-lg px-3 h-11 text-sm bg-white" />
                  </Field>
                  <Field label="Contact organisateur">
                    <input value={contactNom} onChange={e => setContactNom(e.target.value)} placeholder="Léa Dupont"
                      className="w-full border rounded-lg px-3 h-11 text-sm bg-white" />
                  </Field>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                  <Field label="Arrivée *">
                    <input type="date" value={dateArrivee} onChange={e => setDateArrivee(e.target.value)}
                      className="w-full border rounded-lg px-3 h-11 text-sm bg-white" />
                  </Field>
                  <Field label="Départ *">
                    <input type="date" value={dateDepart} onChange={e => setDateDepart(e.target.value)}
                      className="w-full border rounded-lg px-3 h-11 text-sm bg-white" />
                  </Field>
                  <Field label="Date limite d’inscription *">
                    <input type="date" value={dateLimite} onChange={e => setDateLimite(e.target.value)}
                      className="w-full border rounded-lg px-3 h-11 text-sm bg-white" />
                  </Field>
                </div>

                {/* Sélection des chambres du bloc — tarif par catégorie */}
                <div className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                      <BedDouble className="w-4 h-4 text-rose-600" /> Chambres du bloc
                      <span className="text-xs font-normal text-slate-400">({nbSelected} sélectionnée{nbSelected > 1 ? 's' : ''})</span>
                    </span>
                  </div>

                  {blocGroups.length === 0 ? (
                    <p className="text-sm text-amber-600">Aucune chambre. Crée-en d’abord dans l’onglet « Chambres &amp; types ».</p>
                  ) : (
                    <div className="space-y-4">
                      {blocGroups.map(({ hotel: h, groups }) => (
                        <div key={h.id}>
                          <p className="text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
                            <Building2 className="w-3 h-3" /> {h.nom}
                          </p>
                          <div className="space-y-2.5">
                            {groups.map(g => {
                              const ids = g.rooms.map(r => r.id);
                              const allOn = ids.every(id => selected[id]);
                              const someOn = ids.some(id => selected[id]);
                              return (
                                <div key={g.key} className={`rounded-lg border p-3 ${someOn ? 'border-rose-300 bg-rose-50/40' : 'border-slate-200'}`}>
                                  <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                      <input type="checkbox" checked={allOn} onChange={e => toggleType(ids, e.target.checked)} className="w-4 h-4 accent-rose-600" />
                                      <span className="text-sm font-semibold text-slate-700">{g.name}</span>
                                      <span className="text-[11px] text-slate-400">{g.rooms.length} chambre{g.rooms.length > 1 ? 's' : ''}</span>
                                    </label>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[11px] text-slate-400">Tarif / nuit</span>
                                      <input type="number" min="0" step="1" value={tarifByType[g.key] || ''}
                                        onChange={e => setTarifByType(prev => ({ ...prev, [g.key]: e.target.value }))}
                                        placeholder="€" className="w-24 border rounded-lg px-2 h-8 text-sm bg-white" />
                                      <span className="text-[11px] text-slate-400">€</span>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                                    {g.rooms.map(c => {
                                      const on = !!selected[c.id];
                                      return (
                                        <label key={c.id}
                                          className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 cursor-pointer transition ${on ? 'border-rose-300 bg-white' : 'border-slate-200'}`}>
                                          <input type="checkbox" checked={on} onChange={() => toggleRoom(c.id)} className="w-4 h-4 accent-rose-600" />
                                          <span className="text-sm font-medium text-slate-700 truncate">{c.numero}</span>
                                          <span className="text-[10px] text-slate-400 truncate">{c.pax_max}p{c.twinable ? '·twin' : ''}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Personnalisation page invité */}
                <div className="grid md:grid-cols-2 gap-4">
                  <Field label="Photo de couverture (page invité)">
                    <div className="flex items-center gap-3">
                      {(coverFile || coverUrl) ? (
                        <div className="relative w-24 h-16">
                          <img src={coverFile ? URL.createObjectURL(coverFile) : coverUrl!} alt="" className="w-24 h-16 object-cover rounded-lg border" />
                          <button type="button"
                            onClick={() => { setCoverFile(null); setCoverUrl(null); if (coverInputRef.current) coverInputRef.current.value = ''; }}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center shadow" title="Retirer">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => coverInputRef.current?.click()}
                          className="w-24 h-16 rounded-lg border-2 border-dashed border-slate-300 text-slate-400 flex items-center justify-center hover:border-rose-400 hover:text-rose-500 transition" title="Ajouter une photo">
                          <ImagePlus className="w-5 h-5" />
                        </button>
                      )}
                      <input ref={coverInputRef} type="file" accept="image/*" className="hidden"
                        onChange={e => { setCoverFile(e.target.files?.[0] || null); e.target.value = ''; }} />
                    </div>
                  </Field>
                  <Field label="Mot d’accueil (page invité)">
                    <textarea value={messageAccueil} onChange={e => setMessageAccueil(e.target.value)} rows={2}
                      placeholder="Réservez votre chambre pour notre mariage…"
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white resize-y" />
                  </Field>
                </div>

                <Field label="Conditions d’annulation">
                  <textarea value={conditions} onChange={e => setConditions(e.target.value)} rows={2}
                    placeholder="Annulation gratuite jusqu’à 30 jours avant l’arrivée…"
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-white resize-y" />
                </Field>

                <div className="grid md:grid-cols-2 gap-4">
                  <Field label="Email organisateur">
                    <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="lea@exemple.fr"
                      className="w-full border rounded-lg px-3 h-11 text-sm bg-white" />
                  </Field>
                  <Field label="Notes internes (back-office)">
                    <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Privé — non visible des invités"
                      className="w-full border rounded-lg px-3 h-11 text-sm bg-white" />
                  </Field>
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none rounded-lg border border-slate-200 p-3">
                  <input type="checkbox" checked={planVisible} onChange={e => setPlanVisible(e.target.checked)} className="w-5 h-5 accent-rose-600" />
                  <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                    {planVisible ? <Eye className="w-4 h-4 text-rose-600" /> : <EyeOff className="w-4 h-4 text-slate-400" />}
                    Les invités voient qui a réservé quelle chambre (plan des chambres)
                  </span>
                </label>

                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-sm font-medium text-slate-700 mb-2">Paiement en ligne</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { k: 'immediat', t: 'Immédiat', d: 'Paiement à la réservation (30 min pour régler).' },
                      { k: 'differe', t: 'Programmé', d: 'Chambre tenue ; le lien de paiement part à une date choisie.' },
                      { k: 'optionnel', t: 'Sur place', d: 'Règlement à l\'hôtel ; le client peut aussi payer en ligne à l\'avance.' },
                      { k: 'aucun', t: 'Sans paiement', d: 'Engagement à la signature, aucun règlement en ligne.' },
                    ] as const).map(m => (
                      <button
                        key={m.k}
                        type="button"
                        onClick={() => setModePaiement(m.k)}
                        className={`text-left rounded-lg border p-2.5 transition ${
                          modePaiement === m.k
                            ? 'border-rose-500 bg-rose-50 ring-1 ring-rose-200'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
                        <span className={`block text-sm font-semibold ${modePaiement === m.k ? 'text-rose-700' : 'text-slate-700'}`}>{m.t}</span>
                        <span className="block text-[11px] text-slate-400 leading-tight mt-0.5">{m.d}</span>
                      </button>
                    ))}
                  </div>
                  {modePaiement === 'differe' && (
                    <label className="block mt-3">
                      <span className="text-xs font-medium text-slate-500">Date d'envoi du lien de paiement</span>
                      <input
                        type="date"
                        value={dateEnvoiPaiement}
                        onChange={e => setDateEnvoiPaiement(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-rose-400 focus:outline-none"
                      />
                      <span className="block text-[11px] text-slate-400 mt-1">Le client aura <strong>48h</strong> pour payer ; sans paiement, la chambre est relâchée automatiquement.</span>
                    </label>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={closeForm} className="h-11">Annuler</Button>
                  <Button type="submit" disabled={saving} className="flex-1 h-11">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" />
                      : editing ? <><Check className="w-4 h-4 mr-1" /> Mettre à jour</>
                      : <><Plus className="w-4 h-4 mr-1" /> Créer le bloc</>}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Détail / gestion d'un groupe (réservations, édition, suivi PMS)
// ============================================================================
function GroupDetail({ group, chambres, roomTypes, hotelName, onBack, onEdit, onDelete, onCopyLink, onChanged }: {
  group: Groupe; chambres: Chambre[]; roomTypes: RoomType[]; hotelName: (id: string) => string;
  onBack: () => void; onEdit: () => void; onDelete: () => void | Promise<void>; onCopyLink: () => void; onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [da, setDa] = useState(''); const [dd, setDd] = useState('');
  const [lit, setLit] = useState<'double' | 'twin'>('double'); const [pax, setPax] = useState(1);

  const gcById = useMemo(() => new Map((group.groupe_chambres || []).map(c => [c.id, c])), [group]);
  const chambreById = useCallback((id: string) => chambres.find(c => c.id === id), [chambres]);
  const roomTypeName = useCallback((id: string | null) => roomTypes.find(rt => rt.id === id)?.nom || '—', [roomTypes]);

  const resas = group.groupe_reservations || [];
  const confirmedByChambre = new Map<string, GroupeReservation>();
  for (const r of resas) if (r.statut === 'confirmee') confirmedByChambre.set(r.groupe_chambre_id, r);
  const cancelledTodo = resas.filter(r => r.statut === 'annulee' && !r.pms_done);

  function chInfo(gc: GroupeChambre) {
    const ch = chambreById(gc.chambre_id);
    return { numero: ch?.numero || '—', type: roomTypeName(ch?.room_type_id ?? null), pax_max: ch?.pax_max ?? 2, twinable: !!ch?.twinable };
  }

  const byHotel = useMemo(() => {
    const m = new Map<string, GroupeChambre[]>();
    for (const c of group.groupe_chambres || []) { if (!m.has(c.hotel_id)) m.set(c.hotel_id, []); m.get(c.hotel_id)!.push(c); }
    for (const arr of m.values()) arr.sort((a, b) => byNumero({ numero: chambreById(a.chambre_id)?.numero || '' }, { numero: chambreById(b.chambre_id)?.numero || '' }));
    return m;
  }, [group, chambreById]);
  const hotelsOrdered = [...byHotel.keys()].sort((a, b) => hotelName(a).localeCompare(hotelName(b)));

  async function togglePms(r: GroupeReservation, val: boolean) {
    setBusy(r.id);
    const { error } = await supabase.from('groupe_reservations').update(val ? { pms_done: true, vu_backoffice: true } : { pms_done: false }).eq('id', r.id);
    if (error) toast.error(error.message);
    await onChanged(); setBusy(null);
  }
  function startEdit(r: GroupeReservation) { setEditId(r.id); setDa(r.date_arrivee); setDd(r.date_depart); setLit(r.config_lit === 'twin' ? 'twin' : 'double'); setPax(r.nb_personnes || 1); }
  async function saveEdit(r: GroupeReservation, twinable: boolean, paxMax: number) {
    if (dd <= da) { toast.error('Le départ doit être après l’arrivée.'); return; }
    setBusy(r.id);
    const { error } = await supabase.from('groupe_reservations').update({
      date_arrivee: da, date_depart: dd, config_lit: twinable ? lit : r.config_lit, nb_personnes: Math.min(paxMax, Math.max(1, pax)), modified_at: new Date().toISOString(),
    }).eq('id', r.id);
    if (error) toast.error(error.message);
    setEditId(null); await onChanged(); setBusy(null);
  }
  async function cancelResa(r: GroupeReservation) {
    const info = chInfo(gcById.get(r.groupe_chambre_id)!);
    const ok = await confirmDialog({ title: 'Annuler cette réservation ?', message: `${r.prenom || ''} ${r.nom} — chambre ${info.numero}. À retirer ensuite du PMS.`, confirmLabel: 'Annuler la résa' });
    if (!ok) return;
    setBusy(r.id);
    const { error } = await supabase.from('groupe_reservations').update({ statut: 'annulee', annulee_at: new Date().toISOString(), pms_done: false, vu_backoffice: false, modified_at: new Date().toISOString() }).eq('id', r.id);
    if (error) toast.error(error.message);
    await onChanged(); setBusy(null);
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft className="w-4 h-4" /> Retour aux groupes</button>

      {/* En-tête groupe */}
      <Card>
        <CardContent className="p-5 flex items-start justify-between gap-3 flex-wrap">
          <div className="flex gap-3 min-w-0">
            {group.cover_image_url && <img src={group.cover_image_url} alt="" className="w-16 h-16 rounded-lg object-cover border shrink-0" />}
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-slate-800">{group.nom}</h2>
              <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" />{format(new Date(group.date_arrivee), 'dd/MM/yyyy', { locale: fr })} → {format(new Date(group.date_depart), 'dd/MM/yyyy', { locale: fr })}</span>
                <span>Limite : {format(new Date(group.date_limite), 'dd/MM/yyyy', { locale: fr })}</span>
                <span className="inline-flex items-center gap-1"><Hash className="w-3 h-3" />{group.code_acces}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onCopyLink} className="inline-flex items-center gap-1 text-xs px-2.5 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" title="Copier le lien invité"><Link2 className="w-3.5 h-3.5" /> Lien <Copy className="w-3 h-3" /></button>
            <a href={publicLink(group.code_acces)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs px-2.5 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Page invité <ExternalLink className="w-3 h-3" /></a>
            <button onClick={onEdit} className="text-slate-300 hover:text-rose-600 p-1.5" title="Modifier le groupe"><Pencil className="w-4 h-4" /></button>
            <button onClick={onDelete} className="text-slate-300 hover:text-rose-600 p-1.5" title="Supprimer le groupe"><Trash2 className="w-4 h-4" /></button>
          </div>
        </CardContent>
      </Card>

      {/* Sections par hôtel */}
      {hotelsOrdered.map(hid => (
        <Card key={hid}>
          <CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-3 inline-flex items-center gap-2"><Building2 className="w-4 h-4 text-slate-400" />{hotelName(hid)}</h3>
            <div className="space-y-2">
              {byHotel.get(hid)!.map(gc => {
                const info = chInfo(gc);
                const r = confirmedByChambre.get(gc.id);
                if (!r) {
                  return (
                    <div key={gc.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                      <span className="text-sm"><span className="font-semibold text-slate-700">{info.numero}</span> <span className="text-slate-400">· {info.type}</span></span>
                      <span className="text-[11px] font-medium text-emerald-600">Libre · {euro(Number(gc.tarif_nuit))}</span>
                    </div>
                  );
                }
                const editing = editId === r.id;
                const modifiedTag = !r.vu_backoffice ? (r.derniere_action === 'modification' ? { label: 'Modifiée', cls: 'bg-amber-50 text-amber-700 border-amber-200' } : { label: 'Nouveau', cls: 'bg-sky-50 text-sky-700 border-sky-200' }) : null;
                return (
                  <div key={gc.id} className={`rounded-lg border p-3 ${!r.pms_done ? 'border-rose-200 bg-rose-50/30' : 'border-slate-200'}`}>
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-800">{info.numero}</span>
                          <span className="text-xs text-slate-400">{info.type} · {euro(Number(gc.tarif_nuit))}</span>
                          {!r.pms_done && <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-rose-600 text-white">À traiter</span>}
                          {modifiedTag && <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${modifiedTag.cls}`}>{modifiedTag.label}</span>}
                        </div>
                        <div className="mt-1.5 text-sm text-slate-700 font-medium">{r.prenom || ''} {r.nom}</div>
                        <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-xs text-slate-500 mt-0.5">
                          {r.email && <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 hover:text-slate-700"><Mail className="w-3 h-3" />{r.email}</a>}
                          {r.tel && <a href={`tel:${r.tel}`} className="inline-flex items-center gap-1 hover:text-slate-700"><Phone className="w-3 h-3" />{r.tel}</a>}
                        </div>
                      </div>
                      <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 cursor-pointer shrink-0">
                        <input type="checkbox" checked={r.pms_done} disabled={busy === r.id} onChange={e => togglePms(r, e.target.checked)} className="w-4 h-4 accent-emerald-600" />
                        Traité PMS
                      </label>
                    </div>

                    {!editing ? (
                      <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-xs text-slate-500 inline-flex items-center gap-3 flex-wrap">
                          <span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" />{format(new Date(r.date_arrivee), 'dd/MM', { locale: fr })} → {format(new Date(r.date_depart), 'dd/MM', { locale: fr })}</span>
                          {info.twinable && <span className="inline-flex items-center gap-1"><BedDouble className="w-3 h-3" />{r.config_lit === 'twin' ? '2 lits' : '1 grand lit'}</span>}
                          <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />{r.nb_personnes}</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <button onClick={() => startEdit(r)} className="text-xs px-2.5 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1"><Pencil className="w-3.5 h-3.5" /> Modifier</button>
                          <button onClick={() => cancelResa(r)} disabled={busy === r.id} className="text-xs px-2.5 h-8 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 inline-flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Annuler</button>
                        </span>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block"><span className="text-[11px] text-slate-400">Arrivée</span><input type="date" value={da} min={group.date_arrivee} max={group.date_depart} onChange={e => setDa(e.target.value)} className="w-full border rounded-lg px-2 h-9 text-sm bg-white" /></label>
                          <label className="block"><span className="text-[11px] text-slate-400">Départ</span><input type="date" value={dd} min={group.date_arrivee} max={group.date_depart} onChange={e => setDd(e.target.value)} className="w-full border rounded-lg px-2 h-9 text-sm bg-white" /></label>
                        </div>
                        {info.twinable && (
                          <div className="grid grid-cols-2 gap-2">
                            {(['double', 'twin'] as const).map(opt => (
                              <button key={opt} type="button" onClick={() => setLit(opt)} className="h-9 rounded-lg border text-xs font-medium" style={lit === opt ? { borderColor: '#004e7c', background: 'rgba(0,78,124,.06)', color: '#004e7c' } : { borderColor: '#e2e8f0', color: '#64748b' }}>{opt === 'double' ? '1 grand lit' : '2 lits'}</button>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-400">Personnes (max {info.pax_max})</span>
                          <div className="inline-flex items-center rounded-lg border border-slate-200 overflow-hidden">
                            <button type="button" onClick={() => setPax(p => Math.max(1, p - 1))} className="w-8 h-9 text-slate-500">−</button>
                            <span className="w-8 text-center text-sm font-medium">{pax}</span>
                            <button type="button" onClick={() => setPax(p => Math.min(info.pax_max, p + 1))} className="w-8 h-9 text-slate-500">+</button>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setEditId(null)} className="h-9 px-3 rounded-lg border border-slate-200 text-slate-600 text-sm">Retour</button>
                          <button onClick={() => saveEdit(r, info.twinable, info.pax_max)} disabled={busy === r.id} className="flex-1 h-9 rounded-lg text-white text-sm font-medium inline-flex items-center justify-center gap-1" style={{ background: '#004e7c' }}>{busy === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" /> Enregistrer</>}</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Annulations à retirer du PMS */}
      {cancelledTodo.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold text-rose-700 mb-3 inline-flex items-center gap-2"><Trash2 className="w-4 h-4" /> Annulations à retirer du PMS</h3>
            <div className="space-y-2">
              {cancelledTodo.map(r => {
                const gc = gcById.get(r.groupe_chambre_id);
                const info = gc ? chInfo(gc) : { numero: '—', type: '', pax_max: 2, twinable: false };
                return (
                  <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50/30 px-3 py-2 flex-wrap">
                    <div className="min-w-0 text-sm">
                      <span className="font-semibold text-slate-800">{info.numero}</span>
                      <span className="text-xs text-slate-400"> · {gc ? hotelName(gc.hotel_id) : ''}</span>
                      <span className="text-slate-600"> — {r.prenom || ''} {r.nom}</span>
                      <span className="text-xs text-slate-400"> · {format(new Date(r.date_arrivee), 'dd/MM', { locale: fr })} → {format(new Date(r.date_depart), 'dd/MM', { locale: fr })}</span>
                    </div>
                    <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 cursor-pointer shrink-0">
                      <input type="checkbox" checked={r.pms_done} disabled={busy === r.id} onChange={e => togglePms(r, e.target.checked)} className="w-4 h-4 accent-emerald-600" />
                      Retirée du PMS
                    </label>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Onglet CHAMBRES & TYPES — config par hôtel
// ============================================================================
function ChambresTab({
  hotels, roomTypes, chambres, user, onChanged,
}: {
  hotels: Hotel[];
  roomTypes: RoomType[];
  chambres: Chambre[];
  user: { role?: string; hotel_id?: string | null; default_hotel_id?: string | null };
  onChanged: () => Promise<void>;
}) {
  const [selectedHotelId, setSelectedHotelId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedHotelId || hotels.length === 0) return;
    const pref = user.hotel_id || user.default_hotel_id;
    setSelectedHotelId(pref || hotels[0].id);
  }, [hotels, selectedHotelId, user]);

  const typesHotel = useMemo(
    () => roomTypes.filter(rt => rt.hotel_id === selectedHotelId).sort((a, b) => a.ordre - b.ordre),
    [roomTypes, selectedHotelId],
  );
  const chambresHotel = useMemo(
    () => chambres.filter(c => c.hotel_id === selectedHotelId).sort(byNumero),
    [chambres, selectedHotelId],
  );

  // --- Type form ---
  const [typeNom, setTypeNom] = useState('');
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);

  async function saveType(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedHotelId || !typeNom.trim()) return;
    if (editingTypeId) {
      const { error } = await supabase.from('room_types').update({ nom: typeNom.trim() }).eq('id', editingTypeId);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from('room_types').insert({ hotel_id: selectedHotelId, nom: typeNom.trim(), ordre: typesHotel.length });
      if (error) return toast.error(error.message);
    }
    setTypeNom(''); setEditingTypeId(null);
    await onChanged();
  }

  async function deleteType(rt: RoomType) {
    const ok = await confirmDialog({ title: 'Supprimer ce type ?', message: `"${rt.nom}" — les chambres liées passeront « Sans type ».`, confirmLabel: 'Supprimer' });
    if (!ok) return;
    const { error } = await supabase.from('room_types').delete().eq('id', rt.id);
    if (error) return toast.error(error.message);
    if (editingTypeId === rt.id) { setEditingTypeId(null); setTypeNom(''); }
    await onChanged();
  }

  // --- Chambre form ---
  const [editingChId, setEditingChId] = useState<string | null>(null);
  const [numero, setNumero] = useState('');
  const [roomTypeId, setRoomTypeId] = useState('');
  const [paxMax, setPaxMax] = useState('2');
  const [twinable, setTwinable] = useState(false);
  const [savingCh, setSavingCh] = useState(false);

  function resetCh() {
    setEditingChId(null); setNumero(''); setRoomTypeId(''); setPaxMax('2'); setTwinable(false);
  }
  function startEditCh(c: Chambre) {
    setEditingChId(c.id); setNumero(c.numero || ''); setRoomTypeId(c.room_type_id || ''); setPaxMax(String(c.pax_max ?? 2)); setTwinable(!!c.twinable);
  }

  async function saveCh(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedHotelId) return;
    if (!numero.trim()) return toast.error('Donne un numéro / nom à la chambre.');
    setSavingCh(true);
    const payload = {
      hotel_id: selectedHotelId,
      room_type_id: roomTypeId || null,
      numero: numero.trim(),
      pax_max: Math.max(1, parseInt(paxMax) || 1),
      twinable,
    };
    if (editingChId) {
      const { error } = await supabase.from('room_units').update(payload).eq('id', editingChId);
      setSavingCh(false);
      if (error) return toast.error(error.code === '23505' ? 'Ce numéro existe déjà pour cet hôtel.' : error.message);
      toast.success('Chambre modifiée');
    } else {
      const { error } = await supabase.from('room_units').insert({ ...payload, ordre: chambresHotel.length });
      setSavingCh(false);
      if (error) return toast.error(error.code === '23505' ? 'Ce numéro existe déjà pour cet hôtel.' : error.message);
      toast.success('Chambre ajoutée');
    }
    resetCh();
    await onChanged();
  }

  async function deleteCh(c: Chambre) {
    const ok = await confirmDialog({ title: 'Supprimer cette chambre ?', message: `"${c.numero}" — échouera si elle est utilisée dans un groupe.`, confirmLabel: 'Supprimer' });
    if (!ok) return;
    const { error } = await supabase.from('room_units').delete().eq('id', c.id);
    if (error) return toast.error('Suppression impossible (chambre utilisée par un groupe ?) : ' + error.message);
    if (editingChId === c.id) resetCh();
    await onChanged();
  }

  const typeNameById = useCallback((id: string | null) => roomTypes.find(rt => rt.id === id)?.nom || 'Sans type', [roomTypes]);

  return (
    <div className="space-y-6">
      {/* Sélecteur hôtel */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Configure tes types (libellés) et tes chambres physiques, par hôtel.</p>
        {hotels.length > 1 && (
          <select value={selectedHotelId || ''} onChange={e => setSelectedHotelId(e.target.value)} className="border rounded-lg px-3 h-10 text-sm bg-white">
            {hotels.map(h => <option key={h.id} value={h.id}>{h.nom}</option>)}
          </select>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Colonne gauche : types */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardContent className="p-5">
              <h2 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><Plus className="w-4 h-4" /> Types (libellés)</h2>
              <form onSubmit={saveType} className="flex gap-2 mb-3">
                <input value={typeNom} onChange={e => setTypeNom(e.target.value)} placeholder="Double, Suite…"
                  className="flex-1 border rounded-lg px-3 h-10 text-sm bg-white" />
                <Button type="submit" size="sm" className="h-10">{editingTypeId ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}</Button>
              </form>
              {typesHotel.length === 0 ? (
                <p className="text-sm text-slate-400">Aucun type. Ex : Double, Twin, Suite.</p>
              ) : (
                <ul className="space-y-1.5">
                  {typesHotel.map(rt => (
                    <li key={rt.id} className={`flex items-center justify-between rounded-lg border px-3 py-2 ${editingTypeId === rt.id ? 'border-rose-300 bg-rose-50/40' : 'border-slate-200'}`}>
                      <span className="text-sm font-medium text-slate-700">{rt.nom}</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => { setEditingTypeId(rt.id); setTypeNom(rt.nom); }} className="text-slate-300 hover:text-rose-600" title="Modifier"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => deleteType(rt)} className="text-slate-300 hover:text-rose-600" title="Supprimer"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Form chambre */}
          <Card className={editingChId ? 'ring-2 ring-rose-300' : ''}>
            <CardContent className="p-5">
              <h2 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                {editingChId ? <><Pencil className="w-4 h-4" /> Modifier la chambre</> : <><Plus className="w-4 h-4" /> Nouvelle chambre</>}
              </h2>
              <form onSubmit={saveCh} className="space-y-3">
                <Field label="Numéro / nom">
                  <input value={numero} onChange={e => setNumero(e.target.value)} placeholder="12, Suite Vue Mer…"
                    className="w-full border rounded-lg px-3 h-11 text-sm bg-white" />
                </Field>
                <Field label="Type">
                  <select value={roomTypeId} onChange={e => setRoomTypeId(e.target.value)} className="w-full border rounded-lg px-3 h-11 text-sm bg-white">
                    <option value="">— Sans type —</option>
                    {typesHotel.map(rt => <option key={rt.id} value={rt.id}>{rt.nom}</option>)}
                  </select>
                </Field>
                <Field label="Capacité max (pers.)">
                  <input type="number" min="1" inputMode="numeric" value={paxMax} onChange={e => setPaxMax(e.target.value)}
                    className="w-full border rounded-lg px-3 h-11 text-sm bg-white" />
                </Field>
                <label className="flex items-center gap-2 cursor-pointer select-none rounded-lg border border-slate-200 p-3">
                  <input type="checkbox" checked={twinable} onChange={e => setTwinable(e.target.checked)} className="w-5 h-5 accent-rose-600" />
                  <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5"><BedDouble className="w-4 h-4 text-rose-600" /> Twinable (2 lits)</span>
                </label>
                <div className="flex gap-2">
                  {editingChId && <Button type="button" variant="outline" onClick={resetCh} className="h-11">Annuler</Button>}
                  <Button type="submit" disabled={savingCh} className="flex-1 h-11">
                    {savingCh ? <Loader2 className="w-4 h-4 animate-spin" /> : editingChId ? <><Check className="w-4 h-4 mr-1" /> Mettre à jour</> : <><Plus className="w-4 h-4 mr-1" /> Ajouter</>}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Colonne droite : liste des chambres */}
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="p-5">
              <h2 className="font-semibold text-slate-800 mb-4">Chambres ({chambresHotel.length})</h2>
              {chambresHotel.length === 0 ? (
                <p className="text-sm text-slate-400">Aucune chambre pour cet hôtel. Ajoute-en à gauche.</p>
              ) : (
                <ul className="space-y-2">
                  {chambresHotel.map(c => (
                    <li key={c.id} className={`rounded-lg border p-3 flex items-center justify-between ${editingChId === c.id ? 'border-rose-300 bg-rose-50/40' : 'border-slate-200'} ${!c.active ? 'opacity-60' : ''}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-800">{c.numero}</span>
                        <span className="text-xs text-slate-500">· {typeNameById(c.room_type_id)} · {c.pax_max} pers.</span>
                        {c.twinable && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border bg-sky-50 text-sky-700 border-sky-200">
                            <BedDouble className="w-3 h-3" /> Twinable
                          </span>
                        )}
                        {!c.active && <span className="text-[11px] text-slate-400">(inactive)</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => startEditCh(c)} className="text-slate-300 hover:text-rose-600 transition" title="Modifier"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => deleteCh(c)} className="text-slate-300 hover:text-rose-600 transition" title="Supprimer"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500 mb-1 block">{label}</span>
      {children}
    </label>
  );
}
