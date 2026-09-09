# Plan general de implementación

**De qué es plan.** De la propuesta de [`especificacion.md`](especificacion.md):
una web de lectura (y luego de escritura) para las conversaciones del ejecutor
`c` del coordinador de Telegram.

**Estado: propuesta. Nada implementado, ninguna línea de código escrita.**
Escrito el 2026-09-09.

✅ **Las 13 decisiones están tomadas** (2026-09-09) y viven en
[`decisiones.md`](decisiones.md), con el motivo de cada una. Este plan se lee con
ellas al lado — donde decía «hay que decidir», ahora dice qué se decidió. **No
queda nada pendiente para empezar a escribir código.**

**Cómo se usa este documento.** Contesta *qué se construye y en qué orden*. El
*cómo*, tarea por tarea, está en [`plan-detallado.md`](plan-detallado.md). Lo
que hace falta **decidir antes de empezar** está en
[`decisiones.md`](decisiones.md), numerado.

---

## 0. Lo que se verificó antes de planificar

La especificación se escribió describiendo el coordinador. Antes de planificar
sobre ella se comprobó contra el código y contra esta máquina. **Todo lo de esta
tabla está medido el 2026-09-09**, con el comando al lado; lo que no se pudo
medir se dice.

| Afirmación | Resultado | Cómo se comprobó |
|---|---|---|
| No existe `getForumTopic` en la Bot API: el título del tema sólo llega por eventos de servicio | ✅ **cierto** | `grep -o "[a-zA-Z]*ForumTopic[a-zA-Z]*(" node_modules/@grammyjs/types/methods.d.ts \| sort -u` → 13 métodos, ninguno lee el nombre |
| grammY sabe filtrar esos eventos | ✅ `forum_topic_created` y `forum_topic_edited` están en `filter.d.ts` | grammY **1.44.0**, `node_modules/grammy/package.json` |
| El coordinador trocea la salida a 4000 | ✅ `TELEGRAM_LIMIT = 4000` | `src/bot.ts:39`, usado en `send()` (`src/bot.ts:51-60`) |
| El coordinador no guarda **un log** de lo que se dijo | ✅ cierto: no hay ninguna transcripción. ⚠ **Pero no es que `data/` no tenga texto**: `data/buffer/<sesión>.json` guarda el pegado a medias mientras se ensambla —y el caducado **se aparta, no se borra**—, y `data/repeticiones/` guarda la frase armada de `repetir`. Los dos, **sin redactar** | `src/buffer.ts:68` y `:117`, `scripts/repetir-estado.mjs:137` |
| …pero el mecanismo del log **ya existe** para otra cosa | ⚠ **la especificación no lo sabe**: `scripts/errores.mjs` es un JSONL append-only escrito por el coordinador y por scripts sueltos, ya redactado y probado | `scripts/errores.mjs`, 171 líneas |
| `claude-session.mjs` no hay que tocarlo | ✅ lee stdin, escribe stdout, sin `stream-json` | `scripts/claude-session.mjs:87-104` |
| El estado por tema no se muda con el workspace | ✅ `DATA_DIR` va absoluto a todo comando | `src/orchestrator.ts:60-64` |
| El proceso del coordinador **no escucha ningún puerto** hoy | ✅ sólo 22, 443 (sshd) y 8010 (`fv.api`) — más el stub DNS de loopback de Ubuntu, que no es de nadie de aquí | `ss -ltnp` |
| Tailscale está instalado | ❌ **NO lo está** | `which tailscale` → *command not found* |
| El puerto 443 está libre para `tailscale serve` | ❌ **NO**: lo tiene `sshd` en `0.0.0.0`, o sea en **todas** las interfaces, incluida la de Tailscale | `ss -ltnp \| grep :443` |
| Hay CI que corra los tests | ❌ **no hay**, ni aquí ni en el coordinador | `ls .github/workflows` → no existe |
| Cuántos mensajes al día pasan por el bot (para dimensionar la purga) | ⚠ **no medido**: el journal de esta máquina tiene 2 mensajes en 7 días porque el droplet se rehizo hoy | `journalctl -u telegram-coordinator -o cat --since "7 days ago" \| grep -c '^\[IN\]'` ⚠ sin `-o cat` da 0: el prefijo de syslog desplaza el `[IN]` |

---

## 1. La especificación, en una página

