"""
Binding ctypes pour CardEncoder.dll (Sciener TTHotel).

Le DLL doit être placé dans `agent_encodeur/lib/` avec ses dépendances :
    CardEncoder.dll          (principal)
    mfc140u.dll mfc140ud.dll msvcp140.dll msvcp140d.dll
    ucrtbase.dll ucrtbased.dll vcruntime140.dll vcruntime140d.dll

Si le dossier `lib/` ou le DLL est absent → on tombe en mode STUB qui simule.
"""

from __future__ import annotations

import ctypes
import os
import platform
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

DLL_DIR = Path(__file__).parent / "lib"
DLL_PATH = DLL_DIR / "CardEncoder.dll"

# Codes d'erreur du DLL (extrait du manuel V1.6.1)
ERROR_CODES = {
    0: "Succès",
    1: "Échec",
    2: "Mauvais paramètre",
    3: "Erreur com (write)",
    4: "Erreur com (read)",
    5: "Erreur device",
    6: "Clé non configurée",
    7: "Pas en mode émission",
    10: "Serveur non configuré",
    11: "Échec requête serveur",
    12: "Serveur retourne erreur",
    13: "hotelInfo invalide ou expiré (refresh)",
    14: "Encodeur d'un autre hôtel",
    15: "Encodeur non initialisé",
    16: "Encodeur déconnecté",
    21: "Pas une carte IC",
    26: "Échec déconnexion",
    27: "Port COM invalide pour ConnectComm (utiliser CE_ConnectComm_Default pour E5+)",
    28: "Échec config comm",
    38: "Aucun device trouvé sur le port (utiliser CE_ConnectComm_Default pour E5+)",
    33: "Carte CPU non supportée",
    34: "Échec parse secteur",
    35: "Secteur hors limites",
    36: "Pas de secteur disponible",
    37: "Données secteur incomplètes",
    101: "Carte mal positionnée (ou autres)",
    106: "Carte d'un autre hôtel ou non initialisée",
    201: "Échec config clé",
    202: "Échec config clé carte",
    203: "Échec config hotelInfo",
    1004: "Encodeur tenu par une autre application (TTHotel desktop ?)",
    1005: "Ouverture USB échouée (souvent USB gelé après reboot → ré-énumération PnP)",
}


def is_available() -> bool:
    return platform.system() == "Windows" and DLL_PATH.exists()


def err_str(code: int) -> str:
    return ERROR_CODES.get(code, f"Code {code}")


def reenumerate_usb() -> bool:
    """Cycle disable/enable du périphérique encodeur Sciener via PnP (Windows) =
    équivalent logiciel d'un débranchement/rebranchement.

    Débloque le cas où, après extinction/redémarrage du PC, l'USB reste gelé et
    CE_ConnectComm_Default échoue (code 1005) alors que le device est bien présent,
    jusqu'à un rebranchement physique.

    NÉCESSITE que l'agent tourne en ADMINISTRATEUR (Disable/Enable-PnpDevice).
    Le VID&PID ciblé est configurable via AGENT_ENCODER_USB_VIDPID
    (défaut "VID_1A86&PID_FE07" = encodeur Sciener).
    Renvoie True si la commande PnP s'est exécutée sans erreur.
    """
    if platform.system() != "Windows":
        return False
    vid_pid = os.environ.get("AGENT_ENCODER_USB_VIDPID", "VID_1A86&PID_FE07")
    ps = (
        "$ErrorActionPreference='SilentlyContinue';"
        f"$d = Get-PnpDevice -PresentOnly | Where-Object {{ $_.InstanceId -like 'USB\\{vid_pid}\\*' }};"
        "if (-not $d) { exit 2 };"
        "$d | Disable-PnpDevice -Confirm:$false;"
        "Start-Sleep -Milliseconds 1500;"
        "$d | Enable-PnpDevice -Confirm:$false;"
        "Start-Sleep -Milliseconds 2500;"
        "exit 0"
    )
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return r.returncode == 0
    except Exception:
        return False


