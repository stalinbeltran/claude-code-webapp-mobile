# Plan detallado

Desglose de [`plan-general.md`](plan-general.md) en tareas. **Nada de esto está
implementado.** Escrito el 2026-09-09.

**Cómo se lee cada tarea**

- **dónde** — repo y fichero. `[coord]` = `telegram-coordinator`,
  `[web]` = este repo, `[lanzador]` = `digital-ocean-dropplet-auto-launching`.
- **prueba** — la que va **en el mismo commit** (R17). Si dice «a mano», es que
  no se pudo automatizar y eso es deuda declarada.
- **terminado cuando** — el criterio, escrito **antes** de hacerlo (R13).

✅ **Decidido el 2026-09-09 (P1): el reparto es el B** — el log en el
coordinador, el servidor y el frontend aquí, con unidad propia. Las tareas `[B]`
van; las `[A]` se descartaron y se dejan escritas sólo para que se vea qué se
consideró. Todas las decisiones, en [`decisiones.md`](decisiones.md).

⚠ Las tareas marcadas **⏸ bloqueada por Pn** no se pueden empezar sin esa
respuesta. Las demás sí.

---

## Fase 0 · Los títulos, hoy y solas

> Único trabajo con reloj: lo que no se capture, no se puede recuperar.

⏸⏸ **T0.1 y T0.2 EN SUSPENSO desde el 2026-09-09, esperando
[P9](decisiones.md#p9--el-nombre-de-cada-tema-en-la-app).** El dueño pidió
nombres «distintos y numerados» y fijos, lo que apunta a que esta fase **no hace
falta** y se borra entera. Se deja escrita —y no se ejecuta— hasta aclararlo,
porque es la única del proyecto cuyo coste crece mientras se espera.
**T0.3 va igual**, se decida lo que se decida: no tiene nada que ver con títulos.

### T0.1 · Escuchar `forum_topic_created` y `forum_topic_edited`

- **dónde** `[coord] src/bot.ts` — dos handlers nuevos; `src/temas.ts` (nuevo)
  para leer/escribir `data/temas.json`.
- **qué** Guardar `{ "<chatId>_<threadId>": { titulo, fuente: "telegram", visto } }`.
  `data/temas.json` es **estado**, se reescribe entero (**R8**); no es historial.
- ⚠ **el detalle que muerde**: el middleware de allowlist (`src/bot.ts:191-196`)
  corta **todo** lo que no venga de un id permitido, y un evento de servicio lo
  genera **quien creó o renombró el tema**. Si algún día lo hace otra persona (o
  el propio bot), el título se pierde en silencio. → **[P9](decisiones.md)**
- **prueba** `tests/temas.test.mjs`: un `forum_topic_edited` pisa el título
  anterior; un tema sin evento no aparece en el fichero.
- **terminado cuando** renombrar un tema en Telegram cambia la línea de
  `data/temas.json` sin reiniciar nada.

### T0.2 · La cadena de respaldo, y que se sepa de dónde viene el título

- **dónde** `[coord] src/temas.ts`
- **qué** `tituloDe(sesión)` → 1) el de Telegram si se vio el evento; 2) la
  primera línea del primer mensaje del usuario, recortada a ~40 caracteres;
  3) `Tema <id>`. **Devuelve también `fuente`**: la especificación exige
  distinguir *«título heredado»* de *«título de Telegram»*, o un nombre viejo
  parece un fallo.
- ⚠ El nivel 2 **necesita el log de la fase 1**. Hasta entonces, salta al 3.
- **prueba** los tres niveles, y que `fuente` sale correcta en cada uno.
- **terminado cuando** un tema sin evento y sin log da `Tema <id>` con
  `fuente: "id"`, y no un `undefined`.

### T0.3 · ⚠ Meter este repo en el freno — medido hoy, y hoy miente

- **dónde** `[coord] scripts/cerrable.mjs` (la lista declarada de repos)
- **qué** Añadir `claude-code-webapp-mobile` a los siete repos que el freno
  vigila.
