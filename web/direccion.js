// DÓNDE está el servidor de esta app, cuando no es de donde se abrió.
//
// Por qué existe
// -------------
// La PWA instalada en el móvil guarda un `start_url` FIJO: el origen desde el
// que se instaló. Si la máquina se rehace y entra en la tailnet con otro nombre
// —`dev-1`, `dev-2`—, ese origen deja de existir y el icono del móvil abre una
// app que no puede hablar con nadie. Hasta hoy la única salida era **volver a
// instalarla** desde la dirección nueva, que es justo lo que nadie hace desde el
// móvil cuando lo que quería era leer una conversación.
//
// ⚠⚠ Y EL ARREGLO NO ES PEDIR LOS DATOS A LA OTRA DIRECCIÓN, que es lo primero
// que se piensa. Todas las llamadas de `app.js` son RELATIVAS (`/api/…`), o sea
// del mismo origen; apuntarlas a otro host las convierte en cross-origin y
// entonces hace falta CORS en el servidor — o sea abrir, en una app que sólo
// escucha en loopback a propósito, un permiso para que otro origen le lea las
// conversaciones. Se hace al revés: **se REDIRIGE**. En el destino todo vuelve a
// ser del mismo origen y no hay nada que abrir.
//
// El origen viejo se queda como TRAMPOLÍN: su armazón sigue en la caché del
// service worker, así que el icono del móvil sigue abriendo, lee esto, y salta.
// Por eso no hay que reinstalar nada nunca más.
//
// ⚠ La dirección se guarda en `localStorage`, que es POR ORIGEN — y eso aquí
// juega a favor: en el destino no hay nada guardado, así que no vuelve a saltar.

/** Dónde se guarda. Con prefijo para no chocar con nada más del mismo origen. */
export const CLAVE = 'cweb.servidor';

/** El escape: `?aqui` en la URL impide el salto automático. Ver `decidirArranque`. */
export const ESCAPE = 'aqui';

/**
 * Un texto tecleado en un móvil → el ORIGEN al que saltar.
 *
 * Se acepta con y sin esquema porque nadie teclea `https://` en un móvil, y se
 * devuelve SÓLO el origen (sin ruta ni query): guardar una ruta arrastraría el
 * `?aqui` del escape o un `/api/...` pegado de un mensaje, y el salto acabaría
 * en un sitio que no es la app.
 *
 * ⚠⚠ EL ESQUEMA POR DEFECTO ES `http:` DESDE EL 2026-09-11. Antes era `https:`,
 * y `http:` se RECHAZABA salvo en loopback. Lo que cambió no es el criterio sino
 * el hecho sobre el que se apoyaba: la web ya no se publica con certificado (ver
 * README § «Por qué ya no hay certificado»), así que `http://` no es «un error de
 * tecleo o alguien mandándote a otro sitio» — es **la única dirección que
 * existe**.
 *
 * Medido el 2026-09-11 desde el móvil, con el nodo bien nombrado, el serve puesto
 * y la app contestando 200: pegar la dirección buena daba «La dirección tiene que
 * empezar por https://». O sea que LA SALIDA DE EMERGENCIA RECHAZABA LA SALIDA —
 * el mismo patrón que el `--resolve` que no podía dar 200 jamás (ver
 * `ordenDeProbar` en `scripts/nodo.mjs`): un freno que sólo puede decir que no.
 *
 * ⚠ `https:` SIGUE VALIENDO escrito entero, y tiene que seguir: `CWEB_TS_ESQUEMA=https`
 * vuelve a publicar con certificado sin tocar código, y una dirección guardada de
 * la época del certificado no puede dejar de ser válida por este cambio.
 *
 * @returns {{ok: true, origen: string} | {ok: false, motivo: string}}
 */
export function normalizarDireccion(texto) {
  const crudo = String(texto ?? '').trim();
  if (!crudo) return { ok: false, motivo: 'No has escrito ninguna dirección.' };

  // Sin esquema se supone http, que es como se publica hoy por la tailnet.
  const conEsquema = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(crudo) ? crudo : `http://${crudo}`;

  let u;
  try { u = new URL(conEsquema); }
  catch { return { ok: false, motivo: `No entiendo «${crudo}» como una dirección.` }; }

  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, motivo: `La dirección tiene que ser http:// o https:// (esa es ${u.protocol}//).` };
  }
  if (!u.hostname) return { ok: false, motivo: 'Esa dirección no tiene servidor.' };

  return { ok: true, origen: u.origin };
}


