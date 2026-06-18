#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Relais écran SmallTV-Ultra — Supabase -> écran.

Lit la table `screen_messages` (Supabase, via service_role), rend le message le
plus récent en JPEG 240x240 (texte + emoji couleur), l'upload sur l'écran
GeekMagic SmallTV-Ultra (firmware d'origine) via son API HTTP, et l'affiche.

Aucune connexion entrante : que du sortant (Supabase HTTPS + écran sur le LAN).
À lancer en service systemd sur une machine du LAN allumée H24.

API écran (firmware Ultra-V9.0.50, reverse-engineered) :
  POST /doUpload?dir=/image/   multipart champ "file"   -> stocke l'image
  GET  /set?img=/image/<nom>                            -> affiche cette image (réponse "OK")
  GET  /set?theme=<n>                                   -> revient à un thème (horloge…)
Écran = 240x240.

Usage :
  python worker.py                 # boucle (mode service)
  python worker.py --once "Coucou 😀"   # envoie un message direct et quitte (test)
"""

import os
import re
import sys
import time
import io
import requests
import urllib3
from requests.exceptions import (
    ConnectionError as ReqConnError, Timeout as ReqTimeout, InvalidHeader,
    ChunkedEncodingError,
)

# L'ESP8266 (firmware GeekMagic) renvoie une réponse HTTP non conforme
# (double Content-Length) APRÈS avoir reçu/traité la requête : la requête a
# réussi, seul le *parsing* de la réponse échoue. Selon le chemin urllib3, ça
# se manifeste par l'une de ces exceptions — toutes bénignes ici.
MALFORMED_RESPONSE = (
    InvalidHeader, urllib3.exceptions.InvalidHeader, ChunkedEncodingError,
    urllib3.exceptions.ProtocolError,
)
from datetime import datetime, timezone
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Config (variables d'environnement)
# ---------------------------------------------------------------------------
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SCREEN_IP = os.environ.get("SCREEN_IP", "192.168.0.57")
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "4"))
TEXT_FONT = os.environ.get("TEXT_FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
EMOJI_FONT = os.environ.get("EMOJI_FONT", "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf")
IMAGE_DIR = "/image/"          # dossier de stockage sur l'écran
FILENAME = "msg.jpg"           # on écrase toujours le même fichier (flash limitée)

W = H = 240
BG = (10, 12, 30)
FG = (255, 255, 255)

# Emoji : plages Unicode courantes (suffisant pour l'usage).
EMOJI_RE = re.compile(
    "([\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF"
    "\U00002190-\U000021FF\U00002B00-\U00002BFF\U0001F000-\U0001F0FF])"
    "[\U0000FE0F\U0000200D]?"
)

# ---------------------------------------------------------------------------
# Rendu image (texte + emoji couleur, auto-redimensionné, jamais coupé)
# ---------------------------------------------------------------------------
_emoji_cache = {}

def _emoji_img(ch, px):
    key = (ch, px)
    if key in _emoji_cache:
        return _emoji_cache[key]
    big = Image.new("RGBA", (140, 140), (0, 0, 0, 0))
    ImageDraw.Draw(big).text((70, 70), ch, font=ImageFont.truetype(EMOJI_FONT, 109),
                             embedded_color=True, anchor="mm")
    bbox = big.getbbox()
    if bbox:
        big = big.crop(bbox)
    out = big.resize((px, px), Image.LANCZOS)
    _emoji_cache[key] = out
    return out

def _tokenize(text):
    tokens = []
    for word in text.split():
        for p in (p for p in EMOJI_RE.split(word) if p):
            tokens.append(("emoji" if EMOJI_RE.match(p) else "text", p))
        tokens.append(("space", " "))
    if tokens and tokens[-1][0] == "space":
        tokens.pop()
    return tokens

def render(text):
    """Retourne les octets JPEG d'une image 240x240 représentant `text`."""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    tokens = _tokenize(text or "")
    maxw = W - 16

    lh = epx = 0
    tf = ImageFont.truetype(TEXT_FONT, 14)
    space_w = 0
    lines = []
    for size in range(56, 13, -2):
        tf = ImageFont.truetype(TEXT_FONT, size)
        epx = int(size * 1.05)
        space_w = d.textlength(" ", font=tf)

        def tok_w(t):
            if t[0] == "space":
                return space_w
            if t[0] == "emoji":
                return epx
            return d.textlength(t[1], font=tf)

        lines, cur, curw = [], [], 0
        for t in tokens:
            w = tok_w(t)
            if t[0] == "space":
                cur.append(t); curw += w; continue
            if curw + w > maxw and cur:
                while cur and cur[-1][0] == "space":
                    cur.pop()
                lines.append(cur); cur, curw = [], 0
            cur.append(t); curw += w
        if cur:
            while cur and cur[-1][0] == "space":
                cur.pop()
            lines.append(cur)

        asc, desc = tf.getmetrics()
        lh = max(asc + desc, epx) + 6
        widest = max((sum(tok_w(t) for t in ln) for ln in lines), default=0)
        if lh * len(lines) <= H - 8 and widest <= maxw:
            break

    # Garde-fou : si même à la plus petite taille ça déborde en hauteur,
    # on tronque le nombre de lignes et on ajoute "…" (jamais de texte coupé hors écran).
    max_lines = max(1, (H - 8) // lh)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        if lines[-1] and lines[-1][-1][0] == "text":
            typ, val = lines[-1][-1]
            lines[-1][-1] = ("text", val + "…")
        else:
            lines[-1].append(("text", "…"))

    def tok_w2(t):
        if t[0] == "space":
            return space_w
        if t[0] == "emoji":
            return epx
        return d.textlength(t[1], font=tf)

    y = (H - lh * len(lines)) // 2
    for ln in lines:
        lw = sum(tok_w2(t) for t in ln)
        x = (W - lw) / 2
        cy = y + lh / 2
        for typ, val in ln:
            if typ == "space":
                x += space_w
            elif typ == "emoji":
                e = _emoji_img(val, epx)
                img.paste(e, (int(x), int(cy - epx / 2)), e)
                x += epx
            else:
                d.text((x, cy), val, font=tf, fill=FG, anchor="lm")
                x += d.textlength(val, font=tf)
        y += lh

    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()

# ---------------------------------------------------------------------------
# Écran (HTTP)
# ---------------------------------------------------------------------------
def screen_push(jpeg_bytes):
    """Upload l'image puis demande son affichage. Lève une exception si échec."""
    base = f"http://{SCREEN_IP}"
    try:
        requests.post(
            f"{base}/doUpload?dir={IMAGE_DIR}",
            files={"file": (FILENAME, jpeg_bytes, "image/jpeg")},
            timeout=20,
        )
    except MALFORMED_RESPONSE:
        # Réponse non conforme APRÈS réception de l'image : l'upload a bien eu
        # lieu, on continue. (Une vraie coupure réseau lève ReqConnError/Timeout,
        # qui n'est PAS rattrapée ici -> le message reste en file et sera réessayé.)
        pass
    try:
        show = requests.get(f"{base}/set?img={IMAGE_DIR}{FILENAME}", timeout=15)
    except MALFORMED_RESPONSE:
        # Même tolérance sur l'affichage : la requête est partie, l'écran a reçu
        # l'ordre ; seule la réponse est illisible. On considère que c'est affiché.
        return
    show.raise_for_status()
    if show.text.strip() != "OK":
        raise RuntimeError(f"l'écran a refusé l'affichage : {show.text.strip()!r}")

# ---------------------------------------------------------------------------
# Supabase (REST, service_role -> bypass RLS)
# ---------------------------------------------------------------------------
def _headers():
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

def fetch_pending():
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/screen_messages"
        "?status=eq.pending&select=id,text&order=created_at.desc",
        headers=_headers(), timeout=15,
    )
    r.raise_for_status()
    return r.json()

def mark(ids, status, error=None):
    if not ids:
        return
    payload = {"status": status, "sent_at": datetime.now(timezone.utc).isoformat()}
    if error is not None:
        payload["error"] = error[:300]
    id_list = ",".join(str(i) for i in ids)
    requests.patch(
        f"{SUPABASE_URL}/rest/v1/screen_messages?id=in.({id_list})",
        headers={**_headers(), "Content-Type": "application/json",
                 "Prefer": "return=minimal"},
        json=payload, timeout=15,
    )

# ---------------------------------------------------------------------------
# Boucle
# ---------------------------------------------------------------------------
def handle_once():
    pending = fetch_pending()
    if not pending:
        return
    latest = pending[0]
    ids = [m["id"] for m in pending]   # les plus anciens sont supersédés
    try:
        screen_push(render(latest["text"]))
    except (ReqConnError, ReqTimeout) as e:
        # Écran injoignable (éteint / hors Wi-Fi) : on NE marque rien, le message
        # reste 'pending' et sera réessayé au prochain tour quand l'écran revient.
        print(f"[attente] écran injoignable, message gardé en file : {e}",
              file=sys.stderr, flush=True)
        return
    except Exception as e:
        # Erreur définitive (écran a répondu mais a refusé) : on marque failed.
        mark([latest["id"]], "failed", error=str(e))
        print(f"[err] {e}", file=sys.stderr, flush=True)
        return
    mark(ids, "sent")
    print(f"[ok] affiché : {latest['text']!r}", flush=True)

def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis (voir .env).")
    print(f"Relais écran démarré — écran {SCREEN_IP}, poll {POLL_INTERVAL}s", flush=True)
    while True:
        try:
            handle_once()
        except Exception as e:
            print(f"[boucle] {e}", file=sys.stderr, flush=True)
        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--once":
        # Test direct sans Supabase : python worker.py --once "Coucou 😀"
        screen_push(render(sys.argv[2]))
        print("envoyé.")
    else:
        main()
