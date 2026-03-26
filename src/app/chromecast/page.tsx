'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import {
  Wifi, WifiOff, Plus, Trash2, RefreshCw, AlertTriangle,
  ChevronLeft, Tv2, X, Loader2, Signal, Clock, Server
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_CHROMECAST_API_BASE!;
const API_KEY  = process.env.NEXT_PUBLIC_CHROMECAST_API_KEY!;

const apiFetch = (path: string, options?: RequestInit) =>
  fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });

// --- TYPES ---

interface Room {
  id: number;
  name: string;
  chromecast_ip: string;
  proxy_port: number;
  connected: boolean;
  last_connected: string | null;
  last_push: string | null;
  disconnected_since: string | null;
  alert: boolean;
}

interface ScannedDevice {
  ip: string;
  known: boolean;
  name: string | null;
}

// --- UTILITAIRES ---

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `il y a ${diff}s`;
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)}h`;
  return `il y a ${Math.floor(diff / 86400)}j`;
}

// --- COMPOSANTS ---

function AlertBanner({ rooms }: { rooms: Room[] }) {
  const alertRooms = rooms.filter((r) => r.alert);
  if (alertRooms.length === 0) return null;
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 mb-6">
      <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-semibold text-red-700">
          {alertRooms.length} Chromecast{alertRooms.length > 1 ? 's' : ''} déconnecté{alertRooms.length > 1 ? 's' : ''} depuis +5 minutes
        </p>
        <p className="text-xs text-red-500 mt-0.5">
          {alertRooms.map((r) => r.name).join(', ')}
        </p>
      </div>
    </div>
  );
}

function RoomCard({ room, onClick, onDelete }: { room: Room; onClick: () => void; onDelete: (e: React.MouseEvent) => void }) {
  return (
    <div
      onClick={onClick}
      className={`relative cursor-pointer rounded-xl border p-3 flex flex-col items-center gap-1.5 transition-all hover:shadow-md text-center ${
        room.alert
          ? 'bg-red-50 border-red-200'
          : room.connected
          ? 'bg-green-50 border-green-200'
          : 'bg-slate-50 border-slate-200'
      }`}
    >
      {/* Icône TV */}
      <Tv2 className={`w-6 h-6 mt-1 ${room.alert ? 'text-red-400' : room.connected ? 'text-green-500' : 'text-slate-300'}`} />

      {/* Nom de la chambre */}
      <span className="font-bold text-slate-800 text-sm leading-tight">{room.name}</span>

      {/* Statut */}
      <div className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
        room.connected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
      }`}>
        {room.connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
        {room.connected ? 'Connecté' : 'Déconnecté'}
      </div>

      {/* Supprimer */}
      <button
        onClick={onDelete}
        className="absolute top-2 right-2 text-slate-200 hover:text-red-400 transition-colors"
        title="Supprimer"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

function RoomPopup({ room, onClose }: { room: Room; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className={`p-2 rounded-lg ${room.connected ? 'bg-green-100' : 'bg-red-100'}`}>
            <Tv2 className={`w-5 h-5 ${room.connected ? 'text-green-600' : 'text-red-500'}`} />
          </div>
          <div>
            <h2 className="font-bold text-slate-800">{room.name}</h2>
            <span className={`text-xs font-medium ${room.connected ? 'text-green-600' : 'text-red-500'}`}>
              {room.connected ? 'Connectée' : 'Déconnectée'}
            </span>
          </div>
        </div>

        <div className="space-y-3 text-sm">
          <Row label="IP Chromecast" value={room.chromecast_ip} mono />
          <Row label="Port proxy" value={`:${room.proxy_port}`} mono />
          <Row label="Dernière connexion" value={formatRelative(room.last_connected)} />
          <Row label="Dernier push image" value={formatRelative(room.last_push)} />
          {!room.connected && (
            <Row label="Déconnectée depuis" value={formatRelative(room.disconnected_since)} red />
          )}
          {room.alert && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-600 text-xs font-medium">
              <AlertTriangle className="w-4 h-4" /> Alerte — déconnexion prolongée
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono, red }: { label: string; value: string; mono?: boolean; red?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-500">{label}</span>
      <span className={`font-medium ${mono ? 'font-mono text-xs' : ''} ${red ? 'text-red-500' : 'text-slate-800'}`}>{value}</span>
    </div>
  );
}

function AddRoomModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [selectedIp, setSelectedIp] = useState('');
  const [customIp, setCustomIp] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [scanDone, setScanDone] = useState(false);

  const scan = useCallback(async () => {
    setScanning(true);
    setError('');
    setScanDone(false);
    try {
      const res = await apiFetch('/api/scan');
      if (!res.ok) throw new Error('Erreur scan');
      const data = await res.json();
      setDevices(data.devices ?? []);
      setScanDone(true);
    } catch {
      setError('Impossible de scanner le réseau. Vérifiez la connexion au serveur.');
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => { scan(); }, [scan]);

  const unknownDevices = devices.filter((d) => !d.known);
  const effectiveIp = selectedIp || customIp;

  const handleAdd = async () => {
    if (!effectiveIp || !roomNumber) { setError('IP et numéro de chambre requis.'); return; }
    const num = parseInt(roomNumber);
    if (isNaN(num) || num < 1 || num > 999) { setError('Numéro de chambre invalide (1–999).'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ room_id: num, chromecast_ip: effectiveIp }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Erreur lors de l\'ajout');
      }
      // Attendre le redémarrage du service
      await new Promise((r) => setTimeout(r, 3500));
      onAdded();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
          <X className="w-5 h-5" />
        </button>
        <h2 className="font-bold text-slate-800 text-lg mb-1">Ajouter une Chromecast</h2>
        <p className="text-xs text-slate-400 mb-5">Scan du réseau en cours pour détecter les appareils disponibles</p>

        {/* Scan */}
        {scanning ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <Loader2 className="w-7 h-7 animate-spin text-indigo-500" />
            <p className="text-sm text-slate-500">Scan en cours (~15s)…</p>
          </div>
        ) : (
          <>
            {/* Appareils détectés */}
            {scanDone && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    Appareils disponibles ({unknownDevices.length})
                  </p>
                  <button onClick={scan} className="text-xs text-indigo-500 hover:underline flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" /> Rescanner
                  </button>
                </div>
                {unknownDevices.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">Aucun appareil non configuré détecté.</p>
                ) : (
                  <div className="space-y-1 max-h-36 overflow-y-auto">
                    {unknownDevices.map((d) => (
                      <button
                        key={d.ip}
                        onClick={() => { setSelectedIp(d.ip); setCustomIp(''); }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-mono flex items-center gap-2 transition-colors ${
                          selectedIp === d.ip ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' : 'bg-slate-50 hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        <Signal className="w-3 h-3 shrink-0" />
                        {d.ip}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* IP manuelle */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {scanDone ? 'Ou saisir l\'IP manuellement' : 'IP de la Chromecast'}
              </label>
              <input
                type="text"
                placeholder="192.168.0.XXX"
                value={customIp}
                onChange={(e) => { setCustomIp(e.target.value); setSelectedIp(''); }}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>

            {/* Numéro de chambre */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-slate-600 mb-1">Numéro de chambre</label>
              <input
                type="number"
                min={1}
                max={999}
                placeholder="Ex: 12"
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>

            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

            <Button
              onClick={handleAdd}
              disabled={saving || !effectiveIp || !roomNumber}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Ajout en cours…</> : 'Ajouter la chambre'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// --- PAGE PRINCIPALE ---

interface CustomUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export default function ChromecastDashboard() {
  const { user: rawUser, isLoading } = useAuth();
  const router = useRouter();
  const user = rawUser as CustomUser | null;

  const [rooms, setRooms] = useState<Room[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Auth guard
  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  const fetchStatus = useCallback(async () => {
    setFetching(true);
    setFetchError('');
    try {
      const res = await apiFetch('/api/status');
      if (!res.ok) throw new Error(`Erreur serveur (${res.status})`);
      const data = await res.json();
      setRooms(data.rooms ?? []);
      setLastRefresh(new Date());
    } catch (e: any) {
      setFetchError(e.message ?? 'Impossible de joindre le serveur Chromecast.');
    } finally {
      setFetching(false);
    }
  }, []);

  // Premier chargement + polling 15s
  useEffect(() => {
    if (!user) return;
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [user, fetchStatus]);

  const handleDelete = async (room: Room, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Supprimer ${room.name} ?`)) return;
    setDeletingId(room.id);
    try {
      await apiFetch(`/api/rooms/${room.id}`, { method: 'DELETE' });
      await fetchStatus();
    } catch {
      alert('Erreur lors de la suppression.');
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading || !user) return null;

  const connected = rooms.filter((r) => r.connected).length;
  const total = rooms.length;
  const alerts = rooms.filter((r) => r.alert).length;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="w-full px-6 py-6">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.push('/')} className="text-slate-400 hover:text-slate-600 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 flex-1">
            <div className="bg-indigo-100 p-2 rounded-lg">
              <Tv2 className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h1 className="font-bold text-slate-800 text-lg leading-none">Chromecasts</h1>
              <p className="text-xs text-slate-400">Gestion des TVs</p>
            </div>
          </div>

          {/* Statut serveur + refresh */}
          <div className="flex items-center gap-2">
            {lastRefresh && (
              <span className="text-xs text-slate-400 hidden sm:block">
                {lastRefresh.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
            <button
              onClick={fetchStatus}
              disabled={fetching}
              className="text-slate-400 hover:text-indigo-600 transition-colors"
              title="Rafraîchir"
            >
              <RefreshCw className={`w-4 h-4 ${fetching ? 'animate-spin' : ''}`} />
            </button>
            <Button
              onClick={() => setShowAddModal(true)}
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Ajouter
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-slate-100 p-4 flex flex-col items-center">
            <Server className="w-4 h-4 text-slate-400 mb-1" />
            <span className="text-2xl font-bold text-slate-800">{total}</span>
            <span className="text-xs text-slate-400">Total</span>
          </div>
          <div className="bg-white rounded-xl border border-green-100 p-4 flex flex-col items-center">
            <Wifi className="w-4 h-4 text-green-500 mb-1" />
            <span className="text-2xl font-bold text-green-600">{connected}</span>
            <span className="text-xs text-slate-400">Connectés</span>
          </div>
          <div className={`rounded-xl border p-4 flex flex-col items-center ${alerts > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-100'}`}>
            <AlertTriangle className={`w-4 h-4 mb-1 ${alerts > 0 ? 'text-red-500' : 'text-slate-300'}`} />
            <span className={`text-2xl font-bold ${alerts > 0 ? 'text-red-600' : 'text-slate-400'}`}>{alerts}</span>
            <span className="text-xs text-slate-400">Alertes</span>
          </div>
        </div>

        {/* Bannière alertes */}
        <AlertBanner rooms={rooms} />

        {/* Erreur serveur */}
        {fetchError && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center gap-3 mb-6 text-sm text-orange-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{fetchError} — <button className="underline" onClick={fetchStatus}>Réessayer</button></span>
          </div>
        )}

        {/* Grille chambres */}
        {total === 0 && !fetching && !fetchError ? (
          <div className="text-center py-16 text-slate-400">
            <Tv2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Aucune Chromecast configurée</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-3 text-sm text-indigo-600 hover:underline"
            >
              Ajouter la première
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 xl:grid-cols-10">
            {rooms.map((room) => (
              <div key={room.id} className={`transition-opacity ${deletingId === room.id ? 'opacity-40 pointer-events-none' : ''}`}>
                <RoomCard
                  room={room}
                  onClick={() => setSelectedRoom(room)}
                  onDelete={(e) => handleDelete(room, e)}
                />
              </div>
            ))}
          </div>
        )}

        {/* Polling indicator */}
        <p className="text-center text-xs text-slate-300 mt-8">Actualisation automatique toutes les 15s</p>
      </div>

      {/* Modals */}
      {selectedRoom && <RoomPopup room={selectedRoom} onClose={() => setSelectedRoom(null)} />}
      {showAddModal && (
        <AddRoomModal
          onClose={() => setShowAddModal(false)}
          onAdded={() => { fetchStatus(); }}
        />
      )}
    </div>
  );
}
