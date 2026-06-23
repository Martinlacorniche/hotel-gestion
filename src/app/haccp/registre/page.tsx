'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useHotelScope } from '@/hooks/useHotelScope';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  FileText, FileDown, Loader2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths, addMonths, isAfter } from 'date-fns';
import { fr } from 'date-fns/locale';

import { PDFDownloadLink } from '@react-pdf/renderer';
import { RegistrePDF } from './RegistrePDF';
import type { Sensor, Reading, Alert } from './types';
import type {
  CleaningZone, CleaningTask, CleaningLog,
} from '../admin/nettoyage/types';

export default function RegistrePage() {
  const { user, isLoading: authLoading } = useAuth();
  const { hotels, selectedHotelId, setSelectedHotelId } = useHotelScope();
  const [period, setPeriod] = useState(() => startOfMonth(new Date()));

  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [cleaningZones, setCleaningZones] = useState<CleaningZone[]>([]);
  const [cleaningTasks, setCleaningTasks] = useState<CleaningTask[]>([]);
  const [cleaningLogs, setCleaningLogs] = useState<CleaningLog[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async (hotelId: string, periodStart: Date, periodEnd: Date) => {
    setLoading(true);
    const { data: sensorsData } = await supabase
      .from('haccp_sensors')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('location');
    const sensorsList = (sensorsData || []) as Sensor[];
    setSensors(sensorsList);

    if (sensorsList.length === 0) {
      setReadings([]);
      setAlerts([]);
      setLoading(false);
      return;
    }
    const sensorIds = sensorsList.map(s => s.id);

    // Pour le PDF mensuel on échantillonne raisonnablement : pas tous les relevés
    // (peut être 100k+ lignes / mois). On limite à 5000 relevés par requête, suffisant
    // pour des courbes pertinentes — Supabase impose 1000 par défaut, on monte à 5000.
    // On élargit la requête logs nettoyage : weekly/quarterly peuvent avoir des period_key
    // en dehors du mois courant. On prend tout le trimestre englobant.
    const lookbackStart = new Date(periodStart);
    lookbackStart.setMonth(lookbackStart.getMonth() - 3);

    const [readingsResult, alertsResult, zonesRes, tasksRes, logsRes] = await Promise.all([
      supabase
        .from('haccp_readings')
        .select('sensor_id, temperature, recorded_at')
        .in('sensor_id', sensorIds)
        .gte('recorded_at', periodStart.toISOString())
        .lte('recorded_at', periodEnd.toISOString())
        .order('recorded_at', { ascending: true })
        .limit(50_000),
      supabase
        .from('haccp_alerts')
        .select('*')
        .in('sensor_id', sensorIds)
        .gte('triggered_at', periodStart.toISOString())
        .lte('triggered_at', periodEnd.toISOString())
        .order('triggered_at', { ascending: true }),
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
        .lte('period_key', format(periodEnd, 'yyyy-MM-dd')),
    ]);

    setReadings((readingsResult.data || []) as Reading[]);
    setAlerts((alertsResult.data || []) as Alert[]);
    setCleaningZones((zonesRes.data || []) as CleaningZone[]);
    setCleaningTasks((tasksRes.data || []) as CleaningTask[]);
    setCleaningLogs((logsRes.data || []) as CleaningLog[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!selectedHotelId) return;
    loadData(selectedHotelId, period, endOfMonth(period));
  }, [selectedHotelId, period, loadData]);

  const periodEnd = endOfMonth(period);
  const isCurrentOrFutureMonth = !isAfter(startOfMonth(new Date()), period);
  const selectedHotel = hotels.find(h => h.id === selectedHotelId);

  const stats = useMemo(() => ({
    nbSensors: sensors.filter(s => s.active).length,
    nbReadings: readings.length,
    nbAlerts: alerts.length,
    nbAlertsAck: alerts.filter(a => a.acknowledged_at).length,
  }), [sensors, readings, alerts]);

  if (authLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }
  if (!user) return <div className="p-8">Authentification requise.</div>;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <FileText className="w-6 h-6" /> Registre HACCP mensuel
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Document de synthèse à présenter au contrôle DDPP. Génère un PDF couvrant les températures,
          alertes et actions correctives sur la période sélectionnée.
        </p>
      </header>

      {/* Sélecteurs */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setPeriod(p => subMonths(p, 1))} aria-label="Mois précédent" className="h-11 w-11 p-0">
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="font-medium min-w-[140px] text-center capitalize">
            {format(period, 'MMMM yyyy', { locale: fr })}
          </span>
          <Button
            variant="outline"
            disabled={isCurrentOrFutureMonth}
            onClick={() => setPeriod(p => addMonths(p, 1))}
            aria-label="Mois suivant"
            className="h-11 w-11 p-0"
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Aperçu stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Stat label="Sondes actives" value={stats.nbSensors} />
        <Stat label="Relevés du mois" value={stats.nbReadings.toLocaleString('fr-FR')} />
        <Stat label="Alertes" value={stats.nbAlerts} tone={stats.nbAlerts > 0 ? 'warn' : 'ok'} />
        <Stat label="Acquittées" value={`${stats.nbAlertsAck} / ${stats.nbAlerts}`} />
      </div>

      {/* Bouton télécharger */}
      <Card>
        <CardContent className="py-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Chargement des données…
            </div>
          ) : sensors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune sonde configurée pour cet hôtel. Configure d&apos;abord les sondes pour générer un registre.
            </p>
          ) : readings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun relevé sur cette période. Le PDF peut être généré mais sera vide de données chiffrées.
            </p>
          ) : selectedHotel ? (
            <PDFDownloadLink
              document={
                <RegistrePDF
                  hotel={selectedHotel}
                  sensors={sensors}
                  readings={readings}
                  alerts={alerts}
                  periodStart={period}
                  periodEnd={periodEnd}
                  cleaningZones={cleaningZones}
                  cleaningTasks={cleaningTasks}
                  cleaningLogs={cleaningLogs}
                />
              }
              fileName={`registre-haccp-${slug(selectedHotel.nom)}-${format(period, 'yyyy-MM')}.pdf`}
            >
              {({ loading: pdfLoading }) => (
                <Button disabled={pdfLoading} className="h-11 px-5 text-base">
                  {pdfLoading
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Génération du PDF…</>
                    : <><FileDown className="w-4 h-4 mr-2" /> Télécharger le registre PDF</>}
                </Button>
              )}
            </PDFDownloadLink>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone = 'default' }: {
  label: string;
  value: string | number;
  tone?: 'default' | 'ok' | 'warn';
}) {
  const color = tone === 'warn' ? 'text-amber-700' : tone === 'ok' ? 'text-emerald-700' : 'text-foreground';
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={`text-xl font-semibold mt-1 ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function slug(s: string) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
