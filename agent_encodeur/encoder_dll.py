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
import logging
import os
import platform
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

log = logging.getLogger("encoder")

DLL_DIR = Path(__file__).parent / "lib"
DLL_PATH = DLL_DIR / "CardEncoder.dll"

# Codes DLL pour lesquels un cycle PnP (débranchement logiciel) a un sens :
# 1005 = USB gelé après reboot, 16 = encodeur déconnecté. PAS 1004 (tenu par une
# autre app : il faut juste attendre qu'elle relâche, pas l'arracher via PnP).
USB_FROZEN_CODES = {16, 1005}

# Après un `pnputil /restart-device`, l'encodeur (composite HID + série) met
# plusieurs SECONDES à ré-apparaître. Incident 2026-07-12 : le restart réussissait,
# on ne laissait qu'une seconde au device pour revenir, le job abandonnait — et le
# clic suivant de la réception relançait un restart qui cassait la ré-énumération en
# cours. Cinq échecs d'affilée, chambre 34 jamais encodée. Le lendemain, un job a
# échoué à 06:53 et le suivant est passé sans rien faire à 06:54 : le device était
# revenu tout seul, on avait juste cessé d'attendre.
RECONNECT_SETTLE_SEC = 30.0  # on sonde l'encodeur jusqu'à 30 s après une réparation
RECONNECT_POLL_SEC = 2.0
RESTART_COOLDOWN_SEC = 90.0  # jamais deux restarts coup sur coup : ça relance le gel

# Instant du dernier redémarrage PnP réussi (monotonic), partagé par tous les jobs
# du process : c'est ce qui empêche deux jobs successifs de se marcher dessus.
_last_restart_at = 0.0

# Device désactivé dans Windows : un cycle PnP l'aggraverait (c'est un cycle PnP
# interrompu qui l'a mis dans cet état). Le seul remède est un Enable-PnpDevice.
USB_DISABLED_CODES = {1003}

# CM_PROB_DISABLED — un device dans cet état le reste au reboot ET au
# rebranchement physique (le flag est persisté dans le registre par instance).
PNP_PROBLEM_DISABLED = 22

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
    1003: "Périphérique désactivé ou inaccessible (Windows ProblemCode 22 → Enable-PnpDevice)",
    1004: "Encodeur tenu par une autre application (TTHotel desktop ?)",
    1005: "Ouverture USB échouée (souvent USB gelé après reboot → ré-énumération PnP)",
}


def is_available() -> bool:
    return platform.system() == "Windows" and DLL_PATH.exists()


def err_str(code: int) -> str:
    return ERROR_CODES.get(code, f"Code {code}")


def is_admin() -> bool:
    """True si le process tourne avec les droits administrateur (requis pour
    Disable/Enable-PnpDevice, donc pour l'auto-réparation USB)."""
    if platform.system() != "Windows":
        return False
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _encoder_vid_pid() -> str:
    return os.environ.get("AGENT_ENCODER_USB_VIDPID", "VID_1A86&PID_FE07")


def _pnp_lookup(vid_pid: str) -> str:
    """Fragment PS listant les InstanceId du composite encodeur (pas ses interfaces
    enfants : le `\\` final impose une correspondance sur le parent)."""
    return (
        "@(Get-PnpDevice -PresentOnly | "
        f"Where-Object {{ $_.InstanceId -like 'USB\\{vid_pid}\\*' }} | "
        "Select-Object -ExpandProperty InstanceId)"
    )


def _run_ps(script: str, timeout: int = 40) -> tuple[int, str]:
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except Exception as e:  # noqa: BLE001 — remonté tel quel à l'appelant
        return -1, f"exception PnP: {e}"
    return r.returncode, (r.stderr or "").strip()[:300]


