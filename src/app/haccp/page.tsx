'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useHotelScope } from '@/hooks/useHotelScope';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Thermometer, AlertTriangle, Loader2, Check, ChevronRight, Undo2,
  SprayCan, FileText, FolderOpen, Sun, CalendarDays, CalendarRange, Calendar, Clock,
} from 'lucide-react';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';
import {
  type CleaningZone, type CleaningTask, type CleaningLog, type CleaningFrequency,
  periodKeyFor,
} from './admin/nettoyage/types';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------
type Sensor = {
  id: string;
  hotel_id: string;
  location: string;
  sensor_type: 'negatif' | 'positif' | 'ambient';
  temp_min: number | null;
  temp_max: number | null;
};

type Reading = {
  sensor_id: string;
  temperature: number;
  recorded_at: string;
};

type Alert = {
  id: string;
  sensor_id: string;
  threshold_type: 'high' | 'low';
  triggered_at: string;
  peak_value: number;
  acknowledged_at: string | null;
  action_taken: string | null;
};

type SensorStatus = 'ok' | 'warning' | 'alert' | 'unknown';

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------
export default function HACCPHome() {
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const { hotels, selectedHotelId, setSelectedHotelId } = useHotelScope();

  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [latestReadings, setLatestReadings] = useState<Record<string, Reading>>({});
  const [activeAlerts, setActiveAlerts] = useState<Alert[]>([]);

  const [zones, setZones] = useState<CleaningZone[]>([]);
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [logs, setLogs] = useState<CleaningLog[]>([]);

  const [loading, setLoading] = useState(true);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  // Data
  const loadAll = useCallback(async (hotelId: string) => {
    setLoading(true);
    const now = new Date();
    const keys: string[] = ['daily', 'weekly', 'monthly', 'quarterly']
      .map(f => periodKeyFor(f as CleaningFrequency, now));

    const sensorsRes = await supabase
      .from('haccp_sensors')
      .select('id, hotel_id, location, sensor_type, temp_min, temp_max')
      .eq('hotel_id', hotelId)
      .eq('active', true)
      .order('location');

    const sensorsList = (sensorsRes.data || []) as Sensor[];
    const sensorIds = sensorsList.map(s => s.id);

    const [readingsRes, alertsRes, zonesRes, tasksRes, logsRes] = await Promise.all([
      sensorIds.length > 0
        ? supabase
            .from('haccp_readings')
            .select('sensor_id, temperature, recorded_at')
            .in('sensor_id', sensorIds)
            .gte('recorded_at', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
            .order('recorded_at', { ascending: false })
        : Promise.resolve({ data: [] as Reading[], error: null }),
      sensorIds.length > 0
        ? supabase
            .from('haccp_alerts')
            .select('*')
            .in('sensor_id', sensorIds)
            .is('resolved_at', null)
            .order('triggered_at', { ascending: false })
        : Promise.resolve({ data: [] as Alert[], error: null }),
      supabase
        .from('haccp_cleaning_zones')
        .select('*')
        .eq('hotel_id', hotelId)
        .eq('active', true)
        .order('sort_order'),
      supabase
        .from('haccp_cleaning_tasks')
        .select('*, haccp_cleaning_zones!inner(hotel_id, active)')
        .eq('haccp_cleaning_zones.hotel_id', hotelId)
        .eq('haccp_cleaning_zones.active', true)
        .eq('active', true)
        .order('sort_order'),
      supabase
        .from('haccp_cleaning_logs')
        .select('*')
        .eq('hotel_id', hotelId)
        .in('period_key', keys),
    ]);

    const latest: Record<string, Reading> = {};
    for (const r of (readingsRes.data || []) as Reading[]) {
      if (!latest[r.sensor_id]) latest[r.sensor_id] = r;
    }

    setSensors(sensorsList);
    setLatestReadings(latest);
    setActiveAlerts((alertsRes.data || []) as Alert[]);
    setZones((zonesRes.data || []) as CleaningZone[]);
    setTasks((tasksRes.data || []) as CleaningTask[]);
    setLogs((logsRes.data || []) as CleaningLog[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!selectedHotelId) return;
    loadAll(selectedHotelId);
    const t = setInterval(() => loadAll(selectedHotelId), 60_000);
    return () => clearInterval(t);
  }, [selectedHotelId, loadAll]);

  const logByKey = useMemo(() => {
    const m = new Map<string, CleaningLog>();
    for (const l of logs) m.set(`${l.task_id}|${l.period_key}`, l);
    return m;
  }, [logs]);

  const validateTask = async (task: CleaningTask) => {
    if (!selectedHotelId || !user) return;
    const periodKey = periodKeyFor(task.frequency);
    const k = `${task.id}|${periodKey}`;
    if (logByKey.has(k)) return;
    setBusyTaskId(task.id);
    const { data, error } = await supabase
      .from('haccp_cleaning_logs')
      .insert({
        task_id: task.id,
        hotel_id: selectedHotelId,
        done_by: user.id,
        done_by_name: user.name || user.email || null,
        period_key: periodKey,
      })
      .select()
      .single();
    setBusyTaskId(null);
    if (error) { toast.error('Validation : ' + error.message); return; }
    setLogs(prev => [...prev, data as CleaningLog]);
  };

  const undoTask = async (log: CleaningLog) => {
    setBusyTaskId(log.task_id);
    const { error } = await supabase.from('haccp_cleaning_logs').delete().eq('id', log.id);
    setBusyTaskId(null);
    if (error) { toast.error('Annulation : ' + error.message); return; }
    setLogs(prev => prev.filter(l => l.id !== log.id));
  };

  if (authLoading) return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!user) return <div className="p-8">Authentification requise.</div>;

  const firstName = user.name?.split(' ')[0] || '';

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <PageHeader
        icon={Thermometer}
        title={`HACCP${firstName ? ` · Bonjour ${firstName}` : ''}`}
        subtitle="Ton tableau de bord du jour — alertes, tâches, températures."
        iconClassName="bg-rose-50 text-rose-700"
      />

      {loading ? (
        <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="space-y-6">
          {/* Bandeau alertes T° */}
          {activeAlerts.length > 0 && (
            <ActiveAlertsBanner
              alerts={activeAlerts}
              sensors={sensors}
              userId={user.id}
              onAcknowledged={() => selectedHotelId && loadAll(selectedHotelId)}
            />
          )}

          {/* Section nettoyage du jour */}
          <CleaningTodaySection
            zones={zones}
            tasks={tasks}
            logByKey={logByKey}
            busyTaskId={busyTaskId}
            isAdmin={isAdmin}
            onValidate={validateTask}
            onUndo={undoTask}
          />

          {/* Section frigos compacte */}
          <TemperaturesCompactSection
            sensors={sensors}
            latestReadings={latestReadings}
            activeAlerts={activeAlerts}
          />

          {/* Raccourcis */}
          <ShortcutsSection />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Bandeau alertes T°
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
    if (error) { toast.error('Échec acquittement : ' + error.message); return; }
    toast.success('Alerte acquittée');
    onAcknowledged();
  };

  return (
    <div className="rounded-md border-2 border-red-400 bg-red-50/40 p-4">
      <h2 className="text-sm font-semibold text-red-700 flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4" />
        {alerts.length} alerte{alerts.length > 1 ? 's' : ''} température en cours
      </h2>
      <ul className="space-y-2">
        {alerts.map(a => {
          const sensor = sensors.find(s => s.id === a.sensor_id);
          return (
            <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                <strong>{sensor?.location || a.sensor_id.slice(0, 8)}</strong> — dépassement{' '}
                {a.threshold_type === 'high' ? 'haut' : 'bas'} à{' '}
                <strong>{a.peak_value.toFixed(1)} °C</strong>{' '}
                <span className="text-muted-foreground">
                  ({formatDistanceToNow(new Date(a.triggered_at), { locale: fr, addSuffix: true })})
                </span>
              </span>
              <Button variant="outline" onClick={() => acknowledge(a.id)} disabled={busy === a.id} className="h-11 px-4 shrink-0">
                {busy === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                Acquitter
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ============================================================================
// Section nettoyage du jour
// ============================================================================
function CleaningTodaySection({
  zones, tasks, logByKey, busyTaskId, isAdmin, onValidate, onUndo,
}: {
  zones: CleaningZone[];
  tasks: CleaningTask[];
  logByKey: Map<string, CleaningLog>;
  busyTaskId: string | null;
  isAdmin: boolean;
  onValidate: (t: CleaningTask) => void;
  onUndo: (log: CleaningLog) => void;
}) {
  const dailyTasks = tasks.filter(t => t.frequency === 'daily');
  const periodKeyToday = periodKeyFor('daily');
  const doneToday = dailyTasks.filter(t => logByKey.has(`${t.id}|${periodKeyToday}`)).length;

  // Compteurs autres fréquences (badges raccourci)
  const counters: { freq: CleaningFrequency; label: string; icon: typeof Sun; done: number; total: number }[] = [
    { freq: 'weekly',    label: 'Semaine',   icon: CalendarDays,  done: 0, total: 0 },
    { freq: 'monthly',   label: 'Mois',      icon: CalendarRange, done: 0, total: 0 },
    { freq: 'quarterly', label: 'Trimestre', icon: Calendar,      done: 0, total: 0 },
  ];
  for (const c of counters) {
    const list = tasks.filter(t => t.frequency === c.freq);
    const k = periodKeyFor(c.freq);
    c.total = list.length;
    c.done = list.filter(t => logByKey.has(`${t.id}|${k}`)).length;
  }

  // Empty global : pas de plan configuré
  if (zones.length === 0 || tasks.length === 0) {
    return (
      <section>
        <SectionHeader icon={SprayCan} title="Plan de nettoyage" />
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Plan de nettoyage non configuré.{' '}
            {isAdmin && (
              <Link href="/haccp/admin/nettoyage" className="underline hover:no-underline">
                Configurer maintenant
              </Link>
            )}
          </CardContent>
        </Card>
      </section>
    );
  }

  // Tâches daily groupées par zone (ordre des zones)
  const tasksByZone = new Map<string, CleaningTask[]>();
  for (const t of dailyTasks) {
    const list = tasksByZone.get(t.zone_id) || [];
    list.push(t);
    tasksByZone.set(t.zone_id, list);
  }

  return (
    <section>
      <div className="flex items-end justify-between mb-2">
        <h2 className="font-semibold flex items-center gap-2">
          <Sun className="w-4 h-4" /> À faire aujourd&apos;hui
        </h2>
        <Link href="/haccp/nettoyage" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5">
          Voir tout <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      {dailyTasks.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Aucune tâche quotidienne configurée.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 pt-3 pb-2 flex items-center gap-3">
              <div className="flex-1">
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${doneToday === dailyTasks.length ? 'bg-emerald-500' : 'bg-foreground/40'}`}
                    style={{ width: `${(doneToday / dailyTasks.length) * 100}%` }}
                  />
                </div>
              </div>
              <div className="text-sm tabular-nums shrink-0">
                <strong className={doneToday === dailyTasks.length ? 'text-emerald-600' : ''}>{doneToday}</strong>
                <span className="text-muted-foreground"> / {dailyTasks.length}</span>
              </div>
            </div>
            <div className="divide-y">
              {zones
                .filter(z => tasksByZone.has(z.id))
                .map(zone => (
                  <ZoneTasksBlock
                    key={zone.id}
                    zone={zone}
                    tasks={tasksByZone.get(zone.id) || []}
                    periodKey={periodKeyToday}
                    logByKey={logByKey}
                    busyTaskId={busyTaskId}
                    isAdmin={isAdmin}
                    onValidate={onValidate}
                    onUndo={onUndo}
                  />
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Compteurs autres fréquences */}
      <div className="grid grid-cols-3 gap-2 mt-2">
        {counters.map(c => {
          if (c.total === 0) return <div key={c.freq} />;
          const Icon = c.icon;
          const complete = c.done === c.total;
          return (
            <Link
              key={c.freq}
              href="/haccp/nettoyage"
              className="rounded-md border bg-background hover:bg-muted/40 transition-colors px-3 py-2 text-xs flex items-center gap-2"
            >
              <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium">{c.label}</span>
              <span className="ml-auto tabular-nums">
                <span className={complete ? 'text-emerald-600 font-medium' : ''}>{c.done}</span>
                <span className="text-muted-foreground">/{c.total}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function ZoneTasksBlock({
  zone, tasks, periodKey, logByKey, busyTaskId, isAdmin, onValidate, onUndo,
}: {
  zone: CleaningZone;
  tasks: CleaningTask[];
  periodKey: string;
  logByKey: Map<string, CleaningLog>;
  busyTaskId: string | null;
  isAdmin: boolean;
  onValidate: (t: CleaningTask) => void;
  onUndo: (log: CleaningLog) => void;
}) {
  return (
    <div>
      <div className="px-4 py-1.5 flex items-center gap-2 bg-muted/30">
        <span className="text-base">{zone.icon || '🧽'}</span>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {zone.name}
        </span>
      </div>
      <div className="divide-y">
        {tasks.map(task => {
          const log = logByKey.get(`${task.id}|${periodKey}`);
          const done = !!log;
          const busy = busyTaskId === task.id;
          return (
            <div
              key={task.id}
              className={`flex items-center gap-3 px-4 py-3 min-h-[56px] transition-colors ${
                done ? 'bg-emerald-50/40' : 'hover:bg-muted/20'
              }`}
            >
              <button
                onClick={() => !done && onValidate(task)}
                disabled={busy || done}
                className={`w-10 h-10 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                  done
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-slate-300 hover:border-foreground hover:bg-muted/40'
                }`}
                aria-label={done ? 'Faite' : 'Marquer comme faite'}
              >
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : done ? <Check className="w-5 h-5" strokeWidth={3} /> : null}
              </button>
              <button
                onClick={() => !done && onValidate(task)}
                disabled={busy || done}
                className="flex-1 min-w-0 text-left py-1"
              >
                <div className={`text-sm font-medium ${done ? 'text-muted-foreground line-through' : ''}`}>
                  {task.name}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                  {task.product && <span>🧴 {task.product}</span>}
                  {task.estimated_min && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />{task.estimated_min} min
                    </span>
                  )}
                </div>
              </button>
              {done && log && (
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-xs text-right text-muted-foreground">
                    <div>{log.done_by_name || '—'}</div>
                    <div>{format(parseISO(log.done_at), 'HH:mm', { locale: fr })}</div>
                  </div>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onUndo(log)}
                      disabled={busy}
                      title="Annuler"
                      aria-label="Annuler"
                      className="h-11 w-11 p-0 text-muted-foreground hover:text-foreground"
                    >
                      <Undo2 className="w-5 h-5" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Section températures compacte
// ============================================================================
function TemperaturesCompactSection({
  sensors, latestReadings, activeAlerts,
}: {
  sensors: Sensor[];
  latestReadings: Record<string, Reading>;
  activeAlerts: Alert[];
}) {
  if (sensors.length === 0) {
    return (
      <section>
        <SectionHeader icon={Thermometer} title="Températures" href="/haccp/temperatures" />
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Aucune sonde configurée pour cet hôtel.
          </CardContent>
        </Card>
      </section>
    );
  }

  const computeStatus = (sensor: Sensor): SensorStatus => {
    const latest = latestReadings[sensor.id];
    if (!latest) return 'unknown';
    if (activeAlerts.some(a => a.sensor_id === sensor.id)) return 'alert';
    const { temperature } = latest;
    const { temp_min, temp_max } = sensor;
    if (temp_max !== null && temperature > temp_max) return 'alert';
    if (temp_min !== null && temperature < temp_min) return 'alert';
    if (temp_max !== null && temperature > temp_max - 1) return 'warning';
    if (temp_min !== null && temperature < temp_min + 1) return 'warning';
    return 'ok';
  };

  return (
    <section>
      <SectionHeader icon={Thermometer} title="Températures" href="/haccp/temperatures" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {sensors.map(sensor => {
          const latest = latestReadings[sensor.id];
          const status = computeStatus(sensor);
          return (
            <Link
              key={sensor.id}
              href="/haccp/temperatures"
              className={`rounded-md border bg-background hover:shadow-sm transition-all px-3 py-2.5 ${
                status === 'alert' ? 'border-red-300 bg-red-50/40'
                : status === 'warning' ? 'border-amber-300 bg-amber-50/40'
                : status === 'unknown' ? 'border-slate-200 bg-slate-50/30'
                : 'border-slate-200'
              }`}
            >
              <div className="text-xs text-muted-foreground truncate">{sensor.location}</div>
              <div className="flex items-baseline gap-1 mt-0.5">
                <SensorDot status={status} />
                <span className="text-lg font-semibold tabular-nums">
                  {latest ? latest.temperature.toFixed(1) : '—'}
                </span>
                <span className="text-xs text-muted-foreground">°C</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function SensorDot({ status }: { status: SensorStatus }) {
  const cls = {
    ok:      'bg-emerald-500',
    warning: 'bg-amber-500',
    alert:   'bg-red-500',
    unknown: 'bg-slate-300',
  }[status];
  return <span className={`w-2 h-2 rounded-full ${cls} mr-1`} />;
}

// ============================================================================
// Section raccourcis
// ============================================================================
function ShortcutsSection() {
  const shortcuts = [
    { href: '/haccp/registre',   icon: FileText,   title: 'Registre du mois',   desc: 'Export PDF pour contrôle DDPP' },
    { href: '/haccp/documents',  icon: FolderOpen, title: 'Documents',          desc: 'PMS, FT/FDS, formations, contrats' },
  ];
  return (
    <section>
      <SectionHeader title="Raccourcis" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {shortcuts.map(s => {
          const Icon = s.icon;
          return (
            <Link
              key={s.href}
              href={s.href}
              className="rounded-md border bg-background hover:bg-muted/40 transition-colors px-3 py-3 flex items-start gap-3"
            >
              <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium">{s.title}</div>
                <div className="text-xs text-muted-foreground truncate">{s.desc}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ============================================================================
// Helper section header
// ============================================================================
function SectionHeader({
  icon: Icon, title, href,
}: {
  icon?: typeof Sun;
  title: string;
  href?: string;
}) {
  return (
    <div className="flex items-end justify-between mb-2">
      <h2 className="font-semibold flex items-center gap-2">
        {Icon && <Icon className="w-4 h-4" />}
        {title}
      </h2>
      {href && (
        <Link href={href} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5">
          Voir le détail <ChevronRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}
