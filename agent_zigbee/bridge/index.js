// ============================================================================
// HACCP MQTT bridge — tourne sur le mini-PC de chaque hôtel
// ----------------------------------------------------------------------------
// Responsabilités :
//   1) Subscribe au broker Mosquitto local (sortie Zigbee2MQTT)
//   2) INSERT les relevés dans haccp_readings (via Supabase service_role)
//   3) Détecte les dépassements de seuil > alert_delay_min et gère le cycle
//      de vie des alertes (open → update peak → resolve)
// ============================================================================

import mqtt from 'mqtt'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

const MQTT_URL = process.env.MQTT_LOCAL_URL || 'mqtt://mosquitto:1883'
const HOTEL_ID = process.env.HOTEL_ID
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!HOTEL_ID || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing env: HOTEL_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY required')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
})

// ----------------------------------------------------------------------------
// Mailer
// ----------------------------------------------------------------------------
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
})
const ALERT_MAIL_TO = process.env.ALERT_MAIL_TO

async function sendAlertMail(sensor, breachType, peakValue, durationMin, critique = false) {
  if (!ALERT_MAIL_TO || !process.env.SMTP_USER) return
  const dir = breachType === 'high' ? 'au-dessus' : 'en-dessous'
  const seuil = breachType === 'high' ? `+${sensor.temp_max}°C` : `${sensor.temp_min}°C`
  // Un mail « depuis 0 min » n'aurait aucun sens : quand c'est le plafond dur
  // qui a parlé, c'est la température qui est l'information, pas la durée.
  const sujet = critique
    ? `🚨 HACCP — ${sensor.friendly_name} à ${peakValue}°C (seuil critique)`
    : `⚠️ HACCP — ${sensor.friendly_name} hors plage depuis ${Math.round(durationMin)} min`
  await mailer.sendMail({
    from: process.env.SMTP_USER,
    to: ALERT_MAIL_TO,
    subject: sujet,
    text: [
      `Alerte température HACCP`,
      ``,
      `Sonde       : ${sensor.friendly_name} (${sensor.location || ''})`,
      `Dépassement : ${dir} du seuil (${seuil})`,
      `Température : ${peakValue}°C`,
      `Durée       : ${Math.round(durationMin)} min`,
      critique
        ? `Déclenchée  : immédiatement, plafond critique (${sensor.temp_crit_max}°C) franchi`
        : `Déclenchée  : après ${sensor.alert_delay_min} min hors plage`,
      ``,
      `Vérifier l'équipement dès que possible.`
    ].join('\n')
  })
  console.log(`[${new Date().toISOString()}] Mail alerte envoyé → ${ALERT_MAIL_TO} (${sensor.friendly_name} ${breachType})`)
}


// ----------------------------------------------------------------------------
// Tuya ZT01 envoie battery_state (enum) plutôt qu'un % — on mappe.
// ----------------------------------------------------------------------------
function readBattery(msg) {
  if (typeof msg.battery === 'number') return Math.round(msg.battery)
  if (typeof msg.battery_state === 'string') {
    switch (msg.battery_state) {
      case 'high':     return 100
      case 'medium':   return 50
      case 'low':      return 15
      case 'critical': return 5
    }
  }
  return null
}

// ----------------------------------------------------------------------------
// Cache des sondes (rechargé toutes les 5 min)
// ----------------------------------------------------------------------------
// friendlyName → { id, location, temp_min, temp_max, temp_crit_min, temp_crit_max, alert_delay_min }
let sensorsByFriendlyName = new Map()

async function reloadSensors() {
  const { data, error } = await supabase
    .from('haccp_sensors')
    .select('id, friendly_name, location, temp_min, temp_max, temp_crit_min, temp_crit_max, alert_delay_min, active')
    .eq('hotel_id', HOTEL_ID)
    .eq('active', true)

  if (error) {
    console.error('reloadSensors failed:', error.message)
    return
  }
  sensorsByFriendlyName = new Map(
    data.map(s => [s.friendly_name, s])
  )
  console.log(`[${new Date().toISOString()}] Loaded ${data.length} active sensors`)
}

