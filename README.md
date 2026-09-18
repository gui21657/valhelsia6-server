# Servidor de Valhelsia 6

Infraestructura para levantar un servidor dedicado del modpack **Valhelsia 6**
de Minecraft Java Edition, con Docker o sin Docker.

Este repositorio contiene **solamente scripts y configuracion**. No incluye ni
redistribuye el modpack, los mods, Forge ni ningun archivo de Minecraft: todo
eso se descarga en el momento de la instalacion desde las fuentes oficiales
(CurseForge y los servidores de Mojang y Forge). Lee el apartado
[Aviso legal](#aviso-legal) antes de nada.

---

## Datos del modpack

Todo lo de esta tabla esta verificado contra las fuentes que se citan al final,
no estimado.

| Dato | Valor | De donde sale |
| --- | --- | --- |
| Modpack | Valhelsia 6 | [CurseForge, proyecto 878495](https://www.curseforge.com/minecraft/modpacks/valhelsia-6) |
| Version del pack | 6.2.3, publicada el 21/04/2025 | Archivo mas reciente marcado como `release` en CurseForge |
| Minecraft | 1.20.1 | CurseForge y [wiki oficial de Valhelsia](https://wiki.valhelsia.net/modpacks/valhelsia-6) |
| Cargador de mods | Forge **1.20.1-47.4.0** | El propio server pack trae `forge-1.20.1-47.4.0-installer.jar` y su `ServerStart.sh` fija `FORGE_VERSION="1.20.1-47.4.0"` |
| Java | **17** (Temurin 17 LTS, 64 bits) | La [guia de servidor de la wiki](https://wiki.valhelsia.net/navigation/knowledgebase/server-setup) indica Temurin 17 para Minecraft 1.17 o posterior |
| Server pack | `Valhelsia-6-6.2.3-SERVER.zip`, 797 MB (835.704.535 bytes) | [Archivo 6448193 en CurseForge](https://www.curseforge.com/minecraft/modpacks/valhelsia-6/files/6448193) |
| RAM por defecto del pack | 4 GB (`ALLOCATED_RAM="4G"`) | Valor que trae de fabrica el `ServerStart.sh` del server pack |

Notas importantes sobre las versiones:

- **El cliente y el servidor tienen que usar exactamente la misma version del
  pack.** Si el servidor corre 6.2.3, el cliente tiene que ser 6.2.3. Una
  diferencia de version es la causa numero uno de que no se pueda entrar.
- Java 17 no es una sugerencia. Forge 47.x nacio para Java 17 y una parte de
  los mods de este pack no cargan en versiones de Java mas nuevas. Si ya tienes
  Java 21 o 25 instalado para otra cosa, instala Temurin 17 aparte y apunta la
  variable `RUTA_JAVA` a el.

---

## Requisitos de hardware

Valhelsia 6 lleva alrededor de 250 mods. Es un pack pesado y conviene ser
honesto con los numeros en vez de repetir el minimo optimista de siempre.

### Memoria

El equipo de Valhelsia no publica una tabla oficial de RAM para servidor: su
pagina de memoria solo cubre el cliente (minimo 4 GB, recomendado 5 GB). Lo
unico verificable del lado del servidor es que el `ServerStart.sh` oficial viene
con 4 GB. La tabla siguiente es una recomendacion practica basada en ese punto
de partida y en lo que exigen los servicios de hosting para este pack; **no es
un dato oficial del equipo de Valhelsia.**

| Jugadores simultaneos | Heap de Java (`-Xmx`) | RAM fisica de la maquina |
| --- | --- | --- |
| 1 a 2, distancia de vision baja | 4 GB | 6 GB |
| 3 a 5 | 6 GB | 8 GB |
| 5 a 10 | 8 GB | 10 GB |
| 10 o mas | 10 a 12 GB | 14 GB o mas |

Tres reglas que evitan la mayoria de los problemas:

1. **Nunca asignes al servidor mas de la mitad de la RAM fisica de la maquina.**
   El proceso de Java consume bastante memoria por encima del heap, y el sistema
   operativo tambien necesita la suya. Un `-Xmx` de 8 GB en una maquina de 8 GB
   no va mas rapido: va peor, porque el sistema se pone a usar el archivo de
   intercambio.
2. **Mas RAM no es siempre mejor.** Por encima de unos 12 GB de heap, el
   recolector de basura G1 que usa este pack empieza a provocar pausas largas y
   perceptibles. Si de verdad necesitas mas, hay que cambiar de configuracion de
   recoleccion, no solo subir el numero.
3. Si el servidor va a tickar mal, lo hara por la CPU antes que por la RAM.

### Procesador

Minecraft ejecuta la simulacion del mundo en un solo hilo. Importa mucho mas la
velocidad de un nucleo que la cantidad de nucleos. Cuatro nucleos modernos son
de sobra; ocho nucleos lentos van peor que cuatro rapidos.

### Disco

- Server pack comprimido: 797 MB (dato verificado).
- Espacio libre recomendado: **15 GB como minimo**. El pack descomprimido, las
  librerias de Forge, el mundo generado y las copias de seguridad crecen
  rapido. La cifra de 15 GB es la que piden los servicios de hosting para este
  pack; el tamano exacto ya instalado **no lo he medido**, asi que tomalo como
  una referencia y no como un dato exacto.
- Un disco SSD reduce mucho el tiempo de la primera arrancada y de la
  generacion de terreno.

### Red

Una conexion domestica normal aguanta bien un grupo pequeno. Lo que suele doler
es la **subida**, no la bajada: cuenta con unos 100 kbit/s de subida por jugador
como referencia aproximada, mas los picos al explorar terreno nuevo.

---

## Opcion A: arrancar con Docker (recomendado)

Es la via mas robusta. La imagen `itzg/minecraft-server` se encarga de bajar el
modpack de CurseForge, instalar Forge y arrancar el servidor sin que tengas que
tocar nada mas.

### Requisitos

- Docker y el plugin Compose instalados
  ([Docker Desktop](https://www.docker.com/products/docker-desktop/) en Windows
  y macOS, `docker` y `docker-compose-plugin` en Linux).
- No necesitas instalar Java: va dentro de la imagen.

### Pasos

1. **Clona el repositorio.**

   ```bash
   git clone https://github.com/gui21657/valhelsia6-server.git
   cd valhelsia6-server
   ```

2. **Crea tu archivo de configuracion.**

   ```bash
   cp .env.example .env
   ```

   En Windows, con `copy .env.example .env`.

3. **Acepta el EULA de Minecraft a mano.** Abre `.env` y cambia:

   ```
   EULA=FALSE
   ```

   por:

   ```
   EULA=TRUE
   ```

   Con esto declaras que has leido y aceptas el
   [EULA de Minecraft](https://aka.ms/MinecraftEULA). Este repositorio no lo
   acepta por ti a proposito: es una decision tuya y tiene efectos legales.

4. **Ajusta la memoria** en el mismo `.env`, segun la tabla de arriba:

   ```
   RAM_INICIAL=4G
   RAM_MAXIMA=8G
   ```

5. **Arranca.**

   ```bash
   docker compose up -d
   ```

6. **Mira el progreso.** La primera vez descarga cientos de megabytes e instala
   Forge. Puede tardar entre diez minutos y media hora.

   ```bash
   docker compose logs -f
   ```

   El servidor esta listo cuando aparece una linea del tipo `Done (…)! For help,
   type "help"`.

7. **Entra desde el cliente.** En Minecraft, con el modpack Valhelsia 6 6.2.3
   instalado (desde el launcher de CurseForge, Prism o similar), anade un
   servidor con la direccion `localhost:25565` si juegas en la misma maquina, o
   la IP de la maquina en tu red local.

### Comandos utiles de Docker

```bash
docker compose logs -f              # ver la consola en vivo
docker compose stop                 # parar el servidor guardando el mundo
docker compose up -d                # volver a arrancarlo
docker compose down                 # parar y borrar el contenedor (el mundo se queda en ./datos)
docker compose exec valhelsia rcon-cli   # consola del servidor para escribir comandos
```

Para dar permisos de operador a un jugador, anadelo a `OPERADORES` en `.env` y
reinicia, o desde `rcon-cli` escribe `op NombreDelJugador`.

---

## Opcion B: arrancar sin Docker

Para quien prefiera instalarlo directamente sobre el sistema.

### Requisitos

- **Java 17 de 64 bits.** Descarga Temurin 17 LTS desde
  [adoptium.net](https://adoptium.net/). Comprueba la version con:

  ```bash
  java -version
  ```

  Tiene que decir `17.algo`. Si dice 8, 21 o 25, no sirve para este pack.

- En Linux o macOS: `curl` y `unzip`.
- En Windows: `curl.exe` y `tar.exe`, que vienen incluidos en Windows 10
  version 1803 y posteriores.

### Pasos

1. **Clona el repositorio** y entra en la carpeta (igual que en la opcion A).

2. **Crea el `.env`** a partir de `.env.example` y pon `EULA=TRUE` a mano, tal
   y como se explica en el paso 3 de la opcion A.

3. **Ajusta `RAM_INICIAL` y `RAM_MAXIMA`** segun la tabla de hardware.

4. **Ejecuta el script.**

   En Linux o macOS:

   ```bash
   chmod +x iniciar.sh
   ./iniciar.sh
   ```

   En Windows, doble clic en `iniciar.bat`, o desde una consola:

   ```
   iniciar.bat
   ```

5. **Espera.** La primera ejecucion hace tres cosas largas: descarga el server
   pack (797 MB), lo descomprime, y ejecuta el instalador oficial de Forge, que
   a su vez descarga Minecraft y sus librerias. A partir de la segunda vez el
   arranque es mucho mas rapido.

6. Cuando veas `Done (…)! For help, type "help"`, el servidor esta funcionando.
   Para detenerlo **escribe `stop` en la consola**. No lo cierres con la X ni
   con Ctrl+C: el mundo puede quedar sin guardar.

Los scripts son idempotentes: si ya descargaron el pack o ya instalaron Forge,
no lo repiten.

---

## Abrir el puerto 25565

Mientras solo juegues en tu red local no hace falta tocar nada. Para que entre
gente desde fuera hay que abrir el puerto en dos sitios distintos.

### 1. El cortafuegos de la maquina

**Windows** (PowerShell como administrador):

```powershell
New-NetFirewallRule -DisplayName "Minecraft Valhelsia 6" -Direction Inbound -Protocol TCP -LocalPort 25565 -Action Allow
```

**Linux con ufw**:

```bash
sudo ufw allow 25565/tcp
```

**Linux con firewalld**:

```bash
sudo firewall-cmd --permanent --add-port=25565/tcp
sudo firewall-cmd --reload
```

Si usas Docker, el contenedor ya publica el puerto; aun asi el cortafuegos del
sistema anfitrion tiene que permitirlo.

### 2. El router (redireccion de puertos)

1. Averigua la IP local de la maquina que aloja el servidor
   (`ipconfig` en Windows, `ip addr` en Linux). Sera algo como `192.168.1.50`.
2. Dale a esa maquina una **IP fija** en el router, o reservala por su direccion
   MAC. Si cambia, la redireccion deja de funcionar sola.
3. Entra en el panel del router (normalmente `192.168.1.1` o `192.168.0.1`).
4. Busca la seccion de *Port Forwarding*, *Redireccion de puertos* o *NAT*.
5. Crea una regla: puerto externo **25565**, puerto interno **25565**, protocolo
   **TCP**, destino la IP local de la maquina.
6. Averigua tu IP publica y comparte esa direccion con los jugadores.

Dos avisos honestos sobre esto:

- **Muchas conexiones domesticas no permiten esto.** Si tu proveedor te da una
  direccion detras de CGNAT, la redireccion de puertos no funcionara por mucho
  que la configures bien. Se reconoce porque la IP que ve el router empieza por
  `100.64.` a `100.127.`, o porque no coincide con la IP publica que te dice
  cualquier pagina de "cual es mi IP".
- **Abrir un puerto expone tu maquina a internet.** Deja `MODO_ONLINE=true` para
  que solo entren cuentas legitimas, y considera activar una lista blanca de
  jugadores.

Si el router no coopera, hay alternativas sin abrir puertos (redes privadas
virtuales tipo Tailscale o ZeroTier, o alquilar un servidor).

---

## Copias de seguridad del mundo

**Haz copias.** Un pack con esta cantidad de mods puede corromper una partida
por una actualizacion mal hecha, y no hay forma de recuperarla sin respaldo.

Lo que hay que guardar es la carpeta del mundo:

- Con Docker: `./datos/world`
- Sin Docker: `./servidor/world`

**Para o el servidor antes de copiar**, o al menos ejecuta `save-off` y
`save-all` desde la consola. Copiar el mundo mientras el servidor escribe en el
produce un respaldo roto que parece bueno hasta que lo necesitas.

### Copia manual, Linux o macOS

```bash
docker compose stop                 # o 'stop' en la consola del servidor
tar -czf "copias/world-$(date +%Y%m%d-%H%M).tar.gz" datos/world
docker compose up -d
```

### Copia manual, Windows (PowerShell)

```powershell
docker compose stop
$fecha = Get-Date -Format "yyyyMMdd-HHmm"
Compress-Archive -Path ".\datos\world" -DestinationPath ".\copias\world-$fecha.zip"
docker compose up -d
```

La carpeta `copias/` esta en el `.gitignore`, asi que no se subira al
repositorio por accidente.

### Consejos

- Guarda al menos una copia **fuera de la maquina** del servidor. Un disco que
  falla se lleva el mundo y las copias que estaban en el mismo disco.
- Conserva varias copias de distintos dias, no solo la ultima. Una corrupcion
  puede pasar desapercibida durante una semana.
- Valhelsia 6 incluye el mod SimpleBackups, que hace copias automaticas dentro
  del propio servidor. Esta bien como red de seguridad, pero **no sustituye** a
  una copia externa: vive en el mismo disco.

---

## Problemas comunes

### El servidor se cierra solo al arrancar y el registro habla de memoria

Sintomas: `java.lang.OutOfMemoryError: Java heap space`, el proceso muere sin
mensaje claro, o el contenedor se reinicia en bucle.

Es falta de RAM. Sube `RAM_MAXIMA` en `.env`, respetando la regla de no pasar de
la mitad de la RAM fisica. Si ya estas en ese limite, el problema es que la
maquina se queda corta para este pack: baja `DISTANCIA_VISION` y
`DISTANCIA_SIMULACION`, o consigue mas memoria.

Ojo con un caso concreto: si asignas mas RAM de la que tiene la maquina, Java a
veces **ni siquiera arranca** y suelta `Error occurred during initialization of
VM`. No es un error del pack.

### Version de Java equivocada

Sintomas: `UnsupportedClassVersionError`, `java.lang.NoSuchMethodError` nada mas
arrancar, o mensajes de Forge quejandose de la version de la maquina virtual.

Este pack necesita **Java 17**. Comprueba con `java -version` que la salida
empieza por `17`. Casos tipicos:

- Tienes Java 8 porque jugabas a packs de 1.12: demasiado viejo, no arranca.
- Tienes Java 21 o 25 porque los instalaste para Minecraft moderno: demasiado
  nuevo, varios mods de este pack fallan al cargar.

Solucion: instala Temurin 17 LTS desde [adoptium.net](https://adoptium.net/) y,
si tienes varias versiones conviviendo, pon la ruta completa al ejecutable en
`RUTA_JAVA` dentro de `.env`, por ejemplo:

```
RUTA_JAVA=C:\Program Files\Eclipse Adoptium\jdk-17.0.11.9-hotspot\bin\java.exe
```

Con Docker esto no te puede pasar: la imagen esta fijada a la etiqueta
`java17` justamente para evitarlo.

### Los mods del cliente y del servidor no coinciden

Sintomas al intentar entrar: `Incompatible mod set!`, una pantalla con una lista
larga de mods en rojo, o `Connection closed - mismatched mod channel list`.

Causa casi siempre la misma: **la version del pack del cliente no es la del
servidor.** Si el servidor corre 6.2.3, el cliente tiene que correr 6.2.3, no
6.2.2 ni la ultima que el launcher haya decidido instalar.

Como resolverlo:

1. Mira que version corre el servidor: es `VERSION_PACK` en tu `.env`.
2. En el launcher, comprueba la version instalada del perfil de Valhelsia 6 y
   cambiala a esa misma.
3. Si has anadido mods por tu cuenta al cliente, quitalos y prueba de nuevo. Un
   mod extra del lado del cliente puede bastar para que el servidor lo rechace.
4. La lista de mods que sale en rojo en la pantalla de error te dice cuales
   sobran o faltan.

Anadir mods al servidor tiene la misma regla al reves: todo mod que no sea
exclusivo del servidor hay que ponerlo tambien en todos los clientes.

### La primera arrancada parece colgada

No lo esta. Entre descargar el pack, descomprimir cientos de archivos e instalar
Forge pueden pasar facilmente veinte o treinta minutos en un disco mecanico.
Mira el registro con `docker compose logs -f` para confirmar que sigue
avanzando.

### La descarga de CurseForge falla

Con Docker, si el registro menciona un limite de peticiones o un error de
autorizacion, saca una clave gratuita en
[console.curseforge.com](https://console.curseforge.com/) y ponla en `CF_API_KEY`
dentro de `.env`. Nunca la escribas en `docker-compose.yml` ni la subas al
repositorio.

Si tu red bloquea la CDN de CurseForge, descarga el server pack a mano desde la
pagina del modpack y dejalo dentro de la carpeta `descargas/`: tanto la imagen
de Docker como los scripts lo detectan y se saltan la descarga.

### El servidor funciona pero va a tirones

- Baja `DISTANCIA_VISION` a 6 y `DISTANCIA_SIMULACION` a 4.
- Valhelsia 6 incluye el mod `spark`. Escribe `/spark profiler` en la consola
  del servidor para ver que esta consumiendo el tiempo de tick.
- Revisa si es la CPU y no la RAM: un solo nucleo al 100 por ciento con memoria
  de sobra apunta al procesador o a una maquina de mods concreta.

### No puedo detener el servidor sin perder cosas

Escribe siempre `stop` en la consola, o `docker compose stop` con Docker. Matar
el proceso deja fragmentos del mundo sin guardar.

---

## Cambiar de version del modpack

1. **Haz una copia de seguridad del mundo primero.** Sin excepciones.
2. Cambia `VERSION_PACK` en `.env`.
3. Con Docker: `docker compose down` y luego `docker compose up -d`. La imagen
   se encarga del resto.
4. Sin Docker: hay que actualizar tambien `URL_SERVER_PACK` a la del server pack
   de la nueva version (el identificador numerico del archivo **no** se deduce
   del numero de version; hay que copiarlo de la pestana Files de CurseForge) y
   `VERSION_FORGE` si la nueva version cambia de Forge. Despues borra la carpeta
   `servidor/` conservando `servidor/world`, y vuelve a ejecutar el script.
5. Actualiza el cliente a la misma version antes de intentar entrar.

---

## Aviso legal

- **Este repositorio no contiene ni redistribuye ningun archivo con copyright.**
  Ni mods, ni el modpack, ni jars de Minecraft o de Forge. Solo hay scripts y
  configuracion, escritos para este repositorio.
- Todo lo que hace falta se descarga en el momento de la instalacion desde sus
  fuentes oficiales: CurseForge para el modpack, el instalador oficial de Forge
  para el cargador, y los servidores de Mojang para Minecraft.
- Valhelsia 6 es obra del [equipo Valhelsia](https://wiki.valhelsia.net/). Los
  mods incluidos pertenecen a sus respectivos autores, cada uno con su propia
  licencia.
- Minecraft es una marca de Mojang Studios y Microsoft. Levantar un servidor
  exige aceptar el [EULA de Minecraft](https://aka.ms/MinecraftEULA), cosa que
  debes hacer tu explicitamente poniendo `EULA=TRUE` en tu archivo `.env`.
- Los scripts y la configuracion de este repositorio se ofrecen sin garantia.

---

## Fuentes

- [Valhelsia 6 en CurseForge](https://www.curseforge.com/minecraft/modpacks/valhelsia-6)
  y [su server pack 6.2.3](https://www.curseforge.com/minecraft/modpacks/valhelsia-6/files/6448193)
- [Wiki oficial de Valhelsia, ficha de Valhelsia 6](https://wiki.valhelsia.net/modpacks/valhelsia-6)
- [Wiki oficial de Valhelsia, guia de montaje de servidor](https://wiki.valhelsia.net/navigation/knowledgebase/server-setup)
- [Wiki oficial de Valhelsia, asignacion de memoria](https://wiki.valhelsia.net/navigation/knowledgebase/allocating-memory)
- Contenido del propio `Valhelsia-6-6.2.3-SERVER.zip`: su `README.txt`, su
  `ServerStart.sh` y el nombre del instalador de Forge que incluye
- [Repositorio de configuracion de Valhelsia 6](https://github.com/ValhelsiaTeam/Valhelsia-6)
- [Documentacion de la imagen itzg/minecraft-server](https://docker-minecraft-server.readthedocs.io/),
  apartados de [modpacks de CurseForge](https://docker-minecraft-server.readthedocs.io/en/latest/types-and-platforms/mod-platforms/auto-curseforge/),
  [opciones de la maquina virtual de Java](https://docker-minecraft-server.readthedocs.io/en/latest/configuration/jvm-options/)
  y [versiones de Java](https://docker-minecraft-server.readthedocs.io/en/latest/versions/java/)
