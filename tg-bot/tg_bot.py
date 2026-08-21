#!/usr/bin/env python3
"""Webhook Telegram du serveur Corniche.

Telegram POSTe ici via Tailscale Funnel (chemin /tg, le préfixe est retiré par
le Funnel — comme pour Junior sur /agent). Le service ne fait que deux choses :
afficher l'état de la machine, et redémarrer un service de la liste blanche.

Pourquoi ici plutôt que sur Netlify : Netlify ne peut pas joindre cette machine
(elle est derrière Tailscale). Un bouton y aurait dû déposer un ordre dans une
file, relevé au passage suivant du cron. Ici l'action est immédiate.

Sécurité, dans l'ordre où c'est vérifié :
  1. l'en-tête secret que Telegram renvoie à chaque appel (setWebhook) ;
  2. l'identifiant Telegram de l'appelant — seul l'admin déclenche une action ;
  3. une liste blanche de services, doublée d'une règle sudoers étroite.
Sans le 3, le 1 et le 2 ne suffiraient pas : une faille ici ne doit pas donner
un systemctl général.
"""
import hmac
import json
import os
import subprocess
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))


def charger_env():
    chemin = os.path.join(BASE, ".env")
    with open(chemin, encoding="utf-8") as f:
        for ligne in f:
            ligne = ligne.strip()
            if ligne and not ligne.startswith("#") and "=" in ligne:
                cle, val = ligne.split("=", 1)
                os.environ.setdefault(cle.strip(), val.strip())


charger_env()

TOKEN = os.environ["TG_TOKEN"]
ADMIN = str(os.environ["TG_ADMIN_ID"])
SECRET = os.environ["TG_WEBHOOK_SECRET"]
PORT = int(os.environ.get("TG_PORT", "5056"))
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

# Doit rester aligné avec /etc/sudoers.d/telegram-actions : y ajouter un service
# sans ajouter la ligne sudoers donnerait un bouton qui échoue en silence.
SERVICES = {
    "chromecast-hotel": "Télés des chambres",
    "screen-relay": "Écran de messages",
}

# Les trois conteneurs des sondes ne sont qu'un seul service aux yeux d'un
# humain : on n'affiche qu'une ligne « Sondes frigos », et on ne détaille le
# composant fautif que s'il y en a un. Personne n'a besoin de savoir ce qu'est
# Mosquitto tant que tout va bien.
SONDES = {
    "haccp-zigbee2mqtt": "réception radio",
    "haccp-mosquitto": "liaison interne",
    "haccp-mqtt-bridge": "envoi vers l'app",
}


def tg(methode, **params):
    url = f"https://api.telegram.org/bot{TOKEN}/{methode}"
    data = json.dumps(params).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        print(f"[tg] {methode} a échoué : {e.code} {e.read()[:200]!r}", flush=True)
        return None
    except Exception as e:  # une panne Telegram ne doit pas tuer le service
        print(f"[tg] {methode} a échoué : {e}", flush=True)
        return None


def conteneur_actif(nom):
    r = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", nom],
                       capture_output=True, text=True)
    return r.stdout.strip() == "true"


def actif(service):
    r = subprocess.run(["systemctl", "is-active", "--quiet", service])
    return r.returncode == 0


def afficher_ecran(texte, auteur):
    """Dépose un message pour l'écran de la réception.

    On passe par `screen_messages` plutôt que d'attaquer l'écran directement :
    le relais qui tourne à côté sait déjà rendre le texte et les emoji en
    240x240, gère l'API capricieuse du firmware, et la page /ecran du site
    écrit au même endroit. Deux chemins pour un écran, ce serait deux bugs.
    """
    corps = json.dumps([{
        "text": texte,
        "status": "pending",
        "created_by_name": f"{auteur} (Telegram)",
    }]).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/screen_messages",
        data=corps,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20):
            return True, None
    except urllib.error.HTTPError as e:
        return False, e.read()[:150].decode(errors="replace")
    except Exception as e:
        return False, str(e)[:150]


