// Gobernar la web de lectura desde Telegram: dónde está, si corre, arrancarla y
// pararla. Es el equivalente de `foveal-vision/scripts/web_app.py` para esta app,
// y existe por la regla 4 de escritura del coordinador: **un comando nuevo no
// está terminado hasta que se puede invocar desde el móvil**.
//
// Uso:  node scripts/cweb.mjs [estado|url|arrancar|parar|instalar|log]
//
// ⚠ Este script NO decide dónde escucha el servidor: eso está en
// `server/index.mjs`, y depende de si hay token (ver `server/puerta.mjs`).
// Aquí se enciende, se apaga, y se pide el enlace.

import { execFileSync, execSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { token as tokenDeLaPuerta, FICHERO_TOKEN, conEnvDelRepo } from '../server/puerta.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UNIDAD = 'claude-web';
// ⚠ El entorno MÁS el `.env` del repo, que es donde el lanzador deja lo suyo
// (`CWEB_TOKEN`). Sin leerlo, un token puesto por el lanzador no se vería.
const ENV = conEnvDelRepo(RAIZ);
const PUERTO = ENV.CWEB_PORT ?? '8020';

/** El `data/` del coordinador: de dónde sale el log que esta web lee.
 *  Se DECLARA con `CWEB_DATA_DIR`; el defecto es el sitio de siempre, y si no
 *  está, se dice — nunca se sirve un log vacío como si no hubiera conversaciones. */
const DATOS = process.env.CWEB_DATA_DIR
  || join(process.env.COORD_HOME || join(homedir(), 'src', 'telegram-coordinator'), 'data');

const sh = (cmd) => { try { return execSync(cmd, { encoding: 'utf8', timeout: 20000 }).trim(); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };
const activo = () => sh(`systemctl is-active ${UNIDAD}`) === 'active';

/** ¿Contesta la app? Se le pregunta a ELLA, no al puerto: un puerto abierto no
 *  significa que la app responda (decisión 3 de `cerrable.mjs`). */
function pregunta() {
  const r = sh(`curl -s --max-time 4 http://127.0.0.1:${PUERTO}/api/sesiones`);
  try { return JSON.parse(r).sesiones.length; } catch { return null; }
}

/** ⚠ Espera a que conteste antes de dar un veredicto. Sin esto, `arrancar`
 *  preguntaba en el mismo instante del `systemctl start` —antes de que el
 *  servidor terminara de escuchar— y decía «el puerto está abierto pero no
 *  contesta como ella», que se lee como ROTA cuando acababa de arrancar bien.
 *  Medido el 2026-09-09, en el primer arranque de este servicio. */
function esperaAQueConteste(segundos = 8) {
  for (let i = 0; i < segundos * 2; i++) {
    const n = pregunta();
    if (n !== null) return n;
    try { execFileSync('sleep', ['0.5']); } catch { /* da igual */ }
  }
  return null;
}

/**
 * Deja la máquina lista para que el móvil llegue: unidad, TOKEN y puerto abierto.
 *
 * ⚠⚠ LAS TRES VAN JUNTAS Y NO ES COMODIDAD. Pedirlas por separado es la forma de
 * que falte una y no se note: sin token no se ata nada público (y el móvil no
 * llega), y sin abrir el puerto tampoco llega aunque haya token. Que un paso sólo
 * funcione si alguien se acuerda del otro es lo que este proyecto lleva pagando
 * toda la semana.
 *
 * ⚠ Y el orden importa: PRIMERO el token, DESPUÉS el puerto. Al revés habría un
 * instante con el puerto abierto y sin puerta.
 */
function instalar() {
  const nuevoToken = process.argv.includes('--token-nuevo');
  if (nuevoToken) {
    // Rotar es borrar y volver a crear: el token vive en un fichero 0600.
    try { execFileSync('rm', ['-f', FICHERO_TOKEN]); } catch { /* no estaba */ }
  }
  const t = tokenDeLaPuerta({ env: ENV, raizRepo: RAIZ, crear: true });
  // ⚠ El token NO se imprime aquí: esto puede correr dentro del aprovisionamiento,
  // y lo que se imprime ahí acaba en el log del lanzador. Se pide con `url`.
  console.log(t ? `🔑 Puerta: ${nuevoToken ? 'token NUEVO creado' : 'token listo'} (no se imprime; pídelo con \`url\`)`
                : '❌ No pude crear el token: sin él la web sólo escuchará en loopback.');

  const unit = `[Unit]
Description=claude-web (la web de lectura de las conversaciones de c)
After=network-online.target

[Service]
Type=simple
User=${process.env.USER || 'deploy'}
WorkingDirectory=${RAIZ}
Environment=DATA_DIR=${DATOS}
Environment=CWEB_PORT=${PUERTO}
ExecStart=/usr/bin/env node server/index.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
  const destino = `/etc/systemd/system/${UNIDAD}.service`;
  try {
    execFileSync('sudo', ['-n', 'tee', destino], { input: unit, stdio: ['pipe', 'ignore', 'pipe'] });
    sh('sudo -n systemctl daemon-reload');
    sh(`sudo -n systemctl enable ${UNIDAD}`);
    console.log(`✅ Unidad instalada en ${destino}.`);
    // El puerto, DESPUÉS del token. Y se dice si no se pudo: una web que no se ve
    // desde el móvil y no explica por qué manda a depurar la app, que está bien.
    if (t) {
      const r = sh(`sudo -n ufw allow ${PUERTO}/tcp 2>&1`);
      console.log(/added|updated|existing/i.test(r)
        ? `🔓 Puerto ${PUERTO} abierto en ufw (con token en la puerta).`
        : `⚠ No pude abrir el puerto ${PUERTO} en ufw: ${r.split('\n')[0] || 'sin salida'}\n` +
          `   A mano:  sudo ufw allow ${PUERTO}/tcp`);
    }
    console.log('   Arráncala con: arrancar     · y pide el enlace con: url');
  } catch (e) {
    console.log(`❌ No pude instalar la unidad (¿sudo sin contraseña?): ${e.message}`);
    console.log('   El fichero que hace falta, para ponerlo a mano:\n');
    console.log(unit);
    return 1;
  }
  return 0;
}

function estado() {
  const viva = activo();
  const hayDatos = existsSync(join(DATOS, 'mensajes'));
  console.log(`web de lectura: ${viva ? '🟢 corriendo' : '🔴 parada'}   (unidad ${UNIDAD})`);
  const hayToken = Boolean(tokenDeLaPuerta({ env: ENV, raizRepo: RAIZ }));
  console.log(`puerto        : ${PUERTO}${hayToken ? ', abierto con token en la puerta' : ', SÓLO en 127.0.0.1 (no hay token)'}`);
  console.log(`puerta        : ${hayToken ? '🟢 hay token (`url` da el enlace)' : '🔴 SIN token — `instalar` lo crea'}`);
  console.log(`log que lee   : ${DATOS}${hayDatos ? '' : '  ⚠ todavía no tiene mensajes/'}`);
  if (viva) {
    const n = esperaAQueConteste();
    console.log(n === null
      ? 'conversaciones: ⚠ el puerto está abierto pero no contesta como ella — mira `log`'
      : `conversaciones: ${n}`);
  }
  console.log('');
  console.log(url());
  return viva ? 0 : 1;
}

/**
 * La IP por la que se llega desde fuera.
 *
 * ⚠ Metadatos de DigitalOcean primero —es la respuesta correcta en un droplet, y
 * no depende de que nadie de fuera nos la diga— y la del socket como defecto. Es
 * el mismo orden que usa `foveal-vision/scripts/web_app.py`, y se copia a
 * propósito: dos formas distintas de contestar lo mismo divergen.
 */
function ipPublica() {
  const meta = sh('curl -s --max-time 2 ' +
    'http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address').trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(meta)) return meta;
  const local = sh("ip -4 route get 1.1.1.1 2>/dev/null | grep -oP 'src \\K[\\d.]+'").trim();
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(local) ? local : '';
}

/**
 * La dirección y sus avisos. UNA sola forma, y desde el 2026-09-12 UNA sola vía:
 * la IP pública con el token en la URL.
 *
 * ⚠⚠ CERO TAILSCALE desde ese día (decisión del dueño). Lo que había antes
 * —nombre de MagicDNS, `tailscale serve`, certificado— se fue por acumulación de
 * fallos que todos tenían la misma forma: **llegar dependía de algo que se pone
 * en otra parte** (que Let's Encrypt no te limite, que el nodo recupere su
 * nombre, que el móvil resuelva MagicDNS). Una IP y un token no dependen de nada
 * de eso.
 *
 * ⚠ Y NO se compone a ciegas: se COMPRUEBA que contesta 200 con el token antes de
 * darla. Dar una dirección sin probarla es lo que este fichero lleva cuatro
 * fallos evitando.
 */
function direccionActual() {
  const t = tokenDeLaPuerta({ env: ENV, raizRepo: RAIZ });
  if (!t) {
    return { direccion: null, avisos: [],
      motivo: 'no hay token, así que la web sólo escucha en loopback (`cweb instalar` lo crea)' };
  }
  const ip = ipPublica();
  if (!ip) {
    return { direccion: null, avisos: [],
      motivo: 'no pude averiguar la IP pública de esta máquina' };
  }
  const url = `http://${ip}:${PUERTO}/?t=${t}`;
  const code = sh(`curl -s -o /dev/null -w '%{http_code}' --max-time 5 '${url}'`).trim();
  if (code !== '200') {
    return { direccion: null, avisos: [],
      motivo: `la web no contesta por ${ip}:${PUERTO} (dio "${code || 'nada'}"): ` +
        `¿está arrancada y abierto el puerto? \`cweb instalar\` hace las dos cosas` };
  }
  return { direccion: url, avisos: [], motivo: '' };
}

/**
 * La dirección, redactada para un humano.
 *
 * ⚠⚠ LLEVA EL TOKEN DENTRO, y eso hay que decirlo cada vez: esa URL **es la
 * llave**. Quien la tenga entra, y por ese puerto se llega a una máquina donde
 * `claude` corre con `bypassPermissions`. No es una dirección más.
 */
function url() {
  const { direccion, motivo } = direccionActual();
  if (!direccion) {
    return 'Desde el móvil: todavía NO se puede llegar.\n' +
      `  Por qué: ${motivo}.\n` +
      `  Por túnel SSH mientras tanto:  ssh -L ${PUERTO}:127.0.0.1:${PUERTO} <esta-máquina>`;
  }
  return `Desde el móvil, sin ninguna app y sin VPN:\n  ${direccion}\n\n` +
    '⚠ Esa URL LLEVA LA LLAVE dentro. Quien la tenga entra a esta máquina: no la\n' +
    '  reenvíes, y si se te escapa, cámbiala con `cweb instalar --token-nuevo`.';
}

const orden = (process.argv[2] || '').trim().toLowerCase() || 'estado';
switch (orden) {
  case 'estado': process.exit(estado());
  case 'url': {
    // ⚠⚠ `--plano` ES EL CONTRATO CON EL LANZADOR, y existe por lo del
    // 2026-09-12: `url_de_servicio()` se queda con *la última línea no vacía que
    // contenga `://`*, y el texto de arriba acaba a veces en el comando que
    // arregla el serve — que lleva un `http://127.0.0.1:8020` dentro. `launch`
    // anunciaba esa orden de shell como si fuera el link.
    //
    // Aquí se imprime UNA línea y nada más, o NADA y se sale con 1. Así el
    // contrato no puede confundirse aunque el otro lado no cambie: no hay
    // segunda línea que malinterpretar. La explicación va por stderr, que es de
    // donde el lanzador saca su pista sin mezclarla con la respuesta.
    if (process.argv.includes('--plano')) {
      const { direccion, motivo } = direccionActual();
      if (!direccion) {
        console.error(`sin dirección: ${motivo || 'no la sé'}`);
        process.exit(1);
      }
      console.log(direccion);
      break;
    }
    console.log(url());
    break;
  }
  case 'instalar': process.exit(instalar());
  case 'arrancar': console.log(sh(`sudo -n systemctl start ${UNIDAD}`) || '▶️ arrancada'); estado(); break;
  case 'parar': console.log(sh(`sudo -n systemctl stop ${UNIDAD}`) || '⏹️ parada'); break;
  case 'log': console.log(sh(`journalctl -u ${UNIDAD} -n 40 -o cat --no-pager`)); break;
  default:
    // ⚠ El último caso SE NIEGA, nunca es una acción por defecto: así es como se
    // acaba corriendo lo que nadie pidió (medido el 2026-09-08 en otro lanzador).
    console.log(`No sé qué es "${orden}".\nÓrdenes: estado · url · arrancar · parar · instalar · log`);
    process.exit(2);
}