// ----------------------------------------------------------------------------
// Déduplication des relevés en BDD
// ----------------------------------------------------------------------------
// Les Tuya ZT01 envoient des bursts (3-5 datapoints en <300ms) + un report à
// chaque variation. Pour ne pas saturer Supabase, on n'insère que si :
//   - T° a varié d'au moins MIN_TEMP_DELTA °C
//   - OU humidité de MIN_HUMID_DELTA %
//   - OU il s'est écoulé KEEPALIVE_MS depuis le dernier insert (preuve de vie HACCP)
// La détection d'alerte (checkThreshold) reste appelée à CHAQUE message, donc
// la dedup ne dégrade pas la réactivité des alertes.
const MIN_TEMP_DELTA = 0.3
const MIN_HUMID_DELTA = 3
const KEEPALIVE_MS = 10 * 60 * 1000

const lastInsert = new Map() // sensor_id → { temperature, humidity, timestamp }

// ----------------------------------------------------------------------------
// État en mémoire pour la détection d'alertes
// ----------------------------------------------------------------------------
// sensor_id → {
//   breachStartedAt: Date | null,   // début du dépassement actuel
//   breachType: 'high' | 'low' | null,
//   peakValue: number | null,        // T° extrême atteinte
//   openAlertId: string | null       // id de l'alerte non résolue, si créée
// }
const breachState = new Map()

async function loadOpenAlerts() {
  // Au boot, restaurer l'état des alertes non résolues pour éviter les doublons après crash/restart
  const { data, error } = await supabase
    .from('haccp_alerts')
    .select('id, sensor_id, threshold_type, triggered_at, peak_value, haccp_sensors!inner(hotel_id)')
    .eq('haccp_sensors.hotel_id', HOTEL_ID)
    .is('resolved_at', null)

  if (error) {
    console.error('loadOpenAlerts failed:', error.message)
    return
  }
  // `breachState` est indexé par sonde : on ne peut en suivre qu'une par sonde.
  // Historiquement on écrasait sans le dire, et les alertes perdues n'étaient
  // plus jamais ni mises à jour ni résolues — orphelines à vie. On garde la plus
  // ancienne (c'est elle le vrai début de l'épisode) et on signale les autres
  // au lieu de les avaler. L'index partiel `haccp_alerts_une_seule_ouverte`
  // (migration 106) rend normalement ce cas impossible ; ce code reste le filet.
  const parSonde = new Set()
  const triees = [...data].sort(
    (x, y) => new Date(x.triggered_at) - new Date(y.triggered_at)
  )
  let surnumeraires = 0
  for (const a of triees) {
    if (parSonde.has(a.sensor_id)) {
      surnumeraires++
      console.warn(
        `[${new Date().toISOString()}] Alerte surnumeraire ouverte ${a.id} ` +
        `sur ${a.sensor_id} — non suivie, a clore a la main`
      )
      continue
    }
    parSonde.add(a.sensor_id)
    breachState.set(a.sensor_id, {
      breachStartedAt: new Date(a.triggered_at),
      breachType: a.threshold_type,
      peakValue: a.peak_value,
      openAlertId: a.id
    })
  }
  console.log(
    `[${new Date().toISOString()}] Restored ${parSonde.size} open alerts` +
    (surnumeraires ? ` (+${surnumeraires} surnumeraires ignorees)` : '')
  )
}

