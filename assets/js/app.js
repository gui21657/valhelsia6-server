/* ==========================================================================
   app.js - une las piezas: catalogos, formulario y salida.
   ========================================================================== */
(function (global) {
  'use strict';

  var api = global.GM.api;
  var compat = global.GM.compat;
  var gen = global.GM.generador;
  var mods = global.GM.mods;

  var $ = function (id) { return document.getElementById(id); };

  var catalogos = null;
  var eleccion = { version: null, cargador: null, java: null, javaMotivo: '', avisoCargador: '' };

  /* Testigo de seleccion. Las consultas de Java y del canal de Paper son
     asincronas y escriben en `eleccion` al volver. Si el usuario cambia de
     version o de cargador mientras tanto, la respuesta atrasada pertenece a
     otra seleccion y hay que tirarla: aplicarla dejaba la etiqueta de Java de
     la version ANTERIOR en el compose, en silencio, con un comentario
     afirmando que Mojang la declara. Un servidor 26.3 no arranca con java8. */
  var tokenSeleccion = 0;
  var ultimos = { compose: '', env: '', comandos: '' };
  var rconPassword = gen.aleatorio(20);
  var temporizadorBusqueda = null;

  /* ------------------------------ Utilidades ------------------------------- */

  function crear(etiqueta, clase, texto) {
    var n = document.createElement(etiqueta);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }

  function vaciar(nodo) { while (nodo.firstChild) nodo.removeChild(nodo.firstChild); }

  function entero(nodo, porDefecto) {
    var v = parseInt(nodo.value, 10);
    if (isNaN(v)) return porDefecto;
    var min = parseInt(nodo.min, 10), max = parseInt(nodo.max, 10);
    if (!isNaN(min) && v < min) v = min;
    if (!isNaN(max) && v > max) v = max;
    return v;
  }

  /* ------------------------------- Arranque -------------------------------- */

  function iniciar() {
    // Zona horaria del propio navegador: mejor que inventar una por defecto.
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) $('zona-horaria').value = tz;
    } catch (e) { /* se queda UTC */ }

    mods.iniciar({
      resultados: $('resultados-mods'),
      paginacion: $('paginacion-mods'),
      masResultados: $('mas-resultados'),
      cuentaResultados: $('cuenta-resultados'),
      lista: $('lista-elegidos'),
      contador: $('contador-mods'),
      dependencias: $('dependencias'),
      incompatibles: $('incompatibles'),
      busqueda: $('busqueda-mods')
    });

    pintarFuentes();
    conectarFormulario();
    cargar();
  }

  function cargar() {
    $('carga-catalogos').hidden = false;
    $('error-catalogos').hidden = true;
    $('bloque-version').hidden = true;

    compat.cargarCatalogos().then(function (c) {
      catalogos = c;
      $('carga-catalogos').hidden = true;
      $('bloque-version').hidden = false;
      pintarVersiones();
      pintarCargadores();
      elegirPorDefecto();
      notaDeVersion();
    }).catch(function (e) {
      // Se deja rastro en la consola porque aqui puede caer tanto un fallo de
      // red como un error de programacion al pintar, y desde fuera se ven igual.
      if (global.console && console.error) console.error('[generador] fallo al cargar catalogos', e);
      $('carga-catalogos').hidden = true;
      $('error-catalogos').hidden = false;
      $('error-catalogos-detalle').textContent = (e && e.message) ||
        'No se pudo contactar con el manifiesto de versiones de Mojang. ' +
        'Comprueba tu conexion o si algun bloqueador esta cortando la peticion.';
    });
  }

  /* ----------------------------- Paso 1: version --------------------------- */

  function pintarVersiones() {
    var sel = $('version');
    vaciar(sel);
    var mc = catalogos.minecraft;

    var grupoUltima = document.createElement('optgroup');
    grupoUltima.label = 'Ultima version publicada';
    var op = crear('option', null, mc.lista[0]);
    op.value = mc.lista[0];
    grupoUltima.appendChild(op);
    sel.appendChild(grupoUltima);

    var grupo = document.createElement('optgroup');
    grupo.label = 'Todas las versiones estables (' + mc.lista.length + ')';
    mc.lista.forEach(function (v) {
      var o = crear('option', null, v);
      o.value = v;
      grupo.appendChild(o);
    });
    sel.appendChild(grupo);

    sel.value = mc.lista[0];
  }

  function pintarCargadores() {
    var caja = $('cargadores');
    vaciar(caja);
    compat.CARGADORES.forEach(function (meta) {
      var etiqueta = crear('label', 'cargador');
      etiqueta.dataset.clave = meta.clave;

      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'cargador';
      radio.value = meta.clave;
      radio.addEventListener('change', function () {
        if (radio.checked) alCambiarCargador(meta.clave);
      });
      etiqueta.appendChild(radio);

      var nombre = crear('span', 'cargador__nombre');
      nombre.appendChild(crear('span', null, meta.nombre));
      nombre.appendChild(crear('span', 'etiqueta-mini', ''));
      etiqueta.appendChild(nombre);

      etiqueta.appendChild(crear('p', 'cargador__desc', meta.desc));
      etiqueta.appendChild(crear('p', 'cargador__estado', ''));
      caja.appendChild(etiqueta);
    });
  }

  function actualizarCargadores() {
    var version = $('version').value;
    var seleccionadoSigueValiendo = false;

    compat.CARGADORES.forEach(function (meta) {
      var etiqueta = $('cargadores').querySelector('[data-clave="' + meta.clave + '"]');
      var radio = etiqueta.querySelector('input');
      var insignia = etiqueta.querySelector('.etiqueta-mini');
      var linea = etiqueta.querySelector('.cargador__estado');

      var est = compat.estadoDe(meta.clave, version, catalogos);
      etiqueta.dataset.estado = est.estado;

      linea.className = 'cargador__estado';
      vaciar(insignia);
      insignia.className = 'etiqueta-mini';

      if (est.estado === 'si') {
        radio.disabled = false;
        etiqueta.classList.remove('cargador--no');
        linea.classList.add('cargador__estado--si');
        linea.textContent = est.texto;
        insignia.classList.add('etiqueta-mini--ok');
        insignia.textContent = 'disponible';
      } else if (est.estado === 'beta') {
        radio.disabled = false;
        etiqueta.classList.remove('cargador--no');
        linea.classList.add('cargador__estado--beta');
        linea.textContent = est.texto;
        insignia.classList.add('etiqueta-mini--aviso');
        insignia.textContent = 'beta';
      } else {
        radio.disabled = true;
        radio.checked = false;
        etiqueta.classList.add('cargador--no');
        linea.classList.add(est.estado === 'duda' ? 'cargador__estado--beta' : 'cargador__estado--no');
        linea.textContent = est.texto;
        insignia.classList.add(est.estado === 'duda' ? 'etiqueta-mini--aviso' : 'etiqueta-mini--error');
        insignia.textContent = est.estado === 'duda' ? 'sin comprobar' : 'no existe';
      }

      if (meta.reservas && est.estado !== 'no') {
        linea.textContent = est.texto + ' ' + meta.reservas;
      }

      // aria-disabled ademas de disabled para que el lector de pantalla anuncie
      // la tarjeta aunque el navegador la saque del recorrido de tabulacion.
      etiqueta.setAttribute('aria-disabled', String(radio.disabled));

      if (radio.checked && !radio.disabled) seleccionadoSigueValiendo = true;
    });

    return seleccionadoSigueValiendo;
  }

  function elegirPorDefecto() {
    actualizarCargadores();
    var preferencia = ['fabric', 'neoforge', 'forge', 'paper', 'purpur', 'quilt', 'vanilla'];
    for (var i = 0; i < preferencia.length; i++) {
      var etiqueta = $('cargadores').querySelector('[data-clave="' + preferencia[i] + '"]');
      if (etiqueta && etiqueta.dataset.estado === 'si') {
        etiqueta.querySelector('input').checked = true;
        alCambiarCargador(preferencia[i]);
        return;
      }
    }
    var vanilla = $('cargadores').querySelector('[data-clave="vanilla"] input');
    vanilla.checked = true;
    alCambiarCargador('vanilla');
  }

  function alCambiarVersion() {
    var seguiaValiendo = actualizarCargadores();
    notaDeVersion();
    if (!seguiaValiendo) {
      elegirPorDefecto();
    } else {
      var marcado = $('cargadores').querySelector('input[name="cargador"]:checked');
      alCambiarCargador(marcado.value);
    }
  }

  function notaDeVersion() {
    var version = $('version').value;
    var nota = $('nota-version');
    var faltan = compat.CARGADORES.filter(function (m) {
      return compat.estadoDe(m.clave, version, catalogos).estado === 'no';
    }).map(function (m) { return m.nombre; });

    if (!faltan.length) { nota.hidden = true; return; }
    var enumerado = faltan.length === 1
      ? faltan[0]
      : faltan.slice(0, -1).join(', ') + ' ni ' + faltan[faltan.length - 1];
    nota.hidden = false;
    nota.textContent = 'Para Minecraft ' + version + ' todavia no existe ' + enumerado +
      '. No es un fallo de la pagina: esos proyectos aun no han publicado nada para esta version. ' +
      'Si los necesitas, elige una version anterior.';
  }

  function alCambiarCargador(clave) {
    var miToken = ++tokenSeleccion;
    var meta = compat.porClave(clave);
    var version = $('version').value;
    eleccion.version = version;
    eleccion.cargador = meta;
    eleccion.avisoCargador = '';

    var est = compat.estadoDe(clave, version, catalogos);
    if (est.estado === 'beta') {
      eleccion.avisoCargador = 'Atencion: para esta version solo hay compilaciones de prueba de ' +
        meta.nombre + ' (' + (est.build || 'beta') + ').';
    }

    // Paso 2: los servidores vanilla no cargan mods ni plugins.
    var admite = !!meta.modrinthCargador;
    $('bloque-mods').hidden = !admite;
    $('aviso-mods-desactivado').hidden = admite;
    if (!admite) {
      var texto = $('aviso-mods-desactivado-texto');
      vaciar(texto);
      texto.appendChild(crear('p', null,
        'El servidor Vanilla es el oficial de Mojang y no carga mods ni plugins. ' +
        'Si quieres mods, vuelve al paso 1 y elige Fabric, NeoForge, Forge o Quilt; ' +
        'si quieres plugins, elige Paper o Purpur.'));
      mods.limpiar();
    } else {
      mods.configurar(version, meta, regenerar);
    }

    // Java: se lee del propio JSON de Mojang para esta version concreta.
    var entrada = catalogos.minecraft.porId[version];
    api.javaDeVersion(entrada).then(function (mayor) {
      if (miToken !== tokenSeleccion) return;
      aplicarJava(mayor);
    }).catch(function () {
      if (miToken !== tokenSeleccion) return;
      aplicarJava(null);
    });

    // Paper puede servir compilaciones en canal ALPHA para versiones recien
    // salidas. El canal solo se sabe consultando la build, asi que se pide solo
    // cuando hace falta.
    if (clave === 'paper') {
      api.paperBuild(version).then(function (b) {
        if (miToken !== tokenSeleccion) return;
        if (b.canal && b.canal.toUpperCase() !== 'STABLE') {
          eleccion.avisoCargador = 'Atencion: la compilacion mas reciente de Paper para ' + version +
            ' esta en canal ' + b.canal + ' (build ' + b.id + '), no es para produccion.';
          actualizarResumen();
          regenerar();
        }
      }).catch(function () { /* el aviso es informativo; si falla, no se muestra */ });
    }

    actualizarResumen();
    regenerar();
  }

  function aplicarJava(mayor) {
    var anterior118 = compat.esAnteriorA(eleccion.version, '1.18', catalogos.minecraft);
    var r = compat.etiquetaJava(mayor, eleccion.cargador.id, anterior118);
    eleccion.java = r.etiqueta;
    eleccion.javaMotivo = r.motivo;
    actualizarResumen();
    regenerar();
  }

  function actualizarResumen() {
    var caja = $('resumen-eleccion');
    if (!eleccion.cargador) { caja.hidden = true; return; }
    caja.hidden = false;
    vaciar(caja);

    var dl = document.createElement('dl');
    function fila(clave, valor) {
      dl.appendChild(crear('dt', null, clave));
      dl.appendChild(crear('dd', null, valor));
    }
    fila('Minecraft', eleccion.version);
    fila('Cargador', eleccion.cargador.nombre + ' (TYPE=' + eleccion.cargador.id + ')');
    fila('Imagen', 'itzg/minecraft-server:' + (eleccion.java || 'latest'));
    fila('Por que ese Java', eleccion.javaMotivo || 'Comprobando...');
    caja.appendChild(dl);

    if (eleccion.avisoCargador) {
      var aviso = crear('p', 'cargador__estado cargador__estado--beta', eleccion.avisoCargador);
      caja.appendChild(aviso);
    }
  }

  /* ------------------------------ Paso 3 y 4 ------------------------------- */

  function conectarFormulario() {
    $('version').addEventListener('change', alCambiarVersion);

    var campos = ['memoria', 'dificultad', 'modo-juego', 'max-jugadores', 'motd',
                  'distancia-vision', 'distancia-simulacion', 'puerto', 'mundo',
                  'zona-horaria', 'operadores', 'modo-online', 'flags-aikar',
                  'copias', 'deps-modrinth'];
    campos.forEach(function (id) {
      var n = $(id);
      n.addEventListener('input', regenerar);
      n.addEventListener('change', regenerar);
    });

    // Retraso antes de consultar: el limite de Modrinth es de 300 peticiones por
    // minuto y por IP, compartido con cualquiera que salga a internet por la
    // misma linea. Escribir "create" no debe costar seis busquedas.
    $('busqueda-mods').addEventListener('input', function (e) {
      clearTimeout(temporizadorBusqueda);
      var texto = e.target.value.trim();
      if (texto.length === 1) return;
      temporizadorBusqueda = setTimeout(function () { mods.buscar(texto, false); }, 400);
    });

    document.querySelectorAll('[data-copiar]').forEach(function (b) {
      b.addEventListener('click', function () { copiar(b.dataset.copiar); });
    });
    document.querySelectorAll('[data-descargar]').forEach(function (b) {
      b.addEventListener('click', function () { descargar(b.dataset.descargar); });
    });

    $('reintentar-catalogos').addEventListener('click', cargar);
  }

  function reunirConfiguracion() {
    var lista = mods.elegidos();
    return {
      version: eleccion.version,
      cargador: eleccion.cargador,
      tipo: eleccion.cargador.id,
      etiquetaJava: eleccion.java || 'latest',
      javaMotivo: eleccion.javaMotivo || 'Etiqueta por defecto.',
      avisoCargador: eleccion.avisoCargador,
      nombreContenedor: 'minecraft',
      memoria: entero($('memoria'), 4) + 'G',
      dificultad: $('dificultad').value,
      modoJuego: $('modo-juego').value,
      maxJugadores: entero($('max-jugadores'), 10),
      motd: $('motd').value,
      distanciaVision: entero($('distancia-vision'), 10),
      distanciaSimulacion: entero($('distancia-simulacion'), 10),
      puerto: entero($('puerto'), 25565),
      mundo: $('mundo').value.trim() || 'world',
      zonaHoraria: $('zona-horaria').value.trim() || 'UTC',
      operadores: $('operadores').value.trim(),
      modoOnline: $('modo-online').checked,
      aikar: $('flags-aikar').checked,
      copias: $('copias').checked,
      depsModrinth: $('deps-modrinth').checked,
      rconPassword: rconPassword,
      mods: lista
    };
  }

  function regenerar() {
    if (!eleccion.cargador || !eleccion.version) return;
    var cfg = reunirConfiguracion();

    ultimos.compose = gen.construirCompose(cfg);
    ultimos.env = gen.construirEnv(cfg);
    ultimos.comandos = gen.construirComandos(cfg);

    var c = $('codigo-compose');
    vaciar(c); c.appendChild(gen.resaltarYaml(ultimos.compose));

    var e = $('codigo-env');
    vaciar(e); e.appendChild(gen.resaltarShell(ultimos.env));

    var m = $('codigo-comandos');
    vaciar(m); m.appendChild(gen.resaltarShell(ultimos.comandos));

    notaDeMemoria(cfg);
  }

  /* Nota de memoria. Solo se citan cifras que tienen fuente publicada; el tramo
     intermedio se declara como lo que es, una eleccion sin respaldo primario. */
  function notaDeMemoria(cfg) {
    var n = cfg.mods.length;
    var texto;
    if (n === 0) {
      texto = 'Sin mods, el tutorial de servidor de minecraft.wiki habla de tener al menos 2 GB ' +
              'disponibles, y hasta 4 GB para servidores mas grandes.';
    } else if (n <= 40) {
      var plural = cfg.cargador.modrinthTipo === 'plugin' ? 'plugin' : 'mod';
      texto = 'Con ' + n + ' ' + plural + (n === 1 ? '' : 's') + ', no hay ninguna fuente primaria que ' +
              'diga cuanta memoria hace falta: depende de cuales sean. Lo que elijas aqui es una ' +
              'estimacion tuya, no un requisito con fuente.';
    } else {
      texto = 'Como referencia de un paquete grande: la web oficial de All the Mods 10 pide 10 GB ' +
              'para 2 a 5 jugadores y avisa de no pasar de 12 GB, porque el exceso provoca pausas ' +
              'del recolector de basura.';
    }
    $('nota-memoria').textContent = texto;
  }

  /* -------------------------- Copiar y descargar --------------------------- */

  function avisarCopia(texto) {
    var n = $('aviso-copia');
    n.textContent = texto;
    clearTimeout(avisarCopia.reloj);
    avisarCopia.reloj = setTimeout(function () { n.textContent = ''; }, 4000);
  }

  function textoDe(idNodo) {
    if (idNodo === 'codigo-compose') return ultimos.compose;
    if (idNodo === 'codigo-env') return ultimos.env;
    return ultimos.comandos;
  }

  /* Copiar es el camino principal y tiene que funcionar siempre, asi que hay
     tres intentos: la API moderna, el metodo viejo con un textarea, y como
     ultimo recurso seleccionar el bloque para que el usuario pulse Control+C. */
  function copiar(idNodo) {
    var texto = textoDe(idNodo);
    if (!texto) return;

    if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(texto).then(function () {
        avisarCopia('Copiado al portapapeles.');
      }, function () { copiarAlternativo(texto, idNodo); });
    } else {
      copiarAlternativo(texto, idNodo);
    }
  }

  function copiarAlternativo(texto, idNodo) {
    var area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var bien = false;
    try { bien = document.execCommand('copy'); } catch (e) { bien = false; }
    document.body.removeChild(area);

    if (bien) { avisarCopia('Copiado al portapapeles.'); return; }

    var nodo = document.getElementById(idNodo);
    var rango = document.createRange();
    rango.selectNodeContents(nodo);
    var sel = global.getSelection();
    sel.removeAllRanges();
    sel.addRange(rango);
    avisarCopia('El navegador no deja copiar solo. Ya te lo dejamos seleccionado: pulsa Control+C.');
  }

  function descargar(cual) {
    var nombres = { compose: 'docker-compose.yml', env: '.env' };
    var texto = cual === 'compose' ? ultimos.compose : ultimos.env;
    if (!texto) return;
    try {
      var blob = new Blob([texto], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = nombres[cual];
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      avisarCopia('Si no aparecio ninguna descarga, usa el boton de copiar.');
    } catch (e) {
      avisarCopia('Este navegador bloqueo la descarga. Usa el boton de copiar.');
    }
  }

  /* -------------------------------- Fuentes -------------------------------- */

  function pintarFuentes() {
    var ul = $('lista-fuentes');
    var fuentes = [
      ['Versiones de Minecraft y version de Java', 'piston-meta.mojang.com (manifiesto oficial de Mojang)'],
      ['Compilaciones de Forge', 'maven.minecraftforge.net'],
      ['Compilaciones de NeoForge', 'maven.neoforged.net'],
      ['Versiones de Fabric', 'meta.fabricmc.net'],
      ['Versiones de Quilt', 'meta.quiltmc.org'],
      ['Compilaciones de Paper', 'fill.papermc.io (la API v2 fue retirada)'],
      ['Versiones de Purpur', 'api.purpurmc.org'],
      ['Mods y plugins', 'api.modrinth.com (API publica, sin clave)'],
      ['Imagen del servidor', 'itzg/minecraft-server, documentada en docker-minecraft-server.readthedocs.io']
    ];
    fuentes.forEach(function (f) {
      var li = document.createElement('li');
      li.appendChild(crear('strong', null, f[0] + ':'));
      li.appendChild(crear('span', null, f[1]));
      ul.appendChild(li);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})(window);
