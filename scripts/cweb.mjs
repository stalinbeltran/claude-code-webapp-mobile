// Gobernar la web de lectura desde Telegram: dónde está, si corre, arrancarla y
// pararla. Es el equivalente de `foveal-vision/scripts/web_app.py` para esta app,
// y existe por la regla 4 de escritura del coordinador: **un comando nuevo no
// está terminado hasta que se puede invocar desde el móvil**.
//
// Uso:  node scripts/cweb.mjs [estado|url|arrancar|parar|instalar|log]
//
// ⚠ Este script NO decide dónde escucha el servidor: eso está en
// `server/index.mjs` y es 127.0.0.1 siempre. Aquí sólo se enciende y se apaga.

import { execFileSync, execSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UNIDAD = 'claude-web';
const PUERTO = process.env.CWEB_PORT ?? '8020';

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

function instalar() {
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
    console.log(`✅ Unidad instalada en ${destino}. Arráncala con: arrancar`);
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
  console.log(`puerto        : ${PUERTO}, sólo en 127.0.0.1`);
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

function url() {
  const ts = sh('tailscale status --json 2>/dev/null');
  if (ts.startsWith('{')) {
    try {
      const nombre = JSON.parse(ts).Self?.DNSName?.replace(/\.$/, '');
      if (nombre) return `Desde el móvil (con Tailscale activo):\n  https://${nombre}/`;
    } catch { /* se cae al mensaje de abajo */ }
  }
  return 'Desde el móvil: todavía NO se puede llegar.\n' +
    '  Escucha sólo en loopback a propósito (quien alcance este puerto tiene\n' +
    '  shell en esta máquina). Falta Tailscale: ver docs/decisiones.md, P3.\n' +
    `  Mientras tanto, por túnel SSH:  ssh -L ${PUERTO}:127.0.0.1:${PUERTO} <esta-máquina>`;
}

const orden = (process.argv[2] || '').trim().toLowerCase() || 'estado';
switch (orden) {
  case 'estado': process.exit(estado());
  case 'url': console.log(url()); break;
  case 'instalar': process.exit(instalar());
  case 'arrancar': console.log(sh(`sudo -n systemctl start ${UNIDAD}`) || '▶️ arrancada'); estado(); break;
  case 'parar': console.log(sh(`sudo -n systemctl stop ${UNIDAD}`) || '⏹️ parada'); break;
  case 'log': console.log(sh(`journalctl -u ${UNIDAD} -n 40 -o cat --no-pager`)); break;
  case 'tailscale': {
    // Relanza el configurador. Hace falta poder hacerlo DESDE TELEGRAM: la
    // primera vez suele faltar un permiso en la tailnet, y quien lo da está en
    // el móvil, no delante de la máquina.
    const r = sh(`sudo -n systemctl start ts-serve 2>&1; sleep 8; tail -12 /tmp/ts-serve.log`);
    console.log(r || '(sin salida: mira `systemctl status ts-serve`)');
    break;
  }
  default:
    // ⚠ El último caso SE NIEGA, nunca es una acción por defecto: así es como se
    // acaba corriendo lo que nadie pidió (medido el 2026-09-08 en otro lanzador).
    console.log(`No sé qué es "${orden}".\nÓrdenes: estado · url · arrancar · parar · instalar · log · tailscale`);
    process.exit(2);
}
