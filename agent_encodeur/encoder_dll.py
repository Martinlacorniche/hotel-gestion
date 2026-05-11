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
import time
from pathlib import Path
from typing import Optional

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
    28: "Échec config comm",
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
}


def is_available() -> bool:
    return platform.system() == "Windows" and DLL_PATH.exists()


def err_str(code: int) -> str:
    return ERROR_CODES.get(code, f"Code {code}")


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
        # CE_ConnectComm(const wchar_t *portName) → int
        self.dll.CE_ConnectComm.argtypes = [ctypes.c_wchar_p]
        self.dll.CE_ConnectComm.restype = ctypes.c_int

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

    # ─── méthodes haut niveau ───────────────────────────────────────────────

    def connect(self, port: str) -> None:
        # Windows accepte "COM4" pour COM≤9, mais demande "\\.\COM10" pour > 9.
        # Le format "\\.\COMx" marche pour tous les ports — on s'aligne dessus.
        # Si l'utilisateur a déjà mis "\\.\COMx", on ne préfixe pas une 2e fois.
        target = port if port.startswith("\\\\.\\") else rf"\\.\{port}"
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


class EncoderError(Exception):
    def __init__(self, message: str, code: int):
        super().__init__(message)
        self.code = code
