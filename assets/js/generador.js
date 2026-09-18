/* ==========================================================================
   generador.js - convierte las elecciones en archivos de texto.
   ==========================================================================
   El producto de esta pagina es texto, asi que aqui esta casi todo su valor.
   Dos reglas guian el resultado:

   1. El YAML tiene que ser valido pase lo que pase. El MOTD lo escribe el
      usuario y los nombres de los mods vienen de una API de terceros, asi que
      ningun valor se pega tal cual: todo escalar se escribe entre comillas
      dobles y con los caracteres peligrosos escapados.
   2. Solo se escribe lo que hace falta. Un compose de veinte lineas que se
      entiende vale mas que uno de sesenta repitiendo valores por defecto.
   ========================================================================== */
(function (global) {
  'use strict';

  /* Valores iniciales de los campos. Si el usuario no toca uno, esa variable
     no se escribe en el archivo. Coinciden ademas con los valores por defecto
     de Minecraft en los casos en que existe uno (distancias a 10, mundo
     "world", modo supervivencia, modo en linea activado). */
  var INICIALES = {
    modoJuego: 'survival',
    distanciaVision: 10,
    distanciaSimulacion: 10,
    mundo: 'world',
    operadores: '',
    modoOnline: true
  };

  /* ----------------------------- Escapado YAML ----------------------------- */

  // Comillas dobles siempre. Es la unica forma de escalar que admite cualquier
  // contenido en YAML 1.1 y 1.2 sin tener que razonar sobre el valor: dos
  // puntos, almohadillas, llaves, un "yes" suelto o una cadena vacia.
  function esc(valor) {
    var s = String(valor === null || valor === undefined ? '' : valor);
    var salida = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      var cod = s.charCodeAt(i);
      if (c === '\\') salida += '\\\\';
      else if (c === '"') salida += '\\"';
      else if (c === '\n') salida += '\\n';
      else if (c === '\r') salida += '\\r';
      else if (c === '\t') salida += '\\t';
      else if (cod < 0x20 || cod === 0x7f) salida += '\\x' + ('0' + cod.toString(16)).slice(-2);
      else salida += c;
    }
    return '"' + salida + '"';
  }

  /* Docker Compose interpola el archivo ANTES de entregarselo a Docker: un
     "${FOO}" o un "$" sueltos dentro de un valor se sustituyen por una variable
     del entorno, o hacen fallar el arranque. Todo lo que escribe el usuario, y
     todo lo que llega de la API, pasa por aqui: la forma de escribir un dolar
     literal en Compose es duplicarlo.
     Los "${PUERTO:-25565}" y demas son referencias nuestras y deliberadas, asi
     que esos se escriben con esc() y no por aqui. */
  function escUsuario(valor) {
    return esc(String(valor === null || valor === undefined ? '' : valor).replace(/\$/g, '$$$$'));
  }

  // Los identificadores de Modrinth admiten letras, numeros y unos pocos
  // signos. Se filtra igualmente antes de meterlos en el bloque de texto:
  // aunque hoy la API no devuelva nada raro, el dato es de terceros.
  function slugSeguro(s) {
    return String(s || '').replace(/[^A-Za-z0-9._!@$()+-]/g, '');
  }

  // El mismo identificador, listo para ir dentro del YAML (dolar duplicado).
  function slugParaYaml(s) {
    return slugSeguro(s).replace(/\$/g, '$$$$');
  }

  function aleatorio(largo) {
    var alfabeto = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var salida = '';
    var bytes = new Uint8Array(largo);
    (global.crypto || global.msCrypto).getRandomValues(bytes);
    for (var i = 0; i < largo; i++) salida += alfabeto[bytes[i] % alfabeto.length];
    return salida;
  }

  /* ----------------------------- docker-compose ---------------------------- */

  function construirCompose(cfg) {
    var L = [];
    var esMods = cfg.cargador.modrinthTipo === 'mod';
    var palabra = cfg.cargador.palabra || 'mods';
    var mp = cfg.modpack || null;

    L.push('# ' + '='.repeat(74));
    if (mp) {
      L.push('# Servidor de Minecraft ' + cfg.version + ' con el modpack ' + textoPlano(mp.nombre));
    } else {
      L.push('# Servidor de Minecraft ' + cfg.version + ' con ' + cfg.cargador.nombre);
    }
    L.push('# Generado por https://originservers.github.io/');
    L.push('#');
    L.push('# Este archivo no contiene ningun archivo con derechos de autor: la imagen');
    if (mp) {
      L.push('# descarga el modpack, el cargador y todos sus mods en el primer arranque,');
    } else {
      L.push('# descarga el servidor' + (cfg.mods.length ? ', el cargador y los ' + palabra : ' y el cargador') +
             ' en el primer arranque,');
    }
    L.push('# desde las fuentes oficiales de cada proyecto.');
    L.push('#');
    L.push('# Al usar esta configuracion aceptas el contrato de licencia de Minecraft:');
    L.push('# https://aka.ms/MinecraftEULA');
    L.push('# ' + '='.repeat(74));
    L.push('');
    L.push('services:');
    L.push('  minecraft:');
    L.push('    # La version de Java no es una variable: se elige por etiqueta de imagen.');
    L.push('    # ' + textoPlano(cfg.javaMotivo));
    L.push('    image: ' + esc('itzg/minecraft-server:' + cfg.etiquetaJava));
    L.push('    # El nombre fijo hace que los comandos de abajo funcionen tal cual.');
    L.push('    # Si vas a levantar dos servidores en la misma maquina, cambialo: los');
    L.push('    # nombres de contenedor son unicos en todo Docker.');
    L.push('    container_name: ' + esc(cfg.nombreContenedor));
    L.push('    restart: ' + esc('unless-stopped'));
    L.push('    # Hacen falta para poder abrir la consola del servidor con docker attach.');
    L.push('    tty: true');
    L.push('    stdin_open: true');
    L.push('');
    L.push('    ports:');
    L.push('      # Solo se cambia el lado de fuera. Dentro sigue siendo el 25565, que es');
    L.push('      # lo que espera el cliente del juego.');
    L.push('      - ' + esc('${PUERTO:-25565}:25565'));
    L.push('');
    L.push('    environment:');
    L.push('      # Continuar es aceptar: si levantas este servidor declaras que leiste');
    L.push('      # y aceptas el contrato de licencia de Minecraft. Se lee del .env; si');
    L.push('      # no lo aceptas, ponlo en FALSE ahi y el servidor no arrancara.');
    L.push('      EULA: ' + esc('${EULA:-TRUE}'));
    L.push('');

    if (mp) {
      /* Rama de modpack. Lo que NO se escribe aqui importa tanto como lo que si:

         - No se escribe TYPE. La imagen lo trae como VANILLA de fabrica, y su
           script start-configuration avisa ("Avoid setting TYPE and
           MODPACK_PLATFORM") en cuanto TYPE vale otra cosa junto a un modpack.
           Peor aun: con un modpack, TYPE deja de significar cargador. Un
           TYPE: FABRIC al lado de un modpack de NeoForge no da error, se
           ignora, y deja al usuario convencido de que eligio Fabric.
         - No se escribe VERSION. La imagen la convierte en --game-version, que
           es un filtro de BUSQUEDA sobre las versiones publicadas del modpack,
           no un ajuste del servidor. Si el filtro no casa con ninguna, el
           contenedor falla al arrancar. Abajo se fija la version exacta, que
           hace ese filtro innecesario.
         - No se escribe MODRINTH_LOADER, por lo mismo: es otro filtro, y su
           documentacion solo admite forge, fabric y quilt (NeoForge no
           aparece), asi que escribirlo solo puede restar. */
      L.push('      # ---- Modpack ----');
      L.push('      # El modpack manda: la version de Minecraft y el cargador salen de dentro');
      L.push('      # del propio archivo .mrpack, no de aqui. Por eso no se escriben TYPE ni');
      L.push('      # VERSION: serian filtros de busqueda y, si no casaran con lo que el');
      L.push('      # modpack publica, el contenedor fallaria al arrancar.');
      L.push('      MODPACK_PLATFORM: ' + esc('MODRINTH'));
      L.push('      MODRINTH_MODPACK: ' + esc(slugParaYaml(mp.slug)));
      L.push('      # Version exacta, fijada por identificador. Esta pagina comprobo contra la');
      L.push('      # API de Modrinth que ese archivo existe para ' + textoPlano(mp.cargadorNombre) +
             ' y Minecraft ' + textoPlano(mp.minecraft) + ':');
      L.push('      # es ' + textoPlano(mp.versionNumero) + '. Si prefieres que se actualice solo,');
      L.push('      # borra esta linea; a cambio pierdes la garantia de que la combinacion casa.');
      L.push('      MODRINTH_VERSION: ' + esc(slugParaYaml(mp.versionId)));
      if (!mp.estable) {
        L.push('      # La version fijada no es estable, asi que hay que permitir su canal.');
        L.push('      MODRINTH_MODPACK_VERSION_TYPE: ' + esc(mp.versionTipo));
      }
      L.push('');
    } else {
      L.push('      TYPE: ' + esc(cfg.tipo));
      L.push('      VERSION: ' + esc(cfg.version));

      if (cfg.avisoCargador) {
        L.push('      # ' + cfg.avisoCargador);
      }
      L.push('      # La version del cargador la resuelve la imagen sola. Fijarla a mano es');
      L.push('      # la causa mas comun de que un servidor no arranque.');
      L.push('');
    }
    L.push('      # Memoria del monton de Java. Deja siempre unos 2 GB libres para el sistema.');
    if (mp) {
      L.push('      # La documentacion de la imagen recomienda al menos 4G para cualquier');
      L.push('      # modpack, porque el valor de fabrica es 1G y no le basta a ninguno.');
      L.push('      # Cuanta hace falta EXACTAMENTE para este modpack no lo dice nadie: la API');
      L.push('      # de Modrinth no publica ningun dato de memoria. Subelo si va a tirones.');
    }
    L.push('      MEMORY: ' + esc('${MEMORIA:-' + cfg.memoria + '}'));
    if (cfg.aikar) {
      L.push('      # Ajustes del recolector de basura documentados por PaperMC:');
      L.push('      # https://docs.papermc.io/paper/aikars-flags');
      L.push('      USE_AIKAR_FLAGS: ' + esc('true'));
    }
    L.push('');
    L.push('      # ---- Ajustes de la partida (server.properties) ----');
    L.push('      DIFFICULTY: ' + esc(cfg.dificultad));
    L.push('      MOTD: ' + escUsuario(cfg.motd));
    L.push('      MAX_PLAYERS: ' + esc(String(cfg.maxJugadores)));

    if (cfg.modoJuego !== INICIALES.modoJuego) {
      L.push('      MODE: ' + esc(cfg.modoJuego));
    }
    if (cfg.distanciaVision !== INICIALES.distanciaVision) {
      L.push('      VIEW_DISTANCE: ' + esc(String(cfg.distanciaVision)));
    }
    if (cfg.distanciaSimulacion !== INICIALES.distanciaSimulacion) {
      L.push('      SIMULATION_DISTANCE: ' + esc(String(cfg.distanciaSimulacion)));
    }
    if (cfg.mundo !== INICIALES.mundo) {
      L.push('      LEVEL: ' + escUsuario(cfg.mundo));
    }
    if (cfg.operadores) {
      L.push('      OPS: ' + escUsuario(cfg.operadores));
    }
    if (cfg.modoOnline !== INICIALES.modoOnline) {
      L.push('      # Desactivado a peticion tuya: cualquiera puede entrar con cualquier');
      L.push('      # nombre. No lo dejes asi en un servidor abierto a internet.');
      L.push('      ONLINE_MODE: ' + esc('false'));
    }
    L.push('      TZ: ' + esc('${ZONA_HORARIA:-UTC}'));

    if (cfg.copias) {
      L.push('');
      L.push('      # RCON viene activado de fabrica con una contrasena distinta en cada');
      L.push('      # arranque. El contenedor de copias necesita una fija, asi que se');
      L.push('      # define en .env. El puerto 25575 NO se publica hacia fuera.');
      L.push('      RCON_PASSWORD: ' + esc('${RCON_PASSWORD:?falta RCON_PASSWORD en el archivo .env}'));
    }

    // Con un modpack no se escribe MODRINTH_PROJECTS: el .mrpack ya trae su
    // propia lista de mods, y anadir mas encima mezcla versiones que no tienen
    // por que casar entre si. La interfaz ya impide elegir las dos cosas.
    if (!mp && cfg.mods.length) {
      L.push('');
      L.push('      # ---- ' + (esMods ? 'Mods' : 'Plugins') + ' ----');
      L.push('      # La imagen los busca y los descarga de Modrinth en cada arranque,');
      L.push('      # eligiendo la version que corresponde al TYPE y la VERSION de arriba.');
      L.push('      # Quitar una linea de esta lista BORRA ese ' + (esMods ? 'mod' : 'plugin') + ' del servidor.');
      L.push('      #');
      cfg.mods.forEach(function (m) {
        // Los nombres visibles van en comentarios AQUI y no dentro del bloque de
        // texto de abajo: en un escalar de bloque de YAML la almohadilla no abre
        // un comentario, es un caracter mas, y la imagen intentaria descargarse
        // un proyecto llamado "sodium # Sodium".
        L.push('      #   ' + slugSeguro(m.slug) + ' = ' + textoPlano(m.nombre));
      });
      L.push('      MODRINTH_PROJECTS: |-');
      cfg.mods.forEach(function (m) {
        // Se escribe el identificador, no el nombre visible.
        L.push('        ' + slugParaYaml(m.slug));
      });
      if (cfg.depsModrinth) {
        L.push('      # Descarga tambien las dependencias obligatorias que falten.');
        L.push('      MODRINTH_DOWNLOAD_DEPENDENCIES: ' + esc('required'));
      }
    }

    L.push('');
    L.push('    volumes:');
    L.push('      # El mundo, la configuracion y lo descargado viven aqui. Sin esta linea');
    L.push('      # Docker crearia un volumen anonimo que se borra con el contenedor.');
    L.push('      # En SELinux, Podman o contenedores sin root, anade :Z al final.');
    L.push('      - ' + esc('./datos:/data'));
    L.push('');
    L.push('    healthcheck:');
    L.push('      test: [' + esc('CMD') + ', ' + esc('mc-health') + ']');
    L.push('      # El primer arranque descarga el servidor' +
           (mp ? ', el modpack entero y todos sus mods' : (cfg.mods.length ? ' y los ' + palabra : '')) +
           ' y puede tardar mucho.');
    // Un modpack son cientos de archivos: el margen de un servidor pelado
    // marcaria el contenedor como enfermo antes de que termine de instalar.
    L.push('      start_period: ' + esc(mp ? '20m' : (cfg.mods.length ? '10m' : '3m')));
    L.push('      interval: ' + esc('30s'));
    L.push('      timeout: ' + esc('20s'));
    L.push('      retries: 10');

    if (cfg.copias) {
      L.push('');
      L.push('  # ------------------------------------------------------------------------');
      L.push('  # Copias de seguridad. Se conecta por RCON para pausar la escritura del');
      L.push('  # mundo mientras copia, de modo que la copia no sale a medias.');
      L.push('  # ------------------------------------------------------------------------');
      L.push('  copias:');
      L.push('    image: ' + esc('itzg/mc-backup'));
      L.push('    container_name: ' + esc(cfg.nombreContenedor + '-copias'));
      L.push('    restart: ' + esc('unless-stopped'));
      L.push('    environment:');
      L.push('      RCON_HOST: ' + esc('minecraft'));
      L.push('      RCON_PASSWORD: ' + esc('${RCON_PASSWORD:?falta RCON_PASSWORD en el archivo .env}'));
      L.push('      BACKUP_INTERVAL: ' + esc('24h'));
      L.push('      PRUNE_BACKUPS_DAYS: ' + esc('7'));
      L.push('      # No copia una y otra vez un mundo en el que no ha entrado nadie.');
      L.push('      PAUSE_IF_NO_PLAYERS: ' + esc('true'));
      L.push('    volumes:');
      L.push('      # Solo lectura: este contenedor no debe poder tocar el mundo.');
      L.push('      - ' + esc('./datos:/data:ro'));
      L.push('      - ' + esc('./copias:/backups'));
      L.push('    depends_on:');
      L.push('      minecraft:');
      L.push('        condition: ' + esc('service_healthy'));
    }

    L.push('');
    return L.join('\n');
  }

  // Quita saltos de linea y caracteres de control de un texto que va a acabar
  // dentro de un comentario de YAML.
  function textoPlano(s) {
    return String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').trim();
  }

  /* ---------------------------------- .env --------------------------------- */

  function construirEnv(cfg) {
    var L = [];
    L.push('# ' + '='.repeat(74));
    L.push('# Variables de tu servidor. Este archivo va junto al docker-compose.yml.');
    L.push('# Nunca lo subas a un repositorio publico: aqui viven las contrasenas.');
    L.push('# ' + '='.repeat(74));
    L.push('');
    L.push('# ---- EULA ----');
    L.push('# Viene en TRUE. Si continuas y levantas este servidor, estas declarando');
    L.push('# que leiste y aceptas el contrato de licencia de Minecraft:');
    L.push('# https://aka.ms/MinecraftEULA');
    L.push('# Si no lo aceptas, cambialo a FALSE y el servidor no arrancara.');
    L.push('EULA=TRUE');
    L.push('');
    L.push('# ---- Red ----');
    L.push('# Puerto en tu maquina. Los jugadores se conectan a tu-direccion:' + cfg.puerto);
    L.push('PUERTO=' + cfg.puerto);
    L.push('');
    L.push('# ---- Memoria ----');
    L.push('# Monton de Java. Sube esto si el servidor va a tirones con muchos mods,');
    L.push('# pero nunca por encima de la memoria fisica menos 2 GB.');
    if (cfg.modpack) {
      L.push('# La documentacion de la imagen recomienda 4G como minimo para un modpack.');
      L.push('# Cuanta necesita este en concreto no lo publica nadie: no es un dato que');
      L.push('# exista en la API de Modrinth. Si va a tirones, sube de gigabyte en gigabyte.');
    }
    L.push('MEMORIA=' + cfg.memoria);
    L.push('');
    L.push('# ---- Zona horaria ----');
    L.push('# Para que la hora de los registros coincida con la tuya. Es un nombre de zona');
    L.push('# IANA (region/ciudad); fija el reloj DENTRO del contenedor y nada mas.');
    L.push('ZONA_HORARIA=' + cfg.zonaHoraria);

    if (cfg.copias) {
      L.push('');
      L.push('# ---- RCON ----');
      L.push('# La usa el contenedor de copias para hablar con el servidor. Se genero al');
      L.push('# azar en tu navegador; cambiala si quieres. El puerto de RCON no se publica');
      L.push('# hacia fuera, asi que solo es accesible desde los propios contenedores.');
      L.push('RCON_PASSWORD=' + cfg.rconPassword);
    }

    L.push('');
    return L.join('\n');
  }

  /* -------------------------------- Comandos ------------------------------- */

  function construirComandos(cfg) {
    var n = cfg.nombreContenedor;
    var L = [];
    L.push('# 1. Crea una carpeta para el servidor y entra en ella');
    L.push('mkdir servidor-minecraft');
    L.push('cd servidor-minecraft');
    L.push('');
    L.push('# 2. Guarda dentro los dos archivos de arriba: docker-compose.yml y .env');
    L.push('');
    L.push('# 3. Arranca. Al hacerlo aceptas el EULA de Minecraft (viene en TRUE en el');
    L.push('#    .env). La primera vez descarga todo y tarda bastante.');
    L.push('docker compose up -d');
    L.push('');
    L.push('# 5. Mira que va pasando mientras arranca (Control+C para salir del registro)');
    L.push('docker compose logs -f');
    L.push('');
    L.push('# 6. Comprueba que ya esta listo: debe decir "healthy"');
    L.push('docker compose ps');
    L.push('');
    L.push('# 7. Entra al juego: Multijugador, Anadir servidor, direccion');
    L.push('#    localhost:' + cfg.puerto + '   desde la misma maquina');
    L.push('#    TU-IP-LOCAL:' + cfg.puerto + '   desde otro equipo de tu red');
    L.push('');
    L.push('# ---- Mantenimiento ----');
    L.push('');
    L.push('# Consola del servidor (escribe "help" y pulsa enter)');
    L.push('docker exec -i ' + n + ' rcon-cli');
    L.push('');
    L.push('# Un solo comando sin abrir la consola');
    L.push('docker exec ' + n + ' rcon-cli list');
    L.push('');
    L.push('# Parar el servidor sin perder nada');
    L.push('docker compose down');
    L.push('');
    L.push('# Aplicar cambios del docker-compose.yml (por ejemplo al anadir mods)');
    L.push('docker compose up -d');

    if (cfg.copias) {
      L.push('');
      L.push('# Forzar una copia de seguridad ahora mismo');
      L.push('docker exec ' + n + '-copias backup now');
      L.push('');
      L.push('# Ver las copias que ya existen');
      L.push('ls -lh copias/');
    }

    L.push('');
    return L.join('\n');
  }

  /* -------------------------------- LEEME.txt ------------------------------ */

  /* El tercer archivo del ZIP. El docker-compose.yml y el .env se explican
     solos con sus comentarios, pero un ZIP se abre muchas veces dias despues
     de generarlo, cuando ya no se recuerda de donde salio ni que se eligio.
     Este archivo responde a eso y repite los comandos, para no tener que
     volver a la pagina. */
  function construirLeeme(cfg) {
    var L = [];
    var mp = cfg.modpack || null;
    var raya = '='.repeat(74);

    L.push(raya);
    L.push('  SERVIDOR DE MINECRAFT - INSTRUCCIONES');
    L.push('  Generado en https://originservers.github.io/');
    L.push(raya);
    L.push('');
    L.push('Este ZIP trae tres archivos:');
    L.push('');
    L.push('  docker-compose.yml   La definicion del servidor. Va comentado linea a linea.');
    L.push('  .env                 Tus valores: puerto, memoria, zona horaria y contrasenas.');
    L.push('  LEEME.txt            Este archivo.');
    L.push('');
    L.push('Descomprimelos los tres JUNTOS en una carpeta vacia. El docker-compose.yml lee');
    L.push('el .env del mismo directorio, asi que separarlos rompe la configuracion.');
    L.push('');
    L.push(raya);
    L.push('  LO QUE ELEGISTE');
    L.push(raya);
    L.push('');
    L.push('  Minecraft:        ' + cfg.version);
    L.push('  Cargador:         ' + cfg.cargador.nombre);
    L.push('  Imagen de Docker: itzg/minecraft-server:' + cfg.etiquetaJava);
    L.push('  Por que ese Java: ' + textoPlano(cfg.javaMotivo));
    L.push('  Memoria:          ' + cfg.memoria);
    L.push('  Puerto:           ' + cfg.puerto);
    L.push('  Zona horaria:     ' + cfg.zonaHoraria);

    if (mp) {
      L.push('');
      L.push('  Modpack:          ' + textoPlano(mp.nombre) + '  (' + slugSeguro(mp.slug) + ')');
      L.push('  Version fijada:   ' + textoPlano(mp.versionNumero) + '   id ' + slugSeguro(mp.versionId));
      L.push('');
      L.push('  La version del modpack va fijada por identificador a proposito. Esta pagina');
      L.push('  comprobo contra la API de Modrinth que ese archivo existe para ' + textoPlano(mp.cargadorNombre));
      L.push('  y Minecraft ' + textoPlano(mp.minecraft) + ', asi que el modpack no puede quedar');
      L.push('  descolocado respecto del cargador. A cambio no se actualiza solo: para eso hay');
      L.push('  que borrar la linea MODRINTH_VERSION del docker-compose.yml.');
      if (mp.exigeCliente) {
        L.push('');
        L.push('  IMPORTANTE: cada jugador tiene que instalar este mismo modpack en su');
        L.push('  lanzador para poder entrar. Un modpack no es solo cosa del servidor.');
      }
    } else if (cfg.mods.length) {
      var titulo = cfg.cargador.modrinthTipo === 'plugin' ? 'Plugins' : 'Mods';
      L.push('');
      L.push('  ' + titulo + ' (' + cfg.mods.length + '):');
      cfg.mods.forEach(function (m) {
        L.push('    - ' + slugSeguro(m.slug) + '   ' + textoPlano(m.nombre));
      });
    }

    L.push('');
    L.push(raya);
    L.push('  ANTES DE EMPEZAR');
    L.push(raya);
    L.push('');
    L.push('Hace falta Docker con el complemento Compose:  https://docs.docker.com/get-docker/');
    L.push('No hace falta instalar Java: va dentro de la imagen.');
    L.push('');
    L.push('EULA: el .env viene con EULA=TRUE. Al levantar el servidor declaras que leiste y');
    L.push('aceptas el contrato de licencia de Minecraft (https://aka.ms/MinecraftEULA).');
    L.push('Si no lo aceptas, cambialo a FALSE y el servidor no arrancara.');
    L.push('');
    L.push(raya);
    L.push('  COMANDOS');
    L.push(raya);
    L.push('');
    L.push(construirComandos(cfg).replace(/\s+$/, ''));
    L.push('');
    L.push(raya);
    L.push('  AVISOS');
    L.push(raya);
    L.push('');
    L.push('Minecraft es una marca registrada de Mojang Synergies AB y Microsoft. La pagina');
    L.push('que genero estos archivos no esta afiliada ni respaldada por Mojang, Microsoft,');
    L.push('Modrinth, itzg, PaperMC, PurpurMC, MinecraftForge, NeoForged, FabricMC ni QuiltMC.');
    L.push('');
    L.push('Aqui no hay ningun archivo con derechos de autor: esto es texto de configuracion.');
    L.push('El servidor, el cargador y los mods los descarga tu propio contenedor en el');
    L.push('primer arranque, desde las fuentes oficiales de cada proyecto.');
    L.push('');
    L.push('No subas el .env a un repositorio publico: ahi viven tus contrasenas.');
    L.push('');
    return L.join('\n');
  }

  /* ------------------------------- Resaltado ------------------------------- */

  /* Se construye nodo a nodo con textContent. Nunca innerHTML: por aqui pasan
     el MOTD que escribe el usuario y los nombres de los mods que devuelve
     Modrinth, y son texto de terceros. */
  function tramo(clase, texto) {
    var s = document.createElement('span');
    if (clase) s.className = clase;
    s.textContent = texto;
    return s;
  }

  function resaltarYaml(texto) {
    var frag = document.createDocumentFragment();
    texto.split('\n').forEach(function (linea, i) {
      if (i) frag.appendChild(document.createTextNode('\n'));
      frag.appendChild(resaltarLinea(linea));
    });
    return frag;
  }

  function resaltarLinea(linea) {
    var trozo = document.createDocumentFragment();

    var comentario = linea.match(/^(\s*)(#.*)$/);
    if (comentario) {
      trozo.appendChild(document.createTextNode(comentario[1]));
      trozo.appendChild(tramo('y-com', comentario[2]));
      return trozo;
    }

    var guion = linea.match(/^(\s*)-\s(.*)$/);
    if (guion) {
      trozo.appendChild(document.createTextNode(guion[1]));
      trozo.appendChild(tramo('y-gui', '- '));
      trozo.appendChild(valorResaltado(guion[2]));
      return trozo;
    }

    var clave = linea.match(/^(\s*)([A-Za-z_][\w.-]*):(\s*)(.*)$/);
    if (clave) {
      trozo.appendChild(document.createTextNode(clave[1]));
      trozo.appendChild(tramo('y-cla', clave[2]));
      trozo.appendChild(document.createTextNode(':' + clave[3]));
      if (clave[4]) trozo.appendChild(valorResaltado(clave[4]));
      return trozo;
    }

    trozo.appendChild(tramo('y-val', linea));
    return trozo;
  }

  function valorResaltado(valor) {
    var frag = document.createDocumentFragment();
    // Un valor puede llevar un comentario detras, como en la lista de mods.
    var conComentario = valor.match(/^(.*?)(\s+#.*)$/);
    var cuerpo = conComentario ? conComentario[1] : valor;

    if (/^(true|false|null|\d+)$/.test(cuerpo.trim())) {
      frag.appendChild(tramo('y-num', cuerpo));
    } else {
      frag.appendChild(tramo('y-val', cuerpo));
    }
    if (conComentario) frag.appendChild(tramo('y-com', conComentario[2]));
    return frag;
  }

  function resaltarShell(texto) {
    var frag = document.createDocumentFragment();
    texto.split('\n').forEach(function (linea, i) {
      if (i) frag.appendChild(document.createTextNode('\n'));
      if (/^\s*#/.test(linea)) {
        frag.appendChild(tramo('y-com', linea));
      } else {
        var env = linea.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (env) {
          frag.appendChild(tramo('y-cla', env[1]));
          frag.appendChild(document.createTextNode('='));
          frag.appendChild(tramo('y-val', env[2]));
        } else {
          frag.appendChild(document.createTextNode(linea));
        }
      }
    });
    return frag;
  }

  global.GM.generador = {
    INICIALES: INICIALES,
    esc: esc,
    escUsuario: escUsuario,
    slugSeguro: slugSeguro,
    aleatorio: aleatorio,
    construirCompose: construirCompose,
    construirEnv: construirEnv,
    construirComandos: construirComandos,
    construirLeeme: construirLeeme,
    resaltarYaml: resaltarYaml,
    resaltarShell: resaltarShell
  };
})(window);
