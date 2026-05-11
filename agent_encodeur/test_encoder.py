"""Diagnostic du DLL CardEncoder. Lance : python test_encoder.py
Teste les 2 conventions d'appel (CDLL/cdecl, WinDLL/stdcall), les 2 versions
du DLL (dll/ vs vb/), plusieurs formats de port et la fonction CE_GetVersion
qui ne nécessite pas l'encodeur — si elle plante, le DLL est mal chargé.
"""
from __future__ import annotations
import ctypes
import os
import sys
import traceback
from pathlib import Path

PORT = os.environ.get("AGENT_ENCODER_PORT", "COM4")
HERE = Path(__file__).resolve().parent

PORT_VARIANTS = [PORT, rf"\\.\{PORT}", str(int("".join(c for c in PORT if c.isdigit())))]

print(f"Python   : {sys.version}")
print(f"Arch     : {ctypes.sizeof(ctypes.c_void_p) * 8}-bit")
print(f"Port     : {PORT}")
print()


def probe(loader_name: str, dll_path: Path):
    print(f"=== {loader_name} + {dll_path.parent.parent.name}/{dll_path.parent.name} ===")
    if not dll_path.exists():
        print(f"  DLL absent : {dll_path}")
        return
    os.add_dll_directory(str(dll_path.parent))
    try:
        loader = getattr(ctypes, loader_name)
        dll = loader(str(dll_path))
    except OSError as e:
        print(f"  Échec chargement : {e}")
        return

    # CE_GetVersion : pas besoin d'encodeur. Doit marcher si le DLL charge.
    try:
        dll.CE_GetVersion.argtypes = [ctypes.POINTER(ctypes.c_char_p)]
        dll.CE_GetVersion.restype = ctypes.c_int
        v = ctypes.c_char_p()
        rc = dll.CE_GetVersion(ctypes.byref(v))
        print(f"  CE_GetVersion : rc={rc}, ver={v.value!r}")
    except Exception as e:
        print(f"  CE_GetVersion ERR : {e}")

    # CE_ConnectComm : essaie plusieurs formats de port
    try:
        dll.CE_ConnectComm.argtypes = [ctypes.c_wchar_p]
        dll.CE_ConnectComm.restype = ctypes.c_int
        dll.CE_DisconnectComm.argtypes = []
        dll.CE_DisconnectComm.restype = ctypes.c_int
        for variant in PORT_VARIANTS:
            rc = dll.CE_ConnectComm(variant)
            print(f"  CE_ConnectComm({variant!r}): rc={rc}")
            if rc == 0:
                print("    ✓ SUCCÈS — disconnect…")
                dll.CE_DisconnectComm()
                break
    except Exception as e:
        print(f"  CE_ConnectComm ERR :")
        traceback.print_exc()

    # CE_ConnectCommOnPromise : variante avec useReverseCardNo bool
    try:
        dll.CE_ConnectCommOnPromise.argtypes = [ctypes.c_wchar_p, ctypes.c_bool]
        dll.CE_ConnectCommOnPromise.restype = ctypes.c_int
        for variant in PORT_VARIANTS[:2]:  # COM4 et \\.\COM4
            for useRev in (False, True):
                rc = dll.CE_ConnectCommOnPromise(variant, useRev)
                print(f"  CE_ConnectCommOnPromise({variant!r}, useRev={useRev}): rc={rc}")
                if rc == 0:
                    print("    ✓ SUCCÈS — disconnect…")
                    dll.CE_DisconnectComm()
                    return
    except AttributeError:
        print("  CE_ConnectCommOnPromise : symbole absent du DLL")
    except Exception as e:
        print(f"  CE_ConnectCommOnPromise ERR :")
        traceback.print_exc()
    print()


# 4 combos : CDLL/WinDLL × dll/vb
for loader in ["CDLL", "WinDLL"]:
    for subdir in ["dll", "vb"]:
        dll_path = HERE / "lib" / "CardEncoder.dll"
        # On teste juste lib/ (où on a copié dll/64). Pour vb/64, faudrait
        # remplacer manuellement les fichiers dans lib/.
        if subdir == "vb":
            continue  # on saute pour l'instant — relance après avoir copié vb/
        probe(loader, dll_path)

print("--- Pour tester vb/ : remplacer le contenu de lib/ par celui de")
print("    Card Encoder DLL/CardEncoder/vb/64/ puis relancer ce script.")
