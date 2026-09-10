// Poner la web detrás de `tailscale serve`, en cuanto el nodo esté conectado.
//
// Por qué es un script commiteado y no un comando tecleado: tecleado no deja
// rastro de QUÉ se lanzó, y esto hay que repetirlo **cada vez que se rehaga el
// dev**. Commiteado, «¿cómo se puso?» es una pregunta con respuesta.
//
// ⚠⚠ EL PUERTO ES 8443 Y NO 443, Y NO ES UN CAPRICHO. En esta máquina `sshd`
// escucha en `0.0.0.0:443` —o sea también en la interfaz de la tailnet—, así que
// `--https=443` chocaría. Medido el 2026-09-09 y confirmado el 2026-09-10.
// Se elige mover ESTO y no `sshd`: tocar el puerto por el que se entra a la
// máquina, desde dentro de la máquina, es la clase de cambio que te deja fuera.
// El precio es que la URL lleva `:8443`, y no impide nada — un origen con puerto
// sigue siendo contexto seguro, así que la PWA se instala igual.
//
// Uso:  node scripts/tailscale-serve.mjs [--esperar <minutos>]

import { execFileSync, execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PUERTO_WEB = process.env.CWEB_PORT ?? '8020';
const PUERTO_TS = process.env.CWEB_PUERTO_TS ?? '8443';
const COORD = process.env.COORD_HOME || join(homedir(), 'src', 'telegram-coordinator');
const i = process.argv.indexOf('--esperar');
const MINUTOS = i >= 0 ? Number(process.argv[i + 1]) : 30;

const sh = (cmd) => {
  try { return { ok: true, out: execSync(cmd, { encoding: 'utf8', timeout: 30000 }).trim() }; }
  catch (e) { return { ok: false, out: ((e.stdout || '') + (e.stderr || '')).trim() }; }
};

/** Avisa por Telegram. Nunca puede tumbar esto: es una comodidad. */
function avisar(texto) {
  try {
    execFileSync(process.execPath, [join(COORD, 'scripts', 'notify.mjs')],
      { input: texto, timeout: 30000, stdio: ['pipe', 'ignore', 'ignore'] });
  } catch { /* el log de esta unidad sigue siendo la fuente de verdad */ }
}

/** El nombre DNS del nodo, o null si aún no ha entrado en la tailnet. */
function nombreDelNodo() {
  const r = sh('tailscale status --json');
  if (!r.ok) return null;
  try {
    const s = JSON.parse(r.out);
    if (s.BackendState !== 'Running') return null;
    return s.Self?.DNSName?.replace(/\.$/, '') || null;
  } catch { return null; }
}

console.log(`[serve] esperando a que el nodo entre en la tailnet (hasta ${MINUTOS} min)…`);
let nombre = null;
for (let s = 0; s < MINUTOS * 60; s += 5) {
  nombre = nombreDelNodo();
  if (nombre) break;
  execFileSync('sleep', ['5']);
}

if (!nombre) {
  const m = `⏳ Tailscale: el server sigue SIN autorizar tras ${MINUTOS} min.\n` +
    'El enlace de login caduca; para sacar uno nuevo: `sudo tailscale up --hostname=dev`.';
  console.error(m);
  avisar(m);
  process.exit(0);   // ⚠ 0 siempre: esto corre como unidad y un fallo al final sería un BUCLE
}

console.log(`[serve] nodo conectado: ${nombre}`);

// ⚠ `--bg` para que la configuración quede puesta y sobreviva a este proceso:
// `tailscale serve` sin él se queda en primer plano y al morir deja de servir.
const r = sh(`sudo -n tailscale serve --bg --https=${PUERTO_TS} http://127.0.0.1:${PUERTO_WEB}`);
if (!r.ok) {
  // ⚠ Tailscale ya imprime el enlace EXACTO para dar el permiso que falta, con el
  // id de este nodo dentro. Repetirlo con palabras propias («ve a DNS → Enable
  // HTTPS») obliga a buscarlo a mano y además puede envejecer mal si cambian su
  // consola. Se pasa el suyo tal cual; la explicación sólo acompaña.
  const enlace = (r.out.match(/https:\/\/login\.tailscale\.com\/\S+/) || [])[0];
  const pistaHttps = enlace
    ? `\n\n👉 Falta un permiso en tu tailnet, y es un clic:\n${enlace}\n\n` +
      'Cuando lo des, vuelve a lanzarlo con:  /use cweb → tailscale'
    : '';
  const m = `❌ No pude poner la web detrás de Tailscale:\n${r.out.slice(-600)}${pistaHttps}`;
  console.error(m);
  avisar(m);
  process.exit(0);
}

// No se anuncia hasta comprobarlo: un puerto configurado no es una web que responda.
const prueba = sh(`curl -s --max-time 8 -o /dev/null -w '%{http_code}' https://${nombre}:${PUERTO_TS}/api/salud`);
const url = `https://${nombre}:${PUERTO_TS}/`;
const m = prueba.out === '200'
  ? `✅ La web de lectura ya se ve desde tu móvil (con Tailscale activo):\n\n${url}\n\n` +
    'Ábrela y dale a «Añadir a pantalla de inicio» para instalarla.'
  : `⚠ Tailscale ya sirve la web en ${url}, pero al probarla me contestó ` +
    `"${prueba.out || 'nada'}" en vez de 200. Mira \`cweb log\`.`;
console.log(m);
avisar(m);
