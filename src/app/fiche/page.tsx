'use client';
import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { BlobProvider } from '@react-pdf/renderer';
import { FichePDF } from './FichePDF';
import { CombinedPDF } from './CombinedPDF';
import { ArrowLeft, Printer, Save, Loader2, CheckCircle, Plus, ChevronUp, ChevronDown, Trash2, FileDown } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

type RowType = 'seminaire' | 'repas' | 'pause' | 'autre';
interface ProgRow { id: string; date: string; heure: string; label: string; salle: string; disposition: string; type: RowType; }

const TYPE_STYLES: Record<RowType, string> = {
  seminaire: 'bg-teal-50 text-teal-700 border-teal-200',
  repas:     'bg-green-50 text-green-700 border-green-200',
  pause:     'bg-amber-50 text-amber-700 border-amber-200',
  autre:     'bg-gray-50 text-gray-600 border-gray-200',
};

function newRow(overrides: Partial<ProgRow> = {}): ProgRow {
  return { id: crypto.randomUUID(), date: '', heure: '', label: '', salle: '', disposition: '', type: 'autre', ...overrides };
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
  const [quoteMetadata, setQuoteMetadata] = useState<any>(null);

  const [fiche, setFiche] = useState({
    notes_generales: '',
    notes_gaetan: '',
    notes_facturation: '',
  });

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
          notes_generales:   ficheData.notes_housekeeping ?? '',
          notes_gaetan:      ficheData.notes_reception ?? '',
          notes_facturation: ficheData.notes_food ?? '',
        });
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
          rows = roomsList.flatMap((r: any) => [
            newRow({ date: (r.start_date || defaultDate).substring(0, 10), heure: r.start_time?.substring(0,5) || '', label: 'Début séminaire', salle: r.room_name || '', type: 'seminaire' }),
            newRow({ date: (r.end_date || r.start_date || defaultDate).substring(0, 10), heure: r.end_time?.substring(0,5) || '', label: 'Fin séminaire', salle: r.room_name || '', type: 'seminaire' }),
          ]);
        }
        // Ajouter automatiquement les items Restauration du devis
        const restaurItems = loadedItems.filter((i: any) => i.category === 'Restauration' && i.label?.trim());
        rows.push(...restaurItems.map((i: any) =>
          newRow({ date: defaultDate, label: `${i.quantity}× ${i.label}`, type: 'repas' })
        ));
      }
      setProgrammeRows(rows);

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

  const handleSave = async () => {
    if (!leadId || saving) return;
    setSaving(true);
    const hotelId = lead?.hotel_id || localStorage.getItem('selectedHotelId');
    const payload = {
      lead_id: leadId,
      hotel_id: hotelId,
      programme:          JSON.stringify(programmeRows),
      notes_housekeeping: fiche.notes_generales || null,
      notes_reception:    fiche.notes_gaetan || null,
      notes_food:         fiche.notes_facturation || null,
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

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Top bar ── */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => window.history.back()} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-all">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="text-sm font-black text-gray-900">{lead.nom_client}</div>
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{lead.titre_demande} · {dateLabel}{dateFinLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <BlobProvider document={<FichePDF data={pdfData} />}>
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
            <BlobProvider document={<CombinedPDF ficheData={pdfData} quoteData={combinedPdfData} />}>
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
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-5 h-9 rounded-xl text-xs font-black bg-gray-900 text-white hover:bg-gray-800 transition-all disabled:opacity-50">
            {saved ? <CheckCircle className="w-3.5 h-3.5" /> : saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saved ? 'Enregistré' : saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-8 py-8 space-y-6">

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
  return (
    <Field label={label}>
      <textarea value={value} onChange={e => onChange(e.target.value)}
        placeholder="Notes…" rows={3}
        className="nt-input w-full rounded-xl px-3 py-2 border text-sm outline-none resize-none" />
    </Field>
  );
}

export default function FichePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-teal-600" /></div>}>
      <FicheContent />
    </Suspense>
  );
}
