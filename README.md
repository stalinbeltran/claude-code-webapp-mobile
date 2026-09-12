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

⚠ **«Añadir a pantalla de inicio» sólo sale con `https://`**, y eso pide un
certificado que desde el 2026-09-11 **viaja con la flota** en vez de pedirse en
cada dev: ver [§ Por qué ya no hay certificado](#por-qué-ya-no-hay-certificado-2026-09-11)
y, justo debajo, [§ Y cómo se recupera](#y-cómo-se-recupera-el-certificado-viaja-con-la-flota-2026-09-11).

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
**47 handshakes así del móvil** (61 en total) entre las **22:05:34 y las 22:32:58
UTC** de ese día. Desde fuera se lee como «la app está lenta», nunca como «falta un
certificado».

```sh
sudo journalctl -u tailscaled --no-pager | grep -c "TLS handshake error"
```

⚠ **Ese número se escribió primero como «27 en dos horas», y las dos mitades estaban
mal**: el 27 era un recuento **a mitad del suceso** —se contó a las 22:20 y siguieron
llegando hasta las 22:32— y las «dos horas» eran la ventana del `--since` que se le
pasó al `journalctl`, no lo que duró. Lo pilló el agente `verificador` contando sobre
el journal entero. Es la regla 2 de escritura del coordinador incumplida en el sitio
de siempre: **un número sin su comando se lee como medido**, y éste lo era a medias.

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

### Acceso por Cloudflare: la alternativa que se prueba (2026-09-12)

Tailscale quedó **marcado como válido** el 2026-09-12 (tag `tailscale-valido-2026-09-11`
en este repo y en el lanzador): todo lo que mordió está cerrado con test. Y aun así el
dueño decidió probar otro camino, porque «seguro van a salir nuevos». La única
restricción: **la app tiene que poder instalarse en el móvil**.

**Qué es:** un túnel de Cloudflare (`cloudflared`) que SALE del droplet hacia Cloudflare,
sin abrir ningún puerto, y **Cloudflare Access** delante, que pide login (Google, o un
PIN por correo) y recuerda la sesión hasta un mes. Comprobado en vivo el 2026-09-12
desde el dev con un túnel rápido: HTTPS válido en 0,38 s.

| | Tailscale | Cloudflare Tunnel + Access |
|---|---|---|
| certificado | Let's Encrypt, 5 por semana y por nombre; desde ayer viaja con la flota | lo pone Cloudflare; no hay nada que pedir ni que viajar |
| nombre estable | el nodo tiene que RECUPERAR su nombre al rehacer el dev (`pre_destroy`, reclamar…) | es tu dominio; un dev nuevo levanta el mismo túnel con el mismo token |
| en el móvil | la app de Tailscale, activa y fuera del ahorro de batería | nada: el navegador y tu login |
| credencial | authkey, caduca a los 90 días | token del túnel, no caduca |
| privacidad | el tráfico nunca sale de tus máquinas | **pasa en claro por el borde de Cloudflare** |
| barrera | la identidad la pone el dispositivo | **Access es la única**; sin policy, abierta al mundo |
| cuesta | 0 | un dominio en Cloudflare (unos dólares al año) |

**Cómo se elige:** `CWEB_ACCESO=cloudflare|tailscale` en el llavero del lanzador. Vacío,
lo decide el dato: hay token de túnel → cloudflare; si no → tailscale. Los dos caminos
conviven: cambiar es cambiar una variable, y la vuelta atrás es la misma variable.

**Lo que tienes que hacer tú, una vez** (nada de esto lo puede hacer un script):

1. Un **dominio en Cloudflare** (comprarlo en Cloudflare Registrar, o mover uno).
2. **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**, nombre
   `claude-web`. Copia el token: el `eyJ…` del comando `cloudflared service install …`
   que te enseña. En **Public Hostname**: subdominio `claude`, tu dominio, servicio
   **HTTP** `127.0.0.1:8020`.
3. **Zero Trust → Access → Applications → Add → Self-hosted**: dominio
   `claude.<tu-dominio>`, *session duration* un mes, una policy **Allow** con
   *Emails* = tu correo. Login por *One-time PIN* o Google, lo que prefieras.
4. En el `.env` de la laptop:
   ```
   CWEB_ACCESO=cloudflare
   CWEB_CF_TUNNEL_TOKEN=eyJ…
   CWEB_CF_HOSTNAME=claude.<tu-dominio>
   ```
   y luego, desde el lanzador: `llavero enviar dev`, `llavero enviar mini`,
   `remoto dev entornos aplicar --entorno claude-code-webapp-mobile` y
   `remoto dev install-service --service claude-web`. O desde Telegram, en el dev:
   `/use cweb` → `acceso`.
5. Abre `https://claude.<tu-dominio>/` en el móvil, haz el login, y «Añadir a pantalla
   de inicio».

**Cómo se comprueba, y qué es la alarma:** `url` (o `acceso.mjs estado`) sondea
`/api/salud` por el nombre público **sin seguir redirecciones**. Lo bueno es un **302**:
llega, y Access manda al login. **Un 200 es la alarma**: la web contesta a cualquiera
del mundo porque no hay policy; el mensaje dice cómo parar el túnel en ese momento.

**Lo que la PWA necesita detrás de Access, ya puesto:** el manifest con
`crossorigin="use-credentials"` (sin eso no sale «Añadir a pantalla de inicio»), una
sesión caducada explicada como tal en vez de como «Failed to fetch», y un latido cada
30 s en el flujo de eventos para que Cloudflare no corte la conexión muda. 24 tests en
`tests/cloudflare.test.mjs`.

⚠ **El token no se imprime nunca**: va a `/etc/cloudflared/claude-web.env` (root, 0600)
y la unidad `cloudflared-claude-web` lo lee con `EnvironmentFile=`. La receta oficial
(`cloudflared service install <token>`) lo dejaría en el `ps` y en el journal.

⚠ **No visto en vivo con un dominio real**: hace falta el tuyo. Lo que está visto es el
túnel rápido desde el dev, y todo lo demás está en tests. Los pasos y lo esperado en
cada uno, en [`docs/pendiente-verificar.md`](docs/pendiente-verificar.md).

#### Y cómo se recupera: el certificado viaja con la flota (2026-09-11)

El límite se quemaba porque el certificado **vivía en el droplet que se destruye**
(`/var/lib/tailscale/certs/`), así que cada dev pedía uno nuevo. Y no hace falta:
tailscaled **reutiliza** lo que encuentre ahí. Leído en su código
([`feature/acme/certstore.go`](https://github.com/tailscale/tailscale/blob/main/feature/acme/certstore.go),
`certFileStore.Read` → `validCertPEM`): si hay `<dominio>.crt` y `<dominio>.key`,
valida la cadena contra las raíces del sistema y las de Let's Encrypt embebidas,
comprueba nombre y caducidad, y si vale lo sirve **sin pedir nada**. Sólo renueva
en segundo plano pasados 2/3 de la vida (~día 60 de 90), siguiendo sirviendo el
viejo mientras tanto.

Así que el certificado se pide **una vez** y desde entonces va en el llavero del
lanzador como dos variables en base64 (`CWEB_TS_CERT_B64` y `CWEB_TS_KEY_B64`, que
llegan aquí como `TS_CERT_B64` y `TS_KEY_B64` por el puente `env_prefix`). Cada dev
nuevo lo **coloca** antes de poner el `serve`, y rehacer el dev cuesta 0 emisiones.

| paso | quién | qué |
|---|---|---|
| pedir el primero | tú, una vez | `CWEB_TS_ESQUEMA=https` en el `.env` del lanzador, `tailscale` desde `/use cweb`, y abrir la web desde el móvil (o `curl` al FQDN): tailscaled lo pide. Cuenta 1 de los 5 de la semana |
| guardarlo | tú, una vez, y otra vez cuando tailscaled lo renueve | en la máquina, `python3 scripts/do_droplet.py entornos recoger` (lanzador): lee `cweb cert exportar` y lo mete en el llavero. Luego `llavero enviar <otra>` |
| colocarlo | solo, en cada dev nuevo | `tailscale-unir.mjs` y `tailscale-serve.mjs` lo ponen en tailscaled **antes** del `serve`, y sólo si vale para el nombre que la tailnet dio |
| verlo | `cert` desde `/use cweb` | qué tiene tailscaled, qué trae el llavero, si coinciden y cuándo caduca. Nunca imprime el par |

**Y el esquema por defecto lo decide un dato**: sin `CWEB_TS_ESQUEMA`, se publica
por `https` si el llavero trae certificado y por `http` si no. Nunca se pide un
certificado a Let's Encrypt sin que alguien lo diga: para el primero hay que
escribir `CWEB_TS_ESQUEMA=https`. Hay 22 tests en `tests/certificado.test.mjs`.

⚠ La clave privada de ese certificado viaja en el llavero como ya viajan la clave
SSH de la flota y la authkey. Sólo sirve para suplantar a `dev.<tailnet>.ts.net`,
que sólo existe dentro de la tailnet. `cert exportar` es la única orden de
`cweb.mjs` que la imprime, y **el ejecutor de Telegram la rechaza**: el chat no es
sitio para ella.

⚠ **Lo que NO está visto en vivo el 2026-09-11**: el límite no se abre hasta el
2026-09-12 a las 20:03 UTC, así que colocar un certificado REAL y ver que
tailscaled lo reutiliza en un dev rehecho queda para entonces. Está en
[`docs/pendiente-verificar.md`](docs/pendiente-verificar.md). Lo que sí está
probado: la decisión del esquema, la validación de nombre y caducidad contra un
par de prueba, la colocación con un `install` fingido, y que los dos scripts lo
hacen antes del `serve`.

#### La marcha atrás es un dato, no un parche

```sh
CWEB_TS_ESQUEMA=https        # pide un certificado a Let's Encrypt (1 de 5) si no hay
CWEB_TS_ESQUEMA=http         # publica sin certificado aunque lo haya
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

✅ **Y ese camino está visto en vivo, no sólo en test.** Al aplicar el cambio en esta
máquina, `tailscale-serve.mjs` se encontró justo ese estado y lo dijo él solo:

```
[serve] limpiando lo que no es --http=8080: dev.tail376e31.ts.net:8443 (https)
✅ La web de lectura ya se ve desde tu móvil (con Tailscale activo):
   http://dev.tail376e31.ts.net:8080/
```

El `(https)` de esa línea lo pone `publicacionSobrante()` y nadie más, y el ✅ sólo
se imprime si `ordenDeProbar` devolvió 200 por el FQDN de la tailnet. Después:
`ss -lntp` ya no lista el 8443 y `"TCP"` queda en `{"8080":{"HTTP":true}}`.

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