- **por qué, y no es teórico.** Medido el 2026-09-09, con los tres documentos de
  este plan escritos y **sin commitear**:

  ```
  $ node scripts/cerrable.mjs --breve
  🟢 **CERRABLE** — nada alquilado, nada corriendo, todo empujado
  ```

  O sea **permiso para destruir la máquina** con trabajo sin empujar dentro. Es
  el mismo fallo que ese script ya documenta haber cometido dos veces —con
  `foveal-vision-data` el 2026-08-28 y con `estudios-redes-neuronales` el
  2026-08-29—, *«silencioso y creíble»*, y por la misma causa: **la lista es
  declarada, así que un repo nuevo es invisible hasta que alguien lo apunta**.
- ⚠ El bucle **salta los repos que no están en disco**, así que añadirlo no rompe
  ninguna máquina que no lo tenga clonado — está escrito así en su propia
  cabecera.
- **prueba** con un fichero sin commitear en este repo, `cerrable.mjs --breve`
  **no** puede decir 🟢.
- **terminado cuando** el falso verde de arriba ya no se reproduce.

---

## Fase 1 · `publicar()` y el log

### T1.1 · El módulo del log

- **dónde** `[coord] src/mensajes.ts` (nuevo)
- **qué** `publicar({sesion, autor, texto, origen})` → una línea JSON con
  `O_APPEND`. Se copia la forma de `scripts/errores.mjs`, que ya resuelve esto
  para otro contenido.
- **las cinco reglas que hay que respetar, y cada una es un fallo ya pagado aquí**:
  1. **`publicar()` NUNCA lanza.** Todo en `try/catch`; lo peor que pasa es un
     `console.error`. Es la regla 3 del coordinador aplicada al que registra
     — igual que la tiene escrita `errores.mjs` en su cabecera.
  2. **`DATA_DIR` se resuelve en UNA sola función, con fallback a `COORD_HOME`,
     nunca a `'data'`.** Con el fallback relativo, un tema atado a un workspace
     parte el log en dos sin dar ningún error (§ 4 del plan general).
  3. **Tope por mensaje**, y cuando corte **que lo diga en el propio texto**
     (`[… recortado: N de M bytes …]`), como hace `errores.mjs` con las trazas.
     Un `>>SHELL` puede volcar megabytes. → **[P4](decisiones.md)**
  4. **Se redacta** con `scripts/redactar.mjs`. → **[P5](decisiones.md)**
  5. **El `id` tiene que ordenar**, porque `?desde=<id>` pagina con él: monótono
     y único aunque dos mensajes caigan en el mismo milisegundo.
- **prueba** `[coord] tests/mensajes.test.mjs`: la forma exacta de la línea · que
  no lanza con el directorio en sólo-lectura · que dos llamadas en el mismo ms
  dan ids crecientes · que con `COORD_WS` puesto escribe **en casa**.
- **terminado cuando** `tail -f data/mensajes/<sesión>.jsonl` enseña la
  conversación mientras se habla por Telegram.

### T1.2 · El formato, escrito donde vive su productor

- **dónde** `[coord] docs/log-de-mensajes.md`
- **qué** El contrato: los campos, qué significa cada `autor` y cada `origen`,
  qué garantiza el fichero (append-only; una línea = un mensaje entero) y qué
  **no** (que sea la conversación de claude: es una transcripción paralela).
- **por qué ahí y no aquí** Lo que cruza repos se escribe donde se **dispara** y
  desde el otro se **enlaza**; copiado, nacen dos mitades desfasadas.
- **terminado cuando** este repo lo enlaza y no lo copia.

### T1.3 · Publicar la entrada y la salida

- **dónde** `[coord] src/orchestrator.ts` (entrada) y `src/bot.ts::atender()` (salida)
- **qué**
  - `autor:'usuario'` con el texto **ya ensamblado por el buffer**, no los trozos:
    los trozos son del transporte, igual que el troceo de salida.
  - `autor:'claude'` con la respuesta **entera**, en `atender()` y **antes** del
    bucle de `send()` que trocea a 4000 (`src/bot.ts:56`).
  - `autor:'sistema'` para lo que hoy sólo se ve en el chat: el error de un
    ejecutor (`fail()`), un pegado caducado, el aviso de montaje de workspace.
