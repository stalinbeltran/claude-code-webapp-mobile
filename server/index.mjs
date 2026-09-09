// El servidor de la web de lectura.
//
// Qué es y qué NO es
// ------------------
// Un `node:http` sin dependencias que lee `data/mensajes/*.jsonl` —el log que
// escribe el coordinador— y lo sirve. **No escribe en ese log** y **no ejecuta
// nada**: en la fase 2 es sólo lectura. El contrato del formato vive donde su
// productor, en `telegram-coordinator/docs/log-de-mensajes.md`.
//
// ⚠⚠ ESCUCHA SÓLO EN 127.0.0.1, Y ESO ES UN FRENO, NO UNA PREFERENCIA.
// El bot usa long polling precisamente para no abrir puertos. Quien alcance este
// puerto llega al mismo sitio que un mensaje de Telegram —una máquina donde
// `claude` corre con `bypassPermissions`— y **la allowlist del bot no lo cubre**.
// Desde fuera se entra por `tailscale serve`, que hace de proxy contra este
// mismo `127.0.0.1` y pone la identidad (decisiones P2 y P3).
// Hay un test que falla si alguien lo cambia: una invariante que importa es un
// test, no una frase (R14).
//
// ⚠ Y NO deduce dónde está el log: se lo tienen que decir con `DATA_DIR` (R4).
// Que el coordinador esté «al lado» es una coincidencia del sistema de ficheros,
// no un contrato — y aquí además puede estar en otra máquina. Si no se lo dicen,
// **se niega antes de empezar** en vez de servir un log vacío que se leería como
// «no has hablado con claude nunca» (R2: o degrada con un defecto declarado, o
// falla antes de empezar; fallar a mitad no es una opción).

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { listarSesiones, leerMensajes, PAGINA } from './datos.mjs';

/** ⚠ NO se toca sin leer la cabecera. Ver `tests/servidor.test.mjs`. */
export const HOST = '127.0.0.1';

/** 8010 lo tiene la web app de `foveal-vision` en esta misma máquina (medido el
 *  2026-09-09), así que el defecto es otro. */
export const PUERTO = Number(process.env.CWEB_PORT ?? 8020);

/**
 * Dónde vive el log. Es la ÚNICA entrada de este servidor: sin ella no hay nada
 * que servir, y adivinarla sería el antipatrón de la R4.
 * @returns {{ raiz: string } | { error: string }}
 */
export function raizDatos(env = process.env) {
  if (!env.DATA_DIR) {
    return {
      error: 'Falta DATA_DIR: no sé dónde está el log de mensajes.\n' +
        '  Es el `data/` del coordinador que lo escribe, p. ej.:\n' +
        '    DATA_DIR=~/src/telegram-coordinator/data npm start\n' +
        '  Para probar sin coordinador, vale el fixture:\n' +
        '    DATA_DIR=./tests/fixtures npm start',
    };
  }
  const raiz = resolve(env.DATA_DIR);
  if (!existsSync(raiz)) {
    return { error: `DATA_DIR apunta a "${raiz}", que no existe.` };
  }
  return { raiz };
}

function json(res, code, cuerpo) {
  const body = JSON.stringify(cuerpo);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    // No hay nada que cachear: el log cambia solo. Y un armazón viejo servido
    // desde caché es indistinguible de un servidor caído.
    'cache-control': 'no-store',
  });
  res.end(body);
}

/**
 * Monta el servidor y NO lo arranca. Separado de `arrancar()` por lo mismo que
 * `crearBot()` en el coordinador: así el camino real se puede probar sin ocupar
 * un puerto y sin depender de que haya un coordinador vivo.
 */
export function crearServidor(raiz) {
  return createServer((req, res) => {
    const url = new URL(req.url, `http://${HOST}`);

    if (url.pathname === '/api/salud') {
      const dirMensajes = join(raiz, 'mensajes');
      return json(res, 200, {
        ok: true,
        // Se dice si el log EXISTE, no se finge que sí. Un `mensajes/` que no
        // está significa «el coordinador no ha escrito todavía», que es un
        // estado normal y distinto de «esto está roto».
        log: existsSync(dirMensajes) ? 'presente' : 'todavía no hay ninguno',
        datos: raiz,
      });
    }

    if (url.pathname === '/api/sesiones') {
      return json(res, 200, { sesiones: listarSesiones(raiz) });
    }

    // El id lleva `_` y puede empezar por `-` (los chats de grupo son negativos),
    // así que se casa explícito y no con un `split('/')`.
    // ⚠ No hace falta defenderse del `..`: `datos.mjs` sanea el id para formar el
    // nombre del fichero y ahí una `/` se convierte en `_`, así que no hay forma
    // de salir de `mensajes/`. Tiene test, porque «no hace falta» envejece mal.
    const m = url.pathname.match(/^\/api\/sesiones\/([^/]+)\/mensajes$/);
    if (m) {
      const limite = Math.min(Number(url.searchParams.get('limite')) || PAGINA, 500);
      return json(res, 200, leerMensajes(raiz, decodeURIComponent(m[1]), {
        desde: url.searchParams.get('desde'),
        limite,
      }));
    }

    json(res, 404, { error: `No existe ${url.pathname}` });
  });
}

/** Arranque de verdad. Se niega si no sabe dónde está el log. */
export function arrancar() {
  const r = raizDatos();
  if ('error' in r) {
    console.error(`❌ ${r.error}`);
    process.exit(2);
  }
  const server = crearServidor(r.raiz);
  server.listen(PUERTO, HOST, () => {
    console.log(`🌐 Web de lectura en http://${HOST}:${PUERTO}  (log: ${r.raiz})`);
    console.log('   Sólo escucha en loopback: desde fuera se entra por `tailscale serve`.');
  });
  // Un fallo de red no puede tumbar el proceso sin decir por qué.
  server.on('error', (e) => {
    console.error(`❌ El servidor falló: ${e.message}`);
    if (e.code === 'EADDRINUSE') console.error(`   El puerto ${PUERTO} ya está ocupado. Prueba CWEB_PORT=<otro>.`);
    process.exit(1);
  });
  return server;
}

// Sólo arranca si se ejecuta directamente, nunca al importarlo desde un test.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) arrancar();
