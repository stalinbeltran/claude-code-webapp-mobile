# claude-code-webapp-mobile

Una web (PWA de móvil) para **leer en markdown renderizado** lo que responde
Claude Code cuando se le habla desde Telegram por el ejecutor `c` del
[coordinador](https://github.com/stalinbeltran/telegram-coordinator).

Telegram no renderiza markdown: llegan los `###`, los `**` y las tablas en crudo,
y encima el coordinador trocea a 4000 caracteres —un límite de transporte—, así
que una tabla puede partirse por la mitad. Esta web es un **segundo cliente** que
lee lo mismo, bien formateado. **Telegram sigue siendo cliente de primera**: si
esta web se cae, el bot funciona exactamente igual.

## Cómo se usa, de verdad

> ⚠ Lo marcado con `(ejemplo, NO ejecutado)` es lo que **todavía no se ha corrido
> tal cual**: una sesión inventada envejece peor que una tabla, porque parece una
> transcripción. Lo demás sí se ejecutó el 2026-09-09.

Desde Telegram, en cualquier tema:

```
tú  → /use cweb
bot ← ✅ Sesión abierta con "cweb". Envía tus mensajes.
      La web para LEER las conversaciones de `c` con el markdown renderizado.
      Sin argumentos, el estado.
      Ejemplos:
        estado
        url
        arrancar

tú  → estado
bot ← web de lectura: 🟢 corriendo   (unidad claude-web)
      puerto        : 8020, sólo en 127.0.0.1
      log que lee   : /home/deploy/src/telegram-coordinator/data
      conversaciones: 1

      Desde el móvil: todavía NO se puede llegar.
        Escucha sólo en loopback a propósito (quien alcance este puerto tiene
        shell en esta máquina). Falta Tailscale: ver docs/decisiones.md, P3.
        Mientras tanto, por túnel SSH:  ssh -L 8020:127.0.0.1:8020 <esta-máquina>
```

Y cuando esté Tailscale *(ejemplo, NO ejecutado)*:

```
tú  → url
bot ← Desde el móvil (con Tailscale activo):
        http://dev.tu-tailnet.ts.net:8080/
```

Abres esa dirección en el móvil y la guardas en marcadores. No hay pantalla de
login: la identidad la pone la red.

⚠ **«Añadir a pantalla de inicio» ya NO sale**, y no es un fallo del móvil: ver
[§ Por qué ya no hay certificado](#por-qué-ya-no-hay-certificado-2026-09-11).

### Si algo va mal

```
tú  → log            ← las últimas 40 líneas del servicio
tú  → parar          ← lo apaga (Telegram sigue funcionando igual)
tú  → arrancar       ← lo vuelve a levantar
tú  → instalar       ← recrea la unidad de systemd, si se perdió al rehacer la máquina
```

#### ⚠⚠ «No pude leer las conversaciones: Failed to fetch» — casi siempre es la URL, no la app

**Lo primero: pide la dirección de ahora.** `/use cweb` → `url`. Si el nodo ha
cambiado de nombre, esa orden te lo dice y te da la buena.

**Por qué pasa, medido el 2026-09-10.** Estos servidores se rehacen, y el nodo
nuevo **no siempre recupera su nombre**: si en la tailnet queda un nodo apagado
llamado `dev`, Tailscale mete al nuevo como `dev-1` — **sin fallar**, con código
0 y con la web contestando 200 por su nombre nuevo. Ese día había cuatro nodos
`dev` (uno vivo y tres muertos).

Y el síntoma engaña por dos motivos que se suman:

| | |
|---|---|
| MagicDNS **conserva** los nodos apagados | `dev.<tailnet>` sigue resolviendo, a una máquina que ya no existe |
| El service worker sirve el armazón desde caché, pero **`/api/` nunca** | la app **abre normal** y sólo fallan los datos — que es justo lo que te convence de que el servidor está ahí |

Así que lo que se lee desde el móvil es «la app está rota» cuando el servidor
está perfecto. **La app ya no dice sólo `Failed to fetch`**: nombra el origen
contra el que falló, avisa de que lo que ves viene de la caché, y da las dos
causas (Tailscale apagado en el móvil · la máquina cambió de nombre).

**Cómo se arregla**, y es una vez:

1. Borra los nodos apagados que se llamen `dev` en
   [la consola](https://login.tailscale.com/admin/machines).
2. `node scripts/tailscale-unir.mjs` para reclamar el nombre.

⚠ **NO era la authkey, aunque es lo primero que se piensa** — y conviene saberlo
antes de cambiarla, porque cambiarla no habría arreglado nada. Medido el mismo
día: dos nodos que se cayeron a las 16:37 **se borraron solos** hacia las 17:52.
Eso es lo que hace un nodo efímero, así que la clave en uso **sí lo es y
funciona**. El que bloqueaba el nombre era **uno solo y de antes**: el `dev`
original, unido por enlace de login cuando este script todavía no existía, y por
tanto no efímero. Se borra una vez y ya.

**La regla para la próxima**, que es lo que distingue los dos casos: **mira
cuánto lleva muerto el nodo que estorba.** Menos de una hora, espera. Horas o
días, es un resto de antes: bórralo. Sólo si un nodo recién caído sigue ahí al
día siguiente es que la clave no es `Ephemeral`.

**Y `tailscale-unir.mjs` ya no se calla**: compara el nombre que pidió con
el que le dieron y avisa por Telegram si no coinciden — `Result=success` no dice
que se hiciera lo que pediste.

##### Y desde el 2026-09-10 no hace falta reinstalar la app: se le cambia la dirección

Antes, la salida era «reinstala la PWA desde la URL nueva», y ése era el consejo
caro: es justo lo que nadie hace desde el móvil cuando lo único que quería era
leer una conversación. Ahora la dirección se cambia **desde dentro de la app**,
se guarda en el móvil, y el origen viejo se queda como **trampolín**: su armazón
sigue en la caché del service worker, así que el icono de siempre abre, lee la
dirección guardada y salta.

```
(abres el icono de siempre; la máquina se rehizo y ahora es `dev-1`)

app ← 🔴 No he podido hablar con el servidor.
      Intentado contra: http://dev.tured.ts.net:8080
      …
      2. La máquina se rehízo y CAMBIÓ DE NOMBRE […] escríbela aquí abajo: se
      guarda en este móvil y la app salta sola a partir de ahora. NO hace falta
      reinstalarla.

      ▸ Cambiar la dirección del servidor        ← pliegue: sólo si lo pides

tú  → (en Telegram)  /use cweb   →   url
bot ← Desde el móvil (con Tailscale activo):
        http://dev-1.tured.ts.net:8080/

tú  → (despliegas el pliegue y escribes)  dev-1.tured.ts.net:8080
app ← [Guardar e ir]  → probando…        ← comprueba que contesta ANTES de guardar
      (salta; a partir de aquí el icono de siempre te trae aquí)
```

Cuatro decisiones que hay que respetar si se toca, y todas tienen test
(`tests/direccion.test.mjs`):

1. **Se REDIRIGE, no se le piden los datos al otro host.** Todas las llamadas de
   `app.js` son relativas (`/api/…`); apuntarlas a otro origen las vuelve
   cross-origin y entonces haría falta **CORS** — o sea abrir, en una app que
   escucha sólo en loopback a propósito, un permiso para que otro origen le lea
   las conversaciones. Redirigiendo, en el destino todo vuelve a ser del mismo
   origen y no hay nada que abrir.
2. **Se comprueba que contesta ANTES de guardar**, con `fetch(…, {mode:
   'no-cors'})` — que llega opaco, sin poder leer el status, pero **sólo lanza
   si no se llegó**, que es lo único que hay que distinguir. Sin esto, una
   dirección mal tecleada dejaría el icono del móvil saltando para siempre a un
   sitio que no existe. ⚠ Y **avisa pero no bloquea** (`Ir de todos modos`),
   como `/use` con `requiere`: mira desde este móvil y en este momento.
3. **Hay escape: `?aqui` en la URL impide el salto**, y va antes de cualquier
   otra comprobación. Es la salida cuando lo guardado ya no responde; una salida
   que dependa de que el resto esté bien no es una salida.
4. **Nunca se salta al origen en el que ya estás** — sería un bucle infinito de
   recargas, que dejaría la app inservible sin llegar a pintar un mensaje.

⚠ **Lo que esto NO puede hacer, y conviene saberlo antes de necesitarlo:** el
móvil tiene que haber cargado **una vez con conexión** el armazón nuevo. Si la
máquina cambia de nombre antes de eso, el móvil sigue con la versión vieja de
`app.js` en su caché —la que no trae esta pantalla— y ahí sí toca reinstalar. No
hay forma de evitarlo: código que nunca llegó al móvil no puede ayudarte.

## Qué se ve dentro

- **La lista de conversaciones**, la más reciente arriba, con la hora y un
  extracto. Un tema con un turno en curso sale con **⏳ esperando respuesta**.
- **La conversación**: lo tuyo en burbuja a la derecha; lo de claude a ancho
  completo, porque su contenido es estructurado y una tabla en una burbuja
  estrecha no se lee.
- **Encabezados, listas anidadas, negritas, `código en línea`, citas y tablas**
  —con su scroll horizontal contenido en la tabla, para que leerla no arrastre la
  página—.
- Una **línea divisoria** donde `creset` cortó la conversación: sin ella la web
  te enseña un contexto que claude ya no tiene.
- Y si el bot está parado, **lo dice** en vez de enseñarte lo último como si
  fuera de ahora.

## Estado

**Fases 1 y 2 completas**, más la purga y la PWA de la fase 4. **Tailscale ya
está puesto**: la web se sirve por `tailscale serve` en el puerto **8080** (no el
443, que aquí lo tiene `sshd`) y se usa desde el móvil.

⚠ **Y se publica por `http`, sin certificado, desde el 2026-09-11.** El porqué y
lo que cuesta, justo abajo.

⚠ **La dirección depende del NOMBRE del nodo, y ese nombre puede cambiar al
rehacer la máquina.** No la escribas de memoria: pídela con `/use cweb` → `url`,
que la lee del estado real. El caso en que cambia, y qué hacer, arriba en
[«Failed to fetch»](#-no-pude-leer-las-conversaciones-failed-to-fetch--casi-siempre-es-la-url-no-la-app).

### Por qué ya no hay certificado (2026-09-11)

**Medido en esta máquina el 2026-09-11.** El nodo estaba bien (`dev`, móvil
conectado directo), el `serve` bien puesto y la app contestando **200 en 8 ms** por
loopback. Y desde el móvil la web «tardaba muchísimo». Lo que decía el journal:

```
429 rateLimited: too many certificates (5) already issued for this exact set
of identifiers in the last 168h0m0s, retry after 2026-09-12 20:04:42 UTC
```

Let's Encrypt da **5 certificados por semana y por nombre exacto**. Y aquí el
nombre exacto es siempre el mismo **a propósito**: el `pre_destroy` del servicio da
de baja el nodo al destruir el droplet para que el dev siguiente recupere `dev` y
la PWA instalada no se quede apuntando a un sitio muerto.

> ⚠⚠ **El mecanismo que protege la URL es el que quema el límite.** No es un fallo
> de ninguno de los dos: es que nadie había contado que «rehacer el dev» y «pedir
> un certificado» son el mismo suceso. Techo real: **5 dev por semana**.

Y falla del peor modo posible: el sexto dev nace con todo verde —nodo, serve,
unidad, `Result=success`— y el móvil colgado en un handshake TLS que no termina.
**27 handshakes así en dos horas**, ese día. Desde fuera se lee como «la app está
lenta», nunca como «falta un certificado».

**La salida es no pedir ninguno.** Dentro de la tailnet el tráfico ya va cifrado
por WireGuard, y tailscaled escucha **sólo** en la IP de la tailnet (comprobado ese
día: `100.x:8080`, nunca en la interfaz pública; `ufw` ni la ve). El bind a
loopback del servidor no se toca, que es donde de verdad está el freno.

#### Lo que cuesta no tener certificado

**Una cosa, y es real: la app deja de poder INSTALARSE.** `http://` en un host que
no es `localhost` no es *contexto seguro*, así que el navegador no registra el
service worker — y sin service worker Android no ofrece «Añadir a pantalla de
inicio». Con ello se pierden las dos cosas que daba:

| | con certificado | sin certificado |
|---|---|---|
| se ve desde el móvil | ✅ | ✅ |
| icono instalado en la pantalla de inicio | ✅ | ❌ **se pierde** |
| abre sin red (armazón en caché) | ✅ | ❌ **se pierde** |
| sobrevive a rehacer el dev | ✅ **hasta 5 veces por semana** | ✅ siempre |

⚠ `app.js` registra el service worker con `navigator.serviceWorker?.register(…)`,
así que **sin contexto seguro no se cae: se degrada**. La app funciona entera; lo
único que no hay es icono ni caché.

⚠ **Y el icono que YA esté instalado sigue abriendo**, porque su armazón está en
la caché de su origen `https://`. Sirve de **trampolín**: abre, no alcanza a nadie,
y desde ahí se escribe la dirección nueva. Es exactamente para lo que se hizo
(ver [arriba](#y-desde-el-2026-09-10-no-hace-falta-reinstalar-la-app-se-le-cambia-la-dirección)).

#### La marcha atrás es un dato, no un parche

```sh
CWEB_TS_ESQUEMA=https        # y el puerto vuelve solo al 8443
```

No hay nada de código que tocar: esquema y puerto salen de `publicacion()` en
`scripts/nodo.mjs`, y hay un test que **falla si algún script vuelve a componer la
orden del `serve` a mano** — si eso pasara, la variable mentiría en silencio, que
es peor que no tenerla.

#### La trampa al cambiar de esquema, que ya mordió

`tailscale serve --bg` **AÑADE y no reemplaza** — la misma propiedad que costó la
app entera el 2026-09-10 por el lado del nombre. Al pasar de `--https` a `--http`
quedan publicadas **las dos puertas**; comprobado ese día:

```json
"TCP": { "8080": { "HTTP": true }, "8443": { "HTTPS": true } }
```

Y la de más no es inofensiva: es justo la que cuelga al móvil pidiendo el
certificado que no va a llegar. **`serveHuerfano()` no puede verla**, porque el
host *es* el de este nodo — es una tercera deriva, distinta de «nodo ↔ serve».
La detecta `publicacionSobrante()`, que lee el esquema del `TCP` del propio
`serve status --json` en vez de deducirlo del número de puerto, y los dos scripts
resetean y reponen cuando lo publicado no es lo declarado.

| Documento | Qué contesta |
|---|---|
| [`docs/especificacion.md`](docs/especificacion.md) | qué se quiere y por qué. Es la fuente |
| [`docs/decisiones.md`](docs/decisiones.md) | **las 13 preguntas con su respuesta y su motivo** |
| [`docs/plan-general.md`](docs/plan-general.md) | qué se construye y en qué orden |
| [`docs/plan-detallado.md`](docs/plan-detallado.md) | tarea por tarea, con lo que ya está hecho |

## Para trabajar en él

```bash
npm test                                  # 52 tests, sin una sola dependencia
DATA_DIR=./tests/fixtures npm start       # arranca contra el fixture, SIN coordinador
```

Eso último no es una comodidad: es la prueba de que este repo **es una pieza** y
no una carpeta del coordinador. Se puede clonar solo y arrancar.

⚠ **No hay paso de build**, y es deliberado: `vue` y `markdown-it` van
vendorizados en `web/vendor/`. Desplegar es `git pull` + reiniciar, que es lo que
permite tocar este repo desde el celular.

⚠ **Tras cambiar algo del servidor, hay que reiniciarlo** (`cweb parar` +
`arrancar`, o `systemctl restart claude-web`): si no, sigue sirviendo el código
anterior. Pasó el 2026-09-09 y costó una comprobación entera.