- ✅ **Sólo se registra `c`** (P4), y **sin cablearlo**: el orquestador pregunta
  *«¿este ejecutor pide registro?»*, no *«¿se llama `c`?»*. El JSON de `c` gana
  `"registrar": true` y el núcleo sigue sin saber que `c` existe — que es la
  filosofía 2 del coordinador y la **R18**. Mañana se registra otro cambiando un
  dato, sin tocar código ni reiniciar.
- **Y con eso desaparece el problema del tamaño**: sin `shell` en el log, nadie
  vuelca megabytes. El tope por mensaje se queda igual, por si acaso.
- **prueba** en `tests/entrada-telegram.test.mjs`, que ya recorre el camino real
  de un mensaje: tras un mensaje, el JSONL tiene exactamente dos líneas.
- **terminado cuando** una respuesta que en Telegram llegó en 4 trozos está en
  **una sola línea** del log.

### T1.4 · `data/mensajes/` fuera de git

- **dónde** `[coord] .gitignore`
- **qué** Añadirlo junto a `data/buffer/` y `data/ws/`. Contiene todo lo que
  Claude dijo, incluidas salidas de shell y rutas.
- **terminado cuando** `git status` sigue limpio tras una conversación.

### T1.5 · Que los desacoplados escriban también

- **dónde** `[coord] scripts/notify.mjs`, `repetir-bucle.mjs`,
  `claude-resumer.mjs`, `claude-reset.mjs`
- **qué** `append` directo al JSONL **además** de mandar a Telegram. No pasan por
  el coordinador a propósito: si tuvieran que hablar con él por HTTP, dejarían de
  funcionar **justo cuando el bot está caído**, que es cuando más falta hacen.
- ⚠⚠ **Y el `append` no puede tumbar el trabajo.** `notify.mjs` corre al final de
  cadenas lanzadas con `desacoplar-persistente.sh`, que es `Restart=on-failure`:
  un fallo al final ahí no es un fallo, es un **bucle** (62 relanzamientos
  medidos el 2026-09-04). Se envuelve como todo lo demás.
- ⚠ `claude-reset.mjs` publica un `sistema` de **corte de conversación**: es la
  línea divisoria del `creset` que la web necesita para no enseñar un contexto
  que claude ya no tiene.
- **prueba** `tests/notify.test.mjs` ya tiene la costura (`TELEGRAM_API_BASE`):
  con la API simulada caída, el JSONL **igual** tiene su línea.
- **terminado cuando** un `repetir` deja sus vueltas en el log con
  `origen:"repetir"`.

### T1.6 · El fixture, uno y compartido

- **dónde** `[coord] tests/fixtures/mensajes/ejemplo.jsonl` y `[web]` la copia
- **qué** Un fichero de ejemplo con todos los casos: usuario, claude, sistema,
  un mensaje recortado, un `creset`. Es lo que hace que el contrato se pueda
  probar **desde los dos lados** (**R6**).
- **terminado cuando** `diff` entre las dos copias no da nada, y hay un test en
  cada repo que lo lee.

---

## Fase 2 · Servidor, lectura y SSE

### T2.1 · El servidor, y el freno de dónde escucha

- **dónde** `[web] server/index.mjs`
- **qué** `node:http`, y **escucha sólo en `127.0.0.1`**. `tailscale serve` hace
  de proxy desde la interfaz de la tailnet.
- ⚠⚠ **Esto es un freno, no una preferencia.** El bot usa long polling
  precisamente para no abrir puertos; quien alcance este puerto tiene shell con
  `bypassPermissions` y **sin allowlist**. En esta misma máquina hay precedente
  de lo contrario: `fv.api` escucha en `0.0.0.0:8010` (medido 2026-09-09).
- **prueba** que `server.address().address` es `127.0.0.1`. Una invariante que
  importa es un test, no una frase (**R14**).
