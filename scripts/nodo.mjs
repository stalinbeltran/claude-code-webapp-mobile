// El nodo en la tailnet: qué NOMBRE consigue, y cómo se une SIN filtrar la clave.
//
// Lo primero es lo que hace que la PWA instalada en el móvil siga funcionando
// cuando se rehace la máquina. Lo segundo es que unirse no deje la authkey
// escrita en el journal — y las dos viven aquí porque las dos son «cómo entra
// este nodo», y las dos se comprueban sobre un dato, no sobre un código de
// salida.
//
// Por qué esto existe, medido el 2026-09-10
// -----------------------------------------
// `tailscale-unir.mjs` pide `--hostname=dev` y **nunca comprobaba que lo
// hubiera conseguido**. Tailscale no falla cuando el nombre está ocupado: le
// pone un sufijo y sigue, con código 0. Ese día la tailnet tenía cuatro nodos
// llamados `dev` —`dev` (muerto 14 h antes), `dev-2`, `dev-3` y el vivo— y el
// vivo había entrado como **`dev-1`**.
//
// Consecuencia: `https://dev.ejemplo.ts.net:8443/`, que es la dirección
// guardada en el móvil, seguía RESOLVIENDO (MagicDNS conserva los nodos
// apagados) y apuntaba a una máquina que ya no existe. Desde el móvil se vio
// como «No pude leer las conversaciones: Failed to fetch», o sea como una app
// rota. El servidor estaba perfecto: contestaba 200 por su nombre nuevo.
//
// ⚠⚠ Es la lección del proyecto otra vez, en el sitio de siempre:
// **`Result=success` no dice que se hiciera lo que pediste.** El `tailscale up`
// salió con 0, el `serve` quedó puesto y la web contestaba — y aun así todo
// cliente instalado acababa de quedarse fuera. Lo único que lo delataba era un
// dato que nadie miraba: el nombre que de verdad te dieron.
//
// ⚠ Y LA CAUSA NO ERA LA AUTHKEY, que es lo primero que se piensa. Medido ese
// mismo día: `dev-2` y `dev-3` **se borraron solos** entre las 17:36 y las 17:52
// UTC, ~75 min después de caerse. Eso es exactamente lo que hace un nodo
// efímero, así que la clave en uso SÍ lo es y funciona.
//
// El que bloqueaba el nombre era **uno solo**: el `dev` original, apagado desde
// las 02:35 y todavía registrado 15 h después. Se unió ANTES de que existiera
// este mecanismo (`tailscale-unir.mjs` es de la 01:28 de ese día; el nodo ya
// estaba dentro a las 00:41, por el enlace de login), y un nodo que entra así no
// es efímero. O sea: un resto de una vez, no una configuración mal puesta —
// se borra una vez y el nombre queda libre para siempre.

/** `dev-1.ejemplo.ts.net.` → `dev-1`. Vale para el DNSName o para el nombre a secas. */
export function nombreCorto(dns) {
  if (!dns) return null;
  return String(dns).replace(/\.$/, '').split('.')[0] || null;
}

/**
 * ¿Se pidió un nombre y te dieron otro?
 * Si no se sabe qué nombre hay (nodo aún fuera), NO se afirma que haya deriva:
 * inventarse un problema es tan malo como callar el que hay.
 */
export function hayDeriva(pedido, dns) {
  const tiene = nombreCorto(dns);
  if (!pedido || !tiene) return false;
  return tiene !== pedido;
}

/**
 * El aviso, o cadena vacía si no hay nada que decir.
 *
 * Dice las TRES cosas que hacen falta para arreglarlo, y en este orden:
 * qué pasó, cuál es la URL que sí funciona AHORA (para no quedarse tirado), y
 * cómo recuperar el nombre estable (para que no vuelva a pasar).
 */