# Libellés des boutons d'acquittement HACCP. Le texte enregistré est celui qui
# sera lu dans le registre : il doit se suffire à lui-même des mois plus tard.
ACTIONS_HACCP = {
    "vu": "Vu",
    "porte": "Porte restée ouverte",
    "frigo": "Frigoriste appelé",
}


def supabase(methode, chemin, corps=None, prefer=None):
    entetes = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        entetes["Prefer"] = prefer
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{chemin}",
        data=json.dumps(corps).encode() if corps is not None else None,
        headers=entetes, method=methode)
    with urllib.request.urlopen(req, timeout=20) as r:
        brut = r.read()
        return json.loads(brut) if brut else None


def acquitter_haccp(alerte_id, action, auteur):
    """Écrit l'acquittement dans le registre HACCP.

    On concatène plutôt qu'on écrase : « Vu » puis « Frigoriste appelé » est une
    suite d'actions, pas une correction. Un contrôle veut la chronologie.
    """
    libelle = ACTIONS_HACCP.get(action)
    if not libelle:
        return None
    quand = time.strftime("%d/%m %H:%M")
    trace = f"{libelle} — {auteur}, {quand}"

    lignes = supabase("GET", f"haccp_alerts?id=eq.{alerte_id}&select=action_taken,acknowledged_at")
    if not lignes:
        return None
    precedent = lignes[0].get("action_taken")

    maj = {"action_taken": f"{precedent} · {trace}" if precedent else trace}
    if not lignes[0].get("acknowledged_at"):
        maj["acknowledged_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")

    supabase("PATCH", f"haccp_alerts?id=eq.{alerte_id}", maj, prefer="return=minimal")
    return trace


def clavier():
    return {
        "inline_keyboard": [
            [{"text": f"🔄 Relancer : {libelle}", "callback_data": f"restart:{svc}"}]
            for svc, libelle in SERVICES.items()
        ] + [[{"text": "📊 Rafraîchir l'état", "callback_data": "etat"}]]
    }


