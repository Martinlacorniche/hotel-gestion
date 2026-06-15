'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { confirmDialog } from '@/components/ConfirmDialog';
import {
  Wind, Plus, Trash2, Loader2, Clock, Euro, BedDouble,
  AlertTriangle, ListChecks, ArrowLeft, Pencil, X, ImagePlus, Check,
} from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const BUCKET = 'clim-photos';

// Espaces des Voiles (aligné sur ROOM_OPTIONS_VOILES du module maintenance)
const SPACES = [
  'Lobby', 'Rooftop', 'Cuisine', 'Machinerie',
  '11', '12', '14', '15', '16', '21', '22', '23', '24', '25',
  '31', '32', '33', '34', '35', '36',
  'Patio',
];

type Impact = 'faible' | 'moyen' | 'fort';

interface Incident {
  id: string;
  hotel_id: string;
  occurred_at: string;
  space: string;
  description: string;
  work_minutes: number;
  cost_eur: number;
  satisfaction_impact: Impact;
  room_blocked: boolean;
  night_price_eur: number;
  nights_blocked: number;
  photos: string[];
  created_by_name: string | null;
}

interface Hotel { id: string; nom: string }

const IMPACT_META: Record<Impact, { label: string; cls: string; dot: string }> = {
  faible: { label: 'Faible', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  moyen: { label: 'Moyen', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  fort: { label: 'Fort', cls: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
};

// yyyy-MM-ddTHH:mm pour <input datetime-local>, en heure locale
function toLocalInput(d: Date) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function euro(n: number) {
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

// Extrait le chemin storage depuis une URL publique getPublicUrl
function pathFromPublicUrl(url: string): string | null {
  const marker = `/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : url.slice(i + marker.length);
}

export default function ClimPage() {
  const { user, isLoading } = useAuth();
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [selectedHotelId, setSelectedHotelId] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Formulaire (sert à la création ET à l'édition)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [occurredAt, setOccurredAt] = useState(toLocalInput(new Date()));
  const [space, setSpace] = useState('');
  const [customSpace, setCustomSpace] = useState('');
  const [description, setDescription] = useState('');
  const [workMinutes, setWorkMinutes] = useState('');
  const [cost, setCost] = useState('');
  const [impact, setImpact] = useState<Impact>('faible');
  const [roomBlocked, setRoomBlocked] = useState(false);
  const [nightPrice, setNightPrice] = useState('');
  const [nightsBlocked, setNightsBlocked] = useState('1');
  const [existingPhotos, setExistingPhotos] = useState<string[]>([]); // URLs déjà enregistrées
  const [newFiles, setNewFiles] = useState<File[]>([]);                // fichiers à uploader
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // --- Chargement hôtels (superadmin = tous, sinon le sien) ---
  useEffect(() => {
    if (!user) return;
    (async () => {
      const isSuperadmin = user.role === 'superadmin';
      const base = supabase.from('hotels').select('id, nom').order('nom');
      const userHotelId = user.hotel_id || user.default_hotel_id;
      const { data } = isSuperadmin ? await base : await base.eq('id', userHotelId || '');
      const list = (data || []) as Hotel[];
      setHotels(list);
      setSelectedHotelId(userHotelId || list[0]?.id || null);
    })();
  }, [user]);

  const loadIncidents = useCallback(async (hotelId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('clim_incidents')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('occurred_at', { ascending: false });
    if (error) toast.error('Chargement : ' + error.message);
    setIncidents((data || []) as Incident[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedHotelId) loadIncidents(selectedHotelId);
  }, [selectedHotelId, loadIncidents]);

  function resetForm() {
    setEditingId(null);
    setOccurredAt(toLocalInput(new Date()));
    setSpace('');
    setCustomSpace('');
    setDescription('');
    setWorkMinutes('');
    setCost('');
    setImpact('faible');
    setRoomBlocked(false);
    setNightPrice('');
    setNightsBlocked('1');
    setExistingPhotos([]);
    setNewFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function startEdit(inc: Incident) {
    setEditingId(inc.id);
    setOccurredAt(toLocalInput(new Date(inc.occurred_at)));
    if (SPACES.includes(inc.space)) {
      setSpace(inc.space);
      setCustomSpace('');
    } else {
      setSpace('__autre__');
      setCustomSpace(inc.space);
    }
    setDescription(inc.description);
    setWorkMinutes(inc.work_minutes ? String(inc.work_minutes) : '');
    setCost(Number(inc.cost_eur) ? String(inc.cost_eur) : '');
    setImpact(inc.satisfaction_impact);
    setRoomBlocked(inc.room_blocked);
    setNightPrice(inc.room_blocked && Number(inc.night_price_eur) ? String(inc.night_price_eur) : '');
    setNightsBlocked(inc.nights_blocked ? String(inc.nights_blocked) : '1');
    setExistingPhotos(inc.photos || []);
    setNewFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function addFiles(files: FileList | null) {
    if (!files) return;
    setNewFiles(prev => [...prev, ...Array.from(files)]);
  }

  async function uploadNewFiles(): Promise<string[]> {
    const urls: string[] = [];
    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${selectedHotelId}/${toLocalInput(new Date()).replace(/[:T-]/g, '')}-${i}-${Math.round(file.size % 100000)}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
      if (error) { toast.error(`Photo "${file.name}" : ${error.message}`); continue; }
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      urls.push(data.publicUrl);
    }
    return urls;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !selectedHotelId) return;

    const finalSpace = (space === '__autre__' ? customSpace : space).trim();
    if (!finalSpace) return toast.error('Indique la chambre ou l’espace concerné.');
    if (!description.trim()) return toast.error('Décris ce qui s’est passé.');

    const nightPriceNum = parseFloat(nightPrice) || 0;
    const nightsNum = parseInt(nightsBlocked) || 0;
    if (roomBlocked && nightPriceNum <= 0) {
      return toast.error('Chambre bloquée : indique le prix de la nuit.');
    }

    setSaving(true);
    const uploaded = await uploadNewFiles();
    const photos = [...existingPhotos, ...uploaded];

    const payload = {
      hotel_id: selectedHotelId,
      occurred_at: new Date(occurredAt).toISOString(),
      space: finalSpace,
      description: description.trim(),
      work_minutes: parseInt(workMinutes) || 0,
      cost_eur: parseFloat(cost) || 0,
      satisfaction_impact: impact,
      room_blocked: roomBlocked,
      night_price_eur: roomBlocked ? nightPriceNum : 0,
      nights_blocked: roomBlocked ? Math.max(1, nightsNum) : 0,
      photos,
    };

    if (editingId) {
      const { data, error } = await supabase
        .from('clim_incidents')
        .update(payload)
        .eq('id', editingId)
        .select()
        .single();
      setSaving(false);
      if (error) return toast.error('Modification : ' + error.message);
      setIncidents(prev => prev.map(i => (i.id === editingId ? (data as Incident) : i)));
      resetForm();
      toast.success('Incident modifié');
    } else {
      const { data, error } = await supabase
        .from('clim_incidents')
        .insert({ ...payload, created_by: user.id, created_by_name: user.name || user.email || null })
        .select()
        .single();
      setSaving(false);
      if (error) return toast.error('Enregistrement : ' + error.message);
      setIncidents(prev => [data as Incident, ...prev]);
      resetForm();
      toast.success('Incident enregistré');
    }
  }

  async function handleDelete(inc: Incident) {
    const ok = await confirmDialog({
      title: 'Supprimer cet incident ?',
      message: `${inc.space} — ${format(new Date(inc.occurred_at), 'dd/MM/yyyy', { locale: fr })}`,
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    // Nettoie les photos du storage (best-effort)
    const paths = (inc.photos || []).map(pathFromPublicUrl).filter(Boolean) as string[];
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
    const { error } = await supabase.from('clim_incidents').delete().eq('id', inc.id);
    if (error) return toast.error('Suppression : ' + error.message);
    setIncidents(prev => prev.filter(i => i.id !== inc.id));
    if (editingId === inc.id) resetForm();
  }

  // --- Statistiques ---
  const stats = useMemo(() => {
    const totalCost = incidents.reduce((s, i) => s + Number(i.cost_eur), 0);
    const totalLost = incidents.reduce((s, i) => s + Number(i.night_price_eur) * i.nights_blocked, 0);
    const totalMinutes = incidents.reduce((s, i) => s + i.work_minutes, 0);
    const impactCount: Record<Impact, number> = { faible: 0, moyen: 0, fort: 0 };
    const bySpace = new Map<string, { count: number; cost: number; lost: number }>();
    for (const i of incidents) {
      impactCount[i.satisfaction_impact]++;
      const cur = bySpace.get(i.space) || { count: 0, cost: 0, lost: 0 };
      cur.count++;
      cur.cost += Number(i.cost_eur);
      cur.lost += Number(i.night_price_eur) * i.nights_blocked;
      bySpace.set(i.space, cur);
    }
    const spaceRows = [...bySpace.entries()]
      .map(([space, v]) => ({ space, ...v }))
      .sort((a, b) => b.count - a.count);
    return { totalCost, totalLost, totalMinutes, impactCount, spaceRows };
  }, [incidents]);

  if (isLoading) {
    return <div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }
  if (!user) return <div className="p-8 text-center text-slate-500">Authentification requise.</div>;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        {/* Header */}
        <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-slate-700 transition">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-sky-100 text-sky-700">
              <Wind className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-slate-800">Suivi Clim</h1>
              <p className="text-sm text-slate-500">Journal des incidents de climatisation · onglet temporaire</p>
            </div>
          </div>
          {hotels.length > 1 && (
            <select
              value={selectedHotelId || ''}
              onChange={e => setSelectedHotelId(e.target.value)}
              className="border rounded-lg px-3 h-11 text-sm bg-white"
            >
              {hotels.map(h => <option key={h.id} value={h.id}>{h.nom}</option>)}
            </select>
          )}
        </header>

        {/* Stats recap */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StatCard icon={ListChecks} color="text-sky-600 bg-sky-50" label="Incidents" value={String(incidents.length)} />
          <StatCard icon={Euro} color="text-rose-600 bg-rose-50" label="Coût réparations" value={euro(stats.totalCost)} />
          <StatCard icon={BedDouble} color="text-amber-600 bg-amber-50" label="Manque à gagner" value={euro(stats.totalLost)} />
          <StatCard icon={Clock} color="text-violet-600 bg-violet-50" label="Temps passé" value={`${Math.round(stats.totalMinutes / 60 * 10) / 10} h`} />
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Formulaire (création / édition) */}
          <div ref={formRef} className="lg:col-span-1 self-start scroll-mt-4">
            <Card className={editingId ? 'ring-2 ring-sky-400' : ''}>
              <CardContent className="p-5">
                <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  {editingId ? <><Pencil className="w-4 h-4" /> Modifier l’incident</> : <><Plus className="w-4 h-4" /> Nouvel incident</>}
                </h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <Field label="Date / heure">
                    <input
                      type="datetime-local"
                      value={occurredAt}
                      onChange={e => setOccurredAt(e.target.value)}
                      className="w-full border rounded-lg px-3 h-11 text-sm bg-white"
                    />
                  </Field>

                  <Field label="Chambre / espace">
                    <select
                      value={space}
                      onChange={e => setSpace(e.target.value)}
                      className="w-full border rounded-lg px-3 h-11 text-sm bg-white"
                    >
                      <option value="">— Choisir —</option>
                      {SPACES.map(s => <option key={s} value={s}>{s}</option>)}
                      <option value="__autre__">Autre…</option>
                    </select>
                    {space === '__autre__' && (
                      <input
                        value={customSpace}
                        onChange={e => setCustomSpace(e.target.value)}
                        placeholder="Préciser l’espace"
                        className="mt-2 w-full border rounded-lg px-3 h-11 text-sm bg-white"
                      />
                    )}
                  </Field>

                  <Field label="Ce qui s’est passé">
                    <textarea
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      rows={3}
                      placeholder="Ex : clim qui ne refroidit plus, bruit anormal…"
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white resize-y"
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Temps (min)">
                      <input
                        type="number" min="0" inputMode="numeric"
                        value={workMinutes}
                        onChange={e => setWorkMinutes(e.target.value)}
                        placeholder="0"
                        className="w-full border rounded-lg px-3 h-11 text-sm bg-white"
                      />
                    </Field>
                    <Field label="Coût (€)">
                      <input
                        type="number" min="0" step="0.01" inputMode="decimal"
                        value={cost}
                        onChange={e => setCost(e.target.value)}
                        placeholder="0"
                        className="w-full border rounded-lg px-3 h-11 text-sm bg-white"
                      />
                    </Field>
                  </div>

                  <Field label="Impact satisfaction">
                    <div className="grid grid-cols-3 gap-2">
                      {(Object.keys(IMPACT_META) as Impact[]).map(k => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setImpact(k)}
                          className={`h-11 rounded-lg border text-sm font-medium transition ${
                            impact === k ? IMPACT_META[k].cls + ' ring-2 ring-offset-1 ring-current' : 'bg-white text-slate-500 border-slate-200'
                          }`}
                        >
                          {IMPACT_META[k].label}
                        </button>
                      ))}
                    </div>
                  </Field>

                  {/* Photos */}
                  <Field label="Photos">
                    <div className="flex flex-wrap gap-2">
                      {existingPhotos.map(url => (
                        <div key={url} className="relative w-16 h-16">
                          <img src={url} alt="" className="w-16 h-16 object-cover rounded-lg border" />
                          <button
                            type="button"
                            onClick={() => setExistingPhotos(prev => prev.filter(u => u !== url))}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center shadow"
                            title="Retirer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      {newFiles.map((f, idx) => (
                        <div key={idx} className="relative w-16 h-16">
                          <img src={URL.createObjectURL(f)} alt="" className="w-16 h-16 object-cover rounded-lg border" />
                          <span className="absolute inset-x-0 bottom-0 text-[9px] bg-sky-600 text-white text-center rounded-b-lg">nouveau</span>
                          <button
                            type="button"
                            onClick={() => setNewFiles(prev => prev.filter((_, i) => i !== idx))}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center shadow"
                            title="Retirer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-16 h-16 rounded-lg border-2 border-dashed border-slate-300 text-slate-400 flex items-center justify-center hover:border-sky-400 hover:text-sky-500 transition"
                        title="Ajouter des photos"
                      >
                        <ImagePlus className="w-5 h-5" />
                      </button>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      capture="environment"
                      onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
                      className="hidden"
                    />
                  </Field>

                  {/* Chambre bloquée */}
                  <div className="rounded-lg border border-slate-200 p-3">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={roomBlocked}
                        onChange={e => setRoomBlocked(e.target.checked)}
                        className="w-5 h-5 accent-amber-600"
                      />
                      <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                        <BedDouble className="w-4 h-4 text-amber-600" /> Chambre bloquée (hors service)
                      </span>
                    </label>
                    {roomBlocked && (
                      <div className="grid grid-cols-2 gap-3 mt-3">
                        <Field label="Prix de la nuit (€) *">
                          <input
                            type="number" min="0" step="0.01" inputMode="decimal"
                            value={nightPrice}
                            onChange={e => setNightPrice(e.target.value)}
                            placeholder="ex : 180"
                            className="w-full border rounded-lg px-3 h-11 text-sm bg-white"
                          />
                        </Field>
                        <Field label="Nb de nuits">
                          <input
                            type="number" min="1" inputMode="numeric"
                            value={nightsBlocked}
                            onChange={e => setNightsBlocked(e.target.value)}
                            className="w-full border rounded-lg px-3 h-11 text-sm bg-white"
                          />
                        </Field>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    {editingId && (
                      <Button type="button" variant="outline" onClick={resetForm} className="h-11">
                        Annuler
                      </Button>
                    )}
                    <Button type="submit" disabled={saving} className="flex-1 h-11">
                      {saving
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : editingId
                          ? <><Check className="w-4 h-4 mr-1" /> Mettre à jour</>
                          : <><Plus className="w-4 h-4 mr-1" /> Enregistrer</>}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Journal + stats par espace */}
          <div className="lg:col-span-2 space-y-6">
            {/* Répartition impact + par espace */}
            <Card>
              <CardContent className="p-5">
                <h2 className="font-semibold text-slate-800 mb-4">Par chambre / espace</h2>
                <div className="flex flex-wrap gap-2 mb-4">
                  {(Object.keys(IMPACT_META) as Impact[]).map(k => (
                    <span key={k} className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${IMPACT_META[k].cls}`}>
                      <span className={`w-2 h-2 rounded-full ${IMPACT_META[k].dot}`} />
                      {IMPACT_META[k].label} : {stats.impactCount[k]}
                    </span>
                  ))}
                </div>
                {stats.spaceRows.length === 0 ? (
                  <p className="text-sm text-slate-400">Aucun incident pour le moment.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-slate-400 border-b">
                          <th className="py-2 font-medium">Espace</th>
                          <th className="py-2 font-medium text-right">Incidents</th>
                          <th className="py-2 font-medium text-right">Coût</th>
                          <th className="py-2 font-medium text-right">Manque à gagner</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.spaceRows.map(r => (
                          <tr key={r.space} className="border-b last:border-0">
                            <td className="py-2 font-medium text-slate-700">{r.space}</td>
                            <td className="py-2 text-right">{r.count}</td>
                            <td className="py-2 text-right">{euro(r.cost)}</td>
                            <td className="py-2 text-right text-amber-700">{r.lost > 0 ? euro(r.lost) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Journal chronologique */}
            <Card>
              <CardContent className="p-5">
                <h2 className="font-semibold text-slate-800 mb-4">Journal</h2>
                {loading ? (
                  <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
                ) : incidents.length === 0 ? (
                  <p className="text-sm text-slate-400">Aucun incident enregistré.</p>
                ) : (
                  <ul className="space-y-3">
                    {incidents.map(inc => (
                      <li key={inc.id} className={`rounded-lg border p-3 flex gap-3 ${editingId === inc.id ? 'border-sky-400 bg-sky-50/40' : 'border-slate-200'}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-semibold text-slate-800">{inc.space}</span>
                            <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${IMPACT_META[inc.satisfaction_impact].cls}`}>
                              {IMPACT_META[inc.satisfaction_impact].label}
                            </span>
                            {inc.room_blocked && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                                <AlertTriangle className="w-3 h-3" /> Bloquée
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-slate-600 whitespace-pre-wrap break-words">{inc.description}</p>

                          {inc.photos?.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2">
                              {inc.photos.map(url => (
                                <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                                  <img src={url} alt="" className="w-16 h-16 object-cover rounded-lg border hover:opacity-80 transition" />
                                </a>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-2 text-xs text-slate-500">
                            <span>{format(new Date(inc.occurred_at), "dd/MM/yyyy 'à' HH'h'mm", { locale: fr })}</span>
                            {inc.work_minutes > 0 && <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{inc.work_minutes} min</span>}
                            {Number(inc.cost_eur) > 0 && <span className="inline-flex items-center gap-1"><Euro className="w-3 h-3" />{euro(Number(inc.cost_eur))}</span>}
                            {inc.room_blocked && (
                              <span className="inline-flex items-center gap-1 text-amber-700">
                                <BedDouble className="w-3 h-3" />
                                {inc.nights_blocked} nuit{inc.nights_blocked > 1 ? 's' : ''} · {euro(Number(inc.night_price_eur) * inc.nights_blocked)} perdus
                              </span>
                            )}
                            {inc.created_by_name && <span className="text-slate-400">· {inc.created_by_name}</span>}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 self-start">
                          <button
                            onClick={() => startEdit(inc)}
                            className="text-slate-300 hover:text-sky-600 transition"
                            title="Modifier"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(inc)}
                            className="text-slate-300 hover:text-rose-600 transition"
                            title="Supprimer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
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
    </div>
  );
}

function StatCard({ icon: Icon, color, label, value }: { icon: any; color: string; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`flex items-center justify-center w-10 h-10 rounded-lg shrink-0 ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500 truncate">{label}</p>
          <p className="text-lg font-semibold text-slate-800 truncate">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500 mb-1 block">{label}</span>
      {children}
    </label>
  );
}
