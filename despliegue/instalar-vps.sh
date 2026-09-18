#!/usr/bin/env bash
#
# Deja un servidor Ubuntu/Debian recien creado listo para alojar Valhelsia 6
# de forma permanente: Docker, el repositorio, arranque automatico al encender
# y copias de seguridad diarias.
#
# Pensado para un VPS (Oracle Cloud, Hetzner, Contabo...) o cualquier maquina
# Linux que vaya a quedarse encendida.
#
# Uso, desde la propia maquina destino:
#   curl -fsSL https://raw.githubusercontent.com/gui21657/valhelsia6-server/main/despliegue/instalar-vps.sh -o instalar-vps.sh
#   less instalar-vps.sh          # leelo antes de ejecutarlo como root
#   sudo bash instalar-vps.sh
#
# Es idempotente: se puede volver a ejecutar sin romper nada.
#
set -euo pipefail

REPO="${REPO:-https://github.com/gui21657/valhelsia6-server.git}"
DESTINO="${DESTINO:-/opt/valhelsia6-server}"
PUERTO="${PUERTO:-25565}"

msg()   { printf '\n[instalar] %s\n' "$*"; }
error() { printf '[instalar] ERROR: %s\n' "$*" >&2; }

if [ "$(id -u)" -ne 0 ]; then
    error "hay que ejecutarlo como root:  sudo bash $0"
    exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
    error "este script asume Debian o Ubuntu (apt-get)."
    error "En otra distribucion, instala Docker a mano y sigue desde el paso 3."
    exit 1
fi

# --------------------------------------------------------------------------
# 1. Docker
# --------------------------------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    msg "Docker y Compose ya estan instalados, no se toca nada"
else
    msg "Instalando Docker desde el repositorio oficial"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg git

    install -m 0755 -d /etc/apt/keyrings
    if [ ! -f /etc/apt/keyrings/docker.asc ]; then
        curl -fsSL "https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg" \
            -o /etc/apt/keyrings/docker.asc
        chmod a+r /etc/apt/keyrings/docker.asc
    fi

    cat > /etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") $(. /etc/os-release && echo "$VERSION_CODENAME") stable
EOF

    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
fi

# --------------------------------------------------------------------------
# 2. Aviso sobre la arquitectura
# --------------------------------------------------------------------------
arquitectura="$(uname -m)"
msg "Arquitectura detectada: $arquitectura"
if [ "$arquitectura" = "aarch64" ] || [ "$arquitectura" = "arm64" ]; then
    cat <<'AVISO'
   AVISO: estas en ARM (tipico de Oracle Cloud Ampere A1).
   Minecraft Forge funciona en ARM, pero algun mod con librerias nativas
   puede fallar. Si el servidor no arranca y el registro menciona
   UnsatisfiedLinkError o una libreria .so, esa es la causa.
   Mira el registro con:  docker compose logs -f
AVISO
fi

# --------------------------------------------------------------------------
# 3. Repositorio
# --------------------------------------------------------------------------
if [ -d "$DESTINO/.git" ]; then
    msg "El repositorio ya esta en $DESTINO, actualizandolo"
    git -C "$DESTINO" pull --ff-only || msg "No se pudo actualizar, se sigue con lo que hay"
else
    msg "Clonando el repositorio en $DESTINO"
    git clone --depth 1 "$REPO" "$DESTINO"
fi
cd "$DESTINO"

# --------------------------------------------------------------------------
# 4. Configuracion
# --------------------------------------------------------------------------
if [ -f .env ]; then
    msg "Ya existe un .env, se respeta tal cual"
else
    msg "Creando .env a partir de .env.example"
    cp .env.example .env
    # Heap = RAM fisica menos 2 GB, que es lo que deja la tabla del README:
    # 6G fisicos -> 4G, 8G -> 6G, 10G -> 8G. Esos 2 GB son para el sistema y
    # para lo que Java consume por encima del heap.
    # Techo de 10G: por encima de ~12G el recolector G1 da pausas largas y el
    # servidor va peor, no mejor.
    ram_total_mb="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
    ram_heap=$(( (ram_total_mb - 2048) / 1024 ))
    [ "$ram_heap" -lt 4 ]  && ram_heap=4
    [ "$ram_heap" -gt 10 ] && ram_heap=10
    sed -i "s/^RAM_MAXIMA=.*/RAM_MAXIMA=${ram_heap}G/" .env
    msg "RAM fisica: ${ram_total_mb} MB  ->  RAM_MAXIMA=${ram_heap}G"
    if [ "$ram_total_mb" -lt 6000 ]; then
        error "esta maquina tiene menos de 6 GB de RAM."
        error "Valhelsia 6 (~250 mods) va a ir mal o no va a arrancar."
    fi
fi

# --------------------------------------------------------------------------
# 5. Cortafuegos
# --------------------------------------------------------------------------
msg "Abriendo el puerto $PUERTO en el cortafuegos del sistema"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow "$PUERTO/tcp" || true
fi
# Las imagenes de Oracle Cloud traen iptables con una politica restrictiva por
# defecto que NO se ve con ufw. Hay que abrirlo tambien ahi.
if command -v iptables >/dev/null 2>&1; then
    if ! iptables -C INPUT -p tcp --dport "$PUERTO" -j ACCEPT 2>/dev/null; then
        iptables -I INPUT 1 -p tcp --dport "$PUERTO" -j ACCEPT || true
        command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save || true
    fi
fi

# --------------------------------------------------------------------------
# 6. Arranque automatico y copias
# --------------------------------------------------------------------------
msg "Instalando las unidades de systemd"
for unidad in valhelsia.service valhelsia-copia.service valhelsia-copia.timer; do
    # Si el repositorio se clono en otra ruta, se ajusta dentro de la unidad.
    sed "s#/opt/valhelsia6-server#$DESTINO#g" "despliegue/$unidad" \
        > "/etc/systemd/system/$unidad"
done
systemctl daemon-reload
systemctl enable valhelsia.service
systemctl enable --now valhelsia-copia.timer

# --------------------------------------------------------------------------
# Resumen
# --------------------------------------------------------------------------
cat <<RESUMEN

==========================================================================
 Instalacion terminada. Faltan DOS cosas que tienes que hacer tu:
==========================================================================

 1. Aceptar el EULA de Minecraft. Edita $DESTINO/.env y pon:

        EULA=TRUE

    Al hacerlo declaras que aceptas https://aka.ms/MinecraftEULA
    Nadie puede aceptarlo por ti.

 2. Arrancar el servidor:

        sudo systemctl start valhelsia

    La primera vez descarga el modpack (797 MB) e instala Forge y ~250
    mods. Puede tardar media hora. Sigue el progreso con:

        cd $DESTINO && docker compose logs -f

 Cuando veas 'Done (...)! For help, type "help"' esta listo.

 Para saber que direccion darle a tus amigos:

        cd $DESTINO && ./direccion.sh

 SI ESTAS EN UN VPS EN LA NUBE: ademas del cortafuegos del sistema, el
 proveedor tiene el suyo propio y por defecto esta cerrado. Hay que abrir
 el puerto $PUERTO/TCP tambien ahi:
   - Oracle Cloud: Networking > VCN > Subnet > Security List > Ingress Rules
   - AWS: Security Group
   - Hetzner / Contabo: Firewall del panel
 Es el fallo numero uno al montar esto en la nube.

 Copias de seguridad: automaticas cada dia a las 05:00, en $DESTINO/copias
 Comprobar:  systemctl list-timers valhelsia-copia.timer

==========================================================================
RESUMEN
