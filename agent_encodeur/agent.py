"""
Agent Windows pour l'encodeur de cartes TTHotel.

Tourne sur le PC où l'encodeur USB (E3/E4) est branché. Boucle infinie :
poll Supabase pour les jobs `queued`, exécute l'encodage via CardEncoder.dll,
marque `done` ou `error`.

Lancement :
    python agent.py

Variables d'environnement (fichier `.env` chargé au lancement) :
    SUPABASE_URL                Supabase project URL
    SUPABASE_SERVICE_ROLE_KEY   clé service_role (bypass RLS)
    AGENT_HOTEL_ID              UUID de l'hôtel (table public.hotels)
    AGENT_POLL_SEC              défaut 2
    AGENT_RUNNING_GRACE_SEC     défaut 180
    TTHOTEL_API_BASE            ex. https://euapi.ttlock.com
    TTHOTEL_CLIENT_ID
    TTHOTEL_CLIENT_SECRET
    AGENT_ENCODER_PORT          vide ou "auto" → auto-détection USB (E5+),
                                "COMx" → port explicite (E3/E4),
                                "stub" → mode simulation
    AGENT_ENCODER_SECTORS       défaut "0000000000011111"  (secteurs TTHotel 12-16)

Si CardEncoder.dll est absent ou AGENT_ENCODER_PORT="stub",
l'agent passe en mode STUB (simule 2s puis marque done).
"""

from __future__ import annotations

import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

import requests

# ── Chargement .env ───────────────────────────────────────────────────────────

def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv(Path(__file__).with_name(".env"))

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://drdlcohzfjdogyquglcs.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
HOTEL_ID = os.environ.get("AGENT_HOTEL_ID")
POLL_INTERVAL_SEC = float(os.environ.get("AGENT_POLL_SEC", "2"))
RUNNING_GRACE_SEC = int(os.environ.get("AGENT_RUNNING_GRACE_SEC", "180"))

TTHOTEL_API = os.environ.get("TTHOTEL_API_BASE", "https://euapi.ttlock.com")
TTHOTEL_CLIENT_ID = os.environ.get("TTHOTEL_CLIENT_ID")
TTHOTEL_CLIENT_SECRET = os.environ.get("TTHOTEL_CLIENT_SECRET")

ENCODER_PORT = os.environ.get("AGENT_ENCODER_PORT", "").strip()
ENCODER_SECTORS = os.environ.get("AGENT_ENCODER_SECTORS", "0000000000011111")

if not SUPABASE_KEY or not HOTEL_ID:
    sys.stderr.write("ERREUR: SUPABASE_SERVICE_ROLE_KEY et AGENT_HOTEL_ID requis.\n")
    sys.exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

# Log vers console ET fichier (rotation 5 Mo, 3 backups) pour que `pythonw` garde une trace.
_log_dir = Path(__file__).with_name("logs")
_log_dir.mkdir(exist_ok=True)
_log_file = _log_dir / "agent.log"
_formatter = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
_console = logging.StreamHandler()
_console.setFormatter(_formatter)
from logging.handlers import RotatingFileHandler
_file = RotatingFileHandler(_log_file, maxBytes=5_000_000, backupCount=3, encoding="utf-8")
_file.setFormatter(_formatter)
logging.basicConfig(level=logging.INFO, handlers=[_console, _file])
log = logging.getLogger("agent")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_ms() -> int:
    return int(time.time() * 1000)


# ── HotelInfo TTHotel (cache 9 min) ───────────────────────────────────────────

_hotel_info_cache = {"value": None, "fetched_at": 0.0}
_hotel_info_lock = Lock()
HOTEL_INFO_TTL = 9 * 60  # 9 min, < 10 min limite serveur


