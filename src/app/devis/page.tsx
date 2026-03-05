'use client';
import { useAuth } from '@/context/AuthContext';
import { useState, useMemo, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient'; 
import { 
  Plus, Trash2, FileText, Send, AlertCircle, 
  ArrowLeft, Calculator, Calendar, User, Building2, MapPin,
  StickyNote, Loader2, CheckCircle, Mail, Edit2 // <-- Ajout de Edit2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// --- UTILITAIRES ---
const getHTFromTTC = (ttc: number, rate: number) => ttc / (1 + rate / 100);

const CATALOG_ITEMS = [
  { id: 'h1', category: 'Hébergement', label: 'Chambre Standard', priceTTC: 165, tva: 10 },
  { id: 'h2', category: 'Hébergement', label: 'Chambre Vue Mer', priceTTC: 209, tva: 10 },
  { id: 'm2', category: 'Restauration', label: 'Menu Confort (3 temps)', priceTTC: 41, tva: 10 },
  { id: 's1', category: 'Salle', label: 'Location Telo Segreto', priceTTC: 358.80, tva: 20 },
];

function QuoteEditorContent() {
  
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const leadId = searchParams.get('leadId');
const [quoteDate, setQuoteDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [client, setClient] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [date, setDate] = useState('');
  const [quoteNumber, setQuoteNumber] = useState<number | null>(null);
  const [cancellationTerms, setCancellationTerms] = useState([
    'Versement de l\'acompte 50% non remboursable à la signature.',
    'Annulation et modification sans frais supplémentaire jusqu\'à J-30.',
    'Paiement du solde à réception de facture.'
  ]);
  const [teamNotes, setTeamNotes] = useState('');
  const [hotel, setHotel] = useState<any>(null);
  const [catalog, setCatalog] = useState<any[]>([]);
const [showSuggestions, setShowSuggestions] = useState<string | null>(null);
const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);
const [editingItem, setEditingItem] = useState<any>(null); // <-- NOUVEAU

  // 1. CHARGEMENT
  useEffect(() => {
    if (!leadId) return;
    
    async function loadData() {
      try {
        setLoading(true);
        
        // A. Récupérer le Lead
        const { data: lead, error: leadErr } = await supabase
          .from('suivi_commercial')
          .select('*')
          .eq('id', leadId)
          .single();

        if (leadErr || !lead) throw new Error("Prospect introuvable");
        setClient(lead);
        setDate(lead.date_evenement || '');



        // --- NOUVEAU : Récupérer les infos de l'hôtel ---
        const hId = lead.hotel_id || localStorage.getItem('selectedHotelId');
        if (hId) {
          const { data: hData } = await supabase.from('hotels').select('*').eq('id', hId).single();
          if (hData) setHotel(hData);
        }


        // Récupérer le catalogue d'articles de l'hôtel
const { data: articles } = await supabase
  .from('articles')
  .select('*')
  .eq('hotel_id', hId);
if (articles) setCatalog(articles);


        // B. Trouver le Client Séminaire
        const { data: seminarClient } = await supabase
          .from('seminar_clients')
          .select('id')
          .eq('email', lead.email)
          .maybeSingle();

        if (seminarClient) {
          const { data: quote } = await supabase
            .from('quotes')
            .select('*, quote_items(*)')
            .eq('client_id', seminarClient.id)
            .maybeSingle();

          if (quote) {
            setQuoteNumber(quote.numero);
            setQuoteDate(quote.created_at); // <-- NOUVEAU
            setTeamNotes(quote.comment || '');
            if (quote.cancellation_terms) setCancellationTerms(quote.cancellation_terms);
            if (quote.quote_items) {
  setLines(quote.quote_items
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((i: any) => ({
      id: i.id, 
      label: i.label, 
      quantity: i.quantity, 
      unitPriceTTC: i.unit_price_ttc, 
      tvaRate: i.tva_rate,
      date: i.date || date // On récupère la date de la ligne ou celle du devis par défaut
    }))
  );
}
          }
        }
      } catch (err) {
        console.error("Erreur de chargement:", err);
      } finally { 
        setLoading(false); 
      }
    }
    loadData();
  }, [leadId]);

 // 2. CALCULS
  const totals = useMemo(() => {
    let ht = 0, tva = 0, ttc = 0;
    const tvaDetails: Record<number, { ht: number, tva: number }> = {};

    lines.forEach((line) => {
      const lineTtc = (line.quantity || 0) * (line.unitPriceTTC || 0);
      const rate = line.tvaRate || 10;
      const lineHt = getHTFromTTC(lineTtc, rate);
      const lineTva = lineTtc - lineHt;

      ht += lineHt;
      tva += lineTva;
      ttc += lineTtc;

      // Ventilation pour le détail TVA du PDF
      if (!tvaDetails[rate]) tvaDetails[rate] = { ht: 0, tva: 0 };
      tvaDetails[rate].ht += lineHt;
      tvaDetails[rate].tva += lineTva;
    });

    return { ht, tva, ttc, tvaDetails };
  }, [lines]);

  // 3. ACTIONS
const handleSave = async () => {
  if (!leadId || !client) return;
  
  const savedHotelId = typeof window !== 'undefined' ? localStorage.getItem('selectedHotelId') : null;
  const hotel_id = client.hotel_id || savedHotelId || user?.hotel_id;

  if (!hotel_id) {
    alert("Erreur : ID Hôtel manquant.");
    return;
  }

  setSaving(true);

  try {

    await supabase
      .from('suivi_commercial')
      .update({ date_evenement: date })
      .eq('id', leadId);
    // --- ÉTAPE 1 : PROMOTION DU PROSPECT EN CLIENT SÉMINAIRE ---
    // On vérifie si ce client (via son email) existe déjà dans seminar_clients
    let seminarClientId;
    
    const { data: existingSeminarClient } = await supabase
      .from('seminar_clients')
      .select('id')
      .eq('email', client.email)
      .eq('hotel_id', hotel_id)
      .maybeSingle();

    if (existingSeminarClient) {
      seminarClientId = existingSeminarClient.id;
    } else {
      // On le crée proprement dans seminar_clients pour respecter la FK
      const { data: newSeminarClient, error: clientError } = await supabase
        .from('seminar_clients')
        .insert([{
          hotel_id: hotel_id,
          nom: client.nom_client, // On mappe le nom du lead
          societe: client.societe,
          email: client.email,
          telephone: client.telephone
        }])
        .select()
        .single();

      if (clientError) throw clientError;
      seminarClientId = newSeminarClient.id;
    }

    // --- ÉTAPE 2 : SAUVEGARDE DU DEVIS (QUOTES) ---
    const quoteData = {
      hotel_id: hotel_id,
      client_id: seminarClientId, // On utilise l'ID de seminar_clients, pas celui du lead
      comment: teamNotes,
      status: 'draft',
      start_date: date || null,
      end_date: date || null,
      cancellation_terms: cancellationTerms,
    };

    let quoteId;
    
    // On cherche si un devis existe pour ce client précis
    const { data: existingQuote } = await supabase
      .from('quotes')
      .select('id')
      .eq('client_id', seminarClientId)
      .maybeSingle();

    if (existingQuote) {
      const { error: updateError } = await supabase
        .from('quotes')
        .update(quoteData)
        .eq('id', existingQuote.id);
      if (updateError) throw updateError;
      quoteId = existingQuote.id;
    } else {
      const { data: newQuote, error: insertError } = await supabase
        .from('quotes')
        .insert([quoteData])
        .select()
        .single();
      if (insertError) throw insertError;
      quoteId = newQuote.id;
      setQuoteNumber(newQuote.numero);
    }

    // --- ÉTAPE 3 : LIGNES DU DEVIS (QUOTE_ITEMS) ---
    await supabase.from('quote_items').delete().eq('quote_id', quoteId);

    if (lines.length > 0) {
      const itemsToInsert = lines.map((l, index) => ({
        quote_id: quoteId,
        label: l.label,
        quantity: parseInt(l.quantity) || 0,
        unit_price_ttc: parseFloat(l.unitPriceTTC) || 0,
        tva_rate: parseFloat(l.tvaRate) || 10,
        sort_order: index
      }));

      const { error: itemsError } = await supabase.from('quote_items').insert(itemsToInsert);
      if (itemsError) throw itemsError;
    }

    alert("Devis enregistré et Client synchronisé !");
  } catch (err: any) {
    console.error("Détail erreur:", err);
    alert(`Erreur : ${err.message}`);
  } finally {
    setSaving(false);
  }
};

  const handleSendMail = () => {
    const refLabel = quoteNumber ? `REF : ${quoteNumber}` : 'REF : EN COURS';
    const subject = encodeURIComponent(`Proposition commerciale ${refLabel} - ${client?.nom_client}`);
    const body = encodeURIComponent(
      `Bonjour ${client?.nom_client},\n\n` +
      `Veuillez trouver ci-joint notre proposition commerciale ${refLabel} pour votre événement prévu le ${date}.\n\n` +
      `Montant total : ${totals.ttc.toFixed(2)}€ TTC.\n\n` +
      `Cordialement,\n\n` +
      `Service Commercial - La Corniche`
    );
    window.location.href = `mailto:${client?.email}?subject=${subject}&body=${body}`;
  };

  if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-indigo-600" /></div>;

<style dangerouslySetInnerHTML={{ __html: `
  @page { 
    size: A4; 
    margin: 8mm !important; 
  }
  @media print {
    body { background: white !important; font-size: 10pt; }
    .print-hidden-input, .print\:hidden { display: none !important; }
    
    /* Éviter que les sections sautent de page inutilement */
    section, .print-container { page-break-inside: avoid !important; }
    
    /* On réduit les paddings pour gagner de la place */
    .p-6 { padding: 0.5rem !important; }
    .mb-8 { margin-bottom: 1rem !important; }
    
    /* Suppression des bordures inutiles et ombres */
    .shadow-sm, .border { border: none !important; box-shadow: none !important; }
    
    /* Forcer le rendu des couleurs d'impression */
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
` }} />

const handlePrint = () => {
  // Construction du nom : Nom client - Numero - Nom Hôtel
  const fileName = `${client?.nom_client || 'Client'}-${quoteNumber || 'EN_COURS'}-${hotel?.nom || 'La_Corniche'}`;
  
  const originalTitle = document.title;
  document.title = fileName; // Change le titre pour le nom du fichier
  
  window.print();
  
  document.title = originalTitle; // Restaure le titre original après impression
};

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-900 font-sans print:bg-white print:p-0">
      <div className="print-container">

      </div>
     <div className="max-w-7xl mx-auto flex justify-between items-center mb-6 print:hidden">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 font-bold hover:text-slate-800 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>
        <div className="flex gap-3">
          <Button onClick={handlePrint} variant="outline" className="bg-white border-slate-200 font-bold shadow-sm">
            <FileText className="w-4 h-4 mr-2" /> PDF
          </Button>
          <Button onClick={handleSendMail} variant="outline" className="bg-white border-indigo-200 text-indigo-600 font-bold shadow-sm hover:bg-indigo-50">
            <Mail className="w-4 h-4 mr-2" /> Mail
          </Button>
          <Button onClick={handleSave} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-widest px-6 shadow-lg shadow-indigo-200">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
            Sauvegarder
          </Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-6 xl:gap-8">
        <div className="lg:col-span-2 xl:col-span-3 space-y-6"> 
          
          
          
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 print:border-none print:shadow-none">
            <div className="flex justify-between items-start mb-8">
                <div>
            
                    <h1 className="text-3xl font-black text-slate-800 uppercase italic leading-none">Devis</h1>
                    <p className="text-slate-400 text-[10px] font-black uppercase mt-1">
                      REF : {quoteNumber || 'EN COURS'} 
                      {quoteDate && ` — ÉDITÉ LE ${new Date(quoteDate).toLocaleDateString('fr-FR')}`}
                    </p>
                </div>
                <div className="text-right">
    <div className="text-lg font-black text-indigo-600 uppercase italic">
        {hotel?.nom || 'Chargement...'}
    </div>
    <div className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-tight">
        {/* Pour l'instant on garde l'adresse en dur car elle n'est pas dans ton SQL hotels */}
        17 Littoral Frédéric Mistral<br />
        83000 Toulon, France<br />
        04 94 41 35 12
    </div>
</div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-100 pt-6">
              
              {/* CARTE CLIENT */}
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 space-y-3 print:bg-transparent print:border-none print:p-0">
                <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2 print:hidden"><User className="w-3 h-3"/> Client</span>
                <span className="hidden print:block text-[10px] font-black text-indigo-500 uppercase tracking-widest">Client</span>
                
                <div className="space-y-1">
                    <div className="font-black text-slate-800 text-lg">{client?.nom_client}</div>
                    {client?.societe && (
                        <div className="text-sm text-slate-500 font-bold flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-slate-400 print:hidden"/> {client.societe}
                        </div>
                    )}
                    <div className="text-xs text-slate-400 font-medium flex flex-col gap-0.5 mt-2">
                        {client?.email && <span>{client.email}</span>}
                        {client?.telephone && <span>{client.telephone}</span>}
                    </div>
                </div>
              </div>

              {/* CARTE ÉVÉNEMENT */}
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 space-y-3 print:bg-transparent print:border-none print:p-0">
                <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2 print:hidden"><Calendar className="w-3 h-3"/> Événement</span>
                <span className="hidden print:block text-[10px] font-black text-indigo-500 uppercase tracking-widest">Événement</span>
                
                <div className="space-y-2 pt-0.5">
                    <div className="text-sm font-black text-slate-700 leading-tight">
                        {client?.titre_demande || 'Événement professionnel'}
                    </div>
                    <div className="flex items-center gap-2 font-bold text-slate-800 text-sm mt-2 bg-white print:bg-transparent print:p-0 print:border-none p-2 rounded-lg border border-slate-200 w-fit">
                        <Calendar className="w-4 h-4 text-indigo-400 print:hidden"/> 
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-transparent border-none p-0 focus:ring-0 font-bold text-indigo-700 print:text-slate-800"/>
                    </div>
                </div>
              </div>

            </div>
          </section>

          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden print:border-none print:shadow-none">
        <table className="w-full text-left border-collapse text-xs">
  <thead>
    <tr className="bg-slate-50 border-b border-slate-100 print:hidden">
      <th className="p-4 font-black uppercase text-slate-400 w-32">Date</th>
      <th className="p-4 font-black uppercase text-slate-400">Désignation</th>
      <th className="p-4 font-black uppercase text-slate-400 text-center w-20">Qté</th>
      <th className="p-4 font-black uppercase text-slate-400 text-right w-24">TTC Unit.</th>
      <th className="p-4 font-black uppercase text-slate-400 text-center w-20">TVA</th>
      <th className="p-4 font-black uppercase text-slate-400 text-right w-24">Total TTC</th>
      <th className="p-4 print:hidden w-8"></th>
    </tr>
  </thead>
 <tbody>
    {lines.map((l) => (
      <tr key={l.id} className="border-b border-slate-50 group hover:bg-slate-50/50">
        
        <td className="p-3 align-top">
          <div className="print:hidden">
            <Input type="date" value={l.date || date} onChange={(e) => setLines(lines.map(x => x.id === l.id ? {...x, date: e.target.value} : x))} className="border-none bg-transparent font-bold h-7 focus:ring-0 p-1 text-[10px] text-indigo-600" />
          </div>
          <div className="hidden print:block text-[8px] text-indigo-500 font-black uppercase pt-1">
            {l.date ? new Date(l.date).toLocaleDateString('fr-FR', {day: '2-digit', month: '2-digit'}) : '--'}
          </div>
        </td>
        
        <td className="p-3 relative align-top">
          <div className="print:hidden">
            <textarea
              ref={(el) => { 
                if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } 
              }}
              value={l.label} 
              placeholder="Saisir un article..."
              onFocus={() => setShowSuggestions(l.id)}
              onBlur={() => setTimeout(() => setShowSuggestions(null), 200)}
              onChange={(e) => {
                setLines(lines.map(x => x.id === l.id ? {...x, label: e.target.value} : x));
                setShowSuggestions(l.id);
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              className="w-full border-none bg-transparent font-bold focus:ring-0 p-1 resize-none overflow-hidden min-h-[32px] leading-tight"
            />
            {showSuggestions === l.id && l.label.length >= 1 && (
              <div className="absolute left-0 top-full w-full bg-white border border-slate-200 rounded-xl shadow-2xl z-[100] max-h-48 overflow-y-auto">
                {catalog
                  .filter(item => item.name.toLowerCase().includes(l.label.toLowerCase()))
                  .map(item => (
                    <button
                      key={item.id}
                      className="w-full text-left px-4 py-2 text-xs font-bold hover:bg-indigo-50 flex justify-between items-center border-b border-slate-50 last:border-none"
                      onClick={() => {
                        setLines(lines.map(x => x.id === l.id ? { ...x, label: item.name, unitPriceTTC: item.price_ttc, tvaRate: item.tva } : x));
                        setShowSuggestions(null);
                      }}
                    >
                      <span>{item.name}</span>
                      <span className="text-indigo-600">{item.price_ttc} €</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
          <div className="hidden print:block text-slate-800 font-bold leading-normal italic whitespace-pre-wrap break-words pt-1">
            {l.label}
          </div>
        </td>

        <td className="p-3 align-top text-center">
          <div className="print:hidden">
            <Input type="number" value={l.quantity} onChange={(e) => setLines(lines.map(x => x.id === l.id ? {...x, quantity: parseInt(e.target.value) || 0} : x))} className="w-full text-center font-bold bg-transparent border-none focus:ring-0 h-7 p-0"/>
          </div>
          <div className="hidden print:block font-bold pt-1">{l.quantity}</div>
        </td>
        
        <td className="p-3 align-top text-right font-bold text-slate-600">
          <div className="print:hidden">
            <Input type="number" step="0.01" value={l.unitPriceTTC} onChange={(e) => setLines(lines.map(x => x.id === l.id ? {...x, unitPriceTTC: parseFloat(e.target.value) || 0} : x))} className="w-full text-right bg-transparent border-none focus:ring-0 font-bold h-7 p-0"/>
          </div>
          <div className="hidden print:block pt-1">{l.unitPriceTTC.toFixed(2)} €</div>
        </td>

        <td className="p-3 align-top text-center">
          <div className="print:hidden">
            <select value={l.tvaRate} onChange={(e) => setLines(lines.map(x => x.id === l.id ? {...x, tvaRate: parseFloat(e.target.value)} : x))} className="bg-transparent border-none text-[10px] font-black focus:ring-0 p-0 cursor-pointer">
              <option value={10}>10%</option>
              <option value={20}>20%</option>
              <option value={5.5}>5.5%</option>
              <option value={0}>0%</option>
            </select>
          </div>
          <div className="hidden print:block text-[10px] font-black pt-1">{l.tvaRate}%</div>
        </td>

        <td className="p-3 align-top text-right font-black text-slate-800">
          <div className="pt-1">{(l.quantity * l.unitPriceTTC).toFixed(2)} €</div>
        </td>

        <td className="p-3 align-top text-right print:hidden">
          <button onClick={() => setLines(lines.filter(x => x.id !== l.id))} className="text-slate-200 hover:text-red-500 transition-colors p-1">
            <Trash2 className="w-4 h-4"/>
          </button>
        </td>
      </tr>
    ))}
  </tbody>
</table>
            {/* REMPLACEMENT LIGNE 254 */}
<div className="p-4 bg-slate-50/30 flex justify-between items-center border-t border-slate-100 print:hidden">
    <div className="flex gap-3">
        <Button 
          onClick={() => setLines([...lines, { id: Math.random().toString(36).substr(2,9), label: '', quantity: 1, unitPriceTTC: 0, tvaRate: 10 }])} 
          variant="ghost" 
          className="text-indigo-600 font-bold text-xs border border-dashed border-indigo-200 hover:bg-indigo-50"
        >
          <Plus className="w-4 h-4 mr-2" /> Ligne Libre
        </Button>

        <Button 
          variant="outline" 
          size="sm" 
          className="text-[10px] font-black uppercase border-slate-200 text-slate-500 hover:text-indigo-600"
          onClick={() => setIsCatalogModalOpen(true)}
        >
          <StickyNote className="w-4 h-4 mr-2" /> Gérer le Catalogue
        </Button>
    </div>

    <p className="text-[10px] font-bold text-slate-400 uppercase italic">

    </p>
</div>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <section className="bg-white p-6 rounded-2xl border border-slate-200 print:border-none print:p-0 print:mt-4">
    <h2 className="text-[10px] font-black uppercase text-indigo-500 mb-4 tracking-widest">Conditions Particulières</h2>
    <div className="space-y-2">
      {cancellationTerms.map((term, i) => (
        <div key={i} className="flex gap-3 border-b border-slate-50 pb-1 print:border-none print:pb-0 print:mb-1">
          <span className="text-[10px] font-black text-indigo-300 pt-1 print:hidden">0{i+1}</span>
          
          <div className="print:hidden w-full">
            <textarea 
              ref={(el) => { 
                if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } 
              }}
              className="w-full bg-transparent border-none text-xs font-medium focus:ring-0 p-0 resize-none overflow-hidden" 
              value={term} 
              onChange={(e) => { 
                  const nt = [...cancellationTerms]; nt[i] = e.target.value; setCancellationTerms(nt); 
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
              }}
            />
          </div>
          
          <div className="hidden print:block text-[9px] italic text-slate-500 whitespace-pre-wrap leading-relaxed w-full">
            {term}
          </div>
        </div>
      ))}
    </div>
    
    {/* ZONE DE SIGNATURE ET RIB : Uniquement au print */}
    <div className="hidden print:flex justify-between items-start mt-8">
      <div className="border-2 border-dashed border-slate-100 h-24 w-64 flex items-center justify-center rounded-2xl bg-slate-50/50">
        <span className="text-[9px] font-black text-slate-300 uppercase tracking-tighter text-center">
          Bon pour accord<br/>(Cachet et Signature)
        </span>
      </div>
      
      <div className="text-right">
        <h3 className="text-[9px] font-black uppercase text-slate-400 mb-1">Coordonnées Bancaires (RIB)</h3>
        <p className="text-[8px] text-slate-500 leading-tight font-medium">
          Banque : Crédit Cooperatif<br/>
          IBAN : FR76 4255 9100 0008 0284 3567 534<br/>
          BIC : CCOPFRPPXXX
        </p>
      </div>
    </div>
  </section>

  <section className="bg-amber-50 p-6 rounded-2xl border border-amber-100 print:hidden">
    <h2 className="text-[10px] font-black uppercase text-amber-600 mb-4 flex items-center gap-2">
      <StickyNote className="w-4 h-4" /> Notes de l'équipe (Interne)
    </h2>
    <textarea 
      className="w-full bg-white/60 border border-amber-200 rounded-xl p-3 text-xs min-h-[80px] focus:ring-2 focus:ring-amber-500 outline-none font-medium" 
      placeholder="Notes internes..." 
      value={teamNotes} 
      onChange={(e) => setTeamNotes(e.target.value)}
    />
  </section>
</div>
        </div>

        <aside className="print:hidden">
          <section className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-200/50 sticky top-8 border border-slate-100">
            <div className="flex items-center gap-2 mb-8 text-xl font-black italic uppercase tracking-tighter text-slate-800">
                <Calculator className="w-5 h-5 text-indigo-500" /> Total Devis
            </div>
            <div className="space-y-4">
              <div className="flex justify-between text-slate-500 font-bold uppercase text-[10px] tracking-widest">
                  <span>Total HT</span>
                  <span className="text-slate-700">{totals.ht.toLocaleString(undefined, {minimumFractionDigits: 2})} €</span>
              </div>
              <div className="flex justify-between text-slate-500 font-bold uppercase text-[10px] tracking-widest">
                  <span>Total TVA</span>
                  <span className="text-slate-700">{totals.tva.toLocaleString(undefined, {minimumFractionDigits: 2})} €</span>
              </div>
              <div className="pt-6 border-t border-slate-100 mt-6 flex flex-col gap-1 items-end">
                <span className="text-[10px] font-black uppercase text-indigo-500 tracking-widest">Total TTC</span>
                <span className="text-4xl font-black text-slate-900">
                    {totals.ttc.toLocaleString(undefined, {minimumFractionDigits: 2})} €
                </span>
              </div>
            </div>
            <Button 
                onClick={handleSave} 
                disabled={saving} 
                className="w-full mt-8 bg-indigo-600 hover:bg-indigo-700 text-white h-14 rounded-2xl font-black uppercase tracking-widest shadow-lg shadow-indigo-200 active:scale-95 transition-all"
            >
                Sauvegarder
            </Button>
          </section>
        </aside>

        {/* PIED DE PAGE ET TOTAUX (PRINT UNIQUEMENT) */}
        <div className="hidden print:block col-span-2 mt-4 pt-4 border-t-2 border-slate-800">
            <div className="flex justify-between items-start gap-8">
                
                {/* DÉTAIL TVA À GAUCHE */}
                <div className="text-left flex-1">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Détail TVA</p>
                    {Object.entries(totals.tvaDetails).map(([rate, vals]) => (
                        <div key={rate} className="text-[8px] text-slate-500 flex justify-between w-40 border-b border-slate-100 pb-0.5 mb-0.5">
                            <span>TVA {rate}% (sur {vals.ht.toFixed(2)})</span>
                            <span>{vals.tva.toFixed(2)}€</span>
                        </div>
                    ))}
                </div>

                {/* RECAP PRIX À DROITE */}
                <div className="w-48 space-y-1">
                    <div className="flex justify-between text-[10px] font-bold text-slate-500">
                        <span>Total HT</span><span>{totals.ht.toFixed(2)} €</span>
                    </div>
                    <div className="flex justify-between text-[10px] font-bold text-slate-500">
                        <span>TVA</span><span>{totals.tva.toFixed(2)} €</span>
                    </div>
                    <div className="flex justify-between items-end border-t border-slate-200 pt-1 mt-1">
                        <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">TTC</span>
                        <span className="text-lg font-black text-slate-900 leading-none">{totals.ttc.toFixed(2)} €</span>
                    </div>
                </div>
            </div>

            {/* MENTIONS LÉGALES */}
            <div className="mt-8 text-[7px] text-slate-400 font-medium leading-relaxed text-center">
                <p>Hôtel La Corniche - 17 Littoral Frédéric Mistral 83000 Toulon - 04 94 41 35 12 - contact@hotel-corniche.com</p>
                <p>SARL au capital de 10 000€ - Siret : 341 797 199 00013 - TVA : FR50341797199 - RCS : 87800562</p>
            </div>
        </div>
      </div>
    {/* MODAL DE GESTION DU CATALOGUE */}
{isCatalogModalOpen && (
  <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-in fade-in duration-200">
    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <div>
          <h2 className="text-xl font-black text-slate-800 uppercase italic">Catalogue Articles</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Gérer vos prestations et tarifs types</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setIsCatalogModalOpen(false)} className="rounded-full w-8 h-8 p-0">✕</Button>
      </div>

      <div className="p-6 max-h-[60vh] overflow-y-auto space-y-6">
        {catalog.length === 0 && <div className="text-center py-10 text-slate-400 text-xs font-bold uppercase italic">Le catalogue est vide</div>}
        
        {/* Tri et regroupement automatique par catégorie */}
        {Object.entries(
            catalog.reduce((acc, item) => {
                const cat = item.category || 'Général';
                if (!acc[cat]) acc[cat] = [];
                acc[cat].push(item);
                return acc;
            }, {} as Record<string, any[]>)
        ).sort(([catA], [catB]) => catA.localeCompare(catB)).map(([category, items]) => (
            <div key={category} className="space-y-2">
                <h3 className="text-[10px] font-black uppercase text-indigo-400 tracking-widest border-b border-slate-100 pb-1">{category}</h3>
                {items.map((item) => (
                  editingItem?.id === item.id ? (
                      /* MODE ÉDITION */
                      <div key={item.id} className="flex flex-wrap gap-2 p-3 bg-indigo-50 border border-indigo-200 rounded-xl items-center">
                          <select 
                              value={editingItem.category || 'Général'} 
                              onChange={e => setEditingItem({...editingItem, category: e.target.value})} 
                              className="w-full sm:w-28 text-xs font-bold h-8 border border-slate-200 rounded px-1 focus:ring-indigo-500"
                          >
                              <option value="Hébergement">Hébergement</option>
                              <option value="Restauration">Restauration</option>
                              <option value="Salles">Salles</option>
                              <option value="Autre">Autre</option>
                              <option value="Général">Général</option>
                          </select>
                          <Input 
                              value={editingItem.name} 
                              onChange={e => setEditingItem({...editingItem, name: e.target.value})} 
                              className="flex-1 text-xs font-bold h-8 px-2 min-w-[120px]" 
                          />
                          <Input 
                              type="number" step="0.01" 
                              value={editingItem.price_ttc} 
                              onChange={e => setEditingItem({...editingItem, price_ttc: parseFloat(e.target.value)})} 
                              className="w-20 text-xs font-bold h-8 px-2" 
                          />
                          <select 
                              value={editingItem.tva} 
                              onChange={e => setEditingItem({...editingItem, tva: parseFloat(e.target.value)})} 
                              className="w-16 text-xs font-bold h-8 border border-slate-200 rounded px-1"
                          >
                              <option value="20">20%</option>
                              <option value="10">10%</option>
                              <option value="5.5">5.5%</option>
                              <option value="0">0%</option>
                          </select>
                          <div className="flex gap-1 w-full sm:w-auto justify-end">
                              <Button 
                                  size="sm" 
                                  className="bg-emerald-500 hover:bg-emerald-600 text-white h-8 px-3 text-[10px] uppercase font-black tracking-widest" 
                                  onClick={async () => {
                                      const { error } = await supabase.from('articles').update({ 
                                          category: editingItem.category, 
                                          name: editingItem.name, 
                                          price_ttc: editingItem.price_ttc, 
                                          tva: editingItem.tva 
                                      }).eq('id', editingItem.id);
                                      
                                      if (!error) {
                                          setCatalog(catalog.map(i => i.id === editingItem.id ? editingItem : i));
                                          setEditingItem(null);
                                      } else {
                                          alert("Erreur lors de la modification");
                                      }
                                  }}
                              >
                                  OK
                              </Button>
                              <Button 
                                  size="sm" 
                                  variant="ghost" 
                                  onClick={() => setEditingItem(null)} 
                                  className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600"
                              >
                                  ✕
                              </Button>
                          </div>
                      </div>
                  ) : (
                      /* MODE LECTURE CLASSIQUE */
                      <div key={item.id} className="flex items-center justify-between p-2 bg-white border border-slate-100 rounded-xl hover:border-indigo-200 transition-all group">
                        <div className="flex flex-col">
                          <span className="text-sm font-black text-slate-700">{item.name}</span>
                          <span className="text-[10px] font-bold text-indigo-500 uppercase">{item.price_ttc} € TTC — TVA {item.tva}%</span>
                        </div>
                        <div className="flex gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-slate-400 hover:text-indigo-600 h-8 w-8 p-0"
                              title="Ajouter au devis"
                              onClick={() => {
                                setLines([...lines, { id: Math.random().toString(36).substr(2,9), label: item.name, quantity: 1, unitPriceTTC: item.price_ttc, tvaRate: item.tva }]);
                                setIsCatalogModalOpen(false);
                              }}
                            >
                              <Plus className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-slate-400 hover:text-amber-500 h-8 w-8 p-0"
                              title="Modifier l'article"
                              onClick={() => setEditingItem(item)}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-slate-400 hover:text-red-600 h-8 w-8 p-0"
                              title="Supprimer"
                              onClick={async () => {
                                if(confirm("Supprimer définitivement cet article du catalogue ?")) {
                                    await supabase.from('articles').delete().eq('id', item.id);
                                    setCatalog(catalog.filter(i => i.id !== item.id));
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>
                      </div>
                  )
                ))}
            </div>
        ))}
      </div>

      <div className="p-6 bg-slate-50 border-t border-slate-100">
        <h3 className="text-[10px] font-black text-slate-400 uppercase mb-3 tracking-widest">Ajouter une prestation</h3>
        <div className="flex flex-wrap gap-2">
          <select id="new-item-cat" className="w-full sm:w-32 text-xs font-bold h-10 border border-slate-200 rounded shadow-sm px-2 focus:ring-indigo-500 focus:border-indigo-500">
              <option value="Hébergement">Hébergement</option>
              <option value="Restauration">Restauration</option>
              <option value="Salles">Salles</option>
              <option value="Autre">Autre</option>
          </select>
          <Input id="new-item-name" placeholder="Nom (ex: Taxe de séjour)" className="flex-1 text-xs font-bold h-10 shadow-sm min-w-[150px]" />
          <Input id="new-item-price" type="number" step="0.01" placeholder="Prix TTC" className="w-24 text-xs font-bold h-10 shadow-sm" />
          <select id="new-item-tva" className="w-20 text-xs font-bold h-10 border border-slate-200 rounded shadow-sm px-2 focus:ring-indigo-500 focus:border-indigo-500" defaultValue="10">
              <option value="20">20%</option>
              <option value="10">10%</option>
              <option value="5.5">5.5%</option>
              <option value="0">0%</option>
          </select>
          <Button 
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-[10px] px-4 h-10 w-full sm:w-auto"
            onClick={async () => {
              const catEl = document.getElementById('new-item-cat') as HTMLSelectElement;
              const nameEl = document.getElementById('new-item-name') as HTMLInputElement;
              const priceEl = document.getElementById('new-item-price') as HTMLInputElement;
              const tvaEl = document.getElementById('new-item-tva') as HTMLSelectElement;
              
              if (nameEl.value && priceEl.value) {
                const { data } = await supabase.from('articles').insert([{
                  hotel_id: hotel?.id || localStorage.getItem('selectedHotelId'),
                  category: catEl.value,
                  name: nameEl.value,
                  price_ttc: parseFloat(priceEl.value),
                  tva: parseFloat(tvaEl.value)
                }]).select().single();
                
                if (data) {
                    setCatalog([...catalog, data]);
                    nameEl.value = "";
                    priceEl.value = "";
                }
              }
            }}
          >Ajouter</Button>
        </div>
      </div>
    </div>
  </div>
)}
    </div>
  );
}

export default function QuotePage() {
    return <Suspense fallback={<div className="h-screen flex items-center justify-center font-black uppercase text-slate-300">Chargement...</div>}><QuoteEditorContent /></Suspense>;
}