- **terminado cuando** `ss -ltnp` enseña `127.0.0.1:<puerto>` y **no**
  `0.0.0.0:<puerto>`. → **[P2](decisiones.md)**

### T2.2 · `GET /api/sesiones`

- **qué** id, título (con su `fuente`), hora del último mensaje, y si está
  pendiente. Ordenadas por actividad.
- **prueba** contra el fixture, sin coordinador vivo.

### T2.3 · `GET /api/sesiones/:id/mensajes?desde=<id>`

- **qué** Historial paginado **hacia atrás**. Lee el JSONL por el final.
- **prueba** que `?desde=` no repite ni se salta ninguna línea en el borde.

### T2.4 · `GET /api/eventos` (SSE) con `fs.watch` **y** sondeo

- **qué** Mensajes nuevos y cambios de estado. `fs.watch` sobre `data/mensajes/`,
  **más un sondeo cada 2 s**.
- ⚠ **El sondeo no es opcional**: `fs.watch` no es fiable en todos los sistemas de
  ficheros, y lo dice la propia especificación.
- **prueba** que con el watcher desactivado a propósito, el mensaje llega igual
  en ≤ 2 s.

### T2.5 · El estado «pendiente» — ⚠ y lleva caducidad escrita al lado

- **qué** Sin streaming no hay señal de vida: si no se marca, la web **parece
  colgada**.
- ⚠ **No se declara, se deriva de algo comprobable** (**R16**): un turno vivo se
  reconoce por su proceso, como ya hace `scripts/repetir-bucle.mjs:98-103` con
  `pgrep -f <uuid>`. Un marcador «pendiente» escrito a mano se queda colgado para
  siempre si el coordinador muere a mitad — que es exactamente el fallo del
  `.resume.lock` que este proyecto ya pagó (**regla 3 de escritura**).
- **prueba** matar el coordinador con un turno en curso: al volver, **ninguna**
  sesión aparece pendiente.

### T2.6 · El armazón de la web

- **dónde** `[web] web/index.html`, `web/app.js`, `web/vendor/`
- **qué** Vue 3 desde su build ESM, **sin bundler**, con `vue`, `markdown-it` y
  `highlight.js` **vendorizados** (no CDN: ya dependes de la red para llegar).
- ⚠ **Choca con el precedente de la casa, y conviene saberlo**: `foveal-vision/web`
  es React + Vite con `dist/` **ignorado por git** (0 ficheros versionados,
  medido 2026-09-09), o sea que allí desplegar exige `npm run build` en la
  máquina. La especificación elige lo contrario a propósito: *«sin paso de build
  el despliegue sigue siendo `git pull` + reiniciar»*. → **[P10](decisiones.md)**
- **terminado cuando** un cambio de CSS llega a producción con `git pull` y nada más.

### T2.7 · La vista de conversación

- **qué** Móvil primero, **una columna**. Burbujas tuyas alineadas a la derecha;
  las de Claude **a ancho completo**, porque su contenido es estructurado y no
  conversacional — una tabla dentro de una burbuja estrecha no se lee.
- **La lista de sesiones** lleva título, hora del último mensaje y el indicador de
  *esperando respuesta* de T2.5.

### T2.8 · El renderizado, por orden de importancia real

- **qué**, en este orden, que es el de la especificación y **no** es el habitual:
  encabezados con jerarquía visible · listas anidadas con sangría · negritas y
  `código en línea` · **tablas con scroll horizontal contenido en la tabla** (que
  no mueva la página) · enlaces tocables · citas.
- **Bloques de código**: monospace con ajuste de línea, **sin** scroll lateral,
  **sin** plegado y **sin** botón de copiar. Son raros: Claude Code escribe los
  ficheros, no los vuelca al chat.
- ⚠⚠ **`markdown-it` con `html: false`. Innegociable.** Dejar pasar HTML crudo de
  la salida de un modelo, en una máquina con `bypassPermissions`, es abrir XSS en
  tu propia consola de shell.
