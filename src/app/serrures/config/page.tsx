'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Lock, Battery, Radio, RefreshCw, Link2, Unlink, Check, X, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabaseClient';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token ?? ''}` };
}

type LockSummary = {
  lockId: number;
  alias: string;
  mac?: string;
  battery?: number;
  hasGateway: boolean;
};
type Hotel = { id: string; nom: string; slug: string };
type Chambre = {
  id: string;
  hotel_id: string;
  numero: string;
  tthotel_lock_id: number;
  tthotel_lock_alias: string | null;
};

type Bootstrap =
  | { ok: true; hotels: Hotel[]; chambres: Chambre[]; locks: LockSummary[] }
  | { ok: false; error: string };

export default function SerruresPage() {
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [mappingFor, setMappingFor] = useState<LockSummary | null>(null);
  const [selectedHotel, setSelectedHotel] = useState<string>('');
  const [numero, setNumero] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/serrures/bootstrap', {
        cache: 'no-store',
        headers: await authHeaders(),
      });
      const json: Bootstrap = await res.json();
      setData(json);
      if (json.ok && json.hotels.length === 1) setSelectedHotel(json.hotels[0].id);
    } catch (err) {
      setData({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  async function mapChambre() {
    if (!mappingFor || !selectedHotel || !numero) return;
    setBusy(true);
    try {
      const res = await fetch('/api/serrures/admin/map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          hotel_id: selectedHotel,
          numero: numero.trim(),
          tthotel_lock_id: mappingFor.lockId,
          tthotel_lock_alias: mappingFor.alias,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setMappingFor(null);
      setNumero('');
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function unmapChambre(id: string) {
    if (!confirm('Démapper cette chambre ?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/serrures/admin/map?id=${id}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (authLoading) {
    return (
      <main className="min-h-screen bg-neutral-50 px-6 py-10 max-w-5xl mx-auto">
        <p className="text-neutral-500">Chargement…</p>
      </main>
    );
  }
  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-neutral-50 flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <ShieldAlert className="w-10 h-10 mx-auto mb-4 text-neutral-300" />
          <h1 className="text-lg font-semibold text-neutral-800 mb-1">Réglages réservés aux admins</h1>
          <p className="text-sm text-neutral-500 mb-6">
            La configuration des serrures n’est accessible qu’aux administrateurs.
          </p>
          <Link
            href="/serrures"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm"
          >
            Retour aux serrures
          </Link>
        </div>
      </main>
    );
  }
  if (loading && !data) {
    return (
      <main className="min-h-screen bg-neutral-50 px-6 py-10 max-w-5xl mx-auto">
        <p className="text-neutral-500">Chargement…</p>
      </main>
    );
  }
  if (!data || data.ok === false) {
    return (
      <main className="min-h-screen bg-neutral-50 px-6 py-10 max-w-5xl mx-auto">
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          <strong>Erreur :</strong> {data?.ok === false ? data.error : 'inconnue'}
        </div>
      </main>
    );
  }

  const { hotels, chambres, locks } = data;
  const mappedLockIds = new Set(chambres.map((c) => c.tthotel_lock_id));

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-10 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Lock className="w-6 h-6" />
          Serrures — configuration
        </h1>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-md border border-neutral-300 bg-white hover:bg-neutral-100 disabled:opacity-50 text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Rafraîchir
        </button>
      </header>

      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-3">
          Chambres mappées ({chambres.length})
        </h2>
        {chambres.length === 0 ? (
          <p className="text-sm text-neutral-500 italic">
            Aucune chambre mappée. Mappez vos serrures ci-dessous.
          </p>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {chambres.map((c) => {
              const hotel = hotels.find((h) => h.id === c.hotel_id);
              return (
                <li
                  key={c.id}
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 flex items-center justify-between text-sm"
                >
                  <div>
                    <div className="font-medium">Chambre {c.numero}</div>
                    <div className="text-xs text-neutral-600">
                      {hotel?.nom ?? '?'} · lockId {c.tthotel_lock_id}
                    </div>
                  </div>
                  <button
                    onClick={() => unmapChambre(c.id)}
                    className="text-neutral-400 hover:text-red-600"
                    title="Démapper"
                  >
                    <Unlink className="w-4 h-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-3">
          Serrures TTHotel détectées ({locks.length})
        </h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {locks.map((l) => {
            const isMapped = mappedLockIds.has(l.lockId);
            return (
              <li
                key={l.lockId}
                className={`rounded-lg border p-4 flex items-start justify-between gap-4 ${
                  isMapped ? 'border-neutral-200 bg-neutral-100 opacity-60' : 'border-neutral-200 bg-white'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{l.alias || '(sans alias)'}</div>
                  <div className="text-xs text-neutral-500 mt-1">
                    lockId :{' '}
                    <code className="bg-neutral-100 px-1.5 py-0.5 rounded">{l.lockId}</code>
                  </div>
                  {l.mac && (
                    <div className="text-xs text-neutral-500 mt-1 truncate">MAC : {l.mac}</div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0 text-xs">
                  {typeof l.battery === 'number' && (
                    <span className="flex items-center gap-1 text-neutral-600">
                      <Battery className="w-3.5 h-3.5" />
                      {l.battery}%
                    </span>
                  )}
                  <span
                    className={`flex items-center gap-1 ${
                      l.hasGateway ? 'text-emerald-600' : 'text-neutral-400'
                    }`}
                  >
                    <Radio className="w-3.5 h-3.5" />
                    {l.hasGateway ? 'gateway' : 'pas de gw'}
                  </span>
                  {isMapped ? (
                    <span className="flex items-center gap-1 text-emerald-700 mt-1">
                      <Check className="w-3.5 h-3.5" />
                      mappée
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        setMappingFor(l);
                        if (hotels.length === 1) setSelectedHotel(hotels[0].id);
                      }}
                      className="flex items-center gap-1 mt-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      Mapper
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {mappingFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Mapper la serrure</h3>
              <button onClick={() => setMappingFor(null)} className="text-neutral-400 hover:text-neutral-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-neutral-600 mb-4">
              <strong>{mappingFor.alias || mappingFor.lockId}</strong> sera rattachée à une chambre
              de votre hôtel.
            </p>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-neutral-500">Hôtel</span>
                <select
                  value={selectedHotel}
                  onChange={(e) => setSelectedHotel(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-neutral-300 rounded"
                >
                  <option value="">— choisir —</option>
                  {hotels.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.nom}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-neutral-500">Numéro de chambre</span>
                <input
                  type="text"
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                  placeholder="ex. 11"
                  className="mt-1 w-full px-3 py-2 border border-neutral-300 rounded"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setMappingFor(null)}
                className="px-3 py-2 rounded border border-neutral-300 hover:bg-neutral-50 text-sm"
              >
                Annuler
              </button>
              <button
                onClick={mapChambre}
                disabled={busy || !selectedHotel || !numero}
                className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 text-sm"
              >
                {busy ? 'Mapping…' : 'Mapper'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
