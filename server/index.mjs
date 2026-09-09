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
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { listarSesiones, leerMensajes, leerLatido, PAGINA } from './datos.mjs';

/** ⚠ NO se toca sin leer la cabecera. Ver `tests/servidor.test.mjs`. */
export const HOST = '127.0.0.1';

/** La raíz de los estáticos, deducida de dónde vive este fichero. Aquí SÍ vale
 *  deducir: `web/` viaja en este mismo repo, así que no es un acoplamiento entre
 *  piezas — es la pieza. Lo que no se deduce nunca es dónde está el log (R4). */
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

/** 8010 lo tiene la web app de `foveal-vision` en esta misma máquina (medido el
 *  2026-09-09), así que el defecto es otro. */
export const PUERTO = Number(process.env.CWEB_PORT ?? 8020);

/**
 * Dónde vive el log. Es la ÚNICA entrada de este servidor: sin ella no hay nada
 * que servir, y adivinarla sería el antipatrón de la R4.
 * @returns {{ raiz: string } | { error: string }}
 */
export function raizDatos(env = process.env, casa = homedir()) {
  if (env.DATA_DIR) {
    const raiz = resolve(env.DATA_DIR);
    return existsSync(raiz) ? { raiz } : { error: `DATA_DIR apunta a "${raiz}", que no existe.` };
  }

  // El DEFECTO DECLARADO (R2): el sitio de siempre en estas máquinas. Existe para
  // que un droplet recién lanzado traiga la web funcionando sin que nadie tenga
  // que acordarse de configurar una variable — «si para que algo esté hay que
  // acordarse de un flag, tarde o temprano no está».
  // ⚠ Sólo se usa si de verdad está ahí, y se ANUNCIA al arrancar: un defecto
  // silencioso que acierta es indistinguible de uno que falla.
  const porDefecto = join(casa, 'src', 'telegram-coordinator', 'data');
  if (existsSync(porDefecto)) return { raiz: porDefecto, porDefecto: true };

  // Y si tampoco está, se NIEGA en vez de servir un log vacío: eso se leería
  // como «no has hablado con claude nunca», que es lo mismo que se ve cuando el
  // log no se encuentra. Fallar a mitad no es una opción.
  return {
    error: 'No sé dónde está el log de mensajes.\n' +
      `  Miré en DATA_DIR (no está puesto) y en ${porDefecto} (no existe).\n` +
      '  Dímelo:      DATA_DIR=~/src/telegram-coordinator/data npm start\n' +
      '  O sin coordinador, con el fixture:\n' +
      '               DATA_DIR=./tests/fixtures npm start',
  };
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
        coordinador: leerLatido(raiz),
      });
    }

    if (url.pathname === '/api/sesiones') {
      const latido = leerLatido(raiz);
      return json(res, 200, {
        // El estado del coordinador va en la MISMA respuesta que la lista: si
        // fueran dos llamadas, la pantalla podría pintar conversaciones sin
        // saber todavía si el bot está vivo, que es justo lo que hay que decir
        // antes de que el usuario crea que claude no le contesta.
        coordinador: latido,
        sesiones: listarSesiones(raiz)
          .map((s) => ({ ...s, pendiente: Boolean(latido.turnos[s.sesion]) })),
      });
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

    // Todo lo que no sea `/api/` es la app. Se sirve desde `web/`.
    if (!url.pathname.startsWith('/api/')) return estatico(res, url.pathname);

    json(res, 404, { error: `No existe ${url.pathname}` });
  });
}

/**
 * Sirve un fichero de `web/`.
 *
 * ⚠ El freno contra `../`: se normaliza la ruta y se comprueba que el resultado
 * sigue DENTRO de `web/`. No basta con quitar `..` a mano —hay demasiadas formas
 * de escribirlo— así que se compara la ruta ya resuelta, que es un hecho y no una
 * heurística (R16). Y sólo se sirven extensiones conocidas: sin esa lista, un
 * `.env` que alguien deje ahí por error se serviría con un 200.
 */
function estatico(res, ruta) {
  const rel = normalize(decodeURIComponent(ruta)).replace(/^(\.\.[/\\])+/, '');
  const f = ruta === '/' ? join(WEB, 'index.html') : join(WEB, rel);
  const dentro = resolve(f).startsWith(WEB + '/') || resolve(f) === join(WEB, 'index.html');
  const tipo = TIPOS[extname(f)];

  if (!dentro || !tipo || !existsSync(f) || !statSync(f).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('No existe');
  }
  const cuerpo = readFileSync(f);
  res.writeHead(200, {
    'content-type': tipo,
    'content-length': cuerpo.length,
    // El vendor lleva su versión en el nombre del paquete, no en la URL, así que
    // no se cachea: un armazón viejo servido desde caché es indistinguible de un
    // servidor caído, y este proyecto se despliega con `git pull` + reiniciar.
    'cache-control': 'no-store',
  });
  res.end(cuerpo);
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
    if (r.porDefecto) console.log('   (nadie me dijo DATA_DIR: uso el sitio de siempre)');
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
