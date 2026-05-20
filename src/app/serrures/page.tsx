'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  KeyRound,
  CreditCard,
  Settings,
  Loader2,
  Check,
  Clock,
  AlertCircle,
  Plus,
  Users,
  RefreshCw,
  Trash2,
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
type Pass = {
  id: string;
  label: string | null;
  debut: string;
  fin: string;
  statut: string;
  last_job_id: string | null;
  job_statut: string | null;
};

export default function SerruresPage() {
  const [chambres, setChambres] = useState<Chambre[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [nuits, setNuits] = useState(1);
  const [nbCartes, setNbCartes] = useState(1);
  const [checkoutTime, setCheckoutTime] = useState('11:00');
  const [passes, setPasses] = useState<Pass[]>([]);
  const [showPass, setShowPass] = useState(false);
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

  const loadPasses = useCallback(async () => {
    const res = await fetch('/api/serrures/passes', { cache: 'no-store' });
    const json = await res.json();
    if (json.ok) setPasses(json.passes);
  }, []);

  useEffect(() => {
    load();
    loadPasses();
    const t = setInterval(() => {
      load();
      loadPasses();
    }, 10_000);
    return () => clearInterval(t);
  }, [load, loadPasses]);

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
      if (allDone) {
        await load();
        await loadPasses();
      }
    };
    poll();
    const t = setInterval(poll, 1500);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [encoding, load, loadPasses]);

  function isOccupied(c: Chambre) {
    return !!c.sejour && (c.sejour.statut === 'actif' || c.sejour.statut === 'pending');
  }

  function openPasses() {
    setShowPass(true);
    setSelectedIds(new Set());
    setEncoding(null);
    setJobsStatut({});
  }

  function handleChambreClick(c: Chambre) {
    setShowPass(false);
    if (encoding) {
      setEncoding(null);
      setJobsStatut({});
    }
    // Sélection unifiée : toute chambre (libre ou occupée) se sélectionne / se
    // désélectionne au clic. Sélection multiple possible.
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
      if (methode === 'carte') {
        setSelectedIds(new Set());
        setEncoding({
          sejours: newSejours,
          jobIds: newJobIds,
          carteIndex: 1,
          totalCartes: json.total_cartes ?? 1,
        });
      } else if (newSejours[0]) {
        // Code créé : on garde la chambre sélectionnée pour afficher son code/validité.
        setSelectedIds(new Set([newSejours[0].chambre_id]));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function createPass(label: string) {
    setBusy(true);
    setEncoding(null);
    setJobsStatut({});
    try {
      const res = await fetch('/api/serrures/passes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      await loadPasses();
      setSelectedIds(new Set());
      setEncoding({ sejours: [], jobIds: [json.job.id], carteIndex: 1, totalCartes: 1 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function replacePass(passId: string) {
    setBusy(true);
    setEncoding(null);
    setJobsStatut({});
    try {
      const res = await fetch(`/api/serrures/passes/${passId}/replace`, { method: 'POST' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      await loadPasses();
      setEncoding({ sejours: [], jobIds: [json.job.id], carteIndex: 1, totalCartes: 1 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deletePass(passId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/serrures/passes/${passId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      await loadPasses();
      toast.success('Pass supprimé');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function reencode(mode: 'replace' | 'add') {
    const occ = chambres.filter((c) => selectedIds.has(c.id) && isOccupied(c));
    if (occ.length !== 1) return;
    const chambre = occ[0];
    const [hStr, mStr] = checkoutTime.split(':');
    setBusy(true);
    setEncoding(null);
    setJobsStatut({});
    try {
      const res = await fetch('/api/serrures/sejours/reencode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chambre_id: chambre.id,
          mode,
          nuits,
          nb_cartes: nbCartes,
          checkout_hour: parseInt(hStr, 10),
          checkout_min: parseInt(mStr ?? '0', 10),
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      const newJobIds: string[] = (json.jobs ?? []).map((j: { id: string }) => j.id);
      await load();
      setSelectedIds(new Set());
      setEncoding({
        sejours: json.sejour ? [json.sejour] : [],
        jobIds: newJobIds,
        carteIndex: 1,
        totalCartes: json.total_cartes ?? 1,
      });
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

  const selectedChambres = chambres.filter((c) => selectedIds.has(c.id));
  // Détail (col droite) affiché quand une seule chambre occupée est sélectionnée.
  const detailChambre =
    selectedChambres.length === 1 && isOccupied(selectedChambres[0]) ? selectedChambres[0] : null;

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
          <div className="px-3 pb-3 mb-2 border-b border-stone-200/60">
            <button
              onClick={openPasses}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition ${
                showPass
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                  : 'bg-white hover:bg-stone-100 text-stone-700 border border-stone-200'
              }`}
            >
              <Users className="w-4 h-4" />
              Pass équipes
            </button>
          </div>
          <ul className="px-3 space-y-1">
            {chambres.map((c) => {
              const occ = isOccupied(c);
              const isSel = selectedIds.has(c.id);
              return (
                <li key={c.id}>
                  <button
                    onClick={() => handleChambreClick(c)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-left transition ring-1 ${
                      isSel
                        ? occ
                          ? 'bg-emerald-100 ring-emerald-300 text-emerald-900'
                          : 'bg-indigo-50 ring-indigo-200 text-indigo-900'
                        : occ
                        ? 'bg-emerald-50/60 ring-transparent hover:bg-emerald-50 text-emerald-900'
                        : 'ring-transparent hover:bg-white text-stone-700'
                    }`}
                  >
                    <span className="font-medium tabular-nums text-lg">{c.numero}</span>
                    <span>
                      {isSel ? (
                        <Check className={`w-4 h-4 ${occ ? 'text-emerald-600' : 'text-indigo-600'}`} />
                      ) : occ && c.sejour ? (
                        c.sejour.methode === 'code' ? (
                          <KeyRound className="w-4 h-4" />
                        ) : (
                          <CreditCard className="w-4 h-4" />
                        )
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
            occupiedCount={selectedChambres.filter(isOccupied).length}
            nuits={nuits}
            setNuits={setNuits}
            nbCartes={nbCartes}
            setNbCartes={setNbCartes}
            checkoutTime={checkoutTime}
            setCheckoutTime={setCheckoutTime}
            busy={busy}
            onCarte={() => createSejour('carte')}
            onCode={() => createSejour('code')}
            onReplace={() => reencode('replace')}
            onAdd={() => reencode('add')}
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
            ) : showPass ? (
              <PassPanel
                passes={passes}
                busy={busy}
                onCreate={createPass}
                onReplace={replacePass}
                onDelete={deletePass}
              />
            ) : detailChambre && detailChambre.sejour ? (
              <ChambreDetail chambre={detailChambre} />
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

// ─── Pass équipes (ouvert via le bouton "Pass équipes" de la sidebar) ────────

function PassPanel(props: {
  passes: Pass[];
  busy: boolean;
  onCreate: (label: string) => void;
  onReplace: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { passes, busy, onCreate, onReplace, onDelete } = props;
  const [label, setLabel] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <Label>Pass équipes</Label>
        <span className="text-xs text-stone-400">{passes.length} pass</span>
      </div>

      <div className="rounded-2xl bg-white border border-stone-200/60 p-4 mb-6">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Nom du pass (ex. Ménage, Maintenance)"
          className="w-full h-11 rounded-xl px-4 text-sm bg-stone-50 border border-stone-200 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 text-stone-800 mb-3"
        />
        <button
          onClick={() => {
            onCreate(label);
            setLabel('');
          }}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 font-medium shadow-sm shadow-indigo-200 transition"
        >
          <Users className="w-5 h-5" />
          Nouveau pass
        </button>
        <p className="mt-2 text-[11px] text-stone-400">
          Carte valable 1 an, ouvre toutes les chambres.
        </p>
      </div>

      {passes.length === 0 ? (
        <p className="text-center text-xs text-stone-400 mt-10">Aucun pass créé pour l’instant.</p>
      ) : (
        <ul className="space-y-3">
          {passes.map((p) => (
            <PassRow
              key={p.id}
              pass={p}
              busy={busy}
              confirmDelete={confirmDelete === p.id}
              onAskDelete={() => setConfirmDelete(p.id)}
              onCancelDelete={() => setConfirmDelete(null)}
              onConfirmDelete={() => {
                onDelete(p.id);
                setConfirmDelete(null);
              }}
              onReplace={() => onReplace(p.id)}
            />
          ))}
        </ul>
      )}

      <p className="mt-6 text-[11px] text-stone-400 leading-relaxed">
        Les pass n’apparaissent pas dans la liste des chambres. « Remplacer » ré-encode une
        nouvelle carte ; sans gateway, l’ancienne reste valide jusqu’à sa date.
      </p>
    </div>
  );
}

function PassRow(props: {
  pass: Pass;
  busy: boolean;
  confirmDelete: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onReplace: () => void;
}) {
  const { pass, busy, confirmDelete, onAskDelete, onCancelDelete, onConfirmDelete, onReplace } = props;
  const fin = new Date(pass.fin);
  const finStr = fin.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const encoding = !!pass.job_statut && !['done', 'error'].includes(pass.job_statut);
  const failed = pass.job_statut === 'error';

  return (
    <li className="rounded-2xl bg-white border border-stone-200/60 p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center shrink-0">
          <CreditCard className="w-4 h-4 text-stone-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-stone-800 truncate">{pass.label || 'Pass'}</div>
          <div className="text-xs text-stone-500">Valide jusqu’au {finStr}</div>
        </div>
        {encoding && (
          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            Encodage
          </span>
        )}
        {failed && (
          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
            <AlertCircle className="w-3 h-3" />
            Échec
          </span>
        )}
      </div>

      {!confirmDelete ? (
        <div className="flex gap-2">
          <button
            onClick={onReplace}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 disabled:opacity-50 transition text-sm font-medium"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Remplacer
          </button>
          <button
            onClick={onAskDelete}
            disabled={busy}
            className="px-3 py-2.5 rounded-xl bg-white hover:bg-stone-100 text-stone-500 border border-stone-200 disabled:opacity-50 transition"
            title="Supprimer de la liste"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={onCancelDelete}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl bg-white hover:bg-stone-100 text-stone-700 border border-stone-200 disabled:opacity-50 transition text-sm"
          >
            Annuler
          </button>
          <button
            onClick={onConfirmDelete}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition text-sm font-medium"
          >
            Supprimer
          </button>
        </div>
      )}
    </li>
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
  occupiedCount: number;
  nuits: number;
  setNuits: (n: number) => void;
  nbCartes: number;
  setNbCartes: (n: number) => void;
  checkoutTime: string;
  setCheckoutTime: (s: string) => void;
  busy: boolean;
  onCarte: () => void;
  onCode: () => void;
  onReplace: () => void;
  onAdd: () => void;
  onClear: () => void;
}) {
  const {
    selectedChambres,
    occupiedCount,
    nuits,
    setNuits,
    nbCartes,
    setNbCartes,
    checkoutTime,
    setCheckoutTime,
    busy,
    onCarte,
    onCode,
    onReplace,
    onAdd,
    onClear,
  } = props;

  const hasSelection = selectedChambres.length > 0;
  const multi = selectedChambres.length > 1;
  // Composition de la sélection → quelles actions proposer.
  const allLibre = hasSelection && occupiedCount === 0;
  const singleOccupied = selectedChambres.length === 1 && occupiedCount === 1;
  const mixedOrMultiOccupied = occupiedCount > 0 && !singleOccupied;
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

        {/* Chambres libres → créer ; chambre occupée seule → ré-encoder. */}
        {allLibre && (
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
        )}

        {singleOccupied && (
          <div className="space-y-3">
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              Chambre déjà occupée — ré-encodage.
            </div>
            <button
              onClick={onReplace}
              disabled={busy}
              className="w-full flex items-center justify-center gap-3 py-5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 text-lg font-medium shadow-sm shadow-indigo-200 transition"
            >
              <RefreshCw className="w-6 h-6" />
              Remplacer ({nbCartes > 1 ? `${nbCartes} cartes` : '1 carte'}, {nuits} nuit{nuits > 1 ? 's' : ''})
            </button>
            <button
              onClick={onAdd}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white hover:bg-stone-100 text-stone-600 border border-stone-200 disabled:opacity-50 text-sm font-medium transition"
            >
              <Plus className="w-4 h-4" />
              Ajouter {nbCartes > 1 ? `${nbCartes} cartes` : 'une carte'} (mêmes dates)
            </button>
            <p className="text-[11px] text-stone-400 leading-relaxed">
              « Remplacer » : nouvelle validité (nuits/checkout ci-dessus). « Ajouter » : garde les
              dates actuelles, encode juste des cartes en plus.
            </p>
          </div>
        )}

        {mixedOrMultiOccupied && (
          <div className="text-sm text-stone-500 bg-stone-100 rounded-xl px-4 py-3">
            Pour ré-encoder une chambre occupée, sélectionne-la <strong>seule</strong>. (Sélection
            multiple réservée aux chambres libres.)
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Détail chambre (col droite) ────────────────────────────────────────────

function ChambreDetail(props: { chambre: Chambre }) {
  const { chambre } = props;
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

      <p className="text-[11px] text-stone-400 leading-relaxed">
        Pour prolonger, remplacer ou ajouter une carte : la chambre est déjà sélectionnée — utilise
        les boutons de la colonne de gauche.
      </p>
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
