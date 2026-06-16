import {
  Document, Page, Text, View, StyleSheet,
  Svg, Polyline, Line,
} from '@react-pdf/renderer';
import {
  format, eachDayOfInterval, differenceInMinutes, isAfter, startOfQuarter,
  startOfWeek, addWeeks, endOfMonth, addMonths,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Sensor, Reading, Alert, Hotel } from './types';
import type {
  CleaningZone, CleaningTask, CleaningLog, CleaningFrequency,
} from '../admin/nettoyage/types';

// ============================================================================
// Palette
// ============================================================================
const TEAL      = '#0f766e';
const TEAL_MID  = '#0d9488';
const SLATE_900 = '#0f172a';
const SLATE_700 = '#334155';
const SLATE_500 = '#64748b';
const SLATE_400 = '#94a3b8';
const SLATE_200 = '#e2e8f0';
const SLATE_100 = '#f1f5f9';
const SLATE_50  = '#f8fafc';
const RED       = '#dc2626';
const AMBER     = '#d97706';
const EMERALD   = '#059669';

// ============================================================================
// Styles
// ============================================================================
const s = StyleSheet.create({
  page: {
    paddingHorizontal: 32,
    paddingTop: 28,
    paddingBottom: 36,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: SLATE_700,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: SLATE_200,
  },
  headerLeft: { flex: 1 },
  headerTitle: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: TEAL, letterSpacing: 1 },
  headerSub: { fontSize: 8, color: SLATE_400, marginTop: 3 },
  headerRight: { alignItems: 'flex-end' },
  hotelName: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: SLATE_900 },
  hotelMeta: { fontSize: 7.5, color: SLATE_500, marginTop: 2 },

  sectionTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: TEAL,
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: SLATE_200,
  },

  synth: {
    flexDirection: 'row',
    backgroundColor: SLATE_50,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: SLATE_200,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  synthCol: { flex: 1 },
  synthLabel: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    color: SLATE_500,
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  synthValue: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: SLATE_900 },
  synthSub: { fontSize: 7, color: SLATE_500, marginTop: 1 },

  // Cards sondes (page de synthèse)
  sensorListRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: SLATE_100,
    alignItems: 'center',
  },
  sensorListHeader: {
    backgroundColor: TEAL,
    paddingVertical: 6,
    paddingHorizontal: 8,
    flexDirection: 'row',
    borderRadius: 3,
    marginBottom: 1,
  },
  th: { color: '#fff', fontSize: 7, fontFamily: 'Helvetica-Bold', letterSpacing: 0.4 },
  td: { fontSize: 8 },

  col_location: { width: '32%' },
  col_type:     { width: '15%' },
  col_seuils:   { width: '15%' },
  col_minmax:   { width: '18%' },
  col_avg:      { width: '10%' },
  col_alerts:   { width: '10%' },

  badgeOk:    { backgroundColor: '#d1fae5', color: EMERALD, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2, fontSize: 7, fontFamily: 'Helvetica-Bold' },
  badgeWarn:  { backgroundColor: '#fef3c7', color: AMBER,   paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2, fontSize: 7, fontFamily: 'Helvetica-Bold' },
  badgeAlert: { backgroundColor: '#fee2e2', color: RED,     paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2, fontSize: 7, fontFamily: 'Helvetica-Bold' },

  // Page détail sonde
  sensorPageTitle: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: SLATE_900, marginBottom: 4 },
  sensorPageMeta:  { fontSize: 8, color: SLATE_500, marginBottom: 14 },
  graphLegend:     { fontSize: 7, color: SLATE_500, marginTop: 4 },

  // Tableau alertes
  alertHeader: {
    flexDirection: 'row',
    backgroundColor: SLATE_100,
    paddingVertical: 5,
    paddingHorizontal: 6,
    marginTop: 10,
    borderRadius: 2,
  },
  alertRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: SLATE_100,
  },
  alertCol_date:   { width: '18%' },
  alertCol_type:   { width: '12%' },
  alertCol_peak:   { width: '13%' },
  alertCol_dur:    { width: '12%' },
  alertCol_action: { width: '45%' },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 32,
    right: 32,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: SLATE_400,
    borderTopWidth: 0.5,
    borderTopColor: SLATE_200,
    paddingTop: 6,
  },

  // Signature
  sigBlock: {
    marginTop: 24,
    flexDirection: 'row',
    gap: 16,
  },
  sigBox: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: SLATE_300_OR_LIGHT(),
    borderRadius: 3,
    padding: 10,
    minHeight: 64,
  },
  sigLabel: { fontSize: 7, color: SLATE_500, marginBottom: 2 },
});

