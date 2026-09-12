# Decisiones

Las 13 preguntas de este proyecto, **con la respuesta del dueño** (2026-09-09).
Se conserva la pregunta y el porqué: una decisión sin su motivo se revierte sola
la primera vez que estorba.

✅ **Estado: las 13 cerradas** (2026-09-09). No queda nada que decidir para
empezar a escribir código.

| # | Decisión |
|---|---|
| [P1](#p1--dentro-del-proceso-o-servicio-aparte) | ✅ **servicio aparte** (opción B) |
| [P2](#p2--en-qué-interfaz-escucha) | ✅ **sólo `127.0.0.1`** |
| [P3](#p3--tailscale-y-sobrevivir-a-que-se-destruya-el-dev) | ✅ **tiene que sobrevivir al dev y relanzarse desde el mini** — factible, con tres pegas. ⚠ **La primera PASÓ el 2026-09-10**, pero no por la authkey (que sí es efímera): la bloqueaba un nodo heredado de antes del mecanismo |
| [P4](#p4--qué-ejecutores-entran-en-el-log) | ✅ **sólo `c`** — implementado como **dato**, no cableado |
| [P5](#p5--se-redacta-el-log) | ✅ **sí, se redacta** |
| [P6](#p6--por-dónde-entra-un-mensaje-de-la-web) | ✅ **fichero de entrada + eco a Telegram**, para ver la misma conversación en los dos sitios |
| [P7](#p7--los-títulos-de-los-temas) | ✅ **no hay nada que respaldar**: lo resuelve P9 |
| [P8](#p8--sembrar-el-historial-viejo) | ✅ **no** |
| [P9](#p9--el-nombre-de-cada-tema-en-la-app) | ✅ **números y ya** — se borra la fase 0 entera |
| [P10](#p10--frontend) | ✅ **Vue ESM sin bundler**, como la especificación |
| [P11](#p11--dónde-vive-cada-documento-y-el-nombre-del-repo) | ✅ decidido: todo a git, especificación a `docs/`, nombre del repo **se queda** |
| [P12](#p12--en-qué-máquinas-va) | ✅ **sólo `dev`** |
| [P13](#p13--se-puede-instalar-en-el-móvil-y-es-seguro-el-acceso-directo) | ✅ **sí se puede, y es más seguro que token+ufw** — con datos |

---

## P1 · ¿Dentro del proceso, o servicio aparte?

**Decisión del dueño: aparte.**

Se sigue la opción B: el **log** lo escribe el coordinador; el **servidor, la API
y el frontend** viven en este repo con su propia unidad de systemd. Es lo que ya
funciona en esta máquina con `foveal-vision-web`, y lo que permite que un fallo
de la web **no pueda** tumbar el long polling — por estructura y no por
disciplina.

⚠ Esto **se aparta de la especificación**, que pedía el servidor dentro del
proceso del coordinador. La excepción queda anotada aquí con su motivo, que es lo
que manda el `CLAUDE.md` del coordinador cuando una decisión se cambia.

## P2 · ¿En qué interfaz escucha?

**Decisión: sólo `127.0.0.1`.** `tailscale serve` hace de proxy.

Esto es un **freno**, no una preferencia: el bot usa long polling justamente para
no abrir puertos, y quien alcance este puerto tiene shell con
`bypassPermissions`, sin allowlist. Va con test que falle si alguien lo cambia a
`0.0.0.0`.

✅ Y es compatible con lo elegido en P3: la documentación de `tailscale serve`
dice que **soporta proxy a `http://127.0.0.1`** (consultada el 2026-09-09).

## P3 · Tailscale, y sobrevivir a que se destruya el `dev`

**Requisito del dueño: la web tiene que sobrevivir a que se destruya el `dev`, y
relanzarse desde el mini.**

**Es factible, y el mecanismo ya existe y está probado.** Tres eslabones:

1. **El servicio se declara en `types/dev.json`**, como `foveal-vision-web` desde
   el 2026-08-29. Un `dev` nuevo lo trae solo, sin acordarse de ningún `--service`.
2. **El secreto viaja del mini al `dev` por `env_prefix`.** `do_droplet.py`
   (líneas 1686-1693) coge las variables del entorno de la **máquina que lanza**
   que empiecen por el prefijo, les quita el prefijo y las escribe en el `.env`
   del servicio en la máquina nueva. Es exactamente lo que hace `FVW_WEB_TOKEN`
   con la web de `foveal-vision`. Aquí: `CWEB_TS_AUTHKEY` en el mini →
   `TS_AUTHKEY` en el `dev` nuevo.
3. **El nombre estable** —lo que hace que la app ya instalada en el móvil siga
   funcionando— se resuelve con un **nodo efímero** de Tailscale: se borra solo de
   la tailnet tras la inactividad, así que el nombre queda libre para el `dev`
   siguiente.

⚠ **Las tres pegas, y las tres tienen remedio conocido:**

| Pega | Qué pasa | Remedio |
|---|---|---|
| **La limpieza del nodo tarda 30-60 min** *(documentación de Tailscale, consultada 2026-09-09; NO medido aquí)* | si relanzas el `dev` antes, el nuevo entra como `claude-web-1` y **la app instalada deja de resolver** | borrar el nodo **explícitamente** al destruir el droplet, desde el mini y en el mismo sitio donde se destruye — que es **R11**: quien apaga, limpia |
| **La authkey caduca**, 90 días como máximo *(íd.)* | un `dev` nuevo no se une, y la web nace **sin acceso y sin error** | usar un OAuth client (no caduca) o un preflight que avise antes de que expire |
| **Tailscale no está instalado** en esta máquina *(medido: `which tailscale` → not found)* | — | va en el `install` del servicio o en cloud-init, nunca a mano |

⚠ Y el puerto: el **443 lo tiene `sshd` en `0.0.0.0`** en esta máquina (medido),
o sea también en la interfaz de la tailnet. Se usa `tailscale serve --https=<otro>`.

### ⚠⚠ MEDIDO el 2026-09-10: la primera pega PASÓ — y la causa NO era la authkey

La tabla de arriba daba la limpieza del nodo por *«30-60 min»*, leída de la
documentación y marcada como **NO medida**. Medida ahora: **~75 min**, y funciona.
`tailscale status` en el dev del 2026-09-10, a las 17:36 UTC:

| nodo | estado |
|---|---|
| `dev` (el original) | apagado desde hacía **15 h**, todavía registrado |
| `dev-2`, `dev-3` | apagados hacía 1 h, todavía registrados |
| `dev-1` | **el vivo** — o sea que éste entró sufijado |

⚠⚠ **Y la primera lectura de esto fue EQUIVOCADA, así que queda anotada.** Se
concluyó *«la authkey en uso no es `Ephemeral`»* — razonable, y falsa. Lo que
faltaba era **mirar otra vez un rato después**:

| hora (UTC) | qué se vio |
|---|---|
| 17:36 | cuatro nodos `dev`: el vivo (`dev-1`) y tres apagados |
| **17:52** | **`dev-2` y `dev-3` habían DESAPARECIDO solos** — nadie los borró |

Se cayeron a las 16:37, o sea que tardaron **~75 min**. Eso es exactamente lo que
hace un nodo efímero: **la clave en uso sí lo es y funciona.**

El único que no se va es el **`dev` original**, apagado desde las 02:35 y todavía
registrado 15 h después. Se unió **antes de que existiera `tailscale-unir.mjs`**
(commiteado a la 01:28 de ese día; el nodo ya estaba dentro a las 00:41, por el
enlace de login), y un nodo que entra así no es efímero.

**O sea: un resto de una vez, no una configuración mal puesta.** Se borra una vez
y el nombre queda libre para siempre, porque todo lo que entra desde entonces se
limpia solo.

⚠ **La lección, que es la que se repite:** *«los nodos viejos no se borran»* y
*«este nodo viejo no se borra»* se parecen mucho y llevan a arreglos distintos —
uno manda a cambiar la clave (que aquí no habría arreglado nada) y el otro a
borrar un nodo. Lo que los distingue es **cuánto lleva muerto**, y eso se sabe
esperando, no razonando. Una medida tomada **una sola vez** no distingue «no pasa
nunca» de «todavía no ha pasado».

**Lo que costó**, y es exactamente lo que la pega predecía: la PWA instalada en
el móvil apuntaba a `https://dev.<tailnet>:8443/`, MagicDNS lo seguía resolviendo
—conserva los nodos apagados— y daba con una máquina muerta. Desde el móvil se
leyó como *«la app no funciona: Failed to fetch»*. **El servidor estaba
perfecto**: contestaba 200 por `dev-1`.

### ✅ RESUELTO el 2026-09-10: el nodo se da de baja SOLO, y sin ninguna credencial

**La carrera de los ~75 min está cerrada.** No esperando menos: quitando la espera.

⚠⚠ **La medición que lo decidió, porque la doc no bastaba.** Tailscale documenta
que `tailscale logout` *«removes it from your tailnet immediately»* — pero **esa
misma página da la limpieza por inactividad en «30 a 60 minutos» y aquí se
midieron ~75**. Una fuente que ya se quedó corta en el número de al lado no vale
para el número que decide. Medido en este dev:

| hora (UTC) | |
|---|---|
| 18:35:38 | `Self ID` = `nznvvWsNKE11CNTRL`, **3** nodos en la tailnet |
| 18:35:51 | `sudo tailscale logout` |
| 18:35:53 | vuelto a unir → `Self ID` = `nbjCKGjnuo11CNTRL`, y **otra vez `dev-1`** |
| 18:36:08 | **3** nodos. El ID viejo **no existe** |

Que recuperase el nombre `dev-1` en **2 s** es la prueba: si el viejo siguiera
registrado, el nuevo habría entrado como `dev-2`.

**La forma, y por qué ésta y no la API.** El lanzador gana un gancho **genérico**
`pre_destroy` en `services/*.json` —el simétrico del `install`— y el comando lo
pone este repo: `node scripts/tailscale-desunir.mjs --si`. El nodo se da de baja
**con su propia clave**, así que **la pregunta de la credencial desaparece en vez
de resolverse**: no hay nada potente que repartir, que caducar, ni que redactar
de las conversaciones archivadas.

⚠ La alternativa —que el lanzador llamara a `DELETE /api/v2/device/{id}`— exigía
un OAuth client capaz de borrar **cualquier** dispositivo de la tailnet, incluido
el móvil del dueño. Y se descartó además por un hecho comprobado ese día:
`types/mini.json` y `types/dev.json` llevan **los dos** `llavero: true`, así que
*«la credencial sólo en el mini»* **hoy no existe** — habría que inventar antes un
alcance por máquina en el llavero. (La lógica de esa vía quedó escrita y probada
en `scripts/tailscale-reclamar.mjs` como respaldo, y **no se usa**.)

⚠⚠ **Y la recogida NO puede impedir que se destruya el droplet.** Timeout corto,
se traga cualquier fallo y sigue: si pudiera tumbar el apagado, una molestia —el
nombre ocupado un rato— se convertiría en una **factura** —un droplet vivo que
nadie apaga—. Es la lección del 2026-09-04 llevada a la estructura, y tiene test
en las cinco ramas de fallo (`tests/test_pre_destroy.py` del lanzador).

**Lo que NO cubre**, dicho claro: un droplet que muera **sin** pasar por `destroy`
(consola de DO, caída) sigue esperando los ~75 min. Ahí el freno es que
`avisoDeDeriva()` lo **dice** por Telegram en vez de dejar la URL muerta en
silencio.

⚠ **Y el remedio que la tabla propone (`borrar el nodo al destruir el droplet,
desde el mini`) queda hecho, pero del revés de como lo proponía**: no lo borra el
mini llamando a la API, lo borra **la propia máquina** antes de morir. Mientras
no estuvo, hacían falta las dos cosas:

1. **Que la authkey sea `Ephemeral`** — ya lo es, comprobado arriba. Cubre el
   caso normal: cada dev destruido se borra solo en ~1 h.
2. **Que el nodo nuevo AVISE si no consiguió su nombre** — cubre el caso en que
   aun así pase. Implementado el 2026-09-10 en `scripts/nodo.mjs`, y lo usan
   `tailscale-unir.mjs` (al aprovisionar, con aviso por Telegram) y `cweb url`
   (que es lo que se pregunta desde el móvil cuando la app falla).

**Por qué hacía falta la 2 aunque exista la 1:** `tailscale up --hostname=dev`
**no falla** cuando el nombre está ocupado. Sufija y sale con **código 0**, el
`serve` queda puesto y la web contesta 200. Todo verde, y todo cliente instalado
fuera. Es la regla del proyecto: *`Result=success` no dice que se hiciera lo que
pediste* — se comprueba **el nombre que te dieron**, no el código de salida.

## P4 · ¿Qué ejecutores entran en el log?

**Decisión del dueño: sólo `c`.**

⚠ Y se implementa **sin cablear `c` en el coordinador**, porque cablearlo rompería
su filosofía 2 (*«no hay tipos especiales cableados»*) y la **R18**. La forma que
da exactamente lo pedido sin romper nada es la que este proyecto usa para todo lo
demás: **un campo en el JSON del ejecutor**.

```json
{ "name": "c", "command": "node scripts/claude-session.mjs …", "registrar": true }
```

El orquestador pregunta *«¿este ejecutor pide registro?»*, no *«¿este ejecutor se
llama `c`?»*. Resultado idéntico hoy —sólo `c` deja log— y mañana se puede
registrar otro cambiando un dato, sin tocar código ni reiniciar.

**Y de paso desaparece el problema del tamaño**: sin `shell` en el log, nadie
vuelca megabytes. El tope por mensaje se mantiene igual, por si acaso.

## P5 · ¿Se redacta el log?

**Decisión: sí**, con `scripts/redactar.mjs`, que ya existe y ya se usa en dos
sitios (el archivador de conversaciones y el log de errores).

⚠ Con la trampa ya medida aquí: **redactar de más también es un fallo** — filtrar
por longitud borraba `CLAUDE_PERMISSION_MODE` de las 18 veces que sale en una
conversación normal. Lo que decide es el **nombre** de la variable, no el tamaño
del valor.

⏸ Queda **sin decidir, y anotado a propósito**: `data/buffer/` y
`data/repeticiones/` **ya guardan texto tuyo sin redactar** hoy. No entra en el
alcance de este proyecto; queda escrito para que no se lea como que no existe.

## P6 · ¿Por dónde entra un mensaje de la web?

**Petición del dueño: que aparezca también en Telegram, aunque se vea como
enviado desde el server — para leer la misma conversación en los dos sitios.**

Eso es exactamente lo que ya pedía la especificación (*«si los dos clientes no ven
lo mismo, el espejo miente»*), así que se mantiene y se concreta:

- **Camino**: la web deja el mensaje en un **fichero de entrada** y el coordinador
  lo recoge (era la opción (a)). Es simétrico con lo que la especificación ya
  diseña para los procesos desacoplados, no abre ningún puerto nuevo, y deja
  **un solo sitio** que habla con Telegram y **un solo camino** de ejecución.
- **Eco a Telegram**: el coordinador publica en el tema lo que escribiste en la
  app, y después la respuesta, como siempre.
- ⚠ **Se verá como un mensaje del bot, no tuyo.** Un bot de Telegram no puede
  publicar en nombre de una persona: la Bot API no lo permite. Así que el eco
  llevará una marca que lo diga, del estilo `📱 (desde la app) <tu texto>`. La
  conversación se lee entera y en orden en los dos sitios, que es lo pedido.
- **Cerrojo**: encolar y avisar, no rechazar. Se reusa el detector de
  `scripts/repetir-bucle.mjs` (dos señales: `pgrep` del uuid y el `mtime` del
  marker), que ya está probado.

## P7 · Los títulos de los temas

✅ **Deja de existir el problema.** Con [P9](#p9--el-nombre-de-cada-tema-en-la-app)
resuelto en «números y ya», **no hay `data/temas.json`**: no hay ningún dato
irrecuperable que respaldar, ni eventos que capturar, ni cadena de respaldo.

Era el único punto del proyecto que chocaba con la **R9** (*un dato que no se
puede re-derivar y no se guarda, se pierde*). Se resolvió por el camino más
barato de los posibles: **no producir el dato**.

## P8 · ¿Sembrar el historial viejo?

**Decisión: no.** La web empieza el día que se active el log.

## P9 · El nombre de cada tema en la app

**Decisión: números y ya.** Cada conversación de la lista se llama
**`Tema <threadId>`**, y ese número es un **hecho de Telegram** — no se guarda, se
lee del propio `sessionId` (**R16**: la identidad la da un dato comprobable). No
se puede perder ni desincronizar, y no hay nada que mantener.

**Lo que esto borra**, y es la mitad del valor de la decisión:

| Se cae | Por qué existía |
|---|---|
| los handlers de `forum_topic_created` / `forum_topic_edited` | era la única forma de saber el nombre de un tema |
| `src/temas.ts` y `data/temas.json` | dónde se guardaba |
| la cadena de respaldo de tres niveles | qué poner cuando no hay título |
| su choque con la allowlist | quién genera esos eventos |
| **la urgencia del proyecto** | los renombrados se perdían mientras nadie escuchara |

⚠ **Y lo que se acepta a cambio, dicho claro:** con varios temas abiertos, la
lista dirá `Tema 2` y `Tema 438` y tendrás que recordar cuál es cuál.

⚠ **Es reversible como mecanismo, pero no hacia atrás.** Si algún día quieres
nombres legibles, se añade sin rehacer nada de lo anterior — pero los temas que ya
existan **no traerán su nombre**: habrá que renombrar cada uno una vez, con el bot
vivo, para que llegue el evento. Es barato, y conviene saberlo antes que después.

## P10 · Frontend

**Decisión: Vue 3 desde el build ESM del navegador, sin bundler y vendorizado**,
como dice la especificación. El argumento que gobierna es suyo: *«sin paso de
build el despliegue sigue siendo `git pull` + reiniciar»*, que es lo que permite
tocar este repo desde el móvil.

⚠ Va a contracorriente del precedente de la casa (`foveal-vision/web` es React +
Vite con `dist/` ignorado por git, medido el 2026-09-09), y es deliberado.

## P11 · Dónde vive cada documento, y el nombre del repo

**El dueño delegó la decisión, con un requisito: que sobreviva a la destrucción
del server.** Decidido:

1. **Todo documento va a git y nada vive sólo en la máquina.** Es la regla del
   proyecto (*«lo que no está empujado, no existe»*) y ya se cumple.
2. **La especificación se mueve a `docs/especificacion.md`**, que es donde ella
   misma decía que quería vivir.
3. **El formato del log se escribirá en `telegram-coordinator/docs/`**, no aquí:
   lo produce el coordinador, y lo que cruza repos se escribe donde se dispara y
   desde el otro se enlaza — copiarlo es como nacen las dos mitades desfasadas.
4. **El nombre del repo se queda.** La **R1** pide nombres que digan la línea de
   trabajo y no la capa técnica; `claude-code-webapp-mobile` **sí** dice qué es y
   para quién. Renombrarlo obligaría a tocar el manifiesto del lanzador, el clon
   local y los enlaces de tres repos a cambio de nada medible.

## P12 · ¿En qué máquinas va?

**Decisión: sólo `dev`.** No va al mini. Coherente con P3: el mini es quien la
**relanza**, no quien la sirve.

## P13 · ¿Se puede instalar en el móvil, y es seguro el acceso directo?

**Sí se puede, y sí es seguro — pero con Tailscale, no con token+ufw.** El dueño
prefería token+ufw; los datos dicen que ese camino no da lo que pide.

**Lo que hace hoy la web de `foveal-vision`** (medido el 2026-09-09 en
`scripts/web_app.py:332` y `ip_publica()`): publica
`http://<IP-pública-del-droplet>:8010/?token=…`. De ahí salen tres problemas:

| | |
|---|---|
| **La IP cambia con cada `dev`** | la app instalada en el móvil apuntaría a una IP muerta → **incumple el requisito de P3**. Y el lanzador **no soporta IP reservada** (comprobado: 0 coincidencias de `reserved_ip`/`floating` en `do_droplet.py`) |
| **Es `http://`, sin TLS** | el token viaja **en claro** dentro de la URL: cualquiera en la misma wifi lo lee, y queda en historiales |
| **Sin HTTPS no hay service worker** | no se puede instalar como PWA de verdad; sólo quedaría un acceso directo |

**Con Tailscale**, en cambio: `tailscale serve` **provisiona certificado TLS
válido automáticamente** y admite proxy a `http://127.0.0.1` (documentación
consultada el 2026-09-09), con nombre estable. O sea **se instala una vez y se
abre sin escribir nada**, que es justo lo que pedía.

**¿Es seguro que el acceso no pida autenticación?** Sí, y de hecho es
**estrictamente más seguro** que el token:

- **Nada queda expuesto a Internet**: no hay puerto abierto que escanear. Con
  token+ufw el puerto está abierto al mundo y la única barrera son 144 bits en una
  URL que viaja sin cifrar.
- **La identidad la pone el dispositivo**, no un secreto copiable. No hay código
  de autenticación propio que escribir — y ése habría sido el eslabón débil de una
  app que ejecuta shell.
- **El riesgo que queda**: quien tenga tu móvil desbloqueado tiene la app, y en la
  fase 3 la app escribe a `c` con `bypassPermissions`. ⚠ Pero eso **ya es cierto
  hoy con Telegram**: no es una clase de riesgo nueva, es una segunda puerta al
  mismo sitio. Si algún día quieres cerrar esa puerta, se cierra en el móvil
  (bloqueo de pantalla), no en el servidor.
- **El coste**: hay que tener Tailscale activo en el móvil, y no se puede abrir
  desde un dispositivo prestado. ⚠ Y en Android hay que **excluirlo de la
  optimización de batería**: si el sistema lo mata en segundo plano, la web deja
  de resolver sin ninguna explicación visible y el síntoma parece del servidor.

**`foveal-vision-web` se queda como está.** Conviven dos formas de llegar a la
máquina, y eso es una **R19** aceptada a sabiendas: aquella app es de escritorio y
de trabajo puntual; ésta es de móvil y de uso diario. El motivo queda escrito aquí
para que no se lea como un descuido.

## P14 · Tailscale marcado como VÁLIDO, y se prueba Cloudflare Tunnel (2026-09-12)

**Decisión del dueño, con sus palabras:** «el problema es que estamos manteniendo
tailscale a pesar de los problemas. Cierto que los hemos superado, pero seguro van a
salir nuevos. Debemos probar una alternativa. Marquemos este punto como válido
Tailscale, pero vamos a probar otra alternativa. Importante que el app debe ser
instalable, para poder interactuar con el sistema como se hace desde Telegram (sólo que
con una vista para los markdown), esa es la única restricción.»

**Qué se marca como válido:** el estado del 2026-09-11 por la noche, tag
`tailscale-valido-2026-09-11` aquí y en el lanzador. Los cuatro incidentes desde P3
(nombre `dev-1`, authkey en el journal, `serve` con nombre viejo, límite de Let's
Encrypt) están cerrados con test; el último, haciendo viajar el certificado con la flota.
Lo que se cierra ahí es el patrón «rehacer el dev cada día con el mismo nombre», que era
de donde salían tres de los cuatro.

**Qué se prueba:** Cloudflare Tunnel + Access, y por qué ésta y no otra: es la única
alternativa que **cambia la ecuación** en vez de mover el problema. Sin puerto abierto
(el túnel sale del droplet), sin certificado que pedir ni que viajar, sin app en el
móvil, sin nodo que tenga que recuperar su nombre, y con un token que no caduca. Las
descartadas: IP reservada + dominio + Caddy en la IP pública (mismo certificado con el
mismo límite, y obliga a escribir autenticación delante de una shell con
`bypassPermissions`), ngrok (interstitial en el plan gratuito, que rompe la PWA), y
WireGuard/headscale (más trabajo por lo mismo).

**Lo que se acepta a sabiendas:** el tráfico pasa en claro por el borde de Cloudflare,
y Access es la única barrera. Y un dominio que hay que pagar.

**Cómo conviven:** `CWEB_ACCESO` decide, y sin él el dato (hay token de túnel →
cloudflare). `services/claude-web.json` del lanzador llama a `scripts/acceso.mjs`, que
delega en los scripts de Tailscale o levanta el túnel. La vuelta atrás es una variable.

**Estado:** el túnel rápido está visto en vivo desde el dev (2026-09-12 00:37 UTC,
HTTPS válido en 0,38 s). El túnel con nombre y Access **no**, porque hace falta el
dominio del dueño: `docs/pendiente-verificar.md` tiene los pasos.

