@echo off
title GTA - Activation HTTPS
color 0B
cd /d "%~dp0"

echo.
echo  ============================================
echo   GTA - Generation certificat HTTPS
echo  ============================================
echo.

:: Chercher OpenSSL
set OPENSSL=
where openssl >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set OPENSSL=openssl
    goto ssl_found
)

:: Git for Windows inclut OpenSSL
for %%P in (
    "C:\Program Files\Git\usr\bin\openssl.exe"
    "C:\Program Files\Git\mingw64\bin\openssl.exe"
    "C:\Program Files (x86)\Git\usr\bin\openssl.exe"
) do (
    if exist %%P (
        set OPENSSL=%%~P
        goto ssl_found
    )
)

color 0C
echo  [ERREUR] OpenSSL introuvable.
echo.
echo  Solutions :
echo    1. Installez Git for Windows (inclut OpenSSL) :
echo       https://git-scm.com/download/win
echo    2. Ou installez OpenSSL standalone :
echo       https://slproweb.com/products/Win32OpenSSL.html
echo.
pause
exit /b 1

:ssl_found
echo  [OK] OpenSSL detecte : %OPENSSL%
echo.

:: Detecter l'IP locale
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4" ^| findstr /v "127.0.0.1"') do (
    set LOCAL_IP=%%A
    goto ip_found
)
set LOCAL_IP= 127.0.0.1

:ip_found
:: Nettoyer les espaces
set LOCAL_IP=%LOCAL_IP: =%
echo  [>>] IP locale detectee : %LOCAL_IP%
echo.

:: Creer le fichier de config OpenSSL avec SAN (requis iOS Safari)
echo  [>>] Creation de la configuration SSL...
(
echo [req]
echo default_bits       = 2048
echo prompt             = no
echo default_md         = sha256
echo distinguished_name = dn
echo x509_extensions    = v3_req
echo.
echo [dn]
echo C  = FR
echo ST = France
echo L  = Local
echo O  = GTA Topolino
echo CN = %LOCAL_IP%
echo.
echo [v3_req]
echo subjectAltName = @alt_names
echo keyUsage = digitalSignature, keyEncipherment
echo extendedKeyUsage = serverAuth
echo.
echo [alt_names]
echo IP.1  = %LOCAL_IP%
echo IP.2  = 127.0.0.1
echo DNS.1 = localhost
) > ssl_config.cnf

:: Supprimer les anciens certificats
if exist cert.pem del cert.pem
if exist key.pem  del key.pem

:: Generer le certificat auto-signe (398 jours = max accepte par iOS)
echo  [>>] Generation du certificat...
"%OPENSSL%" req -x509 -nodes -days 398 -newkey rsa:2048 ^
    -keyout key.pem -out cert.pem ^
    -config ssl_config.cnf >nul 2>&1

if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo  [ERREUR] La generation du certificat a echoue.
    pause
    exit /b 1
)

:: Nettoyer le fichier de config temporaire
del ssl_config.cnf >nul 2>&1

echo  [OK] Certificats generes : cert.pem / key.pem
echo.
echo  ============================================
echo   PROCHAINES ETAPES
echo  ============================================
echo.
echo  1. Relancez start_server.bat
echo     Le serveur demarrera en HTTPS automatiquement.
echo.
echo  2. Acces depuis le PC :
echo     https://localhost:5000
echo     (acceptez l'avertissement de securite)
echo.
echo  3. Acces depuis iPhone (pour la camera) :
echo     https://%LOCAL_IP%:5000
echo.
echo  4. Pour faire confiance au certificat sur iPhone :
echo     a) Ouvrez https://%LOCAL_IP%:5000 dans Safari
echo     b) Tapez "Avance" puis "Continuer vers le site"
echo     OU installez le certificat comme profil :
echo     a) Envoyez cert.pem sur votre iPhone (AirDrop/Mail)
echo     b) Ouvrez-le - iOS proposera de l'installer
echo     c) Reglages > General > Gestion VPN et appareils
echo     d) Reglages > General > Informations > Certificats (faire confiance)
echo.
echo  ============================================
echo.
pause