// ----------------------------------------------------------------------------
// Logique de détection : appelée à chaque nouveau relevé
// ----------------------------------------------------------------------------
async function checkThreshold(sensor, temperature) {
  const state = breachState.get(sensor.id) || {
    breachStartedAt: null,
    breachType: null,
    peakValue: null,
    openAlertId: null
  }

  // Quel type de dépassement (s'il y en a) ?
  let breachType = null
  if (sensor.temp_max !== null && temperature > sensor.temp_max) breachType = 'high'
  else if (sensor.temp_min !== null && temperature < sensor.temp_min) breachType = 'low'

  if (breachType) {
    // --- Dépassement en cours ---
    if (state.breachStartedAt === null || state.breachType !== breachType) {
      // Nouveau dépassement (ou bascule de type haut↔bas)
      state.breachStartedAt = new Date()
      state.breachType = breachType
      state.peakValue = temperature
      state.openAlertId = null
    } else {
      // Continuation : update peak si pire que précédent
      if (breachType === 'high' && temperature > state.peakValue) state.peakValue = temperature
      if (breachType === 'low'  && temperature < state.peakValue) state.peakValue = temperature
    }

    if (!state.openAlertId) {
      // Deux étages, et le second n'attend pas.
      //
      // Frigo Gauche dégivre automatiquement quatre fois par jour : il monte à
      // 7-9 °C pendant ~35 min puis redescend en 12 min. Sur 21 jours c'est
      // 106 dépassements dont la médiane dure 13 min — un délai de 30 min les
      // laissait tous passer et noyait le registre de fausses dérives, ce qui
      // dilue les vraies. Mais un délai plus long, seul, rendrait sourd à un
      // accident franc : un frigo à 10 °C n'a pas besoin de 45 minutes pour
      // être un problème. D'où le plafond dur, qui court-circuite le délai.
      const durationMin = (Date.now() - state.breachStartedAt.getTime()) / 60_000
      const critique =
        (breachType === 'high' && sensor.temp_crit_max !== null && temperature >= sensor.temp_crit_max) ||
        (breachType === 'low'  && sensor.temp_crit_min !== null && temperature <= sensor.temp_crit_min)
      if (critique || durationMin >= sensor.alert_delay_min) {
        const raison = critique ? 'seuil_critique' : 'delai'
        const { data, error } = await supabase
          .from('haccp_alerts')
          .insert({
            sensor_id: sensor.id,
            threshold_type: breachType,
            triggered_at: state.breachStartedAt.toISOString(),
            peak_value: state.peakValue,
            trigger_reason: raison
          })
          .select('id')
          .single()
        if (error && error.code === '23505') {
          // Un index unique a parlé. Deux cas, et il faut les distinguer :
          // soit une alerte est déjà OUVERTE sur cette sonde (index partiel de
          // la 106) et on l'adopte — une alerte que plus personne ne pointe ne
          // serait jamais résolue ; soit c'est l'épisode lui-même qui existe
          // déjà, résolu (index (sensor_id, triggered_at) de la 107), et il
          // n'y a rien à rouvrir : on décale d'une milliseconde le début pour
          // ne pas retenter le même insert à chaque relevé, indéfiniment.
          const { data: existante } = await supabase
            .from('haccp_alerts')
            .select('id, triggered_at, peak_value')
            .eq('sensor_id', sensor.id)
            .is('resolved_at', null)
            .maybeSingle()
          if (existante) {
            state.openAlertId = existante.id
            state.breachStartedAt = new Date(existante.triggered_at)
            console.log(
              `[${new Date().toISOString()}] ALERT adopted ${existante.id} ` +
              `for ${sensor.id} (doublon evite)`
            )
          } else {
            state.breachStartedAt = new Date(state.breachStartedAt.getTime() + 1)
            console.warn(
              `[${new Date().toISOString()}] Alert insert conflict for ${sensor.id} ` +
              `sans alerte ouverte — episode deja enregistre, debut decale d'1 ms`
            )
          }
        } else if (error) {
          console.error(`Alert insert failed for ${sensor.id}:`, error.message)
        } else {
          state.openAlertId = data.id
          console.log(
            `[${new Date().toISOString()}] ALERT opened ${sensor.id} ${breachType} ` +
            `@ ${state.peakValue}°C (${raison})`
          )
          sendAlertMail(sensor, breachType, state.peakValue, durationMin, critique).catch(e =>
            console.error(`sendAlertMail failed for ${sensor.id}:`, e.message)
          )
        }
      }
    } else {
      // Alerte ouverte → update peak_value si pire
      await supabase
        .from('haccp_alerts')
        .update({ peak_value: state.peakValue })
        .eq('id', state.openAlertId)
    }
  } else {
    // --- T° revenue sous seuil ---
    if (state.openAlertId) {
      const { error } = await supabase
        .from('haccp_alerts')
        .update({ resolved_at: new Date().toISOString() })
        .eq('id', state.openAlertId)
      if (error) {
        console.error(`Alert resolve failed for ${state.openAlertId}:`, error.message)
      } else {
        console.log(`[${new Date().toISOString()}] ALERT resolved ${sensor.id}`)
      }
    }
    state.breachStartedAt = null
    state.breachType = null
    state.peakValue = null
    state.openAlertId = null
  }

  breachState.set(sensor.id, state)
}

