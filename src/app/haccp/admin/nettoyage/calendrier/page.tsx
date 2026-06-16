'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  SprayCan, Loader2, Lock, ChevronLeft, ChevronRight, ArrowLeft, Settings,
} from 'lucide-react';
import {
  startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, addWeeks,
  startOfQuarter, format, isAfter, isBefore, isSameDay, addMonths, subMonths,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Hotel } from '../../../registre/types';
import {
  type CleaningZone, type CleaningTask, type CleaningLog, type CleaningFrequency,
  FREQUENCY_LABELS, FREQUENCY_BADGE_CLASSES,
} from '../types';

type Window = { key: string; start: Date; end: Date; label: string };

export default function CleaningCalendrierPage() {
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [selectedHotelId, setSelectedHotelId] = useState<string | null>(null);
  const [period, setPeriod] = useState(() => startOfMonth(new Date()));

  const [zones, setZones] = useState<CleaningZone[]>([]);
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [logs, setLogs] = useState<CleaningLog[]>([]);
  const [loading, setLoading] = useState(false);

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

  const loadData = useCallback(async (hotelId: string, periodStart: Date, periodEnd: Date) => {
    setLoading(true);

    // On élargit la requête logs aux fenêtres qui chevauchent le mois (weekly/quarterly/monthly)
    // En pratique, on récupère tous les logs avec period_key entre début et fin de mois,
    // + on couvre weekly/quarterly avec un padding amont.
    const lookbackStart = startOfQuarter(periodStart);
    const lookforwardEnd = endOfMonth(addMonths(periodEnd, 1));

    const [zRes, tRes, lRes] = await Promise.all([
      supabase
        .from('haccp_cleaning_zones')
        .select('*')
        .eq('hotel_id', hotelId)
        .order('sort_order'),
      supabase
        .from('haccp_cleaning_tasks')
        .select('*, haccp_cleaning_zones!inner(hotel_id)')
        .eq('haccp_cleaning_zones.hotel_id', hotelId)
        .order('sort_order'),
      supabase
        .from('haccp_cleaning_logs')
        .select('*')
        .eq('hotel_id', hotelId)
        .gte('period_key', format(lookbackStart, 'yyyy-MM-dd'))
        .lte('period_key', format(lookforwardEnd, 'yyyy-MM-dd')),
    ]);

    setZones((zRes.data || []) as CleaningZone[]);
    setTasks((tRes.data || []) as CleaningTask[]);
    setLogs((lRes.data || []) as CleaningLog[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedHotelId) loadData(selectedHotelId, period, endOfMonth(period));
  }, [selectedHotelId, period, loadData]);

  // Index logs : taskId+periodKey → log
  const logByKey = useMemo(() => {
    const m = new Map<string, CleaningLog>();
    for (const l of logs) m.set(`${l.task_id}|${l.period_key}`, l);
    return m;
  }, [logs]);

  // Fenêtres du mois pour chaque fréquence
  const windowsFor = useCallback((freq: CleaningFrequency): Window[] => {
    const monthStart = period;
    const monthEnd = endOfMonth(period);
    if (freq === 'daily') {
      return eachDayOfInterval({ start: monthStart, end: monthEnd }).map(d => ({
        key: format(d, 'yyyy-MM-dd'),
        start: d,
        end: d,
        label: format(d, 'd'),
      }));
    }
    if (freq === 'weekly') {
      const out: Window[] = [];
      let cur = startOfWeek(monthStart, { weekStartsOn: 1 });
      // Inclure la semaine du dernier jour du mois
      while (cur <= monthEnd) {
        const weekEnd = new Date(cur);
        weekEnd.setDate(cur.getDate() + 6);
        // Garde les semaines qui chevauchent le mois
        if (weekEnd >= monthStart) {
          out.push({
            key: format(cur, 'yyyy-MM-dd'),
            start: new Date(cur),
            end: weekEnd,
            label: `S${format(cur, 'w', { locale: fr })}`,
          });
        }
        cur = addWeeks(cur, 1);
      }
      return out;
    }
    if (freq === 'monthly') {
      return [{
        key: format(monthStart, 'yyyy-MM-dd'),
        start: monthStart,
        end: monthEnd,
        label: format(monthStart, 'MMM', { locale: fr }),
      }];
    }
    // quarterly
    const qStart = startOfQuarter(monthStart);
    return [{
      key: format(qStart, 'yyyy-MM-dd'),
      start: qStart,
      end: endOfMonth(addMonths(qStart, 2)),
      label: `T${Math.floor(qStart.getMonth() / 3) + 1}`,
    }];
  }, [period]);

  const tasksByZone = useMemo(() => {
    const m = new Map<string, CleaningTask[]>();
    for (const t of tasks) {
      const list = m.get(t.zone_id) || [];
      list.push(t);
      m.set(t.zone_id, list);
    }
    return m;
  }, [tasks]);

  // Stat globale : combien de fenêtres dues sur le mois, combien faites
  const monthStats = useMemo(() => {
    const today = new Date();
    let due = 0;
    let done = 0;
    for (const t of tasks) {
      if (!t.active) continue;
      for (const w of windowsFor(t.frequency)) {
        // Une fenêtre est "due" si elle est passée ou en cours
        if (isAfter(w.start, today)) continue;
        due++;
        if (logByKey.has(`${t.id}|${w.key}`)) done++;
      }
    }
    return { due, done };
  }, [tasks, logByKey, windowsFor]);

  if (authLoading) return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!user) return <div className="p-8">Authentification requise.</div>;
  if (!isAdmin) {
    return (
      <div className="p-8 max-w-md mx-auto">
        <Card>
          <CardContent className="py-8 text-center">
            <Lock className="w-10 h-10 mx-auto mb-3 text-muted-foreground/60" />
            <h2 className="font-semibold mb-1">Accès réservé</h2>
            <p className="text-sm text-muted-foreground">Vue calendrier réservée aux administrateurs.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isCurrentOrFutureMonth = !isAfter(startOfMonth(new Date()), period);
  const activeZones = zones.filter(z => z.active);
  const pct = monthStats.due > 0 ? Math.round((monthStats.done / monthStats.due) * 100) : 100;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <header className="mb-6 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <Link
            href="/haccp/admin/nettoyage"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-1"
          >
            <ArrowLeft className="w-3 h-3" /> Retour à la configuration
          </Link>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <SprayCan className="w-6 h-6" /> Calendrier de nettoyage
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Vue mensuelle des validations par tâche. Vert = fait, rouge = manqué, gris = à venir.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hotels.length > 1 && (
            <select
              value={selectedHotelId || ''}
              onChange={e => setSelectedHotelId(e.target.value)}
              className="border rounded-md px-3 py-2 text-sm bg-background"
            >
              {hotels.map(h => <option key={h.id} value={h.id}>{h.nom}</option>)}
            </select>
          )}
          <Link href="/haccp/admin/nettoyage">
            <Button variant="outline" size="sm">
              <Settings className="w-4 h-4 mr-1" /> Config
            </Button>
          </Link>
        </div>
      </header>

      <div className="flex items-center gap-2 mb-6">
        <Button variant="outline" size="sm" onClick={() => setPeriod(p => subMonths(p, 1))}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="font-medium min-w-[160px] text-center capitalize">
          {format(period, 'MMMM yyyy', { locale: fr })}
        </span>
        <Button
          variant="outline" size="sm"
          disabled={isCurrentOrFutureMonth}
          onClick={() => setPeriod(p => addMonths(p, 1))}
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
        <div className="ml-auto text-sm">
          Complétion :{' '}
          <strong className={pct >= 90 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-red-600'}>
            {pct}%
          </strong>
          <span className="text-muted-foreground"> ({monthStats.done} / {monthStats.due} dues)</span>
        </div>
      </div>

      {loading ? (
        <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : activeZones.length === 0 || tasks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Aucune tâche configurée pour cet hôtel.{' '}
            <Link href="/haccp/admin/nettoyage" className="underline hover:no-underline">Configurer →</Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {activeZones.map(zone => {
            const zoneTasks = (tasksByZone.get(zone.id) || []).filter(t => t.active);
            if (zoneTasks.length === 0) return null;
            return (
              <Card key={zone.id}>
                <CardContent className="p-0">
                  <div className="px-4 py-2.5 flex items-center gap-2 border-b">
                    <span className="text-base">{zone.icon || '🧽'}</span>
                    <span className="font-semibold">{zone.name}</span>
                  </div>
                  <div className="divide-y">
                    {zoneTasks.map(task => (
                      <TaskCalendarRow
                        key={task.id}
                        task={task}
                        windows={windowsFor(task.frequency)}
                        logByKey={logByKey}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Ligne tâche avec frise de fenêtres
// ============================================================================
function TaskCalendarRow({
  task, windows, logByKey,
}: {
  task: CleaningTask;
  windows: Window[];
  logByKey: Map<string, CleaningLog>;
}) {
  const today = new Date();
  let done = 0;
  let due = 0;
  for (const w of windows) {
    if (isAfter(w.start, today)) continue;
    due++;
    if (logByKey.has(`${task.id}|${w.key}`)) done++;
  }
  const pct = due > 0 ? Math.round((done / due) * 100) : 100;

  return (
    <div className="px-4 py-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 md:gap-4 items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{task.name}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded border ${FREQUENCY_BADGE_CLASSES[task.frequency]}`}>
            {FREQUENCY_LABELS[task.frequency]}
          </span>
        </div>
        <div className="flex flex-wrap gap-0.5 mt-1.5 max-w-full">
          {windows.map(w => {
            const log = logByKey.get(`${task.id}|${w.key}`);
            const isFuture = isAfter(w.start, today);
            const isCurrent =
              !isFuture &&
              (isSameDay(w.start, today) ||
                (isBefore(w.start, today) && !isBefore(w.end, today)));
            const cls = log
              ? 'bg-emerald-500 text-white'
              : isFuture
                ? 'bg-slate-100 text-slate-400'
                : isCurrent
                  ? 'bg-amber-100 text-amber-700 border border-amber-400'
                  : 'bg-red-100 text-red-700 border border-red-300';
            return (
              <div
                key={w.key}
                title={`${format(w.start, 'd MMM', { locale: fr })}${
                  task.frequency !== 'daily' ? ` → ${format(w.end, 'd MMM', { locale: fr })}` : ''
                } — ${
                  log
                    ? `Fait${log.done_by_name ? ' par ' + log.done_by_name : ''}`
                    : isFuture ? 'À venir' : isCurrent ? 'En cours' : 'Manqué'
                }`}
                className={`text-[10px] tabular-nums rounded px-1 py-0.5 min-w-[20px] text-center ${cls}`}
              >
                {w.label}
              </div>
            );
          })}
        </div>
      </div>
      <div className="text-xs tabular-nums shrink-0 text-right">
        <div className={pct >= 90 ? 'text-emerald-600 font-medium' : pct >= 70 ? 'text-amber-600 font-medium' : 'text-red-600 font-medium'}>
          {pct}%
        </div>
        <div className="text-muted-foreground">{done} / {due}</div>
      </div>
    </div>
  );
}
