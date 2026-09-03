@echo off
title TOPOLINO - LA CAISSE À MA MÈRE
color 0A

echo.
echo  ============================================
echo   TOPOLINO - LA CAISSE À MA MÈRE
echo  ============================================
echo.

cd /d "%~dp0"

:: Chercher Python
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set PYTHON=python
    goto found
)
where python3 >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set PYTHON=python3
    goto found
)

color 0C
echo  [ERREUR] Python introuvable sur ce PC.
echo.
echo  Installez Python sur : https://www.python.org/downloads/
echo  (Cochez "Add Python to PATH" lors de l'installation)
echo.
pause
exit /b 1

:found
echo  [OK] Python detecte : %PYTHON%
echo.

:: Verifier / installer les dependances
echo  Verification des dependances...
%PYTHON% -c "import flask, flask_socketio, gevent" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo  [INFO] Installation des modules requis...
    echo.
    %PYTHON% -m pip install flask flask-socketio gevent gevent-websocket
    echo.
    %PYTHON% -c "import flask, flask_socketio, gevent" >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        color 0C
        echo  [ERREUR] L'installation des modules a echoue.
        echo  Essayez manuellement : pip install flask flask-socketio gevent
        echo.
        pause
        exit /b 1
    )
    echo  [OK] Modules installes.
    echo.
)

:: Detecter HTTPS (cert.pem/key.pem presents = le serveur demarre en HTTPS)
set PROTOCOL=http
if exist cert.pem if exist key.pem set PROTOCOL=https

:: Lancer le navigateur apres 2 secondes
start /b "" cmd /c "timeout /t 2 /nobreak >nul && start %PROTOCOL%://localhost:8090"

echo  [OK] Serveur en cours de demarrage...
echo  [>>] Adresse locale : %PROTOCOL%://localhost:8090
echo  [>>] Mobile/TV      : voir le QR code dans le jeu
echo.
echo  (Fermez cette fenetre pour arreter le serveur)
echo  ============================================
echo.

:: Lancer le serveur (reste ouvert)
%PYTHON% server.py

:: Si on arrive ici, le serveur s'est arrete
echo.
color 0E
echo  [INFO] Le serveur s'est arrete.
echo  Verifiez que le port 8090 n'est pas deja utilise.
echo.
pause
