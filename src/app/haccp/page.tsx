'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Thermometer, AlertTriangle, Battery,
  Loader2, RefreshCw, Check,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';

type Sensor = {
  id: string;
  hotel_id: string;
  friendly_name: string;
  location: string;
  sensor_type: 'negatif' | 'positif' | 'ambient';
  temp_min: number | null;
  temp_max: number | null;
  alert_delay_min: number;
  active: boolean;
};

type Reading = {
  sensor_id: string;
  temperature: number;
  humidity: number | null;
  battery: number | null;
  rssi: number | null;
  recorded_at: string;
};

type Alert = {
  id: string;
  sensor_id: string;
  threshold_type: 'high' | 'low';
  triggered_at: string;
  resolved_at: string | null;
  peak_value: number;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  action_taken: string | null;
};

type Hotel = { id: string; nom: string };

type Status = 'ok' | 'warning' | 'alert' | 'unknown';

export default function HACCPDashboard() {
  const { user, isLoading: authLoading } = useAuth();
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [selectedHotelId, setSelectedHotelId] = useState<string | null>(null);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [latestReadings, setLatestReadings] = useState<Record<string, Reading>>({});
  const [readings24h, setReadings24h] = useState<Record<string, Reading[]>>({});
  const [activeAlerts, setActiveAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Charge la liste d'hôtels visibles par l'user
  useEffect(() => {
    if (!user) return;
    (async () => {
      const isSuperadmin = user.role === 'superadmin';
      const baseQuery = supabase.from('hotels').select('id, nom').order('nom');
      const userHotelId = user.hotel_id || user.default_hotel_id;
      const { data } = isSuperadmin
        ? await baseQuery
        : await baseQuery.eq('id', userHotelId || '');
      const list = data || [];
      setHotels(list);
      if (list.length > 0) {
        setSelectedHotelId(userHotelId || list[0].id);
      }
    })();
  }, [user]);

  const loadData = useCallback(async (hotelId: string, silent = false) => {
    if (!silent) setRefreshing(true);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: sensorsData } = await supabase
      .from('haccp_sensors')
      .select('*')
      .eq('hotel_id', hotelId)
      .eq('active', true)
      .order('location');

    const sensorsList = (sensorsData || []) as Sensor[];
    setSensors(sensorsList);

    if (sensorsList.length === 0) {
      setLatestReadings({});
      setReadings24h({});
      setActiveAlerts([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const sensorIds = sensorsList.map(s => s.id);

    const [readingsResult, alertsResult] = await Promise.all([
      supabase
        .from('haccp_readings')
        .select('*')
        .in('sensor_id', sensorIds)
        .gte('recorded_at', since24h)
        .order('recorded_at', { ascending: false }),
      supabase
        .from('haccp_alerts')
        .select('*')
        .in('sensor_id', sensorIds)
        .is('resolved_at', null)
        .order('triggered_at', { ascending: false }),
    ]);

    const allReadings = (readingsResult.data || []) as Reading[];
    const latest: Record<string, Reading> = {};
    const history: Record<string, Reading[]> = {};
    for (const r of allReadings) {
      if (!latest[r.sensor_id]) latest[r.sensor_id] = r;
      (history[r.sensor_id] ||= []).push(r);
    }
    setLatestReadings(latest);
    setReadings24h(history);
    setActiveAlerts((alertsResult.data || []) as Alert[]);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (!selectedHotelId) return;
    loadData(selectedHotelId);
    const t = setInterval(() => loadData(selectedHotelId, true), 30_000);
    return () => clearInterval(t);
  }, [selectedHotelId, loadData]);

  if (authLoading) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }
  if (!user) return <div className="p-8">Authentification requise.</div>;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <header className="mb-6 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Thermometer className="w-6 h-6" /> HACCP — Températures
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Surveillance live des relevés Zigbee. Rafraîchissement auto toutes les 30 s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hotels.length > 1 && (
            <select
              value={selectedHotelId || ''}
              onChange={(e) => setSelectedHotelId(e.target.value)}
              className="border rounded-md px-3 py-2 text-sm bg-background"
            >
              {hotels.map(h => (
                <option key={h.id} value={h.id}>{h.nom}</option>
              ))}
            </select>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => selectedHotelId && loadData(selectedHotelId)}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
            Rafraîchir
          </Button>
        </div>
      </header>

      {/* Alertes actives */}
      {activeAlerts.length > 0 && (
        <ActiveAlertsBanner
          alerts={activeAlerts}
          sensors={sensors}
          userId={user.id}
          onAcknowledged={() => selectedHotelId && loadData(selectedHotelId)}
        />
      )}

      {loading && sensors.length === 0 && (
        <div className="p-8 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {/* État vide */}
      {!loading && sensors.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Aucune sonde configurée pour cet hôtel.
          <br />
          Crée des lignes dans <code>haccp_sensors</code> pour démarrer la surveillance.
        </div>
      )}

      {/* Grille des sondes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sensors.map(sensor => (
          <SensorCard
            key={sensor.id}
            sensor={sensor}
            latest={latestReadings[sensor.id]}
            history={readings24h[sensor.id] || []}
            hasActiveAlert={activeAlerts.some(a => a.sensor_id === sensor.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Bandeau alertes actives
// ============================================================================
function ActiveAlertsBanner({
  alerts, sensors, userId, onAcknowledged,
}: {
  alerts: Alert[];
  sensors: Sensor[];
  userId: string;
  onAcknowledged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const acknowledge = async (alertId: string) => {
    setBusy(alertId);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('haccp_alerts')
      .update({
        acknowledged_by: userId,
        acknowledged_at: now,
        resolved_at: now,
      })
      .eq('id', alertId);
    setBusy(null);
    if (error) {
      toast.error('Échec acquittement : ' + error.message);
    } else {
      toast.success('Alerte acquittée');
      onAcknowledged();
    }
  };

  return (
    <div className="mb-6 rounded-md border-2 border-red-400 bg-red-50/40 p-4">
      <h2 className="text-sm font-semibold text-red-700 flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4" />
        {alerts.length} alerte{alerts.length > 1 ? 's' : ''} en cours
      </h2>
      <ul className="space-y-2">
        {alerts.map(a => {
          const sensor = sensors.find(s => s.id === a.sensor_id);
          const ackd = !!a.acknowledged_at;
          return (
            <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                <strong>{sensor?.location || a.sensor_id.slice(0, 8)}</strong> — dépassement{' '}
                {a.threshold_type === 'high' ? 'haut' : 'bas'} à{' '}
                <strong>{a.peak_value.toFixed(1)} °C</strong>{' '}
                <span className="text-muted-foreground">
                  ({formatDistanceToNow(new Date(a.triggered_at), { locale: fr, addSuffix: true })})
                </span>
                {ackd && (
                  <span className="ml-2 text-green-700 text-xs">
                    ✓ acquittée{a.action_taken ? ` — ${a.action_taken}` : ''}
                  </span>
                )}
              </span>
              {!ackd && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => acknowledge(a.id)}
                  disabled={busy === a.id}
                >
                  {busy === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 mr-1" />}
                  Acquitter
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ============================================================================
// Card par sonde
// ============================================================================
function SensorCard({
  sensor, latest, history, hasActiveAlert,
}: {
  sensor: Sensor;
  latest: Reading | undefined;
  history: Reading[];
  hasActiveAlert: boolean;
}) {
  const status: Status = useMemo(() => {
    if (!latest) return 'unknown';
    if (hasActiveAlert) return 'alert';
    const { temperature } = latest;
    const { temp_min, temp_max } = sensor;
    if (temp_max !== null && temperature > temp_max) return 'alert';
    if (temp_min !== null && temperature < temp_min) return 'alert';
    // Zone de vigilance : 1°C avant le seuil
    if (temp_max !== null && temperature > temp_max - 1) return 'warning';
    if (temp_min !== null && temperature < temp_min + 1) return 'warning';
    return 'ok';
  }, [latest, sensor, hasActiveAlert]);

  const cardClasses = {
    ok:       'border-emerald-300',
    warning:  'border-amber-400 bg-amber-50/40',
    alert:    'border-red-500 bg-red-50/50',
    unknown:  'border-gray-200 bg-gray-50/30',
  }[status];

  const dotClasses = {
    ok:      'bg-emerald-500',
    warning: 'bg-amber-500',
    alert:   'bg-red-500',
    unknown: 'bg-gray-400',
  }[status];

  const tempStats = useMemo(() => {
    if (history.length === 0) return null;
    const temps = history.map(h => h.temperature);
    return {
      min: Math.min(...temps),
      max: Math.max(...temps),
      avg: temps.reduce((a, b) => a + b, 0) / temps.length,
    };
  }, [history]);

  return (
    <Card className={`${cardClasses} border-2 transition-colors`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${dotClasses}`} />
            {sensor.location}
          </span>
          <span className="text-xs text-muted-foreground font-normal">
            {sensor.sensor_type === 'negatif' ? 'Congélateur' : sensor.sensor_type === 'positif' ? 'Frigo' : 'Ambiant'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {latest ? (
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums">
              {latest.temperature.toFixed(1)}
            </span>
            <span className="text-lg text-muted-foreground">°C</span>
            {latest.humidity !== null && (
              <span className="text-xs text-muted-foreground ml-auto">
                {Math.round(latest.humidity)}% HR
              </span>
            )}
          </div>
        ) : (
          <div className="text-sm italic text-muted-foreground">
            Pas encore de relevé
          </div>
        )}

        {history.length > 1 && (
          <Sparkline
            data={history.slice().reverse().map(h => h.temperature)}
            tempMin={sensor.temp_min}
            tempMax={sensor.temp_max}
          />
        )}

        {tempStats && (
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span>min {tempStats.min.toFixed(1)}°</span>
            <span>max {tempStats.max.toFixed(1)}°</span>
            <span>moy {tempStats.avg.toFixed(1)}°</span>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-2">
          <span>
            Seuils{' '}
            {sensor.temp_min !== null ? `${sensor.temp_min}°` : '—'}{' / '}
            {sensor.temp_max !== null ? `${sensor.temp_max}°` : '—'}
          </span>
          {latest && (
            <span title={format(new Date(latest.recorded_at), 'PPPp', { locale: fr })}>
              {formatDistanceToNow(new Date(latest.recorded_at), { locale: fr, addSuffix: true })}
            </span>
          )}
        </div>

        {latest && latest.battery !== null && (
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span
              className={`flex items-center gap-1 ${
                latest.battery >= 70 ? 'text-emerald-600'
                : latest.battery >= 30 ? 'text-amber-600'
                : 'text-red-600 font-medium'
              }`}
              title={
                latest.battery >= 70 ? 'Pile pleine'
                : latest.battery >= 30 ? 'Pile moyenne — à surveiller'
                : 'Pile faible — à remplacer'
              }
            >
              <Battery className="w-3 h-3" />
              {latest.battery >= 70 ? 'Pile OK'
                : latest.battery >= 30 ? 'Pile moyenne'
                : 'Pile faible'}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Sparkline SVG sans dépendance — bandes seuils en pointillés rouges
// ============================================================================
function Sparkline({
  data, tempMin, tempMax,
}: {
  data: number[];
  tempMin: number | null;
  tempMax: number | null;
}) {
  if (data.length < 2) return null;

  const width = 280;
  const height = 50;

  const allValues = [
    ...data,
    ...(tempMin !== null ? [tempMin] : []),
    ...(tempMax !== null ? [tempMax] : []),
  ];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  const yOf = (v: number) => height - ((v - min) / range) * height;

  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * width},${yOf(v)}`)
    .join(' ');

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="overflow-visible text-foreground/70"
    >
      {tempMax !== null && (
        <line
          x1="0" y1={yOf(tempMax)} x2={width} y2={yOf(tempMax)}
          stroke="rgb(239 68 68 / 0.5)" strokeWidth="1" strokeDasharray="3 3"
        />
      )}
      {tempMin !== null && (
        <line
          x1="0" y1={yOf(tempMin)} x2={width} y2={yOf(tempMin)}
          stroke="rgb(239 68 68 / 0.5)" strokeWidth="1" strokeDasharray="3 3"
        />
      )}
      <polyline
        fill="none" stroke="currentColor" strokeWidth="1.5" points={points}
      />
    </svg>
  );
}