export function avisoDeDeriva(pedido, dns, puertoTs = '8443') {
  if (!hayDeriva(pedido, dns)) return '';
  const tiene = nombreCorto(dns);
  const completo = String(dns).replace(/\.$/, '');
  return `⚠⚠ ESTE NODO NO SE LLAMA "${pedido}", SE LLAMA "${tiene}".\n` +
    `Pedí "${pedido}" y la tailnet me dio "${tiene}" porque el nombre sigue ` +
    `ocupado por un nodo viejo. Tailscale NO falla al hacer esto: sufija y sigue.\n` +
    `\n` +
    `Qué acaba de romperse: la app instalada en el móvil apunta a ` +
    `https://${pedido}.<tailnet>:${puertoTs}/ , que resuelve al nodo muerto. Se ve ` +
    `como "Failed to fetch", no como un cambio de dirección.\n` +
    `\n` +
    `La URL que SÍ funciona ahora:\n` +
    `  https://${completo}:${puertoTs}/\n` +
    `\n` +
    `Para recuperar "${pedido}":\n` +
    `  1. Borra los nodos apagados que se llaman "${pedido}" en\n` +
    `     https://login.tailscale.com/admin/machines\n` +
    `  2. Vuelve a unir este nodo:  node scripts/tailscale-unir.mjs\n` +
    `\n` +
    `⚠ Antes de tocar la authkey, MIRA cuánto lleva muerto el que estorba. Un\n` +
    `nodo efímero se borra solo en ~1 h; si el que bloquea lleva ahí horas, no\n` +
    `entró con la clave de hoy — es un resto de antes, y se borra UNA vez. Sólo\n` +
    `si un nodo recién caído sigue registrado al día siguiente es que la clave\n` +
    `no es EPHEMERAL (ver .env.example).`;
}


/**
 * La orden con la que este nodo se une, dada la RUTA de un fichero que contiene
 * la clave. La clave **no aparece**: ni aquí, ni en `argv`, ni en el entorno que
 * `sudo` preserva.
 *
 * ⚠⚠ POR QUÉ UN FICHERO Y NO UNA VARIABLE, medido el 2026-09-10.
 * La versión anterior decía pasar la clave «por el ENTORNO, nunca en la línea de
 * comando» y hacía esto:
 *
 *     sudo -n --preserve-env=TS_AUTHKEY tailscale up --authkey="$TS_AUTHKEY" …
 *
 * y filtraba la clave DOS veces en la misma línea del journal:
 *
 *   1. `execSync` lanza con `/bin/sh -c`, así que **el shell expande `"$TS_AUTHKEY"`
 *      ANTES de que `sudo` exista**. Lo que sudo recibe en `argv` es la clave
 *      literal, y sudo escribe el `COMMAND=` entero en el journal.
 *   2. `--preserve-env=TS_AUTHKEY` hace que sudo registre además `ENV=TS_AUTHKEY=<clave>`.
 *
 * O sea que la protección estaba escrita en el comentario y no en el código, que
 * es la peor combinación: se lee como resuelto. Quedó en claro en el journal —
 * que aquí es **persistente** (`/var/log/journal`)— en el aprovisionamiento de
 * esta máquina.
 *
 * `tailscale up --auth-key file:<ruta>` (soportado, comprobado en la 1.102.3)
 * quita las dos: no hay nada que expandir ni nada que preservar.
 */
export function ordenDeUnir(rutaClave, nombre) {
  return `sudo -n tailscale up --auth-key=file:${rutaClave} ` +
    `--hostname=${nombre} --accept-dns=false`;
}

// ---------------------------------------------------------------------------
// Reclamar el nombre: QUÉ nodos se pueden borrar, que es donde está el riesgo.
// ---------------------------------------------------------------------------
//
// Por qué hace falta, y por qué no basta con esperar: la authkey es efímera y
// los nodos muertos se borran solos, pero tardan **~75 min** (medido el
// 2026-09-10). Eso deja una CARRERA: rehacer el dev antes de esa ventana
// encuentra el nombre ocupado y entra sufijado. Borrarlo explícitamente al
// destruir el droplet cierra la ventana entera (R11: quien apaga, limpia).
//
// ⚠⚠ Y AQUÍ SE BORRA DE VERDAD, así que la cautela va en el código y no en el
// que llama. La API de Tailscale **no devuelve ningún booleano `online`** — sólo
// `lastSeen` (comprobado en el esquema de `GET /api/v2/tailnet/-/devices`, que
// trae `id`, `name`, `hostname`, `lastSeen`, `addresses`, `authorized`). O sea
// que «está muerto» hay que DERIVARLO, y derivarlo mal se lleva por delante una
// máquina viva: en esta tailnet está el móvil del dueño.
//
// Las cuatro reglas, y las cuatro tienen test:
//
//  1. **Sólo el que ocupa EXACTAMENTE el nombre pedido.** Se compara la primera
//     etiqueta del `name` (el FQDN), no el `hostname`: los cuatro nodos de aquel
//     día tenían `hostname: "dev"` y se llamaban `dev`, `dev-1`, `dev-2`, `dev-3`.
//     Casar por `hostname` los habría borrado todos, incluido el vivo.
//  2. **Nunca uno que parezca vivo.** Sin `online`, «vivo» es `lastSeen`
//     reciente. El defecto es conservador y quien quiera bajarlo tiene que
//     PROBAR que está muerto (ver `inactivoDesdeMs`).
//  3. **Nunca uno excluido a mano** (el propio nodo). Cinturón y tirantes: si el
//     que pregunta ya está dentro de la tailnet, no puede autoborrarse.
//  4. **Lo que NO se borra se DICE.** Un nodo que ocupa el nombre y está vivo es
//     justo el caso que hay que mirar; saltárselo en silencio deja el fallo
//     original (la URL muerta) sin explicación.

