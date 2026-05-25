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
// Cache des sondes (rechargé toutes les 5 min)
// ----------------------------------------------------------------------------
// friendlyName → { id, temp_min, temp_max, alert_delay_min }
let sensorsByFriendlyName = new Map()

async function reloadSensors() {
  const { data, error } = await supabase
    .from('haccp_sensors')
    .select('id, friendly_name, temp_min, temp_max, alert_delay_min, active')
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
// Conversion battery_state Tuya → pourcentage
// ----------------------------------------------------------------------------
// Les sondes Tuya ZT01 envoient un enum 'battery_state' (high/medium/low/critical)
// plutôt qu'un % numérique. On mappe vers une valeur indicative pour pouvoir
// l'afficher dans le dashboard live et tracer l'usure des piles dans le temps.
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
  for (const a of data) {
    breachState.set(a.sensor_id, {
      breachStartedAt: new Date(a.triggered_at),
      breachType: a.threshold_type,
      peakValue: a.peak_value,
      openAlertId: a.id
    })
  }
  console.log(`[${new Date().toISOString()}] Restored ${data.length} open alerts`)
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
      // Pas encore d'alerte créée → check le délai
      const durationMin = (Date.now() - state.breachStartedAt.getTime()) / 60_000
      if (durationMin >= sensor.alert_delay_min) {
        const { data, error } = await supabase
          .from('haccp_alerts')
          .insert({
            sensor_id: sensor.id,
            threshold_type: breachType,
            triggered_at: state.breachStartedAt.toISOString(),
            peak_value: state.peakValue
          })
          .select('id')
          .single()
        if (error) {
          console.error(`Alert insert failed for ${sensor.id}:`, error.message)
        } else {
          state.openAlertId = data.id
          console.log(`[${new Date().toISOString()}] ALERT opened ${sensor.id} ${breachType} @ ${state.peakValue}°C`)
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

  // Filtrer les valeurs sentinel Tuya : quand la communication boîtier ↔ sonde inox
  // déportée échoue ponctuellement, le ZT01 renvoie une valeur 16-bit non signée
  // qui donne ±6553.5°C une fois divisée par 10. Tout ce qui sort de [-100, +100]°C
  // est forcément du bruit pour notre usage (frigo / congel hôtellerie).
  if (Math.abs(temperature) > 100) {
    console.warn(`[${new Date().toISOString()}] Junk reading ignored for ${friendlyName}: ${temperature}°C`)
    return
  }

  const humidity = typeof msg.humidity === 'number' ? msg.humidity : null

  // 1) Check seuil + gestion alerte (TOUJOURS, même si on dédup l'insert)
  try {
    await checkThreshold(sensor, temperature)
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
