// Avisar al navegador de que algo cambió, sin que tenga que preguntar.
//
// SSE y no WebSocket: el tráfico útil es servidor → navegador, escribir es un
// `POST` normal, y SSE **reconecta solo** — que en un móvil que entra y sale de
// cobertura es la mitad del valor.
//
// ⚠⚠ EL SONDEO DE RESPALDO NO ES OPCIONAL. `fs.watch` no es fiable en todos los
// sistemas de ficheros, y cuando falla no avisa: simplemente no dispara nunca, y
// la web se queda quieta sin ningún error. Por eso hay dos fuentes —el watcher y
// un sondeo cada 2 s— y la comprobación es la misma en las dos.
//
// ⚠ Lo que viaja NO son los mensajes, es un «algo cambió» con la huella de qué.
// El cliente pide entonces lo que le interese por la API de siempre. Así hay una
// sola forma de serializar un mensaje, en vez de dos que pueden divergir — y el
// evento es diminuto aunque la respuesta de claude ocupe 60 KB.

import { readdirSync, statSync, existsSync } from 'node:fs';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { leerLatido } from './datos.mjs';

/** Cada cuánto se mira el disco aunque el watcher no diga nada. */
export const SONDEO_MS = Number(process.env.CWEB_SONDEO_MS ?? 2000);

/**
 * La huella de lo que hay ahora: por sesión, cuándo se tocó y cuánto ocupa; más
 * el estado del coordinador. Es barata —`stat` por fichero, sin leer contenido—
 * y cambia exactamente cuando cambia algo que el navegador debería ver.
 */
export function huella(raiz) {
  const dir = join(raiz, 'mensajes');
  const sesiones = {};
  if (existsSync(dir)) {
    for (const n of readdirSync(dir)) {
      if (!n.endsWith('.jsonl')) continue;
      const s = statSync(join(dir, n));
      sesiones[n.slice(0, -6)] = `${Math.round(s.mtimeMs)}:${s.size}`;
    }
  }
  const l = leerLatido(raiz);
  return JSON.stringify({
    sesiones,
    // `visto` no entra: cambia cada 15 s aunque no pase nada, y eso despertaría
    // al navegador sin motivo. Lo que importa es si el bot está vivo y qué atiende.
    coordinador: { vivo: l.vivo, hay: l.hay, turnos: Object.keys(l.turnos).sort() },
  });
}

/**
 * Monta el vigilante y devuelve cómo suscribirse y cómo pararlo todo.
 * Un solo vigilante para todos los clientes: mirar el disco N veces por segundo
 * porque haya N pestañas abiertas no tiene sentido.
 */
export function crearVigilante(raiz) {
  const clientes = new Set();
  let anterior = huella(raiz);
  let timer, watcher;

  const comprobar = () => {
    let ahora;
    try { ahora = huella(raiz); } catch { return; }   // un fallo de disco no tumba esto
    if (ahora === anterior) return;
    anterior = ahora;
    for (const res of clientes) {
      try { res.write(`event: cambio\ndata: ${ahora}\n\n`); } catch { clientes.delete(res); }
    }
  };

  timer = setInterval(comprobar, SONDEO_MS);
  timer.unref();
  try {
    // `recursive` no hace falta: todos los ficheros cuelgan de `mensajes/`. Y si
    // el directorio aún no existe, se vigila el padre — el primer mensaje lo crea.
    const objetivo = existsSync(join(raiz, 'mensajes')) ? join(raiz, 'mensajes') : raiz;
    watcher = watch(objetivo, () => comprobar());
    watcher.unref?.();
    watcher.on('error', () => { /* el sondeo sigue: por eso existe */ });
  } catch {
    // Sin watcher se vive: es el sondeo quien garantiza que esto funcione.
  }

  return {
    /** Engancha una respuesta HTTP como cliente SSE. */
    suscribir(req, res) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      // `retry` le dice al navegador cada cuánto reintentar si se cae la
      // conexión — que en un móvil pasa cada vez que se bloquea la pantalla.
      res.write(`retry: 3000\nevent: cambio\ndata: ${anterior}\n\n`);
      clientes.add(res);
      req.on('close', () => clientes.delete(res));
    },
    comprobar,
    get clientes() { return clientes.size; },
    parar() {
      clearInterval(timer);
      watcher?.close();
      // ⚠ Cerrar las conexiones abiertas: si no, `server.close()` no termina
      // nunca porque quedan sockets vivos, y el proceso no sale.
      for (const res of clientes) { try { res.end(); } catch { /* ya estaba */ } }
      clientes.clear();
    },
  };
}
