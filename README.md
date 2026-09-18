# Origin Servers

Generador de configuración para servidores de Minecraft Java.

**https://originservers.github.io/**

Eliges la versión, el cargador de mods y los mods que quieras, y la página te
entrega el `docker-compose.yml`, el `.env` y los comandos exactos, listos para
copiar.

## Lo que hace, y lo que no

**No crea ni aloja servidores.** Es una página estática: no hay máquina detrás
donde ejecutar nada. Lo que hace es escribir la configuración correcta, que es
justo la parte en la que se falla:

- qué versión de Forge va con qué versión de Minecraft,
- qué versión de Java exige cada una,
- qué mods sirven en un servidor y cuáles son solo de cliente,
- qué variables acepta la imagen y cómo se le piden los mods.

El servidor lo levantas tú, en tu PC o en un VPS.

## Qué hay en este repositorio

| Carpeta | Qué es |
|---|---|
| raíz | la página del generador (`index.html`, `assets/`) |
| `ejemplo-valhelsia/` | un ejemplo completo y funcionando: el modpack Valhelsia 6, con su compose y sus scripts de arranque para Windows y Linux |
| `despliegue/` | instalador para VPS, copias de seguridad por rcon y unidades de systemd. Sirve para cualquier servidor, no solo para el ejemplo |

## De dónde salen los datos

La página consulta en vivo, desde el navegador:

- el manifiesto oficial de **Mojang** para las versiones y la versión de Java que
  exige cada una,
- los repositorios de **Forge**, **NeoForge**, **Fabric**, **Quilt**, **Paper** y
  **Purpur** para las versiones de cada cargador,
- la API de **Modrinth** para buscar mods y plugins.

No se guarda ningún catálogo a mano, así que no envejece.

## Cero archivos con copyright

Este repositorio no contiene mods, ni el modpack, ni jars de Minecraft o de
ningún cargador. Todo se descarga en tiempo de ejecución desde sus fuentes
oficiales.

## El EULA

La configuración generada sale siempre con `EULA=FALSE`. Aceptar el acuerdo de
licencia de Minecraft es decisión tuya y tienes que ponerlo a mano.

## Aviso

No está afiliado a Mojang ni a Microsoft. Minecraft es marca registrada de
Mojang Synergies AB.
