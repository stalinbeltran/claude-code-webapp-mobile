// Qué decir cuando la app no consigue hablar con su servidor.
//
// Por qué esto es un módulo y no una plantilla de texto suelta
// -----------------------------------------------------------
// El 2026-09-10 la app decía exactamente esto y nada más:
//
//     No pude leer las conversaciones: Failed to fetch
//
// Y era verdad, pero no servía para nada: «Failed to fetch» es lo que el
// navegador dice cuando NO LLEGA, sin distinguir si no hay red, si el móvil está
// fuera de la tailnet, o si la dirección guardada apunta a una máquina que ya no
// existe. Ese día era lo tercero —el dev se rehizo y entró en la tailnet como
// `dev-1`, así que la URL de la PWA instalada apuntaba al nodo viejo— y desde el
// móvil se leyó como «la app está rota».
//
// ⚠⚠ Y el service worker hace que ese caso sea EL MÁS CONFUSO de todos, no el
// más raro: el armazón se sirve desde la caché cuando la red falla (a propósito,
// ver `sw.js`), pero `/api/` NO se cachea nunca. O sea que la app **abre
// normal** y sólo fallan los datos. Abrir bien es justo lo que te convence de
// que el servidor está ahí.
//
// La regla: un error de red se explica NOMBRANDO lo que se intentó alcanzar y
// diciendo que lo que se ve es de la caché. Un mensaje que no dice contra qué
// origen falló no se puede depurar desde un móvil.

/** Marca de «no llegué al servidor», para distinguirlo de «contestó y contestó mal». */
export class SinRed extends Error {
  constructor(causa, ruta) {
    super(causa?.message || 'no hay red');
    this.name = 'SinRed';
    this.sinRed = true;
    this.ruta = ruta;
  }
}

/**
 * El texto que se le enseña al usuario ante un fallo al pedir datos.
 *
 * @param {Error} e      lo que se lanzó (con `sinRed` si no se llegó al servidor)
 * @param {string} que   qué se estaba leyendo, para la primera línea
 * @param {string} origen `location.origin`, o sea contra QUIÉN se falló
 */
export function explicarFallo(e, que, origen) {
  // El servidor contestó: su código dice más que cualquier cosa que inventemos.
  if (!e?.sinRed) return `No pude ${que}: ${e?.message ?? e}`;

  const donde = origen || 'este servidor';
  return `🔴 No he podido hablar con el servidor.\n` +
    `Intentado contra: ${donde}\n` +
    `\n` +
    `Lo que ves es el armazón guardado en el móvil, no datos de ahora — por eso ` +
    `la app abre y aun así no hay conversaciones.\n` +
    `\n` +
    `Las dos causas, en este orden:\n` +
    `1. Tailscale está apagado en este móvil. Enciéndelo y recarga.\n` +
    `2. La máquina se rehízo y CAMBIÓ DE NOMBRE en la tailnet, así que esta ` +
    `dirección apunta a un server que ya no existe. Pide la de ahora por ` +
    `Telegram con "/use cweb" y luego "url", ábrela, y vuelve a instalar la app ` +
    `desde ella.`;
}
