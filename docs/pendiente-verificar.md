# ⏳ PENDIENTE de verificar: lo que se construyó el 2026-09-10 y NO se ha visto funcionar entero

**Léelo si acabas de nacer en un server nuevo.** Todo lo de aquí está implementado,
commiteado y con tests; lo que falta es el **ciclo real**, que sólo se puede ver
destruyendo y relanzando un dev — y eso no había pasado todavía cuando se escribió
esto.

⚠ La regla del proyecto: *«`Result=success` no dice que se hiciera lo que
pediste»*. Los tests dicen que las piezas hacen lo suyo; **ninguno prueba que la
app se abra en el móvil después de rehacer la máquina**, que es lo único que le
importa al dueño.

## Antes de nada: los dos pasos que sólo puede dar el dueño

Sin estos dos, la verificación de abajo **no puede salir bien**, y se leería como
que el mecanismo falla cuando lo que falta es esto:

1. **Borrar el nodo `dev` viejo** en <https://login.tailscale.com/admin/machines>.
   Es un resto **no efímero**, de antes de que existiera `tailscale-unir.mjs`
   (medido: apagado desde las 02:35 del 2026-09-10 y seguía registrado 16 h
   después, mientras los efímeros se borraban solos en ~75 min). Mientras esté, el
   nombre `dev` está ocupado y todo dev nuevo entra sufijado.
2. **Rotar la `TS_AUTHKEY`.** Se filtró en claro en el journal de `dev-1` el
   2026-09-10 (ver el commit `72349a3`). El journal de esa máquina era persistente
   y legible por `deploy` sin sudo. La fuga en el código está arreglada; **la clave
   filtrada sigue siendo válida hasta que se rote**, y es `Reusable`.
   ⚠ Al rotarla hay que ponerla en el llavero como `CWEB_TS_AUTHKEY`, o el dev
   siguiente no entra en la tailnet **y la app no será alcanzable en absoluto**,
   que es un síntoma distinto y peor que el del nombre.

## Y un paso que sólo puede dar el mini

3. **`actualizar` en el bot del Lanzador** (`python3 scripts/do_droplet.py update`).
   El gancho `pre_destroy` vive en el repo del lanzador, y **quien destruye el dev
   es el mini con su propio clon**. Si el mini no ha hecho `pull`, corre el código
   viejo, **no hay recogida**, y todo lo de abajo falla por una razón que no tiene
   nada que ver con el mecanismo.
   Comprobación: en el mini, `git log --oneline -1` de ese repo tiene que traer
   `bed1257` o posterior.

## La verificación de extremo a extremo, que es la que falta

En orden, y el orden importa:

| # | paso | qué tiene que salir |
|---|---|---|
| 1 | anota el `Self ID` y el nombre del dev actual (`tailscale status --json`) | para poder comparar |
| 2 | desde el mini: `destroy dev --yes` | en el log tiene que aparecer **`claude-web: recogiendo antes de destruir…`** |
| 3 | mira la tailnet desde el móvil o la consola | el nodo del dev **ya no está**, en segundos |
| 4 | desde el mini: `launch dev --type dev` | |
| 5 | cuando termine, `/use cweb` → `url` | tiene que decir **`https://dev.<tailnet>:8443/`**, SIN sufijo |
| 6 | abre esa URL en el móvil e instala la PWA | y a partir de aquí ya no debería cambiar nunca |

**Si el paso 5 sale con sufijo**, `avisoDeDeriva()` te habrá avisado por Telegram
diciendo qué pasó — ése es el freno, y que salte no es que esto no funcione: mira
primero los pasos 1-3 de arriba, que son las causas conocidas.

## Lo que está probado y lo que no

| | |
|---|---|
| ✅ `logout` borra el nodo efímero al instante | medido en vivo el 2026-09-10: Self ID `nznvvWsNKE11CNTRL` → `nbjCKGjnuo11CNTRL`, 3 nodos antes y 3 después, nombre reutilizado en **2 s** |
| ✅ el gancho no puede impedir el destroy | 14 tests, forzando cada rama de fallo (`tests/test_pre_destroy.py` del lanzador) |
| ✅ la orden de desunir no lleva credencial · el seco no toca nada | `tests/nodo.test.mjs` |
| ✅ el aviso de deriva dispara y llega a Telegram | visto en vivo al volver a unir tras el experimento |
| ❌ **el `pre_destroy` disparado por un `destroy` de verdad** | **nunca ha corrido** |
| ❌ **que el dev nuevo entre como `dev` y la PWA siga funcionando** | **nunca se ha visto** |
| ❌ que `tailscale-unir.mjs` una un nodo desde cero con `--auth-key=file:` | el arreglo de la fuga cambió esa línea y **sólo se ha probado el camino de reunir**, no el de una máquina virgen |

⚠ **El último es el más fácil de olvidar y el que deja la máquina muda**: se cambió
cómo se pasa la authkey (de `"$TS_AUTHKEY"` en la línea de comando a
`--auth-key=file:<ruta>`) y eso corre en el `install` de un dev nuevo, que es
justo lo que no se ha ejercitado desde el cambio. Si falla, el dev nace **sin
tailscale** y la web no se ve por ningún lado.

## Lo que se pierde al destruir el dev, y es por diseño

`data/` del coordinador está en `.gitignore`: el **log de mensajes que la web
muestra** (`data/mensajes/`), la continuidad de la conversación de `c` (la época
vuelve a 0), el `cd` de `shell` y las ataduras de `/ws`. El dev nuevo arranca con
la app **vacía**. No es un fallo — la propia especificación dice *«la web empieza
el día que se active el log»*— pero conviene saberlo antes, no después.
