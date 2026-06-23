'use client';

import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { confirmDialog } from '@/components/ConfirmDialog';
import { ThemedBackground } from '@/components/ThemedBackground';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import { useSelectedHotel } from '@/context/SelectedHotelContext';
import { format, isBefore, isToday, parseISO, getYear } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Search, PlusCircle, Clock,
  Trash2, Layout, XCircle, CalendarDays, ChevronDown,
  MessageSquareText, Wallet, Check,
  FileText, Copy, ScrollText, Users, ChefHat, Pencil, Plus, X, Loader2, CreditCard, Send, ExternalLink
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// --- TYPES ---
interface Hotel {
  id: string;
  nom: string;
}
interface Lead {
  id: string;
  created_at: string;
  nom_client: string;
  email?: string;
  telephone?: string;
  titre_demande: string;
  statut: 'Nouveau' | 'Devis envoyé' | 'Option' | 'Confirmé' | 'Refus';
  etat_paiement?: 'Attente acompte' | 'Acompte reçu' | 'RGT/P' | 'Soldé' | 'Facture envoyée' | 'Finalisé';
  budget_estime?: number;
  montant_devis?: number; // dérivé live des quote_items (non stocké en base)
  montant_paye?: number;
  date_relance?: string | null;
  date_evenement?: string | null;
  date_fin_evenement?: string | null;
  commentaires?: string;
  motif_perte?: string;
  updated_at?: string;
  updated_by?: string;
  hotel_id?: string;
  besoin_gaetan?: 'Pas besoin' | 'À valider' | 'Validé' | 'Pas dispo';
  source?: string;
  groupe_id?: string | null;
}

// Montant de référence d'un lead : le total devis s'il existe (réalité chiffrée),
// sinon le budget estimé manuel. Utilisé pour les KPI et le calcul débiteurs.
const effectiveAmount = (l: Lead) =>
  l.montant_devis && l.montant_devis > 0 ? l.montant_devis : (l.budget_estime || 0);

// --- CONSTANTES ---
const STATUS_COLORS: Record<string, string> = {
  'Nouveau':      'bg-blue-500',
  'Devis envoyé': 'bg-amber-400',
  'Option':       'bg-purple-500',
  'Confirmé':     'bg-emerald-500',
  'Refus':        'bg-red-500',
};

const STATUS_BG: Record<string, string> = {
  'Nouveau':      'bg-blue-50 text-blue-700 border-blue-200',
  'Devis envoyé': 'bg-amber-50 text-amber-700 border-amber-200',
  'Option':       'bg-purple-50 text-purple-700 border-purple-200',
  'Confirmé':     'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Refus':        'bg-red-50 text-red-600 border-red-200',
};

const PAYMENT_COLORS: Record<string, string> = {
  'Attente acompte': 'bg-red-500',
  'Acompte reçu':    'bg-amber-500',
  'RGT/P':           'bg-orange-400',
  'Soldé':           'bg-blue-400',
  'Facture envoyée': 'bg-purple-400',
  'Finalisé':        'bg-emerald-500',
};

const PAYMENT_BG: Record<string, string> = {
  'Attente acompte': 'bg-red-50 text-red-600 border-red-200',
  'Acompte reçu':    'bg-amber-50 text-amber-700 border-amber-200',
  'RGT/P':           'bg-orange-50 text-orange-600 border-orange-200',
  'Soldé':           'bg-blue-50 text-blue-600 border-blue-200',
  'Facture envoyée': 'bg-purple-50 text-purple-600 border-purple-200',
  'Finalisé':        'bg-emerald-50 text-emerald-700 border-emerald-200',
};

// --- NOTHING OS : COULEURS & PILLS ---
const NT_STATUS_COLOR: Record<string, string> = {
  'Nouveau':      '#3b82f6',
  'Devis envoyé': '#f59e0b',
  'Option':       '#8b5cf6',
  'Confirmé':     '#10b981',
  'Refus':        '#ef4444',
};

function CommentTooltip({ text }: { text: string }) {
  return (
    <div className="relative inline-flex shrink-0 group/tip" onClick={(e) => e.stopPropagation()}>
      <span className="inline-flex items-center justify-center rounded-md p-0.5 bg-amber-100 text-amber-600 border border-amber-200 hover:bg-amber-200 transition-colors cursor-help" title="Notes internes">
        <MessageSquareText className="w-3 h-3" />
      </span>

      {/* Bulle alignée à gauche de l'icône */}
      <div className="pointer-events-none absolute bottom-full left-0 mb-2.5 w-64 p-3.5 bg-white border border-gray-200 text-gray-700 text-[11px] leading-relaxed rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.08)] opacity-0 group-hover/tip:opacity-100 transition-all duration-200 z-[100] whitespace-pre-wrap">
        <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2 border-b border-gray-100 pb-1.5">
          Notes internes
        </div>
        {text}

        {/* Flèche vers le bas décalée sur la gauche */}
        <div className="absolute -bottom-[6px] left-2 w-3 h-3 bg-white border-b border-r border-gray-200 rotate-45" />
      </div>
    </div>
  );
}

const NT_STATUSES = ['Nouveau', 'Devis envoyé', 'Option', 'Confirmé', 'Refus'];

const GAETAN_COLOR: Record<string, string> = {
  'Pas besoin': '#94a3b8',
  'À valider':  '#f59e0b',
  'Validé':     '#10b981',
  'Pas dispo':  '#ef4444',
};
// Libellés sans ambiguïté pour Gaétan (le chef), pour ne pas confondre avec le statut du dossier.
const GAETAN_LABEL: Record<string, string> = {
  'Pas besoin': 'Chef ?',
  'À valider':  'Chef à valider',
  'Validé':     'Chef OK',
  'Pas dispo':  'Chef indispo',
};

