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
        https://dev.tu-tailnet.ts.net/
```

Abres esa dirección en el móvil, **Añadir a pantalla de inicio**, y ya se abre
como una app. No hay pantalla de login: la identidad la pone la red.

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

**Cómo se arregla del todo**, y hay que hacer los tres pasos o vuelve a pasar:

1. Borra los nodos apagados que se llamen `dev` en
   [la consola](https://login.tailscale.com/admin/machines).
2. `node scripts/tailscale-unir.mjs` para reclamar el nombre.
3. ⚠ **La causa de fondo es la authkey: tiene que ser `Ephemeral`**
   ([`.env.example`](.env.example) lo pide, y por esto). Sin eso, cada dev
   destruido deja un nodo muerto ocupando el nombre.

Mientras tanto la URL con sufijo funciona: sólo hay que reinstalar la PWA desde
ella. **Y `tailscale-unir.mjs` ya no se calla**: compara el nombre que pidió con
el que le dieron y avisa por Telegram si no coinciden — `Result=success` no dice
que se hiciera lo que pediste.

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
está puesto**: la web se sirve por `tailscale serve` en el puerto **8443** (no el
443, que aquí lo tiene `sshd`) y se usa desde el móvil.

⚠ **La dirección depende del NOMBRE del nodo, y ese nombre puede cambiar al
rehacer la máquina.** No la escribas de memoria: pídela con `/use cweb` → `url`,
que la lee del estado real. El caso en que cambia, y qué hacer, arriba en
[«Failed to fetch»](#-no-pude-leer-las-conversaciones-failed-to-fetch--casi-siempre-es-la-url-no-la-app).

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
