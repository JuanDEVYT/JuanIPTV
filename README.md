# JuanIPTV — plugin para Kino

Un plugin para la app Kino que conecta tu servicio de [iptv-factory.com](https://iptv-factory.com)
(o cualquier proveedor con **Xtream Codes API**) a la búsqueda, el Inicio, la sección propia, los canales
en vivo y el reproductor de Kino. Un manifiesto, un archivo JavaScript, sin pasos de compilación.

## Qué hace

| Capacidad   | Cómo                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `home`      | Hasta 20 filas: canales en vivo del primer grupo, películas y series destacadas, más categorías según el catálogo de tu servidor.                                            |
| `search`    | Busca en todo el catálogo de películas y series. `type` de Kino ordena los resultados (el tipo que nombra va primero) pero nunca filtra: una fuente puede tener lo mismo como película y como serie. |
| `browse`    | Paginación de cualquier fila o categoría: `live-cat:`, `vod-cat:`, `ser-cat:`. El cursor es el desplazamiento en la lista, opaco para Kino.                                  |
| `episodes`  | Temporadas y episodios de una serie desde `get_series_info`. La respuesta de Xtream agrupa episodios por número de temporada; el plugin los ordena y expone el selector de temporadas. |
| `resolve`   | URL de reproducción en formato `<servidor>/<tipo>/<usuario>/<contraseña>/<id>.<ext>`. Devuelve alternativas MP4/MKV/TS para que Kino cambie de copia si el aparato no puede decodificar la primera. |
| `channels`  | Pestaña **En vivo** nativa de Kino: categorías desde `get_live_categories`, canales desde `get_live_streams`. Cada canal tiene su número, logo y categoría.                  |
| `scopedSearch` | "Buscar en esta categoría" filtra los títulos ya cargados en esa página contra la consulta, sin llamada extra al servidor.                                               |
| `download`  | Descarga sin conexión para películas y episodios. Kino llama `resolve` en el momento de descargar; el plugin devuelve siempre una URL fresca.                                |

Hay también una **sección propia** (`JuanIPTV` en la barra lateral del TV, chip en el celular) con tres
pestañas — En Vivo, Películas, Series — y mosaicos propios en **Categorías**.

## Xtream Codes API

El plugin habla con el endpoint estándar de Xtream Codes: `<servidor>/player_api.php?username=…&password=…`.
Las llamadas que hace, con sus acciones, son:

| Acción                  | Cuándo la usa               | TTL de caché |
| ----------------------- | --------------------------- | ------------ |
| `get_live_categories`   | Inicio, sección En Vivo, pestaña En vivo | 5 min |
| `get_live_streams`      | Fila de un grupo de canales, Browse       | 5 min |
| `get_vod_categories`    | Inicio, sección Películas, Categorías    | 15 min |
| `get_vod_streams`       | Fila de una categoría VOD, Browse        | 15 min |
| `get_series_categories` | Inicio, sección Series, Categorías       | 15 min |
| `get_series`            | Fila de una categoría de series, Browse  | 15 min |
| `get_series_info`       | Episodios de una serie                   | 15 min |
| `get_vod_streams` (todo)| Búsqueda global de películas             | 15 min |
| `get_series` (todo)     | Búsqueda global de series                | 15 min |

La caché vive en el sandbox de la sesión (variable de módulo). Se reinicia cuando la persona
cambia un ajuste o la app cierra el plugin. La `kino.storage` se usa solo para el estado de conexión
que muestra la pestaña de ajustes.

Las URLs de los streams tienen la forma:

```
<servidor>/live/<usuario>/<contraseña>/<stream_id>.m3u8
<servidor>/movie/<usuario>/<contraseña>/<vod_id>.mkv
<servidor>/series/<usuario>/<contraseña>/<episode_id>.mkv
```

El manifiesto declara `"streamHosts": "any"` para que los CDNs de terceros (los servidores de
caché y relay que usan muchos proveedores IPTV) nunca bloqueen la reproducción. `hosts` está vacío
porque el servidor lo escribe la persona en los ajustes, y Kino lo convierte en un host aprobado
automáticamente.

## Ajustes

| Campo                   | Tipo       | Descripción                                                         |
| ----------------------- | ---------- | ------------------------------------------------------------------- |
| Servidor                | `url`      | Dirección del servidor Xtream: `http://iptv-factory.com:8080`       |
| Usuario                 | `text`     | Tu nombre de usuario en el servicio                                  |
| Contraseña              | `password` | Tu contraseña (se guarda cifrada en el dispositivo)                  |
| Estado de conexión      | `status`   | Muestra "Conectado correctamente" o "Sin conexión" tras la prueba    |
| Probar conexión         | `action`   | Verifica las credenciales con `get_live_categories` y actualiza el estado |
| Formato de stream       | `select`   | HLS m3u8 (por defecto) o MPEG-TS                                     |
| Títulos por fila        | `select`   | 30 / 60 (por defecto) / 100                                          |

Un ajuste `required` sin valor frena cualquier llamada: Kino muestra "Falta configurar" hasta que
la persona complete el servidor, usuario y contraseña.

## Tema de color

El plugin usa la paleta naranja-amarillo sobre fondo oscuro:

| Token        | Valor     | Uso principal                                                        |
| ------------ | --------- | -------------------------------------------------------------------- |
| `accent`     | `#F5A623` | Pestañas, chips, botones, barra de progreso del reproductor          |
| `onAccent`   | `#1A0A00` | Texto e íconos sobre el acento (contraste 9.8:1)                     |
| `background` | `#0D0800` | Fondo de la sección propia y de los ajustes                          |
| `surface`    | `#1C1100` | Tarjetas y pestañas no seleccionadas dentro de la sección            |
| `highlight`  | `#FFD700` | Texto destacado, título del grupo en Categorías (contraste 14:1)     |

Todos los valores pasan los controles de legibilidad de Kino (luminancia, separación de superficies,
distancia con el rojo de Kino `#E50914`). El `color` del manifiesto (`#F5A623`) pinta la pestaña y
los chips del plugin en la tienda, independientemente del tema.

## Instalar en Kino

En Kino abre **Ajustes ▸ Plugins** y escribe la dirección de tu repositorio de GitHub:

```
tu-usuario/juan-iptv
```

Kino lee `kino-plugin.json` y `plugin.js` desde la raíz, muestra con qué va a hablar el plugin
(el servidor que tú escribas en Configurar) y pide aprobación antes de ejecutar nada.

Tras instalar, toca **Configurar** e introduce el servidor, tu usuario y tu contraseña. El botón
**Probar conexión** verifica que las credenciales funcionan antes de que empieces a navegar.

## Probar en local

Clona la carpeta del sdk de cualquier plugin de ejemplo de Kino
([kino-plugin-archive](https://github.com/kinotvapp/kino-plugin-archive) es el más simple) y copia
la carpeta `sdk/` aquí. Luego:

```bash
# Validar el manifiesto y los exports
node sdk/validate.mjs .

# Probar las funciones (necesitas KINO_SERVER, KINO_USER, KINO_PASS)
KINO_SERVER=http://tu-servidor:8080 KINO_USER=user KINO_PASS=pass \
  node sdk/run.mjs . home

node sdk/run.mjs . search "breaking bad"
node sdk/run.mjs . browse "vod-cat:1" null
node sdk/run.mjs . episodes "ser:12345"
node sdk/run.mjs . resolve "vod:67890:mkv"

# Probar los colores del tema
node sdk/run.mjs . theme

# Probar la sección propia
node sdk/run.mjs . section live
node sdk/run.mjs . section peliculas
node sdk/run.mjs . categories
```

El kit de Node simula `kino.config`, `kino.fetch`, `kino.storage` y `kino.error` con el mismo
comportamiento que la app. Las respuestas del servidor real se pueden grabar con `--record` y
reproducir sin conexión con `--replay`.

## Estructura del repositorio

```
kino-plugin.json   manifiesto (id, hosts, capabilities, theme, section, settings)
plugin.js          código del plugin: módulo ES, sin dependencias externas
README.md          este archivo
icon.png           ícono cuadrado opcional, máximo 128 KB (añádelo tú)
sdk/               kit de Node para probar en local (cópialo de kino-plugin-archive)
```

## Nota sobre el servicio

Este plugin es solo el conector entre Kino y tu proveedor de IPTV. No distribuye ni aloja
contenido. Es tu responsabilidad usar el plugin con una suscripción válida a tu servicio y respetar
los términos de ese servicio.