- **El problema**: Claude Code responde markdown; Telegram lo enseña crudo y lo
  parte a 4000 caracteres por transporte.
- **La pieza que falta**: un **log de mensajes**, `data/mensajes/<sesión>.jsonl`,
  append-only. Hoy el texto vive en el chat de Telegram y en ningún sitio propio.
  Todo lo demás sale casi gratis después.
- **Se publica ANTES de trocear**: el log guarda la respuesta entera en una
  línea; Telegram trocea aguas abajo.
- **Los procesos desacoplados escriben al fichero, no al coordinador**
  (`notify.mjs`, `claude-resumer.mjs`, `repetir`): si tuvieran que hablar por
  HTTP con el bot, dejarían de funcionar justo cuando el bot está caído.
- **El servidor va dentro del proceso del coordinador**, con `node:http`; SSE
  para servidor → navegador; `POST` normal para escribir.
- **Vue 3 desde el build ESM del navegador, sin bundler**, y vendorizado.
- **Acceso por Tailscale**, sin pantalla de login: la identidad la pone la red.
- **Cuatro fases**: (1) log, (2) web de lectura, (3) escritura + cerrojo,
  (4) PWA, purga y Tailscale. *«La fase 2 ya vale por sí sola.»*

**Lo que la especificación decide NO hacer**, y este plan respeta: no se toca
`claude-session.mjs`, no se migra nada de Telegram, no hay push propio, no se
suben imágenes, y la web sólo sabe de conversaciones — no de ejecutores, `/ws`,
`definer` ni `repetir`.

---

## 2. Dónde la especificación acierta contra el código real

Esto no es relleno: son las cuatro decisiones que **no hay que volver a
discutir**, porque se comprobaron.

1. **Publicar antes de trocear** es exactamente donde hay que ponerlo. El troceo
   vive en `send()` (`src/bot.ts:51-60`) y `processIncoming` ya devuelve el texto
   entero (`src/orchestrator.ts:128`): hay un punto limpio entre los dos.
2. **Los desacoplados escribiendo al fichero** coincide con lo que el proyecto ya
   hizo, y por el mismo motivo, en `scripts/errores.mjs`: *«se escribe el FICHERO
   y no se llama al API porque "el API no responde" es exactamente el error que
   más interesa registrar»*.
