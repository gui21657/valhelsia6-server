@echo off
setlocal enabledelayedexpansion
rem ---------------------------------------------------------------------------
rem Arranque de un servidor de Valhelsia 6 sin Docker (Windows).
rem
rem Este script NO contiene mods ni jars. Descarga el server pack oficial desde
rem la CDN de CurseForge la primera vez que se ejecuta, instala Forge con el
rem instalador oficial que viene dentro de ese pack, y arranca el servidor.
rem
rem Uso:
rem   copy .env.example .env
rem   editar .env  (como minimo, poner EULA=TRUE)
rem   iniciar.bat
rem ---------------------------------------------------------------------------

pushd "%~dp0"

rem --- Valores por defecto. Se sobreescriben con lo que haya en .env ---------
set "EULA=FALSE"
set "VERSION_PACK=6.2.3"
set "VERSION_FORGE=1.20.1-47.4.0"
set "URL_SERVER_PACK=https://mediafilez.forgecdn.net/files/6448/193/Valhelsia-6-6.2.3-SERVER.zip"
set "DIR_SERVIDOR=servidor"
set "RAM_INICIAL=4G"
set "RAM_MAXIMA=8G"
set "RUTA_JAVA=java"

if exist ".env" (
    for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do (
        set "%%a=%%b"
    )
) else (
    echo [valhelsia] AVISO: no existe .env. Se usaran los valores por defecto.
    echo [valhelsia]        Copia .env.example a .env para configurarlo.
    echo.
)

for %%F in ("%URL_SERVER_PACK%") do set "ARCHIVO_PACK=%%~nxF"
set "DIR_DESCARGAS=descargas"

rem --- 1. Comprobaciones previas --------------------------------------------
rem Se ejecuta java directamente en vez de usar 'where', porque 'where' falla
rem cuando RUTA_JAVA es una ruta absoluta en lugar de un nombre del PATH.
set "SALIDA_JAVA=%TEMP%\valhelsia_java_version.txt"
"%RUTA_JAVA%" -version > "%SALIDA_JAVA%" 2>&1
if errorlevel 1 (
    del /q "%SALIDA_JAVA%" 2>nul
    echo [valhelsia] ERROR: no se pudo ejecutar Java ^("%RUTA_JAVA%"^).
    echo [valhelsia] Valhelsia 6 usa Minecraft 1.20.1 con Forge %VERSION_FORGE% y necesita Java 17.
    echo [valhelsia] Descargalo en https://adoptium.net/ ^(Temurin 17 LTS, 64 bits^).
    echo [valhelsia] Si ya lo tienes instalado, pon la ruta completa en RUTA_JAVA dentro de .env.
    goto :fin_error
)

set "VERSION_JAVA="
for /f "tokens=3" %%v in ('findstr /i "version" "%SALIDA_JAVA%"') do (
    if not defined VERSION_JAVA set "VERSION_JAVA=%%~v"
)
del /q "%SALIDA_JAVA%" 2>nul
for /f "tokens=1 delims=." %%v in ("%VERSION_JAVA%") do set "JAVA_MAYOR=%%v"

if not "%JAVA_MAYOR%"=="17" (
    echo [valhelsia] AVISO: Java detectado: version %VERSION_JAVA%.
    echo [valhelsia]        Este pack esta pensado para Java 17. Con otra version
    echo [valhelsia]        es habitual que algunos mods fallen al cargar.
    echo [valhelsia]        Temurin 17 LTS: https://adoptium.net/
    echo.
)

where curl >nul 2>&1
if errorlevel 1 (
    echo [valhelsia] ERROR: no se encontro curl.exe.
    echo [valhelsia] Viene incluido en Windows 10 version 1803 y posteriores.
    goto :fin_error
)

where tar >nul 2>&1
if errorlevel 1 (
    echo [valhelsia] ERROR: no se encontro tar.exe.
    echo [valhelsia] Viene incluido en Windows 10 version 1803 y posteriores.
    goto :fin_error
)

rem --- 2. EULA: lo acepta el usuario, no este script -------------------------
if /i not "%EULA%"=="TRUE" (
    echo [valhelsia] ERROR: no has aceptado el EULA de Minecraft.
    echo [valhelsia] Lee https://aka.ms/MinecraftEULA y, si estas de acuerdo,
    echo [valhelsia] pon EULA=TRUE en tu archivo .env.
    echo [valhelsia] Este script no lo acepta por ti.
    goto :fin_error
)

rem --- 3. Descarga del server pack (fuente oficial, en tiempo de ejecucion) ---
if not exist "%DIR_DESCARGAS%" mkdir "%DIR_DESCARGAS%"