def fetch_hotel_info() -> str:
    if not TTHOTEL_CLIENT_ID or not TTHOTEL_CLIENT_SECRET:
        raise RuntimeError("TTHOTEL_CLIENT_ID/SECRET requis pour fetch_hotel_info")
    r = requests.post(
        f"{TTHOTEL_API}/v3/hotel/getInfo",
        data={
            "clientId": TTHOTEL_CLIENT_ID,
            "clientSecret": TTHOTEL_CLIENT_SECRET,
            "date": str(now_ms()),
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=10,
    )
    r.raise_for_status()
    j = r.json()
    if j.get("errcode"):
        raise RuntimeError(f"hotelInfo errcode={j['errcode']} {j.get('errmsg')}")
    if "hotelInfo" not in j:
        raise RuntimeError(f"hotelInfo manquant dans réponse: {j}")
    return j["hotelInfo"]


def get_hotel_info() -> str:
    with _hotel_info_lock:
        now = time.time()
        if (
            _hotel_info_cache["value"] is None
            or now - _hotel_info_cache["fetched_at"] > HOTEL_INFO_TTL
        ):
            _hotel_info_cache["value"] = fetch_hotel_info()
            _hotel_info_cache["fetched_at"] = now
            log.info("hotelInfo rafraîchi")
        return _hotel_info_cache["value"]


# ── Encodeur (DLL ou stub) ────────────────────────────────────────────────────

try:
    from encoder_dll import CardEncoder, EncoderError, is_available
except Exception as e:
    log.warning(f"encoder_dll non chargé : {e}")
    CardEncoder = None  # type: ignore
    EncoderError = Exception  # type: ignore
    is_available = lambda: False  # type: ignore

_encoder: Any = None
USE_REAL_ENCODER = ENCODER_PORT.lower() != "stub" and is_available()


def setup_encoder() -> None:
    """Valide la DLL + détecte l'encodeur sans tenir la connexion.
    L'encodeur n'est connecté qu'au moment où un job arrive (cf encode_card),
    pour laisser TTHotel desktop ou autres apps l'utiliser entre les jobs."""
    global _encoder
    if not USE_REAL_ENCODER:
        log.info(
            "Mode STUB (AGENT_ENCODER_PORT=stub ou DLL absent). "
            "Pour activer : placer CardEncoder.dll dans lib/ et laisser "
            "AGENT_ENCODER_PORT vide (auto-détection E5+) ou =COMx (E3/E4)."
        )
        return
    mode = f"port={ENCODER_PORT}" if ENCODER_PORT else "auto-détection USB"
    log.info(f"Validation encodeur ({mode})…")
    _encoder = CardEncoder()
    # Test de connexion bref pour identifier le modèle + valider la DLL,
    # puis on relâche l'encodeur immédiatement. Si l'encodeur est déjà tenu
    # par une autre app (TTHotel desktop), on continue quand même : la connexion
    # sera retentée à chaque job.
    try:
        _encoder.connect(ENCODER_PORT)
        try:
            ver = _encoder.get_version()
            if ver:
                log.info(f"Encodeur détecté : {ver}")
        finally:
            _encoder.disconnect()
        log.info("Encodeur libre (sera connecté à la demande à chaque job)")
    except EncoderError as e:
        log.warning(f"Encodeur indispo au boot ({e}). On retentera à chaque job.")


# ── Supabase helpers ──────────────────────────────────────────────────────────

def claim_next_job() -> dict[str, Any] | None:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/jobs_encodeur",
        headers=HEADERS,
        params={
            "hotel_id": f"eq.{HOTEL_ID}",
            "statut": "eq.queued",
            "order": "created_at.asc",
            "limit": "1",
        },
        timeout=10,
    )
    r.raise_for_status()
    jobs = r.json()
    if not jobs:
        return None
    job = jobs[0]
    r2 = requests.patch(
        f"{SUPABASE_URL}/rest/v1/jobs_encodeur",
        headers={**HEADERS, "Prefer": "return=representation"},
        params={"id": f"eq.{job['id']}", "statut": "eq.queued"},
        json={"statut": "running", "updated_at": utc_now_iso()},
        timeout=10,
    )
    r2.raise_for_status()
    rows = r2.json()
    return rows[0] if rows else None


def finish_job(job_id: str, statut: str, resultat: dict[str, Any]) -> None:
    requests.patch(
        f"{SUPABASE_URL}/rest/v1/jobs_encodeur",
        headers=HEADERS,
        params={"id": f"eq.{job_id}"},
        json={"statut": statut, "resultat": resultat, "updated_at": utc_now_iso()},
        timeout=10,
    ).raise_for_status()


def activate_sejours(sejour_ids: list[str]) -> None:
    if not sejour_ids:
        return
    csv = ",".join(sejour_ids)
    requests.patch(
        f"{SUPABASE_URL}/rest/v1/sejours",
        headers=HEADERS,
        params={"id": f"in.({csv})", "statut": "eq.pending"},
        json={"statut": "actif", "updated_at": utc_now_iso()},
        timeout=10,
    ).raise_for_status()


def reclaim_stale_running() -> int:
    cutoff = datetime.now(timezone.utc).timestamp() - RUNNING_GRACE_SEC
    cutoff_iso = datetime.fromtimestamp(cutoff, timezone.utc).isoformat()
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/jobs_encodeur",
        headers={**HEADERS, "Prefer": "return=representation"},
        params={
            "hotel_id": f"eq.{HOTEL_ID}",
            "statut": "eq.running",
            "updated_at": f"lt.{cutoff_iso}",
        },
        json={"statut": "queued", "updated_at": utc_now_iso()},
        timeout=10,
    )
    r.raise_for_status()
    return len(r.json())


# ── Encodage carte (réel ou stub) ─────────────────────────────────────────────

