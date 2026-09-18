/* ==========================================================================
   modpacks.js - buscador de modpacks completos de Modrinth.
   ==========================================================================
   Un modpack no es "muchos mods a la vez": es otro mecanismo entero de la
   imagen itzg/minecraft-server. En vez de MODRINTH_PROJECTS (una lista de
   mods que la imagen descarga uno a uno), se usa MODPACK_PLATFORM=MODRINTH
   mas MODRINTH_MODPACK, y es el propio archivo .mrpack el que trae dentro su
   lista de mods Y el cargador con el que tiene que arrancar.

   Cuatro cosas verificadas contra la API real que condicionan este archivo:

   1. El parametro `loaders` del endpoint de versiones SE IGNORA en los
      proyectos de tipo modpack. Por eso el cargador se filtra aqui, en el
      cliente, sobre el array `loaders` de cada version. Ver el comentario de
      versionesDeModpack() en api.js con la matriz de pruebas.
   2. Las facetas del buscador se evaluan por separado: `categories:neoforge` y
      `versions:1.21.1` se comprueban contra los agregados del proyecto, sin
      cruzarlos. Que un modpack salga en esa busqueda no significa que exista
      un archivo para esa pareja. Solo el endpoint de versiones lo confirma.
   3. Casi un tercio de los modpacks de Modrinth son solo de cliente (packs de
      graficos o de rendimiento). Sin filtrar el entorno, lo primero que ve el
      usuario son packs que no sirven para un servidor.
   4. Las `dependencies` de una version de modpack vienen todas como
      'embedded': son los mods que el pack ya lleva dentro. No hay que pedirle
      al usuario que los anada, asi que ese array se ignora a proposito.

   No hay ningun dato de memoria en la API de Modrinth: no existe el campo, ni
   en el proyecto, ni en la version, ni en el resultado de busqueda. Lo que se
   dice en pantalla sobre la RAM sale de la documentacion de la imagen, y se
   declara de donde sale.
   ========================================================================== */