/**
 * ¿Se puede COMPROBAR esa dirección desde esta página, antes de saltar?
 *
 * ⚠⚠ NO SIEMPRE, y el caso que importa es el del 2026-09-11. El trampolín es la
 * PWA instalada, que vive en el origen `https://` de cuando había certificado, y
 * la dirección nueva es `http://`. El navegador **bloquea ese `fetch` por
 * contenido mixto**: la petición ni sale a la red. O sea que `contesta()`
 * devuelve `false` **sin haber preguntado nada**, y el aviso de «no he conseguido
 * alcanzar …» manda a revisar Tailscale y la dirección, que están las dos bien.
 *
 * Es el `NO SÉ` del freno del coordinador, aquí: **no poder comprobar no es haber
 * comprobado que no**, y confundirlos manda a arreglar lo que no está roto.
 *
 * ⚠ El salto en sí SÍ funciona, y por eso esto avisa en vez de bloquear: bajar de
 * https a http está prohibido para una SUBPETICIÓN, no para una navegación de
 * primer nivel, que es lo que hace `location.replace`.
 *
 * @returns {{puede: boolean, motivo: string}}
 */
export function sePuedeProbar(origenActual, destino) {
  const https = (o) => /^https:\/\//i.test(String(o ?? ''));
  if (https(origenActual) && !https(destino)) {
    return { puede: false, motivo:
      'No puedo comprobarla desde aquí: esta página es https y esa dirección es http, ' +
      'así que el navegador bloquea la comprobación (contenido mixto) antes de que salga. ' +
      'No significa que no responda. El salto sí funciona: dale a «Ir de todos modos».' };
  }
  return { puede: true, motivo: '' };
}

/**
 * ¿Hay que saltar a otro sitio al arrancar?
 *
 * Las tres reglas, y las tres tienen test:
 *
 *  1. **Sin nada guardado no se toca nada.** Es el caso normal y no puede
 *     costar ni un salto.
 *  2. **Si lo guardado ES este origen, tampoco.** Si no, sería un bucle
 *     infinito de recargas — la peor forma de romper esto, porque deja la app
 *     inservible sin enseñar ni un mensaje.
 *  3. **El escape manda sobre todo.** `?aqui` en la URL impide el salto, y
 *     existe para el caso que da miedo: una dirección guardada que ya no
 *     responde dejaría el icono del móvil saltando siempre a un sitio muerto.
 *     Con el escape se abre el trampolín, se ve lo guardado y se corrige.
 *     ⚠ Va ANTES que ninguna otra comprobación, por lo mismo que el modo seco
 *     de un lanzador: una salida de emergencia que dependa de que el resto esté
 *     bien no es una salida de emergencia.
 */
export function decidirArranque({ guardada, origenActual, escape = false } = {}) {
  if (escape) return { ir: null, motivo: 'escape' };
  if (!guardada) return { ir: null, motivo: 'nada guardado' };
  if (guardada === origenActual) return { ir: null, motivo: 'ya estás ahí' };
  return { ir: guardada, motivo: 'hay otra dirección guardada' };
}

// --------------------------------------------------------------- el almacén
// El `storage` se INYECTA para poder probar esto en Node, donde no hay
// `localStorage`. Y todo va envuelto: en modo incógnito de algunos navegadores
// `localStorage` existe pero LANZA al escribir, y que la app se caiga entera por
// no poder guardar una preferencia sería cambiar un problema por otro peor.

export function leerGuardada(storage) {
  try { return storage?.getItem(CLAVE) || null; } catch { return null; }
}

export function guardarDireccion(storage, origen) {
  try { storage?.setItem(CLAVE, origen); return true; } catch { return false; }
}

export function olvidarDireccion(storage) {
  try { storage?.removeItem(CLAVE); return true; } catch { return false; }
}