- **Selección de texto nativa**: nada de gestos que secuestren la pulsación
  larga, nada de canvas.
- **prueba** un test que renderice `<img src=x onerror=...>` del fixture y
  compruebe que sale **escapado**.

### T2.9 · La divisoria del `creset` y los títulos heredados

- **qué** Una línea visible donde `claude-reset.mjs` cortó la conversación, y una
  marca distinta para el título que **no** vino de Telegram.
- **por qué** Sin la divisoria, la web enseña un contexto que claude ya no tiene
  — *«esa es exactamente la clase de confusión que cuesta media hora entender»*.

### T2.10 · Que la web diga cuándo el coordinador no está (R2)

- **qué** Si el bot no está vivo, se dice. Enseñar el último log como si fuera de
  ahora es fallar a mitad, que es lo único que **R2** no admite.
- **prueba** `systemctl stop telegram-coordinator` → la web lo anuncia; Telegram
  sigue igual que hoy.

### T2.11 · `[B]` El servicio, declarado donde se declaran los servicios

- **dónde** `[web] telegram/executors/cweb.json` · `[lanzador]
  services/claude-web.json` y `types/dev.json`
- **qué** Calcado de lo que ya funciona para `foveal-vision-web`: `url`,
  `estado`, `abrir`, `cerrar`, `parar` desde Telegram, y el manifiesto para que
  un droplet nuevo lo traiga solo.
- **los campos del manifiesto ya están fijados por el que existe**:
  `repo` · `install` · `start` · `url` · `env_prefix` · `notas`. El `url` es como
  **el lanzador anuncia la app al terminar un `launch`**: corre ese comando dentro
  del droplet y pega la dirección — o sea que una máquina nueva te dice sola dónde
  quedó la web.
- ⚠⚠ **Y `env_prefix` es lo que resuelve el problema de T4.4 sin inventar nada.**
  `foveal-vision-web` usa `FVW_`: si la máquina **lanzadora** tiene
  `FVW_WEB_TOKEN` en su `.env`, ese token viaja al `.env` del repo en el droplet
  nuevo y **sobrevive a rehacer el dev**, de modo que la URL marcada en el móvil
  sigue valiendo. La authkey de Tailscale (o el token, si se va por
  [P2](decisiones.md)(b)) tiene exactamente esa forma.
- ⚠ **Un tipo que cambia sólo llega a las máquinas creadas DESPUÉS**, y sólo si
  el mini tiene el repo del lanzador al día.
- **terminado cuando** `/executors` lo lista sin copiar nada a mano, porque el
  coordinador descubre `<repo>/telegram/executors/*.json`.

---

## Fase 3 · Escritura desde la web

> El cerrojo va **antes** que el botón. Lo pide la especificación y es correcto.

### T3.1 · El cerrojo por sesión

- **qué** Que dos entradas al mismo tema no produzcan dos `claude --resume` del
  mismo uuid.
- ⚠ **No se inventa: ya existe la mitad.** `scripts/repetir-bucle.mjs:98-121`
  detecta *«hay alguien más en este hilo»* con **dos señales, porque miden cosas
  distintas**: `pgrep -f <uuid>` (turno **en curso**, que el marker no delata
  porque sólo se escribe al acabar) y el `mtime` del marker dentro de una ventana
  (turno **recién terminado**). Lo que le falta para ser cerrojo es **encolar en
  vez de saltar**.
- ✅ **Decidido (P6): encola y avisa**, no rechaza.
- ⚠ **Y lleva su regla de caducidad escrita al lado** (regla 3 de escritura):
  un cerrojo cuyo dueño murió por SIGKILL y no caduca convierte el fallo de una
  tarde en una función muerta en silencio. Ya pasó aquí con `.resume.lock`.
- **prueba** dos entradas simultáneas al mismo tema → un solo `claude`, la
  segunda espera. Y: cerrojo con dueño muerto → **no** bloquea.

### T3.2 · Sacar el envío de Telegram de `ctx`