function SLATE_300_OR_LIGHT() { return '#cbd5e1'; }

// ============================================================================
// Helpers de calcul
// ============================================================================
function statsForSensor(readings: Reading[]) {
  if (readings.length === 0) return null;
  const temps = readings.map(r => r.temperature);
  return {
    min: Math.min(...temps),
    max: Math.max(...temps),
    avg: temps.reduce((a, b) => a + b, 0) / temps.length,
    count: temps.length,
  };
}

function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = arr.length / maxPoints;
  const out: T[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

function formatDuration(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

// ============================================================================
// Composant principal
// ============================================================================
export function RegistrePDF({
  hotel, sensors, readings, alerts, periodStart, periodEnd,
  cleaningZones = [], cleaningTasks = [], cleaningLogs = [],
}: {
  hotel: Hotel;
  sensors: Sensor[];
  readings: Reading[];
  alerts: Alert[];
  periodStart: Date;
  periodEnd: Date;
  cleaningZones?: CleaningZone[];
  cleaningTasks?: CleaningTask[];
  cleaningLogs?: CleaningLog[];
}) {
  const generatedAt = new Date();

  // Grouper readings par sonde
  const readingsBySensor = new Map<string, Reading[]>();
  for (const r of readings) {
    (readingsBySensor.get(r.sensor_id) || readingsBySensor.set(r.sensor_id, []).get(r.sensor_id)!).push(r);
  }
  const alertsBySensor = new Map<string, Alert[]>();
  for (const a of alerts) {
    (alertsBySensor.get(a.sensor_id) || alertsBySensor.set(a.sensor_id, []).get(a.sensor_id)!).push(a);
  }

  const activeSensors = sensors.filter(s => s.active);
  const totalReadings = readings.length;
  const totalAlerts = alerts.length;
  const ackAlerts = alerts.filter(a => a.acknowledged_at).length;

  return (
    <Document
      title={`Registre HACCP ${hotel.nom} - ${format(periodStart, 'MMMM yyyy', { locale: fr })}`}
      author={hotel.nom}
    >
      {/* ================================================================ */}
      {/* Page de garde + synthèse                                          */}
      {/* ================================================================ */}
      <Page size="A4" style={s.page}>
        <PageHeader hotel={hotel} periodStart={periodStart} periodEnd={periodEnd} generatedAt={generatedAt} />

        <Text style={s.sectionTitle}>SYNTHÈSE DU MOIS</Text>
        <View style={s.synth}>
          <View style={s.synthCol}>
            <Text style={s.synthLabel}>SONDES ACTIVES</Text>
            <Text style={s.synthValue}>{activeSensors.length}</Text>
          </View>
          <View style={s.synthCol}>
            <Text style={s.synthLabel}>RELEVÉS</Text>
            <Text style={s.synthValue}>{totalReadings.toLocaleString('fr-FR')}</Text>
          </View>
          <View style={s.synthCol}>
            <Text style={s.synthLabel}>ALERTES</Text>
            <Text style={[s.synthValue, ...(totalAlerts > 0 ? [{ color: AMBER }] : [])]}>{totalAlerts}</Text>
          </View>
          <View style={s.synthCol}>
            <Text style={s.synthLabel}>ACQUITTÉES</Text>
            <Text style={s.synthValue}>{ackAlerts} / {totalAlerts}</Text>
          </View>
        </View>

        <Text style={s.sectionTitle}>SONDES SOUS SURVEILLANCE</Text>
        <View style={s.sensorListHeader}>
          <Text style={[s.th, s.col_location]}>EMPLACEMENT</Text>
          <Text style={[s.th, s.col_type]}>TYPE</Text>
          <Text style={[s.th, s.col_seuils]}>SEUILS</Text>
          <Text style={[s.th, s.col_minmax]}>MIN / MAX</Text>
          <Text style={[s.th, s.col_avg]}>MOY.</Text>
          <Text style={[s.th, s.col_alerts]}>ALERTES</Text>
        </View>
        {activeSensors.map(sensor => {
          const sr = readingsBySensor.get(sensor.id) || [];
          const sa = alertsBySensor.get(sensor.id) || [];
          const st = statsForSensor(sr);
          return (
            <View key={sensor.id} style={s.sensorListRow}>
              <Text style={[s.td, s.col_location]}>{sensor.location}</Text>
              <Text style={[s.td, s.col_type]}>
                {sensor.sensor_type === 'negatif' ? 'Congélateur' : sensor.sensor_type === 'positif' ? 'Frigo' : 'Ambiant'}
              </Text>
              <Text style={[s.td, s.col_seuils]}>
                {sensor.temp_min !== null ? `${sensor.temp_min}°` : '—'} / {sensor.temp_max !== null ? `${sensor.temp_max}°` : '—'}
              </Text>
              <Text style={[s.td, s.col_minmax]}>
                {st ? `${st.min.toFixed(1)}° / ${st.max.toFixed(1)}°` : '—'}
              </Text>
              <Text style={[s.td, s.col_avg]}>
                {st ? `${st.avg.toFixed(1)}°` : '—'}
              </Text>
              <View style={s.col_alerts}>
                <Text style={sa.length === 0 ? s.badgeOk : s.badgeAlert}>
                  {sa.length === 0 ? 'OK' : `${sa.length}`}
                </Text>
              </View>
            </View>
          );
        })}

        <Text style={[s.sectionTitle, { marginTop: 24 }]}>VALIDATION</Text>
        <View style={s.sigBlock}>
          <View style={s.sigBox}>
            <Text style={s.sigLabel}>RESPONSABLE HACCP</Text>
            <Text style={{ fontSize: 8, marginTop: 30, color: SLATE_400 }}>Nom + signature</Text>
          </View>
          <View style={s.sigBox}>
            <Text style={s.sigLabel}>DATE</Text>
            <Text style={{ fontSize: 8, marginTop: 30, color: SLATE_400 }}>__/__/____</Text>
          </View>
        </View>

        <Footer />
      </Page>

      {/* ================================================================ */}
      {/* Page Plan de nettoyage (si configuré)                             */}
      {/* ================================================================ */}
      {cleaningZones.filter(z => z.active).length > 0 && cleaningTasks.filter(t => t.active).length > 0 && (
        <CleaningPage
          hotel={hotel}
          zones={cleaningZones}
          tasks={cleaningTasks}
          logs={cleaningLogs}
          periodStart={periodStart}
          periodEnd={periodEnd}
          generatedAt={generatedAt}
        />
      )}

      {/* ================================================================ */}
      {/* Une page par sonde : stats + graphe + alertes                     */}
      {/* ================================================================ */}
      {activeSensors.map(sensor => {
        const sr = readingsBySensor.get(sensor.id) || [];
        const sa = alertsBySensor.get(sensor.id) || [];
        const st = statsForSensor(sr);
        return (
          <Page key={sensor.id} size="A4" style={s.page}>
            <PageHeader hotel={hotel} periodStart={periodStart} periodEnd={periodEnd} generatedAt={generatedAt} compact />

            <Text style={s.sensorPageTitle}>{sensor.location}</Text>
            <Text style={s.sensorPageMeta}>
              {sensor.sensor_type === 'negatif' ? 'Congélateur' : sensor.sensor_type === 'positif' ? 'Frigo' : 'Ambiant'}
              {'  •  '}
              Seuils {sensor.temp_min !== null ? `min ${sensor.temp_min}°C` : 'pas de min'},{' '}
              {sensor.temp_max !== null ? `max ${sensor.temp_max}°C` : 'pas de max'}
              {'  •  '}
              Délai alerte : {sensor.alert_delay_min} min
            </Text>

            {/* Stats du mois */}
            {st ? (
              <View style={s.synth}>
                <View style={s.synthCol}>
                  <Text style={s.synthLabel}>RELEVÉS</Text>
                  <Text style={s.synthValue}>{st.count.toLocaleString('fr-FR')}</Text>
                </View>
                <View style={s.synthCol}>
                  <Text style={s.synthLabel}>MIN</Text>
                  <Text style={s.synthValue}>{st.min.toFixed(1)}°</Text>
                </View>
                <View style={s.synthCol}>
                  <Text style={s.synthLabel}>MAX</Text>
                  <Text style={s.synthValue}>{st.max.toFixed(1)}°</Text>
                </View>
                <View style={s.synthCol}>
                  <Text style={s.synthLabel}>MOYENNE</Text>
                  <Text style={s.synthValue}>{st.avg.toFixed(1)}°</Text>
                </View>
                <View style={s.synthCol}>
                  <Text style={s.synthLabel}>ALERTES</Text>
                  <Text style={[s.synthValue, ...(sa.length > 0 ? [{ color: AMBER }] : [])]}>{sa.length}</Text>
                </View>
              </View>
            ) : (
              <Text style={{ fontSize: 9, color: SLATE_500, marginVertical: 14 }}>
                Aucun relevé sur la période.
              </Text>
            )}

            {/* Graphe */}
            {sr.length > 1 && (
              <>
                <Text style={s.sectionTitle}>ÉVOLUTION SUR LA PÉRIODE</Text>
                <TemperatureChart
                  readings={downsample(sr, 800)}
                  tempMin={sensor.temp_min}
                  tempMax={sensor.temp_max}
                  periodStart={periodStart}
                  periodEnd={periodEnd}
                />
                <Text style={s.graphLegend}>
                  Les lignes pointillées rouges indiquent les seuils. La courbe représente la température
                  mesurée. Pour le confort de lecture, les relevés sont ré-échantillonnés (max 800 points).
                </Text>
              </>
            )}

            {/* Alertes */}
            <Text style={[s.sectionTitle, { marginTop: 14 }]}>
              ALERTES DU MOIS ({sa.length})
            </Text>
            {sa.length === 0 ? (
              <Text style={{ fontSize: 9, color: EMERALD, marginTop: 2 }}>
                Aucune alerte enregistrée sur cette période. Sonde conforme aux seuils définis.
              </Text>
            ) : (
              <>
                <View style={s.alertHeader}>
                  <Text style={[s.th, s.alertCol_date, { color: SLATE_700 }]}>DATE / HEURE</Text>
                  <Text style={[s.th, s.alertCol_type, { color: SLATE_700 }]}>TYPE</Text>
                  <Text style={[s.th, s.alertCol_peak, { color: SLATE_700 }]}>PEAK</Text>
                  <Text style={[s.th, s.alertCol_dur, { color: SLATE_700 }]}>DURÉE</Text>
                  <Text style={[s.th, s.alertCol_action, { color: SLATE_700 }]}>ACTION CORRECTIVE</Text>
                </View>
                {sa.map(a => {
                  const dur = a.resolved_at
                    ? differenceInMinutes(new Date(a.resolved_at), new Date(a.triggered_at))
                    : null;
                  return (
                    <View key={a.id} style={s.alertRow}>
                      <Text style={[s.td, s.alertCol_date]}>
                        {format(new Date(a.triggered_at), 'dd/MM HH:mm', { locale: fr })}
                      </Text>
                      <Text style={[s.td, s.alertCol_type]}>
                        {a.threshold_type === 'high' ? 'Haut' : 'Bas'}
                      </Text>
                      <Text style={[s.td, s.alertCol_peak, { fontFamily: 'Helvetica-Bold', color: RED }]}>
                        {a.peak_value.toFixed(1)}°
                      </Text>
                      <Text style={[s.td, s.alertCol_dur]}>
                        {dur !== null ? formatDuration(dur) : 'en cours'}
                      </Text>
                      <Text style={[s.td, s.alertCol_action]}>
                        {a.action_taken || (a.acknowledged_at ? '(acquittée, sans détail)' : 'non acquittée')}
                      </Text>
                    </View>
                  );
                })}
              </>
            )}

            <Footer />
          </Page>
        );
      })}
    </Document>
  );
}

// ============================================================================
// Sous-composants
// ============================================================================
function PageHeader({
  hotel, periodStart, periodEnd, generatedAt, compact,
}: {
  hotel: Hotel;
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
  compact?: boolean;
}) {
  return (
    <View style={[s.header, ...(compact ? [{ marginBottom: 10, paddingBottom: 6 }] : [])]}>
      <View style={s.headerLeft}>
        <Text style={s.headerTitle}>
          {compact ? 'REGISTRE HACCP' : 'REGISTRE HACCP — TEMPÉRATURES'}
        </Text>
        <Text style={s.headerSub}>
          Période : {format(periodStart, 'd MMM yyyy', { locale: fr })} — {format(periodEnd, 'd MMM yyyy', { locale: fr })}
          {' • '}Généré le {format(generatedAt, 'd MMM yyyy à HH:mm', { locale: fr })}
        </Text>
      </View>
      <View style={s.headerRight}>
        <Text style={s.hotelName}>{hotel.nom}</Text>
      </View>
    </View>
  );
}

function Footer() {
  return (
    <View style={s.footer} fixed>
      <Text>Document généré automatiquement — siteconsignes / HACCP</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

// ----------------------------------------------------------------------------
// Graphe SVG : courbe T° + bandes de seuil + axe temporel
// ----------------------------------------------------------------------------
function TemperatureChart({
  readings, tempMin, tempMax, periodStart, periodEnd,
}: {
  readings: Reading[];
  tempMin: number | null;
  tempMax: number | null;
  periodStart: Date;
  periodEnd: Date;
}) {
  if (readings.length < 2) return null;

  const W = 530;
  const H = 170;
  const PADX = 30;
  const PADY = 14;

  // Plage temporelle = période sélectionnée (pas premier/dernier relevé) pour respecter le contexte mensuel
  const t0 = periodStart.getTime();
  const t1 = periodEnd.getTime();

  const temps = readings.map(r => r.temperature);
  const allValues = [
    ...temps,
    ...(tempMin !== null ? [tempMin] : []),
    ...(tempMax !== null ? [tempMax] : []),
  ];
  const yMin = Math.min(...allValues) - 1;
  const yMax = Math.max(...allValues) + 1;

  const xOf = (t: number) => PADX + ((t - t0) / (t1 - t0)) * (W - 2 * PADX);
  const yOf = (v: number) => PADY + (1 - (v - yMin) / (yMax - yMin)) * (H - 2 * PADY);

  const points = readings
    .map(r => `${xOf(new Date(r.recorded_at).getTime()).toFixed(1)},${yOf(r.temperature).toFixed(1)}`)
    .join(' ');

  const days = eachDayOfInterval({ start: periodStart, end: periodEnd });
  const tickEvery = Math.ceil(days.length / 8); // ~ 8 ticks max

  return (
    <Svg width={W} height={H}>
      {/* Cadre */}
      <Line x1={PADX} y1={PADY} x2={PADX} y2={H - PADY} stroke={SLATE_400} strokeWidth={0.5} />
      <Line x1={PADX} y1={H - PADY} x2={W - PADX} y2={H - PADY} stroke={SLATE_400} strokeWidth={0.5} />

      {/* Bandes seuils */}
      {tempMax !== null && (
        <Line
          x1={PADX} y1={yOf(tempMax)} x2={W - PADX} y2={yOf(tempMax)}
          stroke={RED} strokeWidth={0.8} strokeDasharray="3 3"
        />
      )}
      {tempMin !== null && (
        <Line
          x1={PADX} y1={yOf(tempMin)} x2={W - PADX} y2={yOf(tempMin)}
          stroke={RED} strokeWidth={0.8} strokeDasharray="3 3"
        />
      )}

      {/* Grilles jours */}
      {days.map((d, i) =>
        i % tickEvery === 0 ? (
          <Line
            key={d.toISOString()}
            x1={xOf(d.getTime())} y1={PADY}
            x2={xOf(d.getTime())} y2={H - PADY}
            stroke={SLATE_100} strokeWidth={0.4}
          />
        ) : null
      )}

      {/* Courbe T° */}
      <Polyline points={points} fill="none" stroke={TEAL} strokeWidth={0.7} />

      {/* Labels axe X (jours) */}
      {days.map((d, i) =>
        i % tickEvery === 0 ? (
          <Text
            key={`lab-${d.toISOString()}`}
            x={xOf(d.getTime())}
            y={H - PADY + 9}
            style={{ fontSize: 6, color: SLATE_400 }}
          >
            {format(d, 'd MMM', { locale: fr })}
          </Text>
        ) : null
      )}
    </Svg>
  );
}

// ============================================================================
// Page Plan de nettoyage
// ============================================================================
const FREQ_PDF_LABEL: Record<CleaningFrequency, string> = {
  daily: 'Quotidien',
  weekly: 'Hebdo',
  monthly: 'Mensuel',
  quarterly: 'Trimestriel',
};

function windowsForPDF(freq: CleaningFrequency, periodStart: Date, periodEnd: Date): { key: string; start: Date; end: Date }[] {
  if (freq === 'daily') {
    return eachDayOfInterval({ start: periodStart, end: periodEnd })
      .map(d => ({ key: format(d, 'yyyy-MM-dd'), start: d, end: d }));
  }
  if (freq === 'weekly') {
    const out: { key: string; start: Date; end: Date }[] = [];
    let cur = startOfWeek(periodStart, { weekStartsOn: 1 });
    while (cur <= periodEnd) {
      const weekEnd = new Date(cur);
      weekEnd.setDate(cur.getDate() + 6);
      if (weekEnd >= periodStart) {
        out.push({ key: format(cur, 'yyyy-MM-dd'), start: new Date(cur), end: weekEnd });
      }
      cur = addWeeks(cur, 1);
    }
    return out;
  }
  if (freq === 'monthly') {
    return [{ key: format(periodStart, 'yyyy-MM-dd'), start: periodStart, end: periodEnd }];
  }
  // quarterly
  const qStart = startOfQuarter(periodStart);
  return [{ key: format(qStart, 'yyyy-MM-dd'), start: qStart, end: endOfMonth(addMonths(qStart, 2)) }];
}

function CleaningPage({
  hotel, zones, tasks, logs, periodStart, periodEnd, generatedAt,
}: {
  hotel: Hotel;
  zones: CleaningZone[];
  tasks: CleaningTask[];
  logs: CleaningLog[];
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
}) {
  const today = new Date();
  const logByKey = new Map<string, CleaningLog>();
  for (const l of logs) logByKey.set(`${l.task_id}|${l.period_key}`, l);

  // Calcul par tâche : fenêtres dues / faites sur la période
  const activeTasks = tasks.filter(t => t.active);
  const activeZones = zones.filter(z => z.active);

  type TaskStat = {
    task: CleaningTask;
    due: number;
    done: number;
    pct: number;
  };
  const statByTask = new Map<string, TaskStat>();
  for (const t of activeTasks) {
    let due = 0, done = 0;
    for (const w of windowsForPDF(t.frequency, periodStart, periodEnd)) {
      if (isAfter(w.start, today)) continue;
      due++;
      if (logByKey.has(`${t.id}|${w.key}`)) done++;
    }
    statByTask.set(t.id, {
      task: t,
      due,
      done,
      pct: due > 0 ? Math.round((done / due) * 100) : 100,
    });
  }

  // Synthèse globale
  let totalDue = 0, totalDone = 0;
  for (const st of statByTask.values()) { totalDue += st.due; totalDone += st.done; }
  const totalPct = totalDue > 0 ? Math.round((totalDone / totalDue) * 100) : 100;

  const tasksByZone = new Map<string, CleaningTask[]>();
  for (const t of activeTasks) {
    const list = tasksByZone.get(t.zone_id) || [];
    list.push(t);
    tasksByZone.set(t.zone_id, list);
  }

  return (
    <Page size="A4" style={s.page}>
      <PageHeader hotel={hotel} periodStart={periodStart} periodEnd={periodEnd} generatedAt={generatedAt} />

      <Text style={s.sectionTitle}>PLAN DE NETTOYAGE — SYNTHÈSE DU MOIS</Text>
      <View style={s.synth}>
        <View style={s.synthCol}>
          <Text style={s.synthLabel}>ZONES</Text>
          <Text style={s.synthValue}>{activeZones.length}</Text>
        </View>
        <View style={s.synthCol}>
          <Text style={s.synthLabel}>TÂCHES</Text>
          <Text style={s.synthValue}>{activeTasks.length}</Text>
        </View>
        <View style={s.synthCol}>
          <Text style={s.synthLabel}>VALIDATIONS DUES</Text>
          <Text style={s.synthValue}>{totalDue}</Text>
        </View>
        <View style={s.synthCol}>
          <Text style={s.synthLabel}>FAITES</Text>
          <Text style={s.synthValue}>{totalDone}</Text>
        </View>
        <View style={s.synthCol}>
          <Text style={s.synthLabel}>COMPLÉTION</Text>
          <Text style={[
            s.synthValue,
            ...(totalPct >= 90 ? [{ color: EMERALD }] : totalPct >= 70 ? [{ color: AMBER }] : [{ color: RED }]),
          ]}>
            {totalPct}%
          </Text>
        </View>
      </View>

      <Text style={s.sectionTitle}>DÉTAIL PAR ZONE</Text>

      {/* Tableau header */}
      <View style={s.sensorListHeader}>
        <Text style={[s.th, { width: '45%' }]}>TÂCHE</Text>
        <Text style={[s.th, { width: '17%' }]}>FRÉQUENCE</Text>
        <Text style={[s.th, { width: '20%' }]}>PRODUIT</Text>
        <Text style={[s.th, { width: '8%', textAlign: 'right' }]}>FAITES</Text>
        <Text style={[s.th, { width: '10%', textAlign: 'right' }]}>%</Text>
      </View>

      {activeZones
        .filter(z => tasksByZone.has(z.id))
        .map(zone => {
          const zoneTasks = tasksByZone.get(zone.id) || [];
          return (
            <View key={zone.id} wrap={false} style={{ marginTop: 6 }}>
              <View style={{
                backgroundColor: SLATE_50,
                paddingVertical: 4,
                paddingHorizontal: 8,
                flexDirection: 'row',
                alignItems: 'center',
                borderLeftWidth: 2,
                borderLeftColor: TEAL,
              }}>
                <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: SLATE_900 }}>
                  {zone.icon ? `${zone.icon}  ` : ''}{zone.name}
                </Text>
                <Text style={{ fontSize: 7, color: SLATE_500, marginLeft: 8 }}>
                  ({zoneTasks.length} tâche{zoneTasks.length > 1 ? 's' : ''})
                </Text>
              </View>
              {zoneTasks.map(task => {
                const st = statByTask.get(task.id)!;
                const pctColor = st.pct >= 90 ? EMERALD : st.pct >= 70 ? AMBER : RED;
                return (
                  <View key={task.id} style={s.sensorListRow}>
                    <Text style={[s.td, { width: '45%' }]}>{task.name}</Text>
                    <Text style={[s.td, { width: '17%' }]}>{FREQ_PDF_LABEL[task.frequency]}</Text>
                    <Text style={[s.td, { width: '20%', color: SLATE_500 }]}>{task.product || '—'}</Text>
                    <Text style={[s.td, { width: '8%', textAlign: 'right' }]}>{st.done} / {st.due}</Text>
                    <Text style={[s.td, { width: '10%', textAlign: 'right', fontFamily: 'Helvetica-Bold', color: pctColor }]}>
                      {st.pct}%
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        })}

      <Text style={{ fontSize: 7, color: SLATE_400, marginTop: 12, fontStyle: 'italic' }}>
        Le % de complétion compare les validations enregistrées aux fenêtres dues à ce jour
        (fenêtres futures exclues). Une fenêtre = un jour pour les tâches quotidiennes,
        une semaine ISO pour les hebdomadaires, un mois pour les mensuelles, un trimestre pour les trimestrielles.
      </Text>

      <Footer />
    </Page>
  );
}
