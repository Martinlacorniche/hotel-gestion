'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useHotelScope } from '@/hooks/useHotelScope';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  SprayCan, Loader2, Settings, Check, Clock, Sun, CalendarDays, CalendarRange, Calendar,
  Undo2,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';
import {
  type CleaningZone, type CleaningTask, type CleaningLog, type CleaningFrequency,
  FREQUENCY_LABELS, periodKeyFor,
} from '../admin/nettoyage/types';

const SECTIONS: {
  key: CleaningFrequency;
  title: string;
  subtitle: string;
  icon: typeof Sun;
}[] = [
  { key: 'daily',     title: "Aujourd'hui",     subtitle: 'Tâches quotidiennes',     icon: Sun },
  { key: 'weekly',    title: 'Cette semaine',   subtitle: 'Tâches hebdomadaires',    icon: CalendarDays },
  { key: 'monthly',   title: 'Ce mois',         subtitle: 'Tâches mensuelles',       icon: CalendarRange },
  { key: 'quarterly', title: 'Ce trimestre',    subtitle: 'Tâches trimestrielles',   icon: Calendar },
];

export default function HACCPCleaningPage() {
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const { hotels, selectedHotelId, setSelectedHotelId } = useHotelScope();

  const [zones, setZones] = useState<CleaningZone[]>([]);
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [logs, setLogs] = useState<CleaningLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  // Chargement zones + tâches + logs des period_keys courantes
  const loadAll = useCallback(async (hotelId: string) => {
    setLoading(true);

    const now = new Date();
    const keys = SECTIONS.map(s => periodKeyFor(s.key, now));

    const [zRes, tRes, lRes] = await Promise.all([
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

    if (zRes.error) toast.error('Zones : ' + zRes.error.message);
    if (tRes.error) toast.error('Tâches : ' + tRes.error.message);
    if (lRes.error) toast.error('Validations : ' + lRes.error.message);

    setZones((zRes.data || []) as CleaningZone[]);
    setTasks((tRes.data || []) as CleaningTask[]);
    setLogs((lRes.data || []) as CleaningLog[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedHotelId) loadAll(selectedHotelId);
  }, [selectedHotelId, loadAll]);

  // Index : taskId+periodKey → log
  const logByKey = useMemo(() => {
    const m = new Map<string, CleaningLog>();
    for (const l of logs) m.set(`${l.task_id}|${l.period_key}`, l);
    return m;
  }, [logs]);

  // Tâches par zone et par fréquence
  const tasksByZone = useMemo(() => {
    const m: Record<string, CleaningTask[]> = {};
    for (const t of tasks) (m[t.zone_id] ||= []).push(t);
    return m;
  }, [tasks]);

  const validateTask = async (task: CleaningTask) => {
    if (!selectedHotelId || !user) return;
    const periodKey = periodKeyFor(task.frequency);
    const k = `${task.id}|${periodKey}`;
    if (logByKey.has(k)) return; // déjà fait
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
    if (error) {
      toast.error('Validation : ' + error.message);
      return;
    }
    setLogs(prev => [...prev, data as CleaningLog]);
  };

  const undoTask = async (log: CleaningLog) => {
    setBusyTaskId(log.task_id);
    const { error } = await supabase.from('haccp_cleaning_logs').delete().eq('id', log.id);
    setBusyTaskId(null);
    if (error) {
      toast.error('Annulation : ' + error.message);
      return;
    }
    setLogs(prev => prev.filter(l => l.id !== log.id));
    toast.success('Validation annulée');
  };

  // --- Guards ---
  if (authLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }
  if (!user) return <div className="p-8">Authentification requise.</div>;

  const hasAnyConfig = zones.length > 0 && tasks.length > 0;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <header className="mb-6 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <SprayCan className="w-6 h-6" /> Plan de nettoyage
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Coche les tâches au fur et à mesure de la journée.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hotels.length > 1 && (
            <select
              value={selectedHotelId || ''}
              onChange={e => setSelectedHotelId(e.target.value)}
              className="border rounded-md px-3 h-11 text-sm bg-background"
            >
              {hotels.map(h => <option key={h.id} value={h.id}>{h.nom}</option>)}
            </select>
          )}
          {isAdmin && (
            <Link href="/haccp/admin/nettoyage">
              <Button variant="outline" className="h-11">
                <Settings className="w-4 h-4 mr-1" /> Configurer
              </Button>
            </Link>
          )}
        </div>
      </header>

      {loading ? (
        <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : !hasAnyConfig ? (
        <Card>
          <CardContent className="py-12 text-center">
            <SprayCan className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
            <h3 className="font-semibold mb-1">Plan de nettoyage non configuré</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              {isAdmin
                ? 'Crée tes zones (cuisine, buffet…) puis ajoute les tâches récurrentes pour démarrer.'
                : 'Un administrateur doit configurer les zones et tâches avant que tu puisses commencer.'}
            </p>
            {isAdmin && (
              <Link href="/haccp/admin/nettoyage">
                <Button>
                  <Settings className="w-4 h-4 mr-1" /> Configurer maintenant
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {SECTIONS.map(section => {
            const sectionTasks = tasks.filter(t => t.frequency === section.key);
            if (sectionTasks.length === 0) return null;
            const periodKey = periodKeyFor(section.key);
            const done = sectionTasks.filter(t => logByKey.has(`${t.id}|${periodKey}`)).length;
            const total = sectionTasks.length;
            const Icon = section.icon;

            return (
              <section key={section.key}>
                <div className="flex items-end justify-between mb-2">
                  <div>
                    <h2 className="font-semibold flex items-center gap-2">
                      <Icon className="w-4 h-4" />
                      {section.title}
                      <span className="text-xs font-normal text-muted-foreground">
                        · {section.subtitle}
                      </span>
                    </h2>
                  </div>
                  <div className="text-sm tabular-nums text-muted-foreground">
                    <strong className={done === total ? 'text-emerald-600' : 'text-foreground'}>{done}</strong>
                    {' '}/ {total}
                  </div>
                </div>

                <div className="h-1 bg-muted rounded-full mb-3 overflow-hidden">
                  <div
                    className={`h-full transition-all ${done === total ? 'bg-emerald-500' : 'bg-foreground/40'}`}
                    style={{ width: total > 0 ? `${(done / total) * 100}%` : '0%' }}
                  />
                </div>

                <Card>
                  <CardContent className="p-0 divide-y">
                    {zones
                      .filter(z => (tasksByZone[z.id] || []).some(t => t.frequency === section.key))
                      .map(zone => (
                        <ZoneTasks
                          key={zone.id}
                          zone={zone}
                          tasks={(tasksByZone[zone.id] || []).filter(t => t.frequency === section.key)}
                          logByKey={logByKey}
                          periodKey={periodKey}
                          busyTaskId={busyTaskId}
                          isAdmin={isAdmin}
                          onValidate={validateTask}
                          onUndo={undoTask}
                        />
                      ))}
                  </CardContent>
                </Card>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Bloc des tâches d'une zone pour une fréquence donnée
// ============================================================================
function ZoneTasks({
  zone, tasks, logByKey, periodKey, busyTaskId, isAdmin, onValidate, onUndo,
}: {
  zone: CleaningZone;
  tasks: CleaningTask[];
  logByKey: Map<string, CleaningLog>;
  periodKey: string;
  busyTaskId: string | null;
  isAdmin: boolean;
  onValidate: (t: CleaningTask) => void;
  onUndo: (log: CleaningLog) => void;
}) {
  return (
    <div>
      <div className="px-4 py-2 flex items-center gap-2 bg-muted/30">
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
              className={`flex items-center gap-3 px-4 py-3.5 min-h-[56px] transition-colors ${
                done ? 'bg-emerald-50/40' : 'hover:bg-muted/20'
              }`}
            >
              <button
                onClick={() => !done && onValidate(task)}
                disabled={busy || done}
                aria-label={done ? 'Tâche faite' : 'Marquer comme faite'}
                className={`w-10 h-10 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                  done
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-slate-300 hover:border-foreground hover:bg-muted/40'
                } ${busy ? 'animate-pulse' : ''}`}
              >
                {busy
                  ? <Loader2 className="w-5 h-5 animate-spin" />
                  : done
                    ? <Check className="w-5 h-5" strokeWidth={3} />
                    : null}
              </button>
              <button
                onClick={() => !done && onValidate(task)}
                disabled={busy || done}
                className="flex-1 min-w-0 text-left py-1"
              >
                <div className={`font-medium ${done ? 'text-muted-foreground line-through' : ''}`}>
                  {task.name}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                  {task.product && <span>🧴 {task.product}</span>}
                  {task.estimated_min && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />{task.estimated_min} min
                    </span>
                  )}
                  {task.instructions && !done && (
                    <span className="italic truncate max-w-[60ch]">{task.instructions}</span>
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
                      title="Annuler la validation"
                      aria-label="Annuler la validation"
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
