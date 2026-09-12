// El servidor de la web de lectura.
//
// Qué es y qué NO es
// ------------------
// Un `node:http` sin dependencias que lee `data/mensajes/*.jsonl` —el log que
// escribe el coordinador— y lo sirve. **No escribe en ese log** y **no ejecuta
// nada**: en la fase 2 es sólo lectura. El contrato del formato vive donde su
// productor, en `telegram-coordinator/docs/log-de-mensajes.md`.
//
// ⚠⚠ NUNCA ATA UN COMODÍN, Y ESO ES EL FRENO. Quien alcance este puerto llega al
// mismo sitio que un mensaje de Telegram —una máquina donde `claude` corre con
// `bypassPermissions`— y **la allowlist del bot no lo cubre**. Así que se ata a
// direcciones nombradas y comprobadas, nunca a `0.0.0.0` ni a `::`, que atarían
// también la IP **pública** del droplet. Hay tests que fallan si alguien lo
// cambia: una invariante que importa es un test, no una frase (R14).
//
// ⚠⚠ Y DESDE EL 2026-09-12 ATA TAMBIÉN LA IP DE LA TAILNET, no sólo loopback.
// El motivo está medido ese día: `tailscale serve` enruta **por la cabecera
// `Host`**, así que la app se veía por su nombre y **por IP daba 404**:
//
//     http://100.79.201.53:8080/          -> 404 page not found
//     http://dev.tail376e31.ts.net:8080/  -> 200
//
// O sea que llegar dependía de que el móvil resolviera MagicDNS, y cuando no lo
// hacía **no había ninguna dirección que funcionara** — ni por nombre ni por IP.
// Atándose a la IP de la tailnet hay una dirección que no depende del DNS de
// nadie, que es lo que el dueño pidió.
//
// ⚠ Y NO afloja el freno, que es lo primero que hay que comprobar al leer esto:
//   · la 100.x es de la tailnet (CGNAT, 100.64.0.0/10) y **no se enruta desde
//     Internet**; el conjunto de quien puede llegar es el mismo que ya podía por
//     `tailscale serve`, que lleva publicando en esa misma IP desde el principio.
//   · `tailscale` mete su propio `-A ts-input -i tailscale0 -j ACCEPT`, así que
//     esto no necesita abrir nada en `ufw` — y no se abre.
//   · lo único que se pierde son las cabeceras de identidad que pone `serve`, y
//     **esta app no las lee** (comprobado el 2026-09-12: no aparecen en
//     `server/` ni en `web/`).
// Lo que sigue prohibido, y ahora con test, es el comodín.
//
// ⚠ Loopback se ata SIEMPRE, además: de ahí cuelgan la sonda de `cweb estado` y
// el túnel SSH de emergencia. Perder eso por ganar la IP sería cambiar un
// problema por otro.
//
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
 * La IP v4 de esta máquina en la tailnet, o null.
 *
 * ⚠ Se PREGUNTA a `tailscale`, no se deduce de las interfaces: la respuesta de
 * `tailscale ip -4` es el dato, y leer `ip addr` sería adivinar cuál de las
 * direcciones de la máquina es la buena. Si no hay tailscale, o tarda, no es un
 * fallo: es que todavía no hay (ver el reintento en `arrancar`).
 */
export function ipDeTailscale() {
  try {
    const out = execFileSync('tailscale', ['ip', '-4'], { encoding: 'utf8', timeout: 5000 });
    const ip = out.trim().split('\n')[0].trim();
    return ip || null;
  } catch { return null; }
}

export function bindAceptable(dir) {
  const d = String(dir ?? '').trim();
  if (d === '127.0.0.1' || d === '::1') return { ok: true, clase: 'loopback' };
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(d)) {
    return { ok: true, clase: 'tailnet' };
  }
  if (d === '' || d === '0.0.0.0' || d === '::' || d === '*') {
    return { ok: false, motivo: 'un comodín ataría también la IP PÚBLICA del droplet' };
  }
  return { ok: false, motivo: 'no es loopback ni de la tailnet (100.64.0.0/10)' };
}

/**
 * A qué direcciones se ata, dado el entorno y la IP que tenga la tailnet.
 *
 * `CWEB_BIND` (coma-separado) manda; si no, loopback + la de la tailnet.
 *
 * ⚠ Loopback NO se puede quitar ni con `CWEB_BIND`: es de donde cuelgan la sonda
 * de `cweb estado` y el túnel SSH, o sea la forma de mirar esto cuando lo demás
 * falla. Una salida de emergencia que se pueda desconfigurar no es una salida.
 *
 * ⚠ Y lo rechazado se DEVUELVE, no se traga: atarse a menos de lo que te
 * pidieron, en silencio, es la clase de fallo que se descubre desde el móvil.
 *
 * @returns {{escuchar: string[], rechazadas: {dir: string, motivo: string}[]}}
 */
export function direccionesDeEscucha({ env = {}, ipTailnet = null } = {}) {
  const pedidas = String(env.CWEB_BIND ?? '').split(',').map((d) => d.trim()).filter(Boolean);
  const candidatas = pedidas.length ? pedidas : [HOST, ...(ipTailnet ? [ipTailnet] : [])];

  const escuchar = [HOST];
  const rechazadas = [];
  for (const d of candidatas) {
    if (escuchar.includes(d)) continue;
    const v = bindAceptable(d);
    if (v.ok) escuchar.push(d);
    else rechazadas.push({ dir: d, motivo: v.motivo });
  }
  return { escuchar, rechazadas };
}

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
export function crearServidor(raiz, vigilante = crearVigilante(raiz)) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${HOST}`);

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

  const { escuchar, rechazadas } = direccionesDeEscucha({ env: process.env, ipTailnet: ipDeTailscale() });
  for (const { dir, motivo } of rechazadas) {
    console.error(`⚠ NO me ato a ${dir}: ${motivo}.`);
  }
  for (const host of escuchar) atar(host, host === HOST);

  if (r.porDefecto) console.log('   (nadie me dijo DATA_DIR: uso el sitio de siempre)');
  if (escuchar.length === 1) {
    // ⚠⚠ Y SE REINTENTA, porque esto es una CARRERA de arranque y no un fallo.
    // La unidad puede levantarse antes que `tailscaled`, y entonces no hay IP de
    // tailnet que atar — la app quedaría sólo en loopback hasta que alguien la
    // reiniciara a mano, que es justo el tipo de cosa que nadie hace en un dev
    // recién nacido. Se mira cada 10 s durante 5 min y se ata en cuanto aparece.
    let quedan = 30;
    const espera = setInterval(() => {
      const ip = ipDeTailscale();
      if (ip && bindAceptable(ip).ok) {
        clearInterval(espera);
        console.log(`   (tailscale tardó en levantar: me ato también a ${ip})`);
        atar(ip, false);
      } else if (--quedan <= 0) {
        clearInterval(espera);
        console.log('   Sin IP de tailnet tras 5 min: sólo loopback. Desde fuera, `tailscale serve` o un túnel SSH.');
      }
    }, 10_000);
    espera.unref();
  }

  return servidores[0];
}

// Sólo arranca si se ejecuta directamente, nunca al importarlo desde un test.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) arrancar();
