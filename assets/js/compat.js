/* ==========================================================================
   compat.js - que cargador existe de verdad para que version, y con que Java.
   ==========================================================================
   Aqui no hay ninguna tabla de compatibilidad escrita a mano. Todo sale de
   consultar en vivo los repositorios de cada proyecto, porque este dato caduca
   en semanas: hoy mismo Forge todavia no tiene nada para Minecraft 26.3 y
   NeoForge solo tiene versiones beta. Dejarlo fijo en el codigo garantizaria
   que la pagina mienta dentro de un mes.
   ========================================================================== */
(function (global) {
  'use strict';

  var api = global.GM.api;

  /* Catalogo de cargadores que se ofrecen.
     Se dejan fuera a proposito:
     - BUKKIT y SPIGOT, porque la propia documentacion de la imagen avisa de que
       getbukkit.org ya no admite descargas automatizadas y recomienda Paper.
     - Los hibridos (Mohist, Magma, Arclight...) y los servidores de nicho:
       varios estan semiabandonados y generarian configuraciones que fallan. */
  var CARGADORES = [
    {
      id: 'VANILLA', nombre: 'Vanilla', clave: 'vanilla',
      desc: 'El servidor oficial de Mojang, sin mods ni plugins.',
      modrinthCargador: null, modrinthTipo: null, admiteExtras: false
    },
    {
      id: 'PAPER', nombre: 'Paper', clave: 'paper',
      desc: 'Sin mods, pero con plugins. Optimizado; es el estandar para servidores de supervivencia.',
      modrinthCargador: 'paper', modrinthTipo: 'plugin', admiteExtras: true, palabra: 'plugins'
    },
    {
      id: 'PURPUR', nombre: 'Purpur', clave: 'purpur',
      desc: 'Derivado de Paper con mas opciones de configuracion. Admite los mismos plugins.',
      modrinthCargador: 'purpur', modrinthTipo: 'plugin', admiteExtras: true, palabra: 'plugins'
    },
    {
      id: 'FABRIC', nombre: 'Fabric', clave: 'fabric',
      desc: 'Cargador de mods ligero. Suele ser el primero en llegar a cada version nueva.',
      modrinthCargador: 'fabric', modrinthTipo: 'mod', admiteExtras: true, palabra: 'mods'
    },
    {
      id: 'NEOFORGE', nombre: 'NeoForge', clave: 'neoforge',
      desc: 'Continuacion de Forge. Es el cargador con mas mods de 1.21.1 en adelante.',
      modrinthCargador: 'neoforge', modrinthTipo: 'mod', admiteExtras: true, palabra: 'mods'
    },
    {
      id: 'FORGE', nombre: 'Forge', clave: 'forge',
      desc: 'El cargador clasico. Sigue siendo el que mas mods tiene en 1.20.1 y anteriores.',
      modrinthCargador: 'forge', modrinthTipo: 'mod', admiteExtras: true, palabra: 'mods'
    },
    {
      id: 'QUILT', nombre: 'Quilt', clave: 'quilt',
      desc: 'Derivado de Fabric, todavia en beta. Casi todos los mods salen antes en Fabric.',
      modrinthCargador: 'quilt', modrinthTipo: 'mod', admiteExtras: true, palabra: 'mods',
      // Aviso permanente y verificado: las Quilt Standard Libraries se
      // descontinuaron en diciembre de 2025 y el cargador lleva en beta desde
      // abril de 2022. Se ofrece, pero nunca como opcion recomendada.
      reservas: 'Quilt sigue en beta y sus librerias estandar estan descontinuadas. Elige Fabric si dudas.'
    }
  ];

  function porClave(clave) {
    for (var i = 0; i < CARGADORES.length; i++) {
      if (CARGADORES[i].clave === clave) return CARGADORES[i];
    }
    return null;
  }

  /* Descarga en paralelo todos los catalogos. Si alguno falla, la pagina puede
     seguir: cada cargador se marca como "no se pudo comprobar" en vez de
     tumbar la pantalla entera. */
  function cargarCatalogos() {
    function tolerante(promesa) {
      return promesa.then(
        function (v) { return { ok: true, valor: v }; },
        function (e) { return { ok: false, error: e }; }
      );
    }

    return Promise.all([
      api.versionesMinecraft(),           // esta si es obligatoria
      tolerante(api.fabricVersiones()),
      tolerante(api.quiltVersiones()),
      tolerante(api.forgeVersiones()),
      tolerante(api.neoforgeVersiones()),
      tolerante(api.paperVersiones()),
      tolerante(api.purpurVersiones())
    ]).then(function (r) {
      return {
        minecraft: r[0],
        fabric: r[1], quilt: r[2], forge: r[3],
        neoforge: r[4], paper: r[5], purpur: r[6]
      };
    });
  }

  /* Estado de un cargador para una version concreta.
     Devuelve { estado, texto, build }, con estado en:
       'si'       disponible y estable
       'beta'     existe, pero solo en version de prueba
       'no'       no existe para esa version
       'duda'     no se pudo comprobar (el catalogo de ese proyecto fallo) */
  function estadoDe(clave, version, cat) {
    var meta = porClave(clave);
    if (!meta) return { estado: 'no', texto: 'Cargador desconocido.' };

    if (clave === 'vanilla') {
      return { estado: 'si', texto: 'Disponible. Es el servidor oficial de Mojang.' };
    }

    var fuente = cat[clave];
    if (!fuente || !fuente.ok) {
      return {
        estado: 'duda',
        texto: 'No se pudo consultar el catalogo de ' + meta.nombre + '. Intenta recargar.'
      };
    }
    var datos = fuente.valor;

    if (clave === 'fabric' || clave === 'quilt' || clave === 'purpur') {
      var hay = datos.indexOf(version) !== -1;
      if (!hay) {
        return {
          estado: 'no',
          texto: meta.nombre + ' no publica todavia una version estable para Minecraft ' + version + '.'
        };
      }
      return { estado: 'si', texto: 'Disponible para Minecraft ' + version + '.' };
    }

    if (clave === 'paper') {
      // El canal de la build se consulta aparte; aqui solo se sabe si existe.
      if (datos.indexOf(version) === -1) {
        return { estado: 'no', texto: 'Paper no tiene compilaciones para Minecraft ' + version + '.' };
      }
      return { estado: 'si', texto: 'Disponible para Minecraft ' + version + '.' };
    }

    if (clave === 'forge' || clave === 'neoforge') {
      var builds = datos[version];
      if (!builds || !builds.length) {
        var motivo = clave === 'forge'
          ? 'Forge no tiene ninguna compilacion publicada para Minecraft ' + version + '.'
          : 'NeoForge no tiene ninguna compilacion publicada para Minecraft ' + version + '.';
        return { estado: 'no', texto: motivo };
      }
      var estables = builds.filter(function (b) { return !b.beta; });
      if (estables.length) {
        return {
          estado: 'si',
          texto: 'Disponible. ' + builds.length + ' compilaciones publicadas para esta version.',
          build: ultima(estables)
        };
      }
      return {
        estado: 'beta',
        texto: 'Solo hay compilaciones de prueba (beta) para Minecraft ' + version + '. Puede fallar o cambiar.',
        build: ultima(builds)
      };
    }

    return { estado: 'duda', texto: 'Sin datos.' };
  }

  // La compilacion "mas alta" de una lista. Se comparan los numeros parte por
  // parte porque un orden alfabetico pondria la 9 por encima de la 10.
  function ultima(builds) {
    var copia = builds.slice();
    copia.sort(function (a, b) { return compararNumerico(a.build, b.build); });
    return copia[copia.length - 1].version;
  }

  function compararNumerico(a, b) {
    var pa = String(a).split(/[.\-+]/), pb = String(b).split(/[.\-+]/);
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var na = parseInt(pa[i], 10), nb = parseInt(pb[i], 10);
      var va = isNaN(na) ? -1 : na, vb = isNaN(nb) ? -1 : nb;
      if (va !== vb) return va - vb;
    }
    return 0;
  }

  /* Comparacion de versiones de Minecraft.
     Se usa la POSICION en el manifiesto de Mojang, que ya viene de la mas nueva
     a la mas vieja, en vez de comparar numeros. Es lo unico que sobrevive al
     cambio de numeracion: 26.3 es posterior a 1.21.11, pero cualquier
     comparador aritmetico diria lo contrario. */
  function esAnteriorA(version, referencia, mc) {
    var a = mc.indice[version], b = mc.indice[referencia];
    if (a === undefined || b === undefined) return false;
    return a > b;
  }

  /* Etiqueta de imagen de Docker. La version de Java no es una variable de
     entorno en itzg/minecraft-server: se elige por etiqueta. El numero de Java
     que hace falta lo publica Mojang en el JSON de cada version, asi que no se
     inventa nada.
     Etiquetas que publica la imagen y que se usan aqui: java8, java11, java17,
     java21 y java25. */
  function etiquetaJava(mayor, tipo, anteriorA118) {
    // Excepcion dura y documentada por la propia imagen: "For Forge versions
    // less than 1.18, you must use the java8 image tag".
    if (tipo === 'FORGE' && anteriorA118) {
      return { etiqueta: 'java8', motivo: 'Forge anterior a Minecraft 1.18 solo funciona con Java 8; lo exige la documentacion de la imagen.' };
    }
    if (!mayor) {
      return { etiqueta: 'latest', motivo: 'No se pudo leer el Java que pide Mojang para esta version; se usa la etiqueta latest.' };
    }
    var etiqueta;
    if (mayor <= 8) etiqueta = 'java8';
    else if (mayor <= 11) etiqueta = 'java11';
    else if (mayor <= 17) etiqueta = 'java17';
    else if (mayor <= 21) etiqueta = 'java21';
    else etiqueta = 'java25';
    return { etiqueta: etiqueta, motivo: 'Mojang declara Java ' + mayor + ' para esta version de Minecraft.' };
  }

  global.GM.compat = {
    CARGADORES: CARGADORES,
    porClave: porClave,
    cargarCatalogos: cargarCatalogos,
    estadoDe: estadoDe,
    esAnteriorA: esAnteriorA,
    etiquetaJava: etiquetaJava,
    compararNumerico: compararNumerico
  };
})(window);
