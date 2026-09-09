# Web de lectura para el ejecutor `c` — propuesta

Estado: **propuesta, no implementada**. Escrita para vivir en `docs/`.

## El problema

Claude Code responde en markdown. Telegram no lo renderiza, así que llegan los
`###`, los `**`, las listas anidadas y las tablas en crudo. Y encima el
coordinador trocea a 4000 caracteres, que es un límite de transporte sin ninguna
relación con la estructura del texto: parte una tabla por la mitad, o separa un
encabezado de lo que encabeza.

**No son los bloques de código.** Claude Code escribe los archivos directamente y
rara vez vuelca código al chat. Lo que hay que leer bien son sus explicaciones:
encabezados, viñetas, negritas, tablas y `código en línea` con nombres de
archivo. El esfuerzo de renderizado va ahí.

## Lo que NO cambia

Esto no es una migración. Es un segundo cliente.

- **Tema de Telegram = sesión de claude.** Es el mecanismo que te da trabajos en
  paralelo, está probado, y no se toca. La web *muestra* sesiones; no las define.
- **Telegram sigue siendo cliente de primera.** Si la web se cae, si el droplet
  pierde Tailscale, si borras la PWA — el bot funciona exactamente como hoy. La
  web nunca puede ser el único camino a una sesión.
- **`claude-session.mjs` no se toca.** Sigue `claude -p`, salida entera por
  stdout, sin `--output-format stream-json`. Sin streaming no hay que rehacer la
  pieza más frágil.
- **Fuera del alcance:** ejecutores, encargados, `/ws`, `definer`, `repetir`,
  `shell`. La web solo sabe de conversaciones de `c`.

## La pieza nueva: un log de mensajes

Hoy no existe. `data/` guarda markers, `cwd` y sesiones, pero no *lo que se
dijo*: el texto vive en el chat de Telegram y en ningún sitio tuyo. Toda esta
propuesta depende de crear ese registro, y el resto sale casi gratis después.

```
data/mensajes/<sesión>.jsonl      un objeto por línea, append-only
```

```json
{"id":"01J…","ts":"2026-09-09T14:22:31Z","sesion":"-100…_7",
 "autor":"usuario|claude|sistema","texto":"…","origen":"telegram|web|resumer|repetir"}
```

`autor` es quién habla; `origen` es por dónde entró. Los separo porque un mensaje
tuyo puede llegar desde Telegram o desde la web, y quieres poder distinguirlo
cuando algo se comporte raro.

### Se publica ANTES de trocear

El troceo a 4000 caracteres es del transporte de Telegram, no del mensaje. El log
guarda la respuesta **entera, en una línea**, y Telegram sigue troceando aguas
abajo. Así la web renderiza la tabla completa aunque a ti te llegaran cuatro
mensajes.

### Los procesos desacoplados escriben al fichero, no al coordinador

`notify.mjs`, `claude-resumer.mjs` y `repetir` se mandan sus mensajes ellos mismos
por la Bot API precisamente para sobrevivir al turno que los lanzó y al reinicio
del bot. Si los obligas a hablar con el coordinador por HTTP, les quitas esa
propiedad: dejan de funcionar cuando el bot está caído, que es justo cuando más
falta hacen.

Así que **hacen `append` directo al JSONL** (con `O_APPEND`, una línea, escritura
atómica en la práctica para este tamaño) además de mandar a Telegram. El
coordinador se entera con `fs.watch` sobre `data/mensajes/`, con un sondeo cada 2 s
de respaldo por si el watcher no dispara.

## Arquitectura

```
Telegram ──┐                                 ┌── data/mensajes/*.jsonl
           ├→ coordinador → orquestador → publicar() ──┤
Web (POST)─┘                                 └── Bot API (trocea)

Web (SSE) ←── coordinador ←── fs.watch(data/mensajes/)

notify.mjs / claude-resumer / repetir ──→ append directo + Bot API
```

## Decisiones y por qué

**Servidor dentro del proceso del coordinador**, con `node:http`. Nada de un
segundo servicio: la web tiene que leer el log y llamar al orquestador, y
compartir proceso te ahorra IPC, otra unidad de systemd y una segunda copia del
estado. Con la regla que ya tienes: un fallo de la web no tumba el bot.

**SSE, no WebSocket.** El tráfico útil es servidor → navegador; escribir es un
`POST` normal. SSE reconecta solo y son treinta líneas.

**Vue 3 desde el build ESM del navegador, sin bundler.** Lo conoces de Inertia, y
sin paso de build el despliegue sigue siendo `git pull` + reiniciar — que es la
propiedad que te deja tocar este repo desde el celular. Un Vite en el droplet
convierte cada cambio de UI en un ritual.

