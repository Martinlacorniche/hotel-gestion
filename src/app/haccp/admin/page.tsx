'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Settings, Loader2, Pencil, Lock, Thermometer, Power,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { Hotel } from '../registre/types';

type Sensor = {
  id: string;
  hotel_id: string;
  friendly_name: string;
  zigbee_address: string;
  location: string;
  sensor_type: 'negatif' | 'positif' | 'ambient';
  temp_min: number | null;
  temp_max: number | null;
  alert_delay_min: number;
  active: boolean;
  notes: string | null;
};

export default function HACCPAdminPage() {
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [selectedHotelId, setSelectedHotelId] = useState<string | null>(null);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Sensor | null>(null);

  // Charge hôtels visibles
  useEffect(() => {
    if (!user || !isAdmin) return;
    (async () => {
      const isSuperadmin = user.role === 'superadmin';
      const baseQuery = supabase.from('hotels').select('id, nom').order('nom');
      const userHotelId = user.hotel_id || user.default_hotel_id;
      const { data } = isSuperadmin
        ? await baseQuery
        : await baseQuery.eq('id', userHotelId || '');
      const list = (data || []) as Hotel[];
      setHotels(list);
      if (list.length > 0) setSelectedHotelId(userHotelId || list[0].id);
    })();
  }, [user, isAdmin]);

  // Charge sondes
  const loadSensors = useCallback(async (hotelId: string) => {
    setLoading(true);
    const { data } = await supabase
      .from('haccp_sensors')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('location');
    setSensors((data || []) as Sensor[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedHotelId) loadSensors(selectedHotelId);
  }, [selectedHotelId, loadSensors]);

  // ---- Guards ----
  if (authLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }
  if (!user) return <div className="p-8">Authentification requise.</div>;
  if (!isAdmin) {
    return (
      <div className="p-8 max-w-md mx-auto">
        <Card>
          <CardContent className="py-8 text-center">
            <Lock className="w-10 h-10 mx-auto mb-3 text-muted-foreground/60" />
            <h2 className="font-semibold mb-1">Accès réservé</h2>
            <p className="text-sm text-muted-foreground">
              La configuration des sondes HACCP est réservée aux administrateurs.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <header className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Settings className="w-6 h-6" /> HACCP — Configuration sondes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Modifier les seuils, délais d&apos;alerte et statut des sondes installées.
          </p>
        </div>
        {hotels.length > 1 && (
          <select
            value={selectedHotelId || ''}
            onChange={(e) => setSelectedHotelId(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm bg-background"
          >
            {hotels.map(h => <option key={h.id} value={h.id}>{h.nom}</option>)}
          </select>
        )}
      </header>

      {loading ? (
        <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : sensors.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Aucune sonde configurée pour cet hôtel.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b bg-muted/30">
                  <th className="text-left py-3 px-4 font-medium">Emplacement</th>
                  <th className="text-left py-3 px-4 font-medium">Type</th>
                  <th className="text-right py-3 px-4 font-medium">Min</th>
                  <th className="text-right py-3 px-4 font-medium">Max</th>
                  <th className="text-right py-3 px-4 font-medium">Délai</th>
                  <th className="text-center py-3 px-4 font-medium">Statut</th>
                  <th className="text-right py-3 px-4 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {sensors.map(s => (
                  <tr key={s.id} className="border-b last:border-b-0 hover:bg-muted/20">
                    <td className="py-3 px-4">
                      <div className="font-medium">{s.location}</div>
                      <div className="text-xs text-muted-foreground font-mono">{s.friendly_name}</div>
                    </td>
                    <td className="py-3 px-4">
                      <SensorTypeBadge type={s.sensor_type} />
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums">
                      {s.temp_min !== null ? `${s.temp_min} °C` : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums">
                      {s.temp_max !== null ? `${s.temp_max} °C` : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums text-muted-foreground">
                      {s.alert_delay_min} min
                    </td>
                    <td className="py-3 px-4 text-center">
                      {s.active ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60" /> Désactivée
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                        <Pencil className="w-3.5 h-3.5 mr-1.5" /> Modifier
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {editing && (
        <EditSensorDialog
          sensor={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            if (selectedHotelId) loadSensors(selectedHotelId);
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Badge type de sonde
// ============================================================================
function SensorTypeBadge({ type }: { type: Sensor['sensor_type'] }) {
  const cfg = {
    negatif: { label: 'Congélateur', cls: 'bg-blue-50 text-blue-700' },
    positif: { label: 'Frigo',       cls: 'bg-emerald-50 text-emerald-700' },
    ambient: { label: 'Ambiant',     cls: 'bg-amber-50 text-amber-700' },
  }[type];
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${cfg.cls}`}>
      <Thermometer className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ============================================================================
// Modale d'édition
// ============================================================================
function EditSensorDialog({
  sensor, onClose, onSaved,
}: {
  sensor: Sensor;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [location, setLocation]           = useState(sensor.location);
  const [sensorType, setSensorType]       = useState(sensor.sensor_type);
  const [tempMin, setTempMin]             = useState<string>(sensor.temp_min !== null ? String(sensor.temp_min) : '');
  const [tempMax, setTempMax]             = useState<string>(sensor.temp_max !== null ? String(sensor.temp_max) : '');
  const [alertDelay, setAlertDelay]       = useState<string>(String(sensor.alert_delay_min));
  const [active, setActive]               = useState(sensor.active);
  const [notes, setNotes]                 = useState(sensor.notes || '');
  const [saving, setSaving]               = useState(false);

  const parseTempInput = (v: string): number | null => {
    const t = v.trim().replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return isFinite(n) ? n : null;
  };

  const handleSave = async () => {
    const newMin = parseTempInput(tempMin);
    const newMax = parseTempInput(tempMax);
    const delay  = parseInt(alertDelay, 10);

    if (tempMin.trim() !== '' && newMin === null) {
      toast.error('Seuil min invalide');
      return;
    }
    if (tempMax.trim() !== '' && newMax === null) {
      toast.error('Seuil max invalide');
      return;
    }
    if (newMin !== null && newMax !== null && newMin >= newMax) {
      toast.error('Le seuil min doit être strictement inférieur au seuil max');
      return;
    }
    if (!isFinite(delay) || delay < 1) {
      toast.error('Délai d\'alerte invalide (≥ 1 min)');
      return;
    }
    if (!location.trim()) {
      toast.error('L\'emplacement est obligatoire');
      return;
    }

    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error('Session expirée, reconnectez-vous.');
        return;
      }
      const resp = await fetch(`/api/haccp/sensors/${sensor.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          location: location.trim(),
          sensor_type: sensorType,
          temp_min: newMin,
          temp_max: newMax,
          alert_delay_min: delay,
          active,
          notes: notes.trim() || null,
        }),
      });
      const result = await resp.json();
      if (!resp.ok || !result.ok) {
        toast.error('Erreur : ' + (result.error || resp.statusText));
        return;
      }
      toast.success('Sonde mise à jour. Le bridge rechargera la config dans les 5 min.');
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-4 h-4" />
            Modifier la sonde
          </DialogTitle>
          <div className="text-xs text-muted-foreground mt-1 font-mono">
            {sensor.friendly_name}
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Field label="Emplacement">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ex: Frigo cuisine" />
          </Field>

          <Field label="Type">
            <select
              value={sensorType}
              onChange={(e) => setSensorType(e.target.value as Sensor['sensor_type'])}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            >
              <option value="positif">Frigo (température positive)</option>
              <option value="negatif">Congélateur (température négative)</option>
              <option value="ambient">Ambiant</option>
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Seuil min (°C)" hint="vide = pas de seuil bas">
              <Input
                type="text" inputMode="decimal"
                value={tempMin} onChange={(e) => setTempMin(e.target.value)}
                placeholder="—"
              />
            </Field>
            <Field label="Seuil max (°C)" hint="vide = pas de seuil haut">
              <Input
                type="text" inputMode="decimal"
                value={tempMax} onChange={(e) => setTempMax(e.target.value)}
                placeholder="—"
              />
            </Field>
          </div>

          <Field label="Délai d'alerte (min)" hint="dépassement continu avant ouverture d'alerte (anti faux positif)">
            <Input
              type="number" min={1}
              value={alertDelay} onChange={(e) => setAlertDelay(e.target.value)}
            />
          </Field>

          <Field label="Notes">
            <textarea
              value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background resize-none"
              placeholder="Optionnel : remarque interne sur cette sonde"
            />
          </Field>

          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="rounded"
            />
            <Power className="w-4 h-4" />
            <span className="text-sm font-medium">Sonde active</span>
            <span className="text-xs text-muted-foreground">
              (décocher pour suspendre la surveillance sans supprimer)
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Enregistrement…</> : 'Enregistrer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
      {children}
      {hint && <div className="text-xs text-muted-foreground/80">{hint}</div>}
    </div>
  );
}
