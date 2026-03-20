@echo off
setlocal

echo.
echo  Topolino — Installation de l'environnement Python
echo  ==================================================
echo.

:: Vérifie que Python est disponible
python --version >nul 2>&1
if errorlevel 1 (
    echo  [ERREUR] Python n'est pas installe ou pas dans le PATH.
    echo  Telecharger : https://www.python.org/downloads/
    pause & exit /b 1
)

for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo  Python detecte : %%i

:: Crée le venv s'il n'existe pas déjà
if exist .venv (
    echo  [OK] Environnement virtuel deja present.
) else (
    echo  Creation du venv...
    python -m venv .venv
    if errorlevel 1 (
        echo  [ERREUR] Impossible de creer le venv.
        pause & exit /b 1
    )
    echo  [OK] Venv cree.
)

:: Active le venv
call .venv\Scripts\activate.bat

:: Mise à jour de pip silencieuse
echo  Mise a jour de pip...
python -m pip install --upgrade pip --quiet

:: Installation des dépendances
echo  Installation des dependances...
pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo  [ERREUR] L'installation des dependances a echoue.
    pause & exit /b 1
)

echo.
echo  [OK] Installation terminee.
echo.
echo  Pour lancer le serveur :
echo    .venv\Scripts\activate
echo    python server.py
echo.
echo  Ou utilisez start_server.bat
echo.
pause
