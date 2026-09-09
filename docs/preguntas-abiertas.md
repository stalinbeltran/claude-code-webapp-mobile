# Preguntas abiertas

Lo que hace falta decidir para implementar [`web-lectura-c.md`](../web-lectura-c.md)
**entera**. Numeradas para poder responder por número; cada una dice **qué
bloquea** y trae una **recomendación**, que es sólo eso.

Escrito el 2026-09-09, tras leer la especificación y comprobarla contra el código
del coordinador y contra esta máquina.

> **Se puede empezar sin responder ninguna.** La
> [fase 0](plan-detallado.md#fase-0--los-títulos-hoy-y-solas) —capturar los
> títulos de los temas— no depende de nada de aquí, y es lo único con reloj: lo
> que no se capture hoy, no se recupera nunca.

| # | Pregunta | Bloquea |
|---|---|---|
| [P1](#p1--dentro-del-proceso-del-coordinador-o-servicio-aparte) | ¿dentro del proceso del coordinador, o servicio aparte? | fases 2 y 3 |
| [P2](#p2--el-servidor-escucha-sólo-en-127001) | ¿el servidor escucha sólo en `127.0.0.1`? | fase 2 |
| [P3](#p3--tailscale-se-adopta-y-quién-lo-instala) | Tailscale: ¿se adopta, y quién lo instala? | fase 4 |
| [P4](#p4--el-log-guarda-todos-los-ejecutores-o-sólo-c) | ¿el log guarda todos los ejecutores o sólo `c`? | fase 1 |
| [P5](#p5--se-redacta-el-log-antes-de-escribirlo) | ¿se redacta el log? | fase 1 |
| [P6](#p6--por-dónde-entra-un-mensaje-escrito-en-la-web-y-qué-hace-el-cerrojo) | ¿por dónde entra un mensaje de la web, y qué hace el cerrojo? | fase 3 |
| [P7](#p7--datatemasjson-se-pierde-al-rehacer-la-máquina) | ¿`data/temas.json` se pierde al rehacer la máquina? | (afecta a la fase 0) |
| [P8](#p8--se-siembra-el-historial-que-ya-existe) | ¿se siembra el historial que ya existe? | nada |
| [P9](#p9--los-eventos-de-tema-y-la-allowlist) | los eventos de tema y la allowlist | nada |
| [P10](#p10--vue-sin-bundler-o-coherencia-con-lo-que-ya-hay) | ¿Vue sin bundler, o coherencia con lo que ya hay? | nada |
| [P11](#p11--dónde-vive-cada-documento-y-cómo-se-llama-este-repo) | dónde vive cada documento, y el nombre del repo | nada |
| [P12](#p12--la-web-va-también-en-el-mini-o-sólo-en-dev) | ¿la web va también en el mini? | nada |
| [P13](#p13--conviven-dos-formas-de-llegar-a-esta-máquina) | ¿conviven dos formas de llegar a la máquina? | nada |

---

## P1 · ¿Dentro del proceso del coordinador, o servicio aparte?

⛔ **La más importante, y la única que contradice a la especificación.**

Ella decide: *«servidor dentro del proceso del coordinador. Nada de un segundo
servicio»*. Al comprobarlo (§ 4 del [plan general](plan-general.md)) choca con
**R1, R3 y R18** y con un precedente que ya corre en esta máquina:
`foveal-vision-web` es exactamente el reparto contrario —repo propio, unidad
propia, manifiesto en el lanzador, ejecutor de Telegram propio— y funciona.

Y hay un hecho que decide la forma: **el lanzador rechaza dos servicios del mismo
directorio** (`do_droplet.py`, `selected_services`, con un `die()` explícito y el
motivo escrito: comparten `.env` y datos). O sea que *«servidor con unidad
propia»* y *«repo propio»* no son dos decisiones: son la misma.

⚠ Y la propia especificación pide, dos frases después, algo que el proceso
compartido no da por estructura: *«un fallo de la web no tumba el bot»*.
Compartiendo proceso eso pasa a ser disciplina — un `error` de socket sin manejar
mata el polling.

- **(a)** Como dice la especificación: todo dentro del coordinador. Compra que la
  fase 3 sea un `import` de `processIncoming`, un solo `.env` y una sola unidad.
- **(b)** El log en el coordinador; el servidor y el frontend aquí, con su unidad.
  ← **recomendada**

**Bloquea** las fases 2 y 3. La fase 1 no: el log va en el coordinador con las dos.

## P2 · ¿El servidor escucha sólo en `127.0.0.1`?

Hoy el coordinador **no escucha ningún puerto**: usa long polling precisamente
para eso. Abrir uno es una **segunda puerta al orquestador**, que corre con
`CLAUDE_PERMISSION_MODE=bypassPermissions` — quien lo alcance tiene shell, y la
allowlist de Telegram no lo cubre.

En esta máquina hay precedente de lo contrario: `fv.api` escucha en
`0.0.0.0:8010` con token en la puerta (medido 2026-09-09).

- **(a)** `127.0.0.1`, y `tailscale serve` hace de proxy — con un **test** que
  falle si alguien lo cambia. ← **recomendada**
- **(b)** `0.0.0.0` + token + `ufw`, como `fv.api`. Camino ya andado aquí, pero
  mete código de autenticación propio en la puerta de un shell remoto, que es
  justo lo que la especificación quería evitar.

**Bloquea** la fase 2.

## P3 · Tailscale: ¿se adopta, y quién lo instala?

**No está instalado** (`which tailscale` → *command not found*, hoy). Tres cosas
que la especificación no cubre:

1. **El puerto 443 lo tiene `sshd` en `0.0.0.0`**, o sea también en la interfaz de
   Tailscale — y `tailscale serve` quiere 443 por defecto. ¿Otro puerto
   (`--https=8443`), o se mueve `sshd`?
2. **Instalado a mano se pierde al rehacer el droplet**, y con él el único camino
   a la web. Para que sobreviva va en `types/dev.json` del **lanzador**, y su
   authkey en los **dos** ficheros de secretos.
3. **El nombre del nodo tiene que ser fijo.** Si cada droplet entra con nombre
   autogenerado, la PWA instalada en el móvil apunta a un host que ya no existe.

- **(a)** Adoptarlo, y meterlo en el lanzador en la misma tanda. ← **recomendada**
- **(b)** A mano, aceptando **por escrito** que se pierde al rehacer la máquina.
- **(c)** No adoptarlo, y quedarse con **P2(b)**.

**Bloquea** la fase 4.

## P4 · ¿El log guarda todos los ejecutores, o sólo `c`?

La especificación dice *«la web solo sabe de conversaciones de `c`»*, pero quien
escribe el log es el orquestador, que atiende a **todos**. Si filtra por nombre,
el núcleo aprende el nombre de un ejecutor concreto: su filosofía 2 (*«no hay
tipos especiales cableados en el coordinador»*) y la **R18**, rotas.

- **(a)** Registrar todo y filtrar en la web. ← **recomendada**. Cuesta disco —un
  `>>SHELL` puede volcar megabytes—, así que hace falta un **tope por mensaje**
  (¿64 KB, recortando por el final y **diciéndolo** dentro del texto?).
- **(b)** Sólo `c`, con el nombre cableado en el orquestador.
- **(c)** Un campo en el JSON del ejecutor (`registrar: true`): **dato y no
  código**, que es como este proyecto ha metido todo lo demás.

**Bloquea** la fase 1.

## P5 · ¿Se redacta el log antes de escribirlo?

Aquí **ya se filtró un token una vez** por esta vía (*«un mensaje a `c` pidiendo
leer `.env`»*). El log va a contener todo lo que Claude dijo, incluidas salidas de
shell.

A favor de no redactar: el fichero **no se commitea** y no sale de la máquina.
En contra: **se sirve por HTTP** y se queda cacheado en el móvil.

- **(a)** Redactar con `scripts/redactar.mjs`, que ya existe y ya se usa en dos
  sitios. ← **recomendada**
- **(b)** No redactar y confiar en la purga.

⚠ Si es (a), hay una trampa **ya medida aquí**: redactar de más también es un
fallo — filtrar por longitud borraba `CLAUDE_PERMISSION_MODE` de las 18 veces que
sale en una conversación normal.

⚠⚠ **Y una segunda mitad que salió al verificar este plan: `data/` YA guarda
texto tuyo sin redactar, en dos sitios.** `data/buffer/<sesión>.json` conserva un
pegado a medias mientras se ensambla —y si caduca **se aparta, no se borra**
(`<sesión>.caducado-<ts>.json`), o sea texto crudo en disco indefinidamente—, y
`data/repeticiones/` guarda la frase armada de `repetir` mientras lo esté. Si el
motivo de redactar el log nuevo es que *«ya se filtró un token una vez»*, la misma
pregunta vale para esos dos. **¿Entran en el alcance, o se dejan como están y se
anota por qué?**

**Bloquea** la fase 1.

## P6 · ¿Por dónde entra un mensaje escrito en la web, y qué hace el cerrojo?

**Dos decisiones que van juntas.**

**El camino.** La especificación dice *«inyecta el mensaje en el orquestador igual
que si hubiera llegado por Telegram»*. Con **P1(a)** eso es una llamada a
`processIncoming` y no hay nada que decidir. Con **P1(b)**:

- **(a)** La web escribe un fichero de entrada y el coordinador lo mira con
  `fs.watch` — **simétrico** con lo que la especificación ya diseña para los
  procesos desacoplados, y sin abrir ningún puerto nuevo. ← **recomendada**
- **(b)** La web llama a `claude-session.mjs`, como ya hace `repetir-bucle.mjs`
  desde su unidad. Funciona hoy, pero **sólo sabe de `c`**.
- **(c)** Un endpoint mínimo en el coordinador, escuchando en `127.0.0.1`.

**El cerrojo.** `repetir` ya detecta *«hay alguien más en este hilo»* con dos
señales (`pgrep` del uuid + `mtime` del marker) y **se salta la vuelta**. Para la
web, saltarse el mensaje no vale:

- **(a)** Encolar y avisar («va detrás de otro turno»). ← **recomendada**
- **(b)** Rechazar y que el usuario reintente.

⚠ Sea cual sea: **el cerrojo lleva su regla de caducidad escrita al lado**. Sin
dueño vivo no hay cerrojo — aquí ya costó una función muerta en silencio
(`.resume.lock`).

**Bloquea** la fase 3.

## P7 · ¿`data/temas.json` se pierde al rehacer la máquina?

⚠ Es el único dato del proyecto que **no se puede reconstruir**: no existe
`getForumTopic` (verificado). Y `data/` está en `.gitignore`, así que hoy se iría
entero con el droplet. La especificación lo nota (*«merece respaldo aparte»*) y no
lo cierra.

- **(a)** Aceptar la pérdida por escrito, y renombrar los temas a mano cuando pase.
- **(b)** Respaldarlo. **¿Dónde?** Contiene `chatId`s del grupo privado, así que no
  puede ir a un repo público sin pensarlo. ← **recomendada**, si me dices dónde.

**Afecta** a la fase 0, que es la que ya se puede hacer hoy.

## P8 · ¿Se siembra el historial que ya existe?

La web nace vacía. Hay 22 conversaciones archivadas (28 MB comprimidos, medido hoy
en `foveal-vision-data/conversaciones/`) que podrían sembrar el log.

- **(a)** No sembrar: la web empieza el día de la fase 1. ← **recomendada** (es
  trabajo real y el formato no coincide).
- **(b)** Sembrar con un script de un solo uso.

## P9 · Los eventos de tema y la allowlist

El middleware de allowlist (`src/bot.ts:191-196`) corta todo lo que no venga de un
id permitido, y un `forum_topic_created` lo genera **quien creó el tema**. Si
algún día lo crea o renombra otra persona, el título se pierde en silencio.

- **(a)** Registrar esos dos handlers **antes** de la allowlist: el título de un
  tema no es una capacidad, es un dato de un chat donde el bot ya está.
  ← **recomendada**
- **(b)** Dejarlos detrás y aceptar el hueco.

## P10 · ¿Vue sin bundler, o coherencia con lo que ya hay?

La especificación elige **Vue 3 ESM sin bundler y vendorizado**, para que
desplegar siga siendo `git pull` + reiniciar. Pero en esta máquina ya hay una web
app con el enfoque contrario: `foveal-vision/web` es **React + Vite** con `dist/`
ignorado por git (0 ficheros versionados, medido hoy), o sea que allí desplegar
exige `npm run build` en el droplet.

- **(a)** Como dice la especificación. ← **recomendada**: el argumento *«tocar
  este repo desde el celular»* es el que gobierna aquí.
- **(b)** React + Vite, por coherencia con lo que ya se mantiene.

## P11 · ¿Dónde vive cada documento, y cómo se llama este repo?

Dos cosas que ahora son baratas y luego no:

1. **`web-lectura-c.md` está en la raíz** y él mismo dice *«escrita para vivir en
   `docs/`»*. ¿Lo muevo a `docs/especificacion.md`? Y **el formato del log** iría
   al coordinador, que es quien lo produce: lo que cruza repos se escribe donde se
   **dispara** y desde el otro se **enlaza**.
2. **El nombre del repo** describe la tecnología y el dispositivo
   (`claude-code-webapp-mobile`); la **R1** pide que diga la **línea de trabajo**.
   Con un solo commit, renombrarlo no cuesta nada.

## P12 · ¿La web va también en el mini, o sólo en `dev`?

El mini no lleva ni Claude Code, porque no cabe en 512 MB. Si va sólo en `dev`, se
rehace con esa máquina — que es lo normal aquí.

## P13 · ¿Conviven dos formas de llegar a esta máquina?

`foveal-vision-web` ya está expuesta con token y `ufw`; la especificación propone
Tailscale para ésta. Si conviven, *«¿cómo llego a mi server?»* tiene dos
respuestas y cada una su modo de fallo — que es la forma de una migración a
medias (**R19**). ¿Se unifica, o se acepta y se escribe por qué?