/** La primera etiqueta del FQDN de un device de la API. */
const etiqueta = (d) => String(d?.name ?? '').replace(/\.$/, '').split('.')[0] || '';

/**
 * Qué nodos se pueden borrar para dejar libre `nombre`.
 *
 * @param {Array} devices           lo que devuelve `GET /api/v2/tailnet/-/devices`
 * @param {string} nombre           el nombre que se quiere reclamar (p. ej. `dev`)
 * @param {object} opciones
 *   · `ahora`            Date, para poder probarlo sin depender del reloj
 *   · `inactivoDesdeMs`  cuánto tiene que llevar callado para darlo por muerto.
 *     ⚠ El defecto son 5 min. Se puede bajar a 0 **sólo con una prueba de que la
 *     máquina ya no existe** — p. ej. justo después de que DigitalOcean confirme
 *     que el droplet se destruyó. Ahí `lastSeen` ya no significa nada y esperar
 *     sería esperar por nada.
 *   · `excluirIds`       ids que no se tocan pase lo que pase
 * @returns {{borrar: Array, avisos: string[]}}
 */
export function nodosAReclamar(devices, nombre, opciones = {}) {
  const { ahora = new Date(), inactivoDesdeMs = 5 * 60 * 1000, excluirIds = [] } = opciones;
  const avisos = [];
  // Una respuesta que no es una lista no es «no hay nada»: es que no lo sé, y no
  // se borra nada por no saber (el mismo criterio que el `NO SÉ` del freno).
  if (!Array.isArray(devices)) return { borrar: [], avisos: ['la lista de nodos no se pudo leer: no borro nada'] };
  if (!nombre) return { borrar: [], avisos: ['sin nombre que reclamar: no borro nada'] };

  const borrar = [];
  for (const d of devices) {
    if (etiqueta(d) !== nombre) continue;                       // regla 1
    if (excluirIds.includes(d?.id)) {                            // regla 3
      avisos.push(`\`${d.name}\` ocupa el nombre pero está excluido a mano: no lo toco`);
      continue;
    }
    const visto = Date.parse(d?.lastSeen ?? '');
    const callado = Number.isNaN(visto) ? Infinity : ahora.getTime() - visto;
    if (callado < inactivoDesdeMs) {                             // regla 2
      avisos.push(                                               // regla 4
        `⚠ \`${d.name}\` ocupa el nombre "${nombre}" y PARECE VIVO ` +
        `(visto hace ${Math.round(callado / 1000)} s): NO lo borro. ` +
        `Si de verdad está muerto, se borra a mano en la consola.`);
      continue;
    }
    borrar.push(d);
  }
  return { borrar, avisos };
}


/**
 * La orden con la que este nodo se da de baja de la tailnet.
 *
 * ⚠⚠ MEDIDO EL 2026-09-10, y es lo que hace que todo esto exista: `logout`
 * borra un nodo efímero **al instante**, no en los ~75 min que tarda la
 * limpieza por inactividad. Comprobado en esta máquina:
 *
 *   18:35:38  Self ID `nznvvWsNKE11CNTRL`, 3 nodos en la tailnet
 *   18:35:51  sudo tailscale logout
 *   18:35:53  vuelto a unir -> Self ID `nbjCKGjnuo11CNTRL`, y otra vez `dev-1`
 *   18:36:08  3 nodos. El ID viejo NO existe.
 *
 * Que recuperase el nombre `dev-1` en 2 s es la prueba: si el viejo siguiera
 * registrado, el nuevo habría entrado como `dev-2`.
 *
 * ⚠ La doc de Tailscale dice justo esto («removes it from your tailnet
 * immediately»), pero **se midió igual**: esa misma página da la limpieza por
 * inactividad en «30 a 60 minutos» y aquí se midieron ~75. Una doc que ya se
 * quedó corta en el número de al lado no es una fuente para el que decide.
 *
 * Por qué esto vale más que borrar por API: el nodo se da de baja con SU PROPIA
 * clave, así que no hay ninguna credencial que repartir, que caducar, ni que
 * redactar de las conversaciones archivadas. La pregunta de dónde guardar un
 * token que puede borrar cualquier dispositivo **desaparece**.
 */