- **dónde** `[coord] src/bot.ts`
- **qué** Extraer `enviarA(api, chatId, threadId, texto)`; `send(ctx, …)` pasa a
  ser su envoltorio. Hoy `send()` usa `ctx.reply` (`src/bot.ts:51-60`) y un
  mensaje que no venga de Telegram no tiene `ctx`.
- **prueba** las de `tests/entrada-telegram.test.mjs` siguen pasando sin cambios
  (es un refactor: si hay que tocarlas, algo cambió de comportamiento).

### T3.3 · La entrada desde la web, y su eco en Telegram

- ✅ **Decidido (P6)**: la web deja el mensaje en un **fichero de entrada** y el
  coordinador lo recoge. Simétrico con lo que la especificación ya diseña para los
  procesos desacoplados, sin abrir ningún puerto nuevo, y deja **un solo sitio**
  que habla con Telegram y **un solo camino** de ejecución.
- **Y se hace eco en Telegram**, que es lo que el dueño pidió expresamente: la
  misma conversación se lee igual en la app y en el chat.
- ⚠ **El eco se verá como un mensaje del bot, no tuyo**: la Bot API no deja a un
  bot publicar en nombre de una persona. Llevará una marca que lo diga
  (`📱 (desde la app) …`). El orden y el contenido son los mismos en los dos
  sitios, que es lo que importa.
- **Tres detalles que la especificación no cierra:**
  1. **El buffer no aplica.** Une trozos que **Telegram** parte; un `POST` no se
     trocea. Y si hay un pegado a medias en ese tema, hay que decidir qué pasa
     (¿se cierra?, ¿se rechaza?) en vez de mezclarlo en silencio.
  2. **`asegurarWorkspace()` puede tardar minutos.** El primer mensaje de un tema
     monta su workspace (~6 s medidos el 2026-08-28, con un timeout de 10 min).
     El `POST` responde **202** y el resultado llega por SSE; no se deja una
     petición HTTP colgada.
  3. **Un turno de `c` no tiene timeout** (`timeoutMs: 0`). El `POST` **no puede**
     esperar a la respuesta.
- **prueba** un `POST` con el fixture y la API de Telegram simulada: aparece en el
  log **y** en la cola de envío.

### T3.4 · El freno, en el mismo commit (R11)

- **qué** Un botón de enviar es un **acelerador nuevo**: llega a `c`, que corre
  con `bypassPermissions` y desde ahí se alquilan máquinas de Vast. En el mismo
  commit: `cweb parar` desde Telegram, y revisar si un turno lanzado desde la web
  entra en `TRABAJOS` de `scripts/cerrable.mjs` — que es una lista **declarada**,
  o sea que lo que no se apunte, el freno no lo ve.
- ⚠ El **servicio** en sí **no** entra en `TRABAJOS`: está vivo desde que arranca
  la máquina y contarlo sería un 🔴 permanente, el aviso que sale siempre y se
  deja de leer (decisión 6 de `cerrable.mjs`).
- **prueba** con un turno en curso lanzado desde la web, `cerrable.mjs --breve`
  no dice 🟢.

---

## Fase 4 · PWA, purga y acceso

### T4.1 · Purga

- **qué** 30 días **o** 300 mensajes por sesión, lo que llegue primero. Al
  arrancar y una vez al día, reescribiendo el fichero.
- **por qué también es seguridad**: acota cuánto hay que perder si alguien entra.
- ⚠ **El número no está medido**: sale de la especificación. El journal de esta
  máquina no sirve para dimensionarlo (2 mensajes en 7 días, droplet rehecho hoy).
  Se revisa con una semana de log real.
- **prueba** que no borra lo que está dentro de la ventana, y que reescribir no
  pierde la línea que se estaba añadiendo.

### T4.2 · PWA: manifest, icono y service worker

- **qué** Instalable en la pantalla de inicio. El service worker cachea **sólo el
  armazón**. **Sin push**: Telegram ya avisa.
- ⚠ **Exige HTTPS y origen estable**, que es lo que ata esta tarea a T4.3.

### T4.3 · Tailscale en esta máquina

