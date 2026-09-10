// El NOMBRE del nodo en la tailnet, que es lo que hace que la PWA instalada en
// el móvil siga funcionando cuando se rehace la máquina.
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
// La causa de fondo es la authkey: `.env.example` pide que sea **Ephemeral**
// justo para que el nodo muerto se borre solo y el nombre quede libre. Si los
// nodos viejos sobreviven, no lo es.

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
    `Para recuperar "${pedido}" y que esto no vuelva a pasar:\n` +
    `  1. Borra los nodos apagados que se llaman "${pedido}" en\n` +
    `     https://login.tailscale.com/admin/machines\n` +
    `  2. Vuelve a unir este nodo:  node scripts/tailscale-unir.mjs\n` +
    `  3. La causa de fondo es la authkey: tiene que ser EPHEMERAL (ver\n` +
    `     .env.example). Si no lo es, cada dev destruido deja un nodo muerto\n` +
    `     ocupando el nombre, y el siguiente vuelve a entrar sufijado.`;
}