class CardEncoder:
    """Wrapper ctypes du DLL. Une instance = une session avec un port."""

    def __init__(self):
        if not is_available():
            raise RuntimeError(
                "CardEncoder.dll indisponible : "
                f"placer le DLL et ses dépendances dans {DLL_DIR}"
            )
        # Le DLL a besoin des DLLs dépendantes (mfc, msvcp, vcruntime) au même endroit
        os.add_dll_directory(str(DLL_DIR))  # py3.8+ Windows
        self.dll = ctypes.CDLL(str(DLL_PATH))
        self._setup_signatures()
        self._connected = False

    def _setup_signatures(self) -> None:
        # CE_ConnectComm(const wchar_t *portName) → int  (E3/E4 : port explicite)
        self.dll.CE_ConnectComm.argtypes = [ctypes.c_wchar_p]
        self.dll.CE_ConnectComm.restype = ctypes.c_int

        # CE_ConnectComm_Default() → int  (E5+ : auto-détecte le device USB Sciener)
        self.dll.CE_ConnectComm_Default.argtypes = []
        self.dll.CE_ConnectComm_Default.restype = ctypes.c_int

        # CE_DisconnectComm() → int
        self.dll.CE_DisconnectComm.argtypes = []
        self.dll.CE_DisconnectComm.restype = ctypes.c_int

        # CE_InitCardEncoder(const char *hotelInfo) → int
        self.dll.CE_InitCardEncoder.argtypes = [ctypes.c_char_p]
        self.dll.CE_InitCardEncoder.restype = ctypes.c_int

        # CE_SetSectors(const char *sectors) → int
        self.dll.CE_SetSectors.argtypes = [ctypes.c_char_p]
        self.dll.CE_SetSectors.restype = ctypes.c_int

        # CE_InitCard(const char *hotelInfo) → int
        self.dll.CE_InitCard.argtypes = [ctypes.c_char_p]
        self.dll.CE_InitCard.restype = ctypes.c_int

        # CE_WriteCard(hotelInfo, buildNo, floorNo, mac, timestamp, allowLockOut) → int
        self.dll.CE_WriteCard.argtypes = [
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_ulong,
            ctypes.c_bool,
        ]
        self.dll.CE_WriteCard.restype = ctypes.c_int

        # CE_ClearCard(const char *hotelInfo) → int
        self.dll.CE_ClearCard.argtypes = [ctypes.c_char_p]
        self.dll.CE_ClearCard.restype = ctypes.c_int

        # CE_GetCardNo(char **cardNumber) → int (allocation côté C, on lit avant qu'il libère)
        self.dll.CE_GetCardNo.argtypes = [ctypes.POINTER(ctypes.c_char_p)]
        self.dll.CE_GetCardNo.restype = ctypes.c_int

        # CE_GetVersion(char **version) → int  (utile pour logger le modèle d'encodeur)
        self.dll.CE_GetVersion.argtypes = [ctypes.POINTER(ctypes.c_char_p)]
        self.dll.CE_GetVersion.restype = ctypes.c_int

        # CE_Beep(on_ms, off_ms, repeats) → int  (feedback sonore : succès court, erreur double bref)
        self.dll.CE_Beep.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int]
        self.dll.CE_Beep.restype = ctypes.c_int

    # ─── méthodes haut niveau ───────────────────────────────────────────────

    def connect(self, port: str = "") -> None:
        """Se connecte à l'encodeur.

        - port vide ou "auto" → CE_ConnectComm_Default() (auto-détection USB,
          requis pour E5/SN941-M1). C'est le mode par défaut depuis la DLL 1.7.x.
        - port = "COMx" → CE_ConnectComm explicite (E3/E4, DLL ≤ 1.6.x).
        """
        # Défensif : si une session précédente a planté avant son disconnect, ou si
        # Windows n'a pas encore relâché le handle USB, l'encodeur reste "tenu"
        # (codes 16/1004) et CE_Connect* échoue jusqu'au débranchement physique.
        # On force un disconnect + court délai avant toute connexion pour balayer
        # ce handle fantôme et éviter le débranchement/rebranchement manuel.
        try:
            self.dll.CE_DisconnectComm()
            time.sleep(0.3)
        except Exception:
            pass
        self._connected = False

        p = (port or "").strip()
        if not p or p.lower() == "auto":
            rc = self.dll.CE_ConnectComm_Default()
            if rc != 0:
                raise EncoderError(f"CE_ConnectComm_Default(): {err_str(rc)}", rc)
        else:
            # Windows accepte "COM4" pour COM≤9, mais demande "\\.\COM10" pour > 9.
            # Le format "\\.\COMx" marche pour tous les ports.
            target = p if p.startswith("\\\\.\\") else rf"\\.\{p}"
            rc = self.dll.CE_ConnectComm(target)
            if rc != 0:
                raise EncoderError(f"CE_ConnectComm({target}): {err_str(rc)}", rc)
        self._connected = True

    def disconnect(self) -> None:
        if self._connected:
            self.dll.CE_DisconnectComm()
            self._connected = False

    def init_encoder(self, hotel_info: str) -> None:
        rc = self.dll.CE_InitCardEncoder(hotel_info.encode("ascii"))
        if rc != 0:
            raise EncoderError(f"CE_InitCardEncoder: {err_str(rc)}", rc)

    def set_sectors(self, sectors: str = "0000000000011111") -> None:
        """sectors = chaîne de 16 chars, 1 = secteur activé. Défaut TTHotel : 12-16."""
        rc = self.dll.CE_SetSectors(sectors.encode("ascii"))
        if rc != 0:
            raise EncoderError(f"CE_SetSectors: {err_str(rc)}", rc)

    def init_card(self, hotel_info: str) -> None:
        """À appeler sur une carte vierge avant le premier write_card."""
        rc = self.dll.CE_InitCard(hotel_info.encode("ascii"))
        if rc != 0:
            raise EncoderError(f"CE_InitCard: {err_str(rc)}", rc)

    def write_card(
        self,
        hotel_info: str,
        build_no: int,
        floor_no: int,
        mac: str,
        expire_timestamp_sec: int,
        allow_lockout: bool = False,
    ) -> None:
        """
        Écrit un droit d'accès sur la carte posée. Les writes successifs
        s'AJOUTENT (la carte cumule les droits pour plusieurs chambres).
        """
        mac_clean = mac.replace(":", "").replace("-", "").upper()
        if len(mac_clean) != 12:
            raise ValueError(f"MAC doit être 12 hex chars, reçu {mac_clean!r}")
        rc = self.dll.CE_WriteCard(
            hotel_info.encode("ascii"),
            int(build_no),
            int(floor_no),
            mac_clean.encode("ascii"),
            int(expire_timestamp_sec),
            bool(allow_lockout),
        )
        if rc != 0:
            raise EncoderError(
                f"CE_WriteCard(build={build_no}, floor={floor_no}, mac={mac_clean}): {err_str(rc)}",
                rc,
            )

    def get_card_no(self) -> Optional[str]:
        """Lit le numéro de la carte posée, ou None."""
        out = ctypes.c_char_p()
        rc = self.dll.CE_GetCardNo(ctypes.byref(out))
        if rc != 0:
            return None
        return out.value.decode("ascii") if out.value else None

    def beep(self, on_ms: int = 150, off_ms: int = 50, repeats: int = 1) -> None:
        """Feedback sonore. TTHotel desktop utilise (150,50,1) pour succès, (50,50,2) pour erreur."""
        try:
            self.dll.CE_Beep(int(on_ms), int(off_ms), int(repeats))
        except Exception:
            pass  # Le beep est un nice-to-have, jamais bloquant.

    def get_version(self) -> Optional[str]:
        """Renvoie le JSON renvoyé par CE_GetVersion (model, dll, firmware).
        Appelable uniquement après connect(). Sinon retourne None."""
        out = ctypes.c_char_p()
        rc = self.dll.CE_GetVersion(ctypes.byref(out))
        if rc != 0:
            return None
        return out.value.decode("ascii") if out.value else None

    @contextmanager
    def session(
        self,
        hotel_info: str,
        port: str = "",
        sectors: str = "0000000000011111",
        connect_retries: int = 4,
        connect_retry_delay: float = 1.5,
    ) -> "Iterator[CardEncoder]":
        """Ouvre une session DLL le temps d'un bloc d'encodage, puis libère
        l'encodeur. Permet à TTHotel desktop (ou autre) d'utiliser l'encodeur
        entre les jobs.

        Retry sur connect : si l'encodeur est tenu par une autre app au moment
        où on essaie, attend `connect_retry_delay` s et retente jusqu'à
        `connect_retries` fois. À la 1re vraie galère de connexion (typiquement
        code 1005 après extinction/redémarrage du PC : USB gelé), on tente une
        ré-énumération PnP de l'encodeur (= rebranchement logiciel) avant de
        retenter — évite le débranchement/rebranchement manuel.
        """
        reenum_tried = False
        for attempt in range(1, connect_retries + 1):
            try:
                self.connect(port)
                break
            except EncoderError:
                if attempt >= connect_retries:
                    raise
                if not reenum_tried:
                    reenum_tried = True
                    if reenumerate_usb():
                        time.sleep(1.0)  # laisse l'USB réapparaître après le cycle PnP
                        continue
                time.sleep(connect_retry_delay)
        try:
            self.init_encoder(hotel_info)
            self.set_sectors(sectors)
            yield self
        finally:
            try:
                self.disconnect()
            except Exception:
                pass


class EncoderError(Exception):
    def __init__(self, message: str, code: int):
        super().__init__(message)
        self.code = code
