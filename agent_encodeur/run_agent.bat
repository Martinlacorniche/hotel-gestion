@echo off
setlocal
cd /d "%~dp0"
title Agent encodeur - superviseur

echo ================================================
echo   Agent encodeur - superviseur (relance auto)
echo ================================================
echo Dossier : %CD%
echo.

REM -- Tuer tout agent INVISIBLE (pythonw) qui tiendrait l'encodeur USB
echo Nettoyage des agents fantomes (pythonw)...
taskkill /IM pythonw.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul
echo.

:loop
echo ------------------------------------------------
echo [%DATE% %TIME%] Demarrage de l'agent...
echo ------------------------------------------------
python agent.py
echo.
echo [%DATE% %TIME%] Agent arrete (code %ERRORLEVEL%). Relance dans 3s...
echo (Ferme cette fenetre pour arreter definitivement)
timeout /t 3 /nobreak >nul
goto loop