**Vendorizado, no CDN.** `vue`, `markdown-it` y `highlight.js` copiados a
`web/vendor/`. Ya dependes de la red para llegar; no añadas depender de que unpkg
esté vivo. Y es requisito para que el service worker cachee la app.

**JSONL, no SQLite.** Append-only, legible con `tail -f`, respaldable con `cp`,
purgable reescribiendo el fichero. Para un usuario y unos cientos de mensajes por
sesión no hay problema de rendimiento que justifique un motor.

**`markdown-it` con `html: false`.** Innegociable. Esta app corre en una máquina
donde `bypassPermissions` está activo; dejar pasar HTML crudo desde una salida de
modelo es abrir XSS en tu propia consola de shell remoto.

## Acceso: Tailscale

El bot usa long polling justamente para no abrir puertos. Una web pública
invierte esa propiedad. `tailscale serve` te da HTTPS válido con nombre estable
(requisito para el service worker) sin abrir nada y sin escribir código de
autenticación propio, que sería el eslabón débil de una máquina que alquila GPUs
con tu tarjeta.

Costo: la app de Tailscale activa en el celular, y no puedes abrir el enlace desde
un dispositivo ajeno. Alternativa si eso estorba: Cloudflare Tunnel + Access —
tampoco abre puertos, pero mete una dependencia externa en el camino crítico y
Cloudflare termina el TLS, o sea que ve el tráfico descifrado. En una consola de
shell remoto eso no es un detalle menor.

### Puesta en marcha

En el droplet: instalar `tailscale`, unirlo a la red y `tailscale serve` apuntando
al puerto del coordinador. De ahí sale el certificado válido que el service worker
exige.

En el celular, una vez: instalar Tailscale con la misma cuenta, aceptar el diálogo
de VPN del sistema, abrir el nombre MagicDNS y "Añadir a pantalla de inicio".

**No hay pantalla de login.** La identidad la pone Tailscale: si el dispositivo
está en la red, es tuyo. Ese es el punto de la decisión — no escribir código de
autenticación para una app que ejecuta shell.

⚠ Excluir Tailscale de la optimización de batería en Android. Si el sistema lo
mata en segundo plano, la web deja de resolver sin ninguna explicación visible, y
el síntoma parece un fallo del servidor.

Si Tailscale está caído o lo desactivas, **Telegram funciona igual que hoy**. Esa
es la propiedad que hace tolerable depender de una VPN para el cliente cómodo.

## API

```
GET  /api/sesiones                        lista: id, título, último mensaje, pendiente
GET  /api/sesiones/:id/mensajes?desde=<id>  historial, paginado hacia atrás
GET  /api/eventos                         SSE: mensajes nuevos + cambios de estado
POST /api/sesiones/:id/mensajes           { texto } → entra por el mismo camino que Telegram
```

`POST` no es un atajo: inyecta el mensaje en el orquestador **igual que si hubiera
llegado por Telegram**, y por tanto también se manda a Telegram. Si los dos
clientes no ven lo mismo, el espejo miente.

## El cerrojo por sesión

Dos `claude --resume` del mismo hilo se pisan. Esto ya es cierto hoy —dos mensajes
seguidos en Telegram tienen la carrera— pero `repetir` lo esquiva saltándose la
vuelta y en la práctica no lo notas. Con un segundo canal de entrada la
probabilidad sube lo bastante como para que deje de ser teórico.

Hace falta un cerrojo real por sesión: cola en memoria dentro del coordinador
(cubre Telegram y web, que comparten proceso) más un fichero de bloqueo en `data/`
que los procesos desacoplados respeten. **Es la parte más delicada del proyecto**,
y conviene implementarla y probarla antes de que exista un botón de enviar en la
web.

## Interfaz

Móvil primero, una columna.

- **Lista de sesiones** con título del tema, hora del último mensaje y un
  indicador de "esperando respuesta". Sin streaming no hay señal de vida
  implícita: si no marcas el estado pendiente, la web parece colgada.
- **Vista de conversación**: burbujas tuyas alineadas a la derecha, las de Claude
  a ancho completo (su contenido es estructurado, no conversacional).
- **Renderizado**, por orden de importancia real: encabezados con jerarquía
  visible, listas anidadas con sangría, negritas y `código en línea`, tablas con
  scroll horizontal *contenido en la tabla* (que no mueva la página), enlaces
  tocables, citas.
- **Bloques de código**: monospace con ajuste de línea, sin scroll lateral. Son
  raros; no merecen plegado ni botón de copiar propio.
- **Selección de texto nativa.** Nada de gestos que secuestren la pulsación
  larga, nada de canvas. Copiar y pegar tiene que funcionar como en cualquier
  página.
