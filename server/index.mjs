// El servidor de la web de lectura.
//
// Qué es y qué NO es
// ------------------
// Un `node:http` sin dependencias que lee `data/mensajes/*.jsonl` —el log que
// escribe el coordinador— y lo sirve. **No escribe en ese log** y **no ejecuta
// nada**: en la fase 2 es sólo lectura. El contrato del formato vive donde su
// productor, en `telegram-coordinator/docs/log-de-mensajes.md`.
//
// ⚠⚠ SE ATA A UN PUERTO PÚBLICO SI Y SÓLO SI HAY TOKEN. Ésa es la invariante, y
// desde el 2026-09-12 sustituye a la de antes («sólo loopback»).
//
// Qué cambió: el dueño decidió **cero Tailscale**. Sin Tailscale y sin túnel, la
// única forma de que su móvil llegue es el puerto público del droplet — y por ese
// puerto se llega al mismo sitio que un mensaje de Telegram, una máquina donde
// `claude` corre con `bypassPermissions`, **sin la allowlist del bot**.
//
// Así que **la exposición y la puerta son la misma decisión** y viven juntas: sin
// token no se ata nada público, se dice en voz alta y se queda en loopback.
// Separarlas sería permitir que una llegue sin la otra, que es exactamente cómo
// se queda algo abierto sin que nadie lo decida. La puerta está en
// `server/puerta.mjs`, con su porqué.
//
// ⚠ Loopback NO necesita token: quien ya está dentro de la máquina está dentro.
// De ahí cuelgan la sonda de `cweb estado` y el túnel SSH de emergencia.
//
// ⚠ El token viaja en claro, porque no hay TLS. Es el mismo trato que ya se
// aceptó para `foveal-vision-web` en esta flota, y va escrito en el README para
// que sea una decisión y no un descuido.
// ⚠ Y NO deduce dónde está el log: se lo tienen que decir con `DATA_DIR` (R4).
// Que el coordinador esté «al lado» es una coincidencia del sistema de ficheros,
// no un contrato — y aquí además puede estar en otra máquina. Si no se lo dicen,
// **se niega antes de empezar** en vez de servir un log vacío que se leería como
// «no has hablado con claude nunca» (R2: o degrada con un defecto declarado, o
// falla antes de empezar; fallar a mitad no es una opción).

import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { listarSesiones, leerMensajes, leerLatido, encolarEnvio, ejecutorDe, PAGINA } from './datos.mjs';
import { crearVigilante } from './eventos.mjs';
import { autorizado, cookieDe, COOKIE, esLocal, token } from './puerta.mjs';

/** ⚠ NO se toca sin leer la cabecera. Ver `tests/servidor.test.mjs`. */
export const HOST = '127.0.0.1';

/**
 * ¿Es una dirección a la que este servidor puede atarse?
 *
 * ⚠ El freno de verdad, y por eso es una lista de lo que SÍ vale y no de lo que
 * no: una lista negra deja pasar lo que nadie pensó. Loopback (de ahí cuelgan la
 * sonda y el túnel SSH) y la tailnet (CGNAT 100.64.0.0/10, no enrutable desde
 * Internet). Todo lo demás se rechaza, empezando por los comodines.
 */
/**
 * ¿Puede este servidor atarse a esta dirección?
 *
 * ⚠⚠ Todo depende de `hayToken`, y por eso es un argumento y no una lectura de
 * dentro: la decisión «se expone» no puede tomarse en un sitio y comprobarse en
 * otro. Sin token, sólo loopback; con token, cualquier dirección de la máquina,
 * porque entonces hay una puerta.
 */
export function bindAceptable(dir, { hayToken = false } = {}) {
  const d = String(dir ?? '').trim();
  if (d === '127.0.0.1' || d === '::1') return { ok: true, clase: 'loopback' };
  if (d === '') return { ok: false, motivo: 'dirección vacía' };
  if (!hayToken) {
    return { ok: false,
      motivo: 'NO hay token en esta máquina, y sin puerta no se abre un puerto por ' +
        'el que se llega a un shell. Créalo con: cweb instalar' };
  }
  if (d === '0.0.0.0' || d === '::' || d === '*') return { ok: true, clase: 'comodín' };
  return { ok: true, clase: 'nombrada' };
}