(function (global) {
  'use strict';

  var api = global.GM.api;

  var estado = {
    version: null,
    cargador: null,
    consulta: '',
    desplazamiento: 0,
    total: 0,
    etiquetas: null,
    elegido: null,        // { id, slug, nombre, icono, versionId, ... }
    alCambiar: function () {}
  };

  /* Mismo testigo que usa app.js para la eleccion de version y cargador. Aqui
     hace falta por partida doble: una busqueda y una comprobacion de versiones
     pueden volver despues de que el usuario haya cambiado de version, de
     cargador o de modpack. Aplicar una respuesta atrasada dejaria en el
     compose el identificador de version de OTRO modpack, que es justo el tipo
     de fallo que no se ve hasta que el contenedor no arranca. */
  var token = 0;

  var nodos = {};

  /* ------------------------------ Utilidades ------------------------------- */

  function crear(etiqueta, clase, texto) {
    var n = document.createElement(etiqueta);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }

  function vaciar(nodo) { while (nodo.firstChild) nodo.removeChild(nodo.firstChild); }

  function icono(id) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var uso = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    uso.setAttribute('href', '#' + id);
    svg.appendChild(uso);
    return svg;
  }

  function numero(n) {
    try { return new Intl.NumberFormat('es').format(n); }
    catch (e) { return String(n); }
  }

  /* -------------------------------- Estados -------------------------------- */

  function mostrarCargando(mensaje) {
    vaciar(nodos.resultados);
    nodos.resultados.setAttribute('aria-busy', 'true');
    var caja = crear('div', 'estado estado--cargando');
    caja.appendChild(crear('span', 'girador'));
    caja.appendChild(document.createTextNode(mensaje || 'Buscando modpacks en Modrinth...'));
    nodos.resultados.appendChild(caja);
    nodos.paginacion.hidden = true;
  }

  function mostrarError(e) {
    vaciar(nodos.resultados);
    nodos.resultados.setAttribute('aria-busy', 'false');
    var caja = crear('div', 'estado estado--error');
    caja.setAttribute('role', 'alert');
    caja.appendChild(icono('i-aviso'));
    var cuerpo = crear('div');
    cuerpo.appendChild(crear('p', null, 'No se pudo buscar modpacks en Modrinth.'));
    cuerpo.appendChild(crear('p', null, (e && e.message) || 'Error desconocido.'));
    cuerpo.appendChild(crear('p', null,
      'La pagina sigue funcionando: puedes volver a "Mods sueltos" o generar el servidor sin nada.'));
    var reintentar = crear('button', 'boton boton--secundario', 'Reintentar');
    reintentar.type = 'button';
    reintentar.addEventListener('click', function () { buscar(estado.consulta, false); });
    cuerpo.appendChild(reintentar);
    caja.appendChild(cuerpo);
    nodos.resultados.appendChild(caja);
    nodos.paginacion.hidden = true;
  }

  function mostrarVacio(mensaje) {
    vaciar(nodos.resultados);
    nodos.resultados.setAttribute('aria-busy', 'false');
    var caja = crear('div', 'estado estado--vacio');
    caja.appendChild(crear('p', null, mensaje));
    nodos.resultados.appendChild(caja);
    nodos.paginacion.hidden = true;
  }

  /* -------------------------------- Busqueda ------------------------------- */

  /* Igual que con los mods: una faceta con un valor que Modrinth no conoce
     devuelve 200 con cero resultados, indistinguible de "no hay modpacks". Se
     valida antes de preguntar. La comprobacion extra aqui es que el cargador
     admita modpacks: Paper y Purpur existen en /tag/loader pero su
     supported_project_types no incluye "modpack". */
  function facetaInvalida() {
    if (!estado.etiquetas) return null;
    var c = estado.cargador.modrinthCargador;
    if (estado.etiquetas.cargadores.indexOf(c) === -1) {
      return 'Modrinth no reconoce el cargador "' + c + '". Es un fallo de esta pagina, no tuyo: ' +
             'avisa en el repositorio.';
    }
    if (estado.etiquetas.versiones.indexOf(estado.version) === -1) {
      return 'Modrinth todavia no tiene indexada la version ' + estado.version + ' de Minecraft, ' +
             'asi que no puede buscar modpacks para ella. Suele tardar unas horas desde que sale ' +
             'una version. Elige una version anterior o usa mods sueltos.';
    }
    return null;
  }

  // Si el cargador elegido no tiene modpacks en Modrinth, este paso no aplica.
  function admiteModpacks(cargador, etiquetas) {
    if (!cargador || !cargador.modrinthCargador) return false;
    // Sin catalogo no se puede afirmar lo contrario, asi que se deja pasar y
    // sera la busqueda la que lo diga.
    if (!etiquetas || !etiquetas.cargadoresModpack) return true;
    return etiquetas.cargadoresModpack.indexOf(cargador.modrinthCargador) !== -1;
  }

  function buscar(consulta, anexar) {
    if (!estado.cargador || !estado.cargador.modrinthCargador) return;

    var problema = facetaInvalida();
    if (problema) { mostrarVacio(problema); return; }

    estado.consulta = consulta || '';
    estado.desplazamiento = anexar ? estado.desplazamiento + 20 : 0;

    if (!anexar) mostrarCargando();
    nodos.masResultados.disabled = true;

    var miToken = token;

    api.buscarProyectos({
      consulta: estado.consulta,
      cargador: estado.cargador.modrinthCargador,
      version: estado.version,
      tipoProyecto: 'modpack',
      desplazamiento: estado.desplazamiento
    }).then(function (r) {
      if (miToken !== token) return;      // el usuario ya cambio de seleccion
      estado.total = r.total_hits || 0;
      if (!anexar) vaciar(nodos.resultados);
      nodos.resultados.setAttribute('aria-busy', 'false');

      if (!r.hits || !r.hits.length) {
        if (!anexar) {
          mostrarVacio(estado.consulta
            ? 'Ningun modpack para "' + estado.consulta + '" con ' + estado.cargador.nombre +
              ' en Minecraft ' + estado.version + '. Prueba con otro nombre o cambia de version.'
            : 'Modrinth no tiene modpacks para ' + estado.cargador.nombre +
              ' en Minecraft ' + estado.version + '.');
        }
        return;
      }

      if (!anexar) {
        var cabecera = crear('p', 'paginacion__cuenta');
        cabecera.textContent = numero(estado.total) +
          (estado.total === 1 ? ' modpack' : ' modpacks') +
          ' en Modrinth para ' + estado.cargador.nombre + ' y Minecraft ' + estado.version +
          (estado.consulta ? ' coinciden con la busqueda.' : ', ordenados por descargas.');
        nodos.resultados.appendChild(cabecera);
      }

      r.hits.forEach(function (hit) {
        nodos.resultados.appendChild(tarjeta(hit));
      });

      var vistos = estado.desplazamiento + r.hits.length;
      nodos.paginacion.hidden = vistos >= estado.total;
      nodos.masResultados.disabled = false;
      nodos.cuentaResultados.textContent = 'Mostrando ' + numero(vistos) + ' de ' + numero(estado.total) + '.';
    }).catch(function (e) {
      if (miToken !== token) return;
      if (anexar) {
        estado.desplazamiento -= 20;
        nodos.masResultados.disabled = false;
      } else {
        mostrarError(e);
      }
    });
  }

  function tarjeta(hit) {
    var fila = crear('article', 'mod');

    if (hit.icon_url) {
      var img = document.createElement('img');
      img.className = 'mod__icono';
      img.src = hit.icon_url;          // solo como src, nunca como HTML
      img.alt = '';
      img.loading = 'lazy';
      img.width = 48; img.height = 48;
      img.addEventListener('error', function () { img.style.visibility = 'hidden'; });
      fila.appendChild(img);
    } else {
      fila.appendChild(crear('div', 'mod__icono'));
    }

    var cuerpo = crear('div', 'mod__cuerpo');
    var titulo = crear('h4', 'mod__titulo');
    titulo.appendChild(document.createTextNode(String(hit.title || hit.slug || '')));
    if (hit.author) titulo.appendChild(crear('span', 'mod__autor', 'de ' + hit.author));

    var juicio = global.GM.mods.evaluarEntorno(hit.environment);
    if (!juicio.ok) {
      titulo.appendChild(crear('span', 'etiqueta-mini etiqueta-mini--error', 'solo cliente'));
    } else if (juicio.duda) {
      titulo.appendChild(crear('span', 'etiqueta-mini etiqueta-mini--aviso', 'sin dato'));
    }
    cuerpo.appendChild(titulo);
    cuerpo.appendChild(crear('p', 'mod__desc', String(hit.description || '')));

    var datos = crear('p', 'mod__datos');
    datos.appendChild(crear('span', null, numero(hit.downloads || 0) + ' descargas'));
    datos.appendChild(crear('span', null, 'licencia ' + String(hit.license || 'sin declarar')));
    var enlace = crear('a', null, 'Ver en Modrinth');
    enlace.href = 'https://modrinth.com/modpack/' + encodeURIComponent(hit.slug || '');
    enlace.target = '_blank';
    enlace.rel = 'noopener noreferrer';
    datos.appendChild(enlace);
    cuerpo.appendChild(datos);

    if (!juicio.ok) {
      cuerpo.appendChild(crear('p', 'mod__motivo',
        'Este modpack es solo de cliente: cambia graficos o rendimiento en tu juego y no ' +
        'tiene nada que instalar en un servidor.'));
    } else if (juicio.aviso) {
      cuerpo.appendChild(crear('p', 'campo__nota',
        'Los jugadores tendran que instalar este mismo modpack en su lanzador para poder entrar.'));
    }

    fila.appendChild(cuerpo);

    var acciones = crear('div', 'mod__acciones');
    var boton = crear('button', 'boton boton--chico');
    boton.type = 'button';

    if (!juicio.ok) {
      boton.disabled = true;
      boton.textContent = 'No se puede usar';
    } else if (estado.elegido && estado.elegido.id === hit.project_id) {
      boton.disabled = true;
      boton.textContent = 'Elegido';
    } else {
      boton.textContent = 'Usar este modpack';
      boton.addEventListener('click', function () {
        boton.disabled = true;
        boton.textContent = 'Comprobando...';
        elegir(hit).then(function (r) {
          if (r.ok) return;                 // pintarElegido ya repinto la lista
          boton.textContent = 'Sin version compatible';
          boton.title = r.motivo;
          var nota = crear('p', 'mod__motivo', r.motivo);
          cuerpo.appendChild(nota);
        }).catch(function () {
          boton.disabled = false;
          boton.textContent = 'Reintentar';
        });
      });
    }
    acciones.appendChild(boton);
    fila.appendChild(acciones);
    return fila;
  }

  /* ---------------------------- Eleccion y choque -------------------------- */

  /* Aqui se resuelve el choque entre lo que eligio el usuario en el paso 1 y lo
     que el modpack publica de verdad.

     La decision: la pagina NO deja elegir un modpack que no case, y cuando casa
     FIJA la version exacta del modpack en el compose.

     El motivo es que la imagen no reconcilia nada. VERSION se traduce a
     --game-version y MODRINTH_LOADER a --loader, y los dos son criterios de
     BUSQUEDA sobre las versiones publicadas del modpack: si no casan con
     ninguna, el contenedor falla al arrancar. Un compose que parece correcto y
     revienta en el primer `docker compose up` es el peor resultado posible.

     Al fijar MODRINTH_VERSION con el identificador de la version concreta que
     esta pagina ya comprobo, no queda ningun filtro que pueda desajustarse:
     se pide un archivo por su identificador y ese archivo existe. El fallo
     deja de poder ocurrir en la maquina del usuario. */
  function elegir(hit) {
    var miToken = token;

    return api.versionesDeModpack(hit.project_id, estado.version).then(function (versiones) {
      if (miToken !== token) return { ok: false, motivo: 'Seleccion cambiada.' };

      var lista = versiones || [];
      var cargador = estado.cargador.modrinthCargador;

      // EL FILTRO QUE LA API NO HACE. Sin esto entrarian versiones de otro
      // cargador: fresh-smooth publica dos versiones numeradas 1.5.0 para
      // Minecraft 1.21.1, una de NeoForge y otra de Fabric.
      var compatibles = lista.filter(function (v) {
        return (v.loaders || []).indexOf(cargador) !== -1;
      });

      if (!compatibles.length) {
        return { ok: false, motivo: motivoDelChoque(lista, hit) };
      }

      // Se prefiere una version estable. Entre varias, la publicada mas tarde.
      function porFecha(a, b) {
        return new Date(b.date_published || 0) - new Date(a.date_published || 0);
      }
      var estables = compatibles.filter(function (v) { return v.version_type === 'release'; });
      var elegida = (estables.length ? estables : compatibles).slice().sort(porFecha)[0];

      var juicio = global.GM.mods.evaluarEntorno(elegida.environment);
      if (!juicio.ok) {
        return {
          ok: false,
          motivo: 'La version de este modpack para Minecraft ' + estado.version + ' con ' +
                  estado.cargador.nombre + ' esta declarada como solo de cliente.'
        };
      }

      estado.elegido = {
        id: hit.project_id,
        slug: hit.slug || hit.project_id,
        nombre: hit.title || hit.slug || hit.project_id,
        icono: hit.icon_url || '',
        autor: hit.author || '',
        // El identificador de version, NO el numero: dos versiones distintas
        // pueden compartir numero (una por cargador). El identificador es unico.
        versionId: elegida.id,
        versionNumero: elegida.version_number || elegida.name || elegida.id,
        versionTipo: elegida.version_type || 'release',
        minecraft: estado.version,
        cargador: cargador,
        cargadorNombre: estado.cargador.nombre,
        estable: elegida.version_type === 'release',
        exigeCliente: !!juicio.aviso
      };

      pintarElegido();
      estado.alCambiar();
      buscar(estado.consulta, false);     // repinta para marcar el elegido
      return { ok: true };
    });
  }

  // Mensaje util cuando no casa: se dice QUE tiene el modpack, para que el
  // usuario sepa a que cambiar el paso 1 en vez de quedarse a ciegas.
  function motivoDelChoque(lista, hit) {
    if (!lista.length) {
      var suyas = (hit.versions || []).slice(-6).join(', ');
      return 'Este modpack no publica ningun archivo para Minecraft ' + estado.version + '. ' +
             (suyas ? 'Si tiene para: ' + suyas + '. ' : '') +
             'Vuelve al paso 1 y elige una de esas versiones.';
    }
    var otros = [];
    lista.forEach(function (v) {
      (v.loaders || []).forEach(function (l) { if (otros.indexOf(l) === -1) otros.push(l); });
    });
    return 'Este modpack si tiene version para Minecraft ' + estado.version +
           ', pero solo para ' + (otros.join(' y ') || 'otro cargador') +
           ', no para ' + estado.cargador.nombre + '. ' +
           'Vuelve al paso 1 y cambia el cargador, o elige otro modpack.';
  }

  function quitar() {
    estado.elegido = null;
    pintarElegido();
    estado.alCambiar();
    buscar(estado.consulta, false);
  }

  function pintarElegido() {
    vaciar(nodos.elegido);

    if (!estado.elegido) {
      nodos.elegido.appendChild(crear('p', 'lista-elegidos__vacio',
        'Todavia no elegiste ningun modpack. Elige uno de la lista, o vuelve a "Mods sueltos".'));
      nodos.resumen.hidden = true;
      return;
    }

    var m = estado.elegido;
    var caja = crear('div', 'modpack-elegido');

    var fila = crear('div', 'modpack-elegido__cabecera');
    if (m.icono) {
      var img = document.createElement('img');
      img.className = 'elegido__icono';
      img.src = m.icono;
      img.alt = '';
      img.loading = 'lazy';
      fila.appendChild(img);
    }
    var texto = crear('div', 'elegido__texto');
    texto.appendChild(crear('span', 'elegido__nombre', m.nombre));
    texto.appendChild(crear('span', 'elegido__slug', m.slug));
    fila.appendChild(texto);

    var quita = crear('button', 'boton boton--peligro boton--chico');
    quita.type = 'button';
    quita.appendChild(icono('i-quitar'));
    quita.appendChild(document.createTextNode('Quitar'));
    quita.setAttribute('aria-label', 'Quitar el modpack ' + m.nombre);
    quita.addEventListener('click', quitar);
    fila.appendChild(quita);
    caja.appendChild(fila);

    var dl = document.createElement('dl');
    function dato(clave, valor) {
      dl.appendChild(crear('dt', null, clave));
      dl.appendChild(crear('dd', null, valor));
    }
    dato('Version del modpack', m.versionNumero + (m.estable ? '' : ' (' + m.versionTipo + ')'));
    dato('Minecraft', m.minecraft);
    dato('Cargador', m.cargadorNombre);
    dato('Comprobado', 'Modrinth confirma que esta version tiene archivo para ' +
         m.cargadorNombre + ' y Minecraft ' + m.minecraft + '.');
    caja.appendChild(dl);

    if (!m.estable) {
      caja.appendChild(crear('p', 'cargador__estado cargador__estado--beta',
        'Para esta combinacion solo hay una version en canal "' + m.versionTipo +
        '". Puede fallar o cambiar.'));
    }
    if (m.exigeCliente) {
      caja.appendChild(crear('p', 'campo__nota',
        'Cada jugador tendra que instalar este mismo modpack en su lanzador para poder entrar. ' +
        'Un modpack no es solo cosa del servidor.'));
    }

    nodos.elegido.appendChild(caja);
    nodos.resumen.hidden = false;
  }

  /* ------------------------------- Interfaz -------------------------------- */

  function configurar(version, cargador, alCambiar) {
    token++;                      // invalida cualquier respuesta en vuelo
    estado.version = version;
    estado.cargador = cargador;
    estado.alCambiar = alCambiar || estado.alCambiar;

    // Cambiar de version o de cargador invalida el modpack elegido por el mismo
    // motivo que invalida los mods: el archivo comprobado era para la
    // combinacion anterior.
    estado.elegido = null;
    estado.consulta = '';
    estado.desplazamiento = 0;
    if (nodos.busqueda) nodos.busqueda.value = '';
    pintarElegido();

    if (!cargador.modrinthCargador) return;

    function seguir() {
      if (!admiteModpacks(cargador, estado.etiquetas)) {
        nodos.noAdmite.hidden = false;
        var t = nodos.noAdmiteTexto;
        vaciar(t);
        t.appendChild(crear('p', null,
          'Modrinth no indexa modpacks para ' + cargador.nombre + '. Los modpacks existen solo ' +
          'para los cargadores de mods (Fabric, Forge, NeoForge y Quilt); ' + cargador.nombre +
          ' usa plugins, que se anaden de uno en uno desde "Mods sueltos".'));
        nodos.panelBusqueda.hidden = true;
        return;
      }
      nodos.noAdmite.hidden = true;
      nodos.panelBusqueda.hidden = false;
      buscar('', false);
    }

    if (estado.etiquetas) { seguir(); return; }
    mostrarCargando('Consultando los catalogos de Modrinth...');
    api.etiquetasModrinth().then(function (t) {
      estado.etiquetas = t;
    }).catch(function () {
      estado.etiquetas = null;
    }).then(seguir);
  }

  function iniciar(refs) {
    nodos = refs;
    nodos.masResultados.addEventListener('click', function () { buscar(estado.consulta, true); });
    pintarElegido();
  }

  global.GM.modpacks = {
    iniciar: iniciar,
    configurar: configurar,
    buscar: buscar,
    elegido: function () { return estado.elegido; },
    limpiar: function () { token++; estado.elegido = null; pintarElegido(); }
  };
})(window);
