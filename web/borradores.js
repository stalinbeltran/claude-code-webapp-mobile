// Que lo que ESCRIBES no se pierda: el borrador y los envíos sin confirmar.
//
// Por qué existe
// -------------
// Pedido por el dueño el 2026-10-09. Dos pérdidas que se notan desde el móvil:
//
//  1. **Lo escrito sin enviar se iba** con cualquier recarga: el navegador
//     descarta la pestaña, se cierra la ventana, la app vuelve a la lista… El
//     borrador vivía sólo en memoria.
//  2. **Lo ENVIADO también podía perderse** si el servidor estaba ocupado: el
//     POST contesta 202 («lo apunto»), la caja se vaciaba, y si el mensaje no
//     llegaba nunca al log no quedaba copia en ningún sitio.
//
// Se arregla en el NAVEGADOR y sin tocar el backend (decisión del dueño: el
// backend funciona tal como está). La regla es la que ya rige para `notify.mjs`
// en el coordinador: *el aviso es una comodidad, la fuente de verdad es lo que
// vuelve*. Un envío sólo se da por hecho cuando el texto **aparece de vuelta en
// el log** como mensaje tuyo; hasta entonces se guarda y se ENSEÑA, copiable.
//
// ⚠ `localStorage` es POR ORIGEN (como `lectura.js`): si la web cambia de
// dirección, lo pendiente se queda en la dirección vieja.
//
// ⚠ El almacén se INYECTA y todo va envuelto: en incógnito `localStorage`
// LANZA al escribir, y no poder guardar no puede tumbar la caja de escribir.

/** Borrador de cada conversación: `cweb.borrador.<sesion>` = texto. */
export const PREFIJO_BORRADOR = 'cweb.borrador.';
/** Envíos sin confirmar: `cweb.pendientes.<sesion>` = JSON [{ texto, ts }]. */
export const PREFIJO_PENDIENTES = 'cweb.pendientes.';
/** Tope de pendientes por conversación: un bucle raro no puede llenar el almacén. */
export const MAX_PENDIENTES = 20;

export function leerBorrador(storage, sesion) {
  try { return storage?.getItem(PREFIJO_BORRADOR + sesion) || ''; } catch { return ''; }
}

/** Guarda el borrador; vacío lo borra. @returns {boolean} si se pudo */
export function guardarBorrador(storage, sesion, texto) {
  try {
    if (texto && texto.trim()) storage?.setItem(PREFIJO_BORRADOR + sesion, texto);
    else storage?.removeItem(PREFIJO_BORRADOR + sesion);
    return true;
  } catch { return false; }
}

export function leerPendientes(storage, sesion) {
  try {
    const v = JSON.parse(storage?.getItem(PREFIJO_PENDIENTES + sesion) || '[]');
    return Array.isArray(v) ? v.filter((p) => p && typeof p.texto === 'string') : [];
  } catch { return []; }
}

function escribirPendientes(storage, sesion, lista) {
  try {
    if (lista.length) storage?.setItem(PREFIJO_PENDIENTES + sesion, JSON.stringify(lista));
    else storage?.removeItem(PREFIJO_PENDIENTES + sesion);
    return true;
  } catch { return false; }
}

/**
 * Apunta un envío ANTES de mandarlo: si la pestaña muere a mitad del POST, el
 * texto ya está en disco. Se guarda aunque el POST falle — entonces además
 * sigue en la caja, y la tarjeta desaparece al reintentar con éxito.
 * @returns {{ texto: string, ts: string }} el pendiente apuntado
 */
export function apuntarPendiente(storage, sesion, texto, ahora = new Date()) {
  const p = { texto, ts: ahora.toISOString() };
  const lista = leerPendientes(storage, sesion).filter((x) => x.texto !== texto);
  lista.push(p);
  escribirPendientes(storage, sesion, lista.slice(-MAX_PENDIENTES));
  return p;
}

/** Quitar uno a mano (el botón «descartar»). */
export function descartarPendiente(storage, sesion, ts) {
  const lista = leerPendientes(storage, sesion);
  const resto = lista.filter((p) => p.ts !== ts);
  escribirPendientes(storage, sesion, resto);
  return resto;
}

const normal = (t) => String(t ?? '').replace(/\r\n/g, '\n').trim();

/**
 * Quita los pendientes que YA VOLVIERON: un mensaje `usuario` del log con el
 * mismo texto. Cada mensaje del log confirma **un solo** pendiente, para que
 * mandar dos veces lo mismo no se dé por recibido con una sola llegada.
 *
 * ⚠ Sólo cuentan mensajes POSTERIORES al envío (con 2 min de margen por reloj
 * desajustado entre móvil y servidor): un «sí» viejo del historial no puede
 * confirmar el «sí» que acabas de mandar.
 *
 * @returns {Array} los que siguen pendientes (y los deja así en el almacén)
 */
export function confirmarRecibidos(storage, sesion, mensajes) {
  const lista = leerPendientes(storage, sesion);
  if (!lista.length) return lista;
  const usados = new Set();
  const resto = lista.filter((p) => {
    const desde = Date.parse(p.ts) - 120_000;
    const i = (mensajes ?? []).findIndex((m, k) =>
      !usados.has(k) && m?.autor === 'usuario' && normal(m.texto) === normal(p.texto) &&
      !(Date.parse(m.ts) < desde));
    if (i === -1) return true;
    usados.add(i);
    return false;
  });
  if (resto.length !== lista.length) escribirPendientes(storage, sesion, resto);
  return resto;
}
