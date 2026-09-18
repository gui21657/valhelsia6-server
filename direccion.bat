@echo off
setlocal enabledelayedexpansion
rem ---------------------------------------------------------------------------
rem Muestra que direccion tienen que escribir tus amigos en Minecraft para
rem entrar al servidor.
rem
rem Hay tres direcciones posibles y no sirven para lo mismo. El script las
rem muestra todas y dice cuando vale cada una.
rem
rem Uso:
rem   direccion.bat
rem ---------------------------------------------------------------------------

pushd "%~dp0"

set "PUERTO=25565"
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        set "clave=%%A"
        set "clave=!clave: =!"
        if /i "!clave!"=="PUERTO" if not "%%B"=="" set "PUERTO=%%B"
    )
)
set "PUERTO=%PUERTO: =%"

echo [valhelsia] Direcciones para conectarse al servidor
echo.
echo == En la misma maquina que aloja el servidor ==
echo    localhost:%PUERTO%
echo.

rem --- Red local -------------------------------------------------------------
echo == En tu red local ^(misma casa / mismo wifi^) ==
set "IP_LOCAL="
for /f "tokens=2 delims=:" %%I in ('ipconfig ^| findstr /c:"IPv4"') do (
    if not defined IP_LOCAL (
        set "IP_LOCAL=%%I"
        set "IP_LOCAL=!IP_LOCAL: =!"
    )
)
if defined IP_LOCAL (
    echo    !IP_LOCAL!:%PUERTO%
) else (
    echo    No se pudo detectar. Miralo con 'ipconfig'.
)
echo.

rem --- Tunel de playit.gg ----------------------------------------------------
echo == Desde internet, por el tunel ^(no hace falta tocar el router^) ==
where docker >nul 2>&1
if errorlevel 1 (
    echo    Docker no esta instalado, asi que el tunel de este repo no aplica.
    goto :publica
)

docker ps --format "{{.Names}}" 2>nul | findstr /x "valhelsia6-tunel" >nul 2>&1
if errorlevel 1 (
    echo    El tunel no esta arrancado.
    echo    Arrancalo con:  docker compose --profile tunel up -d
    echo    Necesita PLAYIT_SECRET_KEY en .env. Lee el apartado del README.
    goto :publica
)

rem El agente escribe la direccion asignada en su registro. Los dominios que
rem reparte playit terminan en joinmc.link, ply.gg o playit.gg.
set "DIRECCION="
for /f "tokens=*" %%L in ('docker logs valhelsia6-tunel 2^>^&1 ^| findstr /r /c:"joinmc\.link" /c:"ply\.gg" /c:"playit\.gg"') do (
    set "ULTIMA=%%L"
)
if defined ULTIMA (
    echo    !ULTIMA!
    echo    Busca ahi el dominio terminado en joinmc.link o ply.gg:
    echo    esa es la direccion que tienes que pasarle a tus amigos.
) else (
    echo    El tunel corre pero todavia no ha anunciado una direccion.
    echo    Mira el registro:  docker compose logs -f playit
    echo    O consultala en el panel de https://playit.gg/
)
echo.

:publica
rem --- IP publica ------------------------------------------------------------
echo == Desde internet, por IP publica ^(solo si redirigiste el puerto^) ==
set "IP_PUBLICA="
for /f "tokens=*" %%P in ('curl.exe -fsS --max-time 8 https://api.ipify.org 2^>nul') do set "IP_PUBLICA=%%P"
if defined IP_PUBLICA (
    echo    !IP_PUBLICA!:%PUERTO%
    echo    Esta direccion SOLO funciona si abriste el 25565 en el cortafuegos
    echo    y creaste la redireccion de puertos en el router. No lo da el repo.
) else (
    echo    No se pudo consultar ^(sin curl.exe o sin conexion^).
)

echo.
echo [valhelsia] Recuerda: el cliente necesita el modpack Valhelsia 6 en la
echo             misma version que el servidor, o no podra entrar.
echo.
popd
endlocal
pause
