'use client';
import { Suspense, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { ThemedBackground } from '@/components/ThemedBackground';
import { BlobProvider } from '@react-pdf/renderer';
import { FichePDF } from './FichePDF';
import { CombinedPDF } from './CombinedPDF';
import { ArrowLeft, Printer, Save, Loader2, CheckCircle, Plus, ChevronUp, ChevronDown, Trash2, FileDown, Sparkles, AlertTriangle, Lock, Check } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

type RowType = 'seminaire' | 'repas' | 'pause' | 'autre';
interface ProgRow { id: string; date: string; heure: string; label: string; salle: string; disposition: string; type: RowType; }

// Item de la phase ① Amont (proposé par l'IA, ou ajouté à la main).
interface AmontItem { key: string; label: string; hint?: string; }
// Réponse de l'équipe à un point soulevé par Junior (boucle "outil vivant").
interface ManqueReponse { key: string; question: string; reponse: string; }

// Checklist d'avancement (stockée en JSONB dans fiches_fonctions.checklist).
// Phase ① Amont = pilotée par l'IA + override manuel. Phase ④ Clôture = fixe
// (verrou déterministe). Les salles réservées sont dérivées en live, pas ici.
interface Checklist {
  amont_checked: Record<string, boolean>; // cases cochées (items IA + manuels), par clé
  amont_custom: AmontItem[];              // points ajoutés à la main (override)
  amont_hidden: string[];                 // clés d'items IA masqués à la main (override)
  manques_traites: string[];              // clés des points Junior marqués traités (disparaissent)
  manques_reponses: ManqueReponse[];      // réponses fournies → re-nourrissent l'analyse
  prestations_verifiees: boolean;         // consommé / extras / no-show vérifiés
  facture_pms: boolean;                   // facture finale émise dans le PMS
  facture_pms_date: string;
  cloturee: boolean;
  cloturee_at: string | null;
}
const EMPTY_CHECKLIST: Checklist = {
  amont_checked: {}, amont_custom: [], amont_hidden: [],
  manques_traites: [], manques_reponses: [],
  prestations_verifiees: false, facture_pms: false, facture_pms_date: '',
  cloturee: false, cloturee_at: null,
};

// Clé stable d'un point Junior (pour le marquer traité / y répondre malgré les
// reformulations entre analyses) : minuscules, sans ponctuation/chiffres.
const manqueKey = (texte: string) =>
  String(texte ?? '').toLowerCase().replace(/[^a-zà-ÿ]+/g, ' ').trim().slice(0, 80);

interface AuditResult {
  synthese: string;
  manques: { severite: string; texte: string }[];
  suggestions_programme: { date: string; heure: string; type: RowType; label: string; salle: string }[];
  checklist_amont?: AmontItem[];
}

const TYPE_STYLES: Record<RowType, string> = {
  seminaire: 'bg-teal-50 text-teal-700 border-teal-200',
  repas:     'bg-green-50 text-green-700 border-green-200',
  pause:     'bg-amber-50 text-amber-700 border-amber-200',
  autre:     'bg-gray-50 text-gray-600 border-gray-200',
};

function newRow(overrides: Partial<ProgRow> = {}): ProgRow {
  return { id: crypto.randomUUID(), date: '', heure: '', label: '', salle: '', disposition: '', type: 'autre', ...overrides };
}

// Lignes "séminaire" dérivées en live des réservations (salle/horaires = vérité).
function seminaireRowsFromReservations(roomsList: any[], defaultDate: string): ProgRow[] {
  return roomsList.flatMap((r: any) => [
    newRow({ date: (r.start_date || defaultDate).substring(0, 10), heure: r.start_time?.substring(0, 5) || '', label: 'Début séminaire', salle: r.room_name || '', type: 'seminaire' }),
    newRow({ date: (r.end_date || r.start_date || defaultDate).substring(0, 10), heure: r.end_time?.substring(0, 5) || '', label: 'Fin séminaire', salle: r.room_name || '', type: 'seminaire' }),
  ]);
}

// Signature des lignes séminaire pour détecter une divergence fiche ↔ réservations.
function seminaireSignature(rows: ProgRow[]): string {
  return rows.filter(r => r.type === 'seminaire')
    .map(r => `${r.salle}|${r.date}|${r.heure}|${r.label}`).sort().join('§');
}

function FicheContent() {
  const searchParams = useSearchParams();
  const leadId = searchParams?.get('leadId');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [lead, setLead] = useState<any>(null);
  const [hotel, setHotel] = useState<any>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const [quoteItems, setQuoteItems] = useState<any[]>([]);
  const [ficheId, setFicheId] = useState<string | null>(null);
  const [programmeRows, setProgrammeRows] = useState<ProgRow[]>([]);
  const [roomsOutOfSync, setRoomsOutOfSync] = useState(false);
  const [quoteMetadata, setQuoteMetadata] = useState<any>(null);

  const [fiche, setFiche] = useState({
    notes_generales: '',
    notes_gaetan: '',
    notes_facturation: '',
  });
  const [checklist, setChecklist] = useState<Checklist>(EMPTY_CHECKLIST);

  // Assistant IA (audit du dossier)
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [auditing, setAuditing] = useState(false);     // analyse visible (1ère fois / forcée)
  const [refreshing, setRefreshing] = useState(false); // rafraîchissement silencieux (cache déjà affiché)
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditAt, setAuditAt] = useState<string | null>(null);
  const [autoDone, setAutoDone] = useState(false);     // garde-fou : auto-analyse 1× par ouverture
  const [replyingTo, setReplyingTo] = useState<string | null>(null); // point Junior en cours de réponse
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    const hotelName = hotel?.nom ? ` — ${hotel.nom}` : '';
    document.title = `Fiche de fonction${hotelName}`;
  }, [hotel]);

  useEffect(() => {
    if (!leadId) return;
    async function load() {
      setLoading(true);

      const { data: leadData } = await supabase.from('suivi_commercial').select('*').eq('id', leadId).single();
      if (leadData) setLead(leadData);

      const hotelId = leadData?.hotel_id || localStorage.getItem('selectedHotelId');
      if (hotelId) {
        const { data: hotelData } = await supabase.from('hotels').select('*').eq('id', hotelId).single();
        if (hotelData) setHotel(hotelData);
      }

      const { data: resaData } = await supabase
        .from('seminar_reservations')
        .select('*, seminar_rooms(name)')
        .eq('lead_id', leadId);
      const roomsList = (resaData || []).map((r: any) => ({ ...r, room_name: r.seminar_rooms?.name }));
      setRooms(roomsList);

      const { data: quoteData } = await supabase
        .from('quotes')
        .select('*, quote_items(*)')
        .eq('lead_id', leadId)
        .maybeSingle();
      const loadedItems: any[] = quoteData?.quote_items || [];
      if (loadedItems.length) setQuoteItems(loadedItems);
      if (quoteData) setQuoteMetadata(quoteData);

      const { data: ficheData } = await supabase
        .from('fiches_fonctions')
        .select('*')
        .eq('lead_id', leadId)
        .maybeSingle();

      if (ficheData) {
        setFicheId(ficheData.id);
        setFiche({
          notes_generales:   ficheData.notes_generales ?? '',
          notes_gaetan:      ficheData.notes_gaetan ?? '',
          notes_facturation: ficheData.notes_facturation ?? '',
        });
        // checklist : JSONB nullable → on reconstruit explicitement (rétro-compatible
        // avec les anciennes fiches, dont l'ancien format resto/hebergement est ignoré).
        const c = (ficheData.checklist ?? {}) as Partial<Checklist>;
        setChecklist({
          amont_checked: { ...(c.amont_checked ?? {}) },
          amont_custom: Array.isArray(c.amont_custom) ? c.amont_custom : [],
          amont_hidden: Array.isArray(c.amont_hidden) ? c.amont_hidden : [],
          manques_traites: Array.isArray(c.manques_traites) ? c.manques_traites : [],
          manques_reponses: Array.isArray(c.manques_reponses) ? c.manques_reponses : [],
          prestations_verifiees: !!c.prestations_verifiees,
          facture_pms: !!c.facture_pms,
          facture_pms_date: c.facture_pms_date ?? '',
          cloturee: !!c.cloturee,
          cloturee_at: c.cloturee_at ?? null,
        });
        // Cache d'analyse IA : on affiche tout de suite la dernière analyse
        // connue (l'auto-analyse vérifiera ensuite si le dossier a changé).
        const cachedAudit = ficheData.audit as { result?: AuditResult; generated_at?: string } | null;
        if (cachedAudit?.result) {
          setAudit(cachedAudit.result);
          setAuditAt(cachedAudit.generated_at ?? null);
        }
      }

      // Programme rows — charger depuis JSON ou pré-remplir depuis les salles
      const defaultDate = (leadData?.date_evenement || '').substring(0, 10);
      let rows: ProgRow[] = [];
      if (ficheData?.programme) {
        try {
          const parsed = JSON.parse(ficheData.programme);
          if (Array.isArray(parsed) && parsed.length > 0) {
            // Combler les dates vides avec la date de l'événement
            rows = parsed.map((r: any) => ({ ...r, date: r.date || defaultDate }));
          }
        } catch {}
      }
      if (rows.length === 0) {
        if (roomsList.length > 0) {
          rows = seminaireRowsFromReservations(roomsList, defaultDate);
        }
        // Ajouter automatiquement les items Restauration du devis
        const restaurItems = loadedItems.filter((i: any) => i.category === 'Restauration' && i.label?.trim());
        rows.push(...restaurItems.map((i: any) =>
          newRow({ date: defaultDate, label: `${i.quantity}× ${i.label}`, type: 'repas' })
        ));
      }
      setProgrammeRows(rows);

      // Fiche LIVE : si un programme était déjà sauvegardé mais que les salles/
      // horaires des réservations ont changé depuis, on le signale (resync 1 clic).
      const liveSeminaire = seminaireRowsFromReservations(roomsList, defaultDate);
      setRoomsOutOfSync(!!ficheData?.programme && seminaireSignature(rows) !== seminaireSignature(liveSeminaire));

      setLoading(false);
    }
    load();
  }, [leadId]);

  // ── Handlers programme ──
  const addRow = () => setProgrammeRows(prev => [...prev, newRow({ date: (lead?.date_evenement || '').substring(0, 10) })]);
  const removeRow = (id: string) => setProgrammeRows(prev => prev.filter(r => r.id !== id));
  const updateRow = (id: string, field: keyof ProgRow, val: string) =>
    setProgrammeRows(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r));
  const moveRow = (idx: number, dir: number) => {
    const next = [...programmeRows];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setProgrammeRows(next);
  };
  const importFromDevis = () => {
    const toAdd = quoteItems
      .filter(i => i.label?.trim())
      .map(i => newRow({ date: (lead?.date_evenement || '').substring(0, 10), label: `${i.quantity}× ${i.label}`, type: 'repas' }));
    setProgrammeRows(prev => [...prev, ...toAdd]);
  };

  // Resynchronise les lignes séminaire depuis les réservations (vérité salle/horaires),
  // en conservant la disposition saisie (rapprochée par salle + label) et toutes les
  // autres lignes (repas/pause/autre). Non destructif : déclenché manuellement.
  const resyncRooms = () => {
    const defaultDate = (lead?.date_evenement || '').substring(0, 10);
    const live = seminaireRowsFromReservations(rooms, defaultDate);
    const merged = live.map(lr => {
      const old = programmeRows.find(r => r.type === 'seminaire' && r.salle === lr.salle && r.label === lr.label);
      return old ? { ...lr, disposition: old.disposition } : lr;
    });
    const others = programmeRows.filter(r => r.type !== 'seminaire');
    setProgrammeRows([...merged, ...others]);
    setRoomsOutOfSync(false);
  };

  const handleSave = async (overrideChecklist?: Checklist) => {
    if (!leadId || saving) return;
    setSaving(true);
    const hotelId = lead?.hotel_id || localStorage.getItem('selectedHotelId');
    const payload = {
      lead_id: leadId,
      hotel_id: hotelId,
      programme:          JSON.stringify(programmeRows),
      notes_generales:   fiche.notes_generales || null,
      notes_gaetan:      fiche.notes_gaetan || null,
      notes_facturation: fiche.notes_facturation || null,
      checklist:         overrideChecklist ?? checklist,
      updated_at: new Date().toISOString(),
    };
    if (ficheId) {
      await supabase.from('fiches_fonctions').update(payload).eq('id', ficheId);
    } else {
      const { data } = await supabase.from('fiches_fonctions').insert([payload]).select().single();
      if (data) setFicheId(data.id);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const set = (field: string, val: string) => setFiche(prev => ({ ...prev, [field]: val }));

  // ── Checklist & clôture ──
  // Phase ④ (fixe) : les deux booléens du verrou de clôture.
  const toggleCheck = (key: 'prestations_verifiees' | 'facture_pms') =>
    setChecklist(prev => {
      const next = { ...prev, [key]: !prev[key] };
      // Cocher "facture finale émise" pré-remplit la date du jour (éditable).
      if (key === 'facture_pms') next.facture_pms_date = !prev.facture_pms ? new Date().toISOString().slice(0, 10) : '';
      return next;
    });
  // Phase ① (IA + override) : cocher un point, en masquer un proposé, en ajouter un.
  const toggleAmont = (key: string) =>
    setChecklist(prev => ({ ...prev, amont_checked: { ...prev.amont_checked, [key]: !prev.amont_checked[key] } }));
  const removeAmont = (key: string, isCustom: boolean) =>
    setChecklist(prev => isCustom
      ? { ...prev, amont_custom: prev.amont_custom.filter(i => i.key !== key) }
      : { ...prev, amont_hidden: [...prev.amont_hidden, key] });
  const addAmont = () => {
    const label = window.prompt('Intitulé du point à ajouter ?')?.trim();
    if (!label) return;
    const key = `custom_${Date.now().toString(36)}`;
    setChecklist(prev => ({ ...prev, amont_custom: [...prev.amont_custom, { key, label }] }));
  };
  const toggleCloture = () =>
    setChecklist(prev => prev.cloturee
      ? { ...prev, cloturee: false, cloturee_at: null }
      : { ...prev, cloturee: true, cloturee_at: new Date().toISOString() });

  // ── Junior : audit du dossier complet ──
  // Les appelants enregistrent la fiche AVANT (pour que Junior lise la base à jour).
  // mode 'force' = ignore le cache et ré-analyse ; 'auto' (ouverture) = ressert le
  // cache si rien n'a changé, sinon ré-analyse.
  const runAudit = async (mode: 'auto' | 'force' = 'force') => {
    if (!leadId || auditing || refreshing) return;
    const visible = mode === 'force' || !audit;
    if (visible) setAuditing(true); else setRefreshing(true);
    setAuditError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch('/api/fiche-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ leadId, mode }),
      });
      const json = await res.json();
      if (!json.ok) setAuditError(json.error || 'Analyse indisponible');
      else { setAudit(json.audit as AuditResult); setAuditAt(json.generated_at ?? null); }
    } catch {
      setAuditError('Analyse indisponible, réessaie');
    } finally {
      setAuditing(false);
      setRefreshing(false);
    }
  };

  // Auto-analyse à l'ouverture (1× par visite) : sert le cache si le dossier
  // n'a pas bougé (0 coût), ré-analyse seulement s'il a changé.
  useEffect(() => {
    if (loading || !lead || !leadId || autoDone) return;
    setAutoDone(true);
    runAudit('auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, lead, leadId, autoDone]);
  // Marque un point Junior comme traité → il disparaît de la liste (persiste à l'Enregistrer).
  const markManqueTraite = (texte: string) => {
    const key = manqueKey(texte);
    setChecklist(prev => prev.manques_traites.includes(key) ? prev : { ...prev, manques_traites: [...prev.manques_traites, key] });
  };
  // Répond à un point : enregistre la réponse, masque le point, puis Junior ré-analyse
  // en tenant compte de la réponse (boucle "outil vivant").
  const submitReply = async (texte: string) => {
    const reponse = replyText.trim();
    setReplyingTo(null);
    setReplyText('');
    if (!reponse) return;
    const key = manqueKey(texte);
    const next: Checklist = {
      ...checklist,
      manques_traites: checklist.manques_traites.includes(key) ? checklist.manques_traites : [...checklist.manques_traites, key],
      manques_reponses: [...checklist.manques_reponses.filter(r => r.key !== key), { key, question: texte, reponse }],
    };
    setChecklist(next);
    await handleSave(next);
    await runAudit('force');
  };
  // Ajoute une ligne suggérée au programme et la retire des suggestions.
  const addSuggestion = (s: AuditResult['suggestions_programme'][number], idx: number) => {
    setProgrammeRows(prev => [...prev, newRow({
      date: s.date || (lead?.date_evenement || '').substring(0, 10),
      heure: s.heure || '', type: s.type || 'autre', label: s.label || '', salle: s.salle || '',
    })]);
    setAudit(prev => prev ? { ...prev, suggestions_programme: prev.suggestions_programme.filter((_, i) => i !== idx) } : prev);
  };

  const ficheDate = format(new Date(), 'dd/MM/yyyy', { locale: fr });
  const pdfData = { lead, hotel, rooms, quoteItems, fiche, programmeRows, ficheDate };

  // Données pour le PDF combiné (fiche + devis)
  const combinedPdfData = (() => {
    const getHT = (ttc: number, rate: number) => ttc / (1 + rate / 100);
    const filtered = quoteItems.filter(i => i.label?.trim());
    const lines = filtered.map(i => ({
      date: i.date ? new Date(i.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '--',
      description: i.label,
      detail: i.description || '',
      quantity: i.quantity,
      unitPriceTTC: i.unit_price_ttc,
      tvaRate: i.tva_rate || 10,
      totalTTC: ((i.quantity || 0) * (i.unit_price_ttc || 0)).toFixed(2),
    }));
    let ht = 0, ttc = 0;
    const tvaDetails: Record<number, { ht: number; tva: number }> = {};
    filtered.forEach(i => {
      const lineTtc = (i.quantity || 0) * (i.unit_price_ttc || 0);
      const rate = i.tva_rate || 10;
      const lineHt = getHT(lineTtc, rate);
      ht += lineHt; ttc += lineTtc;
      if (!tvaDetails[rate]) tvaDetails[rate] = { ht: 0, tva: 0 };
      tvaDetails[rate].ht += lineHt;
      tvaDetails[rate].tva += lineTtc - lineHt;
    });
    return {
      data: {
        quoteNumber: quoteMetadata?.quote_number || 'EN COURS',
        quoteDate: quoteMetadata?.created_at ? new Date(quoteMetadata.created_at).toLocaleDateString('fr-FR') : ficheDate,
        clientName: lead?.nom_client || '',
        clientEmail: lead?.email || '',
        eventTitle: lead?.titre_demande || '',
        eventDate: lead?.date_evenement ? new Date(lead.date_evenement).toLocaleDateString('fr-FR') : '--',
        conditions: quoteMetadata?.cancellation_terms || [
          "Versement de l'acompte 50% non remboursable à la signature.",
          "Annulation et modification sans frais supplémentaire jusqu'à J-30.",
          "Paiement du solde à réception de facture.",
        ],
      },
      lines,
      totals: { ht: ht.toFixed(2), ttc: ttc.toFixed(2), tvaDetails },
    };
  })();

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
    </div>
  );

  if (!lead) return (
    <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">
      Dossier introuvable.
    </div>
  );

  const dateLabel = lead.date_evenement
    ? format(new Date(lead.date_evenement), 'dd MMM yyyy', { locale: fr })
    : '—';
  const dateFinLabel = lead.date_fin_evenement && lead.date_fin_evenement !== lead.date_evenement
    ? ` → ${format(new Date(lead.date_fin_evenement), 'dd MMM yyyy', { locale: fr })}`
    : '';

  const devisItems = quoteItems.filter((i: any) => i.label?.trim());

  // ── Avancement / clôture (dérivé) ──
  const sallesOk = rooms.length > 0;
  const today = new Date().toISOString().slice(0, 10);
  const isPast = lead.date_evenement ? String(lead.date_evenement).slice(0, 10) < today : false;
  // Phase ① visible = items IA (hors masqués manuellement) + items ajoutés à la main.
  const amontItems: AmontItem[] = [
    ...(audit?.checklist_amont ?? []).filter(it => !checklist.amont_hidden.includes(it.key)),
    ...checklist.amont_custom,
  ];
  const customKeys = new Set(checklist.amont_custom.map(i => i.key));
  // Points Junior encore actifs = ceux non marqués traités.
  const manquesVisibles = (audit?.manques ?? []).filter(m => !checklist.manques_traites.includes(manqueKey(m.texte)));
  const checkItems = [sallesOk, ...amontItems.map(it => !!checklist.amont_checked[it.key]), checklist.prestations_verifiees, checklist.facture_pms];
  const doneCount = checkItems.filter(Boolean).length;
  const totalCount = checkItems.length;
  const progressPct = Math.round((doneCount / totalCount) * 100);
  // Phase ④ complète = barrière de clôture (déterministe, indépendante de l'IA).
  const clotureReady = checklist.prestations_verifiees && checklist.facture_pms;

  // Données enrichies pour le PDF (avancement + analyse Junior).
  const fichePdfData = {
    ...pdfData,
    avancement: {
      salles: { ok: sallesOk, count: rooms.length },
      amont: amontItems.map(it => ({ label: it.label, hint: it.hint, checked: !!checklist.amont_checked[it.key] })),
      prestations_verifiees: checklist.prestations_verifiees,
      facture_pms: checklist.facture_pms,
      facture_pms_date: checklist.facture_pms_date,
      cloturee: checklist.cloturee,
      cloturee_at: checklist.cloturee_at,
      doneCount, totalCount,
    },
    junior: audit ? { synthese: audit.synthese, manques: manquesVisibles } : null,
  };

  return (
    <div className="min-h-screen">
      <ThemedBackground />

      {/* ── Top bar ── */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => { if (window.history.length > 1) window.history.back(); else { window.close(); window.location.href = '/commercial?tab=planning'; } }} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-all">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="text-sm font-black text-gray-900">{lead.nom_client}</div>
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{lead.titre_demande} · {dateLabel}{dateFinLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <BlobProvider document={<FichePDF data={fichePdfData} />}>
            {({ url, loading: pdfLoading }) => (
              <button
                disabled={pdfLoading || !url}
                onClick={() => url && window.open(url, '_blank')}
                className="flex items-center gap-1.5 px-4 h-9 rounded-xl text-xs font-black border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 transition-all disabled:opacity-50"
              >
                <Printer className="w-3.5 h-3.5" />
                {pdfLoading ? 'Génération…' : 'Imprimer Fiche'}
              </button>
            )}
          </BlobProvider>
          {quoteItems.length > 0 && (
            <BlobProvider document={<CombinedPDF ficheData={fichePdfData} quoteData={combinedPdfData} />}>
              {({ url, loading: pdfLoading }) => (
                <button
                  disabled={pdfLoading || !url}
                  onClick={() => url && window.open(url, '_blank')}
                  className="flex items-center gap-1.5 px-4 h-9 rounded-xl text-xs font-black border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 transition-all disabled:opacity-50"
                >
                  <Printer className="w-3.5 h-3.5" />
                  {pdfLoading ? 'Génération…' : 'Imprimer Fiche + Devis'}
                </button>
              )}
            </BlobProvider>
          )}
          <button onClick={() => handleSave()} disabled={saving} className="flex items-center gap-1.5 px-5 h-9 rounded-xl text-xs font-black bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)] transition-all disabled:opacity-50">
            {saved ? <CheckCircle className="w-3.5 h-3.5" /> : saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saved ? 'Enregistré' : saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8 space-y-6">

        {/* ── Synthèse auto ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-300 mb-4">Synthèse (auto)</p>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Client</div>
              <div className="font-bold text-gray-900">{lead.nom_client}</div>
              {lead.societe && <div className="text-gray-500 text-xs">{lead.societe}</div>}
              {lead.email && <div className="text-gray-500 text-xs">{lead.email}</div>}
              {lead.telephone && <div className="text-gray-500 text-xs">{lead.telephone}</div>}
            </div>
            <div>
              <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Événement</div>
              <div className="font-bold text-gray-900">{lead.titre_demande}</div>
              <div className="text-teal-600 text-xs font-bold">{dateLabel}{dateFinLabel}</div>
              <div className="text-gray-500 text-xs mt-1">{lead.statut} · {lead.etat_paiement}</div>
            </div>
            {rooms.length > 0 && (
              <div>
                <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Salles réservées</div>
                {rooms.map((r, i) => (
                  <div key={i} className="text-xs text-gray-700">{r.room_name} · {r.start_time?.substring(0,5)} – {r.end_time?.substring(0,5)}</div>
                ))}
              </div>
            )}
            {devisItems.length > 0 && (
              <div>
                <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Prestations devis</div>
                {devisItems.map((i: any, idx: number) => (
                  <div key={idx} className="text-xs text-gray-700">{i.quantity}× {i.label}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Junior (assistant IA) ── */}
        <div className="bg-white rounded-2xl border border-violet-200 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-700 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Junior
              <span className="text-[9px] text-violet-300 normal-case tracking-normal font-bold">· assistant dossier</span>
              {refreshing && <span className="text-[9px] font-bold text-gray-300 normal-case tracking-normal flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> mise à jour…</span>}
            </span>
            <div className="flex items-center gap-3">
              {auditAt && !auditing && (
                <span className="text-[10px] text-gray-300 font-medium">analysé le {format(new Date(auditAt), 'dd/MM à HH:mm')}</span>
              )}
              <button onClick={async () => { await handleSave(); await runAudit('force'); }} disabled={auditing || refreshing}
                className="flex items-center gap-1.5 px-4 h-8 rounded-xl text-[11px] font-black border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 transition-all disabled:opacity-50">
                {auditing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {auditing ? 'Analyse…' : audit ? 'Ré-analyser' : 'Analyser le dossier'}
              </button>
            </div>
          </div>
          <div className="p-6">
            {!audit && !auditing && !auditError && (
              <p className="text-sm text-gray-400">Junior relit tout le dossier (lead, salles, devis, programme, notes) et te dit l&apos;essentiel + ce qui manque — dont la facturation finale.</p>
            )}
            {auditing && <p className="text-sm text-gray-400">Junior analyse le dossier…</p>}
            {auditError && <p className="text-sm text-red-500">{auditError}</p>}
            {audit && (
              <div className="space-y-5">
                {/* Synthèse — l'event en un coup d'œil */}
                <div className="rounded-xl bg-violet-50/60 border border-violet-100 px-4 py-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-violet-400 mb-1">En bref</div>
                  <p className="text-[15px] text-gray-800 leading-snug font-medium">{audit.synthese}</p>
                </div>
                {/* Points à vérifier — traitables / répondables */}
                <div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">À vérifier ({manquesVisibles.length})</div>
                  {manquesVisibles.length === 0 ? (
                    <p className="text-sm text-emerald-600 font-bold flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Rien à signaler, dossier complet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {manquesVisibles.map((m, i) => {
                        const sev = SEV_STYLE[m.severite] || SEV_STYLE.mineur;
                        const key = manqueKey(m.texte);
                        return (
                          <div key={i} className={`px-3 py-2 rounded-xl border ${sev.box}`}>
                            <div className="flex items-start gap-2.5">
                              <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${sev.icon}`} />
                              <span className="text-sm text-gray-700 flex-1">{m.texte}</span>
                              {replyingTo !== key && (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button onClick={() => { setReplyingTo(key); setReplyText(''); }}
                                    className="px-2 h-7 rounded-lg text-[11px] font-bold text-violet-600 hover:bg-violet-100 transition-colors">Répondre</button>
                                  <button onClick={() => markManqueTraite(m.texte)} title="Marquer traité"
                                    className="p-1 rounded text-gray-300 hover:text-emerald-600 transition-colors"><Check className="w-4 h-4" /></button>
                                </div>
                              )}
                            </div>
                            {replyingTo === key && (
                              <div className="mt-2 flex items-center gap-2 pl-6">
                                <input autoFocus value={replyText} onChange={e => setReplyText(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') submitReply(m.texte); if (e.key === 'Escape') { setReplyingTo(null); setReplyText(''); } }}
                                  placeholder="Ta réponse (ex. déjeuner externe au resto X)…"
                                  className="flex-1 h-8 rounded-lg px-2 border border-gray-200 text-sm outline-none focus:border-violet-400" />
                                <button onClick={() => submitReply(m.texte)} className="shrink-0 px-2.5 h-8 rounded-lg text-[11px] font-black bg-violet-600 text-white hover:bg-violet-700">Valider</button>
                                <button onClick={() => { setReplyingTo(null); setReplyText(''); }} className="shrink-0 px-2 h-8 rounded-lg text-[11px] font-bold text-gray-400 hover:text-gray-700">Annuler</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {audit.suggestions_programme.length > 0 && (
                  <div>
                    <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Lignes de programme suggérées</div>
                    <div className="space-y-1.5">
                      {audit.suggestions_programme.map((s, i) => (
                        <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50">
                          <span className="text-xs font-bold text-gray-500 tabular-nums shrink-0">{s.heure || '--:--'}</span>
                          <span className="text-sm text-gray-700 flex-1">{s.label}{s.salle ? ` · ${s.salle}` : ''}</span>
                          <button onClick={() => addSuggestion(s, i)} className="shrink-0 flex items-center gap-1 px-2.5 h-7 rounded-lg text-[11px] font-black bg-teal-600 text-white hover:bg-teal-700 transition-all">
                            <Plus className="w-3 h-3" /> Ajouter
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-gray-300">Junior (IA) — à valider, peut se tromper. Tes réponses sont prises en compte à l&apos;analyse suivante.</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Avancement & clôture ── */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Avancement du dossier</span>
            <div className="flex items-center gap-3 flex-1 max-w-xs">
              <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-xs font-black text-gray-500 tabular-nums">{doneCount}/{totalCount}</span>
            </div>
          </div>
          <div className="p-6 grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1 flex items-center gap-1.5">
                ① Amont <span className="text-violet-400 normal-case tracking-normal font-bold inline-flex items-center gap-0.5"><Sparkles className="w-2.5 h-2.5" />IA</span>
              </div>
              <CheckRow auto checked={sallesOk} label="Salles réservées" hint={sallesOk ? `${rooms.length} salle(s) réservée(s)` : 'Aucune réservation'} />
              {amontItems.map(it => (
                <CheckRow key={it.key} checked={!!checklist.amont_checked[it.key]} onToggle={() => toggleAmont(it.key)}
                  label={it.label} hint={it.hint} onRemove={() => removeAmont(it.key, customKeys.has(it.key))} />
              ))}
              {amontItems.length === 0 && (
                <p className="text-[11px] text-gray-400 px-1">{audit ? 'Aucun point de préparation spécifique pour ce dossier.' : 'Lance l’analyse (Assistant dossier) pour générer les points de préparation.'}</p>
              )}
              <button type="button" onClick={addAmont} className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 hover:text-gray-700 transition-colors pt-1 pl-1">
                <Plus className="w-3.5 h-3.5" /> Ajouter un point
              </button>
            </div>
            <div className="space-y-2">
              <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1 flex items-center gap-1.5">
                ④ Clôture &amp; facturation {isPast && !clotureReady && <span className="text-red-500">· à faire</span>}
              </div>
              <CheckRow checked={checklist.prestations_verifiees} onToggle={() => toggleCheck('prestations_verifiees')} label="Prestations consommées vérifiées" hint="extras, no-show, consommations réelles" />
              <CheckRow checked={checklist.facture_pms} onToggle={() => toggleCheck('facture_pms')} label="Facture finale émise (PMS)" hint="la facturation se fait dans le PMS" />
              {checklist.facture_pms && (
                <div className="flex items-center gap-2 pl-3">
                  <span className="text-[10px] font-bold text-gray-400">émise le</span>
                  <input type="date" value={checklist.facture_pms_date} onChange={e => setChecklist(prev => ({ ...prev, facture_pms_date: e.target.value }))}
                    className="h-8 rounded-lg px-2 border border-gray-200 text-xs outline-none focus:border-emerald-400" />
                </div>
              )}
            </div>
          </div>
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-4 bg-gray-50/50">
            {checklist.cloturee ? (
              <span className="text-sm font-bold text-emerald-700 flex items-center gap-2">
                <CheckCircle className="w-4 h-4" /> Dossier clôturé{checklist.cloturee_at ? ` le ${format(new Date(checklist.cloturee_at), 'dd/MM/yyyy')}` : ''}
              </span>
            ) : clotureReady ? (
              <span className="text-sm text-gray-500">Tout est prêt — tu peux clôturer le dossier.</span>
            ) : (
              <span className="text-sm text-gray-400 flex items-center gap-2"><Lock className="w-3.5 h-3.5" /> Clôture verrouillée tant que la phase ④ n&apos;est pas complète.</span>
            )}
            <button type="button" onClick={toggleCloture} disabled={!clotureReady && !checklist.cloturee}
              className={`shrink-0 px-5 h-9 rounded-xl text-xs font-black transition-all ${checklist.cloturee ? 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50' : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed'}`}>
              {checklist.cloturee ? 'Rouvrir' : 'Clôturer le dossier'}
            </button>
          </div>
        </div>

        {/* ── Programme ── */}
        <div className="bg-white rounded-2xl border border-teal-200 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-teal-700">Programme</span>
            {devisItems.length > 0 && (
              <button onClick={importFromDevis}
                className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-teal-600 hover:text-teal-900 transition-colors">
                <FileDown className="w-3 h-3" />
                Importer du devis
              </button>
            )}
          </div>
          <div className="p-5">
            {roomsOutOfSync && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <span className="text-sm text-amber-800">⚠️ Les salles ou horaires des réservations ont changé depuis la dernière sauvegarde — la fiche n'est plus à jour.</span>
                <button onClick={resyncRooms}
                  className="shrink-0 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-3 py-1.5 transition-colors">
                  Resynchroniser les salles
                </button>
              </div>
            )}
            {programmeRows.length > 0 && (
              <div className="grid grid-cols-[130px_90px_110px_1fr_140px_120px_76px] gap-2 mb-2 px-1">
                {['Date','Heure','Type','Moment','Salle','Disposition',''].map((h, i) => (
                  <div key={i} className="text-[9px] font-black uppercase tracking-widest text-gray-400">{h}</div>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              {programmeRows.map((row, i) => (
                <div key={row.id} className="grid grid-cols-[130px_90px_110px_1fr_140px_120px_76px] gap-2 items-center">
                  <input
                    type="date" value={row.date}
                    onChange={e => updateRow(row.id, 'date', e.target.value)}
                    className="h-8 rounded-lg px-2 border border-gray-200 text-xs outline-none w-full focus:border-teal-400"
                  />
                  <input
                    type="time" value={row.heure}
                    onChange={e => updateRow(row.id, 'heure', e.target.value)}
                    className="h-8 rounded-lg px-2 border border-gray-200 text-xs outline-none w-full focus:border-teal-400"
                  />
                  <select
                    value={row.type}
                    onChange={e => updateRow(row.id, 'type', e.target.value as RowType)}
                    className={`h-8 rounded-lg px-2 border text-[10px] font-bold outline-none w-full ${TYPE_STYLES[row.type]}`}
                  >
                    <option value="seminaire">Séminaire</option>
                    <option value="repas">Repas</option>
                    <option value="pause">Pause</option>
                    <option value="autre">Autre</option>
                  </select>
                  <input
                    value={row.label}
                    onChange={e => updateRow(row.id, 'label', e.target.value)}
                    placeholder="Déjeuner, Pause café, Début séminaire…"
                    className="h-8 rounded-lg px-3 border border-gray-200 text-sm outline-none w-full focus:border-teal-400"
                  />
                  <input
                    value={row.salle}
                    onChange={e => updateRow(row.id, 'salle', e.target.value)}
                    placeholder="Salle, lieu…"
                    className="h-8 rounded-lg px-3 border border-gray-200 text-sm outline-none w-full focus:border-teal-400"
                  />
                  <input
                    value={row.disposition}
                    onChange={e => updateRow(row.id, 'disposition', e.target.value)}
                    placeholder={row.salle ? 'Théâtre, En U…' : ''}
                    className={`h-8 rounded-lg px-3 border text-sm outline-none w-full focus:border-teal-400 ${row.salle ? 'border-gray-200' : 'border-gray-100 bg-gray-50 text-gray-300'}`}
                  />
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => moveRow(i, -1)} disabled={i === 0}
                      className="p-1 rounded text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors">
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => moveRow(i, 1)} disabled={i === programmeRows.length - 1}
                      className="p-1 rounded text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors">
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => removeRow(row.id)}
                      className="p-1 rounded text-gray-300 hover:text-red-500 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={addRow}
              className="mt-3 flex items-center gap-1.5 text-xs font-bold text-teal-600 hover:text-teal-900 transition-colors">
              <Plus className="w-3.5 h-3.5" />
              Ajouter une ligne
            </button>
          </div>
        </div>

        {/* ── Notes Générales ── */}
        <Section title="Notes Générales" color="blue">
          <NoteField label="Notes pour toutes les équipes" value={fiche.notes_generales} onChange={v => set('notes_generales', v)} />
        </Section>

        {/* ── Mr. Cocktail (Gaëtan) ── */}
        {lead.besoin_gaetan && lead.besoin_gaetan !== 'Pas besoin' && (
          <Section title="Mr. Cocktail — Gaëtan" color="purple">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Statut</span>
              <span className="text-xs font-bold text-purple-700">{lead.besoin_gaetan}</span>
            </div>
            <NoteField label="Notes & instructions" value={fiche.notes_gaetan} onChange={v => set('notes_gaetan', v)} />
          </Section>
        )}

        {/* ── Facturation ── */}
        <Section title="Facturation" color="amber">
          <div className="grid grid-cols-2 gap-3 mb-4 p-3 bg-amber-50 rounded-xl border border-amber-100">
            <div>
              <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">État paiement</div>
              <div className="text-sm font-bold text-amber-700">{lead.etat_paiement || '—'}</div>
            </div>
            <div>
              <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Budget estimé</div>
              <div className="text-sm font-bold text-gray-800">{lead.budget_estime ? `${Number(lead.budget_estime).toLocaleString('fr-FR')} €` : '—'}</div>
            </div>
            <div>
              <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Montant payé</div>
              <div className="text-sm font-bold text-emerald-600">{lead.montant_paye ? `${Number(lead.montant_paye).toLocaleString('fr-FR')} €` : '—'}</div>
            </div>
            <div>
              <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Reste à payer</div>
              <div className="text-sm font-bold text-red-600">
                {(lead.budget_estime || lead.montant_paye)
                  ? `${Math.max(0, Number(lead.budget_estime || 0) - Number(lead.montant_paye || 0)).toLocaleString('fr-FR')} €`
                  : '—'}
              </div>
            </div>
          </div>
          <NoteField label="Notes facturation" value={fiche.notes_facturation} onChange={v => set('notes_facturation', v)} />
        </Section>

      </div>
    </div>
  );
}

// ── Composants UI ──

const SECTION_COLORS: Record<string, { border: string; title: string }> = {
  teal:   { border: 'border-teal-200',   title: 'text-teal-700'   },
  green:  { border: 'border-green-200',  title: 'text-green-700'  },
  blue:   { border: 'border-blue-200',   title: 'text-blue-700'   },
  purple: { border: 'border-purple-200', title: 'text-purple-700' },
  amber:  { border: 'border-amber-200',  title: 'text-amber-700'  },
  slate:  { border: 'border-gray-200',   title: 'text-gray-700'   },
};

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  const c = SECTION_COLORS[color] || SECTION_COLORS.slate;
  return (
    <div className={`bg-white rounded-2xl border ${c.border} overflow-hidden`}>
      <div className="px-6 py-3 border-b border-gray-100">
        <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${c.title}`}>{title}</span>
      </div>
      <div className="p-6 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function NoteField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  // Auto-extensible : le champ grandit avec le contenu, pas de scroll interne.
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
  }, [value]);
  return (
    <Field label={label}>
      <textarea ref={ref} value={value} onChange={e => onChange(e.target.value)}
        placeholder="Notes…" rows={3}
        className="nt-input w-full rounded-xl px-3 py-2 border text-sm outline-none resize-none overflow-hidden" />
    </Field>
  );
}

const SEV_STYLE: Record<string, { box: string; icon: string }> = {
  critique:  { box: 'bg-red-50 border-red-200',     icon: 'text-red-500'   },
  important: { box: 'bg-amber-50 border-amber-200',  icon: 'text-amber-500' },
  mineur:    { box: 'bg-gray-50 border-gray-200',    icon: 'text-gray-400'  },
};

function CheckRow({ checked, onToggle, auto, label, hint, onRemove }: { checked: boolean; onToggle?: () => void; auto?: boolean; label: string; hint?: string; onRemove?: () => void }) {
  return (
    <div className={`group/row w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all ${checked ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-200 hover:border-gray-300'}`}>
      <button type="button" disabled={auto} onClick={onToggle}
        className={`flex items-center gap-3 flex-1 min-w-0 text-left ${auto ? 'cursor-default' : 'cursor-pointer'}`}>
        <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 border ${checked ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'}`}>
          {checked && <Check className="w-3.5 h-3.5 text-white" />}
        </span>
        <span className="flex-1 min-w-0">
          <span className={`block text-sm font-bold ${checked ? 'text-emerald-800' : 'text-gray-700'}`}>{label}</span>
          {hint && <span className="block text-[10px] text-gray-400 font-medium">{hint}</span>}
        </span>
      </button>
      {auto && <span className="text-[9px] font-black uppercase tracking-widest text-gray-300 shrink-0">auto</span>}
      {onRemove && (
        <button type="button" onClick={onRemove} title="Retirer ce point"
          className="shrink-0 p-1 rounded text-gray-300 hover:text-red-500 opacity-0 group-hover/row:opacity-100 transition-all">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export default function FichePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-teal-600" /></div>}>
      <FicheContent />
    </Suspense>
  );
}