def texte_etat():
    lignes = ["Serveur Corniche", ""]
    for svc, libelle in SERVICES.items():
        lignes.append(f"{'🟢' if actif(svc) else '🔴'} {libelle}")

    hs = [nom for cont, nom in SONDES.items() if not conteneur_actif(cont)]
    if hs:
        lignes.append(f"🔴 Sondes frigos ({', '.join(hs)} à l'arrêt)")
    else:
        lignes.append("🟢 Sondes frigos")

    with open("/proc/uptime") as f:
        jours = int(float(f.read().split()[0]) // 86400)
    lignes += ["", f"Allumé depuis {jours} jours",
               "Mis à jour à " + time.strftime("%H:%M:%S")]
    return "\n".join(lignes)


def redemarrer(service):
    if service not in SERVICES:
        return False, "service inconnu"
    r = subprocess.run(
        ["sudo", "-n", "/usr/bin/systemctl", "restart", f"{service}.service"],
        capture_output=True, text=True, timeout=60,
    )
    if r.returncode != 0:
        return False, (r.stderr or "échec").strip()[:200]
    return True, "relancé"


def traiter(update):
    msg = update.get("message") or update.get("channel_post")
    # Trace d'exploitation : sans elle, retrouver l'identifiant d'un sujet de
    # forum oblige à repasser par getUpdates, indisponible tant qu'un webhook
    # est enregistré.
    if msg:
        sujet = (msg.get("forum_topic_created") or {}).get("name") \
            or (msg.get("reply_to_message", {}).get("forum_topic_created") or {}).get("name")
        print(f"[tg] chat={msg['chat']['id']} thread={msg.get('message_thread_id')} "
              f"sujet={sujet!r} texte={(msg.get('text') or '')[:40]!r}", flush=True)
    if msg:
        brut = (msg.get("text") or "").strip()
        commande = brut.split(maxsplit=1)[0].split("@")[0].lower() if brut else ""
        argument = brut.split(maxsplit=1)[1].strip() if " " in brut else ""
        if not commande.startswith("/") or str(msg["from"]["id"]) != ADMIN:
            return

        repondre = lambda t, **kw: tg(
            "sendMessage", chat_id=msg["chat"]["id"],
            message_thread_id=msg.get("message_thread_id"), text=t, **kw)

        if commande in ("/etat", "/machine", "/start"):
            repondre(texte_etat(), reply_markup=clavier())
        elif commande == "/ecran":
            if not argument:
                repondre("Usage : /ecran Bienvenue 👋\n(le texte s'affiche sur "
                         "l'écran de la réception en quelques secondes)")
            else:
                ok, err = afficher_ecran(argument, msg["from"].get("first_name", "?"))
                repondre(f"📺 Envoyé à l'écran : « {argument} »" if ok
                         else f"Échec de l'envoi : {err}")
        elif commande == "/aide":
            repondre("/etat — état du serveur, avec les boutons de redémarrage\n"
                     "/ecran <texte> — affiche un texte sur l'écran de la réception")
        return

    cq = update.get("callback_query")
    if not cq:
        return

    if str(cq["from"]["id"]) != ADMIN:
        tg("answerCallbackQuery", callback_query_id=cq["id"],
           text="Action réservée à l'administrateur.", show_alert=True)
        return

    data = cq.get("data") or ""
    msg = cq["message"]

    if data.startswith("hc:"):
        _, alerte_id, action = data.split(":", 2)
        auteur = cq["from"].get("first_name", "?")
        trace = acquitter_haccp(alerte_id, action, auteur)
        if not trace:
            tg("answerCallbackQuery", callback_query_id=cq["id"],
               text="Alerte introuvable.", show_alert=True)
            return
        tg("answerCallbackQuery", callback_query_id=cq["id"], text="Enregistré au registre")
        # On garde les boutons : « J'ai vu » puis « Frigoriste appelé » plus tard
        # est un enchaînement normal, pas une erreur à empêcher.
        tg("editMessageText", chat_id=msg["chat"]["id"], message_id=msg["message_id"],
           text=(msg.get("text") or "") + f"\n👤 {trace}",
           reply_markup=msg.get("reply_markup"))
        return

    if data == "etat":
        tg("answerCallbackQuery", callback_query_id=cq["id"], text="Actualisé")
    elif data.startswith("restart:"):
        service = data.split(":", 1)[1]
        ok, detail = redemarrer(service)
        tg("answerCallbackQuery", callback_query_id=cq["id"],
           text=f"{SERVICES.get(service, service)} : {detail}", show_alert=not ok)
    else:
        tg("answerCallbackQuery", callback_query_id=cq["id"])
        return

    # On réécrit le message d'origine plutôt que d'en empiler un nouveau :
    # le fil reste lisible et l'état affiché est toujours le dernier connu.
    tg("editMessageText", chat_id=msg["chat"]["id"], message_id=msg["message_id"],
       text=texte_etat(), reply_markup=clavier())


class Handler(BaseHTTPRequestHandler):
    def _repondre(self, code, corps=b"ok"):
        self.send_response(code)
        self.send_header("Content-Length", str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)

    def do_GET(self):
        chemin = urllib.parse.urlparse(self.path).path.rstrip("/")
        self._repondre(200 if chemin in ("", "/sante") else 404)

    def do_POST(self):
        recu = self.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        if not hmac.compare_digest(recu, SECRET):
            self._repondre(403, b"forbidden")
            return
        taille = int(self.headers.get("Content-Length") or 0)
        # Telegram réémet tant qu'il n'a pas de 200 : on acquitte d'abord, on
        # traite ensuite, sinon un redémarrage un peu long serait rejoué.
        corps = self.rfile.read(taille)
        self._repondre(200)
        try:
            traiter(json.loads(corps))
        except Exception as e:
            print(f"[tg] traitement : {e}", flush=True)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"[tg] écoute sur 127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