if not exist "%DIR_DESCARGAS%\%ARCHIVO_PACK%" (
    echo [valhelsia] Descargando el server pack de Valhelsia 6 %VERSION_PACK%.
    echo [valhelsia] Origen: %URL_SERVER_PACK%
    echo [valhelsia] Son varios cientos de megabytes. Puede tardar.
    curl --fail --location --progress-bar -C - -o "%DIR_DESCARGAS%\%ARCHIVO_PACK%.parcial" "%URL_SERVER_PACK%"
    if errorlevel 1 (
        echo [valhelsia] ERROR: fallo la descarga.
        goto :fin_error
    )
    move /y "%DIR_DESCARGAS%\%ARCHIVO_PACK%.parcial" "%DIR_DESCARGAS%\%ARCHIVO_PACK%" >nul
    echo [valhelsia] Descarga terminada.
) else (
    echo [valhelsia] El server pack ya estaba descargado: %DIR_DESCARGAS%\%ARCHIVO_PACK%
)

rem --- 4. Extraccion ---------------------------------------------------------
if not exist "%DIR_SERVIDOR%\mods" (
    echo [valhelsia] Extrayendo el pack en "%DIR_SERVIDOR%".
    if not exist "%DIR_SERVIDOR%" mkdir "%DIR_SERVIDOR%"
    tar -xf "%DIR_DESCARGAS%\%ARCHIVO_PACK%" -C "%DIR_SERVIDOR%"
    if errorlevel 1 (
        echo [valhelsia] ERROR: fallo la extraccion. El zip puede estar corrupto.
        echo [valhelsia] Borra "%DIR_DESCARGAS%\%ARCHIVO_PACK%" y vuelve a ejecutar.
        goto :fin_error
    )
    echo [valhelsia] Extraccion terminada.
) else (
    echo [valhelsia] El pack ya estaba extraido en "%DIR_SERVIDOR%".
)

cd /d "%DIR_SERVIDOR%"

rem --- 5. eula.txt, que es lo que lee el servidor ----------------------------
echo eula=true> eula.txt

rem --- 6. Instalacion de Forge con el instalador oficial del pack ------------
set "DIR_FORGE=libraries\net\minecraftforge\forge\%VERSION_FORGE%"
set "JAR_INSTALADOR=forge-%VERSION_FORGE%-installer.jar"

if not exist "%DIR_FORGE%" (
    if not exist "%JAR_INSTALADOR%" (
        echo [valhelsia] ERROR: no se encontro "%JAR_INSTALADOR%" dentro del pack.
        echo [valhelsia] Comprueba que VERSION_FORGE en .env ^(%VERSION_FORGE%^) coincide
        echo [valhelsia] con el instalador que trae el server pack que descargaste.
        goto :fin_error_pop
    )
    echo [valhelsia] Instalando Forge %VERSION_FORGE%. Esto descarga Minecraft y sus
    echo [valhelsia] librerias desde los servidores oficiales de Mojang y Forge.
    "%RUTA_JAVA%" -jar "%JAR_INSTALADOR%" --installServer
    if errorlevel 1 (
        echo [valhelsia] ERROR: fallo la instalacion de Forge.
        goto :fin_error_pop
    )
    echo [valhelsia] Forge instalado.
    del /q "%JAR_INSTALADOR%" 2>nul
    del /q "%JAR_INSTALADOR%.log" 2>nul
) else (
    echo [valhelsia] Forge %VERSION_FORGE% ya estaba instalado.
)

set "ARGS_WIN=%DIR_FORGE%\win_args.txt"
if not exist "%ARGS_WIN%" (
    echo [valhelsia] ERROR: falta "%ARGS_WIN%". La instalacion de Forge no termino bien.
    echo [valhelsia] Borra la carpeta "%DIR_SERVIDOR%\libraries" y vuelve a ejecutar.
    goto :fin_error_pop
)

rem --- 7. Arranque -----------------------------------------------------------
rem Estos son los mismos flags de recoleccion de basura que trae el
rem ServerStart.bat oficial del server pack de Valhelsia 6.
set "FLAGS_JVM=-XX:+UseG1GC -XX:+UnlockExperimentalVMOptions -XX:MaxGCPauseMillis=100 -XX:+DisableExplicitGC -XX:TargetSurvivorRatio=90 -XX:G1NewSizePercent=50 -XX:G1MaxNewSizePercent=80 -XX:G1MixedGCLiveThresholdPercent=50 -XX:+AlwaysPreTouch"

echo [valhelsia] Arrancando Valhelsia 6 %VERSION_PACK% ^(Minecraft 1.20.1, Forge %VERSION_FORGE%^).
echo [valhelsia] Memoria: inicial %RAM_INICIAL%, maxima %RAM_MAXIMA%.
echo [valhelsia] La primera arrancada tarda varios minutos generando el mundo.
echo [valhelsia] Para detenerlo con seguridad escribe 'stop' en esta consola.
echo.

"%RUTA_JAVA%" -Xms%RAM_INICIAL% -Xmx%RAM_MAXIMA% %FLAGS_JVM% @%ARGS_WIN% nogui

echo.
echo [valhelsia] El servidor se ha detenido.
popd
pause
exit /b 0

:fin_error_pop
cd /d "%~dp0"

:fin_error
echo.
popd
pause
exit /b 1