/**
 * A qué direcciones se ata, dado el entorno y si hay token.
 *
 * Por defecto: **el comodín si hay token** —es lo que hace que se vea desde el
 * móvil por la IP pública, lo único que queda sin Tailscale— y **sólo loopback si
 * no lo hay**.
 *
 * ⚠ Un comodín ya cubre loopback, así que cuando está no se añade aparte: atar
 * `127.0.0.1:<puerto>` después de `0.0.0.0:<puerto>` da `EADDRINUSE`, y eso se
 * leería como «el puerto está ocupado» cuando lo ocupa uno mismo.
 *
 * ⚠ Y lo rechazado se DEVUELVE, no se traga: atarse a menos de lo que te pidieron,
 * en silencio, es la clase de fallo que se descubre desde el móvil.
 *
 * @returns {{escuchar: string[], rechazadas: {dir: string, motivo: string}[]}}
 */
export function direccionesDeEscucha({ env = {}, hayToken = false } = {}) {
  const pedidas = String(env.CWEB_BIND ?? '').split(',').map((d) => d.trim()).filter(Boolean);
  const candidatas = pedidas.length ? pedidas : (hayToken ? ['0.0.0.0'] : [HOST]);

  const escuchar = [];
  const rechazadas = [];
  for (const d of candidatas) {
    if (escuchar.includes(d)) continue;
    const v = bindAceptable(d, { hayToken });
    if (v.ok) escuchar.push(d);
    else rechazadas.push({ dir: d, motivo: v.motivo });
  }

  const hayComodin = escuchar.some((d) => ['0.0.0.0', '::', '*'].includes(d));
  if (!hayComodin && !escuchar.includes(HOST)) escuchar.unshift(HOST);

  return { escuchar, rechazadas };
}

/** La raíz de los estáticos, deducida de dónde vive este fichero. Aquí SÍ vale
 *  deducir: `web/` viaja en este mismo repo, así que no es un acoplamiento entre
 *  piezas — es la pieza. Lo que no se deduce nunca es dónde está el log (R4). */
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');
/** La raíz del repo: donde el lanzador deja el `.env` con `CWEB_TOKEN`. */
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
/**
 * El token vigente, releído del disco como mucho cada 5 s.
 *
 * ⚠ La caché y su regla de caducidad van juntas (regla 3 de escritura): esto se
 * llama en CADA petición —y el flujo de eventos hace muchas—, así que sin caché
 * se lee el disco todo el rato; con caché eterna, crear el token exigiría
 * reiniciar y `cweb instalar` ya reinicia, pero un token puesto a mano en el
 * `.env` no se vería nunca.
 */
let _tok = { valor: null, cuando: 0 };
function tokenVigente() {
  const ahora = Date.now();
  if (_tok.valor === null || ahora - _tok.cuando > 5000) {
    _tok = { valor: token({ env: process.env, raizRepo: RAIZ }), cuando: ahora };
  }
  return _tok.valor;
}

