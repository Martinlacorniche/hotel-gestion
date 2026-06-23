'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '@/context/AuthContext';
import { useSelectedHotel } from '@/context/SelectedHotelContext';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import {
  CreditCard, Loader2, Search, Copy, Link2, Send,
  RotateCcw, Mail, ExternalLink, ChevronLeft, ChevronRight,
} from 'lucide-react';

interface Hotel { id: string; nom: string }
interface Payment {
  id: string; hotel_id: string | null; type: string;
  amount: number; currency: string; description: string | null;
  client_nom: string | null; email: string | null; status: string;
  hosted_invoice_url: string | null; created_at: string; paid_at: string | null; refunded_at: string | null;
  created_by: string | null; refunded_by: string | null; refund_reason: string | null;
  pms_done: boolean;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  open:     { label: 'En attente', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  paid:     { label: 'Réglé',      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  failed:   { label: 'Refusé',     cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  refunded: { label: 'Remboursé',  cls: 'bg-slate-100 text-slate-600 border-slate-300' },
  canceled: { label: 'Annulé',     cls: 'bg-slate-50 text-slate-400 border-slate-200' },
};

const euro = (n: number) => Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` };
}

export default function EncaissementPage() {
  const { user, isLoading } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';

  const [hotels, setHotels] = useState<Hotel[]>([]);
  // Hôtel sélectionné = contexte global (synchro sidebar + autres pages).
  const { selectedHotelId: hotelId, setSelectedHotelId: setHotelId } = useSelectedHotel();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  // Formulaire
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [clientNom, setClientNom] = useState('');
  const [email, setEmail] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [creating, setCreating] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);

  // Historique : navigation par jour + recherche globale
  const ymd = (d: Date) => { const o = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return o.toISOString().slice(0, 10); };
  const todayStr = ymd(new Date());
  const [day, setDay] = useState<string>(todayStr);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('Tous');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refundTarget, setRefundTarget] = useState<Payment | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const searching = debouncedSearch.trim().length > 0;

  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search), 300); return () => clearTimeout(t); }, [search]);
  const shiftDay = (delta: number) => setDay(prev => ymd(new Date(new Date(prev + 'T12:00:00').getTime() + delta * 86400000)));

  useEffect(() => {
    if (!user) return;
    (async () => {
      const base = supabase.from('hotels').select('id, nom').order('nom');
      const uh = user.hotel_id || user.default_hotel_id;
      const { data } = isSuperadmin ? await base : await base.eq('id', uh || '');
      const list = (data || []) as Hotel[];
      setHotels(list);
      // Le contexte a déjà restauré l'hôtel ; on ne fixe un défaut que si vide.
      if (!hotelId) setHotelId(uh || list[0]?.id || '');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isSuperadmin]);

  const loadPayments = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('payments').select('*').order('created_at', { ascending: false });
    const term = debouncedSearch.trim();
    if (term) {
      // Recherche dans TOUT l'historique : nom / email / description / montant
      const safe = term.replace(/[,()*]/g, ' ').trim();
      const ors = [`client_nom.ilike.*${safe}*`, `email.ilike.*${safe}*`, `description.ilike.*${safe}*`];
      const num = parseFloat(safe.replace(',', '.'));
      if (!isNaN(num)) ors.push(`amount.eq.${num}`);
      q = q.or(ors.join(',')).limit(300);
    } else {
      // Un jour précis (par défaut aujourd'hui)
      const next = ymd(new Date(new Date(day + 'T12:00:00').getTime() + 86400000));
      q = q.gte('created_at', `${day}T00:00:00`).lt('created_at', `${next}T00:00:00`);
    }
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setPayments((data || []) as Payment[]);
    setLoading(false);
  }, [day, debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (user) loadPayments(); }, [user, loadPayments]);

  async function createPayment(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount.replace(',', '.'));
    if (!amt || amt <= 0) return toast.error('Indique un montant.');
    if (sendEmail && !email.trim()) return toast.error('Email requis pour envoyer la demande.');
    setCreating(true);
    setLastLink(null);
    try {
      const res = await fetch('/api/paiements/create', {
        method: 'POST', headers: await authHeaders(),
        body: JSON.stringify({ hotelId, amount: amt, description, email: email.trim(), clientNom: clientNom.trim(), sendEmail }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erreur');
      setLastLink(json.url);
      if (sendEmail && json.emailed) toast.success('Demande envoyée par email');
      else if (sendEmail && !json.emailed) toast.error('Lien créé, mais email NON envoyé : ' + (json.emailError || 'raison inconnue'), { duration: 8000 });
      else toast.success('Lien de paiement créé');
      setAmount(''); setDescription(''); setClientNom(''); setEmail('');
      await loadPayments();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setCreating(false);
    }
  }

  async function doRefund() {
    if (!refundTarget) return;
    if (!refundReason.trim()) return toast.error('Indique un motif de remboursement.');
    const p = refundTarget;
    setBusyId(p.id);
    try {
      const res = await fetch('/api/paiements/refund', {
        method: 'POST', headers: await authHeaders(),
        body: JSON.stringify({ paymentId: p.id, reason: refundReason.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erreur');
      toast.success('Remboursement effectué');
      setRefundTarget(null); setRefundReason('');
      await loadPayments();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusyId(null);
    }
  }

  async function togglePms(p: Payment, done: boolean) {
    setBusyId(p.id);
    setPayments(prev => prev.map(x => x.id === p.id ? { ...x, pms_done: done } : x)); // optimiste
    try {
      const res = await fetch('/api/paiements/pms', {
        method: 'POST', headers: await authHeaders(), body: JSON.stringify({ paymentId: p.id, done }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Erreur');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
      await loadPayments();
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink(url: string) {
    try { await navigator.clipboard.writeText(url); toast.success('Lien copié'); }
    catch { toast.error('Copie impossible'); }
  }

  const filtered = useMemo(
    () => payments.filter(p => {
      if (statusFilter === 'Tous') return true;
      if (statusFilter === 'a_saisir') return p.status === 'paid' && !p.pms_done;
      return p.status === statusFilter;
    }),
    [payments, statusFilter],
  );
  const total = filtered.reduce((s, p) => s + (p.status === 'paid' ? Number(p.amount) : 0), 0);

  if (isLoading) return <div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!user) return <div className="p-8 text-center text-slate-500">Authentification requise.</div>;
  // Accès géré par le ShiftContext : admins/superadmins tout le temps,
  // rôle "user" uniquement pendant son service (shift ± 2h).

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <PageHeader
          icon={CreditCard}
          title="Encaissement"
          subtitle="Demande de paiement par carte — lien Stripe envoyé au client"
          iconClassName="bg-emerald-100 text-emerald-700"
        />

        {/* Formulaire */}
        <Card className="mb-6">
          <CardContent className="p-5">
            <form onSubmit={createPayment} className="space-y-4">
              <div className="grid md:grid-cols-3 gap-4">
                <label className="block">
                  <span className="text-xs font-medium text-slate-500 mb-1 block">Montant (€) *</span>
                  <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="230"
                    className="w-full border rounded-lg px-3 h-11 text-sm bg-white" />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-xs font-medium text-slate-500 mb-1 block">Description</span>
                  <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Acompte séminaire, chambre…"
                    className="w-full border rounded-lg px-3 h-11 text-sm bg-white" />
                </label>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-xs font-medium text-slate-500 mb-1 block">Client</span>
                  <input value={clientNom} onChange={e => setClientNom(e.target.value)} placeholder="Nom du client"
                    className="w-full border rounded-lg px-3 h-11 text-sm bg-white" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-500 mb-1 block">Email {sendEmail && '*'}</span>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="client@exemple.fr"
                    className="w-full border rounded-lg px-3 h-11 text-sm bg-white" />
                </label>
              </div>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} className="w-5 h-5 accent-emerald-600" />
                  <span className="text-sm text-slate-700 flex items-center gap-1.5"><Mail className="w-4 h-4 text-emerald-600" /> Envoyer la demande par email au client</span>
                </label>
                <Button type="submit" disabled={creating} className="h-11">
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4 mr-1.5" /> {sendEmail ? 'Créer & envoyer' : 'Créer le lien'}</>}
                </Button>
              </div>
            </form>

            {lastLink && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
                <Link2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-xs text-slate-600 truncate flex-1">{lastLink}</span>
                <button onClick={() => copyLink(lastLink)} className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1 shrink-0"><Copy className="w-3.5 h-3.5" /> Copier</button>
                <a href={lastLink} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1 shrink-0">Ouvrir <ExternalLink className="w-3 h-3" /></a>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Historique */}
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex gap-1 p-1 rounded-xl bg-white border border-slate-200">
            {['Tous', 'open', 'paid', 'a_saisir', 'refunded'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${statusFilter === s ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                {s === 'Tous' ? 'Tous' : s === 'a_saisir' ? 'À saisir PMS' : STATUS[s].label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Navigation par jour (masquée pendant une recherche globale) */}
            {!searching && (
              <div className="flex items-center gap-1">
                <button onClick={() => shiftDay(-1)} title="Jour précédent" className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><ChevronLeft className="w-4 h-4" /></button>
                <input type="date" value={day} max={todayStr} onChange={e => setDay(e.target.value || todayStr)} className="border rounded-lg px-2 h-9 text-sm bg-white" />
                <button onClick={() => shiftDay(1)} disabled={day >= todayStr} title="Jour suivant" className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"><ChevronRight className="w-4 h-4" /></button>
                {day !== todayStr && <button onClick={() => setDay(todayStr)} className="text-xs font-semibold text-emerald-700 ml-1">Aujourd&apos;hui</button>}
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-300" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher dans tout l'historique…"
                className="border rounded-lg pl-9 pr-3 h-9 text-sm bg-white w-72" />
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-400 mb-2">
          {searching
            ? `Recherche dans tout l'historique — ${filtered.length} résultat${filtered.length > 1 ? 's' : ''}`
            : `${day === todayStr ? "Aujourd'hui" : new Date(day + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} — ${filtered.length} paiement${filtered.length > 1 ? 's' : ''}`}
          {total > 0 && <span className="text-emerald-600 font-semibold"> · {euro(total)} réglés</span>}
        </p>

        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="p-2"><EmptyState icon={CreditCard} title="Aucun paiement" subtitle="Aucun paiement à afficher pour cette période." /></CardContent></Card>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
            {filtered.map(p => {
              const st = STATUS[p.status] || STATUS.open;
              return (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800">{euro(p.amount)}</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                      {p.description && <span className="text-sm text-slate-500 truncate">· {p.description}</span>}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 truncate">
                      {p.client_nom || '—'}{p.email ? ` · ${p.email}` : ''} · {new Date(p.created_at).toLocaleDateString('fr-FR')}
                      {p.created_by ? ` · créé par ${p.created_by}` : ''}
                    </div>
                    {p.status === 'refunded' && (p.refunded_by || p.refund_reason) && (
                      <div className="text-xs text-rose-500 mt-0.5 truncate">
                        Remboursé{p.refunded_by ? ` par ${p.refunded_by}` : ''}{p.refund_reason ? ` — ${p.refund_reason}` : ''}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {p.hosted_invoice_url && (
                      <>
                        <button onClick={() => copyLink(p.hosted_invoice_url!)} title="Copier le lien" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><Copy className="w-4 h-4" /></button>
                        <a href={p.hosted_invoice_url} target="_blank" rel="noopener noreferrer" title="Ouvrir" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><ExternalLink className="w-4 h-4" /></a>
                      </>
                    )}
                    {p.status === 'paid' && (
                      <label className={`text-xs inline-flex items-center gap-1.5 cursor-pointer px-2.5 h-8 rounded-lg border ${p.pms_done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`} title="Saisi dans le PMS (Hotsoft / Mews) ?">
                        <input type="checkbox" checked={p.pms_done} disabled={busyId === p.id} onChange={e => togglePms(p, e.target.checked)} className="w-3.5 h-3.5 accent-emerald-600" />
                        {p.pms_done ? 'Traité PMS' : 'À saisir PMS'}
                      </label>
                    )}
                    {p.status === 'paid' && (
                      <button onClick={() => { setRefundTarget(p); setRefundReason(''); }} disabled={busyId === p.id} title="Rembourser"
                        className="text-xs px-2.5 h-8 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 inline-flex items-center gap-1">
                        <RotateCcw className="w-3.5 h-3.5" /> Rembourser
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal remboursement — motif obligatoire */}
      {refundTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={e => { if (e.target === e.currentTarget && busyId !== refundTarget.id) setRefundTarget(null); }}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5">
            <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2 mb-1"><RotateCcw className="w-4 h-4 text-rose-600" /> Rembourser ce paiement</h2>
            <p className="text-sm text-slate-500 mb-4">
              <span className="font-semibold text-slate-700">{euro(refundTarget.amount)}</span>
              {' '}à {refundTarget.client_nom || refundTarget.email || 'ce client'}. Cette action est irréversible.
            </p>
            <label className="block mb-4">
              <span className="text-xs font-medium text-slate-500 mb-1 block">Motif du remboursement *</span>
              <textarea value={refundReason} onChange={e => setRefundReason(e.target.value)} rows={3} autoFocus
                placeholder="Ex. annulation client, erreur de montant…"
                className="w-full border rounded-lg px-3 py-2 text-sm bg-white resize-y" />
            </label>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRefundTarget(null)} disabled={busyId === refundTarget.id}
                className="px-4 h-10 rounded-xl text-sm font-semibold text-slate-500 bg-slate-100 hover:bg-slate-200 transition disabled:opacity-50">Annuler</button>
              <button onClick={doRefund} disabled={busyId === refundTarget.id || !refundReason.trim()}
                className="px-5 h-10 rounded-xl text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 transition disabled:opacity-50 inline-flex items-center gap-1.5">
                {busyId === refundTarget.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Confirmer le remboursement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
