@echo off
setlocal

echo --- Topolino Game Server ---

:: Priorité : Python (Flask + Socket.IO = multijoueur complet)
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] Python detecte. Lancement du serveur Flask...
    python -c "import flask_socketio" >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo [INFO] Installation de flask et flask-socketio...
        pip install flask flask-socketio gevent gevent-websocket
    )
    start http://localhost:5000
    python server.py
    goto end
)

:: Fallback : Python3
where python3 >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] Python3 detecte. Lancement du serveur Flask...
    python3 -c "import flask_socketio" >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        pip3 install flask flask-socketio gevent gevent-websocket
    )
    start http://localhost:5000
    python3 server.py
    goto end
)

echo [ERREUR] Python est requis. Installez Python sur https://www.python.org/
pause

:end
endlocal
