'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSelectedHotel } from '@/context/SelectedHotelContext';
import { supabase } from '@/lib/supabaseClient';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  History, Loader2, Download, AlertTriangle, Check,
  ChevronLeft, ChevronRight, Thermometer,
} from 'lucide-react';
import { format, formatDistanceToNow, startOfMonth, endOfMonth, subMonths, subDays, startOfDay, endOfDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Sensor, Alert, Hotel } from '../registre/types';

type Reading = {
  id: number;
  sensor_id: string;
  temperature: number;
  humidity: number | null;
  recorded_at: string;
};

type Preset = '7d' | '30d' | 'this_month' | 'last_month' | 'custom';

const PAGE_SIZE = 50;

export default function HACCPHistoriquePage() {
  const { user, isLoading: authLoading } = useAuth();

  // ---- Sélecteurs ----
  const { selectedHotelId, setSelectedHotelId } = useSelectedHotel();
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [selectedSensorId, setSelectedSensorId] = useState<string>('all');
  const [preset, setPreset] = useState<Preset>('30d');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  // ---- Données ----
  const [readings, setReadings] = useState<Reading[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => { document.title = 'HACCP — Historique'; }, []);

  // ---- Calcul de la plage selon le preset ----
  const { periodStart, periodEnd, periodLabel } = useMemo(() => {
    const now = new Date();
    switch (preset) {
      case '7d':
        return { periodStart: subDays(now, 7), periodEnd: now, periodLabel: '7 derniers jours' };
      case '30d':
        return { periodStart: subDays(now, 30), periodEnd: now, periodLabel: '30 derniers jours' };
      case 'this_month':
        return { periodStart: startOfMonth(now), periodEnd: endOfMonth(now), periodLabel: format(now, 'MMMM yyyy', { locale: fr }) };
      case 'last_month': {
        const lm = subMonths(now, 1);
        return { periodStart: startOfMonth(lm), periodEnd: endOfMonth(lm), periodLabel: format(lm, 'MMMM yyyy', { locale: fr }) };
      }
      case 'custom':
        if (customStart && customEnd) {
          return {
            periodStart: startOfDay(new Date(customStart)),
            periodEnd: endOfDay(new Date(customEnd)),
            periodLabel: `${format(new Date(customStart), 'dd/MM/yyyy')} → ${format(new Date(customEnd), 'dd/MM/yyyy')}`,
          };
        }
        return { periodStart: subDays(now, 30), periodEnd: now, periodLabel: 'Sélectionne une période' };
    }
  }, [preset, customStart, customEnd]);

  // ---- Charge la liste d'hôtels ----
  useEffect(() => {
    if (!user) return;
    (async () => {
      const isSuperadmin = user.role === 'superadmin';
      const baseQuery = supabase.from('hotels').select('id, nom').order('nom');
      const userHotelId = user.hotel_id || user.default_hotel_id;
      const { data } = isSuperadmin
        ? await baseQuery
        : await baseQuery.eq('id', userHotelId || '');
      const list = (data || []) as Hotel[];
      if (!selectedHotelId && list.length > 0) setSelectedHotelId(userHotelId || list[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ---- Charge les sondes de l'hôtel sélectionné ----
  useEffect(() => {
    if (!selectedHotelId) return;
    (async () => {
      const { data } = await supabase
        .from('haccp_sensors')
        .select('*')
        .eq('hotel_id', selectedHotelId)
        .order('location');
      setSensors((data || []) as Sensor[]);
    })();
  }, [selectedHotelId]);

  // ---- Charge relevés + alertes pour la période ----
  const loadData = useCallback(async () => {
    if (!selectedHotelId || sensors.length === 0) {
      setReadings([]);
      setAlerts([]);
      return;
    }
    setLoading(true);
    setPage(0);

    const sensorIds = selectedSensorId === 'all'
      ? sensors.map(s => s.id)
      : [selectedSensorId];

    const [readingsRes, alertsRes] = await Promise.all([
      supabase
        .from('haccp_readings')
        .select('id, sensor_id, temperature, humidity, recorded_at')
        .in('sensor_id', sensorIds)
        .gte('recorded_at', periodStart.toISOString())
        .lte('recorded_at', periodEnd.toISOString())
        .order('recorded_at', { ascending: false })
        .limit(20_000),
      supabase
        .from('haccp_alerts')
        .select('*')
        .in('sensor_id', sensorIds)
        .gte('triggered_at', periodStart.toISOString())
        .lte('triggered_at', periodEnd.toISOString())
        .order('triggered_at', { ascending: false }),
    ]);

    setReadings((readingsRes.data || []) as Reading[]);
    setAlerts((alertsRes.data || []) as Alert[]);
    setLoading(false);
  }, [selectedHotelId, sensors, selectedSensorId, periodStart, periodEnd]);

  useEffect(() => { loadData(); }, [loadData]);

  // ---- Stats ----
  const stats = useMemo(() => {
    if (readings.length === 0) {
      return { count: 0, min: null, max: null, avg: null };
    }
    const temps = readings.map(r => r.temperature);
    const sum = temps.reduce((a, b) => a + b, 0);
    return {
      count: readings.length,
      min: Math.min(...temps),
      max: Math.max(...temps),
      avg: sum / temps.length,
    };
  }, [readings]);

  // ---- Sondes affichées dans le graph : grouper par sensor_id ----
  const seriesBySensor = useMemo(() => {
    const m = new Map<string, Reading[]>();
    for (const r of readings) {
      (m.get(r.sensor_id) || m.set(r.sensor_id, []).get(r.sensor_id)!).push(r);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
    }
    return m;
  }, [readings]);

  const sensorById = useMemo(() => new Map(sensors.map(s => [s.id, s])), [sensors]);

  // ---- Pagination relevés ----
  const pageCount = Math.max(1, Math.ceil(readings.length / PAGE_SIZE));
  const pagedReadings = readings.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // ---- Export CSV ----
  const exportCSV = () => {
    const header = ['Date', 'Heure', 'Sonde', 'Emplacement', 'Température (°C)', 'Humidité (%)'].join(';');
    const rows = readings.map(r => {
      const s = sensorById.get(r.sensor_id);
      const d = new Date(r.recorded_at);
      return [
        format(d, 'dd/MM/yyyy'),
        format(d, 'HH:mm:ss'),
        s?.friendly_name || r.sensor_id.slice(0, 8),
        s?.location || '',
        r.temperature.toFixed(1).replace('.', ','),
        r.humidity !== null ? Math.round(r.humidity) : '',
      ].join(';');
    });
    const csv = '﻿' + [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `haccp-historique-${format(periodStart, 'yyyy-MM-dd')}-${format(periodEnd, 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Rendu ----
  if (authLoading) return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!user) return <div className="p-8">Authentification requise.</div>;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <History className="w-6 h-6" /> Historique HACCP
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Consultation des relevés et alertes historiques. Sert de pièce de référence en cas de contrôle DDPP.
        </p>
      </header>

      {/* Sélecteurs */}
      <Card className="mb-4">
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sonde</label>
              <select
                value={selectedSensorId}
                onChange={e => setSelectedSensorId(e.target.value)}
                className="border rounded-md px-3 py-2 text-sm bg-background min-w-[200px]"
              >
                <option value="all">Toutes les sondes</option>
                {sensors.map(s => <option key={s.id} value={s.id}>{s.location}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Période</label>
              <div className="flex flex-wrap gap-1">
                {[
                  { v: '7d' as Preset, l: '7j' },
                  { v: '30d' as Preset, l: '30j' },
                  { v: 'this_month' as Preset, l: 'Ce mois' },
                  { v: 'last_month' as Preset, l: 'Mois -1' },
                  { v: 'custom' as Preset, l: 'Custom' },
                ].map(({ v, l }) => (
                  <button
                    key={v}
                    onClick={() => setPreset(v)}
                    className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                      preset === v
                        ? 'bg-foreground text-background border-foreground'
                        : 'bg-background hover:bg-muted'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {preset === 'custom' && (
              <div className="flex gap-2 items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Du</label>
                  <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                    className="border rounded-md px-2 py-1.5 text-sm bg-background" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Au</label>
                  <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                    className="border rounded-md px-2 py-1.5 text-sm bg-background" />
                </div>
              </div>
            )}

            <div className="ml-auto">
              <Button variant="outline" size="sm" onClick={exportCSV} disabled={readings.length === 0}>
                <Download className="w-4 h-4 mr-1.5" />
                Export CSV
              </Button>
            </div>
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            Période : <strong className="text-foreground capitalize">{periodLabel}</strong>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Relevés" value={stats.count.toLocaleString('fr-FR')} />
        <Stat label="T° min" value={stats.min !== null ? `${stats.min.toFixed(1)} °C` : '—'} />
        <Stat label="T° max" value={stats.max !== null ? `${stats.max.toFixed(1)} °C` : '—'} />
        <Stat label="Alertes" value={alerts.length} tone={alerts.length > 0 ? 'warn' : 'ok'} />
      </div>

      {loading ? (
        <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : readings.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Aucun relevé sur cette période.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Graphique */}
          <Card className="mb-4">
            <CardContent className="py-4">
              <div className="flex items-center gap-2 mb-3 text-sm font-medium">
                <Thermometer className="w-4 h-4" />
                Évolution des températures
              </div>
              <TempChart
                seriesBySensor={seriesBySensor}
                sensorById={sensorById}
                periodStart={periodStart}
                periodEnd={periodEnd}
              />
              <Legend sensors={selectedSensorId === 'all' ? sensors : sensors.filter(s => s.id === selectedSensorId)} />
            </CardContent>
          </Card>

          {/* Alertes */}
          {alerts.length > 0 && (
            <Card className="mb-4">
              <CardContent className="py-4">
                <div className="flex items-center gap-2 mb-3 text-sm font-medium">
                  <AlertTriangle className="w-4 h-4" />
                  Alertes ({alerts.length})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b">
                        <th className="text-left py-2 pr-3">Déclenchée</th>
                        <th className="text-left py-2 pr-3">Sonde</th>
                        <th className="text-left py-2 pr-3">Type</th>
                        <th className="text-right py-2 pr-3">Peak</th>
                        <th className="text-left py-2 pr-3">Durée</th>
                        <th className="text-left py-2 pr-3">Acquittement</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.map(a => {
                        const sensor = sensorById.get(a.sensor_id);
                        const durationMin = a.resolved_at
                          ? Math.round((new Date(a.resolved_at).getTime() - new Date(a.triggered_at).getTime()) / 60_000)
                          : null;
                        return (
                          <tr key={a.id} className="border-b last:border-b-0 hover:bg-muted/30">
                            <td className="py-2 pr-3 whitespace-nowrap">
                              {format(new Date(a.triggered_at), 'dd/MM HH:mm', { locale: fr })}
                            </td>
                            <td className="py-2 pr-3">{sensor?.location || a.sensor_id.slice(0, 8)}</td>
                            <td className="py-2 pr-3">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${
                                a.threshold_type === 'high' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                              }`}>
                                {a.threshold_type === 'high' ? 'Trop chaud' : 'Trop froid'}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums font-medium">{a.peak_value.toFixed(1)} °C</td>
                            <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                              {a.resolved_at ? `${durationMin} min` : <span className="text-red-600">En cours</span>}
                            </td>
                            <td className="py-2 pr-3">
                              {a.acknowledged_at ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
                                  <span className="text-xs">{a.action_taken || 'Acquittée'}</span>
                                </span>
                              ) : (
                                <span className="text-xs text-red-600">Non acquittée</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Relevés paginés */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium">Relevés détaillés</div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="w-3 h-3" />
                  </Button>
                  <span>Page {page + 1} / {pageCount}</span>
                  <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-left py-2 pr-3">Date</th>
                      <th className="text-left py-2 pr-3">Sonde</th>
                      <th className="text-right py-2 pr-3">T°</th>
                      <th className="text-right py-2 pr-3">HR</th>
                      <th className="text-left py-2 pr-3">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedReadings.map(r => {
                      const sensor = sensorById.get(r.sensor_id);
                      const breached = sensor && (
                        (sensor.temp_max !== null && r.temperature > sensor.temp_max) ||
                        (sensor.temp_min !== null && r.temperature < sensor.temp_min)
                      );
                      return (
                        <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/30">
                          <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">
                            {format(new Date(r.recorded_at), 'dd/MM/yyyy HH:mm:ss', { locale: fr })}
                          </td>
                          <td className="py-1.5 pr-3">{sensor?.location || r.sensor_id.slice(0, 8)}</td>
                          <td className={`py-1.5 pr-3 text-right tabular-nums font-medium ${breached ? 'text-red-600' : ''}`}>
                            {r.temperature.toFixed(1)} °C
                          </td>
                          <td className="py-1.5 pr-3 text-right text-muted-foreground tabular-nums">
                            {r.humidity !== null ? `${Math.round(r.humidity)} %` : '—'}
                          </td>
                          <td className="py-1.5 pr-3">
                            {breached ? (
                              <span className="text-xs text-red-600">Hors seuil</span>
                            ) : (
                              <span className="text-xs text-green-700">OK</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Stat
// ============================================================================
function Stat({ label, value, tone = 'default' }: {
  label: string;
  value: string | number;
  tone?: 'default' | 'ok' | 'warn';
}) {
  const color = tone === 'warn' ? 'text-amber-700' : tone === 'ok' ? 'text-emerald-700' : 'text-foreground';
  return (
    <Card>
      <CardContent className="py-3">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={`text-xl font-semibold mt-1 tabular-nums ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Légende
// ============================================================================
const PALETTE = [
  '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c',
  '#0891b2', '#db2777', '#65a30d',
];

function Legend({ sensors }: { sensors: Sensor[] }) {
  if (sensors.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
      {sensors.map((s, i) => (
        <span key={s.id} className="flex items-center gap-1.5">
          <span className="w-3 h-0.5" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
          {s.location}
        </span>
      ))}
    </div>
  );
}

// ============================================================================
// Graphique SVG multi-séries
// ============================================================================
function TempChart({
  seriesBySensor, sensorById, periodStart, periodEnd,
}: {
  seriesBySensor: Map<string, Reading[]>;
  sensorById: Map<string, Sensor>;
  periodStart: Date;
  periodEnd: Date;
}) {
  const width = 900;
  const height = 280;
  const padding = { top: 10, right: 10, bottom: 30, left: 40 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  // Trouver min/max global
  const { yMin, yMax } = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const arr of seriesBySensor.values()) {
      for (const r of arr) {
        if (r.temperature < lo) lo = r.temperature;
        if (r.temperature > hi) hi = r.temperature;
      }
    }
    for (const s of sensorById.values()) {
      if (s.temp_min !== null) lo = Math.min(lo, s.temp_min);
      if (s.temp_max !== null) hi = Math.max(hi, s.temp_max);
    }
    if (!isFinite(lo) || !isFinite(hi)) return { yMin: -20, yMax: 20 };
    const pad = (hi - lo) * 0.1 || 1;
    return { yMin: lo - pad, yMax: hi + pad };
  }, [seriesBySensor, sensorById]);

  const tStart = periodStart.getTime();
  const tEnd = periodEnd.getTime();
  const tRange = tEnd - tStart || 1;
  const yRange = yMax - yMin || 1;

  const xOf = (ms: number) => padding.left + ((ms - tStart) / tRange) * innerW;
  const yOf = (v: number) => padding.top + ((yMax - v) / yRange) * innerH;

  // Ticks Y (5 niveaux)
  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    const step = yRange / 4;
    for (let i = 0; i <= 4; i++) ticks.push(yMin + i * step);
    return ticks;
  }, [yMin, yRange]);

  // Ticks X (5 labels)
  const xTicks = useMemo(() => {
    const ticks: Date[] = [];
    for (let i = 0; i <= 4; i++) ticks.push(new Date(tStart + (tRange * i) / 4));
    return ticks;
  }, [tStart, tRange]);

  const sensorEntries = Array.from(seriesBySensor.entries());

  // Récupère seuils des sondes affichées
  const thresholds = useMemo(() => {
    const lines: { y: number; type: 'min' | 'max' }[] = [];
    const sensorIds = new Set(seriesBySensor.keys());
    for (const id of sensorIds) {
      const s = sensorById.get(id);
      if (!s) continue;
      if (s.temp_min !== null) lines.push({ y: s.temp_min, type: 'min' });
      if (s.temp_max !== null) lines.push({ y: s.temp_max, type: 'max' });
    }
    // Dedup
    const seen = new Set<string>();
    return lines.filter(l => {
      const k = `${l.y}-${l.type}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [seriesBySensor, sensorById]);

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {/* Grille Y + labels */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line
            x1={padding.left} y1={yOf(t)} x2={width - padding.right} y2={yOf(t)}
            stroke="currentColor" strokeOpacity="0.08"
          />
          <text x={padding.left - 6} y={yOf(t) + 3} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.6">
            {t.toFixed(0)}°
          </text>
        </g>
      ))}

      {/* Labels X */}
      {xTicks.map((d, i) => (
        <text key={i} x={xOf(d.getTime())} y={height - 10} textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.6">
          {format(d, 'dd/MM', { locale: fr })}
        </text>
      ))}

      {/* Seuils */}
      {thresholds.map((t, i) => (
        <line
          key={i}
          x1={padding.left} y1={yOf(t.y)} x2={width - padding.right} y2={yOf(t.y)}
          stroke="rgb(239 68 68)" strokeOpacity="0.4"
          strokeWidth="1" strokeDasharray="4 4"
        />
      ))}

      {/* Séries */}
      {sensorEntries.map(([sensorId, points], idx) => {
        if (points.length < 2) return null;
        const color = PALETTE[idx % PALETTE.length];
        const path = points
          .map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(new Date(p.recorded_at).getTime())},${yOf(p.temperature)}`)
          .join(' ');
        return <path key={sensorId} d={path} fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />;
      })}
    </svg>
  );
}
