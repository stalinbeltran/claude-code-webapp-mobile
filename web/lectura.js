// DÓNDE te quedaste: qué conversación tenías abierta y hasta dónde la leíste.
//
// Por qué existe
// -------------
// Pedido por el dueño el 2026-10-08. Dos fallos que se notan cada día desde el
// móvil:
//
//  1. **El navegador del móvil descarta la pestaña** cuando le falta memoria, y
//     al volver la RECARGA desde cero: la app abría siempre en la lista, con la
//     conversación cerrada. Había que volver a buscarla y abrirla.
//  2. **Al abrir, el scroll iba al FINAL**, así que para leer lo que había
//     llegado mientras no mirabas había que subir a buscar dónde empezaba.
//
// Las dos se arreglan en el NAVEGADOR, no en el servidor, y a propósito:
// «leído» es de quien lee —un móvil y un portátil leen a ritmos distintos—, y
// el servidor no sabe nada de quién mira. `localStorage` sobrevive a que el
// navegador descarte la pestaña (es disco, no memoria), que es justo el fallo.
// La conversación abierta va además en el `#` de la URL: es lo que el navegador
// restaura al recargar una pestaña descartada, aunque el almacén falle.
//
// ⚠ `localStorage` es POR ORIGEN: si la web cambia de dirección (el mini se
// rehace y cambia la IP), lo leído empieza de cero. Es el mismo precio que ya
// paga `direccion.js`, y lo único que se pierde es dónde estabas.
//
// ⚠ Los ids del log se ORDENAN como texto (el servidor ya pagina con
// `m.id >= desde`, `server/datos.mjs`), así que «hasta dónde leí» es un id y se
// compara con `>`. Ver el contrato en `telegram-coordinator/docs/log-de-mensajes.md`.

/** La conversación abierta. Con prefijo, como `cweb.servidor`. */
export const CLAVE_ABIERTA = 'cweb.abierta';
/** Hasta dónde se leyó cada conversación: `cweb.leido.<sesion>` = id del último leído. */
export const PREFIJO_LEIDO = 'cweb.leido.';

// El almacén se INYECTA y todo va envuelto, por lo mismo que en `direccion.js`:
// en incógnito `localStorage` existe pero LANZA al escribir, y la app no puede
// caerse por no poder recordar una preferencia.

export function leerAbierta(storage) {
  try { return storage?.getItem(CLAVE_ABIERTA) || null; } catch { return null; }
}

export function guardarAbierta(storage, sesion) {
  try {
    if (sesion) storage?.setItem(CLAVE_ABIERTA, sesion);
    else storage?.removeItem(CLAVE_ABIERTA);
    return true;
  } catch { return false; }
}

export function leerLeido(storage, sesion) {
  try { return storage?.getItem(PREFIJO_LEIDO + sesion) || null; } catch { return null; }
}

/**
 * Marca como leído hasta `id`. **Sólo avanza**: volver a mirar un mensaje viejo
 * (subir el scroll) no puede des-leer los de después.
 * @returns {string|null} lo que queda guardado
 */
export function marcarLeido(storage, sesion, id) {
  const antes = leerLeido(storage, sesion);
  if (!id || (antes && antes >= id)) return antes;
  try { storage?.setItem(PREFIJO_LEIDO + sesion, id); } catch { return antes; }
  return id;
}

/**
 * El primer mensaje NO leído, o null si no hay ninguno (o no se sabe).
 *
 * ⚠ Lo que escribiste TÚ nunca está sin leer: lo escribiste. Sin esto, mandar un
 * mensaje desde Telegram y abrir la app te dejaría en tu propia pregunta en vez
 * de en la respuesta.
 *
 * ⚠ Sin nada guardado devuelve null, NO el primero de la lista: una conversación
 * que nunca se abrió en esta app no tiene «sin leer» conocido, y tratarla entera
 * como nueva mandaría al principio de 300 mensajes. Se abre por el final, como
 * antes.
 */
export function primerNoLeido(mensajes, leido) {
  if (!leido) return null;
  return (mensajes ?? []).find((m) => m.id > leido && m.autor !== 'usuario')?.id ?? null;
}

/**
 * ¿Hay que pedir mensajes más antiguos para llegar al primero sin leer?
 * Sí si lo más viejo que tengo es posterior a lo leído y el servidor tiene más:
 * el primero sin leer puede estar justo antes de la página que se cargó.
 */
export function faltaAtras(mensajes, leido, hayMas) {
  if (!leido || !hayMas || !mensajes?.length) return false;
  return mensajes[0].id > leido;
}

/** Para la lista: ¿llegó algo de otro desde la última vez que se leyó aquí? */
export function tieneNoLeido(fila, leido) {
  const u = fila?.ultimo;
  if (!leido || !u?.id) return false;
  return u.id > leido && u.autor !== 'usuario';
}

/** `#s=<sesion>` → la sesión, o null. */
export function sesionDelHash(hash) {
  const m = String(hash ?? '').match(/^#s=(.+)$/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

export const hashDe = (sesion) => (sesion ? `#s=${encodeURIComponent(sesion)}` : '');

/**
 * Qué conversación abrir al arrancar: la de la URL manda (es la de ESTA
 * pestaña), y si no, la última que se tuvo abierta. Sólo si sigue existiendo:
 * una sesión purgada no puede dejar la app abriendo un hilo vacío para siempre.
 */
export function aReabrir({ hash, guardada, existentes }) {
  const hay = new Set(existentes ?? []);
  for (const s of [sesionDelHash(hash), guardada]) if (s && hay.has(s)) return s;
  return null;
}
