#!/usr/bin/env bash
#
# Arranque de un servidor de Valhelsia 6 sin Docker (Linux y macOS).
#
# Este script NO contiene mods ni jars. Descarga el server pack oficial desde
# la CDN de CurseForge la primera vez que se ejecuta, instala Forge con el
# instalador oficial que viene dentro de ese pack, y arranca el servidor.
#
# Uso:
#   cp .env.example .env
#   editar .env  (como minimo, poner EULA=TRUE)
#   ./iniciar.sh
#
set -euo pipefail

DIR_BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR_BASE"

# --------------------------------------------------------------------------
# Valores por defecto. Se sobreescriben con lo que haya en .env
# --------------------------------------------------------------------------
EULA="FALSE"
VERSION_PACK="6.2.3"
VERSION_FORGE="1.20.1-47.4.0"
URL_SERVER_PACK="https://mediafilez.forgecdn.net/files/6448/193/Valhelsia-6-6.2.3-SERVER.zip"
DIR_SERVIDOR="servidor"
RAM_INICIAL="4G"
RAM_MAXIMA="8G"
RUTA_JAVA="java"

# El .env se interpreta linea a linea en vez de ejecutarlo con 'source'.
# Hacerlo con 'source' romperia con valores que llevan espacios sin comillas,
# como MOTD=Servidor Valhelsia 6, e interpretaria el contenido como codigo.
cargar_env() {
    local archivo="$1" linea clave valor
    while IFS= read -r linea || [ -n "$linea" ]; do
        # Quita el retorno de carro de los archivos guardados en Windows.
        linea="${linea%$'\r'}"
        # Salta lineas vacias, comentarios y lineas sin '='.
        case "$linea" in
            ''|'#'*) continue ;;
        esac
        case "$linea" in
            *=*) ;;
            *) continue ;;
        esac
        clave="${linea%%=*}"
        valor="${linea#*=}"
        clave="${clave//[[:space:]]/}"
        # Solo nombres de variable validos.
        case "$clave" in
            ''|*[!A-Za-z0-9_]*) continue ;;
        esac
        # Quita las comillas envolventes si las hay.
        case "$valor" in
            '"'*'"') valor="${valor#\"}"; valor="${valor%\"}" ;;
            "'"*"'") valor="${valor#\'}"; valor="${valor%\'}" ;;
        esac
        printf -v "$clave" '%s' "$valor"
    done < "$archivo"
}

if [ -f "$DIR_BASE/.env" ]; then
    cargar_env "$DIR_BASE/.env"
else
    echo "AVISO: no existe .env. Se usaran los valores por defecto del script."
    echo "       Copia .env.example a .env para configurarlo."
    echo
fi

ARCHIVO_PACK="$(basename "$URL_SERVER_PACK")"
DIR_DESCARGAS="$DIR_BASE/descargas"

msg()   { printf '[valhelsia] %s\n' "$*"; }
error() { printf '[valhelsia] ERROR: %s\n' "$*" >&2; }

# --------------------------------------------------------------------------
# 1. Comprobaciones previas
# --------------------------------------------------------------------------
for cmd in curl unzip; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        error "falta el comando '$cmd'. Instalalo y vuelve a ejecutar."
        exit 1
    fi
done

if ! command -v "$RUTA_JAVA" >/dev/null 2>&1; then
    error "no se encontro Java ('$RUTA_JAVA')."
    error "Valhelsia 6 usa Minecraft 1.20.1 con Forge $VERSION_FORGE y necesita Java 17."
    error "Descargalo en https://adoptium.net/ (Temurin 17 LTS, 64 bits)."
    exit 1
fi

# Java escribe la version en stderr. 'openjdk version \"17.0.11\"' -> 17
VERSION_JAVA="$("$RUTA_JAVA" -version 2>&1 | head -n 1 | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p')"
if [ -z "$VERSION_JAVA" ]; then
    msg "AVISO: no se pudo determinar la version de Java. Se continua igualmente."
elif [ "$VERSION_JAVA" != "17" ]; then
    msg "AVISO: Java detectado: version $VERSION_JAVA."
    msg "       Este pack esta pensado para Java 17. Con otra version es"
    msg "       habitual que algunos mods fallen al cargar."
    msg "       Temurin 17 LTS: https://adoptium.net/"
    msg
fi

# --------------------------------------------------------------------------
# 2. EULA: lo acepta el usuario, no este script
# --------------------------------------------------------------------------
if [ "$(printf '%s' "$EULA" | tr '[:upper:]' '[:lower:]')" != "true" ]; then
    error "no has aceptado el EULA de Minecraft."
    error "Lee https://aka.ms/MinecraftEULA y, si estas de acuerdo,"
    error "pon EULA=TRUE en tu archivo .env."
    error "Este script no lo acepta por ti."
    exit 1
fi

# --------------------------------------------------------------------------
# 3. Descarga del server pack (fuente oficial, en tiempo de ejecucion)
# --------------------------------------------------------------------------
mkdir -p "$DIR_DESCARGAS"

