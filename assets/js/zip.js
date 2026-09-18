/* ==========================================================================
   zip.js - constructor de archivos ZIP, escrito aqui y sin dependencias.
   ==========================================================================
   Un ZIP con metodo STORE (guardar sin comprimir) son tres piezas y nada mas:
   una cabecera local delante de cada archivo, un directorio central al final
   con una copia de esos mismos datos, y un registro EOCD que dice donde
   empieza ese directorio. Lo que este generador mete dentro son unos pocos KB
   de texto: comprimir no ahorraria nada apreciable y obligaria a traer una
   libreria entera, que es justo lo que este proyecto no hace.

   Detalles que rompen el archivo si se descuidan, y que estan resueltos aqui:

   - Las fechas van en formato MS-DOS (dos campos de 16 bits), NO en epoch.
     El ano se cuenta desde 1980 y los segundos van divididos entre dos, asi
     que la marca de tiempo de un ZIP tiene resolucion de dos segundos.
   - El CRC-32 y los dos tamanos se escriben DOS veces, en la cabecera local y
     otra vez en el directorio central. Si las copias no coinciden, muchos
     descompresores abren el archivo igual, pero el Explorador de Windows lo
     da por corrupto. Aqui se calculan una vez y se reutilizan.
   - Los nombres van en UTF-8 con el bit 11 de las banderas generales puesto.
     Sin ese bit, el nombre se interpreta en la pagina de codigos del sistema.
   - Todos los enteros son little-endian, incluidas las firmas.

   Limites aceptados a proposito: no se implementa ZIP64, asi que no se puede
   pasar de 4 GB ni de 65535 archivos. Para tres archivos de texto sobra.
   ========================================================================== */
