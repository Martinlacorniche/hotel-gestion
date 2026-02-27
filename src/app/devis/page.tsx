'use client';
import { useAuth } from '@/context/AuthContext';
import { useState, useMemo, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient'; 
import { 
  Plus, Trash2, FileText, Send, AlertCircle, 
  ArrowLeft, Calculator, Calendar, User, Building2, MapPin,
  StickyNote, Loader2, CheckCircle, Mail
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

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [client, setClient] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [location, setLocation] = useState('Telo Segreto');
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
    return lines.reduce((acc, line) => {
      const ttc = (line.quantity || 0) * (line.unitPriceTTC || 0);
      const ht = getHTFromTTC(ttc, line.tvaRate || 10);
      return { ht: acc.ht + ht, tva: acc.tva + (ttc - ht), ttc: acc.ttc + ttc };
    }, { ht: 0, tva: 0, ttc: 0 });
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
      .update({ 
        commentaires: `Salle souhaitée : ${location}\n${teamNotes}`,
        date_evenement: date 
      })
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
    margin: 10mm !important; 
  }
  @media print {
    /* Force l'affichage complet du texte */
    .designation-cell {
      white-space: normal !important;
      word-wrap: break-word !important;
      overflow: visible !important;
      height: auto !important;
      display: table-cell !important;
      line-height: 1.4 !important;
    }
    
    /* Cache les éléments de saisie au print pour ne voir que le texte propre */
    .print-hidden-input { display: none !important; }
    .print-show-text { display: block !important; }

    table { table-layout: auto !important; }
    tr { page-break-inside: avoid !important; } /* Évite de couper une ligne en deux entre deux pages */
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
      <div className="max-w-5xl mx-auto flex justify-between items-center mb-6 print:hidden">
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

      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 print:border-none print:shadow-none">
            <div className="flex justify-between items-start mb-8">
                <div>
                    <h1 className="text-3xl font-black text-slate-800 uppercase italic leading-none">Devis</h1>
                    <p className="text-slate-400 text-[10px] font-black uppercase mt-1">
                      REF : {quoteNumber || 'EN COURS'}
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

            <div className="grid grid-cols-2 gap-10 border-t border-slate-100 pt-6">
              <div className="space-y-3">
                <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">Client</span>
                <div className="space-y-1">
                    <div className="flex items-center gap-2 font-black text-slate-800 text-base"><User className="w-4 h-4 text-slate-300"/> {client?.nom_client}</div>
                    {/* Affiche la société SEULEMENT si elle existe */}
                    {client?.societe && (
                        <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
                            <Building2 className="w-4 h-4 text-slate-300"/> {client.societe}
                        </div>
                    )}
                    <div className="text-xs text-slate-400 font-medium ml-6 italic">{client?.email}</div>
                </div>
              </div>
              <div className="space-y-3 border-l pl-10 border-slate-50">
                <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">Événement</span>
                <div className="space-y-1">
                    <div className="flex items-center gap-2 font-bold text-slate-800 text-sm">
                        <Calendar className="w-4 h-4 text-slate-300"/> 
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-transparent border-none p-0 focus:ring-0 font-bold"/>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-600 font-medium">
                        <MapPin className="w-4 h-4 text-slate-300"/> 
                        <select value={location} onChange={(e) => setLocation(e.target.value)} className="bg-transparent border-none p-0 focus:ring-0 text-sm font-medium">
                            <option>Telo Segreto</option><option>Telo Maritimo</option><option>Patio Tropical</option><option>Telo Intimo</option>
                        </select>
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
        {/* DATE : Visible à l'édition et stylisée au print */}
        <td className="p-3 align-top">
          <div className="print:hidden">
            <Input 
              type="date" 
              value={l.date || date} 
              onChange={(e) => setLines(lines.map(x => x.id === l.id ? {...x, date: e.target.value} : x))}
              className="border-none bg-transparent font-bold h-7 focus:ring-0 p-1 text-[10px] text-indigo-600"
            />
          </div>
          <div className="hidden print:block text-[8px] text-indigo-500 font-black uppercase">
            {l.date ? new Date(l.date).toLocaleDateString('fr-FR', {day: '2-digit', month: '2-digit'}) : '--'}
          </div>
        </td>
        
        {/* DÉSIGNATION : Supporte les textes longs avec retour à la ligne */}
        <td className="p-3 relative align-top designation-cell">
  {/* MODE ÉDITION (Caché au print) */}
  <div className="print-hidden-input">
    <textarea
      rows={1}
      value={l.label} 
      placeholder="Saisir un article..."
      onFocus={() => setShowSuggestions(l.id)}
      onBlur={() => setTimeout(() => setShowSuggestions(null), 200)}
      onChange={(e) => {
        const val = e.target.value;
        setLines(lines.map(x => x.id === l.id ? {...x, label: val} : x));
        setShowSuggestions(l.id);
        // Auto-resize dynamique pour l'écran
        e.target.style.height = 'auto';
        e.target.style.height = e.target.scrollHeight + 'px';
      }}
      className="w-full border-none bg-transparent font-bold focus:ring-0 p-1 resize-none overflow-hidden min-h-[28px] leading-tight"
    />
  </div>

  {/* MODE PRINT (Caché à l'écran, visible au PDF) */}
  <div className="hidden print-show-text text-slate-800 font-bold leading-relaxed italic">
    {l.label}
  </div>

  {/* LE RESTE (Suggestions) NE CHANGE PAS */}
  {showSuggestions === l.id && l.label.length >= 1 && (
    <div className="absolute left-0 top-full w-full bg-white border border-slate-200 rounded-xl shadow-2xl z-[100] max-h-48 overflow-y-auto print:hidden">
      {catalog
        .filter(item => item.name.toLowerCase().includes(l.label.toLowerCase()))
        .map(item => (
          <button
            key={item.id}
            className="w-full text-left px-4 py-2 text-xs font-bold hover:bg-indigo-50 flex justify-between items-center border-b border-slate-50 last:border-none"
            onClick={() => {
              setLines(lines.map(x => x.id === l.id ? {
                ...x, 
                label: item.name, 
                unitPriceTTC: item.price_ttc, 
                tvaRate: item.tva 
              } : x));
              setShowSuggestions(null);
            }}
          >
            <span>{item.name}</span>
            <span className="text-indigo-600">{item.price_ttc} €</span>
          </button>
        ))}
    </div>
  )}
</td>

        <td className="p-3 align-top">
          <Input type="number" value={l.quantity} onChange={(e) => setLines(lines.map(x => x.id === l.id ? {...x, quantity: parseInt(e.target.value) || 0} : x))} className="w-full text-center font-bold bg-transparent border-none focus:ring-0 h-7 p-0"/>
        </td>
        
        <td className="p-3 align-top text-right font-bold text-slate-600">
          <div className="print:hidden">
            <Input type="number" value={l.unitPriceTTC} onChange={(e) => setLines(lines.map(x => x.id === l.id ? {...x, unitPriceTTC: parseFloat(e.target.value) || 0} : x))} className="w-full text-right bg-transparent border-none focus:ring-0 font-bold h-7 p-0"/>
          </div>
          <div className="hidden print:block">{l.unitPriceTTC.toFixed(2)} €</div>
        </td>

        <td className="p-3 align-top text-center">
          <select value={l.tvaRate} onChange={(e) => setLines(lines.map(x => x.id === l.id ? {...x, tvaRate: parseFloat(e.target.value)} : x))} className="bg-transparent border-none text-[10px] font-black focus:ring-0 p-0 cursor-pointer">
            <option value={10}>10%</option>
            <option value={20}>20%</option>
            <option value={5.5}>5.5%</option>
          </select>
        </td>

        <td className="p-3 align-top text-right font-black text-slate-800">
          {(l.quantity * l.unitPriceTTC).toFixed(2)} €
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
        <div key={i} className="flex gap-3 border-b border-slate-50 pb-1 print:border-none print:pb-0">
          <span className="text-[10px] font-black text-indigo-300 pt-1 print:hidden">0{i+1}</span>
          <input 
            className="flex-1 bg-transparent border-none text-xs font-medium focus:ring-0 p-0 print:text-[9px] print:italic print:text-slate-500" 
            value={term} 
            onChange={(e) => { const nt = [...cancellationTerms]; nt[i] = e.target.value; setCancellationTerms(nt); }}
          />
        </div>
      ))}
    </div>
    
    {/* ZONE DE SIGNATURE : Uniquement au print */}
    <div className="hidden print:flex mt-6 border-2 border-dashed border-slate-100 h-20 w-64 items-center justify-center rounded-2xl bg-slate-50/50">
      <span className="text-[9px] font-black text-slate-300 uppercase tracking-tighter text-center">
        Bon pour accord<br/>(Cachet et Signature)
      </span>
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
          <section className="bg-slate-900 text-white p-8 rounded-3xl shadow-2xl sticky top-8 border-t-4 border-indigo-500">
            <div className="flex items-center gap-2 mb-8 text-xl font-black italic uppercase tracking-tighter"><Calculator className="w-5 h-5 text-indigo-400" /> Total Devis</div>
            <div className="space-y-4">
              <div className="flex justify-between text-slate-400 font-bold uppercase text-[10px] tracking-widest"><span>Total HT</span><span>{totals.ht.toLocaleString(undefined, {minimumFractionDigits: 2})} €</span></div>
              <div className="flex justify-between text-slate-400 font-bold uppercase text-[10px] tracking-widest"><span>Total TVA</span><span>{totals.tva.toLocaleString(undefined, {minimumFractionDigits: 2})} €</span></div>
              <div className="pt-6 border-t border-slate-800 mt-6 flex justify-between items-end">
                <span className="text-xs font-black uppercase text-indigo-400">Total TTC</span>
                <span className="text-4xl font-black text-white">{totals.ttc.toLocaleString(undefined, {minimumFractionDigits: 2})} €</span>
              </div>
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full mt-10 bg-indigo-500 hover:bg-indigo-400 text-white h-14 rounded-2xl font-black uppercase tracking-widest shadow-lg shadow-indigo-500/20 active:scale-95 transition-all">Sauvegarder</Button>
          </section>
        </aside>

        <div className="hidden print:block col-span-2 mt-16 border-t-4 border-slate-900 pt-8">
            <div className="flex justify-end gap-16 text-right">
                <div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Net HT</p><p className="text-xl font-bold">{totals.ht.toFixed(2)} €</p></div>
                <div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">TVA</p><p className="text-xl font-bold">{totals.tva.toFixed(2)} €</p></div>
                <div><p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Total TTC</p><p className="text-4xl font-black text-slate-900">{totals.ttc.toFixed(2)} €</p></div>
            </div>
            <div className="mt-20 text-[9px] text-slate-400 font-medium leading-relaxed border-t pt-4">
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

      <div className="p-6 max-h-[60vh] overflow-y-auto space-y-2">
        {catalog.length === 0 && <div className="text-center py-10 text-slate-400 text-xs font-bold uppercase italic">Le catalogue est vide</div>}
        
        {catalog.map((item) => (
          <div key={item.id} className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl hover:border-indigo-200 transition-all group">
            <div className="flex flex-col">
              <span className="text-sm font-black text-slate-700">{item.name}</span>
              <span className="text-[10px] font-bold text-indigo-500 uppercase">{item.price_ttc} € TTC — TVA {item.tva}%</span>
            </div>
            <div className="flex gap-2">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-slate-300 hover:text-indigo-600"
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
                  className="text-slate-300 hover:text-red-600"
                  onClick={async () => {
                    if(confirm("Supprimer ?")) {
                        await supabase.from('articles').delete().eq('id', item.id);
                        setCatalog(catalog.filter(i => i.id !== item.id));
                    }
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="p-6 bg-slate-50 border-t border-slate-100">
        <h3 className="text-[10px] font-black text-slate-400 uppercase mb-3 tracking-widest">Ajouter une prestation</h3>
        <div className="flex gap-2">
          <Input id="new-item-name" placeholder="Nom (ex: Chambre Confort)" className="flex-1 text-xs font-bold h-10 shadow-sm" />
          <Input id="new-item-price" type="number" placeholder="Prix TTC" className="w-24 text-xs font-bold h-10 shadow-sm" />
          <Button 
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-[10px] px-4"
            onClick={async () => {
              const nameEl = document.getElementById('new-item-name') as HTMLInputElement;
              const priceEl = document.getElementById('new-item-price') as HTMLInputElement;
              if (nameEl.value && priceEl.value) {
                const { data } = await supabase.from('articles').insert([{
                  hotel_id: hotel?.id || localStorage.getItem('selectedHotelId'),
                  name: nameEl.value,
                  price_ttc: parseFloat(priceEl.value),
                  tva: 10
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