# Réactivation seule, sans disable préalable. Le seul remède quand le device est
# resté sur ProblemCode=22. Sortie : 0 = rien à faire, 10 = réparé, 2 = introuvable,
# 4 = Enable refusé.
_PS_ENSURE_ENABLED = """
$ErrorActionPreference = 'Stop'
$ids = __LOOKUP__
if (-not $ids) { exit 2 }
$healed = 0
foreach ($id in $ids) {
  $pb = (Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_ProblemCode' -ErrorAction SilentlyContinue).Data
  if ($null -ne $pb -and $pb -eq __PROB__) {
    try { Enable-PnpDevice -InstanceId $id -Confirm:$false -ErrorAction Stop; $healed++ }
    catch { [Console]::Error.WriteLine($id + ' : ' + $_.Exception.Message); exit 4 }
  }
}
if ($healed -gt 0) { Start-Sleep -Milliseconds 2500; exit 10 }
exit 0
"""


def ensure_device_enabled() -> tuple[bool, str]:
    """Réactive l'encodeur s'il est resté DÉSACTIVÉ (ProblemCode 22), typiquement
    après un cycle PnP interrompu (agent tué entre le Disable et le Enable).

    Appelé au boot et sur code 1003. Ne fait JAMAIS de disable : c'est un
    disable non suivi de son enable qui crée le problème qu'on répare ici.

    Renvoie (device utilisable, raison).
    """
    if platform.system() != "Windows":
        return False, "non-Windows"
    if not is_admin():
        return False, "agent NON administrateur → Enable-PnpDevice impossible"
    vid_pid = _encoder_vid_pid()
    script = _PS_ENSURE_ENABLED.replace("__LOOKUP__", _pnp_lookup(vid_pid)).replace(
        "__PROB__", str(PNP_PROBLEM_DISABLED)
    )
    code, err = _run_ps(script)
    if code == 0:
        return True, "device déjà actif"
    if code == 10:
        return True, f"device était DÉSACTIVÉ (ProblemCode {PNP_PROBLEM_DISABLED}) → réactivé"
    if code == 2:
        return False, f"device {vid_pid} introuvable (mauvais VID/PID ou encodeur débranché ?)"
    if code == 4:
        return False, f"Enable-PnpDevice refusé : {err}"
    return False, f"PnP exit {code}: {err}"


# Redémarrage du périphérique (arrêt/relance de la pile de pilotes) via pnputil.
# C'est le SEUL remède automatique au gel USB 1005 sur cet encodeur : contrairement
# à Disable-PnpDevice, `pnputil /restart-device` n'est PAS bloqué par le statut
# « périphérique système critique » (vérifié 2026-07-10 sur le PC réception).
# Sortie : 0 = OK, 2 = introuvable, 3 = pnputil a échoué, 4 = device KO après coup.
_PS_RESTART = """
$ErrorActionPreference = 'Stop'
$ids = __LOOKUP__
if (-not $ids) { exit 2 }
$fail = 0
foreach ($id in $ids) {
  & pnputil /restart-device "$id" | Out-Null
  if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine($id + ' : pnputil exit ' + $LASTEXITCODE); $fail++ }
}
if ($fail -gt 0) { exit 3 }
Start-Sleep -Milliseconds 2500
foreach ($id in $ids) {
  $pb = (Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_ProblemCode' -ErrorAction SilentlyContinue).Data
  if ($null -ne $pb -and $pb -ne 0) { [Console]::Error.WriteLine($id + ' ProblemCode=' + $pb); exit 4 }
}
exit 0
"""


def restart_device() -> tuple[bool, str]:
    """Redémarre le périphérique encodeur (`pnputil /restart-device`) = équivalent
    logiciel d'un rebranchement, sans désactivation. Premier remède tenté sur un
    gel USB (1005/16).

    Renvoie (succès, raison).
    """
    global _last_restart_at
    if platform.system() != "Windows":
        return False, "non-Windows"
    if not is_admin():
        return False, "agent NON administrateur → pnputil /restart-device impossible"
    vid_pid = _encoder_vid_pid()
    code, err = _run_ps(_PS_RESTART.replace("__LOOKUP__", _pnp_lookup(vid_pid)))
    if code == 0:
        _last_restart_at = time.monotonic()
        return True, f"redémarrage PnP du device OK ({vid_pid})"
    if code == 2:
        return False, f"device {vid_pid} introuvable (mauvais VID/PID ou encodeur débranché ?)"
    if code == 3:
        return False, f"pnputil /restart-device a échoué : {err}"
    if code == 4:
        healed, reason = ensure_device_enabled()
        return False, f"device KO après redémarrage ({err}) — réactivation : {reason}"
    return False, f"restart exit {code}: {err}"


