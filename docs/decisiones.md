# Decisiones

Las 13 preguntas de este proyecto, **con la respuesta del dueño** (2026-09-09).
Se conserva la pregunta y el porqué: una decisión sin su motivo se revierte sola
la primera vez que estorba.

**Estado: 12 de 13 cerradas.** Queda abierta **[P9](#p9--el-nombre-de-cada-tema-en-la-app)**,
que es un malentendido por aclarar y de la que depende si la **fase 0 existe o
desaparece**.

| # | Decisión |
|---|---|
| [P1](#p1--dentro-del-proceso-o-servicio-aparte) | ✅ **servicio aparte** (opción B) |
| [P2](#p2--en-qué-interfaz-escucha) | ✅ **sólo `127.0.0.1`** |
| [P3](#p3--tailscale-y-sobrevivir-a-que-se-destruya-el-dev) | ✅ **tiene que sobrevivir al dev y relanzarse desde el mini** — factible, con tres pegas |
| [P4](#p4--qué-ejecutores-entran-en-el-log) | ✅ **sólo `c`** — implementado como **dato**, no cableado |
| [P5](#p5--se-redacta-el-log) | ✅ **sí, se redacta** |
| [P6](#p6--por-dónde-entra-un-mensaje-de-la-web) | ✅ **fichero de entrada + eco a Telegram**, para ver la misma conversación en los dos sitios |
| [P7](#p7--los-títulos-de-los-temas) | ⏸ depende de P9 |
| [P8](#p8--sembrar-el-historial-viejo) | ✅ **no** |
| [P9](#p9--el-nombre-de-cada-tema-en-la-app) | ⚠ **ABIERTA** — malentendido por aclarar |
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

⏸ **Depende de [P9](#p9--el-nombre-de-cada-tema-en-la-app).** La respuesta del
dueño —*«ponerle nombre distinto y numerado, y listo; si eso no es suficiente lo
resolvemos después de usarlo»*— apunta a que **no quiere maquinaria de títulos**,
lo que haría desaparecer la fase 0 entera. Pero eso hay que confirmarlo, porque
es justo la parte que no se puede recuperar más tarde.

## P8 · ¿Sembrar el historial viejo?

**Decisión: no.** La web empieza el día que se active el log.

## P9 · El nombre de cada tema en la app

⚠ **ABIERTA — y es la única que queda.** Hubo un malentendido: no hablo del
título del **chat** (el grupo, que efectivamente es fijo), sino del nombre de cada
**TEMA** dentro de ese grupo. Cada tema es una sesión y será **una conversación en
la lista de la app**, así que la app necesita algo que poner en esa lista.

Las dos salidas están escritas en el mensaje que acompaña a este documento; de la
respuesta depende si la **fase 0 se hace o se borra**.

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
