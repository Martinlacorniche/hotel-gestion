# Guide intégration React — Dashboard Chromecast

## Contexte
Le serveur Flask tourne sur `http://192.168.0.60:5000`.
**Le dashboard doit être utilisé depuis le réseau de l'hôtel** (corniche-adm ou BWplus).
Le React est hébergé sur Netlify (`consigneshtbm.com`) mais les appels API viennent du navigateur → pas besoin de proxy.

---

## Auth
Toutes les requêtes doivent inclure le header :
```
X-API-Key: htbm-chromecast-2026
```

---

## Endpoints

### GET /api/status
Retourne l'état temps réel de toutes les chambres.
```js
const res = await fetch('http://192.168.0.60:5000/api/status', {
  headers: { 'X-API-Key': 'htbm-chromecast-2026' }
})
const data = await res.json()
// data.rooms = tableau de chambres
// data.count = nombre total
```

Réponse exemple :
```json
{
  "count": 1,
  "rooms": [
    {
      "id": 7,
      "name": "Chambre 7",
      "chromecast_ip": "192.168.0.130",
      "proxy_port": 8007,
      "connected": true,
      "last_connected": "2026-03-26T09:38:39",
      "last_push": "2026-03-26T09:45:12",
      "disconnected_since": null,
      "alert": false
    }
  ]
}
```

**Champs clés :**
- `connected` → true/false → badge vert/rouge
- `alert` → true si déconnecté depuis +5 minutes → afficher une alerte
- `disconnected_since` → timestamp ISO, null si connecté
- `last_push` → dernière fois que l'image a été envoyée sur la TV

---

### GET /api/scan
Scanne le réseau pour trouver les Chromecasts disponibles (prend ~10-15s).
```js
const res = await fetch('http://192.168.0.60:5000/api/scan', {
  headers: { 'X-API-Key': 'htbm-chromecast-2026' }
})
const data = await res.json()
// data.devices = liste des IPs trouvées
```

Réponse exemple :
```json
{
  "devices": [
    { "ip": "192.168.0.130", "known": true,  "name": "Chambre 7" },
    { "ip": "192.168.0.145", "known": false, "name": null }
  ]
}
```

Utiliser `known: false` pour afficher les Chromecasts non configurées dans le formulaire d'ajout.

---

### POST /api/rooms
Ajoute une nouvelle chambre (génère l'image + redémarre le service).
```js
const res = await fetch('http://192.168.0.60:5000/api/rooms', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'htbm-chromecast-2026'
  },
  body: JSON.stringify({
    room_id: 12,
    chromecast_ip: '192.168.0.145'
  })
})
const data = await res.json()
// data.room = infos de la chambre créée
```

Réponse (201) :
```json
{
  "success": true,
  "room": {
    "id": 12,
    "name": "Chambre 12",
    "chromecast_ip": "192.168.0.145",
    "proxy_port": 8012,
    "token": "xxxx",
    "register_url": "http://192.168.0.60:5000/register?token=xxxx"
  }
}
```
⚠️ Le service redémarre (~3s d'indisponibilité normale).

---

### DELETE /api/rooms/:id
Supprime une chambre.
```js
await fetch('http://192.168.0.60:5000/api/rooms/12', {
  method: 'DELETE',
  headers: { 'X-API-Key': 'htbm-chromecast-2026' }
})
```

---

## Structure React suggérée

```
src/
  pages/
    ChromecastDashboard.jsx   ← page principale
  components/
    RoomCard.jsx              ← carte par chambre (vert/rouge + popup)
    RoomPopup.jsx             ← détails chambre (IP, last push, etc.)
    AddRoomModal.jsx          ← formulaire ajout (scan + saisie numéro)
    AlertBanner.jsx           ← bannière si alert=true sur une chambre
```

---

## Polling temps réel
Pas de WebSocket — utiliser un polling toutes les 15 secondes :
```js
useEffect(() => {
  const fetchStatus = () => { /* appel /api/status */ }
  fetchStatus()
  const interval = setInterval(fetchStatus, 15000)
  return () => clearInterval(interval)
}, [])
```

---

## Logique d'alerte (5 minutes)
Le serveur calcule déjà `alert: true` si déconnecté depuis +5 min.
Côté React, afficher une notification/bannière rouge quand `room.alert === true`.

```jsx
{rooms.filter(r => r.alert).map(r => (
  <AlertBanner key={r.id} room={r} />
))}
```

---

## Flux "Ajouter une Chromecast"
1. Clic bouton "Ajouter" → ouvre `AddRoomModal`
2. Modal lance `GET /api/scan` (spinner pendant ~15s)
3. Affiche les IPs `known: false` → l'utilisateur sélectionne une IP
4. Saisit le numéro de chambre (1-999)
5. Confirme → `POST /api/rooms`
6. Attendre 3-4s → rafraîchir `/api/status`

---

## Variable d'environnement
Dans ton `.env` React :
```
VITE_API_BASE=http://192.168.0.60:5000
VITE_API_KEY=htbm-chromecast-2026
```
```js
const API_BASE = import.meta.env.VITE_API_BASE
const API_KEY  = import.meta.env.VITE_API_KEY
```