# Cycle disable/enable. Sur l'encodeur Sciener des Voiles, le Disable est TOUJOURS
# refusé (« périphérique système critique » : le composite expose une interface HID
# clavier MI_02) — vérifié 2026-07-10 via Disable-PnpDevice et pnputil. Le cycle PnP
# y est donc inopérant et seul un rebranchement physique lève un gel 1005. On garde
# la fonction pour les autres matériels, mais elle doit le dire au lieu de mentir.
# Le Enable est retenté et l'état final vérifié via ProblemCode : on ne sort JAMAIS
# de cette fonction en laissant le device désactivé.
# Sortie : 0 = OK, 2 = introuvable, 3 = Disable refusé, 4 = DEVICE LAISSÉ DÉSACTIVÉ.
_PS_REENUM = """
$ErrorActionPreference = 'Stop'
$ids = __LOOKUP__
if (-not $ids) { exit 2 }
$disabled = @()
try {
  foreach ($id in $ids) { Disable-PnpDevice -InstanceId $id -Confirm:$false; $disabled += $id }
  Start-Sleep -Milliseconds 1500
} catch { [Console]::Error.WriteLine('disable : ' + $_.Exception.Message) }
$failed = @()
foreach ($id in $disabled) {
  $ok = $false
  for ($i = 0; $i -lt 3; $i++) {
    try { Enable-PnpDevice -InstanceId $id -Confirm:$false -ErrorAction Stop; $ok = $true; break }
    catch { [Console]::Error.WriteLine('enable#' + $i + ' : ' + $_.Exception.Message); Start-Sleep -Milliseconds 1200 }
  }
  if (-not $ok) { $failed += $id }
}
Start-Sleep -Milliseconds 2500
foreach ($id in $ids) {
  $pb = (Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_ProblemCode' -ErrorAction SilentlyContinue).Data
  if ($null -ne $pb -and $pb -ne 0) { [Console]::Error.WriteLine($id + ' ProblemCode=' + $pb); exit 4 }
}
if ($failed.Count -gt 0) { exit 4 }
if ($disabled.Count -eq 0) { exit 3 }
exit 0
"""


def restart_cooldown_left() -> float:
    """Secondes restantes avant qu'un nouveau redémarrage PnP soit permis. > 0 =
    un restart vient d'avoir lieu, l'encodeur est probablement en train de revenir :
    l'attendre au lieu de le redémarrer encore."""
    if not _last_restart_at:
        return 0.0
    return max(0.0, RESTART_COOLDOWN_SEC - (time.monotonic() - _last_restart_at))


# Le cycle disable/enable est REFUSÉ par Windows sur cet encodeur, et un disable
# partiellement appliqué laisse le device sur ProblemCode 22 — c'est exactement ce
# qui est arrivé le 2026-07-12 à 18:54. On ne le tente donc plus par défaut : mettre
# AGENT_USB_ALLOW_PNP_CYCLE=1 pour le réactiver sur un autre matériel.
def _pnp_cycle_allowed() -> bool:
    return os.environ.get("AGENT_USB_ALLOW_PNP_CYCLE", "") == "1"


