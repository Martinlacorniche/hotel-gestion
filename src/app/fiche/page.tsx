'use client';
import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { FichePDF } from './FichePDF';
import { ArrowLeft, Download, Save, Loader2, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const DISPOSITIONS = ['Théâtre', 'En U', 'Cabaret', 'Banquet', 'Cocktail', 'Classe', 'Boardroom'];

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

  const [fiche, setFiche] = useState({
    nb_personnes: '',
    programme: '',
    disposition_salle: 'Théâtre',
    materiel: '',
    heure_petitdej: '',
    heure_pause_matin: '',
    heure_dejeuner: '',
    heure_pause_aprem: '',
    heure_diner: '',
    regimes_speciaux: '',
    notes_housekeeping: '',
    notes_reception: '',
    notes_direction: '',
    notes_food: '',
    notes_night: '',
  });

  useEffect(() => {
    if (!leadId) return;
    async function load() {
      setLoading(true);

      // Lead
      const { data: leadData } = await supabase.from('suivi_commercial').select('*').eq('id', leadId).single();
      if (leadData) setLead(leadData);

      // Hotel
      const hotelId = leadData?.hotel_id || localStorage.getItem('selectedHotelId');
      if (hotelId) {
        const { data: hotelData } = await supabase.from('hotels').select('*').eq('id', hotelId).single();
        if (hotelData) setHotel(hotelData);
      }

      // Réservations salles
      const { data: resaData } = await supabase
        .from('seminar_reservations')
        .select('*, seminar_rooms(name)')
        .eq('lead_id', leadId);
      if (resaData) setRooms(resaData.map((r: any) => ({ ...r, room_name: r.seminar_rooms?.name })));

      // Quote items
      const { data: quoteData } = await supabase
        .from('quotes')
        .select('*, quote_items(*)')
        .eq('lead_id', leadId)
        .maybeSingle();
      if (quoteData?.quote_items) setQuoteItems(quoteData.quote_items);

      // Fiche existante
      const { data: ficheData } = await supabase
        .from('fiches_fonctions')
        .select('*')
        .eq('lead_id', leadId)
        .maybeSingle();
      if (ficheData) {
        setFicheId(ficheData.id);
        setFiche({
          nb_personnes:       ficheData.nb_personnes ?? '',
          programme:          ficheData.programme ?? '',
          disposition_salle:  ficheData.disposition_salle ?? 'Théâtre',
          materiel:           ficheData.materiel ?? '',
          heure_petitdej:     ficheData.heure_petitdej ?? '',
          heure_pause_matin:  ficheData.heure_pause_matin ?? '',
          heure_dejeuner:     ficheData.heure_dejeuner ?? '',
          heure_pause_aprem:  ficheData.heure_pause_aprem ?? '',
          heure_diner:        ficheData.heure_diner ?? '',
          regimes_speciaux:   ficheData.regimes_speciaux ?? '',
          notes_housekeeping: ficheData.notes_housekeeping ?? '',
          notes_reception:    ficheData.notes_reception ?? '',
          notes_direction:    ficheData.notes_direction ?? '',
          notes_food:         ficheData.notes_food ?? '',
          notes_night:        ficheData.notes_night ?? '',
        });
      }

      setLoading(false);
    }
    load();
  }, [leadId]);

  const handleSave = async () => {
    if (!leadId || saving) return;
    setSaving(true);
    const hotelId = lead?.hotel_id || localStorage.getItem('selectedHotelId');
    const payload = {
      lead_id: leadId,
      hotel_id: hotelId,
      nb_personnes:       fiche.nb_personnes ? Number(fiche.nb_personnes) : null,
      programme:          fiche.programme || null,
      disposition_salle:  fiche.disposition_salle || null,
      materiel:           fiche.materiel || null,
      heure_petitdej:     fiche.heure_petitdej || null,
      heure_pause_matin:  fiche.heure_pause_matin || null,
      heure_dejeuner:     fiche.heure_dejeuner || null,
      heure_pause_aprem:  fiche.heure_pause_aprem || null,
      heure_diner:        fiche.heure_diner || null,
      regimes_speciaux:   fiche.regimes_speciaux || null,
      notes_housekeeping: fiche.notes_housekeeping || null,
      notes_reception:    fiche.notes_reception || null,
      notes_direction:    fiche.notes_direction || null,
      notes_food:         fiche.notes_food || null,
      notes_night:        fiche.notes_night || null,
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

  const pdfData = {
    lead, hotel, rooms, quoteItems, fiche,
    ficheDate: format(new Date(), 'dd/MM/yyyy', { locale: fr }),
  };

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
          <PDFDownloadLink
            document={<FichePDF data={pdfData} />}
            fileName={`fiche-${lead.nom_client.toLowerCase().replace(/\s+/g, '-')}.pdf`}
          >
            {({ loading: pdfLoading }) => (
              <button disabled={pdfLoading} className="flex items-center gap-1.5 px-4 h-9 rounded-xl text-xs font-black border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 transition-all disabled:opacity-50">
                <Download className="w-3.5 h-3.5" />
                {pdfLoading ? 'Génération…' : 'Télécharger PDF'}
              </button>
            )}
          </PDFDownloadLink>
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-5 h-9 rounded-xl text-xs font-black bg-gray-900 text-white hover:bg-gray-800 transition-all disabled:opacity-50">
            {saved ? <CheckCircle className="w-3.5 h-3.5" /> : saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saved ? 'Enregistré' : saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* ── Infos auto (lecture seule) ── */}
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
            {quoteItems.length > 0 && (
              <div>
                <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Prestations devis</div>
                {quoteItems.filter((i: any) => i.label?.trim()).map((i: any, idx: number) => (
                  <div key={idx} className="text-xs text-gray-700">{i.quantity}× {i.label}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Général ── */}
        <Section title="Général" color="teal">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nombre de participants">
              <input type="number" min="1" value={fiche.nb_personnes} onChange={e => set('nb_personnes', e.target.value)}
                placeholder="ex. 30" className="nt-input w-full h-9 rounded-xl px-3 border text-sm outline-none" />
            </Field>
            <Field label="Disposition de salle">
              <select value={fiche.disposition_salle} onChange={e => set('disposition_salle', e.target.value)}
                className="nt-select w-full h-9 rounded-xl px-3 border text-sm outline-none">
                {DISPOSITIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Matériel requis">
            <input value={fiche.materiel} onChange={e => set('materiel', e.target.value)}
              placeholder="Projecteur, micro HF, paperboard, sono…" className="nt-input w-full h-9 rounded-xl px-3 border text-sm outline-none" />
          </Field>
          <Field label="Programme / notes générales">
            <textarea value={fiche.programme} onChange={e => set('programme', e.target.value)}
              placeholder="Agenda libre, informations particulières…" rows={3}
              className="nt-input w-full rounded-xl px-3 py-2 border text-sm outline-none resize-none" />
          </Field>
        </Section>

        {/* ── Horaires repas ── */}
        <Section title="Food & Beverage — Horaires" color="green">
          <div className="grid grid-cols-5 gap-3">
            {[
              { key: 'heure_petitdej',    label: 'Petit-déj' },
              { key: 'heure_pause_matin', label: 'Pause matin' },
              { key: 'heure_dejeuner',    label: 'Déjeuner' },
              { key: 'heure_pause_aprem', label: 'Pause aprem' },
              { key: 'heure_diner',       label: 'Dîner' },
            ].map(({ key, label }) => (
              <Field key={key} label={label}>
                <input type="time" value={(fiche as any)[key]} onChange={e => set(key, e.target.value)}
                  className="nt-input w-full h-9 rounded-xl px-2 border text-sm outline-none" />
              </Field>
            ))}
          </div>
          <Field label="Régimes spéciaux / allergies">
            <textarea value={fiche.regimes_speciaux} onChange={e => set('regimes_speciaux', e.target.value)}
              placeholder="Sans gluten, végétarien, allergies noix…" rows={2}
              className="nt-input w-full rounded-xl px-3 py-2 border text-sm outline-none resize-none" />
          </Field>
          <NoteField label="Notes Food & Bev" value={fiche.notes_food} onChange={v => set('notes_food', v)} />
        </Section>

        {/* ── Housekeeping ── */}
        <Section title="Housekeeping" color="blue">
          <NoteField label="Notes & instructions" value={fiche.notes_housekeeping} onChange={v => set('notes_housekeeping', v)} />
        </Section>

        {/* ── Réception ── */}
        <Section title="Réception" color="purple">
          <NoteField label="Notes & instructions" value={fiche.notes_reception} onChange={v => set('notes_reception', v)} />
        </Section>

        {/* ── Direction ── */}
        <Section title="Direction" color="amber">
          <NoteField label="Notes & instructions" value={fiche.notes_direction} onChange={v => set('notes_direction', v)} />
        </Section>

        {/* ── Night ── */}
        <Section title="Night" color="slate">
          <NoteField label="Notes & instructions" value={fiche.notes_night} onChange={v => set('notes_night', v)} />
        </Section>

      </div>
    </div>
  );
}

// ── Petits composants UI ──

const SECTION_COLORS: Record<string, { border: string; title: string; dot: string }> = {
  teal:   { border: 'border-teal-200',   title: 'text-teal-700',   dot: 'bg-teal-500' },
  green:  { border: 'border-green-200',  title: 'text-green-700',  dot: 'bg-green-500' },
  blue:   { border: 'border-blue-200',   title: 'text-blue-700',   dot: 'bg-blue-500' },
  purple: { border: 'border-purple-200', title: 'text-purple-700', dot: 'bg-purple-500' },
  amber:  { border: 'border-amber-200',  title: 'text-amber-700',  dot: 'bg-amber-500' },
  slate:  { border: 'border-gray-200',   title: 'text-gray-700',   dot: 'bg-gray-400' },
};

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  const c = SECTION_COLORS[color] || SECTION_COLORS.slate;
  return (
    <div className={`bg-white rounded-2xl border ${c.border} overflow-hidden`}>
      <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-2">
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
        placeholder="Notes pour ce service…" rows={3}
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
