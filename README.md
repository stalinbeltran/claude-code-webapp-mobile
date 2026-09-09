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

**Fases 1 y 2 completas**, más la purga y la PWA de la fase 4. Lo que falta para
poder usarla desde el móvil **no es código**: es Tailscale, que necesita una
decisión y una authkey ([`docs/decisiones.md`](docs/decisiones.md), P3).

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
