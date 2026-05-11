'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  KeyRound,
  CreditCard,
  Settings,
  RotateCcw,
  Loader2,
  Check,
  Clock,
  AlertCircle,
  Plus,
} from 'lucide-react';

type Sejour = {
  id: string;
  chambre_id: string;
  debut: string;
  fin: string;
  methode: 'code' | 'carte';
  code: string | null;
  carte_uid: string | null;
  statut: 'pending' | 'actif' | 'revoque' | 'expire';
  parent_sejour_id: string | null;
};
type Chambre = {
  id: string;
  numero: string;
  tthotel_lock_id: number;
  tthotel_lock_alias: string | null;
  ordre: number;
  sejour: Sejour | null;
};

export default function SerruresPage() {
  const [chambres, setChambres] = useState<Chambre[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewChambreId, setViewChambreId] = useState<string | null>(null);
  const [nuits, setNuits] = useState(1);
  const [nbCartes, setNbCartes] = useState(1);
  const [checkoutTime, setCheckoutTime] = useState('11:00');
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [encoding, setEncoding] = useState<{
    sejours: Sejour[];
    jobIds: string[];
    carteIndex: number;
    totalCartes: number;
  } | null>(null);
  const [jobsStatut, setJobsStatut] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch('/api/serrures/chambres', { cache: 'no-store' });
    const json = await res.json();
    if (json.ok) setChambres(json.chambres);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!encoding || encoding.jobIds.length === 0) return;
    let stopped = false;
    const poll = async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        encoding.jobIds.map(async (id) => {
          const r = await fetch(`/api/serrures/jobs/${id}`, { cache: 'no-store' });
          const j = await r.json();
          if (j.ok) next[id] = j.job.statut;
        }),
      );
      if (!stopped) setJobsStatut(next);
      const allDone = encoding.jobIds.every((id) => ['done', 'error'].includes(next[id]));
      if (allDone) await load();
    };
    poll();
    const t = setInterval(poll, 1500);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [encoding, load]);

  function isOccupied(c: Chambre) {
    return !!c.sejour && (c.sejour.statut === 'actif' || c.sejour.statut === 'pending');
  }

  function handleChambreClick(c: Chambre) {
    setConfirmRevoke(null);
    if (encoding) {
      setEncoding(null);
      setJobsStatut({});
    }
    if (isOccupied(c)) {
      setSelectedIds(new Set());
      setViewChambreId(c.id === viewChambreId ? null : c.id);
      return;
    }
    setViewChambreId(null);
    const next = new Set(selectedIds);
    if (next.has(c.id)) next.delete(c.id);
    else next.add(c.id);
    setSelectedIds(next);
  }

  async function createSejour(methode: 'code' | 'carte') {
    if (selectedIds.size === 0) return;
    if (methode === 'code' && selectedIds.size > 1) return;
    const [hStr, mStr] = checkoutTime.split(':');
    const checkout_hour = parseInt(hStr, 10);
    const checkout_min = parseInt(mStr ?? '0', 10);
    setBusy(true);
    setEncoding(null);
    setJobsStatut({});
    try {
      const res = await fetch('/api/serrures/sejours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chambre_ids: Array.from(selectedIds),
          methode,
          nuits,
          nb_cartes: nbCartes,
          checkout_hour,
          checkout_min,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      const newSejours: Sejour[] = json.sejours ?? [];
      const newJobIds: string[] = (json.jobs ?? []).map((j: { id: string }) => j.id);
      await load();
      setSelectedIds(new Set());
      if (methode === 'carte') {
        setEncoding({
          sejours: newSejours,
          jobIds: newJobIds,
          carteIndex: 1,
          totalCartes: json.total_cartes ?? 1,
        });
      } else if (newSejours[0]) {
        setViewChambreId(newSejours[0].chambre_id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(sejourId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/serrures/sejours/${sejourId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      await load();
      setViewChambreId(null);
      setConfirmRevoke(null);
      toast.success('Séjour révoqué');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function addCarteSupplementaire(sejourId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/serrures/sejours/${sejourId}/carte-supplementaire`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      const sejoursLies = chambres
        .map((c) => c.sejour)
        .filter((s): s is Sejour => !!s && json.sejourIds.includes(s.id));
      setViewChambreId(null);
      setEncoding({ sejours: sejoursLies, jobIds: [json.job.id], carteIndex: 1, totalCartes: 1 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function encodeNextCard() {
    if (!encoding) return;
    const head = encoding.sejours[0];
    if (!head) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/serrures/sejours/${head.id}/carte-supplementaire`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setEncoding({
        ...encoding,
        jobIds: [...encoding.jobIds, json.job.id],
        carteIndex: encoding.carteIndex + 1,
      });
      setJobsStatut((prev) => ({ ...prev, [json.job.id]: 'queued' }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-stone-50 flex items-center justify-center text-stone-400">
        Chargement…
      </main>
    );
  }
  if (chambres.length === 0) {
    return (
      <main className="min-h-screen bg-stone-50 px-6 py-10 max-w-3xl mx-auto">
        <h1 className="text-2xl font-light text-stone-800 mb-4">Aucune chambre mappée</h1>
        <Link
          href="/serrures/config"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
        >
          <Settings className="w-4 h-4" />
          Configuration
        </Link>
      </main>
    );
  }

  const viewChambre = viewChambreId ? chambres.find((c) => c.id === viewChambreId) : null;
  const selectedChambres = chambres.filter((c) => selectedIds.has(c.id));

  return (
    <main className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-10 bg-stone-50/80 backdrop-blur border-b border-stone-200/60 px-8 py-4 flex items-center justify-between">
        <h1 className="text-sm font-medium tracking-wide uppercase text-stone-500">Serrures</h1>
        <Link
          href="/serrures/config"
          className="text-stone-400 hover:text-stone-800 transition"
          title="Configuration"
        >
          <Settings className="w-5 h-5" />
        </Link>
      </header>

      <div className="flex min-h-[calc(100vh-57px)]">
        {/* 1) Sidebar chambres */}
        <aside className="w-64 border-r border-stone-200/60 bg-white/40 overflow-y-auto py-4 shrink-0">
          <ul className="px-3 space-y-1">
            {chambres.map((c) => {
              const occ = isOccupied(c);
              const isSel = selectedIds.has(c.id);
              const isViewing = viewChambreId === c.id;
              return (
                <li key={c.id}>
                  <button
                    onClick={() => handleChambreClick(c)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-left transition ${
                      isViewing
                        ? 'bg-emerald-100 ring-1 ring-emerald-300 text-emerald-900'
                        : isSel
                        ? 'bg-indigo-50 ring-1 ring-indigo-200 text-indigo-900'
                        : occ
                        ? 'bg-emerald-50/60 hover:bg-emerald-50 text-emerald-900'
                        : 'hover:bg-white text-stone-700'
                    }`}
                  >
                    <span className="font-medium tabular-nums text-lg">{c.numero}</span>
                    <span>
                      {occ && c.sejour ? (
                        c.sejour.methode === 'code' ? (
                          <KeyRound className="w-4 h-4" />
                        ) : (
                          <CreditCard className="w-4 h-4" />
                        )
                      ) : isSel ? (
                        <Check className="w-4 h-4 text-indigo-600" />
                      ) : (
                        <span className="text-xs text-stone-400">libre</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* 2) Colonne paramètres (toujours visible) */}
        <section className="w-[420px] border-r border-stone-200/60 px-8 py-10 shrink-0">
          <ParamsPanel
            selectedChambres={selectedChambres}
            nuits={nuits}
            setNuits={setNuits}
            nbCartes={nbCartes}
            setNbCartes={setNbCartes}
            checkoutTime={checkoutTime}
            setCheckoutTime={setCheckoutTime}
            busy={busy}
            onCarte={() => createSejour('carte')}
            onCode={() => createSejour('code')}
            onClear={() => setSelectedIds(new Set())}
          />
        </section>

        {/* 3) Colonne infos */}
        <section className="flex-1 px-8 py-10">
          <div className="max-w-md mx-auto">
            {encoding ? (
              <EncodingPanel
                encoding={encoding}
                jobsStatut={jobsStatut}
                busy={busy}
                onNext={encodeNextCard}
                onClose={() => {
                  setEncoding(null);
                  setJobsStatut({});
                }}
              />
            ) : viewChambre && viewChambre.sejour ? (
              <ChambreDetail
                chambre={viewChambre}
                busy={busy}
                confirmRevoke={confirmRevoke === viewChambre.sejour.id}
                onAskRevoke={() => setConfirmRevoke(viewChambre.sejour!.id)}
                onCancelRevoke={() => setConfirmRevoke(null)}
                onConfirmRevoke={() => revoke(viewChambre.sejour!.id)}
                onAddCarte={() => addCarteSupplementaire(viewChambre.sejour!.id)}
              />
            ) : (
              <EmptyInfo />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

// ─── Empty state pour la colonne infos ──────────────────────────────────────

function EmptyInfo() {
  return (
    <div className="text-center text-stone-400 mt-32">
      <AlertCircle className="w-8 h-8 mx-auto mb-3 opacity-40" />
      <p className="text-sm font-light">
        Sélectionne une chambre libre pour créer un séjour,
        <br />
        ou une occupée pour voir le code et la validité.
      </p>
    </div>
  );
}

// ─── Label ──────────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone-400 mb-3">
      {children}
    </div>
  );
}

// ─── NumberPills (sans popup) ───────────────────────────────────────────────

function NumberPills({
  value,
  onChange,
  max = 5,
  upperLimit = 30,
}: {
  value: number;
  onChange: (n: number) => void;
  max?: number;
  upperLimit?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  function commit() {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n) && n > 0 && n <= upperLimit) onChange(n);
    setEditing(false);
  }

  return (
    <div className="flex gap-2">
      {editing ? (
        <input
          type="number"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          min={1}
          max={upperLimit}
          className="flex-1 h-12 rounded-xl px-4 font-medium text-base bg-white border border-indigo-300 ring-2 ring-indigo-100 outline-none text-stone-800"
        />
      ) : (
        <>
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => onChange(n)}
              className={`flex-1 h-12 rounded-xl font-medium transition text-base ${
                value === n
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                  : 'bg-white hover:bg-stone-100 text-stone-600 border border-stone-200'
              }`}
            >
              {n}
            </button>
          ))}
          <button
            onClick={() => {
              setDraft(String(value));
              setEditing(true);
            }}
            className={`flex-1 h-12 rounded-xl font-medium transition text-base ${
              value > max
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                : 'bg-white hover:bg-stone-100 text-stone-400 border border-stone-200'
            }`}
          >
            {value > max ? value : '+'}
          </button>
        </>
      )}
    </div>
  );
}

// ─── Panneau Paramètres (col milieu) ────────────────────────────────────────

function ParamsPanel(props: {
  selectedChambres: Chambre[];
  nuits: number;
  setNuits: (n: number) => void;
  nbCartes: number;
  setNbCartes: (n: number) => void;
  checkoutTime: string;
  setCheckoutTime: (s: string) => void;
  busy: boolean;
  onCarte: () => void;
  onCode: () => void;
  onClear: () => void;
}) {
  const {
    selectedChambres,
    nuits,
    setNuits,
    nbCartes,
    setNbCartes,
    checkoutTime,
    setCheckoutTime,
    busy,
    onCarte,
    onCode,
    onClear,
  } = props;

  const hasSelection = selectedChambres.length > 0;
  const multi = selectedChambres.length > 1;
  const [hStr, mStr] = checkoutTime.split(':');
  const checkout = new Date(Date.now() + nuits * 86_400_000);
  checkout.setHours(parseInt(hStr, 10) || 11, parseInt(mStr || '0', 10), 0, 0);

  return (
    <div>
      <div className="mb-10">
        <Label>Sélection</Label>
        {hasSelection ? (
          <div className="flex items-center justify-between">
            <div className="text-2xl font-light text-stone-800 leading-tight">
              {selectedChambres.length === 1
                ? `Chambre ${selectedChambres[0].numero}`
                : `Chambres ${selectedChambres.map((c) => c.numero).join(', ')}`}
            </div>
            <button onClick={onClear} className="text-stone-400 hover:text-stone-700 text-sm shrink-0 ml-3">
              Effacer
            </button>
          </div>
        ) : (
          <div className="text-stone-400 text-base font-light italic">
            Choisis une ou plusieurs chambres
          </div>
        )}
      </div>

      <div className={hasSelection ? '' : 'opacity-40 pointer-events-none'}>
        <div className="mb-8">
          <Label>Nuits</Label>
          <NumberPills value={nuits} onChange={setNuits} />
        </div>

        <div className="mb-8">
          <Label>Cartes</Label>
          <NumberPills value={nbCartes} onChange={setNbCartes} max={4} upperLimit={10} />
          {multi && (
            <div className="mt-3 text-xs text-stone-500">
              {nbCartes === 1
                ? `1 carte qui ouvrira les ${selectedChambres.length} chambres`
                : `${nbCartes} cartes, chacune ouvrira les ${selectedChambres.length} chambres`}
            </div>
          )}
        </div>

        <div className="mb-10">
          <Label>Heure de checkout</Label>
          <input
            type="time"
            value={checkoutTime}
            onChange={(e) => setCheckoutTime(e.target.value)}
            step={60}
            className="h-12 rounded-xl px-4 font-medium text-base bg-white border border-stone-200 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 text-stone-800 w-32 tabular-nums"
          />
          <div className="mt-3 text-xs text-stone-500">
            Checkout{' '}
            <span className="text-stone-700 font-medium">
              {checkout.toLocaleString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </span>{' '}
            à{' '}
            <span className="tabular-nums text-stone-700 font-medium">
              {checkoutTime.replace(':', 'h')}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={onCarte}
            disabled={busy}
            className="w-full flex items-center justify-center gap-3 py-5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 text-lg font-medium shadow-sm shadow-indigo-200 transition"
          >
            <CreditCard className="w-6 h-6" />
            {nbCartes > 1 ? `${nbCartes} cartes` : 'Carte'}
          </button>
          <button
            onClick={onCode}
            disabled={busy || multi}
            title={multi ? 'Le code n’est possible que pour une seule chambre' : undefined}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white hover:bg-stone-100 text-stone-600 border border-stone-200 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition"
          >
            <KeyRound className="w-4 h-4" />
            Code
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Détail chambre (col droite) ────────────────────────────────────────────

function ChambreDetail(props: {
  chambre: Chambre;
  busy: boolean;
  confirmRevoke: boolean;
  onAskRevoke: () => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: () => void;
  onAddCarte: () => void;
}) {
  const { chambre, busy, confirmRevoke, onAskRevoke, onCancelRevoke, onConfirmRevoke, onAddCarte } = props;
  const sejour = chambre.sejour!;
  const fin = new Date(sejour.fin);
  const debut = new Date(sejour.debut);

  const now = Date.now();
  const totalMs = fin.getTime() - debut.getTime();
  const elapsedMs = Math.max(0, Math.min(now - debut.getTime(), totalMs));
  const restantMs = Math.max(0, fin.getTime() - now);
  const progressPct = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 100;
  const expired = restantMs === 0;

  function formatRestant(ms: number) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    if (h >= 24) {
      const d = Math.floor(h / 24);
      return `${d}j ${h % 24}h`;
    }
    if (h > 0) return `${h}h${m.toString().padStart(2, '0')}`;
    return `${m} min`;
  }

  return (
    <div>
      <Label>Occupée</Label>
      <div className="text-3xl font-light text-stone-800 mb-8">Chambre {chambre.numero}</div>

      {sejour.methode === 'code' && sejour.code && (
        <div className="text-center py-10 mb-6 rounded-3xl bg-white shadow-sm border border-stone-200/60">
          <div className="text-xs uppercase tracking-wider text-stone-400 mb-3">Code</div>
          <div className="text-6xl font-bold tracking-widest tabular-nums select-all text-stone-800">
            {sejour.code}
          </div>
        </div>
      )}
      {sejour.methode === 'carte' && (
        <div className="text-center py-10 mb-6 rounded-3xl bg-white shadow-sm border border-stone-200/60">
          <CreditCard className="w-12 h-12 mx-auto mb-3 text-stone-700" />
          <div className="text-sm text-stone-600">
            {sejour.statut === 'pending' ? 'En attente d’encodage' : 'Carte active'}
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white border border-stone-200/60 p-5 mb-6">
        <div className="flex items-center justify-between text-xs text-stone-500 mb-2">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            Validité
          </span>
          <span className="text-stone-700 font-medium">
            {expired ? 'Expirée' : `Encore ${formatRestant(restantMs)}`}
          </span>
        </div>
        <div className="h-1.5 w-full bg-stone-100 rounded-full overflow-hidden">
          <div
            className={`h-full ${expired ? 'bg-red-400' : 'bg-emerald-500'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs text-stone-400">
          <span>
            {debut.toLocaleString('fr-FR', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <span>
            {fin.toLocaleString('fr-FR', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>

      {sejour.methode === 'carte' && sejour.statut === 'actif' && !confirmRevoke && (
        <button
          onClick={onAddCarte}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-3 mb-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 disabled:opacity-50 transition"
        >
          <Plus className="w-4 h-4" />
          Carte supplémentaire
        </button>
      )}

      {!confirmRevoke ? (
        <button
          onClick={onAskRevoke}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 disabled:opacity-50 transition"
        >
          <RotateCcw className="w-4 h-4" />
          Révoquer
        </button>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={onCancelRevoke}
            disabled={busy}
            className="flex-1 py-3 rounded-xl bg-white hover:bg-stone-100 text-stone-700 border border-stone-200 disabled:opacity-50 transition text-sm"
          >
            Annuler
          </button>
          <button
            onClick={onConfirmRevoke}
            disabled={busy}
            className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition text-sm font-medium"
          >
            Confirmer la révocation
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Encodage ───────────────────────────────────────────────────────────────

function EncodingPanel(props: {
  encoding: { sejours: Sejour[]; jobIds: string[]; carteIndex: number; totalCartes: number };
  jobsStatut: Record<string, string>;
  busy: boolean;
  onNext: () => void;
  onClose: () => void;
}) {
  const { encoding, jobsStatut, busy, onNext, onClose } = props;
  const allDone = encoding.jobIds.every((id) => jobsStatut[id] === 'done');
  const anyError = encoding.jobIds.some((id) => jobsStatut[id] === 'error');
  const hasMore = encoding.carteIndex < encoding.totalCartes;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <Label>Encodage</Label>
        <button
          onClick={onClose}
          className="text-stone-400 hover:text-stone-700 text-xs"
        >
          Fermer
        </button>
      </div>

      <div className="space-y-3">
        {encoding.jobIds.map((jobId, idx) => {
          const statut = jobsStatut[jobId] ?? 'queued';
          return (
            <div
              key={jobId}
              className="flex items-center gap-4 px-5 py-4 rounded-2xl bg-white border border-stone-200/60 shadow-sm"
            >
              <div className="w-11 h-11 rounded-full bg-stone-100 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-stone-600" />
              </div>
              <div className="flex-1">
                <div className="font-medium text-stone-800">
                  Carte {idx + 1}
                  {encoding.totalCartes > 1 ? ` / ${encoding.totalCartes}` : ''}
                </div>
                <div className="text-xs text-stone-500 mt-0.5">
                  {statut === 'queued' && 'Posez la carte sur l’encodeur'}
                  {statut === 'running' && 'Encodage en cours…'}
                  {statut === 'done' && 'Carte encodée'}
                  {statut === 'error' && 'Échec — réessayez'}
                </div>
              </div>
              <div className="shrink-0">
                {(statut === 'queued' || statut === 'running') && (
                  <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
                )}
                {statut === 'done' && <Check className="w-5 h-5 text-emerald-600" />}
                {statut === 'error' && <AlertCircle className="w-5 h-5 text-red-600" />}
              </div>
            </div>
          );
        })}
      </div>

      {allDone && hasMore && !anyError && (
        <button
          onClick={onNext}
          disabled={busy}
          className="mt-6 w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 font-medium shadow-sm shadow-indigo-200 transition"
        >
          <CreditCard className="w-5 h-5" />
          Carte suivante ({encoding.carteIndex + 1}/{encoding.totalCartes})
        </button>
      )}
      {allDone && !hasMore && (
        <div className="mt-6 text-center py-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">
          Toutes les cartes sont encodées
        </div>
      )}
    </div>
  );
}