if [ ! -f "$DIR_DESCARGAS/$ARCHIVO_PACK" ]; then
    msg "Descargando el server pack de Valhelsia 6 $VERSION_PACK."
    msg "Origen: $URL_SERVER_PACK"
    msg "Son varios cientos de megabytes. Puede tardar."
    # --fail para que un 404 no deje un archivo HTML con extension .zip.
    # -C - reanuda una descarga cortada.
    # Se baja a un archivo .parcial y solo se renombra al terminar bien, para
    # no dejar nunca un zip a medias que parezca completo.
    if ! curl --fail --location --progress-bar -C - \
        -o "$DIR_DESCARGAS/$ARCHIVO_PACK.parcial" \
        "$URL_SERVER_PACK"; then
        rm -f "$DIR_DESCARGAS/$ARCHIVO_PACK.parcial"
        error "fallo la descarga del server pack."
        error "URL usada: $URL_SERVER_PACK"
        error "Comprueba que URL_SERVER_PACK en .env sigue siendo valida. Si"
        error "CurseForge cambio el archivo, copia la URL nueva desde la"
        error "pestana Files de la pagina del modpack."
        error "Alternativa: descarga el zip a mano y dejalo en '$DIR_DESCARGAS'."
        exit 1
    fi
    mv "$DIR_DESCARGAS/$ARCHIVO_PACK.parcial" "$DIR_DESCARGAS/$ARCHIVO_PACK"
    msg "Descarga terminada."
else
    msg "El server pack ya estaba descargado: $DIR_DESCARGAS/$ARCHIVO_PACK"
fi

if ! unzip -t -qq "$DIR_DESCARGAS/$ARCHIVO_PACK" >/dev/null 2>&1; then
    error "el archivo descargado no es un zip valido."
    error "Borra $DIR_DESCARGAS/$ARCHIVO_PACK y vuelve a ejecutar."
    exit 1
fi

# --------------------------------------------------------------------------
# 4. Extraccion
# --------------------------------------------------------------------------
if [ ! -d "$DIR_SERVIDOR/mods" ]; then
    msg "Extrayendo el pack en '$DIR_SERVIDOR'."
    mkdir -p "$DIR_SERVIDOR"
    unzip -q -o "$DIR_DESCARGAS/$ARCHIVO_PACK" -d "$DIR_SERVIDOR"
    msg "Extraccion terminada."
else
    msg "El pack ya estaba extraido en '$DIR_SERVIDOR'."
fi

cd "$DIR_SERVIDOR"

# --------------------------------------------------------------------------
# 5. eula.txt, que es lo que lee el servidor
# --------------------------------------------------------------------------
printf 'eula=true\n' > eula.txt

# --------------------------------------------------------------------------
# 6. Instalacion de Forge con el instalador oficial incluido en el pack
# --------------------------------------------------------------------------
DIR_FORGE="libraries/net/minecraftforge/forge/$VERSION_FORGE"
JAR_INSTALADOR="forge-$VERSION_FORGE-installer.jar"

if [ ! -d "$DIR_FORGE" ]; then
    if [ ! -f "$JAR_INSTALADOR" ]; then
        error "no se encontro '$JAR_INSTALADOR' dentro del pack."
        error "Comprueba que VERSION_FORGE en .env ($VERSION_FORGE) coincide"
        error "con el instalador que trae el server pack que descargaste."
        exit 1
    fi
    msg "Instalando Forge $VERSION_FORGE. Esto descarga Minecraft y sus"
    msg "librerias desde los servidores oficiales de Mojang y Forge."
    "$RUTA_JAVA" -jar "$JAR_INSTALADOR" --installServer
    msg "Forge instalado."
    rm -f "$JAR_INSTALADOR" "$JAR_INSTALADOR.log"
else
    msg "Forge $VERSION_FORGE ya estaba instalado."
fi

ARGS_UNIX="$DIR_FORGE/unix_args.txt"
if [ ! -f "$ARGS_UNIX" ]; then
    error "falta '$ARGS_UNIX'. La instalacion de Forge no termino bien."
    error "Borra la carpeta '$DIR_SERVIDOR/libraries' y vuelve a ejecutar."
    exit 1
fi

# --------------------------------------------------------------------------
# 7. Arranque
# --------------------------------------------------------------------------
# Estos son los mismos flags de recoleccion de basura que trae el
# ServerStart.sh oficial del server pack de Valhelsia 6.
FLAGS_JVM=(
    -XX:+UseG1GC
    -XX:+UnlockExperimentalVMOptions
    -XX:MaxGCPauseMillis=100
    -XX:+DisableExplicitGC
    -XX:TargetSurvivorRatio=90
    -XX:G1NewSizePercent=50
    -XX:G1MaxNewSizePercent=80
    -XX:G1MixedGCLiveThresholdPercent=50
    -XX:+AlwaysPreTouch
)

msg "Arrancando Valhelsia 6 $VERSION_PACK (Minecraft 1.20.1, Forge $VERSION_FORGE)."
msg "Memoria: inicial $RAM_INICIAL, maxima $RAM_MAXIMA."
msg "La primera arrancada tarda varios minutos generando el mundo."
msg "Para detenerlo con seguridad escribe 'stop' en esta consola."
msg

exec "$RUTA_JAVA" \
    "-Xms$RAM_INICIAL" \
    "-Xmx$RAM_MAXIMA" \
    "${FLAGS_JVM[@]}" \
    "@$ARGS_UNIX" \
    nogui