def reenumerate_usb() -> tuple[bool, str]:
    """Cycle disable/enable du périphérique encodeur Sciener via PnP (Windows) =
    équivalent logiciel d'un débranchement/rebranchement.

    Débloque le cas où, après extinction/redémarrage du PC, l'USB reste gelé et
    CE_ConnectComm_Default échoue (code 1005) alors que le device est bien présent,
    jusqu'à un rebranchement physique.

    NÉCESSITE que l'agent tourne en ADMINISTRATEUR (Disable/Enable-PnpDevice).
    Le VID&PID ciblé est configurable via AGENT_ENCODER_USB_VIDPID
    (défaut "VID_1A86&PID_FE07" = encodeur Sciener).

    ATTENTION : sur l'encodeur Sciener, Windows REFUSE le Disable (« périphérique
    système critique », à cause de l'interface HID clavier du composite). Cette
    fonction y renvoie donc toujours (False, …) et le gel 1005 ne se lève qu'au
    rebranchement physique. Ne pas la croire capable de réparer quoi que ce soit.

    Renvoie (succès, raison). En cas d'échec du Enable, on tente une dernière
    réactivation : un device laissé désactivé survit au reboot ET au
    rebranchement physique — c'est une panne de plusieurs jours (incident
    2026-07-10), bien pire que le gel qu'on cherchait à corriger.
    """
    if platform.system() != "Windows":
        return False, "non-Windows"
    if not is_admin():
        return False, "agent NON administrateur → Disable/Enable-PnpDevice impossible"
    vid_pid = _encoder_vid_pid()
    code, err = _run_ps(_PS_REENUM.replace("__LOOKUP__", _pnp_lookup(vid_pid)))
    if code == 0:
        return True, f"ré-énumération PnP OK ({vid_pid})"
    if code == 2:
        return False, f"device {vid_pid} introuvable (mauvais VID/PID ou encodeur débranché ?)"
    if code == 3:
        if "critique" in err.lower() or "non pris en charge" in err.lower():
            return False, (
                "Windows refuse de désactiver l'encodeur (périphérique système critique : "
                "interface HID du composite) → cycle PnP impossible sur ce matériel, "
                "SEUL un débranchement/rebranchement physique lèvera le gel USB"
            )
        return False, f"Disable-PnpDevice refusé : {err}"
    if code == 4:
        # Filet de sécurité : le device est peut-être resté désactivé.
        log.error(f"Cycle PnP incomplet ({err}) → tentative de réactivation d'urgence")
        healed, reason = ensure_device_enabled()
        if healed:
            return False, f"cycle PnP échoué ({err}) mais device réactivé : {reason}"
        return False, (
            f"DEVICE LAISSÉ DÉSACTIVÉ ({err}) — réactivation d'urgence échouée : {reason}. "
            f"Réparer à la main : Enable-PnpDevice -InstanceId 'USB\\{vid_pid}\\...' -Confirm:$false "
            "(un rebranchement physique NE suffira PAS)"
        )
    return False, f"PnP exit {code}: {err}"


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

    def clear_card(self, hotel_info: str) -> None:
        """Efface TOUT le contenu de la carte posée, y compris les droits d'un
        autre hôtel (vérifié 2026-07-10 : rc=0 sur une carte étrangère, puis
        init_card OK). Rend n'importe quelle carte réutilisable sans passer par
        une carte neuve.

        DESTRUCTIF : la carte perd ses droits d'accès. Ne l'appeler qu'une fois,
        AVANT la première écriture d'un job (write_card cumule les droits)."""
        rc = self.dll.CE_ClearCard(hotel_info.encode("ascii"))
        if rc != 0:
            raise EncoderError(f"CE_ClearCard: {err_str(rc)}", rc)

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

    def _wait_reconnect(self, port: str, budget: float = RECONNECT_SETTLE_SEC) -> bool:
        """Sonde l'encodeur jusqu'à `budget` secondes après une réparation PnP.

        Le composite (interface HID + interface série) ne réapparaît pas
        instantanément : une seconde d'attente, c'est trop peu, et on abandonnait
        alors que le device revenait juste derrière (incident 2026-07-12).

        Renvoie True si la connexion est établie — `self` est alors connecté.
        """
        deadline = time.monotonic() + budget
        while True:
            time.sleep(RECONNECT_POLL_SEC)
            try:
                self.connect(port)
            except EncoderError as e:
                if time.monotonic() >= deadline:
                    log.warning(
                        f"Encodeur toujours injoignable {int(budget)} s après la réparation "
                        f"(code {e.code})"
                    )
                    return False
            else:
                log.info("Encodeur revenu après ré-énumération")
                return True

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
        `connect_retries` fois. Sur un gel USB (code 1005/16, typiquement après
        extinction/redémarrage du PC), on redémarre le device via pnputil
        (= rebranchement logiciel), puis on l'ATTEND : voir `_wait_reconnect`.
        Un seul redémarrage par job, et jamais deux à moins de
        `RESTART_COOLDOWN_SEC` d'intervalle — enchaîner les restarts casse la
        ré-énumération en cours au lieu de réparer quoi que ce soit.
        """
        heal_done = False
        restart_done = False
        last_reenum_reason = ""
        for attempt in range(1, connect_retries + 1):
            try:
                self.connect(port)
                break
            except EncoderError as e:
                if attempt >= connect_retries:
                    # Enrichit l'erreur finale d'un indice actionnable.
                    if e.code in USB_FROZEN_CODES | USB_DISABLED_CODES:
                        hint = last_reenum_reason or (
                            "auto-réparation non tentée"
                            if is_admin()
                            else "agent non administrateur (auto-réparation USB désactivée)"
                        )
                        raise EncoderUnavailable(
                            f"{e} [auto-réparation USB : {hint}]", e.code
                        ) from e
                    raise EncoderUnavailable(str(e), e.code) from e
                # Device désactivé → le réactiver. Surtout PAS un cycle PnP : c'est
                # un disable/enable interrompu qui l'a mis dans cet état.
                if e.code in USB_DISABLED_CODES and not heal_done:
                    heal_done = True
                    ok, reason = ensure_device_enabled()
                    last_reenum_reason = reason
                    if ok:
                        log.warning(f"Device inaccessible (code {e.code}) → {reason}, attente du retour")
                        if self._wait_reconnect(port):
                            break
                        continue
                    log.warning(f"Device inaccessible (code {e.code}) → réactivation impossible : {reason}")
                # Gel USB → redémarrer le device (pnputil) UNE fois, puis l'attendre.
                elif e.code in USB_FROZEN_CODES and not restart_done:
                    restart_done = True
                    cooldown = restart_cooldown_left()
                    if cooldown > 0:
                        # Un job précédent vient de le redémarrer : il est en train de
                        # revenir. Le redémarrer encore le renverrait à zéro.
                        last_reenum_reason = (
                            f"device déjà redémarré il y a moins de {int(RESTART_COOLDOWN_SEC)} s "
                            "→ on le laisse revenir au lieu de casser la ré-énumération en cours"
                        )
                        log.warning(f"USB gelé (code {e.code}) → {last_reenum_reason}")
                        if self._wait_reconnect(port, budget=cooldown + RECONNECT_SETTLE_SEC):
                            break
                        continue
                    ok, reason = restart_device()
                    if not ok and _pnp_cycle_allowed():
                        log.warning(f"USB gelé (code {e.code}) → redémarrage PnP KO : {reason}")
                        ok, reason = reenumerate_usb()
                    last_reenum_reason = reason
                    if ok:
                        log.warning(f"USB gelé (code {e.code}) → {reason}, attente du retour")
                        if self._wait_reconnect(port):
                            break
                        last_reenum_reason = (
                            f"{reason}, mais l'encodeur est resté injoignable "
                            f"{int(RECONNECT_SETTLE_SEC)} s après"
                        )
                        continue
                    log.warning(f"USB gelé (code {e.code}) → auto-réparation impossible : {reason}")
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


class EncoderUnavailable(EncoderError):
    """L'encodeur est injoignable (connexion impossible après tous les retries),
    par opposition à une erreur de carte (106 = carte d'un autre hôtel, 101 = mal
    positionnée…) qui n'incrimine pas le matériel. Seul ce cas doit faire passer
    le voyant `/serrures` au rouge."""
