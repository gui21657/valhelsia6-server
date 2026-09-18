#!/usr/bin/env bash
#
# Copia de seguridad del mundo SIN parar el servidor.
#
# Usa la consola del servidor para congelar la escritura en disco durante la
# copia. Copiar el mundo mientras el servidor escribe en el produce un respaldo
# roto que parece bueno hasta que lo necesitas.
#
# Uso:
#   ./despliegue/copia-seguridad.sh
#
# Automatizarlo: ver despliegue/valhelsia-copia.timer
#
set -euo pipefail

DIR_BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR_BASE" || exit 1

DIR_COPIAS="${DIR_COPIAS:-$DIR_BASE/copias}"
# Cuantas copias se conservan. Las mas viejas se borran.
COPIAS_A_CONSERVAR="${COPIAS_A_CONSERVAR:-7}"
CONTENEDOR="valhelsia6"

msg()   { printf '[copia] %s\n' "$*"; }
error() { printf '[copia] ERROR: %s\n' "$*" >&2; }

mkdir -p "$DIR_COPIAS"

# --------------------------------------------------------------------------
# Localizar el mundo
# --------------------------------------------------------------------------
if [ -d "$DIR_BASE/datos/world" ]; then
    DIR_MUNDO="datos/world"          # instalacion con Docker
elif [ -d "$DIR_BASE/servidor/world" ]; then
    DIR_MUNDO="servidor/world"       # instalacion sin Docker
else
    error "no encuentro el mundo ni en datos/world ni en servidor/world."
    error "Arranca el servidor al menos una vez antes de hacer copias."
    exit 1
fi
msg "Mundo encontrado en $DIR_MUNDO"

# --------------------------------------------------------------------------
# Congelar la escritura si el servidor esta corriendo
# --------------------------------------------------------------------------
servidor_vivo=0
if command -v docker >/dev/null 2>&1 &&
   docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTENEDOR"; then
    servidor_vivo=1
fi

rcon() {
    docker exec "$CONTENEDOR" rcon-cli "$@" >/dev/null 2>&1 || true
}

reanudar_guardado() {
    if [ "$servidor_vivo" -eq 1 ]; then
        msg "Reanudando el guardado automatico"
        rcon save-on
    fi
}

if [ "$servidor_vivo" -eq 1 ]; then
    msg "Servidor en marcha: congelando escritura en disco"
    # Pase lo que pase a partir de aqui (error, Ctrl+C), hay que volver a
    # activar el guardado o el servidor dejaria de persistir el mundo.
    trap reanudar_guardado EXIT INT TERM
    rcon save-off
    rcon save-all flush
    # Margen para que termine de volcar a disco antes de empezar a copiar.
    sleep 5
else
    msg "El servidor no esta corriendo: copia en frio (es lo mas seguro)"
fi

# --------------------------------------------------------------------------
# Copiar
# --------------------------------------------------------------------------
# La marca de tiempo viene de 'date' en tiempo de ejecucion, no del script.
marca="$(date +%Y%m%d-%H%M%S)"
destino="$DIR_COPIAS/world-$marca.tar.gz"

msg "Creando $destino"
if tar -czf "$destino" -C "$DIR_BASE" "$DIR_MUNDO"; then
    tamano="$(du -h "$destino" | cut -f1)"
    msg "Copia creada correctamente ($tamano)"
else
    error "fallo al crear la copia. Se borra el archivo incompleto."
    rm -f "$destino"
    exit 1
fi

# --------------------------------------------------------------------------
# Rotacion
# --------------------------------------------------------------------------
# Se listan por nombre, que empieza por fecha, asi que el orden alfabetico es
# el cronologico. Se conservan las N ultimas.
mapfile -t todas < <(find "$DIR_COPIAS" -maxdepth 1 -name 'world-*.tar.gz' -type f | sort)
sobran=$(( ${#todas[@]} - COPIAS_A_CONSERVAR ))
if [ "$sobran" -gt 0 ]; then
    msg "Borrando $sobran copia(s) antigua(s), se conservan $COPIAS_A_CONSERVAR"
    for i in $(seq 0 $((sobran - 1))); do
        msg "  borrando $(basename "${todas[$i]}")"
        rm -f "${todas[$i]}"
    done
fi

msg "Listo. Copias actuales: $(find "$DIR_COPIAS" -maxdepth 1 -name 'world-*.tar.gz' | wc -l)"
msg "RECUERDA: una copia en el mismo disco que el servidor no te salva de un"
msg "          disco que falla. Llevate alguna fuera de la maquina."