3. **El título del tema sólo llega por evento**: verificado arriba. La
   especificación lo detectó y le puso la prioridad correcta. ⚠ Y esa rama acabó
   **descartada** por [P9](decisiones.md#p9--el-nombre-de-cada-tema-en-la-app), que
   la resolvió por el camino más barato: no producir el dato. Cada conversación se
   llama `Tema <threadId>`, que se lee del `sessionId`.
4. **JSONL y no SQLite**: coherente con `data/` y con `errores.mjs`, y para un
   usuario no hay problema de rendimiento que justifique un motor.

---

## 3. Los ocho huecos: lo que la especificación no cubre y cambia el plan

Ninguno invalida la propuesta. Todos son trabajo que **no está en sus cuatro
fases** y que, si no se anota, se descubre a mitad.

### H1 · `publicar()` no puede saber qué es `c` — o el núcleo deja de ser genérico

La especificación dice *«la web solo sabe de conversaciones de `c`»*. Pero quien
escribe el log es el orquestador, que atiende a **todos** los ejecutores. Si
`publicar()` filtra por nombre de ejecutor, el coordinador aprende el nombre de
uno concreto — y eso rompe la filosofía 2 de su `CLAUDE.md` (*«no hay tipos
especiales cableados en el coordinador»*) y la **R18**.

**Salida propuesta**: el orquestador registra **todo** lo que pasa por él, sin
mirar el ejecutor; **la web filtra**. Cuesta que el log recoja también las
salidas de `shell`, que pueden ser enormes → hace falta un tope por mensaje.
→ **[P4](decisiones.md)**

### H2 · `send()` depende de `ctx`: sin refactor, la web no puede escribir a Telegram

`send(ctx, texto)` usa `ctx.reply` y `ctx.message.message_thread_id`
(`src/bot.ts:51-60`). Un `POST` de la web **no tiene `ctx`**, y la especificación
exige que ese mensaje *también* se mande a Telegram (*«si los dos clientes no ven
lo mismo, el espejo miente»*).

**Salida**: extraer `enviarA(api, chatId, threadId, texto)` y dejar `send(ctx, …)`
como envoltorio. Es un refactor pequeño y **de la fase 3**, pero conviene hacerlo
en la 1 para que el log y el envío compartan un solo camino.

### H3 · La allowlist no cubre la web, y hoy el bot no escucha ningún puerto

`ALLOWED_USER_IDS` es, según el `CLAUDE.md` del coordinador, *«la única
defensa»*, y el bot usa long polling **precisamente para no abrir puertos**. Un
servidor HTTP es una **segunda puerta al mismo orquestador**, que corre con
`CLAUDE_PERMISSION_MODE=bypassPermissions`: quien alcance ese puerto tiene shell.

La especificación resuelve la *identidad* (Tailscale) pero no dice **en qué
interfaz escucha el servidor**. En esta misma máquina hay precedente de lo
contrario: `fv.api` escucha en `0.0.0.0:8010` (medido hoy).

**Salida propuesta, y es un freno, no un detalle**: el servidor escucha **sólo en
`127.0.0.1`**, y `tailscale serve` hace de proxy. El bind va en el **mismo commit**
que el servidor, y con un test que falle si alguien lo cambia a `0.0.0.0`
(**R14**: una invariante que importa es un test, no una frase).
→ **[P2](decisiones.md)**

### H4 · Tailscale no está instalado — y la máquina es efímera

Dos cosas que la especificación da por hechas y hoy no lo son:

1. **No está instalado** (medido hoy). Y si se instala a mano, **se pierde al
   rehacer el droplet**, que es la regla central de este sistema. Para que
   sobreviva tiene que ir en el tipo `types/dev.json` del **lanzador**, que es
   **otro repo** — y su authkey, en los **dos** ficheros de secretos.
2. **El puerto 443 lo tiene `sshd` en `0.0.0.0`** (medido hoy), o sea también en
   la interfaz de Tailscale. `tailscale serve` por defecto quiere 443.
3. ⚠ **Y el nombre del nodo tiene que ser fijo.** El service worker exige origen
   estable; un droplet nuevo que se une a la tailnet con nombre autogenerado deja
   la PWA instalada apuntando a un host que ya no existe. Hace falta
   `--hostname=<fijo>` y borrar el nodo viejo al destruir la máquina.

→ **[P3](decisiones.md)**

### H5 · El log guarda secretos, y aquí ya se filtró un token una vez

El `CLAUDE.md` del coordinador lo dice: *«un mensaje a `c` pidiendo leer `.env`
filtró el token una vez»*. El log de mensajes va a contener todo lo que Claude
dijo, incluidas salidas de shell. La especificación sólo prevé **purga**, no
**redacción**.

Atenuantes reales: el fichero **no se commitea** (va a `.gitignore`, como el
resto de `data/`) y no sale de la máquina. Agravante: **se sirve por HTTP** a un
navegador y se queda cacheado en el móvil.

⚠ Y esto **no estrena el problema**, que es lo que salió al verificar el plan:
`data/buffer/` ya guarda texto tuyo sin redactar —y el pegado caducado se
**aparta**, no se borra— y `data/repeticiones/` guarda la frase de `repetir`. O
sea que la pregunta no es *«¿empezamos a guardar texto?»* sino *«¿por qué lo que
ya se guarda no se redacta?»*.

**Salida propuesta**: reusar `scripts/redactar.mjs`, que ya existe y ya está
probado en dos sitios. ⚠ Con la trampa medida que trae anotada: *redactar de más
también es un fallo* (filtrar por longitud borraba `CLAUDE_PERMISSION_MODE` de
una conversación normal). → **[P5](decisiones.md)**

### H6 · Hay un precedente exacto del mecanismo, y no está aprovechado

`scripts/errores.mjs` ya es: JSONL append-only · escrito por el coordinador **y**
por procesos sueltos · redactado · con agrupación de repeticiones · con volcado
en `SIGTERM` · y con la regla *«registrar NUNCA puede tumbar el coordinador»*
escrita al principio. Es la fase 1 entera, resuelta para otro contenido.

**Salida**: el módulo del log se escribe **con la misma forma** y comparte
`redactar.mjs`. No se fusionan los dos logs (contenidos y ciclos de vida
distintos: uno se commitea al repo de datos, el otro es efímero y se purga).

### H7 · El estado «pendiente» hay que inventarlo — y lleva caducidad

Sin streaming, la web necesita saber que hay un turno en curso o *«parece
colgada»* (lo dice la propia especificación). Ese estado no existe hoy.

Lo sabe el coordinador (está esperando a `runCommand`), pero **si el proceso
muere a mitad, el pendiente queda colgado para siempre**. Es exactamente el fallo
del `.resume.lock` que este proyecto ya pagó, y la **regla 3 de escritura** de su
`CLAUDE.md`: *todo marcador en disco lleva su regla de caducidad escrita al lado*.

**Salida**: el pendiente se **deriva** de algo comprobable (**R16**), no se
declara: el pid del turno vivo, y el arranque del coordinador limpia lo que quede.

### H8 · El cerrojo no hay que inventarlo: `repetir` ya lo resolvió a medias

La especificación llama al cerrojo *«la parte más delicada del proyecto»*, y
tiene razón. Pero el proyecto ya tiene un detector de *«hay alguien más en este
hilo»* funcionando, con **dos señales porque miden cosas distintas**:
`pgrep -f <uuid>` (turno en curso) y el `mtime` del marker dentro de una ventana
(turno recién terminado) — `scripts/repetir-bucle.mjs:98-121`.

**Salida**: la fase 3 **reusa** ese detector en vez de escribir otro, y le añade
lo que le falta para ser cerrojo de verdad (encolar en vez de saltar, dentro del
proceso). Dos implementaciones de «quién manda en este hilo» divergirían, y la
divergencia sería *dos `claude --resume` del mismo uuid*, que es justo lo que se
quiere evitar. → **[P6](decisiones.md)**

---
## 4. El reparto: qué vive en qué repo — ✅ decidido: aparte

La especificación decidía: *«Servidor dentro del proceso del coordinador, con
`node:http`. Nada de un segundo servicio»*. Al revisarlo contra las
[19 reglas de diseño](https://github.com/stalinbeltran/telegram-coordinator/blob/main/docs/reglas-de-diseno.md)
y contra lo que la máquina ya corre, **esa decisión chocaba con cuatro reglas y
con un precedente en producción**. No se rompió en silencio: se expuso, y el
**2026-09-09 el dueño decidió que va aparte** (**[P1](decisiones.md)**).

Lo que sigue explica **por qué**, porque una decisión sin su motivo se revierte
sola la primera vez que estorba.

### Lo que dice la especificación, y no es débil

> Compartir proceso te ahorra IPC, otra unidad de systemd y una segunda copia del
> estado.

Y en la fase 3 eso se cobra de verdad: el `POST` sería literalmente una llamada a
`processIncoming`, sin traspaso que diseñar.

### Lo que se encontró al comprobarlo — medido el 2026-09-09

| Hecho | Comprobado con |
|---|---|
| **Este sistema ya corre una segunda web app en su propio repo, con unidad propia**: `foveal-vision-web.service`, `WorkingDirectory=/home/deploy/src/foveal-vision`, activa ahora | `systemctl cat foveal-vision-web` |
| …declarada en el lanzador como manifiesto | `digital-ocean-dropplet-auto-launching/services/foveal-vision-web.json` |
| …y gobernada desde Telegram con su propio ejecutor | `foveal-vision/telegram/executors/fvweb.json` |
| **Y el lanzador RECHAZA dos servicios del mismo directorio**, con un `die()` explícito: *«comparten .env y datos, así que no pueden convivir en un droplet»* | `do_droplet.py`, función `selected_services` |
| El `src/` del coordinador cambia **8 veces al mes**; `scripts/`, 56 | `git log --since=2026-08-09 --oneline -- src/ \| wc -l` |

La consecuencia de la cuarta fila es la que aprieta: **«servidor con unidad
propia» y «repo propio» no son dos decisiones, son la misma.** Si el servidor
vive en `telegram-coordinator/`, no puede tener unidad; si tiene unidad, no puede
vivir ahí.

### Y un choque interno de la propia especificación

La especificación pide, en el mismo párrafo, dos cosas que no encajan:

> Servidor dentro del proceso del coordinador. **Con la regla que ya tienes: un
> fallo de la web no tumba el bot.**

En proceso compartido, *«un fallo de la web no tumba el bot»* deja de ser
estructura y pasa a ser **disciplina**: un `error` de socket sin manejar en el
`node:http` mata el proceso, y con él el long polling. Es la forma exacta del
fallo del 2026-09-04 (`notify.mjs` salía ≠ 0 al final de un trabajo que había
terminado bien, y la unidad lo relanzó 62 veces): **si la comodidad puede matar a
lo importante, ha dejado de ser una comodidad**. Fuera del proceso, esa garantía
es gratis.

### Las dos opciones, con su precio

**Opción A — todo dentro del coordinador** (lo que dice la especificación)

- `src/` pasa de 1.832 líneas a ~2.600 y gana superficie de red.
- El `vendor/` (vue + markdown-it + highlight.js) se commitea en un repo cuya
  única dependencia hoy es `grammy` — y **se copia en cada workspace**
  (`scripts/workspace.mjs` clona el coordinador en todos) y en cada droplet.
- Un reinicio del bot por cada cambio de CSS.
- El repo nuevo se queda sin código: deja de ser una pieza (**R3**).
- **A cambio**: la fase 3 es un `import`, hay un solo `.env`, una sola unidad, y
  cero acoplamiento nuevo con el repo del lanzador.

**Opción B — el escritor en el coordinador, el lector en su repo** (recomendada)

```
telegram-coordinator/            ← el PRODUCTOR del log
  src/mensajes.ts                publicar() + formato + purga   (nuevo)
  src/orchestrator.ts            publicar(autor:'usuario') al entrar
  src/bot.ts                     publicar(autor:'claude') ANTES de trocear
  data/mensajes/*.jsonl          (a .gitignore)
  docs/log-de-mensajes.md        EL FORMATO, que es el contrato entre las piezas
  tests/mensajes.test.mjs

claude-code-webapp-mobile/       ← el CONSUMIDOR
  server/index.mjs               node:http, sólo lectura en la fase 2
  server/eventos.mjs             SSE + fs.watch + sondeo de respaldo
  web/ web/vendor/ web/sw.js manifest.json
  tests/fixtures/mensajes/*.jsonl   el mismo fixture que el coordinador (R6)
  telegram/executors/cweb.json      calcado de fvweb.json: url/estado/abrir/cerrar
  README.md                      su ÚNICA entrada es DATA_DIR

digital-ocean-dropplet-auto-launching/    ← para que sobreviva a rehacer la máquina
  services/claude-web.json       manifiesto del servicio
  types/dev.json                 añadirlo al array "services"
```

- **Cuesta**: tres repos tocados en vez de uno · una unidad y un puerto más · el
  repo del lanzador entra en el grafo · dos reinicios en vez de uno · y la fase 3
  deja de ser un `import` y pasa a ser un traspaso diseñado (**[P6](decisiones.md)**).
- **A cambio**: el repo nuevo se puede clonar solo y arrancar contra un fixture
  (**R3** deja de estar incumplida), un fallo de la web no puede tumbar el
  polling **por estructura**, el `vendor/` no se multiplica por workspace, y el
  reparto es el que este sistema ya tiene probado con `foveal-vision-web`.

⚠ **Y el argumento de peso de la opción A ya tiene un contraejemplo funcionando
fuera del proceso**: `scripts/repetir-bucle.mjs` inyecta turnos en la
conversación de `c` de un tema **desde una unidad de systemd**, llamando a
`claude-session.mjs` con `COORD_SESSION` y entregando por `notify.mjs`. Nunca
toca `processIncoming`.

✅ **Elegida la B el 2026-09-09.** Las marcas `[A]` que quedan en el plan
detallado señalan lo que se descartó, y se conservan sólo para que se vea qué se
consideró; no son trabajo.

### ⚠ Una trampa concreta que este reparto hereda, y ya mordió aquí

`data/mensajes/` tiene que vivir en el `data/` **de casa**, uno por máquina,
indexado por tema — igual que `claude-sessions/` (decisión 4 de `/ws`). Y hoy el
proyecto **resuelve `DATA_DIR` de dos formas distintas** (medido el 2026-09-09):

| Fichero | Fallback |
|---|---|
| `scripts/destino-telegram.mjs:52` | resuelve **absoluto** ✅ |
| `claude-marker.mjs:26` · `claude-resumer.mjs:44` · `repetir-estado.mjs:42` · `shell-cwd.mjs:28` · `define.mjs:23` | `'data'`, **relativo al cwd** ⚠ |

Un `publicar()` copiado del segundo patrón, corriendo desde un tema atado a
`~/ws/tema-2`, escribiría en `~/ws/tema-2/telegram-coordinator/data/mensajes/`:
**el log partido en dos, sin un solo error**. Es la misma forma del fallo de
`notify.mjs` con `.env` del 2026-09-04. Por eso **una sola función** decide dónde
está el log, con fallback a `COORD_HOME`, nunca a `'data'`.

---

## 5. Las cuatro fases

El orden es el de la especificación y no se cambia: cada fase entrega algo que se
puede usar y verificar, y **la fase 2 ya resuelve el problema que originó todo**.

### Fase 0 · El freno — ⛔ lo demás de esta fase se borró

Era *«capturar los títulos de los temas, y va primero porque es lo único con
reloj»*. **[P9](decisiones.md#p9--el-nombre-de-cada-tema-en-la-app) la eliminó el
2026-09-09**: los nombres se derivan del `sessionId` (`Tema 438`), así que no hay
evento que escuchar ni dato que perder — y **el proyecto se queda sin ninguna
urgencia**.

Queda sólo **T0.3**, que nunca fue de títulos: meter este repo en la lista de
`cerrable.mjs`, porque hoy el freno da 🟢 con trabajo sin empujar aquí dentro.

### Fase 1 · `publicar()` y el log

- **Entrega**: `data/mensajes/<sesión>.jsonl` escrito en cada vuelta, con la
  respuesta **entera** (antes del troceo). Telegram pasa a ser un suscriptor más.
- **No entrega**: ninguna web, ningún puerto, ninguna lectura.
- **Se verifica** con `tail -f data/mensajes/*.jsonl` desde otro tema, y con
  `tests/mensajes.test.mjs`.
- **Riesgo controlado**: no puede romper nada visible; si `publicar()` falla, se
  registra y se sigue — la regla 3 del coordinador (*«los errores nunca tumban el
  coordinador»*), que `scripts/errores.mjs` ya aplica a sí mismo.
- **Los procesos desacoplados** (`notify.mjs`, `repetir-bucle.mjs`,
  `claude-resumer.mjs`, `claude-reset.mjs`) hacen `append` directo, además de
  mandar a Telegram.

### Fase 2 · Servidor, API de lectura y SSE — la que resuelve el problema

- **Entrega**: web de **sólo lectura**, en el móvil, con markdown renderizado.
- **Se verifica**: abrirla y leer una respuesta con tablas que en Telegram
  llegaba partida.
- **Aquí entra el freno de seguridad de [H3](#h3--la-allowlist-no-cubre-la-web-y-hoy-el-bot-no-escucha-ningún-puerto)**: escucha en `127.0.0.1`, con test.
- **Si el proyecto se para aquí, no queda a medias.** Es lo que dice la
  especificación y es cierto.

### Fase 3 · Escritura desde la web + cerrojo por sesión

- ⚠ **El cerrojo va ANTES que el botón de enviar**, como pide la especificación.
- **Entrega**: `POST` que entra por el mismo camino que Telegram y **también se
  manda a Telegram** (si no, el espejo miente).
- **Requiere** el refactor de `send()` ([H2](#h2--send-depende-de-ctx-sin-refactor-la-web-no-puede-escribir-a-telegram)) y decidir **[P6](decisiones.md)**.
- **R11 · el freno va en el mismo commit**: un botón de enviar en la web es un
  **acelerador nuevo** —llega a `c`, que corre con `bypassPermissions` y alquila
  máquinas de Vast—, así que su ejecutor de Telegram (`cweb.json`: `estado`,
  `parar`) va con él, y se decide qué cuenta en `cerrable.mjs`.

### Fase 4 · PWA, purga y acceso

- **Entrega**: instalable en la pantalla de inicio, purga de 30 días / 300
  mensajes, y acceso por Tailscale.
- ⚠ **Es la fase con más trabajo fuera de estos dos repos**: Tailscale no está
  instalado, el puerto 443 lo tiene `sshd`, y para que sobreviva a rehacer el
  droplet hay que tocar el repo del lanzador ([H4](#h4--tailscale-no-está-instalado--y-la-máquina-es-efímera)). Ver **[P3](decisiones.md)**.

---

## 6. Qué añade cada fase al freno y a las pruebas

**R11** («quien puede encender tiene que poder apagar») y **R17** («una
comprobación que no corre sola no existe»), aplicadas fase por fase. ⚠ No hay CI
en ninguno de los repos (verificado en § 0), así que *«la máquina lo dispara»*
hoy significa, como mucho, `npm test` a mano — y eso es deuda declarada, no
cumplimiento.

| Fase | Freno | Pruebas |
|---|---|---|
| 0 | ⚠ **este repo entra en la lista de `cerrable.mjs`** (T0.3): hoy no está, y por eso el freno da 🟢 «todo empujado» con trabajo sin commitear aquí — medido el 2026-09-09 | que con un fichero sin commitear aquí, el freno **no** puede decir 🟢 |
| 1 | — | `tests/mensajes.test.mjs`: el formato, que se publica **entero** antes de trocear, y que `publicar()` **nunca lanza** |
| 2 | ejecutor `cweb` (`url`/`estado`/`parar`) desde Telegram | que escucha en `127.0.0.1` y **no** en `0.0.0.0` · que sin el coordinador vivo la web **lo dice** en vez de enseñar un log viejo como si fuera de ahora |
| 3 | `cweb parar` + revisar `TRABAJOS` de `cerrable.mjs` | el cerrojo: dos entradas a la vez en el mismo tema no producen dos `claude --resume` del mismo uuid |
| 4 | que el freno no se vuelva 🔴 permanente por un servicio (decisión 6 de `cerrable.mjs`) | que la purga no borra lo que está dentro de la ventana, y que el service worker no sirve un armazón viejo |

---

## 7. Riesgos, ordenados por lo que cuesta el fallo (R10)

| # | Riesgo | Consecuencia | Dónde se ataja |
|---|---|---|---|
| 1 | El servidor escucha en `0.0.0.0` en un droplet público | **shell remoto abierto a Internet**, sin allowlist, con `bypassPermissions` | fase 2, con test (**R14**) |
| 2 | El log filtra un secreto y se sirve al navegador | rotar tokens; y aquí **ya pasó una vez** | fase 1, reusando `redactar.mjs` (**[P5](decisiones.md)**) |
| 3 | Dos `claude --resume` del mismo uuid | conversación corrupta, trabajo perdido | fase 3, cerrojo antes del botón |
| 4 | El log se parte entre `data/` de casa y el de un workspace | mitad de la conversación invisible, **sin ningún error** | fase 1, una sola función para resolver `DATA_DIR` |
| 5 | Un fallo de la web tumba el polling | error 409, el bot deja de responder | estructura (opción B) o disciplina (opción A) |
| 6b | El freno no vigila este repo | 🟢 «cerrable» con trabajo sin empujar: **permiso para destruir la máquina**. Ya reproducido hoy | T0.3, una línea |
| 7 | Tailscale se pierde al rehacer la máquina | la web deja de ser alcanzable, y el síntoma parece del servidor | fase 4, en el repo del lanzador |

---

## 8. Lo que este plan NO resuelve

- **El histórico anterior no existe.** La web nace vacía y se llena desde el
  primer mensaje tras la fase 1. Hay un sembrado posible desde las conversaciones
  archivadas (22 ficheros, 28 MB, medido hoy en
  `foveal-vision-data/conversaciones/`), y **no está planificado** — es
  **[P8](decisiones.md)**.
- **La lista de conversaciones dirá `Tema 2` y `Tema 438`**, no nombres
  legibles. Es lo decidido en P9 y es reversible como mecanismo — pero los temas
  que ya existan **no traerán su nombre**: habría que renombrar cada uno una vez,
  con el bot vivo.
- **No mide el volumen.** La purga (30 días / 300 mensajes) sale de la
  especificación, no de una medida: el journal de esta máquina no sirve porque el
  droplet se rehizo hoy. Se revisa cuando haya una semana de log.
- **Sigue habiendo una sola instancia.** El límite del long polling no lo
  levanta nada de aquí: dos coordinadores siguen dando error 409. Con la opción B
  cambia sólo de forma —la web puede seguir viva con el bot parado, y por eso
  T2.10 le exige **decirlo**—, no de fondo.
- **No hay CI**, así que ninguna de las pruebas de § 6 se dispara sola. Es la
  **R17** incumplida en los dos repos, y este proyecto la hereda.