- **qué** Instalar, unir a la tailnet, `tailscale serve` al puerto del servidor.
- ⚠ **Dos obstáculos medidos hoy, ninguno en la especificación:**
  1. **No está instalado** (`which tailscale` → *command not found*).
  2. **El 443 lo tiene `sshd` en `0.0.0.0`**, o sea en **todas** las interfaces,
     incluida la de Tailscale — y `tailscale serve` quiere 443 por defecto. O se
     usa otro puerto (`--https=8443`), o se mueve `sshd`.
- **Y el aviso de Android**: excluir Tailscale de la optimización de batería. Si
  el sistema lo mata en segundo plano, la web deja de resolver **sin explicación
  visible** y el síntoma parece del servidor.

### T4.4 · Que sobreviva a que se destruya el `dev` — ✅ el requisito del dueño

- **dónde** `[lanzador] types/dev.json` y/o el cloud-init
- **qué** *«Lo que no está empujado, no existe»*: un droplet se rehace sin aviso,
  y un Tailscale instalado a mano se pierde con él — junto con el único camino a
  la web.
- ⚠ Su **authkey es un secreto**, así que va a los **dos** ficheros
  (`.env` del servicio y `~/.config/dev-secrets.env`). Es la trampa ya indexada
  del proyecto: *al añadir un token nuevo hay que mandarlo a sus dos destinos*.
- ✅ **El nombre estable se consigue con un NODO EFÍMERO**: Tailscale lo borra
  solo de la tailnet tras la inactividad, así que el nombre queda libre para el
  `dev` siguiente y la PWA instalada sigue resolviendo.
- ⚠⚠ **Pero la limpieza tarda 30-60 min** *(documentación de Tailscale,
  consultada el 2026-09-09; NO medido aquí)*, y un `dev` se relanza mucho antes de
  eso. Si el nodo viejo sigue ahí, el nuevo entra como `<nombre>-1` y **la app
  deja de resolver**. Por eso **el borrado del nodo va donde se destruye el
  droplet**, en el mini — que es la **R11**: quien apaga, limpia.
- ⚠ **Y la authkey caduca a los 90 días como máximo** *(íd.)*. Cuando pase, un
  `dev` nuevo no se une y la web nace **sin acceso y sin un solo error**: el fallo
  silencioso. O se usa un OAuth client (no caduca), o el preflight avisa antes.
- **terminado cuando** un droplet nuevo lanzado con `lanzar launch dev` trae la
  web alcanzable **sin tocar nada a mano**.

### T4.5 · La puesta en marcha, enseñada como una SESIÓN

- **dónde** `[web] README.md`
- **qué** El diálogo real de instalar y usar esto desde el móvil, con la salida
  pegada a lo que se teclea.
- **por qué así**: en este proyecto un comando se enseña con una **sesión de
  ejemplo**, no con una tabla de comandos — *«lo que se olvida documentar nunca es
  el nombre del comando: es la secuencia y el estado intermedio»*.
- ⚠ Y mientras no se haya ejecutado, **se marca** (`ejemplo, NO ejecutado`): una
  sesión inventada envejece peor que una tabla, porque parece una transcripción.

---

## Lo que no hace ninguna tarea, y es deliberado

De la especificación, y este plan lo respeta entero:

- **No se toca `claude-session.mjs`.** Sigue con `claude -p` y la salida entera
  por stdout: sin streaming no hay que rehacer la pieza más frágil.
- **No se migra nada.** Telegram sigue siendo cliente de primera y la web nunca
  puede ser el único camino a una sesión.
- **La web no sabe de** ejecutores, encargados, `/ws`, `definer`, `repetir` ni
  `shell`. Sólo de conversaciones.
- **No se suben imágenes** desde la web: Telegram ya da ese camino, y aquí
  implicaría almacenamiento, límites de tamaño y un formato nuevo en el log.
- **No hay push propio.**
- **Si el coordinador se reinicia a mitad de un turno, la respuesta se pierde** —
  igual que hoy. La web no lo arregla y **no debe aparentar que sí**.