export function crearServidor(raiz, vigilante = crearVigilante(raiz)) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${HOST}`);

    // ─── LA PUERTA ───────────────────────────────────────────────────────────
    // Va LO PRIMERO, antes de cualquier ruta: nada se sirve sin pasar por aquí,
    // ni un estático. Un guardián que hay que acordarse de llamar en cada ruta
    // nueva no es un guardián. Ver `server/puerta.mjs` para el porqué.
    const permiso = autorizado({
      local: esLocal(req.socket?.localAddress),
      consulta: url.searchParams.get('t') || '',
      cookies: req.headers.cookie || '',
      tokenBueno: tokenVigente(),
    });
    if (!permiso.ok) {
      // ⚠ El mismo 401 para «token malo» y «no hay token»: el motivo detallado va
      // al log de la unidad, no al que llama. Decirle a quien no ha entrado por
      // qué no ha entrado es enseñarle cómo entrar.
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      return res.end('401 — hace falta el token. Pídelo por Telegram: /use cweb → url\n');
    }
    if (permiso.via === 'query') {
      // La cookie es lo que hace que las llamadas a `/api/…` de después entren sin
      // arrastrar el token en cada URL. `HttpOnly` para que no la lea un script;
      // sin `Secure` porque no hay TLS, y fingirlo rompería la cookie entera.
      res.setHeader('Set-Cookie',
        `${COOKIE}=${url.searchParams.get('t')}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (url.pathname === '/api/eventos') return vigilante.suscribir(req, res);

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
        sesiones: listarSesiones(raiz).map((s) => ({
          ...s,
          pendiente: Boolean(latido.turnos[s.sesion]),
          // Qué ejecutor lo atiende: lo que escribas aquí va a ÉSE, no a `c`
          // siempre. Enseñarlo es la diferencia entre un dato y algo que
          // recordar.
          ejecutor: ejecutorDe(raiz, s.sesion),
        })),
      });
    }

    // El id lleva `_` y puede empezar por `-` (los chats de grupo son negativos),
    // así que se casa explícito y no con un `split('/')`.
    // ⚠ No hace falta defenderse del `..`: `datos.mjs` sanea el id para formar el
    // nombre del fichero y ahí una `/` se convierte en `_`, así que no hay forma
    // de salir de `mensajes/`. Tiene test, porque «no hace falta» envejece mal.
    const m = url.pathname.match(/^\/api\/sesiones\/([^/]+)\/mensajes$/);

    if (m && req.method === 'POST') {
      let crudo = '';
      req.on('data', (d) => {
        crudo += d;
        // Se corta pronto: sin esto, un POST enorme se lee entero en memoria
        // antes de poder rechazarlo.
        if (crudo.length > 200_000) { req.destroy(); }
      });
      req.on('end', () => {
        let texto;
        try { texto = JSON.parse(crudo).texto; } catch { return json(res, 400, { error: 'JSON inválido' }); }
        const r = encolarEnvio(raiz, decodeURIComponent(m[1]), texto);
        if (r.error) return json(res, 400, r);
        // 202 y no 200: el turno NO ha corrido todavía. Puede tardar minutos
        // —`c` no tiene timeout— así que dejar la petición HTTP colgada esperando
        // sería quedarse sin respuesta justo cuando más tarda. Lo que pase se ve
        // por el SSE, como todo lo demás.
        json(res, 202, { ...r, aviso: 'encolado: el coordinador lo atiende enseguida' });
      });
      return;
    }

    if (m) {
      const limite = Math.min(Number(url.searchParams.get('limite')) || PAGINA, 500);
      const sesion = decodeURIComponent(m[1]);
      return json(res, 200, {
        ejecutor: ejecutorDe(raiz, sesion),
        ...leerMensajes(raiz, sesion, {
          desde: url.searchParams.get('desde'),
          limite,
        }),
      });
    }

    // Todo lo que no sea `/api/` es la app. Se sirve desde `web/`.
    if (!url.pathname.startsWith('/api/')) return estatico(res, url.pathname);

    json(res, 404, { error: `No existe ${url.pathname}` });
  });

  // Al cerrar el servidor se para el vigilante y se sueltan los clientes SSE: si
  // no, `close()` no termina nunca porque quedan sockets abiertos.
  server.on('close', () => vigilante.parar());
  server.vigilante = vigilante;
  return server;
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
  // Un vigilante para TODOS los listeners: mira el mismo disco, y dos vigilantes
  // serían dos watchers y dos sondeos sobre lo mismo.
  const vigilante = crearVigilante(r.raiz);
  const servidores = [];

  /** Ata una dirección. Nunca tumba el proceso: con loopback vivo la app sirve. */
  const atar = (host, obligatoria) => {
    const server = crearServidor(r.raiz, vigilante);
    server.on('error', (e) => {
      console.error(`❌ No pude atar ${host}:${PUERTO}: ${e.message}`);
      if (e.code === 'EADDRINUSE') console.error(`   Ese puerto ya está ocupado. Prueba CWEB_PORT=<otro>.`);
      // ⚠ Sólo loopback es motivo para rendirse: sin él no hay ni sonda ni túnel
      // SSH, o sea ninguna forma de mirar esto. Que falle la de la tailnet deja
      // la app EN PIE y se dice; tumbarla sería cambiar «no llego desde el móvil»
      // por «no hay app».
      if (obligatoria) process.exit(1);
    });
    server.listen(PUERTO, host, () => {
      console.log(`🌐 Web de lectura en http://${host}:${PUERTO}  (log: ${r.raiz})`);
    });
    servidores.push(server);
    return server;
  };

  // ⚠⚠ EL TOKEN SE CREA AQUÍ SI FALTA, Y ESO ES UNA DECISIÓN DEL DUEÑO
  // (2026-09-15: «el token se crea nuevo siempre»).
  //
  // Antes esto era `token(...)` a secas: sin token, loopback y a esperar a que
  // alguien corriera `cweb instalar`. El problema es que eso convierte «llegar
  // desde el móvil» en algo que depende de que un paso del aprovisionamiento
  // haya corrido — y el 2026-09-15 no corrió (o falló sin dejar rastro: el log
  // de provisión no sobrevive), así que el dev nació atado a loopback y ningún
  // mando lo arreglaba. Creándolo aquí, el arranque es el único momento que
  // decide, y no puede llegar sin token.
  //
  // ⚠ Esto NO afloja la puerta, que es lo que habría que mirar antes de tocarlo:
  // la invariante sigue siendo «puerto público SI Y SÓLO SI hay token», y lo que
  // cambia es que el token ya no puede faltar. Quien quiera la máquina cerrada
  // de verdad tiene el cortafuegos, que es el freno que sí decide quién llega.
  //
  // ⚠ Y `crear` sólo aquí: `tokenVigente()` (cada petición) y `cweb url`/`estado`
  // siguen SIN crear nada. Quien pregunta no puede cambiar la respuesta.
  const habiaToken = Boolean(token({ env: process.env, raizRepo: RAIZ }));
  const hayToken = Boolean(token({ env: process.env, raizRepo: RAIZ, crear: true }));
  const { escuchar, rechazadas } = direccionesDeEscucha({ env: process.env, hayToken });

  for (const { dir, motivo } of rechazadas) {
    console.error(`⚠⚠ NO me ato a ${dir}: ${motivo}`);
  }
  for (const host of escuchar) atar(host, escuchar.length === 1 || host === HOST);

  if (r.porDefecto) console.log('   (nadie me dijo DATA_DIR: uso el sitio de siempre)');
  if (hayToken) {
    // ⚠ El token NO se imprime, ni aquí ni en un error: el log de esta unidad lo
    // lee `cweb log` desde Telegram. La URL con el token la da `cweb url`, que es
    // un comando que se pide, no algo que quede escrito en un journal.
    // ⚠ El token NO se imprime, ni aquí ni en un error: el log de esta unidad lo
    // lee `cweb log` desde Telegram. Se dice que se ha creado, no cuál es.
    if (!habiaToken) console.log('   🔑 No había token: he creado uno nuevo para esta máquina.');
    console.log('   Puerta: hace falta el token (`?t=…`) salvo desde 127.0.0.1.');
    console.log('   La URL para el móvil:  node scripts/cweb.mjs url');
  } else {
    // Sólo se llega aquí si el token no se pudo ni crear (disco lleno, HOME sin
    // permiso). Es un fallo de verdad, y por eso lo dice como tal.
    console.log('   ❌ SIN token y no he podido crear uno: sólo escucho en loopback.');
    console.log('   Mira si se puede escribir en ~/.config/  y luego:  node scripts/cweb.mjs instalar');
  }

  return servidores[0];
}

// Sólo arranca si se ejecuta directamente, nunca al importarlo desde un test.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) arrancar();