// Pastille-menu réutilisable (dropdown custom stylé, pas de <select> natif).
// Change une valeur en 1 clic ; le menu se ferme via le clic global de la page.
function PillDropdown({ open, onToggle, onSelect, value, options, color, muted, icon, displayLabel, title }: {
  open: boolean;
  onToggle: () => void;
  onSelect: (v: string) => void;
  value: string;
  options: { value: string; label: string; color: string }[];
  color: string;
  muted?: boolean;
  icon?: React.ReactNode;
  displayLabel: string;
  title?: string;
}) {
  return (
    <div className="relative inline-flex shrink-0" onClick={e => e.stopPropagation()} title={title}>
      <button type="button" onClick={onToggle}
        className="inline-flex items-center gap-1 cursor-pointer text-[9px] font-black uppercase tracking-wider pl-2 pr-1.5 py-1 rounded-lg outline-none transition-colors"
        style={{ color: muted ? '#94a3b8' : color, border: `1px solid ${muted ? '#e5e7eb' : color + '33'}`, background: muted ? '#f8fafc' : color + '12' }}>
        {icon}
        <span className="truncate max-w-[92px]">{displayLabel}</span>
        <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[160px] rounded-xl bg-white border border-gray-200 shadow-[0_12px_40px_rgba(0,0,0,0.16)] p-1">
          {options.map(o => (
            <button key={o.value} type="button" onClick={() => onSelect(o.value)}
              className="w-full text-left px-2.5 py-2 rounded-lg text-[11px] font-bold flex items-center gap-2 hover:bg-gray-50 transition-colors"
              style={{ color: o.color }}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: o.color }} />
              <span className="flex-1">{o.label}</span>
              {o.value === value && <Check className="w-3 h-3 shrink-0 text-gray-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Onglet OFFRES & TARIFS — éditable par hôtel (admins), table commercial_tarifs
// ============================================================================
interface Tarif {
  id: string;
  hotel_id: string;
  section: 'salle' | 'resto';
  categorie: string;
  nom: string;
  detail: string | null;
  prix: string | null;
  ordre: number;
}
type TarifDraft = { id: string | null; section: 'salle' | 'resto'; categorie: string; nom: string; detail: string; prix: string };

const TARIF_ACCENT: Record<string, string> = {
  'Salles': '#0ea5e9',
  'Menus à table': '#1aaa5a',
  'Cocktails dinatoires': '#3b5bdb',
  'Self service': '#e67e00',
};
const RESTO_CATS = ['Menus à table', 'Cocktails dinatoires', 'Self service'];

const TARIF_DEFAULTS: Omit<TarifDraft, 'id'>[] = [
  { section: 'salle', categorie: 'Salles', nom: 'Telo Segreto',  detail: '57m² · 30/40 pers.', prix: '239 € / 359 €' },
  { section: 'salle', categorie: 'Salles', nom: 'Telo Maritimo', detail: '50m² · 30 pers.',    prix: '359 €' },
  { section: 'salle', categorie: 'Salles', nom: 'Telo Intimo',   detail: '18m² · 5 pers.',     prix: '80 € / 160 €' },
  { section: 'salle', categorie: 'Salles', nom: 'Patio Tropical', detail: '100m² · 60 pers.',  prix: 'Événementiel' },
  { section: 'resto', categorie: 'Menus à table', nom: 'Menu Starter',     detail: '2 temps · sans alcool',              prix: '29 €' },
  { section: 'resto', categorie: 'Menus à table', nom: 'Menu Confort',     detail: '3 temps · sans alcool',              prix: '41 €' },
  { section: 'resto', categorie: 'Menus à table', nom: 'Menu Privilège',   detail: '3 temps · cocktail signature',       prix: '50 €' },
  { section: 'resto', categorie: 'Menus à table', nom: 'Menu Privilège++', detail: '3 temps · cocktail · mises en bouche', prix: '55 €' },
  { section: 'resto', categorie: 'Cocktails dinatoires', nom: 'Cocktail starter',   detail: '5 salés · eaux / café',           prix: '29 €' },
  { section: 'resto', categorie: 'Cocktails dinatoires', nom: 'Cocktail starter++', detail: '5 salés · cocktail s.a.',         prix: '35 €' },
  { section: 'resto', categorie: 'Cocktails dinatoires', nom: 'Cocktail confort',   detail: '5 salés · 3 sucrés',              prix: '44 €' },
  { section: 'resto', categorie: 'Cocktails dinatoires', nom: 'Cocktail privilège', detail: '5 salés · 3 sucrés · animation',  prix: '50 €' },
  { section: 'resto', categorie: 'Cocktails dinatoires', nom: 'Cocktail prestige',  detail: '5 salés · 13 sucrés · animation', prix: '60 €' },
  { section: 'resto', categorie: 'Self service', nom: 'Self starter',       detail: '5 salés froids · eaux',         prix: '25 €' },
  { section: 'resto', categorie: 'Self service', nom: 'Self intermédiaire', detail: '5 salés · 2 sucrés',            prix: '30 €' },
  { section: 'resto', categorie: 'Self service', nom: 'Self ++',            detail: '5 salés · 2 sucrés · apéritif', prix: '35 €' },
];

function TarifsTab({ hotelId, isAdmin }: { hotelId: string; isAdmin: boolean }) {
  const [rows, setRows] = useState<Tarif[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TarifDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!hotelId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('commercial_tarifs').select('*')
      .eq('hotel_id', hotelId)
      .order('ordre');
    if (error) toast.error(error.message);
    setRows((data || []) as Tarif[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [hotelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!editing) return;
    if (!editing.nom.trim()) { toast.error('Indique un nom.'); return; }
    setSaving(true);
    const payload = { nom: editing.nom.trim(), detail: editing.detail.trim() || null, prix: editing.prix.trim() || null };
    if (editing.id) {
      const { error } = await supabase.from('commercial_tarifs').update(payload).eq('id', editing.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
    } else {
      const ordre = rows.filter(r => r.section === editing.section && r.categorie === editing.categorie).length;
      const { error } = await supabase.from('commercial_tarifs').insert({
        hotel_id: hotelId, section: editing.section, categorie: editing.categorie, ...payload, ordre,
      });
      if (error) { toast.error(error.message); setSaving(false); return; }
    }
    setSaving(false); setEditing(null); await load();
  };

  const remove = async (r: Tarif) => {
    const ok = await confirmDialog(`Supprimer « ${r.nom} » ?`);
    if (!ok) return;
    const { error } = await supabase.from('commercial_tarifs').delete().eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    await load();
  };

  const seedDefaults = async () => {
    const toInsert = TARIF_DEFAULTS.map((d, i) => ({ hotel_id: hotelId, section: d.section, categorie: d.categorie, nom: d.nom, detail: d.detail, prix: d.prix, ordre: i }));
    const { error } = await supabase.from('commercial_tarifs').insert(toInsert);
    if (error) { toast.error(error.message); return; }
    toast.success('Tarifs par défaut importés — à toi de les ajuster');
    await load();
  };

  const editForm = (accent: string) => (
    <div className="bg-white border-2 rounded-2xl p-3 space-y-2" style={{ borderColor: accent }}>
      <input autoFocus value={editing!.nom} onChange={e => setEditing({ ...editing!, nom: e.target.value })}
        placeholder="Nom" className="nt-input w-full h-9 rounded-lg px-3 text-sm font-bold border outline-none" />
      <input value={editing!.detail} onChange={e => setEditing({ ...editing!, detail: e.target.value })}
        placeholder="Détail (ex. 57m² · 30 pers.)" className="nt-input w-full h-9 rounded-lg px-3 text-sm border outline-none" />
      <input value={editing!.prix} onChange={e => setEditing({ ...editing!, prix: e.target.value })}
        placeholder="Prix (ex. 239 € / 359 €)" className="nt-input w-full h-9 rounded-lg px-3 text-sm border outline-none" />
      <div className="flex gap-2 justify-end pt-0.5">
        <button onClick={() => setEditing(null)} className="px-3 h-8 rounded-lg text-xs font-black text-gray-500 bg-gray-100 hover:bg-gray-200 transition">Annuler</button>
        <button onClick={save} disabled={saving} className="px-4 h-8 rounded-lg text-xs font-black text-white bg-[var(--brand)] hover:bg-[var(--brand-hover)] transition disabled:opacity-50 inline-flex items-center gap-1">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Enregistrer
        </button>
      </div>
    </div>
  );

  const adminCtl = (r: Tarif) => isAdmin && (
    <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button onClick={() => setEditing({ id: r.id, section: r.section, categorie: r.categorie, nom: r.nom, detail: r.detail || '', prix: r.prix || '' })}
        className="p-1 rounded-md bg-white border border-gray-200 text-gray-400 hover:text-[var(--brand)] shadow-sm" title="Modifier"><Pencil className="w-3.5 h-3.5" /></button>
      <button onClick={() => remove(r)}
        className="p-1 rounded-md bg-white border border-gray-200 text-gray-400 hover:text-red-500 shadow-sm" title="Supprimer"><X className="w-3.5 h-3.5" /></button>
    </div>
  );

  const addBtn = (section: 'salle' | 'resto', categorie: string) => isAdmin && (
    <button onClick={() => setEditing({ id: null, section, categorie, nom: '', detail: '', prix: '' })}
      className="w-full rounded-xl border border-dashed border-gray-300 text-gray-400 hover:border-[var(--brand)] hover:text-[var(--brand)] transition py-2.5 text-xs font-black inline-flex items-center justify-center gap-1">
      <Plus className="w-3.5 h-3.5" /> Ajouter
    </button>
  );

  if (loading) return <div className="py-20 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>;

  const salles = rows.filter(r => r.section === 'salle');
  const empty = rows.length === 0;

  return (
    <div className="space-y-8">
      {empty && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-500 mb-3">Aucun tarif renseigné pour cet hôtel.</p>
          {isAdmin
            ? <button onClick={seedDefaults} className="px-4 h-9 rounded-xl text-xs font-black text-white bg-[var(--brand)] hover:bg-[var(--brand-hover)] transition inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Importer les tarifs par défaut</button>
            : <p className="text-xs text-gray-400">Un administrateur doit renseigner les tarifs.</p>}
        </div>
      )}

      {/* Location Salles */}
      <section>
        <h2 className="text-[9px] font-black uppercase tracking-[0.25em] mb-5 flex items-center gap-3 text-gray-400">
          <CalendarDays className="w-4 h-4" /> Location Salles TTC
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {salles.map(r => (
            editing && editing.id === r.id
              ? <div key={r.id}>{editForm(TARIF_ACCENT['Salles'])}</div>
              : <div key={r.id} className="group relative bg-white border border-gray-200 rounded-2xl p-4 hover:shadow-sm transition">
                  <div className="font-black text-sm mb-1 text-gray-900 pr-12">{r.nom}</div>
                  <div className="text-[10px] mb-3 text-gray-400">{r.detail}</div>
                  <div className="font-bold text-sm" style={{ color: TARIF_ACCENT['Salles'] }}>{r.prix}</div>
                  {adminCtl(r)}
                </div>
          ))}
          {editing && editing.id === null && editing.section === 'salle' && <div>{editForm(TARIF_ACCENT['Salles'])}</div>}
        </div>
        {!(editing && editing.section === 'salle') && <div className="mt-3 max-w-xs">{addBtn('salle', 'Salles')}</div>}
      </section>

      {/* Restauration */}
      <section>
        <h2 className="text-[9px] font-black uppercase tracking-[0.25em] mb-5 flex items-center gap-3 text-gray-400">
          <MessageSquareText className="w-4 h-4" /> Restauration TTC — With Gaétan
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {RESTO_CATS.map(cat => {
            const accent = TARIF_ACCENT[cat];
            const items = rows.filter(r => r.section === 'resto' && r.categorie === cat);
            return (
              <div key={cat} className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] mb-3 px-1 text-gray-400">{cat}</p>
                {items.map(r => (
                  editing && editing.id === r.id
                    ? <div key={r.id}>{editForm(accent)}</div>
                    : <div key={r.id} className="group relative bg-white border border-gray-200 rounded-xl p-3 flex justify-between items-center hover:shadow-sm transition" style={{ borderLeft: `3px solid ${accent}66` }}>
                        <div className="overflow-hidden mr-3">
                          <div className="text-sm font-black truncate text-gray-900">{r.nom}</div>
                          <div className="text-[10px] truncate text-gray-400">{r.detail}</div>
                        </div>
                        <div className="font-bold text-sm whitespace-nowrap" style={{ color: accent }}>{r.prix}</div>
                        {adminCtl(r)}
                      </div>
                ))}
                {editing && editing.id === null && editing.section === 'resto' && editing.categorie === cat && <div>{editForm(accent)}</div>}
                {!(editing && editing.section === 'resto' && editing.categorie === cat) && addBtn('resto', cat)}
              </div>
            );
          })}
        </div>
      </section>

      {/* Dispositions & Capacités (image statique) */}
      <section className="bg-white border border-gray-200 p-6 rounded-2xl">
        <h2 className="text-[9px] font-black uppercase tracking-[0.25em] mb-4 flex items-center gap-3 text-gray-400">
          <Layout className="w-4 h-4" /> Dispositions & Capacités
        </h2>
        <div className="overflow-hidden rounded-xl border border-gray-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/disposition.png" alt="Capacités" className="w-full h-auto object-cover" />
        </div>
      </section>
    </div>
  );
}

// --- COMPOSANT PRINCIPAL ---
export default function CommercialDashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'superadmin' || user?.role === 'admin';

  // États
  const [hotels, setHotels] = useState<Hotel[]>([]);
  // Hôtel sélectionné = contexte global (synchro sidebar + autres pages).
  const { selectedHotelId } = useSelectedHotel();
  const [activeTab, setActiveTab] = useState<'pipeline' | 'tarifs' | 'planning'>('pipeline');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  // Compteur de réservations groupe nouvelles/modifiées non vues (bulle rouge sur le bouton Groupes).
  const [groupesUnread, setGroupesUnread] = useState(0);
  // Dropdown custom ouvert (clé `st-<id>` ou `ga-<id>`), null = aucun.
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [filterStatut, setFilterStatut] = useState<string>('Pipeline');
  const [clientSuggestions, setClientSuggestions] = useState<Lead[]>([]);
  const [planningData, setPlanningData] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [viewDate, setViewDate] = useState(new Date());
  const [currentLead, setCurrentLead] = useState<Partial<Lead>>({
    statut: 'Nouveau',
    etat_paiement: 'Attente acompte',
    budget_estime: 0,
    montant_paye: 0,
    date_relance: '',
    date_evenement: ''
  });
  const [currentReservations, setCurrentReservations] = useState<any[]>([]);
  const [quoteTotal, setQuoteTotal] = useState<number>(0);

  // --- HELPERS ---
  const getRelanceStatus = (dateStr?: string | null, statut?: string, etatPaiement?: string | null) => {
    if (['Gagné', 'Perdu', 'Refus'].includes(statut || '')) return 'done';
    if (statut === 'Confirmé' && etatPaiement === 'Soldé') return 'done';
    if (!dateStr) return 'none';
    const date = parseISO(dateStr);
    if (isBefore(date, new Date()) && !isToday(date)) return 'late';
    if (isToday(date)) return 'today';
    return 'future';
  };

  const getUpdateTrace = () => ({
    updated_at: new Date().toISOString(),
    updated_by: (user as any)?.name || 'Staff'
  });

  // --- FETCH ---
  const fetchLeads = async () => {
    if (!selectedHotelId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('suivi_commercial')
      .select('*, quotes(quote_items(quantity, unit_price_ttc))')
      .eq('hotel_id', selectedHotelId);
    if (!error && data) {
      // Total devis dérivé en live depuis les lignes (somme quantité × prix TTC),
      // sur tous les devis du lead. Pas de snapshot : toujours à jour.
      const withDevis = (data as any[]).map((l) => {
        const montant_devis = (l.quotes ?? []).reduce(
          (s: number, q: any) =>
            s + (q.quote_items ?? []).reduce(
              (t: number, it: any) => t + (it.quantity || 0) * (it.unit_price_ttc || 0), 0), 0);
        return { ...l, montant_devis };
      });
      setLeads(withDevis);

      // Bulle rouge : réservations à traiter sur les groupes de cet hôtel —
      // confirmées nouvelles/modifiées (non vues) + annulations pas encore
      // retirées du PMS. Même définition que le détail (exclut les expirées).
      const gids = withDevis.filter((l: any) => l.groupe_id).map((l: any) => l.groupe_id);
      if (gids.length) {
        const [c1, c2] = await Promise.all([
          supabase.from('groupe_reservations').select('id', { count: 'exact', head: true })
            .in('groupe_id', gids).eq('statut', 'confirmee').eq('vu_backoffice', false),
          supabase.from('groupe_reservations').select('id', { count: 'exact', head: true })
            .in('groupe_id', gids).eq('statut', 'annulee').eq('pms_done', false),
        ]);
        setGroupesUnread((c1.count || 0) + (c2.count || 0));
      } else {
        setGroupesUnread(0);
      }
    }
    setLoading(false);
  };

  const fetchPlanning = async () => {
    if (!selectedHotelId) return;
    const { data: roomsList } = await supabase
      .from('seminar_rooms')
      .select('*')
      .eq('hotel_id', selectedHotelId)
      .order('name');
    if (roomsList) setRooms(roomsList);

    const start = format(viewDate, 'yyyy-MM-dd');
    const end = format(new Date(viewDate.getTime() + 6 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
    // Fetch reservations that overlap the week: started before end AND ends after start
    const { data: events } = await supabase
      .from('view_planning_seminaires')
      .select('*')
      .eq('hotel_id', selectedHotelId)
      .lte('start_date', end)
      .gte('end_date', start);
    if (events) setPlanningData(events);
  };

  // --- EFFECTS ---
  // Onglet initial piloté par l'URL (?tab=) — sous-menu Commercial de la sidebar.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'pipeline' || t === 'planning' || t === 'tarifs') setActiveTab(t);
  }, []);

  useEffect(() => {
    const initHotels = async () => {
      const { data, error } = await supabase.from('hotels').select('id, nom').order('nom');
      if (!error && data) {
        setHotels(data);
        // Le défaut (hôtel attribué de l'user) est résolu par SelectedHotelContext
        // — on ne pose plus de fallback list[0] ici (il faisait retomber tout le
        // monde sur Les Voiles à chaque refresh).
      }
    };
    initHotels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedHotelId) {
      // La persistance du choix est gérée par SelectedHotelContext.
      fetchLeads();
      fetchPlanning();
    }
  }, [selectedHotelId, viewDate]);

  useEffect(() => {
    const hotelName = hotels.find(h => h.id === selectedHotelId)?.nom;
    const suffix = hotelName ? ` — ${hotelName}` : '';
    document.title = `Commercial${suffix}`;
  }, [selectedHotelId, hotels]);

  // Modal dédié aux dossiers "groupe" (mariages)
  const [groupeLead, setGroupeLead] = useState<Lead | null>(null);

  // Lien de paiement rattaché à un dossier (modale dédiée)
  const [payFor, setPayFor] = useState<Lead | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payEmail, setPayEmail] = useState('');
  const [payDesc, setPayDesc] = useState('');
  const [paySending, setPaySending] = useState(false);
  const [payLink, setPayLink] = useState<string | null>(null);

  const sendPaymentLink = async () => {
    if (!payFor) return;
    const amt = parseFloat(payAmount.replace(',', '.'));
    if (!amt || amt <= 0) { toast.error('Indique un montant.'); return; }
    const mail = payEmail.trim();
    setPaySending(true);
    setPayLink(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/paiements/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({
          hotelId: selectedHotelId, amount: amt, description: payDesc.trim(),
          email: mail, clientNom: payFor.nom_client || '',
          leadId: payFor.id, sendEmail: !!mail,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erreur');
      setPayLink(json.url);
      if (mail && json.emailed) toast.success('Demande de paiement envoyée par email');
      else if (mail && !json.emailed) toast.error('Lien créé, mais email NON envoyé : ' + (json.emailError || 'raison inconnue'), { duration: 8000 });
      else toast.success('Lien de paiement créé');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setPaySending(false);
    }
  };

  // --- MODAL ---
  const openLeadModal = async (lead?: Partial<Lead>, defaultDate?: string, defaultRoomName?: string) => {
    if (lead && (lead as Lead).groupe_id) { setGroupeLead(lead as Lead); return; } // dossier groupe → modal dédié
    if (lead && lead.id) {
      setCurrentLead(lead);
      const { data } = await supabase.from('seminar_reservations').select('*').eq('lead_id', lead.id);
      if (data) setCurrentReservations(data);
      // Récupérer le total TTC du devis lié
      const { data: quoteData } = await supabase
        .from('quotes')
        .select('quote_items(quantity, unit_price_ttc)')
        .eq('lead_id', lead.id)
        .maybeSingle();
      if (quoteData?.quote_items) {
        const ttc = (quoteData.quote_items as any[]).reduce((acc, item) => acc + (item.quantity || 0) * (item.unit_price_ttc || 0), 0);
        setQuoteTotal(ttc);
      } else {
        setQuoteTotal(0);
      }
    } else {
      setCurrentLead({ statut: 'Nouveau', etat_paiement: 'Attente acompte', budget_estime: 0, montant_paye: 0, date_relance: '', date_evenement: defaultDate || '', date_fin_evenement: defaultDate || '' });
      setQuoteTotal(0);
      if (defaultRoomName) {
        const room = rooms.find(r => r.name === defaultRoomName);
        if (room) {
          setCurrentReservations([{ room_id: room.id, start_date: defaultDate, end_date: defaultDate, start_time: '09:00', end_time: '18:00' }]);
        } else {
          setCurrentReservations([]);
        }
      } else {
        setCurrentReservations([]);
      }
    }
    setShowModal(true);
  };

  // --- HANDLERS ---
  const handleClientSearch = (input: string) => {
    setCurrentLead({ ...currentLead, nom_client: input });
    if (input.length > 2) {
      const matches = leads.filter(l => l.nom_client.toLowerCase().includes(input.toLowerCase()));
      const uniqueMatches = matches.filter((v, i, a) => a.findIndex(t => t.nom_client === v.nom_client) === i);
      setClientSuggestions(uniqueMatches);
    } else {
      setClientSuggestions([]);
    }
  };

  const handleUpdateMotif = async (id: string, motif: string) => {
    const trace = getUpdateTrace();
    setLeads(prev => prev.map(l => l.id === id ? { ...l, motif_perte: motif, ...trace } : l));
    await supabase.from('suivi_commercial').update({ motif_perte: motif, ...trace }).eq('id', id);
  };

  const handleGaetanChange = async (id: string, value: string) => {
    const trace = getUpdateTrace();
    setLeads(prev => prev.map(l => l.id === id ? { ...l, besoin_gaetan: value as any, ...trace } : l));
    await supabase.from('suivi_commercial').update({ besoin_gaetan: value, ...trace }).eq('id', id);
  };

  // Changement d'étape depuis la pastille de statut (mise à jour optimiste).
  const handleStatusChange = async (id: string, value: string) => {
    const trace = getUpdateTrace();
    setLeads(prev => prev.map(l => l.id === id ? { ...l, statut: value as Lead['statut'], ...trace } : l));
    await supabase.from('suivi_commercial').update({ statut: value, ...trace }).eq('id', id);
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!currentLead.nom_client || !currentLead.titre_demande) { toast.error('Nom et Titre obligatoires'); return; }
    setIsSaving(true);
    const trace = getUpdateTrace();
    // Retirer les champs dérivés (non stockés en base) avant l'écriture Supabase.
    const { montant_devis: _md, quotes: _q, ...leadClean } = currentLead as Record<string, unknown>;
    const payload = {
      ...leadClean,
      hotel_id: selectedHotelId,
      date_relance: currentLead.date_relance === '' ? null : currentLead.date_relance,
      date_evenement: currentLead.date_evenement === '' ? null : currentLead.date_evenement,
      date_fin_evenement: (currentLead.date_fin_evenement === '' || !currentLead.date_fin_evenement) ? (currentLead.date_evenement === '' ? null : currentLead.date_evenement) : currentLead.date_fin_evenement,
      ...trace
    };
    let leadId = currentLead.id;
    if (leadId) {
      const { error } = await supabase.from('suivi_commercial').update(payload).eq('id', leadId);
      if (error) { toast.error(error.message); return; }
    } else {
      const { data, error } = await supabase.from('suivi_commercial').insert([{ ...payload, created_at: new Date().toISOString() }]).select().single();
      if (error) { toast.error(error.message); return; }
      leadId = data.id;
    }
    if (leadId) {
      await supabase.from('seminar_reservations').delete().eq('lead_id', leadId);
      if (currentReservations.length > 0) {
        const resasToInsert = currentReservations.map(r => ({
          lead_id: leadId,
          room_id: r.room_id,
          start_date: r.start_date || currentLead.date_evenement,
          end_date: r.end_date || r.start_date || currentLead.date_evenement,
          start_time: r.start_time || null,
          end_time: r.end_time || null,
          status: currentLead.statut === 'Confirmé' ? 'reserved' : 'option'
        }));
        await supabase.from('seminar_reservations').insert(resasToInsert);
      }
    }
    setIsSaving(false);
    setShowModal(false);
    fetchLeads();
    fetchPlanning();
    return leadId; // permet d'enchaîner sur la création d'un bloc de chambres
  };

  const handleDelete = async (id: string) => {
    if (!(await confirmDialog('Supprimer ce dossier ?'))) return;
    // Supprimer les dépendances d'abord
    const { data: quotes } = await supabase.from('quotes').select('id').eq('lead_id', id);
    if (quotes?.length) {
      await supabase.from('quote_items').delete().in('quote_id', quotes.map(q => q.id));
      await supabase.from('quotes').delete().eq('lead_id', id);
    }
    await supabase.from('seminar_reservations').delete().eq('lead_id', id);
    const { error } = await supabase.from('suivi_commercial').delete().eq('id', id);
    if (error) { toast.error(`Erreur suppression : ${error.message}`); return; }
    setLeads(prev => prev.filter(l => l.id !== id));
  };

  const handleDuplicate = async (lead: Lead) => {
    const trace = getUpdateTrace();
    const { data: newLead, error } = await supabase
      .from('suivi_commercial')
      .insert([{
        hotel_id: lead.hotel_id,
        nom_client: lead.nom_client,
        email: lead.email,
        telephone: lead.telephone,
        titre_demande: lead.titre_demande,
        commentaires: lead.commentaires,
        budget_estime: lead.budget_estime,
        statut: 'Nouveau',
        etat_paiement: 'Attente acompte',
        montant_paye: 0,
        date_evenement: null,
        date_relance: null,
        created_at: new Date().toISOString(),
        ...trace
      }])
      .select()
      .single();
    if (error || !newLead) { toast.error('Erreur lors de la duplication'); return; }

    // Copier le devis (lignes) si il existe
    const { data: existingQuote } = await supabase
      .from('quotes')
      .select('*, quote_items(*)')
      .eq('lead_id', lead.id)
      .maybeSingle();

    if (existingQuote?.quote_items?.length) {
      const { data: newQuote } = await supabase
        .from('quotes')
        .insert([{
          hotel_id: lead.hotel_id,
          lead_id: newLead.id,
          comment: existingQuote.comment,
          status: 'draft',
          cancellation_terms: existingQuote.cancellation_terms,
        }])
        .select()
        .single();

      if (newQuote) {
        const items = existingQuote.quote_items.map((i: any, index: number) => ({
          quote_id: newQuote.id,
          label: i.label,
          description: i.description || null,
          quantity: i.quantity,
          unit_price_ttc: i.unit_price_ttc,
          tva_rate: i.tva_rate,
          sort_order: index,
        }));
        await supabase.from('quote_items').insert(items);
      }
    }

    await fetchLeads();
    openLeadModal(newLead);
  };

  const handleGlobalClick = () => {
    setOpenDropdown(null);
  };

  // --- COMPUTED ---
  const sortedLeads = useMemo(() => {
    const filtered = leads.filter(l => {
      const matchSearch = (
        l.nom_client.toLowerCase().includes(searchTerm.toLowerCase()) ||
        l.titre_demande.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (l.email && l.email.toLowerCase().includes(searchTerm.toLowerCase()))
      );
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const eventDate = l.date_evenement ? new Date(l.date_evenement).getTime() : Infinity;
      const isPast = eventDate < now.getTime();
      let matchFilter = false;
      if (filterStatut === 'Tous') matchFilter = true;
      else if (filterStatut === 'Pipeline') matchFilter = ['Nouveau', 'Devis envoyé', 'Option'].includes(l.statut);
      else if (filterStatut === 'Confirmé') matchFilter = l.statut === 'Confirmé' && !isPast;
      else if (filterStatut === 'Terminées') matchFilter = isPast;
      else if (filterStatut === 'Refus') matchFilter = l.statut === 'Refus';
      else if (filterStatut === 'Débiteurs') {
        const budget = effectiveAmount(l);
        const paye = l.montant_paye || 0;
        matchFilter = isPast && l.statut !== 'Refus' && (budget - paye > 0);
      }
      return matchSearch && matchFilter;
    });

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    return filtered.sort((a, b) => {
      const timeA = a.date_evenement ? new Date(a.date_evenement).getTime() : Infinity;
      const timeB = b.date_evenement ? new Date(b.date_evenement).getTime() : Infinity;
      const isPastA = timeA < now.getTime();
      const isPastB = timeB < now.getTime();
      if (isPastA && !isPastB) return 1;
      if (!isPastA && isPastB) return -1;
      if (timeA !== timeB) return isPastA ? timeB - timeA : timeA - timeB;
      const dateA = a.updated_at ? new Date(a.updated_at).getTime() : new Date(a.created_at).getTime();
      const dateB = b.updated_at ? new Date(b.updated_at).getTime() : new Date(b.created_at).getTime();
      return dateB - dateA;
    });
  }, [leads, searchTerm, filterStatut]);

  const stats = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const pipeline = leads.filter(l => !['Confirmé', 'Refus'].includes(l.statut)).reduce((acc, curr) => acc + effectiveAmount(curr), 0);
    const won = leads.filter(l => l.statut === 'Confirmé' && getYear(parseISO(l.created_at)) === currentYear).reduce((acc, curr) => acc + effectiveAmount(curr), 0);
    const lost = leads.filter(l => l.statut === 'Refus' && getYear(parseISO(l.created_at)) === currentYear).reduce((acc, curr) => acc + effectiveAmount(curr), 0);
    const lateCount = leads.filter(l => getRelanceStatus(l.date_relance, l.statut, l.etat_paiement) === 'late').length;
    const todayCount = leads.filter(l => getRelanceStatus(l.date_relance, l.statut, l.etat_paiement) === 'today').length;
    return { pipeline, won, lost, lateCount, todayCount };
  }, [leads]);

  // Dossiers urgents pour la colonne À traiter
  const urgentLeads = leads
    .filter(l => ['late', 'today'].includes(getRelanceStatus(l.date_relance, l.statut, l.etat_paiement)))
    .sort((a, b) => {
      const ra = getRelanceStatus(a.date_relance, a.statut, a.etat_paiement);
      const rb = getRelanceStatus(b.date_relance, b.statut, b.etat_paiement);
      if (ra === 'late' && rb !== 'late') return -1;
      if (ra !== 'late' && rb === 'late') return 1;
      return 0;
    });

  // --- RENDER ---
  return (
    <>
      <style>{`
        /* .dm : ancienne police mono « Notion » neutralisée — on hérite de la police de l'app (charte). */
        .dm { font-family: inherit; letter-spacing: 0.01em; font-variant-numeric: tabular-nums; }
        .nt-card { background: #ffffff; border: 1px solid #ececec; }
        .nt-card:hover { border-color: #d0d0d0; box-shadow: 0 4px 24px rgba(0,0,0,0.06); }
        .nt-input { background: #f7f7f7 !important; border-color: #e8e8e8 !important; color: #111 !important; }
        .nt-input::placeholder { color: #bbb !important; }
        .nt-input:focus { border-color: #aaa !important; box-shadow: none !important; background: #fff !important; }
        .nt-select { background: #f7f7f7; border: 1px solid #e8e8e8; color: #111; border-radius: 10px; }
        .nt-select option { background: #fff; }
        .accent-red   { color: #e53935; }
        .accent-amber { color: #e67e00; }
        .accent-green { color: #1aaa5a; }
        .sep-line { background: #f0f0f0; }
      `}</style>

      <div className="min-h-screen p-4 md:p-8 font-sans" style={{color: '#111'}} onClick={handleGlobalClick}>
        <ThemedBackground />

        {/* ═══════════════════════════════════════
            HEADER
        ═══════════════════════════════════════ */}
        <div className="mb-8">

          {/* Ligne haute */}
          <div className="flex items-start justify-between mb-6 flex-wrap gap-6">

            {/* KPIs dot matrix */}
            {activeTab === 'pipeline' && (
              <div className="flex items-end gap-8 flex-wrap">

                {stats.lateCount > 0 && (
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] mb-1" style={{color: '#aaa'}}>En retard</p>
                    <p className="text-4xl font-black leading-none accent-red">{String(stats.lateCount).padStart(2,'0')}</p>
                  </div>
                )}
                {stats.todayCount > 0 && (
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] mb-1" style={{color: '#aaa'}}>Aujourd'hui</p>
                    <p className="text-4xl font-black leading-none accent-amber">{String(stats.todayCount).padStart(2,'0')}</p>
                  </div>
                )}

                {(stats.lateCount > 0 || stats.todayCount > 0) && (
                  <div className="self-stretch w-px sep-line" />
                )}

                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] mb-1" style={{color: '#aaa'}}>Pipeline</p>
                  <p className="text-2xl font-black leading-none" style={{color: '#555'}}>{stats.pipeline.toLocaleString()}<span className="text-base ml-1" style={{color: '#bbb'}}>€</span></p>
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] mb-1" style={{color: '#aaa'}}>Gagné</p>
                  <p className="text-2xl font-black leading-none accent-green">+{stats.won.toLocaleString()}<span className="text-base ml-1" style={{color: '#1aaa5a80'}}>€</span></p>
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] mb-1" style={{color: '#aaa'}}>Perdu</p>
                  <p className="text-2xl font-black leading-none" style={{color: '#e5393580'}}>−{stats.lost.toLocaleString()}<span className="text-base ml-1" style={{color: '#e5393540'}}>€</span></p>
                </div>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-0 border-b border-gray-200">
            {['pipeline', 'planning', 'tarifs'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className="pb-3 pr-8 text-sm font-black transition-all whitespace-nowrap border-b-2 -mb-px tracking-wide"
                style={{
                  color: activeTab === tab ? 'var(--brand)' : '#bbb',
                  borderBottomColor: activeTab === tab ? 'var(--brand)' : 'transparent',
                }}
              >
                {tab === 'pipeline' ? 'Suivi Commercial' : tab === 'planning' ? 'Planning Salles' : 'Offres & Tarifs'}
              </button>
            ))}
            <a
              href="/groupes"
              className="ml-auto mb-2 relative inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wide px-3 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
              title="Groupes & mariages — récap des blocs"
            >
              👥 Groupes →
              {groupesUnread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center shadow ring-2 ring-white">
                  {groupesUnread}
                </span>
              )}
            </a>
          </div>
        </div>


        {/* ═══════════════════════════════════════
            1. PLANNING
        ═══════════════════════════════════════ */}
        {activeTab === 'planning' && (() => {
          // Couleurs par statut
          const PLANNING_STYLE: Record<string, {bg:string,border:string,color:string,badge:string}> = {
            'Confirmé':     { bg:'#ecfdf5', border:'#6ee7b7', color:'#065f46', badge:'#10b981' },
            'Option':       { bg:'#fffbeb', border:'#fcd34d', color:'#92400e', badge:'#f59e0b' },
            'Devis envoyé': { bg:'#eff6ff', border:'#93c5fd', color:'#1e40af', badge:'#3b82f6' },
            'Nouveau':      { bg:'#f5f3ff', border:'#c4b5fd', color:'#4c1d95', badge:'#8b5cf6' },
            'Gagné':        { bg:'#f0fdf4', border:'#86efac', color:'#14532d', badge:'#22c55e' },
          };
          const getPStyle = (s: string) => PLANNING_STYLE[s] ?? {bg:'#f9fafb',border:'#e5e7eb',color:'#6b7280',badge:'#9ca3af'};

          // 7 jours de la semaine
          const WEEK = [...Array(7)].map((_,i) => {
            const d = new Date(viewDate.getTime() + i * 24*60*60*1000);
            return { d, str: format(d,'yyyy-MM-dd'), tod: isToday(d) };
          });

          // Numéro de semaine ISO
          const weekNum = (() => {
            const d = new Date(viewDate); d.setHours(0,0,0,0);
            d.setDate(d.getDate() + 3 - (d.getDay()+6)%7);
            const w1 = new Date(d.getFullYear(),0,4);
            return 1 + Math.round(((d.getTime()-w1.getTime())/86400000 - 3 + (w1.getDay()+6)%7)/7);
          })();

          const COLS = '160px repeat(7, minmax(130px, 1fr))';

          return (
            <div className="rounded-2xl overflow-hidden mb-10 bg-white" style={{border:'1px solid #e8e8e8'}}>

              {/* ── Header ── */}
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <div>
                  <h2 className="text-sm font-black uppercase tracking-[0.15em]" style={{color:'#111'}}>
                    Planning & Disponibilités
                    <span className="ml-3 text-[10px] font-bold px-2 py-0.5 rounded-md bg-gray-100 text-gray-400 tracking-widest">S{weekNum}</span>
                  </h2>
                  <p className="dm text-[11px] mt-1" style={{color:'#aaa'}}>
                    {format(viewDate,'MMMM yyyy',{locale:fr}).toUpperCase()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input type="date" value={format(viewDate,'yyyy-MM-dd')} onChange={(e)=>setViewDate(new Date(e.target.value))} className="nt-select px-3 py-2 text-[11px] font-black outline-none cursor-pointer" />
                  <div className="flex gap-1 p-1 rounded-xl bg-gray-100 border border-gray-200">
                    <Button variant="ghost" size="sm" onClick={()=>setViewDate(new Date(viewDate.getTime()-7*24*60*60*1000))} className="h-8 w-8 p-0 hover:bg-white text-gray-400 hover:text-gray-900">
                      <ChevronDown className="w-4 h-4 rotate-90" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={()=>setViewDate(new Date())} className="h-8 text-[10px] font-black uppercase px-3 hover:bg-white text-gray-400 hover:text-gray-900 tracking-wider">
                      Auj.
                    </Button>
                    <Button variant="ghost" size="sm" onClick={()=>setViewDate(new Date(viewDate.getTime()+7*24*60*60*1000))} className="h-8 w-8 p-0 hover:bg-white text-gray-400 hover:text-gray-900">
                      <ChevronDown className="w-4 h-4 -rotate-90" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* ── Grid ── */}
              <div className="overflow-x-auto">
                <div style={{minWidth:'1070px'}}>

                  {/* En-têtes jours */}
                  <div className="border-b border-gray-100" style={{display:'grid',gridTemplateColumns:COLS}}>
                    <div className="p-4 border-r border-gray-100 sticky left-0 bg-white z-20 text-[9px] font-black uppercase tracking-widest text-gray-300 flex items-end pb-4">Salles</div>
                    {WEEK.map(({d,str,tod})=>(
                      <div key={str} className="p-4 text-center border-r border-gray-100 last:border-r-0"
                        style={{background:tod?'#f0f4ff':'transparent'}}>
                        <div className="text-[9px] font-black uppercase tracking-widest mb-1" style={{color:tod?'#3b5bdb':'#bbb'}}>{format(d,'EEE',{locale:fr})}</div>
                        <div className="dm text-xl font-bold" style={{color:tod?'#3b5bdb':'#888'}}>{format(d,'dd')}</div>
                        {tod && <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mx-auto mt-1" />}
                      </div>
                    ))}
                  </div>

                  {/* Ligne — Tous les événements */}
                  {(() => {
                    const weekLeads = leads.filter(l =>
                      l.date_evenement &&
                      l.statut !== 'Refus' &&
                      l.date_evenement <= WEEK[6].str &&
                      (l.date_fin_evenement || l.date_evenement) >= WEEK[0].str
                    );
                    if (weekLeads.length === 0) return null;
                    const slots: {row:number;si:number;ei:number}[] = [];
                    let maxRow = 0;
                    const eventsWithRows = weekLeads.map(l => {
                      const endDate = l.date_fin_evenement || l.date_evenement!;
                      const clL = l.date_evenement! < WEEK[0].str;
                      const clR = endDate > WEEK[6].str;
                      const si = clL ? 0 : WEEK.findIndex(w => w.str === l.date_evenement);
                      const ei = clR ? 6 : WEEK.findIndex(w => w.str === endDate);
                      const siSafe = si < 0 ? 0 : si;
                      const eiSafe = ei < 0 ? 6 : ei;
                      let row = 1;
                      while (slots.some(s => s.row === row && s.si <= eiSafe && s.ei >= siSafe)) row++;
                      slots.push({row, si: siSafe, ei: eiSafe});
                      if (row > maxRow) maxRow = row;
                      return {l, si: siSafe, ei: eiSafe, clL, clR, row};
                    });
                    return (
                      <div className="border-b-2 border-gray-200 group" style={{display:'grid',gridTemplateColumns:COLS,minHeight:'52px',background:'#fafafa'}}>
                        <div className="p-4 border-r border-gray-200 sticky left-0 z-10 flex flex-col justify-center" style={{background:'#fafafa'}}>
                          <span className="text-[9px] font-black uppercase tracking-widest" style={{color:'#aaa'}}>Tous</span>
                        </div>
                        <div style={{gridColumn:'span 7',position:'relative',display:'grid',gridTemplateColumns:'repeat(7,1fr)',gridAutoRows:'auto',gap:0}}>
                          <div style={{position:'absolute',inset:0,display:'grid',gridTemplateColumns:'repeat(7,1fr)',pointerEvents:'none',zIndex:0}}>
                            {WEEK.map(({str,tod},ci)=>(
                              <div key={str} style={{background:tod?'#f8f9ff':'transparent',borderRight:ci<6?'1px solid #f3f4f6':'none'}} />
                            ))}
                          </div>
                          {eventsWithRows.map(({l,si,ei,clL,clR,row})=>{
                            const st = getPStyle(l.statut);
                            return (
                              <div key={l.id}
                                onClick={()=>openLeadModal(l)}
                                style={{
                                  gridColumn:`${si+1} / ${ei+2}`,
                                  gridRow:row,
                                  position:'relative',
                                  zIndex:2,
                                  margin:`4px ${clR?0:4}px 4px ${clL?0:4}px`,
                                  background:st.badge,
                                  color:'#fff',
                                  borderRadius:`${clL?3:9}px ${clR?3:9}px ${clR?3:9}px ${clL?3:9}px`,
                                  cursor:'pointer',
                                }}
                                className="flex flex-col items-center justify-center text-center px-2.5 py-1.5 text-[10px] font-bold leading-tight transition-all hover:brightness-110 shadow-sm">
                                <div className="flex items-center justify-center gap-1.5 w-full">
                                  {clL && <span className="text-[9px] opacity-70 shrink-0">←</span>}
                                  <span className="font-black truncate">{l.nom_client}</span>
                                  {clR && <span className="text-[9px] opacity-70 shrink-0">→</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Lignes salles */}
                  {rooms.map(room=>{
                    const roomEvents = planningData.filter(r=>
                      r.room_name === room.name &&
                      r.start_date <= WEEK[6].str &&
                      (r.end_date ?? r.start_date) >= WEEK[0].str
                    );

                    return (
                      <div key={room.id} className="border-b border-gray-100 last:border-b-0 group"
                        style={{display:'grid',gridTemplateColumns:COLS,minHeight:'88px'}}>

                        {/* Label salle — sticky */}
                        <div className="p-4 border-r border-gray-100 sticky left-0 bg-white z-10 flex flex-col justify-center">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{backgroundColor:room.color||'#ccc'}} />
                            <span className="text-xs font-black truncate" style={{color:'#555'}}>{room.name}</span>
                          </div>
                          <div className="text-[9px] mt-0.5 font-bold tracking-wider" style={{color:'#bbb'}}>{room.capacity}p · {room.surface}m²</div>
                        </div>

                        {/* Zone 7 jours — CSS grid pur */}
                        <div style={{
                          gridColumn:'span 7',
                          position:'relative',
                          display:'grid',
                          gridTemplateColumns:'repeat(7,1fr)',
                          gridAutoRows:'auto',
                          gap:0,
                        }}>

                          {/* Fond : séparateurs colonnes + highlight aujourd'hui — pointer-events:none */}
                          <div style={{position:'absolute',inset:0,display:'grid',gridTemplateColumns:'repeat(7,1fr)',pointerEvents:'none',zIndex:0}}>
                            {WEEK.map(({str,tod},ci)=>(
                              <div key={str} style={{
                                background:tod?'#f8f9ff':'transparent',
                                borderRight:ci<6?'1px solid #f3f4f6':'none',
                              }} />
                            ))}
                          </div>

                          {/* Événements — placement anti-chevauchement */}
                          {(()=>{
                            // Calcul des lignes pour éviter les superpositions
                            const slots: {row:number;si:number;ei:number}[] = [];
                            let maxRow = 0;
                            const eventsWithRows = roomEvents.map(res=>{
                              const endDate = res.end_date ?? res.start_date;
                              const clL = res.start_date < WEEK[0].str;
                              const clR = endDate > WEEK[6].str;
                              const si = clL ? 0 : WEEK.findIndex(w=>w.str===res.start_date);
                              const ei = clR ? 6 : WEEK.findIndex(w=>w.str===endDate);
                              let row = 1;
                              while (slots.some(s=>s.row===row && s.si<=ei && s.ei>=si)) row++;
                              slots.push({row,si,ei});
                              if (row > maxRow) maxRow = row;
                              return {res,si,ei,clL,clR,row};
                            });
                            return <>
                              {eventsWithRows.map(({res,si,ei,clL,clR,row})=>{
                                const st = getPStyle(res.display_status);
                                return (
                                  <div key={res.reservation_id}
                                    onClick={()=>{ const id = res.reference_id; if(id) window.open(`/devis?leadId=${id}`,'_blank'); }}
                                    style={{
                                      gridColumn:`${si+1} / ${ei+2}`,
                                      gridRow:row,
                                      position:'relative',
                                      zIndex:2,
                                      margin:`5px ${clR?0:4}px 5px ${clL?0:4}px`,
                                      background:st.badge,
                                      color:'#fff',
                                      borderRadius:`${clL?3:9}px ${clR?3:9}px ${clR?3:9}px ${clL?3:9}px`,
                                      cursor:'pointer',
                                    }}
                                    className="flex flex-col items-center justify-center text-center px-2.5 py-1.5 text-[10px] font-bold leading-tight transition-all hover:brightness-110 shadow-sm">
                                    {(clL || clR) && (
                                      <div className="flex items-center justify-center gap-1.5 mb-0.5 opacity-80">
                                        {clL && <span className="text-[9px]">←</span>}
                                        {clR && <span className="text-[9px]">→</span>}
                                      </div>
                                    )}
                                    <div className="font-black truncate w-full">{res.nom_client}</div>
                                    <div className="truncate w-full opacity-80 italic text-[9px]">{res.titre_demande||'—'}</div>
                                    {(res.start_time||res.end_time) && (
                                      <div className="text-[9px] mt-1 opacity-80 font-semibold">{res.start_time?.substring(0,5)} – {res.end_time?.substring(0,5)}</div>
                                    )}
                                  </div>
                                );
                              })}
                              {/* Boutons + par jour libre — en dessous de tous les événements */}
                              {WEEK.map(({str},ci)=>{
                                const busy = roomEvents.some(r=>r.start_date<=str&&(r.end_date??r.start_date)>=str);
                                return (
                                  <button key={str}
                                    onClick={(e)=>{e.stopPropagation();openLeadModal(undefined,str,room.name);}}
                                    style={{gridColumn:ci+1,gridRow:maxRow+1,zIndex:1,margin:'0 3px 4px 3px'}}
                                    className={`h-8 flex items-center justify-center transition-opacity rounded-xl border border-dashed border-gray-200 hover:bg-gray-50 hover:border-gray-300 ${busy?'opacity-0 pointer-events-none':'opacity-0 group-hover:opacity-100'}`}>
                                    <PlusCircle className="w-3.5 h-3.5 text-gray-300" />
                                  </button>
                                );
                              })}
                            </>;
                          })()}

                        </div>
                      </div>
                    );
                  })}

                </div>
              </div>
            </div>
          );
        })()}

{/* ═══════════════════════════════════════
            2. PIPELINE
        ═══════════════════════════════════════ */}
        {activeTab === 'pipeline' && (
          <>
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
              <div className="flex gap-px p-1 rounded-xl bg-white border border-gray-200 shadow-sm">
                {['Pipeline', 'Confirmé', 'Terminées', 'Débiteurs', 'Refus', 'Tous'].map(st => (
                  <button key={st} onClick={(e) => { e.stopPropagation(); setFilterStatut(st); }}
                    className="px-3.5 py-1.5 rounded-lg text-[11px] font-black transition-all whitespace-nowrap tracking-wide"
                    style={{
                      background: filterStatut === st ? (st === 'Débiteurs' ? '#e53935' : 'var(--brand)') : 'transparent',
                      color: filterStatut === st ? '#fff' : '#999',
                    }}
                  >
                    {st}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 items-center">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-gray-300" />
                  <input placeholder="Rechercher..." className="nt-input pl-9 text-sm h-9 w-52 rounded-xl outline-none border" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
                <button onClick={(e) => { e.stopPropagation(); openLeadModal(); }}
                  className="flex items-center gap-1.5 px-5 h-9 rounded-xl text-xs font-black tracking-wide transition-all text-white bg-[var(--brand)] hover:bg-[var(--brand-hover)]">
                  <PlusCircle className="h-3.5 w-3.5" /> Nouveau
                </button>
              </div>
            </div>

            {loading ? (
              <div className="text-center py-24 dm text-[11px] tracking-[0.4em] uppercase text-gray-300">Chargement…</div>
            ) : (() => {
              const sp = searchTerm.toLowerCase();
              const matchSearch = (l: Lead) =>
                l.nom_client.toLowerCase().includes(sp) ||
                l.titre_demande.toLowerCase().includes(sp) ||
                (!!l.email && l.email.toLowerCase().includes(sp));

              // date | client+objet | Gaétan | relance | étape | montant | actions
              const GRID = '44px minmax(0,1fr) 122px 104px 134px 110px 152px';

              const renderRow = (lead: Lead) => {
                const rs = getRelanceStatus(lead.date_relance, lead.statut, lead.etat_paiement);
                const isUrgent = rs === 'late' || rs === 'today';
                const montant = effectiveAmount(lead);
                const reste = Math.max(0, montant - (lead.montant_paye || 0));
                const isDebtor = reste > 0 && lead.statut === 'Confirmé';
                const accent = lead.groupe_id ? '#6366f1' : (NT_STATUS_COLOR[lead.statut] || '#888');
                const stColor = NT_STATUS_COLOR[lead.statut] || '#888';
                const gv = lead.besoin_gaetan || 'Pas besoin';
                const gMuted = gv === 'Pas besoin';
                const gPill = gv === 'Pas besoin' ? 'Chef' : gv === 'Pas dispo' ? 'Indispo' : gv;
                return (
                  <div key={lead.id} onClick={() => openLeadModal(lead)}
                    className="group grid items-center gap-x-3 cursor-pointer border-b border-gray-200 hover:bg-gray-50/70 transition-colors"
                    style={{ gridTemplateColumns: GRID, borderLeft: `3px solid ${accent}` }}>

                    {/* Date */}
                    <div className="flex flex-col items-center justify-center text-center py-2.5 pl-2">
                      {lead.date_evenement ? (
                        <>
                          <span className="dm text-[8px] font-bold uppercase tracking-widest text-gray-400 leading-none">{format(parseISO(lead.date_evenement), 'MMM', { locale: fr })}</span>
                          <span className="dm font-bold leading-none" style={{ fontSize: '19px', color: '#111' }}>{format(parseISO(lead.date_evenement), 'dd')}</span>
                          <span className="dm text-[8px] font-bold text-gray-300 leading-none">{format(parseISO(lead.date_evenement), 'yy')}</span>
                        </>
                      ) : <span className="dm text-base text-gray-200">—</span>}
                    </div>

                    {/* Client + objet */}
                    <div className="min-w-0 py-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-black text-[13.5px] tracking-tight text-gray-900 truncate">{lead.nom_client}</span>
                        {lead.groupe_id && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-600 border border-indigo-200 shrink-0">👥</span>}
                        {lead.source === 'Site web' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-500 border border-blue-100 shrink-0">🌐</span>}
                        {lead.commentaires?.trim() && <CommentTooltip text={lead.commentaires} />}
                      </div>
                      <p className="text-[11px] text-gray-400 truncate mt-0.5">{lead.titre_demande}</p>
                    </div>

                    {/* Gaétan (chef) */}
                    <div className="flex justify-start">
                      <PillDropdown
                        open={openDropdown === `ga-${lead.id}`}
                        onToggle={() => setOpenDropdown(openDropdown === `ga-${lead.id}` ? null : `ga-${lead.id}`)}
                        onSelect={(v) => { setOpenDropdown(null); handleGaetanChange(lead.id, v); }}
                        value={gv}
                        options={['Pas besoin', 'À valider', 'Validé', 'Pas dispo'].map(s => ({ value: s, label: GAETAN_LABEL[s], color: GAETAN_COLOR[s] }))}
                        color={GAETAN_COLOR[gv]}
                        muted={gMuted}
                        displayLabel={gPill}
                        title="Besoin du chef Gaétan"
                        icon={<ChefHat className="w-3 h-3 shrink-0" />}
                      />
                    </div>

                    {/* Relance */}
                    <div className="min-w-0">
                      {lead.date_relance && (
                        <span className="dm text-[10px] font-bold inline-flex items-center gap-1 whitespace-nowrap"
                          style={{ color: isUrgent ? (rs === 'late' ? '#e53935' : '#e67e00') : '#94a3b8' }}>
                          <Clock className="w-3 h-3 shrink-0" /> {format(parseISO(lead.date_relance), 'dd MMM', { locale: fr }).toUpperCase()}
                        </span>
                      )}
                    </div>

                    {/* Étape */}
                    <div className="flex justify-start">
                      <PillDropdown
                        open={openDropdown === `st-${lead.id}`}
                        onToggle={() => setOpenDropdown(openDropdown === `st-${lead.id}` ? null : `st-${lead.id}`)}
                        onSelect={(v) => { setOpenDropdown(null); handleStatusChange(lead.id, v); }}
                        value={lead.statut}
                        options={NT_STATUSES.map(s => ({ value: s, label: s, color: NT_STATUS_COLOR[s] || '#888' }))}
                        color={stColor}
                        displayLabel={lead.statut}
                        title="Changer l'étape"
                        icon={<span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: stColor }} />}
                      />
                    </div>

                    {/* Montant + solde */}
                    <div className="text-right">
                      <div className="dm text-[13px] font-bold text-gray-800 tabular-nums whitespace-nowrap">{montant > 0 ? `${montant.toLocaleString()} €` : '—'}</div>
                      {isDebtor && <div className="dm text-[10px] font-bold whitespace-nowrap" style={{ color: '#e53935' }} title="Solde dû">− {reste.toLocaleString()} €</div>}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-1 pr-2">
                      <button onClick={e => { e.stopPropagation(); window.open(`/devis?leadId=${lead.id}`, '_blank'); }} title="Devis"
                        className="px-2 py-1 rounded-lg text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-600 hover:text-white transition-all">Devis</button>
                      <button onClick={e => { e.stopPropagation(); window.open(`/fiche?leadId=${lead.id}`, '_blank'); }} title="Fiche de fonctions"
                        className="px-2 py-1 rounded-lg text-[10px] font-black bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-600 hover:text-white transition-all">Fiche</button>
                      <button onClick={e => { e.stopPropagation(); handleDuplicate(lead); }} title="Dupliquer"
                        className="p-1 rounded-lg text-slate-300 hover:bg-indigo-50 hover:text-indigo-500 transition-all opacity-0 group-hover:opacity-100"><Copy className="w-3.5 h-3.5" /></button>
                      <button onClick={e => { e.stopPropagation(); handleDelete(lead.id); }} title="Supprimer"
                        className="p-1 rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                );
              };

              const monthSep = (label: string, key: string) => (
                <div key={key} className="flex items-center gap-3 px-2 pt-5 pb-1.5">
                  <span className="dm text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">{label}</span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
              );

              const renderGrouped = (list: Lead[]) => list.map((lead, i, arr) => {
                const cm = lead.date_evenement ? format(parseISO(lead.date_evenement), 'MMMM yyyy', { locale: fr }) : null;
                const pm = i > 0 && arr[i - 1].date_evenement ? format(parseISO(arr[i - 1].date_evenement!), 'MMMM yyyy', { locale: fr }) : null;
                const showSep = cm && cm !== pm;
                return (
                  <div key={lead.id}>
                    {showSep && monthSep(cm!, 'sep-' + lead.id)}
                    {renderRow(lead)}
                  </div>
                );
              });

              const emptyBox = (icon: React.ReactNode, label: string, action?: React.ReactNode) => (
                <div className="flex flex-col items-center justify-center rounded-2xl py-12 gap-3 bg-white border border-dashed border-gray-200">
                  {icon}
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] text-gray-300">{label}</p>
                  {action}
                </div>
              );

              if (filterStatut === 'Pipeline') {
                const urgent = urgentLeads.filter(matchSearch);
                const urgentIds = new Set(urgentLeads.map(l => l.id));
                const upcoming = sortedLeads.filter(l => !urgentIds.has(l.id));
                return (
                  <div className="pb-24 max-w-7xl">
                    {/* À TRAITER */}
                    <div className="flex items-baseline gap-2 mb-2.5">
                      <span className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">À traiter</span>
                      {urgent.length > 0
                        ? <span className="dm text-sm font-bold accent-red">{urgent.length}</span>
                        : <span className="text-[9px] font-black tracking-wider accent-green ml-1">✓ À jour</span>}
                    </div>
                    {urgent.length === 0
                      ? emptyBox(<Check className="w-5 h-5 text-emerald-400" />, 'Rien à traiter')
                      : <div className="border-t border-gray-200">{urgent.map(renderRow)}</div>}

                    {/* À VENIR */}
                    <div className="flex items-baseline justify-between mt-9 mb-2.5">
                      <span className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">À venir</span>
                      <span className="dm text-[11px] font-bold text-gray-300">{String(upcoming.length).padStart(2, '0')}</span>
                    </div>
                    {upcoming.length === 0
                      ? emptyBox(<PlusCircle className="w-5 h-5 text-gray-300" />, 'Aucun dossier à venir')
                      : <div className="border-t border-gray-200">{renderGrouped(upcoming)}</div>}
                  </div>
                );
              }

              // Vues lookup / archive (Confirmé · Terminées · Débiteurs · Refus · Tous)
              return (
                <div className="pb-24 max-w-7xl">
                  <div className="flex items-baseline justify-between mb-2.5">
                    <span className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">{filterStatut}</span>
                    <span className="dm text-[11px] font-bold text-gray-300">{String(sortedLeads.length).padStart(2, '0')}</span>
                  </div>
                  {sortedLeads.length === 0
                    ? emptyBox(<PlusCircle className="w-5 h-5 text-gray-300" />, 'Aucun dossier',
                        <button onClick={() => openLeadModal()} className="text-[10px] font-black underline underline-offset-2 text-gray-400 hover:text-gray-900 transition-colors">Créer un dossier</button>)
                    : <div className="border-t border-gray-200">{renderGrouped(sortedLeads)}</div>}
                </div>
              );
            })()}
          </>
        )}


        {/* ═══════════════════════════════════════
            3. TARIFS
        ═══════════════════════════════════════ */}
        {activeTab === 'tarifs' && (
          <TarifsTab hotelId={selectedHotelId} isAdmin={isAdmin} />
        )}


        {/* ═══════════════════════════════════════
            MODAL
        ═══════════════════════════════════════ */}
        {showModal && (
          <div className="fixed inset-0 flex items-center justify-center z-[100] p-4 sm:p-6" style={{background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)'}} onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
            <div className="w-full max-w-2xl flex flex-col max-h-[90vh] rounded-2xl overflow-hidden bg-white" style={{border: '1px solid #e8e8e8', boxShadow: '0 24px 80px rgba(0,0,0,0.12)'}}>

              <div className="flex justify-between items-center p-5 shrink-0 border-b border-gray-100">
                <h2 className="text-base font-black tracking-tight text-gray-900">
                  {currentLead.id ? 'Modifier le dossier' : 'Nouveau dossier'}
                </h2>
                <button onClick={() => setShowModal(false)} className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
                  <XCircle className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              <div className="overflow-y-auto p-5 space-y-7">

                {/* 1. Client */}
                <div className="space-y-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">01 · Client & Contacts</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="relative md:col-span-2">
                      <input placeholder="Client / Société" value={currentLead.nom_client || ''} onChange={e => handleClientSearch(e.target.value)} className="nt-input w-full h-10 rounded-xl px-4 font-black border outline-none" />
                      {clientSuggestions.length > 0 && (
                        <div className="absolute top-full left-0 w-full bg-white rounded-xl shadow-xl z-[60] mt-1 py-1 max-h-48 overflow-y-auto border border-gray-100">
                          {clientSuggestions.map(s => (
                            <button key={s.id} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex flex-col transition-colors"
                              onClick={() => { setCurrentLead({ ...currentLead, nom_client: s.nom_client, email: s.email, telephone: s.telephone }); setClientSuggestions([]); }}>
                              <span className="font-black text-gray-900">{s.nom_client}</span>
                              <span className="text-[10px] text-gray-400">{s.email || "Pas d'email"}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <input placeholder="Email" value={currentLead.email || ''} onChange={e => setCurrentLead({...currentLead, email: e.target.value})} className="nt-input h-10 rounded-xl px-4 border outline-none" />
                    <input placeholder="Téléphone" value={currentLead.telephone || ''} onChange={e => setCurrentLead({...currentLead, telephone: e.target.value})} className="nt-input h-10 rounded-xl px-4 border outline-none" />
                  </div>
                </div>

                {/* 2. Événement */}
                <div className="space-y-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">02 · L'événement</p>
                  <input placeholder="Titre de l'événement" value={currentLead.titre_demande || ''} onChange={e => setCurrentLead({...currentLead, titre_demande: e.target.value})} className="nt-input w-full h-10 rounded-xl px-4 border outline-none" />
                  <div className="flex flex-wrap gap-2">
                    {["Location de salle sèche", "Journée d'étude", "Event", "Mariage", "Soirée cocktail", "Location de chambres"].map(tag => (
                      <button key={tag} type="button"
                        onClick={() => { const c = currentLead.titre_demande || ''; if (!c.includes(tag)) setCurrentLead({ ...currentLead, titre_demande: c ? `${c} + ${tag}` : tag }); }}
                        className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all text-gray-400 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 border border-gray-100">
                        + {tag}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest mb-2 text-gray-400">Date début</label>
                      <input type="date" value={currentLead.date_evenement || ''} onChange={e => {
                        const val = e.target.value;
                        const update: Partial<Lead> = { date_evenement: val };
                        if (!currentLead.date_fin_evenement || currentLead.date_fin_evenement < val) update.date_fin_evenement = val;
                        setCurrentLead({...currentLead, ...update});
                      }} className="nt-input w-full h-10 rounded-xl px-4 border outline-none" />
                    </div>
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest mb-2 text-gray-400">Date fin</label>
                      <input type="date" value={currentLead.date_fin_evenement || currentLead.date_evenement || ''} min={currentLead.date_evenement || undefined} onChange={e => setCurrentLead({...currentLead, date_fin_evenement: e.target.value})} className="nt-input w-full h-10 rounded-xl px-4 border outline-none" />
                    </div>
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest mb-2" style={{color: '#e67e00'}}>Prochaine Relance</label>
                      <input type="date" value={currentLead.date_relance || ''} onChange={e => setCurrentLead({...currentLead, date_relance: e.target.value})} className="nt-input w-full h-10 rounded-xl px-4 border outline-none" />
                    </div>
                  </div>
                </div>

                {/* 3. Salles */}
                <div className="space-y-3 p-4 rounded-2xl bg-gray-50 border border-gray-100">
                  <div className="flex justify-between items-center">
                    <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">Planning Salles</p>
                    <button type="button" onClick={() => setCurrentReservations([...currentReservations, { room_id: rooms[0]?.id, start_date: currentLead.date_evenement || '', start_time: '09:00', end_time: '18:00' }])}
                      className="text-[10px] font-black text-gray-400 hover:text-gray-900 transition-colors">
                      + Ajouter une salle
                    </button>
                  </div>
                  {currentReservations.length === 0 && <p className="text-center text-[11px] py-2 text-gray-300">Aucune salle sélectionnée</p>}
                  {currentReservations.map((resa, index) => (
                    <div key={index} className="flex gap-2 items-center p-2.5 rounded-xl bg-white border border-gray-100">
                      <select value={resa.room_id} onChange={(e) => { const newR = [...currentReservations]; newR[index].room_id = e.target.value; setCurrentReservations(newR); }} className="nt-select flex-1 text-xs font-bold p-1 rounded-lg outline-none">
                        {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                      <input type="date" value={resa.start_date} onChange={(e) => { const newR = [...currentReservations]; newR[index].start_date = e.target.value; setCurrentReservations(newR); }} className="nt-input w-32 h-8 rounded-lg px-2 text-[11px] font-bold border outline-none" />
                      <input type="time" value={resa.start_time} onChange={(e) => { const newR = [...currentReservations]; newR[index].start_time = e.target.value; setCurrentReservations(newR); }} className="nt-input w-24 h-8 rounded-lg px-2 text-[11px] font-bold border outline-none" />
                      <span className="text-gray-300 font-bold">–</span>
                      <input type="time" value={resa.end_time} onChange={(e) => { const newR = [...currentReservations]; newR[index].end_time = e.target.value; setCurrentReservations(newR); }} className="nt-input w-24 h-8 rounded-lg px-2 text-[11px] font-bold border outline-none" />
                      <button type="button" onClick={() => setCurrentReservations(currentReservations.filter((_, i) => i !== index))} className="p-2 rounded-lg hover:bg-red-50 transition-colors">
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* 4. Commercial & Finance */}
                <div className="space-y-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">03 · Commercial & Finance</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest mb-2 text-gray-400">Statut</label>
                      <select className="nt-select w-full rounded-xl px-3 py-2 text-sm font-bold h-10 outline-none" value={currentLead.statut || 'Nouveau'} onChange={e => setCurrentLead({...currentLead, statut: e.target.value as any})}>
                        <option>Nouveau</option><option>Devis envoyé</option><option>Option</option><option>Confirmé</option><option>Refus</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest mb-2 text-gray-400">Total à payer (€)</label>
                      <div className="nt-input w-full h-10 rounded-xl px-4 font-bold border flex items-center bg-gray-50 text-gray-700">
                        {quoteTotal > 0 ? quoteTotal.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : <span className="text-gray-300 font-normal text-sm">Aucun devis</span>}
                        {quoteTotal > 0 && <span className="ml-1 text-gray-400 font-normal">€</span>}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest mb-2 text-gray-400">Budget estimé (€)</label>
                      <input type="number" placeholder="0" className="nt-input w-full h-10 rounded-xl px-4 font-bold border outline-none" value={currentLead.budget_estime || ''} onChange={e => setCurrentLead({...currentLead, budget_estime: parseFloat(e.target.value) || 0})} />
                    </div>
                  </div>
                  <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100 space-y-3">
                    <div className="flex justify-between items-center">
                      <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">Suivi Paiement</p>
                      {quoteTotal > 0 && (
                        <span className="dm text-[11px] font-bold" style={{color: quoteTotal-(currentLead.montant_paye||0) <= 0 ? '#1aaa5a' : '#e53935'}}>
                          Reste : {Math.max(0, quoteTotal-(currentLead.montant_paye||0)).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[9px] font-black uppercase tracking-widest mb-2 text-gray-400">État Facture</label>
                        <select className="nt-select w-full rounded-xl px-3 py-2 text-sm font-medium h-10 outline-none" value={currentLead.etat_paiement || 'Attente acompte'} onChange={e => setCurrentLead({...currentLead, etat_paiement: e.target.value as any})}>
                          <option>Attente acompte</option><option>Acompte reçu</option><option>RGT/P</option><option>Soldé</option><option>Facture envoyée</option><option>Finalisé</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[9px] font-black uppercase tracking-widest mb-2 text-gray-400">Déjà réglé (€)</label>
                        <input type="number" placeholder="0" className="nt-input w-full h-10 rounded-xl px-4 font-bold border outline-none" value={currentLead.montant_paye || ''} onChange={e => setCurrentLead({...currentLead, montant_paye: parseFloat(e.target.value)})} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 5. Notes */}
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">04 · Notes Internes</p>
                  <textarea
                    className="nt-input w-full rounded-xl p-4 text-sm min-h-[90px] max-h-[340px] overflow-y-auto resize-none border outline-none leading-relaxed"
                    placeholder="Notes, spécificités, infos importantes..."
                    ref={el => { if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 340) + 'px'; } }}
                    onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 340) + 'px'; }}
                    value={currentLead.commentaires || ''} onChange={e => setCurrentLead({...currentLead, commentaires: e.target.value})} />
                </div>
              </div>

              <div className="p-5 flex justify-end gap-3 shrink-0 border-t border-gray-100 bg-gray-50">
                {currentLead.id && (
                  <div className="mr-auto flex gap-2">
                    {!currentLead.groupe_id && (
                      <button
                        onClick={async () => {
                          // Onglet ouvert dans le geste utilisateur (anti pop-up blocker),
                          // puis enregistrement du dossier avant de pré-remplir le bloc.
                          const w = window.open('', '_blank');
                          const id = await handleSave();
                          if (id && w) w.location.href = `/groupes?new=${id}`;
                          else if (w) w.close();
                        }}
                        disabled={isSaving}
                        className="px-4 h-10 rounded-xl text-sm font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-all inline-flex items-center gap-1.5 disabled:opacity-50"
                        title="Enregistre le dossier puis crée un bloc de chambres (groupe / mariage) rattaché"
                      >
                        <Users className="w-4 h-4" /> Créer le bloc de chambres
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => {
                          const l = currentLead as Lead;
                          const solde = Math.max(0, effectiveAmount(l) - (l.montant_paye || 0));
                          setPayFor(l);
                          setPayAmount(solde > 0 ? String(Math.round(solde * 100) / 100) : '');
                          setPayEmail(l.email || '');
                          setPayDesc(l.titre_demande || '');
                          setPayLink(null);
                        }}
                        className="px-4 h-10 rounded-xl text-sm font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all inline-flex items-center gap-1.5"
                        title="Envoyer une demande de paiement (solde pré-rempli) au client de ce dossier"
                      >
                        <CreditCard className="w-4 h-4" /> Lien de paiement
                      </button>
                    )}
                  </div>
                )}
                <button onClick={() => setShowModal(false)} className="px-5 h-10 rounded-xl text-sm font-black text-gray-500 hover:text-gray-900 bg-white border border-gray-200 transition-all">
                  Annuler
                </button>
                <button onClick={handleSave} disabled={isSaving} className="px-8 h-10 rounded-xl text-sm font-black text-white bg-[var(--brand)] hover:bg-[var(--brand-hover)] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                  {isSaving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal dédié GROUPE */}
        {groupeLead && (
          <div className="fixed inset-0 flex items-center justify-center z-[100] p-4 sm:p-6" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)' }} onClick={e => { if (e.target === e.currentTarget) setGroupeLead(null); }}>
            <div className="w-full max-w-md rounded-2xl overflow-hidden bg-white">
              <div className="p-5 border-b border-gray-100 flex items-start justify-between gap-3" style={{ background: '#eef2ff' }}>
                <div>
                  <span className="dm text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700">👥 GROUPE</span>
                  <h2 className="text-base font-black tracking-tight text-gray-900 mt-2">{groupeLead.titre_demande || groupeLead.nom_client}</h2>
                  {groupeLead.date_evenement && (
                    <p className="dm text-[11px] text-gray-500 mt-1">
                      {format(parseISO(groupeLead.date_evenement), 'dd MMM yyyy', { locale: fr })}
                      {groupeLead.date_fin_evenement && groupeLead.date_fin_evenement !== groupeLead.date_evenement ? ` → ${format(parseISO(groupeLead.date_fin_evenement), 'dd MMM yyyy', { locale: fr })}` : ''}
                    </p>
                  )}
                </div>
                <button onClick={() => setGroupeLead(null)} className="text-gray-400 hover:text-gray-700 shrink-0"><XCircle className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-3">
                {groupeLead.nom_client && <div className="text-sm"><span className="text-gray-400 text-xs">Contact</span><div className="font-semibold text-gray-800">{groupeLead.nom_client}</div></div>}
                {groupeLead.email && <a href={`mailto:${groupeLead.email}`} className="block text-sm text-indigo-600">{groupeLead.email}</a>}
                <p className="text-xs text-gray-400">Le détail des chambres, des invités et le suivi PMS se gèrent dans l’app Groupes.</p>
                <div className="grid grid-cols-1 gap-2 pt-1">
                  <button onClick={() => window.open(`/groupes?g=${groupeLead.groupe_id}`, '_blank')} className="h-11 rounded-xl text-sm font-black text-white inline-flex items-center justify-center gap-2" style={{ background: '#6366f1' }}><Users className="w-4 h-4" /> Ouvrir la gestion du groupe</button>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => window.open(`/devis?leadId=${groupeLead.id}`, '_blank')} className="h-10 rounded-xl text-sm font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center justify-center gap-1.5"><FileText className="w-4 h-4" /> Devis</button>
                    <button onClick={() => window.open(`/fiche?leadId=${groupeLead.id}`, '_blank')} className="h-10 rounded-xl text-sm font-bold bg-violet-50 text-violet-700 border border-violet-200 inline-flex items-center justify-center gap-1.5"><ScrollText className="w-4 h-4" /> Fiche</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal lien de paiement (rattaché au dossier) */}
        {payFor && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)' }}
            onClick={e => { if (e.target === e.currentTarget && !paySending) setPayFor(null); }}>
            <div className="w-full max-w-md rounded-2xl bg-white overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex items-start justify-between gap-3" style={{ background: '#ecfdf5' }}>
                <div>
                  <span className="dm text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700">💳 PAIEMENT</span>
                  <h2 className="text-base font-black tracking-tight text-gray-900 mt-2">{payFor.nom_client}</h2>
                  <p className="text-[11px] text-gray-500 mt-0.5">Montant pré-rempli avec le solde à régler — modifiable.</p>
                </div>
                <button onClick={() => setPayFor(null)} className="text-gray-400 hover:text-gray-700 shrink-0"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-3">
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">Montant (€)</label>
                  <input value={payAmount} onChange={e => setPayAmount(e.target.value)} inputMode="decimal" placeholder="230" autoFocus
                    className="nt-input w-full h-11 rounded-xl px-4 mt-1 border outline-none font-black text-lg" />
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">Description</label>
                  <input value={payDesc} onChange={e => setPayDesc(e.target.value)} placeholder="Acompte, solde séminaire…"
                    className="nt-input w-full h-10 rounded-xl px-4 mt-1 border outline-none" />
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">Email du client <span className="text-gray-300">(vide = lien à copier)</span></label>
                  <input type="email" value={payEmail} onChange={e => setPayEmail(e.target.value)} placeholder="client@exemple.fr"
                    className="nt-input w-full h-10 rounded-xl px-4 mt-1 border outline-none" />
                </div>
                <button onClick={sendPaymentLink} disabled={paySending}
                  className="w-full h-11 rounded-xl text-sm font-black text-white bg-[var(--brand)] hover:bg-[var(--brand-hover)] transition inline-flex items-center justify-center gap-2 disabled:opacity-50">
                  {paySending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> {payEmail.trim() ? 'Créer & envoyer' : 'Créer le lien'}</>}
                </button>
                {payLink && (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
                    <span className="text-xs text-gray-600 truncate flex-1">{payLink}</span>
                    <button onClick={() => { navigator.clipboard.writeText(payLink); toast.success('Lien copié'); }} className="text-xs font-bold text-emerald-700 inline-flex items-center gap-1 shrink-0"><Copy className="w-3.5 h-3.5" /> Copier</button>
                    <a href={payLink} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-emerald-700 inline-flex items-center gap-1 shrink-0">Ouvrir <ExternalLink className="w-3 h-3" /></a>
                  </div>
                )}
                <p className="text-[10px] text-gray-400">Le paiement apparaîtra dans <strong>Encaissement</strong> et viendra créditer le « réglé » de ce dossier.</p>
              </div>
            </div>
          </div>
        )}

      </div>
    </>
  );
}