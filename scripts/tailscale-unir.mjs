// Dejar esta máquina lista para servir la web por Tailscale: instalar, unir el
// nodo y poner el `serve`. Lo corre el `install` del servicio, o sea el
// aprovisionamiento de un dev nuevo.
//
// Por qué existe
// -------------
// Sin esto, cada vez que se rehace el dev hay que repetir a mano: instalar
// Tailscale, autorizar el nodo por un enlace, y configurar el proxy. Y lo peor no
// es el trabajo: es que **el nodo entraría con otro nombre**. Tailscale le pone
// `dev-1` si `dev` sigue ocupado, y entonces la URL guardada en el móvil —la de
// la PWA instalada— deja de resolver, sin decir por qué.
//
// ⚠⚠ LA AUTHKEY NO SE IMPRIME NUNCA. Ni en un `echo`, ni en un error, ni en el
// log de la unidad. Este proyecto ya filtró un token una vez; y `sudo` escribe en
// el journal lo que le pasas, así que la clave va por el ENTORNO del proceso.
//
// ⚠ Y NO ABORTA si falta la authkey. Corre dentro del aprovisionamiento: hacer
// fallar todo el `install` porque falte una clave dejaría el droplet a medias por
// algo que se arregla en un minuto. Se dice qué falta y se sigue (R2: degradar
// con un defecto declarado, no fallar a mitad).

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { avisoDeDeriva, nombreCorto } from './nodo.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOMBRE = process.env.CWEB_HOSTNAME ?? 'dev';
const PUERTO_WEB = process.env.CWEB_PORT ?? '8020';
// ⚠ 8443 y no 443: `sshd` escucha en `0.0.0.0:443` en estas máquinas, o sea
// también en la interfaz de la tailnet. Se mueve esto, no `sshd`.
const PUERTO_TS = process.env.CWEB_PUERTO_TS ?? '8443';
const SECO = process.argv.includes('--seco');

/** Avisa por Telegram. ⚠ NUNCA puede tumbar esto: es una comodidad, y este
 *  script corre dentro del aprovisionamiento (regla del coordinador: si el aviso
 *  puede matar el trabajo, ya no es una comodidad). */
function avisar(texto) {
  try {
    const COORD = process.env.COORD_HOME || join(process.env.HOME || '', 'src', 'telegram-coordinator');
    execFileSync(process.execPath, [join(COORD, 'scripts', 'notify.mjs')],
      { input: texto, timeout: 30_000, stdio: ['pipe', 'ignore', 'ignore'] });
  } catch { /* el log de esta unidad sigue siendo la fuente de verdad */ }
}

const sh = (cmd, env) => {
  try { return { ok: true, out: execSync(cmd, { encoding: 'utf8', timeout: 180_000, env: env ?? process.env }).trim() }; }
  catch (e) { return { ok: false, out: ((e.stdout || '') + (e.stderr || '')).trim() }; }
};

/** La authkey, del entorno o del `.env` del repo (donde la deja `env_prefix`). */
function authkey() {
  if (process.env.TS_AUTHKEY) return process.env.TS_AUTHKEY.trim();
  const f = join(RAIZ, '.env');
  if (!existsSync(f)) return '';
  const m = readFileSync(f, 'utf8').match(/^\s*TS_AUTHKEY\s*=\s*(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

const estado = () => {
  const r = sh('tailscale status --json 2>/dev/null');
  if (!r.ok || !r.out.startsWith('{')) return { instalado: existsSync('/usr/bin/tailscale'), dentro: false };
  try {
    const s = JSON.parse(r.out);
    return { instalado: true, dentro: s.BackendState === 'Running',
      nombre: s.Self?.DNSName?.replace(/\.$/, '') || null };
  } catch { return { instalado: true, dentro: false }; }
};

const clave = authkey();
let e = estado();

if (SECO) {
  console.log('🧪 SECO — no he tocado nada.');
  console.log(`   tailscale instalado : ${e.instalado ? 'sí' : 'NO, lo instalaría'}`);
  console.log(`   nodo en la tailnet  : ${e.dentro ? `sí (${e.nombre})` : 'NO, lo uniría'}`);
  console.log(`   nombre pedido       : ${NOMBRE}${
    e.dentro && nombreCorto(e.nombre) !== NOMBRE ? `  ⚠ pero se llama "${nombreCorto(e.nombre)}"` : ''}`);
  console.log(`   authkey disponible  : ${clave ? 'sí (no se imprime)' : 'NO'}`);
  console.log(`   serve que pondría   : --https=${PUERTO_TS} → http://127.0.0.1:${PUERTO_WEB}`);
  process.exit(0);
}

if (!e.instalado) {
  console.log('[tailscale] instalando…');
  const r = sh('curl -fsSL https://tailscale.com/install.sh | sudo -n sh');
  if (!r.ok) { console.error(`[tailscale] no pude instalarlo:\n${r.out.slice(-400)}`); process.exit(0); }
  e = estado();
}

if (!e.dentro) {
  if (!clave) {
    console.error('[tailscale] no hay TS_AUTHKEY: el nodo NO se une solo.');
    console.error('            Ponla en el .env del LANZADOR (en el mini) como CWEB_TS_AUTHKEY,');
    console.error('            o une esta máquina a mano:  sudo tailscale up --hostname=' + NOMBRE);
    process.exit(0);   // no aborta el aprovisionamiento por esto
  }
  console.log(`[tailscale] uniendo como "${NOMBRE}"…`);
  // La clave viaja por el ENTORNO, nunca en la línea de comando: `sudo` deja en
  // el journal lo que le pasas como argumento.
  const r = sh(`sudo -n --preserve-env=TS_AUTHKEY tailscale up --authkey="$TS_AUTHKEY" ` +
    `--hostname=${NOMBRE} --accept-dns=false`, { ...process.env, TS_AUTHKEY: clave });
  if (!r.ok) {
    // Y el error tampoco puede llevarla dentro.
    console.error(`[tailscale] no pude unir el nodo:\n${r.out.split(clave).join('«CLAVE»').slice(-500)}`);
    process.exit(0);
  }
  e = estado();
}

const r = sh(`sudo -n tailscale serve --bg --https=${PUERTO_TS} http://127.0.0.1:${PUERTO_WEB}`);
if (!r.ok) {
  console.error(`[tailscale] el nodo está dentro, pero no pude poner el serve:\n${r.out.slice(-400)}`);
  process.exit(0);
}

// ⚠⚠ Y AHORA SE COMPRUEBA QUÉ NOMBRE TE DIERON, que es lo que faltaba.
// Hasta el 2026-09-10 esto terminaba aquí con un ✅: el `up` había salido con 0,
// el `serve` estaba puesto y la web contestaba. Todo verde, y aun así la app
// instalada en el móvil acababa de quedarse apuntando a un server muerto porque
// el nodo había entrado como `dev-1`. Un final feliz que no comprueba el dato
// que decide es el fallo que este proyecto ya ha pagado tres veces.
const deriva = avisoDeDeriva(NOMBRE, e.nombre, PUERTO_TS);
if (deriva) {
  console.error(deriva);
  avisar(deriva);
  process.exit(0);   // ⚠ 0 siempre: corre dentro del aprovisionamiento
}
console.log(`✅ Listo: https://${e.nombre ?? NOMBRE}:${PUERTO_TS}/`);
