# Dependencias vendorizadas

Copias literales, **commiteadas a propósito**. Descargadas el **2026-09-09**:

| fichero | qué es | versión | de dónde |
|---|---|---|---|
| `vue.esm-browser.prod.js` | Vue 3, build ESM para navegador | **3.5.42** | `unpkg.com/vue@3.5.42/dist/` |
| `markdown-it.min.js` | el renderizador de markdown, build UMD | **14.3.1** | `npm pack markdown-it@14` |

## Por qué copiadas y no desde un CDN

Porque **ya dependes de la red para llegar a esta máquina**; añadir que unpkg esté
vivo es una segunda forma de que la app no cargue, y la más difícil de
diagnosticar desde el móvil. Además es requisito para que el service worker pueda
cachear el armazón entero (fase 4).

Y sin bundler: así desplegar sigue siendo `git pull` + reiniciar, que es lo que
permite tocar este repo desde el celular. Un Vite en el droplet convierte cada
cambio de UI en un ritual.

## Por qué markdown-it es UMD y Vue es ESM

No es una elección: `markdown-it@14` **no distribuye ESM** (su `dist/` trae UMD y
CommonJS, comprobado el 2026-09-09 con `npm pack`). Se carga con un `<script>`
normal y deja `window.markdownit`; Vue se importa como módulo. Conviven sin
problema porque el UMD se carga antes.

## Por qué NO está highlight.js

La especificación lo listaba, pero ella misma dice de los bloques de código:
*«monospace con ajuste de línea, sin scroll lateral. Son raros; no merecen plegado
ni botón de copiar propio»* — porque Claude Code **escribe los ficheros** y rara
vez vuelca código al chat. Colorear sintaxis serían ~200 KB más y una dependencia
más que actualizar para algo que la propia especificación descarta. Si algún día
hace falta, se añade aquí sin tocar nada más.

## Al actualizar

Se sustituye el fichero y **se actualiza la versión de esta tabla en el mismo
commit**. Una versión que no se sabe es una versión que no se puede reproducir.
