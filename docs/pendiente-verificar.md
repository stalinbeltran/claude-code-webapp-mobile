# ⏳ PENDIENTE de verificar: lo que se construyó el 2026-09-10 y NO se ha visto funcionar entero

## ✅ ACTUALIZADO el 2026-09-10 (noche): el ciclo SÍ ocurrió, y salió medio bien

**Este server es el dev nuevo.** Nació a las 20:00 UTC, o sea que el
destroy + launch que abajo se pide como verificación **ya pasó**. Esto es lo que
se midió, y hay que leerlo antes que la tabla de abajo:

| | |
|---|---|
| ✅ **`tailscale-unir.mjs` une una máquina VIRGEN con `--auth-key=file:`** | 20:08:34, `tailscale up --auth-key=file:/tmp/tsjoin-…/authkey`, nodo dentro. Era el ❌ más temido de esta lista («si falla, el dev nace sin tailscale y la web no se ve por ningún lado») |
| ✅ **la authkey NO aparece en el journal** | el `COMMAND=` registrado es la ruta del fichero, no la clave |
| ✅ **el nombre `dev` se recuperó** | el nodo entró como `dev-2` (el viejo aún ocupaba el nombre) y a las 20:29 un `logout` + volver a unir lo dejó como **`dev`** |
| ❌ **y aun así la app no se veía**, por un fallo NUEVO que esta lista no preveía | ver abajo |

### ⚠⚠ El fallo nuevo: el `serve` se quedó con el nombre ANTERIOR

Medido en el journal de esta máquina:

```
20:08:35  serve --bg  → config escrita bajo `dev-2`  (el nodo era dev-2)
20:29:25  sudo tailscale logout
20:29:40  tailscale up --hostname=dev      → el nodo pasa a llamarse `dev`
20:29:41  serve --bg  → POST aplicado …  y la config SIGUIÓ diciendo `dev-2`
```

Resultado: **ninguna de las dos direcciones servía.**

```
Host=dev    → "no webserver configured for name/port"
Host=dev-2  → 'invalid domain "dev-2…"; must be one of ["dev.tail376e31.ts.net"]'
```

La app estaba perfecta todo el rato (`127.0.0.1:8020` → 200). Desde el móvil se
ve como «Failed to fetch», o sea como una app rota.

**Lo que hay que entender, porque es lo que engaña:**

1. **El paso de reponer el serve YA EXISTÍA y se ejecutó.** No faltaba nada. Se
   lanzó 1 s después del `up` —antes de que el registro con el nombre nuevo
   asentara— y escribió la config con el nombre viejo. **Reintentar a ciegas no
   arregla esto: el reintento es lo que lo escribe mal.**
2. **`hayDeriva()` no podía saltar**, y es lo más contraintuitivo: el nodo tenía
   el nombre **correcto**. La deriva que se vigilaba era «pedido ↔ nodo»; la que
   mordió es la otra mitad del par, **«nodo ↔ serve»**. Dos derivas distintas,
   dos causas distintas, y hasta ese día sólo se miraba una.
3. **`cweb url` daba la URL muerta con total confianza**, porque leía «el primer
   `https://` que imprime `serve status`» — y ahí el orden no significa nada. El
   comando que existe para no suponer acabó mintiendo.
4. ⚠ **Y la comprobación final no podía pasar NUNCA.** `tailscale-serve.mjs`
   probaba con `curl https://<fqdn>:8443/api/salud`, pero el nodo se une con
   `--accept-dns=false` (deliberado), así que la máquina **no resuelve su propio
   MagicDNS**. Medido con el serve ya arreglado y sirviendo: sin `--resolve` da
   `000`, con `--resolve` da `200`. Un ⚠ que sale siempre se deja de leer.

**Arreglado en código el mismo día**, con 8 tests en `tests/nodo.test.mjs`:
`serveHuerfano()` compara el host publicado con el del nodo, `tailscale-unir.mjs`
comprueba bajo qué nombre quedó el serve (y lo rehace con `reset` + `--bg`, en
ese orden, porque `--bg` añade y no reemplaza), `cweb url` elige el host propio
en vez del primero, y la comprobación resuelve por la IP del nodo.

**El freno se pone en el DATO, no en el timing.** La carrera es la explicación
más plausible de aquel segundo y encaja con los tiempos, pero **no está
aislada**: del journal se prueba que el POST se aplicó y que el resultado fue
`dev-2`, no qué nombre reportaba tailscaled en ese instante. Comparar el host
detecta el estado malo se haya llegado a él como se haya llegado.

### Qué queda de esta lista

- El **paso 1 del dueño** (borrar el nodo `dev` viejo) ya no hace falta: la
  tailnet tiene hoy **2 nodos**, `dev` y `redmi-note-12`. Se limpió.
- El **paso 2 (rotar la `TS_AUTHKEY`)** sigue pendiente hasta que el dueño lo
  confirme: desde aquí no se puede comprobar, y la clave filtrada es `Reusable`.
- El **`pre_destroy` disparado por un `destroy` de verdad** sigue **sin verse**:
  esta máquina es la que nació, no la que murió.

---

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
| 5 | cuando termine, `/use cweb` → `url` | tiene que decir **`http://dev.<tailnet>:8080/`**, SIN sufijo |
| 6 | abre esa URL en el móvil y guárdala | y a partir de aquí ya no debería cambiar nunca |

⚠ **El paso 5 dice `http` y `8080` desde el 2026-09-11**, no `https` y `8443`: se
publica sin certificado (README § «Por qué ya no hay certificado»). Si sale
`https://…:8443/`, esta máquina trae código anterior a ese cambio o alguien puso
`CWEB_TS_ESQUEMA=https` — las dos cosas son legítimas, pero hay que saber cuál es.

⚠ **Y el paso 6 ya no dice «instala la PWA»**, a propósito: sin certificado no hay
contexto seguro, así que Android **no ofrece** «Añadir a pantalla de inicio». Que no
salga el botón no es un fallo de este ciclo; esperarlo sí haría que se leyera como uno.

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