export function ordenDeDesunir() {
  return 'sudo -n tailscale logout';
}


// ---------------------------------------------------------------------------
// La OTRA deriva: el `serve` se queda con el nombre que el nodo tenía ANTES.
// ---------------------------------------------------------------------------
//
// ⚠⚠ MEDIDO EL 2026-09-10 en esta máquina, y rompió la app entera.
// `tailscale serve` guarda el **hostname dentro de su configuración**, no una
// referencia al nodo. Así que cambiar el nombre del nodo deja el `serve`
// publicando bajo un nombre que ya no es suyo, y tailscaled rechaza las dos
// puertas a la vez:
//
//     Host=dev    -> "no webserver configured for name/port"
//     Host=dev-2  -> 'invalid domain "dev-2…"; must be one of ["dev…"]'
//
// El timeline de aquel día, del journal:
//   20:08:35  el nodo entra como `dev-2` (el nombre `dev` seguía ocupado)
//             -> serve puesto bajo `dev-2`, cert ACME de `dev-2`
//   20:29:25  `sudo tailscale logout`
//   20:29:40  `tailscale up --hostname=dev`; el nombre ya estaba libre -> `dev`
//   20:29:41  `tailscale serve --bg` **SÍ se relanzó**, y aplicó su POST…
//             …y la config siguió diciendo `dev-2`.
//
// ⚠⚠ Y AQUÍ ESTÁ LO QUE HAY QUE ENTENDER: **el paso de reponer el serve YA
// EXISTÍA y se ejecutó**. No faltaba. Un segundo después del `up`, o sea antes
// de que el registro con el nombre nuevo asentara, `serve` compuso su config
// con el nombre que el nodo tenía en ese instante — el viejo. Reintentar a
// ciegas no arregla esto: el reintento ES lo que lo escribió mal.
//
// ⚠ La carrera es la explicación más plausible y encaja con los segundos, pero
// NO está aislada: del journal se puede probar que el POST de las 20:29:41 se
// aplicó y que el resultado fue `dev-2`, no qué nombre reportaba tailscaled en
// ese instante. Por eso el freno NO se pone en el timing —que habría que
// acertar— sino en el **dato**: se compara el host publicado con el del nodo.
// Eso detecta el estado malo se haya llegado a él como se haya llegado.
//
// ⚠⚠ Y LO QUE HACE ESTO TAN DIFÍCIL DE VER: **la reparación es la que rompe**.
// El nodo acabó con el nombre BUENO, que es justo lo que `hayDeriva()` vigila,
// así que el freno que existe para esto no podía saltar — no había deriva de
// nombre. La que quedaba sin vigilar es la otra mitad del par: no
// «pedido ↔ nodo», sino **«nodo ↔ serve»**. Son dos derivas distintas con dos
// causas distintas, y hasta hoy sólo se miraba una.
//
// Es la lección de siempre del proyecto por una puerta nueva: el `up` salió con
// 0, el nodo tenía el nombre correcto, el `serve` estaba puesto y `cweb url`
// imprimía una URL con total confianza — **la URL muerta**.

/** `dev-2.ejemplo.ts.net:8443` → `dev-2.ejemplo.ts.net`. Sin puerto, sin punto final. */
const soloHost = (clave) => String(clave ?? '')
  .replace(/:\d+$/, '')      // el puerto
  .replace(/\.$/, '')        // el punto final del FQDN
  .toLowerCase();

/**
 * Los hosts que `tailscale serve` publica y que **no son este nodo**.
 *
 * @param {string|null} dnsNodo  el `Self.DNSName` de `tailscale status --json`
 * @param {object|null} serve    lo que devuelve `tailscale serve status --json`
 * @returns {{huerfanos: string[], propios: string[], sabe: boolean}}
 *
 * ⚠ `sabe: false` cuando no se puede comparar (nodo fuera de la tailnet, o
 * `serve status` ilegible). Entonces **no se afirma que haya nada roto**: es la
 * misma regla que `hayDeriva()` y que el `NO SÉ` del freno del coordinador —
 * inventarse un problema manda a arreglar lo que no está roto.
 */
