# claude-code-webapp-mobile

Una web (PWA de móvil) para **leer en markdown renderizado** lo que responde
Claude Code cuando se le habla desde Telegram por el ejecutor `c` del
[coordinador](https://github.com/stalinbeltran/telegram-coordinator).

Telegram no renderiza markdown: llegan los `###`, los `**` y las tablas en
crudo, y encima el coordinador trocea a 4000 caracteres —un límite de
transporte, sin relación con la estructura del texto—, así que una tabla puede
partirse por la mitad. Esta web es un **segundo cliente** que lee lo mismo,
bien formateado. **Telegram sigue siendo cliente de primera**: si esta web se
cae, el bot funciona exactamente igual.

## Estado, a 2026-09-09

**Nada implementado: sólo documentos.** Las decisiones de diseño ya están
tomadas (12 de 13). En orden de lectura:

| Documento | Qué contesta |
|---|---|
| [`docs/especificacion.md`](docs/especificacion.md) | qué se quiere y por qué. Escrita antes que nada, es la fuente |
| [`docs/decisiones.md`](docs/decisiones.md) | **las 13 preguntas con su respuesta y su motivo**. Es lo que hay que leer para saber por qué el resto es como es |
| [`docs/plan-general.md`](docs/plan-general.md) | qué se construye, en qué orden, y los 8 huecos que la especificación no cubría |
| [`docs/plan-detallado.md`](docs/plan-detallado.md) | tarea por tarea: qué fichero, en qué repo, con qué prueba y cuándo está terminada |

### Lo decidido, en cuatro líneas

- **Servicio aparte**, con unidad propia: un fallo de la web no puede tumbar el
  bot, y eso es estructura y no disciplina.
- **Escucha sólo en `127.0.0.1`**, y se llega por **Tailscale** — que da HTTPS
  válido y nombre estable, así que la app **se instala una vez** en el móvil y
  luego se abre sin escribir nada.
- **Sólo se registran las conversaciones de `c`**, y no por tener su nombre
  cableado: por un campo en su JSON.
- **Sobrevive a que se destruya el `dev`** y se relanza desde el mini, con el
  mismo mecanismo que ya usa `foveal-vision-web`.

⚠ **Queda una pregunta abierta** —el nombre de cada tema en la lista de
conversaciones— y de ella depende que la fase 0 se haga o se borre. Está en
[`docs/decisiones.md`](docs/decisiones.md#p9--el-nombre-de-cada-tema-en-la-app).

⚠ Este repo **no se puede usar solo**: la mitad del trabajo son cambios dentro
de `telegram-coordinator`, que es quien tiene el orquestador, el log y el
proceso vivo. El reparto exacto está en el plan general; la regla que lo
gobierna, en [R3 y R7 de `docs/reglas-de-diseno.md` del
coordinador](https://github.com/stalinbeltran/telegram-coordinator/blob/main/docs/reglas-de-diseno.md).
