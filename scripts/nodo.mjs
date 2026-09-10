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