def encode_card(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("payload") or {}
    locks = payload.get("locks") or []  # [{lockId, mac, buildNo, floorNo}, …]
    fin_iso = payload.get("fin")
    idx = payload.get("carte_index", 1)
    total = payload.get("total_cartes", 1)

    if not fin_iso:
        raise ValueError("payload.fin manquant")

    fin_dt = datetime.fromisoformat(fin_iso.replace("Z", "+00:00"))
    expire_sec = int(fin_dt.timestamp())

    log.info(f"Carte {idx}/{total} → {len(locks)} serrure(s), expire {fin_dt.isoformat()}")

    if not USE_REAL_ENCODER:
        time.sleep(2)
        return {
            "simulated": True,
            "lockIds": [l.get("lockId") for l in locks],
            "encoded_at": utc_now_iso(),
        }

    if not locks:
        raise ValueError("payload.locks vide — backend doit fournir build/floor/mac")

    hotel_info = get_hotel_info()
    written: list[dict[str, Any]] = []
    card_no: str | None = None

    # Ouvre une session DLL (connect + init + set_sectors), puis disconnect
    # à la sortie pour laisser l'encodeur libre pour TTHotel desktop ou autres.
    with _encoder.session(hotel_info, port=ENCODER_PORT, sectors=ENCODER_SECTORS) as enc:
        try:
            card_initialized = False  # init_card appelé au plus une fois par carte
            for i, lock in enumerate(locks):
                try:
                    enc.write_card(
                        hotel_info,
                        lock["buildNo"],
                        lock["floorNo"],
                        lock["mac"],
                        expire_sec,
                        False,
                    )
                    written.append({"lockId": lock["lockId"], "mac": lock["mac"]})
                    log.info(f"  [OK] ecrit pour {lock['mac']} (build={lock['buildNo']}, floor={lock['floorNo']})")
                except EncoderError as e:
                    # Code 13 = hotelInfo expiré → refresh, ré-init, retry une fois
                    if e.code == 13:
                        log.warning("hotelInfo expiré, refresh + retry")
                        _hotel_info_cache["fetched_at"] = 0  # force refresh
                        hotel_info = get_hotel_info()
                        enc.init_encoder(hotel_info)
                        enc.write_card(
                            hotel_info, lock["buildNo"], lock["floorNo"], lock["mac"],
                            expire_sec, False,
                        )
                        written.append({"lockId": lock["lockId"], "mac": lock["mac"], "retried": True})
                    # Code 106 sur la 1re écriture = carte vierge → init puis retry.
                    # Sur les écritures suivantes la carte est forcément déjà initialisée,
                    # donc 106 = vraie erreur (carte d'un autre hôtel).
                    elif e.code == 106 and i == 0 and not card_initialized:
                        log.warning("Carte vierge détectée (code 106), CE_InitCard…")
                        try:
                            enc.init_card(hotel_info)
                        except EncoderError as init_err:
                            raise EncoderError(
                                f"CE_InitCard a échoué après code 106 — carte probablement d'un autre hôtel : {init_err}",
                                init_err.code,
                            ) from init_err
                        card_initialized = True
                        log.info("Carte initialisée, retry write_card")
                        enc.write_card(
                            hotel_info, lock["buildNo"], lock["floorNo"], lock["mac"],
                            expire_sec, False,
                        )
                        written.append({"lockId": lock["lockId"], "mac": lock["mac"], "initialized": True})
                        log.info(f"  [OK] ecrit pour {lock['mac']} (build={lock['buildNo']}, floor={lock['floorNo']})")
                    else:
                        raise
            try:
                card_no = enc.get_card_no()
            except Exception:
                pass
            enc.beep(150, 50, 1)  # succès : un bip court (mêmes paramètres que TTHotel desktop)
        except Exception:
            enc.beep(50, 50, 2)  # erreur : double bip bref
            raise

    return {
        "simulated": False,
        "written": written,
        "card_no": card_no,
        "encoded_at": utc_now_iso(),
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main_loop() -> None:
    log.info(
        f"Agent démarré · hôtel {HOTEL_ID} · "
        f"mode {'RÉEL' if USE_REAL_ENCODER else 'STUB'} · "
        f"poll {POLL_INTERVAL_SEC}s"
    )
    try:
        setup_encoder()
    except Exception:
        log.exception("Échec init encodeur")
        sys.exit(2)

    try:
        n = reclaim_stale_running()
        if n:
            log.info(f"{n} job(s) running zombie remis en queue")
    except Exception:
        log.exception("Reclaim échec")

    while True:
        try:
            job = claim_next_job()
            if job is None:
                time.sleep(POLL_INTERVAL_SEC)
                continue

            log.info(f"Job {job['id']} claimé · encodage…")
            try:
                resultat = encode_card(job)
                finish_job(job["id"], "done", resultat)
                activate_sejours((job.get("payload") or {}).get("sejourIds", []))
                log.info(f"Job {job['id']} done")
            except Exception as e:
                log.exception(f"Échec encodage job {job['id']}")
                finish_job(job["id"], "error", {"error": str(e)})
        except KeyboardInterrupt:
            log.info("Arrêt manuel")
            break
        except Exception:
            log.exception("Erreur boucle")
            time.sleep(5)

    if _encoder:
        try:
            _encoder.disconnect()
        except Exception:
            pass


if __name__ == "__main__":
    main_loop()