export function serveHuerfano(dnsNodo, serve) {
  const mio = String(dnsNodo ?? '').replace(/\.$/, '').toLowerCase();
  const web = serve?.Web;
  if (!mio || !web || typeof web !== 'object') return { huerfanos: [], propios: [], sabe: false };

  const huerfanos = [], propios = [];
  for (const clave of Object.keys(web)) {
    (soloHost(clave) === mio ? propios : huerfanos).push(String(clave));
  }
  return { huerfanos, propios, sabe: true };
}

/**
 * El aviso, o cadena vacía si no hay nada que decir.
 *
 * Dice lo mismo que su hermano `avisoDeDeriva`: qué pasó, y **el comando que lo
 * arregla** — que aquí es uno solo y cabe en el mensaje. El `reset` va primero
 * a propósito: `serve --bg` añade el host nuevo pero **no borra el viejo**, así
 * que sin él quedan los dos publicados y el siguiente que lea el status puede
 * volver a coger el muerto.
 */
export function avisoDeServeHuerfano(dnsNodo, serve, puertoTs = '8443', puertoWeb = '8020') {
  const { huerfanos, propios, sabe } = serveHuerfano(dnsNodo, serve);
  if (!sabe || huerfanos.length === 0) return '';
  const nodo = String(dnsNodo).replace(/\.$/, '');
  const arreglo =
    `  sudo -n tailscale serve reset\n` +
    `  sudo -n tailscale serve --bg --https=${puertoTs} http://127.0.0.1:${puertoWeb}`;

  return `⚠⚠ EL \`serve\` PUBLICA UN NOMBRE QUE ESTE NODO YA NO TIENE.\n` +
    `Este nodo es "${nodo}", pero tailscale serve sirve bajo:\n` +
    huerfanos.map((h) => `  · ${h}   ← muerto`).join('\n') + '\n' +
    (propios.length ? propios.map((h) => `  · ${h}   ← este sí\n`).join('') : '') +
    `\n` +
    `Qué se rompe: NINGUNA de las dos direcciones sirve. Por el nombre viejo,\n` +
    `tailscaled contesta 'invalid domain … must be one of ["${nodo}"]'; por el\n` +
    `bueno, "no webserver configured for name/port". Desde el móvil se ve como\n` +
    `"Failed to fetch", o sea como una app rota — y la app está perfecta.\n` +
    `\n` +
    `Por qué pasa: el nombre del nodo cambió DESPUÉS de poner el serve (un\n` +
    `\`logout\` + volver a unir al recuperar el nombre bueno, p. ej.). El serve\n` +
    `guarda el hostname dentro de su config y no sigue al nodo.\n` +
    `\n` +
    `Se arregla con esto, y es idempotente:\n${arreglo}`;
}


/**
 * La orden con la que este nodo se comprueba a SÍ MISMO por la tailnet.
 *
 * ⚠⚠ MEDIDO EL 2026-09-10: la versión anterior era un `curl https://<fqdn>:<p>/…`
 * a secas, y **no podía dar 200 jamás** en esta máquina. El nodo se une con
 * `--accept-dns=false` (ver `ordenDeUnir`, y es deliberado: no se le toca el DNS
 * al droplet), así que la propia máquina NO resuelve su nombre de MagicDNS:
 *
 *     sin --resolve -> "000"   (curl: (6) Could not resolve host)
 *     con --resolve -> "200"
 *
 * O sea que el paso que existe para confirmar que la web se ve **decía que no se
 * veía, siempre**, con el serve perfecto. Es el patrón B del proyecto: un aviso
 * que sale siempre se deja de leer, y entonces el día que sea de verdad tampoco
 * se lee. Peor que no comprobar.
 *
 * ⚠ Y NO se comprueba por `127.0.0.1`, que es la salida fácil: eso probaría la
 * app, que ya se sabe que está viva. Lo que hay que probar es justo el tramo que
 * falla —TLS y enrutado por nombre dentro de tailscaled—, y ése sólo se recorre
 * pidiendo por el FQDN. Se le da la IP para saltarse el DNS, no el nombre.
 *
 * ⚠ Sin `-k`: el certificado es de Let's Encrypt por ACME y tiene que validar,
 * porque el móvil tampoco va a aceptar uno malo. Si no valida, esto es un fallo.
 */
export function ordenDeProbar(dnsNodo, ip, puertoTs = '8443', ruta = '/api/salud') {
  const fqdn = String(dnsNodo ?? '').replace(/\.$/, '');
  if (!fqdn) return null;
  const resolucion = ip ? `--resolve ${fqdn}:${puertoTs}:${ip} ` : '';
  return `curl -s --max-time 10 -o /dev/null -w '%{http_code}' ` +
    `${resolucion}https://${fqdn}:${puertoTs}${ruta}`;
}
