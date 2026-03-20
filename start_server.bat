@echo off
setlocal

echo.
echo  Topolino — Demarrage du serveur
echo  ================================
echo.

:: Venv présent → on l'utilise directement
if exist .venv\Scripts\activate.bat (
    call .venv\Scripts\activate.bat
    echo  [OK] Venv active.
    echo  Lancement de server.py...
    echo.
    python server.py
    goto end
)

:: Pas de venv → propose de lancer setup.bat
echo  [!] Environnement virtuel introuvable.
echo  Lancez d'abord setup.bat pour installer les dependances.
echo.
set /p RUN_SETUP="Lancer setup.bat maintenant ? (O/N) : "
if /i "%RUN_SETUP%"=="O" (
    call setup.bat
    if exist .venv\Scripts\activate.bat (
        call .venv\Scripts\activate.bat
        python server.py
    )
)

:end
endlocal