- **Marcador de `creset`**: cuando subes la época, la conversación de claude
  empieza de cero pero el log sigue mostrando lo anterior. Sin una línea divisoria
  visible, la web te enseña un contexto que Claude ya no tiene — y esa es
  exactamente la clase de confusión que cuesta media hora entender.
- **PWA**: manifest e icono para instalarla en la pantalla de inicio. Service
  worker solo para cachear el armazón; **sin push**, porque Telegram ya te avisa.

## Purga

Conservar **30 días o 300 mensajes por sesión, lo que llegue primero**. Purgar al
arrancar y una vez al día, reescribiendo el fichero.

No es solo higiene de disco: el log contiene todo lo que Claude dijo, incluidas
salidas de shell y rutas. `data/mensajes/` va al `.gitignore` como el resto del
estado efímero, y la purga acota cuánto hay que perder si alguien entra.

## Orden de implementación

1. **`publicar()` + el log.** Telegram pasa a ser un suscriptor. Sin web todavía.
   Se verifica con `tail -f` y no puede romper nada visible.
   **Aquí va también la captura de `forum_topic_created` y `forum_topic_edited`**,
   aunque los títulos no se vean hasta la fase 2. Es lo único de todo el proyecto
   que no se puede reconstruir más tarde: cada renombrado que ocurra antes de que
   el bot escuche esos eventos se pierde sin remedio, porque no hay forma de
   consultarlo. Cuanto antes empiece a escuchar, menos temas habrá que renombrar
   a mano.
2. **Servidor HTTP + API de lectura + SSE.** Web de solo lectura. Ya resuelve el
   problema que te trajo aquí.
3. **Escritura desde la web + cerrojo por sesión.**
4. **PWA, purga y `tailscale serve`.**

La fase 2 ya vale por sí sola. Si el proyecto se queda ahí, no queda a medias.

## Límites conocidos

- **Tailscale tiene que estar activo** en el celular. No hay acceso desde un
  dispositivo prestado.
- **Sin push propio.** El aviso de trabajo largo sigue llegando por Telegram, con
  las mismas condiciones de siempre: es una comodidad, no la fuente de verdad.
- **Si el coordinador se reinicia a mitad de un turno de claude, la respuesta se
  pierde** — igual que hoy. La web no lo arregla y no debe aparentar que sí.
- **El log no es la conversación de claude.** La conversación vive en el almacén
  de claude; el log es una transcripción paralela. Pueden desincronizarse (un
  `creset`, un resumer que reinyecta) y el log tiene que reflejar esos eventos
  como mensajes de `sistema`, no esconderlos.
- **`fs.watch` no es fiable en todos los sistemas de ficheros.** Por eso el
  sondeo de respaldo, que no es opcional.
- **Una sola instancia, como siempre.** El servidor web hereda la restricción del
  long polling: si arrancas un segundo coordinador, sigues teniendo un 409.

## Títulos de sesión

Se usa el título del tema de Telegram. **La Bot API no permite consultarlo**: no
existe un `getForumTopic`, y los mensajes solo traen el `message_thread_id`. El
nombre llega únicamente en dos eventos de servicio, que el bot recibe por ser
admin del grupo:

- `forum_topic_created` — al crear el tema
- `forum_topic_edited` — al renombrarlo, con el nombre nuevo

El coordinador los captura y guarda `{ sesión: título }` en `data/temas.json`. Un
renombrado en Telegram se refleja en la web sin hacer nada más.

Cadena de respaldo cuando no hay título conocido:

1. el título del tema, si se vio algún evento;
2. si no, la primera línea de tu primer mensaje, recortada a ~40 caracteres;
3. si no, `Tema <id>`.

⚠ **Un renombrado mientras el bot está caído se pierde**, y no hay forma de
recuperarlo: no se puede preguntar. Lo mismo con los temas que ya existían antes
de esta función. La salida es la misma en los dos casos — renombrar el tema una
vez con el bot vivo — pero la web debe distinguir "título heredado del primer
mensaje" de "título de Telegram", o un nombre viejo parecerá un fallo.

⚠ **`data/temas.json` no es estado efímero.** El `cwd` y la época se pierden al
rehacer la máquina y no pasa nada: se vuelve al estado inicial. Los títulos no se
regeneran solos. Va fuera de git como el resto de `data/`, pero merece respaldo
aparte.

## Fuera de alcance, decidido

**Subir imágenes o capturas desde la web: no.** Telegram ya te da ese camino, y
meterlo aquí implica almacenamiento, límites de tamaño y un formato nuevo en el
log. Si algún día hace falta, se añade sin rehacer nada de lo anterior.
