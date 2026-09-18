/* ==========================================================================
   api.js - toda la red del sitio pasa por aqui.
   ==========================================================================
   Se concentra en un solo archivo por dos razones concretas:

   1. La v2 de Modrinth esta viva pero su documentacion avisa de que, cuando
      deje de ser la version actual, respondera 410 de forma permanente.
      Cuando eso pase habra que cambiar la URL base y el mapeo de campos, y
      conviene que ambos esten en un unico sitio.
   2. Desde el navegador NO se puede fijar la cabecera User-Agent: la
      especificacion de fetch la marca como prohibida. Modrinth pide una
      identificativa. No hay forma tecnica de cumplirlo sin un backend, asi
      que se compensa con el unico recurso disponible: pedir poco. Todo el
      cacheo vive aqui.
   ========================================================================== */
(function (global) {
  'use strict';

  var BASES = {
    mojang:    'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
    fabric:    'https://meta.fabricmc.net/v2',
    quilt:     'https://meta.quiltmc.org/v3',
    forge:     'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',
    // NeoForge publica DOS artefactos: el suyo propio, que empieza en Minecraft
    // 1.20.2, y una continuacion del de Forge que cubre solo 1.20.1. Si se
    // consulta unicamente el primero, 1.20.1 aparece sin NeoForge sin motivo.
    neoforge:  'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
    neoforge120: 'https://maven.neoforged.net/releases/net/neoforged/forge/maven-metadata.xml',
    paper:     'https://fill.papermc.io/v3/projects/paper',
    purpur:    'https://api.purpurmc.org/v2/purpur',
    modrinth:  'https://api.modrinth.com/v2'
  };

  var TIEMPO_ESPERA = 15000;      // ms antes de abandonar una peticion
  var CACHE_TAGS_HORAS = 24;      // los catalogos de Modrinth cambian poco

  // Cache en memoria por sesion. Evita repetir la misma busqueda al volver
  // atras o al reescribir un texto ya consultado.
  var memoria = new Map();

  function ErrorApi(mensaje, codigo, fuente) {
    var e = new Error(mensaje);
    e.codigo = codigo || 0;
    e.fuente = fuente || '';
    e.esApi = true;
    return e;
  }

  // En los mensajes se da el nombre del servicio, no la URL entera: una URL con
  // las facetas codificadas ocupa parrafo y medio y no le dice nada a nadie.
  function nombreDeFuente(url) {
    try { return new URL(url).hostname; } catch (e) { return String(url).slice(0, 60); }
  }

  function mensajeDeCodigo(codigo, fuente) {
    if (codigo === 429) {
      return 'Modrinth esta limitando las peticiones (300 por minuto y por direccion IP, ' +
             'compartidas con cualquiera que use tu misma red). Espera un minuto y vuelve a intentarlo.';
    }
    if (codigo === 410) {
      return 'La version de la API que usa esta pagina fue retirada. Hay que actualizar el generador; ' +
             'avisa en el repositorio.';
    }
    if (codigo === 404) return 'No se encontro lo que se pidio a ' + nombreDeFuente(fuente) + '.';
    if (codigo === 0) {
      return 'No hubo respuesta de ' + nombreDeFuente(fuente) +
             '. Puede ser tu conexion, un bloqueador de anuncios o que el servicio este caido.';
    }
    return 'Respuesta ' + codigo + ' de ' + nombreDeFuente(fuente) + '.';
  }

  function pedir(url, tipo) {
    var controlador = new AbortController();
    var reloj = setTimeout(function () { controlador.abort(); }, TIEMPO_ESPERA);

    // Sin cabeceras propias a proposito: en cuanto se anade una, el navegador
    // convierte la peticion en "preflighted" y hace dos viajes en vez de uno.
    return fetch(url, { signal: controlador.signal, mode: 'cors', credentials: 'omit' })
      .then(function (r) {
        clearTimeout(reloj);
        if (!r.ok) {
          // Modrinth devuelve 404 con cuerpo VACIO, asi que no se puede llamar
          // a r.json() a ciegas: hay que mirar r.ok antes.
          throw ErrorApi(mensajeDeCodigo(r.status, url), r.status, url);
        }
        return tipo === 'texto' ? r.text() : r.json();
      })
      .catch(function (e) {
        clearTimeout(reloj);
        if (e && e.esApi) throw e;
        throw ErrorApi(mensajeDeCodigo(0, url), 0, url);
      });
  }

  function pedirCacheado(clave, url, tipo, transformar) {
    if (memoria.has(clave)) return Promise.resolve(memoria.get(clave));
    return pedir(url, tipo).then(function (crudo) {
      var v = transformar ? transformar(crudo) : crudo;
      memoria.set(clave, v);
      return v;
    });
  }

  /* ---------------------- Cache persistente (catalogos) -------------------- */

  function leerLocal(clave, horas) {
    try {
      var bruto = localStorage.getItem(clave);
      if (!bruto) return null;
      var caja = JSON.parse(bruto);
      if (!caja || typeof caja.t !== 'number') return null;
      if (Date.now() - caja.t > horas * 3600000) return null;
      return caja.v;
    } catch (e) {
      return null;   // modo privado, almacenamiento lleno o JSON corrupto
    }
  }

  function guardarLocal(clave, valor) {
    try {
      localStorage.setItem(clave, JSON.stringify({ t: Date.now(), v: valor }));
    } catch (e) { /* si no se puede guardar, se vuelve a pedir y ya esta */ }
  }

  /* ------------------------------ Utilidades ------------------------------- */

  // Extrae las versiones de un maven-metadata.xml. Se usa DOMParser en vez de
  // una expresion regular porque el XML de Forge pesa 200 KB y trae entradas
  // raras; el parser del navegador es mas rapido y mas fiable.
  function versionesDeMaven(xml) {
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) return [];
    var nodos = doc.getElementsByTagName('version');
    var salida = [];
    for (var i = 0; i < nodos.length; i++) {
      var t = (nodos[i].textContent || '').trim();
      if (t) salida.push(t);
    }
    return salida;
  }

  /* ------------------------------- Mojang ---------------------------------- */

  // Devuelve las versiones estables EN EL ORDEN que las da Mojang, de la mas
  // nueva a la mas vieja, y un indice posicion->version. Ese indice es lo que
  // se usa despues para comparar versiones: desde que Minecraft paso a
  // numeracion por ano (26.1, 26.2, 26.3) cualquier comparacion aritmetica
  // colocaria 1.21.11 por encima de 26.3, que es al reves de la realidad.
  function versionesMinecraft() {
    return pedirCacheado('mojang', BASES.mojang, 'json', function (d) {
      var estables = [];
      var indice = Object.create(null);
      var porId = Object.create(null);
      (d.versions || []).forEach(function (v) {
        if (v.type !== 'release') return;
        indice[v.id] = estables.length;
        porId[v.id] = v;
        estables.push(v.id);
      });
      return {
        ultima: (d.latest && d.latest.release) || estables[0],
        lista: estables,
        indice: indice,
        porId: porId
      };
    });
  }

  // Java exigido por una version concreta, leido del propio JSON de Mojang.
  // Es la misma fuente que consulta el lanzador oficial, asi que no hace falta
  // mantener ninguna tabla escrita a mano en este repositorio.
  function javaDeVersion(entrada) {
    if (!entrada || !entrada.url) return Promise.resolve(null);
    return pedirCacheado('java:' + entrada.id, entrada.url, 'json', function (d) {
      return (d.javaVersion && d.javaVersion.majorVersion) || null;
    });
  }

  /* ------------------------------ Cargadores ------------------------------- */

  function fabricVersiones() {
    return pedirCacheado('fabric', BASES.fabric + '/versions/game', 'json', function (d) {
      // stable:false son snapshots, pre-releases y candidatas: fuera.
      return d.filter(function (v) { return v.stable; }).map(function (v) { return v.version; });
    });
  }

  function fabricLoader() {
    return pedirCacheado('fabric-loader', BASES.fabric + '/versions/loader', 'json', function (d) {
      var estable = d.filter(function (v) { return v.stable; })[0];
      return estable ? estable.version : (d[0] && d[0].version) || null;
    });
  }

  function quiltVersiones() {
    return pedirCacheado('quilt', BASES.quilt + '/versions/game', 'json', function (d) {
      return d.filter(function (v) { return v.stable; }).map(function (v) { return v.version; });
    });
  }

  // Forge. Su maven-metadata declara <latest> y <release> y los dos son FALSOS:
  // hoy dicen 1.19.4-45.4.5 cuando el catalogo llega a 26.2. Las entradas
  // tampoco estan ordenadas. Por eso se ignoran esos campos y se agrupa a mano.
  function forgeVersiones() {
    return pedirCacheado('forge', BASES.forge, 'texto', function (xml) {
      var mapa = Object.create(null);
      versionesDeMaven(xml).forEach(function (v) {
        var mc = v.split('-')[0];            // "1.20.1-47.4.23" y "1.7.10-10.13.4.1614-1.7.10"
        var build = v.slice(mc.length + 1);
        if (!mc || !build) return;
        (mapa[mc] || (mapa[mc] = [])).push({ version: v, build: build, beta: false });
      });
      return mapa;
    });
  }

  // NeoForge numera sus versiones a partir de la version de Minecraft:
  //   tres partes  A.B.C     -> Minecraft 1.A.B   (21.1.209 -> 1.21.1, 21.0.x -> 1.21)
  //   cuatro partes X.Y.Z.B  -> Minecraft X.Y.Z   (26.1.2.4 -> 26.1.2, 26.2.0.x -> 26.2)
  // Las entradas "0.25w14craftmine.N-beta" son una broma del 1 de abril: no
  // encajan en ninguna version real de Minecraft y se descartan solas.
  function mcDeNeoforge(v) {
    var nucleo = v.split('-')[0].split('+')[0];
    var partes = nucleo.split('.');
    if (partes.some(function (p) { return !/^\d+$/.test(p); })) return null;
    if (partes.length === 3) {
      return partes[1] === '0' ? '1.' + partes[0] : '1.' + partes[0] + '.' + partes[1];
    }
    if (partes.length === 4) {
      return partes[2] === '0'
        ? partes[0] + '.' + partes[1]
        : partes[0] + '.' + partes[1] + '.' + partes[2];
    }
    return null;
  }

  function neoforgeVersiones() {
    var propio = pedirCacheado('neoforge', BASES.neoforge, 'texto', function (xml) {
      var mapa = Object.create(null);
      versionesDeMaven(xml).forEach(function (v) {
        var mc = mcDeNeoforge(v);
        if (!mc) return;
        (mapa[mc] || (mapa[mc] = [])).push({
          version: v,
          build: v,
          beta: /-(beta|alpha|rc)/i.test(v)
        });
      });
      return mapa;
    });

    // El artefacto viejo cubre Minecraft 1.20.1 y solo eso.
    var heredado = pedirCacheado('neoforge120', BASES.neoforge120, 'texto', function (xml) {
      var mapa = Object.create(null);
      versionesDeMaven(xml).forEach(function (v) {
        var mc = v.split('-')[0];
        if (!mc) return;
        (mapa[mc] || (mapa[mc] = [])).push({ version: v, build: v, beta: /-(beta|alpha|rc)/i.test(v) });
      });
      return mapa;
    });

    return Promise.all([propio, heredado]).then(function (r) {
      var mezcla = Object.create(null);
      [r[0], r[1]].forEach(function (m) {
        Object.keys(m).forEach(function (mc) {
          mezcla[mc] = (mezcla[mc] || []).concat(m[mc]);
        });
      });
      return mezcla;
    });
  }

  // Paper. Su API v2 murio: responde 410 con cabecera de retirada. Esta es la v3.
  function paperVersiones() {
    return pedirCacheado('paper', BASES.paper, 'json', function (d) {
      var salida = [];
      var familias = d.versions || {};
      Object.keys(familias).forEach(function (fam) {
        (familias[fam] || []).forEach(function (v) { salida.push(v); });
      });
      return salida;
    });
  }

  // El canal (STABLE o ALPHA) solo se sabe consultando la build concreta, asi
  // que se pide unicamente cuando el usuario elige Paper.
  function paperBuild(version) {
    return pedirCacheado('paper-build:' + version,
      BASES.paper + '/versions/' + encodeURIComponent(version) + '/builds/latest', 'json',
      function (d) { return { id: d.id, canal: d.channel || 'DESCONOCIDO' }; });
  }

  // Purpur: su campo metadata.current va con retraso respecto al array de
  // versiones, asi que se lee el array.
  function purpurVersiones() {
    return pedirCacheado('purpur', BASES.purpur, 'json', function (d) {
      return d.versions || [];
    });
  }

  /* ------------------------------- Modrinth -------------------------------- */

  // Catalogos de Modrinth. Se validan los valores de las facetas contra estos
  // catalogos antes de construir la consulta porque un nombre de faceta mal
  // escrito NO da error: devuelve 200 con cero resultados, que en pantalla se
  // ve exactamente igual que "no hay mods para esa combinacion".
  function etiquetasModrinth() {
    var guardado = leerLocal('gm:tags', CACHE_TAGS_HORAS);
    if (guardado) {
      memoria.set('tags', guardado);
      return Promise.resolve(guardado);
    }
    if (memoria.has('tags')) return Promise.resolve(memoria.get('tags'));

    return Promise.all([
      pedir(BASES.modrinth + '/tag/loader', 'json'),
      pedir(BASES.modrinth + '/tag/game_version', 'json')
    ]).then(function (r) {
      var v = {
        cargadores: r[0].map(function (x) { return x.name; }),
        versiones: r[1].filter(function (x) { return x.version_type === 'release'; })
                       .map(function (x) { return x.version; })
      };
      memoria.set('tags', v);
      guardarLocal('gm:tags', v);
      return v;
    });
  }

  function facetas(lista) {
    return JSON.stringify(lista);
  }

  // Valores de "environment" que significan que el mod sirve en un servidor.
  // El OpenAPI de Modrinth marca client_side y server_side como obsoletos y
  // dice que el campo bueno es environment, que ademas es un ARRAY.
  var ENTORNO_SERVIDOR = [
    'client_and_server', 'server_only', 'server_only_client_optional',
    'dedicated_server_only', 'client_or_server', 'client_or_server_prefers_both'
  ];
  var ENTORNO_CLIENTE = ['client_only', 'client_only_server_optional', 'singleplayer_only'];

  function buscarProyectos(opciones) {
    var partes = [['project_type:' + opciones.tipoProyecto]];
    if (opciones.cargador) partes.push(['categories:' + opciones.cargador]);
    if (opciones.version)  partes.push(['versions:' + opciones.version]);

    var url = BASES.modrinth + '/search'
      + '?query=' + encodeURIComponent(opciones.consulta || '')
      + '&facets=' + encodeURIComponent(facetas(partes))
      + '&index=' + encodeURIComponent(opciones.consulta ? 'relevance' : 'downloads')
      + '&offset=' + (opciones.desplazamiento || 0)
      // El maximo real es 100 y por encima se recorta en silencio; se pide 20.
      + '&limit=20';

    var clave = 'buscar:' + url;
    return pedirCacheado(clave, url, 'json');
  }

  // Versiones de un proyecto ya filtradas por cargador y version de Minecraft.
  // Es el endpoint autoritativo: si devuelve vacio, ese mod no tiene archivo
  // para esa combinacion, diga lo que diga el buscador.
  function versionesDeProyecto(id, cargador, version) {
    var url = BASES.modrinth + '/project/' + encodeURIComponent(id) + '/version'
      + '?loaders=' + encodeURIComponent(JSON.stringify([cargador]))
      + '&game_versions=' + encodeURIComponent(JSON.stringify([version]))
      // Los changelogs inflan muchisimo la respuesta y aqui no se usan.
      + '&include_changelog=false';
    return pedirCacheado('ver:' + id + ':' + cargador + ':' + version, url, 'json');
  }

  // Varios proyectos de una sola peticion, para resolver nombres de
  // dependencias sin gastar una llamada por cada una.
  function proyectosPorId(ids) {
    if (!ids.length) return Promise.resolve([]);
    var url = BASES.modrinth + '/projects?ids=' + encodeURIComponent(JSON.stringify(ids));
    return pedirCacheado('proys:' + ids.slice().sort().join(','), url, 'json');
  }

  global.GM = global.GM || {};
  global.GM.api = {
    BASES: BASES,
    ENTORNO_SERVIDOR: ENTORNO_SERVIDOR,
    ENTORNO_CLIENTE: ENTORNO_CLIENTE,
    versionesMinecraft: versionesMinecraft,
    javaDeVersion: javaDeVersion,
    fabricVersiones: fabricVersiones,
    fabricLoader: fabricLoader,
    quiltVersiones: quiltVersiones,
    forgeVersiones: forgeVersiones,
    neoforgeVersiones: neoforgeVersiones,
    mcDeNeoforge: mcDeNeoforge,
    paperVersiones: paperVersiones,
    paperBuild: paperBuild,
    purpurVersiones: purpurVersiones,
    etiquetasModrinth: etiquetasModrinth,
    buscarProyectos: buscarProyectos,
    versionesDeProyecto: versionesDeProyecto,
    proyectosPorId: proyectosPorId
  };
})(window);
