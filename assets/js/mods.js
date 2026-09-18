/* ==========================================================================
   mods.js - buscador de mods y plugins contra la API publica de Modrinth.
   ==========================================================================
   Tres cosas que no son obvias y estan resueltas aqui:

   - Un mod "solo de cliente" no puede anadirse. Modrinth marca eso en el campo
     environment, que es un ARRAY y puede incluir "unknown". Los campos viejos
     client_side y server_side estan marcados como obsoletos en su OpenAPI.
   - Que un mod aparezca en el buscador no garantiza que tenga archivo para la
     combinacion exacta elegida, asi que al anadirlo se confirma contra el
     endpoint de versiones, que es el autoritativo.
   - Nada de innerHTML con datos de la API: nombres, descripciones y autores los
     escribe cualquiera en Modrinth. Todo entra por textContent.
   ========================================================================== */
(function (global) {
  'use strict';

  var api = global.GM.api;

  var estado = {
    version: null,
    cargador: null,       // objeto de compat.CARGADORES
    consulta: '',
    desplazamiento: 0,
    total: 0,
    etiquetas: null,      // catalogos de Modrinth, para validar las facetas
    elegidos: new Map(),  // project_id -> { id, slug, nombre, icono, dependencias }
    alCambiar: function () {}
  };

  var nodos = {};

  /* ------------------------------ Utilidades ------------------------------- */

  function crear(etiqueta, clase, texto) {
    var n = document.createElement(etiqueta);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }

  function vaciar(nodo) {
    while (nodo.firstChild) nodo.removeChild(nodo.firstChild);
  }

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

  // "1 mods" queda mal. El singular depende ademas de si el cargador acepta
  // mods o plugins, que no es lo mismo.
  function singular() {
    return estado.cargador && estado.cargador.modrinthTipo === 'plugin' ? 'plugin' : 'mod';
  }
  function plural() {
    return (estado.cargador && estado.cargador.palabra) || 'mods';
  }
  function cantidad(n) {
    return numero(n) + ' ' + (n === 1 ? singular() : plural());
  }

  /* --------------------------- Apto para servidor -------------------------- */

  function evaluarEntorno(entorno) {
    var lista = Array.isArray(entorno) ? entorno : (entorno ? [entorno] : []);
    var sirve = lista.some(function (e) { return api.ENTORNO_SERVIDOR.indexOf(e) !== -1; });
    var soloCliente = lista.some(function (e) { return api.ENTORNO_CLIENTE.indexOf(e) !== -1; });

    /* Lo restrictivo manda. Modrinth puede devolver a la vez 'client_only' y
       'client_and_server'; comprobar primero `sirve` dejaba pasar el mod con la
       nota tranquilizadora, que es justo al reves de lo que conviene en un
       servidor. Ante datos contradictorios, no se anade. */
    if (soloCliente && sirve) {
      return {
        ok: false,
        motivo: 'Modrinth declara a la vez que es solo de cliente y que sirve en servidor. ' +
          'Con datos contradictorios no se anade: compruebalo en su pagina.'
      };
    }
    if (soloCliente) {
      return {
        ok: false,
        motivo: 'Es solo para el cliente. Instalado en un servidor no hace nada, y en algunos casos impide arrancar.'
      };
    }
    if (sirve) {
      // client_and_server no significa "opcional en el cliente": obliga a que
      // cada jugador lo instale tambien. Es la causa numero uno de que un
      // servidor con mods no deje entrar a nadie, asi que se dice.
      var obliga = lista.indexOf('client_and_server') !== -1;
      return {
        ok: true,
        aviso: obliga ? 'Los jugadores tambien tienen que instalarlo en su cliente.' : ''
      };
    }
    if (soloCliente) {
      return {
        ok: false,
        motivo: 'Es solo para el cliente. Instalado en un servidor no hace nada, y en algunos casos impide arrancar.'
      };
    }
    return {
      ok: true,
      duda: true,
      aviso: 'Modrinth no declara si sirve en un servidor. Compruebalo antes de confiar en el.'
    };
  }

  /* -------------------------------- Estados -------------------------------- */

  function mostrarCargando() {
    vaciar(nodos.resultados);
    nodos.resultados.setAttribute('aria-busy', 'true');
    var caja = crear('div', 'estado estado--cargando');
    caja.appendChild(crear('span', 'girador'));
    caja.appendChild(document.createTextNode('Buscando en Modrinth...'));
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
    cuerpo.appendChild(crear('p', null, 'No se pudo buscar en Modrinth.'));
    cuerpo.appendChild(crear('p', null, (e && e.message) || 'Error desconocido.'));
    cuerpo.appendChild(crear('p', null,
      'La pagina sigue funcionando: puedes generar el servidor sin mods, o escribir a mano ' +
      'los identificadores en MODRINTH_PROJECTS dentro del archivo generado.'));
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

  /* Un valor de faceta que Modrinth no conoce NO da error: devuelve 200 con
     cero resultados, que en pantalla se ve igual que "no hay mods para esta
     combinacion". Por eso se comprueba contra sus propios catalogos antes de
     preguntar, y se distingue un caso del otro. */
  function facetaInvalida() {
    if (!estado.etiquetas) return null;   // sin catalogos, se confia y ya esta
    var c = estado.cargador.modrinthCargador;
    if (estado.etiquetas.cargadores.indexOf(c) === -1) {
      return 'Modrinth no reconoce el cargador "' + c + '". Es un fallo de esta pagina, no tuyo: ' +
             'avisa en el repositorio.';
    }
    if (estado.etiquetas.versiones.indexOf(estado.version) === -1) {
      return 'Modrinth todavia no tiene indexada la version ' + estado.version + ' de Minecraft, ' +
             'asi que no puede buscar ' + plural() + ' para ella. ' +
             'Suele tardar unas horas desde que sale una version. Puedes generar el servidor sin ' +
             plural() + ', o elegir una version anterior.';
    }
    return null;
  }

  function buscar(consulta, anexar) {
    if (!estado.cargador || !estado.cargador.modrinthCargador) return;

    var problema = facetaInvalida();
    if (problema) { mostrarVacio(problema); return; }

    estado.consulta = consulta || '';
    estado.desplazamiento = anexar ? estado.desplazamiento + 20 : 0;

    if (!anexar) mostrarCargando();
    nodos.masResultados.disabled = true;

    api.buscarProyectos({
      consulta: estado.consulta,
      cargador: estado.cargador.modrinthCargador,
      version: estado.version,
      tipoProyecto: estado.cargador.modrinthTipo,
      desplazamiento: estado.desplazamiento
    }).then(function (r) {
      estado.total = r.total_hits || 0;
      if (!anexar) vaciar(nodos.resultados);
      nodos.resultados.setAttribute('aria-busy', 'false');

      if (!r.hits || !r.hits.length) {
        if (!anexar) {
          mostrarVacio(estado.consulta
            ? 'Ningun resultado para "' + estado.consulta + '" con ' + estado.cargador.nombre +
              ' en Minecraft ' + estado.version + '. Prueba con otro nombre o cambia de cargador.'
            : 'Modrinth no tiene ' + plural() + ' para esta combinacion.');
        }
        return;
      }

      if (!anexar) {
        var cabecera = crear('p', 'paginacion__cuenta');
        cabecera.textContent = cantidad(estado.total) +
          ' en Modrinth para ' + estado.cargador.nombre + ' y Minecraft ' + estado.version +
          (estado.consulta
            ? (estado.total === 1 ? ' coincide con la busqueda.' : ' coinciden con la busqueda.')
            : ', ordenados por descargas.');
        nodos.resultados.appendChild(cabecera);
      }

      r.hits.forEach(function (hit) {
        nodos.resultados.appendChild(tarjetaResultado(hit));
      });

      var vistos = estado.desplazamiento + r.hits.length;
      nodos.paginacion.hidden = vistos >= estado.total;
      nodos.masResultados.disabled = false;
      nodos.cuentaResultados.textContent = 'Mostrando ' + numero(vistos) + ' de ' + numero(estado.total) + '.';
    }).catch(function (e) {
      if (anexar) {
        estado.desplazamiento -= 20;
        nodos.masResultados.disabled = false;
      } else {
        mostrarError(e);
      }
    });
  }

  function tarjetaResultado(hit) {
    var fila = crear('article', 'mod');

    if (hit.icon_url) {
      var img = document.createElement('img');
      img.className = 'mod__icono';
      img.src = hit.icon_url;          // solo se usa como src, nunca como HTML
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

    var juicio = evaluarEntorno(hit.environment);
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
    enlace.href = 'https://modrinth.com/' + encodeURIComponent(hit.project_type || 'mod') +
                  '/' + encodeURIComponent(hit.slug || '');
    enlace.target = '_blank';
    enlace.rel = 'noopener noreferrer';
    datos.appendChild(enlace);
    cuerpo.appendChild(datos);

    if (!juicio.ok) cuerpo.appendChild(crear('p', 'mod__motivo', juicio.motivo));
    else if (juicio.aviso) cuerpo.appendChild(crear('p', 'campo__nota', juicio.aviso));

    fila.appendChild(cuerpo);

    var acciones = crear('div', 'mod__acciones');
    var boton = crear('button', 'boton boton--chico');
    boton.type = 'button';
    if (!juicio.ok) {
      boton.disabled = true;
      boton.textContent = 'No se puede anadir';
      boton.title = juicio.motivo;
    } else if (estado.elegidos.has(hit.project_id)) {
      boton.disabled = true;
      boton.textContent = 'Ya esta';
    } else {
      boton.appendChild(icono('i-mas'));
      boton.appendChild(document.createTextNode('Anadir'));
      boton.addEventListener('click', function () {
        boton.disabled = true;
        boton.textContent = 'Comprobando...';
        anadir(hit).then(function (ok) {
          if (ok) { boton.textContent = 'Anadido'; }
          else {
            boton.textContent = 'Sin version compatible';
            boton.title = 'Este proyecto no tiene ningun archivo para ' + estado.cargador.nombre +
                          ' y Minecraft ' + estado.version + '.';
          }
        }).catch(function () {
          boton.disabled = false;
          vaciar(boton);
          boton.textContent = 'Reintentar';
        });
      });
    }
    acciones.appendChild(boton);
    fila.appendChild(acciones);
    return fila;
  }

  /* ------------------------------ Seleccion -------------------------------- */

  function anadir(hit) {
    // El buscador filtra por facetas y es fiable, pero el endpoint de versiones
    // es el unico que confirma que existe un archivo descargable.
    return api.versionesDeProyecto(hit.project_id, estado.cargador.modrinthCargador, estado.version)
      .then(function (versiones) {
        if (!versiones || !versiones.length) return false;
        var v = versiones[0];
        estado.elegidos.set(hit.project_id, {
          id: hit.project_id,
          slug: hit.slug || hit.project_id,
          nombre: hit.title || hit.slug || hit.project_id,
          icono: hit.icon_url || '',
          tipo: hit.project_type || 'mod',
          dependencias: v.dependencies || []
        });
        pintarElegidos();
        revisarRelaciones();
        estado.alCambiar();
        return true;
      });
  }

  function quitar(id) {
    estado.elegidos.delete(id);
    pintarElegidos();
    revisarRelaciones();
    estado.alCambiar();
    // Se vuelve a pintar la lista de resultados para reactivar el boton Anadir.
    if (nodos.resultados.querySelector('.mod')) buscar(estado.consulta, false);
  }

  function pintarElegidos() {
    vaciar(nodos.lista);
    nodos.contador.textContent = String(estado.elegidos.size);

    if (!estado.elegidos.size) {
      var vacio = crear('li', 'lista-elegidos__vacio',
        'Todavia no elegiste ningun ' + singular() +
        '. El servidor se generara sin ' + plural() + '.');
      nodos.lista.appendChild(vacio);
      return;
    }

    estado.elegidos.forEach(function (m) {
      var li = crear('li', 'elegido');
      if (m.icono) {
        var img = document.createElement('img');
        img.className = 'elegido__icono';
        img.src = m.icono;
        img.alt = '';
        img.loading = 'lazy';
        li.appendChild(img);
      } else {
        li.appendChild(crear('span', 'elegido__icono'));
      }
      var texto = crear('div', 'elegido__texto');
      texto.appendChild(crear('span', 'elegido__nombre', m.nombre));
      texto.appendChild(crear('span', 'elegido__slug', m.slug));
      li.appendChild(texto);

      var quita = crear('button', 'boton boton--peligro boton--chico');
      quita.type = 'button';
      quita.appendChild(icono('i-quitar'));
      quita.appendChild(document.createTextNode('Quitar'));
      quita.setAttribute('aria-label', 'Quitar ' + m.nombre);
      quita.addEventListener('click', function () { quitar(m.id); });
      li.appendChild(quita);

      nodos.lista.appendChild(li);
    });
  }

  /* ------------------- Dependencias e incompatibilidades ------------------- */

  /* Se recorre la lista completa cada vez que cambia. Como anadir una
     dependencia vuelve a disparar esta revision, las dependencias de las
     dependencias aparecen solas sin tener que programar un recorrido en
     profundidad. */
  function revisarRelaciones() {
    var faltan = new Set();
    var choques = [];

    estado.elegidos.forEach(function (m) {
      (m.dependencias || []).forEach(function (d) {
        if (!d.project_id) return;
        if (d.dependency_type === 'required' && !estado.elegidos.has(d.project_id)) {
          faltan.add(d.project_id);
        }
        if (d.dependency_type === 'incompatible' && estado.elegidos.has(d.project_id)) {
          choques.push([m, estado.elegidos.get(d.project_id)]);
        }
      });
    });

    pintarIncompatibles(choques);

    if (!faltan.size) {
      nodos.dependencias.hidden = true;
      vaciar(nodos.dependencias);
      return;
    }

    // Una sola peticion para todos los nombres, en vez de una por dependencia.
    api.proyectosPorId(Array.from(faltan)).then(function (proyectos) {
      vaciar(nodos.dependencias);
      nodos.dependencias.hidden = false;
      nodos.dependencias.appendChild(icono('i-aviso'));

      var cuerpo = crear('div');
      cuerpo.appendChild(crear('p', null,
        proyectos.length === 1
          ? 'Falta una dependencia obligatoria:'
          : 'Faltan ' + proyectos.length + ' dependencias obligatorias:'));

      var ul = crear('ul');
      proyectos.forEach(function (p) {
        ul.appendChild(crear('li', null, (p.title || p.slug) + '  (' + p.slug + ')'));
      });
      cuerpo.appendChild(ul);

      var boton = crear('button', 'boton boton--chico', 'Anadirlas todas');
      boton.type = 'button';
      boton.addEventListener('click', function () {
        boton.disabled = true;
        boton.textContent = 'Anadiendo...';
        Promise.all(proyectos.map(function (p) {
          return anadir({
            project_id: p.id, slug: p.slug, title: p.title,
            icon_url: p.icon_url, project_type: p.project_type,
            environment: p.environment
          }).catch(function () { return false; });
        })).then(function () { estado.alCambiar(); });
      });
      cuerpo.appendChild(boton);

      cuerpo.appendChild(crear('p', 'campo__nota',
        'Tambien puedes ignorarlas: la opcion "Descargar dependencias obligatorias" del paso 3 ' +
        'deja que la propia imagen las resuelva al arrancar.'));

      nodos.dependencias.appendChild(cuerpo);
    }).catch(function () {
      nodos.dependencias.hidden = true;
    });
  }

  function pintarIncompatibles(choques) {
    vaciar(nodos.incompatibles);
    if (!choques.length) { nodos.incompatibles.hidden = true; return; }
    nodos.incompatibles.hidden = false;
    nodos.incompatibles.appendChild(icono('i-aviso'));
    var cuerpo = crear('div');
    cuerpo.appendChild(crear('p', null, 'Modrinth declara estas combinaciones como incompatibles:'));
    var ul = crear('ul');
    choques.forEach(function (par) {
      ul.appendChild(crear('li', null, par[0].nombre + ' no puede ir con ' + par[1].nombre + '.'));
    });
    cuerpo.appendChild(ul);
    nodos.incompatibles.appendChild(cuerpo);
  }

  /* ------------------------------- Interfaz -------------------------------- */

  function configurar(version, cargador, alCambiar) {
    estado.version = version;
    estado.cargador = cargador;
    estado.alCambiar = alCambiar || estado.alCambiar;

    // Cambiar de version o de cargador invalida lo elegido: un mod de Fabric
    // para 1.20.1 no vale para NeoForge en 26.2, y dejarlo en la lista
    // generaria un servidor que no arranca.
    estado.elegidos.clear();
    estado.consulta = '';
    estado.desplazamiento = 0;
    nodos.busqueda.value = '';
    pintarElegidos();
    revisarRelaciones();

    if (!cargador.modrinthCargador) return;

    // Los catalogos de Modrinth se piden una vez y quedan 24 horas en
    // localStorage. Si no se pueden traer, se busca igual: perder la validacion
    // es peor que quedarse sin buscador.
    if (estado.etiquetas) { buscar('', false); return; }
    mostrarCargando();
    api.etiquetasModrinth().then(function (t) {
      estado.etiquetas = t;
    }).catch(function () {
      estado.etiquetas = null;
    }).then(function () {
      buscar('', false);
    });
  }

  function iniciar(refs) {
    nodos = refs;
    nodos.masResultados.addEventListener('click', function () { buscar(estado.consulta, true); });
    pintarElegidos();
  }

  global.GM.mods = {
    iniciar: iniciar,
    configurar: configurar,
    buscar: buscar,
    // La reutiliza modpacks.js. Sirve para las dos formas en que Modrinth
    // devuelve este dato: un ARRAY en los resultados del buscador y una CADENA
    // en el endpoint de versiones. La funcion ya normaliza las dos.
    evaluarEntorno: evaluarEntorno,
    elegidos: function () { return Array.from(estado.elegidos.values()); },
    limpiar: function () { estado.elegidos.clear(); pintarElegidos(); revisarRelaciones(); }
  };
})(window);
