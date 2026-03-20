@echo off
setlocal

echo --- Topolino Game Server Starter (Node.js) ---

:: Vérifier si Node.js est installé
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] Node.js detecte. Lancement du serveur...
    
    :: Installer les dépendances si nécessaire (Express, Body-Parser)
    if not exist "node_modules" (
        echo [INFO] Installation des dependances...
        npm install express body-parser
    )
    
    start http://localhost:5000
    node server.js
    goto end
)

echo [ERREUR] Node.js est requis pour faire fonctionner le système d'upload et la manette mobile.
echo Veuillez l'installer sur https://nodejs.org/
pause

:end
endlocal