(function (global) {
  'use strict';

  /* --------------------------------- CRC-32 -------------------------------- */

  /* Tabla del polinomio 0xEDB88320, que es el 0x04C11DB7 con los bits al
     reves. Se construye una sola vez al cargar el archivo: son 256 entradas y
     tarda menos de un milisegundo. */
  var TABLA_CRC = (function () {
    var tabla = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      tabla[n] = c;
    }
    return tabla;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = TABLA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    // El >>> 0 convierte el entero con signo de 32 bits en uno sin signo, que
    // es lo que hay que escribir en el archivo.
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ------------------------------ Texto a UTF-8 ---------------------------- */

  /* TextEncoder existe en todo navegador actual, pero la funcion de reserva no
     cuesta nada y evita que la descarga entera se caiga en uno viejo. La
     reserva codifica a mano, incluidos los pares sustitutos: un emoji o
     cualquier caracter fuera del plano basico llega como dos unidades UTF-16
     que hay que recomponer antes de codificar. */
  function aUtf8(texto) {
    var s = String(texto === null || texto === undefined ? '' : texto);
    if (global.TextEncoder) return new TextEncoder().encode(s);

    var salida = [];
    for (var i = 0; i < s.length; i++) {
      var cp = s.charCodeAt(i);
      if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < s.length) {
        var bajo = s.charCodeAt(i + 1);
        if (bajo >= 0xDC00 && bajo <= 0xDFFF) {
          cp = 0x10000 + ((cp - 0xD800) << 10) + (bajo - 0xDC00);
          i++;
        }
      }
      if (cp < 0x80) {
        salida.push(cp);
      } else if (cp < 0x800) {
        salida.push(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F));
      } else if (cp < 0x10000) {
        salida.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      } else {
        salida.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F),
                    0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      }
    }
    return new Uint8Array(salida);
  }

  /* ----------------------------- Fecha MS-DOS ------------------------------ */

  /* Dos campos de 16 bits heredados de MS-DOS:
       hora = hh<<11 | mm<<5 | ss/2      (los segundos pierden el bit bajo)
       fecha = (ano-1980)<<9 | mes<<5 | dia   (mes de 1 a 12, dia de 1 a 31)
     El reloj del navegador puede estar en cualquier ano; por debajo de 1980 el
     campo no tiene forma de representarlo, asi que se recorta al minimo. Por
     arriba, 1980+127 = 2107 es el techo del formato. */
  function fechaDos(fecha) {
    var ano = fecha.getFullYear();
    if (ano < 1980) return { hora: 0, fecha: (1 << 5) | 1 };   // 1 de enero de 1980
    if (ano > 2107) ano = 2107;
    return {
      hora: (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | (fecha.getSeconds() >> 1),
      fecha: ((ano - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate()
    };
  }

  /* --------------------------- Escritura de bytes -------------------------- */

  // Acumulador simple. Todo se escribe little-endian, que es lo que pide el
  // formato para absolutamente todos sus campos numericos.
  function Bloque() {
    this.trozos = [];
    this.largo = 0;
  }
  Bloque.prototype.u16 = function (v) {
    this.trozos.push(new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF]));
    this.largo += 2;
  };
  Bloque.prototype.u32 = function (v) {
    this.trozos.push(new Uint8Array([
      v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF
    ]));
    this.largo += 4;
  };
  Bloque.prototype.bytes = function (b) {
    this.trozos.push(b);
    this.largo += b.length;
  };
  Bloque.prototype.unir = function () {
    var salida = new Uint8Array(this.largo);
    var pos = 0;
    for (var i = 0; i < this.trozos.length; i++) {
      salida.set(this.trozos[i], pos);
      pos += this.trozos[i].length;
    }
    return salida;
  };

  var FIRMA_LOCAL   = 0x04034B50;
  var FIRMA_CENTRAL = 0x02014B50;
  var FIRMA_EOCD    = 0x06054B50;

  // Version 2.0 (el 20 se lee como 2.0): es la minima que admite carpetas y el
  // metodo de guardado, y la que espera cualquier descompresor.
  var VERSION = 20;
  // Bit 11: los nombres van en UTF-8. Es el unico bit que se pone.
  var BANDERA_UTF8 = 0x0800;
  var METODO_GUARDAR = 0;

  /* ------------------------------ Construccion ----------------------------- */

  /* archivos: [{ nombre: 'docker-compose.yml', texto: '...' }]
     Devuelve un Blob con tipo application/zip. */
  function construir(archivos, cuando) {
    var fecha = fechaDos(cuando || new Date());
    var local = new Bloque();
    var central = new Bloque();
    var entradas = 0;

    archivos.forEach(function (archivo) {
      var nombre = aUtf8(archivo.nombre);
      var datos = aUtf8(archivo.texto);
      var crc = crc32(datos);
      // Con el metodo de guardado, el tamano comprimido y el original son el
      // mismo numero. Se calcula una vez y se escribe en las dos cabeceras.
      var tam = datos.length;
      var desplazamiento = local.largo;   // donde empieza ESTA cabecera local

      // ---- Cabecera local, delante de los datos del archivo ----
      local.u32(FIRMA_LOCAL);
      local.u16(VERSION);
      local.u16(BANDERA_UTF8);
      local.u16(METODO_GUARDAR);
      local.u16(fecha.hora);
      local.u16(fecha.fecha);
      local.u32(crc);
      local.u32(tam);          // tamano comprimido
      local.u32(tam);          // tamano original
      local.u16(nombre.length);
      local.u16(0);            // sin campo extra
      local.bytes(nombre);
      local.bytes(datos);

      // ---- Entrada del directorio central, con los MISMOS valores ----
      central.u32(FIRMA_CENTRAL);
      // Byte alto = sistema de origen (0 = MS-DOS/FAT, el valor neutro).
      // Byte bajo = version del formato.
      central.u16(VERSION);
      central.u16(VERSION);
      central.u16(BANDERA_UTF8);
      central.u16(METODO_GUARDAR);
      central.u16(fecha.hora);
      central.u16(fecha.fecha);
      central.u32(crc);
      central.u32(tam);
      central.u32(tam);
      central.u16(nombre.length);
      central.u16(0);          // sin campo extra
      central.u16(0);          // sin comentario
      central.u16(0);          // numero de disco: siempre 0, esto no son disquetes
      central.u16(0);          // atributos internos
      central.u32(0);          // atributos externos: 0 deja que decida el sistema
      central.u32(desplazamiento);
      central.bytes(nombre);

      entradas++;
    });

    var cuerpo = local.unir();
    var indice = central.unir();

    // ---- EOCD: el unico sitio por el que un descompresor sabe empezar ----
    var fin = new Bloque();
    fin.u32(FIRMA_EOCD);
    fin.u16(0);                 // numero de este disco
    fin.u16(0);                 // disco donde empieza el directorio central
    fin.u16(entradas);          // entradas en este disco
    fin.u16(entradas);          // entradas en total
    fin.u32(indice.length);     // tamano del directorio central
    fin.u32(cuerpo.length);     // donde empieza, contado desde el inicio del archivo
    fin.u16(0);                 // sin comentario final
    var cola = fin.unir();

    return new Blob([cuerpo, indice, cola], { type: 'application/zip' });
  }

  global.GM = global.GM || {};
  global.GM.zip = {
    construir: construir,
    crc32: crc32,
    aUtf8: aUtf8,
    fechaDos: fechaDos
  };
})(window);