// ----------------------------------------------------------------------------
// Sérialisation par sonde
// ----------------------------------------------------------------------------
// MQTT.js n'attend pas le handler `message`, et les Tuya ZT01 émettent par
// bursts de 3-5 datapoints en <300 ms (cf. la dédup plus haut). Deux messages
// du même burst traversaient donc `checkThreshold` en parallèle : tous deux
// voyaient `openAlertId === null` de part et d'autre de l'`await` de l'insert,
// et créaient chacun leur alerte. D'où des doublons au `triggered_at` identique
// à la milliseconde, que `loadOpenAlerts` transformait ensuite en orphelines.
//
// Une file par sonde suffit : les sondes sont indépendantes, rien ne justifie
// de sérialiser globalement.
const filesParSonde = new Map()

function checkThresholdSerialise(sensor, temperature) {
  const precedent = filesParSonde.get(sensor.id) || Promise.resolve()
  // `.catch` avant l'enchaînement : une erreur ne doit pas figer la file de
  // cette sonde pour toujours. Elle est journalisée par l'appelant.
  const suivant = precedent
    .catch(() => {})
    .then(() => checkThreshold(sensor, temperature))
  filesParSonde.set(sensor.id, suivant)
  return suivant
}

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------
await reloadSensors()
await loadOpenAlerts()
setInterval(reloadSensors, 5 * 60 * 1000)

// ----------------------------------------------------------------------------
// MQTT
// ----------------------------------------------------------------------------
const client = mqtt.connect(MQTT_URL, { reconnectPeriod: 5000 })

client.on('connect', () => {
  console.log(`Connected to ${MQTT_URL}`)
  client.subscribe('zigbee2mqtt/+', err => {
    if (err) console.error('Subscribe failed:', err.message)
    else console.log('Subscribed to zigbee2mqtt/+')
  })
})

client.on('message', async (topic, payload) => {
  const parts = topic.split('/')
  if (parts.length !== 2 || parts[1].startsWith('bridge')) return

  const friendlyName = parts[1]
  const sensor = sensorsByFriendlyName.get(friendlyName)
  if (!sensor) return  // sonde inconnue/inactive, silencieux

  let msg
  try {
    msg = JSON.parse(payload.toString())
  } catch {
    return
  }

  // Sondes Tuya ZT01 exposent deux mesures :
  //   - msg.temperature       = boîtier électronique (ambiant)
  //   - msg.temperature_probe = sonde inox déportée (= la mesure HACCP du frigo)
  // On privilégie la sonde déportée si dispo, sinon fallback sur le boîtier.
  const temperature = typeof msg.temperature_probe === 'number'
    ? msg.temperature_probe
    : (typeof msg.temperature === 'number' ? msg.temperature : null)

  if (temperature === null) return
  // Overflow Tuya au passage 0°C : valeurs physiquement impossibles pour des frigos/congélos
  if (temperature < -100 || temperature > 100) {
    console.log(`[${new Date().toISOString()}] ${friendlyName}: température aberrante ignorée (${temperature}°C)`)
    return
  }

  const humidity = typeof msg.humidity === 'number' ? msg.humidity : null

  // 1) Check seuil + gestion alerte (TOUJOURS, même si on dédup l'insert)
  try {
    await checkThresholdSerialise(sensor, temperature)
  } catch (e) {
    console.error(`checkThreshold failed for ${friendlyName}:`, e.message)
  }

  // 2) Dedup avant insert
  const last = lastInsert.get(sensor.id)
  const now = Date.now()
  const tempChanged   = !last || Math.abs(last.temperature - temperature) >= MIN_TEMP_DELTA
  const humidChanged  = !last || Math.abs((last.humidity ?? 0) - (humidity ?? 0)) >= MIN_HUMID_DELTA
  const tooOld        = !last || (now - last.timestamp) > KEEPALIVE_MS
  if (!tempChanged && !humidChanged && !tooOld) return  // skip insert

  // 3) Insert reading
  const { error: insertError } = await supabase.from('haccp_readings').insert({
    sensor_id: sensor.id,
    temperature,
    humidity,
    battery: readBattery(msg),
    rssi: typeof msg.linkquality === 'number' ? msg.linkquality : null
  })
  if (insertError) {
    console.error(`Insert failed for ${friendlyName}:`, insertError.message)
    return
  }

  lastInsert.set(sensor.id, { temperature, humidity, timestamp: now })
})

client.on('error', err => console.error('MQTT error:', err.message))

process.on('SIGTERM', () => { client.end(); process.exit(0) })
process.on('SIGINT',  () => { client.end(); process.exit(0) })
