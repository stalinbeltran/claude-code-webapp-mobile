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

**Nada implementado.** Sólo documentos. En orden de lectura:

| Documento | Qué contesta |
|---|---|
| [`web-lectura-c.md`](web-lectura-c.md) | **la especificación**: qué se quiere y por qué. Escrita antes que nada, es la fuente |
| [`docs/plan-general.md`](docs/plan-general.md) | qué se construye, en qué orden, qué dice la especificación y qué le falta |
| [`docs/plan-detallado.md`](docs/plan-detallado.md) | tarea por tarea: qué fichero, en qué repo, con qué test y cuándo está terminada |
| [`docs/preguntas-abiertas.md`](docs/preguntas-abiertas.md) | **lo que hace falta decidir antes de escribir código**, numerado para poder responder por número |

⚠ Este repo **no se puede usar solo**: la mitad del trabajo son cambios dentro
de `telegram-coordinator`, que es quien tiene el orquestador, el log y el
proceso vivo. El reparto exacto está en el plan general; la regla que lo
gobierna, en [R3 y R7 de `docs/reglas-de-diseno.md` del
coordinador](https://github.com/stalinbeltran/telegram-coordinator/blob/main/docs/reglas-de-diseno.md).
