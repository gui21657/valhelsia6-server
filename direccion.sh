#!/usr/bin/env bash
#
# Muestra que direccion tienen que escribir tus amigos en Minecraft para
# entrar al servidor.
#
# Hay tres direcciones posibles y no sirven para lo mismo. El script las
# muestra todas y dice cuando vale cada una.
#
# Uso:
#   ./direccion.sh
#
set -uo pipefail

DIR_BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Sin 'set -e' a proposito: si una comprobacion falla queremos seguir mostrando
# el resto de direcciones, no abortar el script entero.
cd "$DIR_BASE" || exit 1

PUERTO="25565"
if [ -f .env ]; then
    valor="$(grep -E '^[[:space:]]*PUERTO[[:space:]]*=' .env | tail -n1 | cut -d= -f2- | tr -d '[:space:]"'"'"'')"
    [ -n "$valor" ] && PUERTO="$valor"
fi

titulo() { printf '\n== %s ==\n' "$*"; }
msg()    { printf '   %s\n' "$*"; }

echo "[valhelsia] Direcciones para conectarse al servidor"

# --------------------------------------------------------------------------
# 1. Misma maquina
# --------------------------------------------------------------------------
titulo "En la misma maquina que aloja el servidor"
msg "localhost:$PUERTO"

# --------------------------------------------------------------------------
# 2. Misma red local (misma casa, mismo wifi)
# --------------------------------------------------------------------------
titulo "En tu red local (misma casa / mismo wifi)"
ip_local=""
if command -v ip >/dev/null 2>&1; then
    ip_local="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
elif command -v ipconfig >/dev/null 2>&1; then
    # macOS
    for iface in en0 en1; do
        ip_local="$(ipconfig getifaddr "$iface" 2>/dev/null)" && [ -n "$ip_local" ] && break
    done
fi

# Ultimo recurso en Linux si 'ip' no esta disponible.
if [ -z "$ip_local" ] && command -v hostname >/dev/null 2>&1; then
    ip_local="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi

if [ -n "$ip_local" ]; then
    msg "$ip_local:$PUERTO"
else
    msg "No se pudo detectar. Miralo con 'ip addr' (Linux) o 'ifconfig' (macOS)."
fi

# --------------------------------------------------------------------------
# 3. Desde fuera: tunel de playit.gg
# --------------------------------------------------------------------------
titulo "Desde internet, por el tunel (no hace falta tocar el router)"
if ! command -v docker >/dev/null 2>&1; then
    msg "Docker no esta instalado, asi que el tunel de este repo no aplica."
elif ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'valhelsia6-tunel'; then
    msg "El tunel no esta arrancado."
    msg "Arrancalo con:  docker compose --profile tunel up -d"
    msg "Necesita PLAYIT_SECRET_KEY en .env. Lee el apartado del README."
else
    # El agente escribe la direccion asignada en su registro. Los dominios que
    # reparte playit terminan en joinmc.link, ply.gg o playit.gg.
    direccion="$(docker logs valhelsia6-tunel 2>&1 \
        | grep -oE '[A-Za-z0-9._-]+\.(joinmc\.link|ply\.gg|playit\.gg)(:[0-9]+)?' \
        | tail -n1)"
    if [ -n "$direccion" ]; then
        msg "$direccion"
        msg "Esta es la que tienes que pasarle a tus amigos."
    else
        msg "El tunel corre pero todavia no ha anunciado una direccion."
        msg "Mira el registro:  docker compose logs -f playit"
        msg "O consultala en el panel de https://playit.gg/"
    fi
fi

# --------------------------------------------------------------------------
# 4. Desde fuera: IP publica (solo si abriste el puerto en el router)
# --------------------------------------------------------------------------
titulo "Desde internet, por IP publica (solo si redirigiste el puerto)"
ip_publica=""
if command -v curl >/dev/null 2>&1; then
    ip_publica="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null)"
fi

if [ -n "$ip_publica" ]; then
    msg "$ip_publica:$PUERTO"
    msg "Esta direccion SOLO funciona si abriste el 25565 en el cortafuegos"
    msg "y creaste la redireccion de puertos en el router. No lo da el repo."
    # Aviso de CGNAT: si la propia maquina ya esta en 100.64.0.0/10, el
    # proveedor casi seguro usa CGNAT y la redireccion no va a funcionar.
    case "$ip_local" in
        100.6[4-9].*|100.[7-9][0-9].*|100.1[0-1][0-9].*|100.12[0-7].*)
            msg ""
            msg "AVISO: tu IP local esta en el rango 100.64-100.127, tipico de"
            msg "CGNAT. Con CGNAT la redireccion de puertos no funciona por"
            msg "mucho que la configures. Usa el tunel del punto anterior."
            ;;
    esac
else
    msg "No se pudo consultar (sin curl o sin conexion)."
fi

echo
echo "[valhelsia] Recuerda: el cliente necesita el modpack Valhelsia 6 en la"
echo "            misma version que el servidor, o no podra entrar."
