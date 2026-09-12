// Por dónde se llega a la web desde el móvil: Tailscale o Cloudflare Tunnel.
// Es lo que corre el `install` del servicio (`unir`), lo que corre antes de
// destruir el droplet (`desunir`), y lo que dice en qué estado está (`estado`).
//
// Uso:  node scripts/acceso.mjs [unir|desunir|estado] [--si] [--seco]
//
// El modo lo decide `modoDeAcceso()` en `cloudflare.mjs`: `CWEB_ACCESO` si está,
// y si no, el DATO (hay token de túnel → cloudflare; si no → tailscale). Los dos
// caminos conviven a propósito: Cloudflare es la prueba y Tailscale la vuelta
// atrás, y cambiar de uno a otro es cambiar una variable del llavero, no código.
//
// ⚠ Sale SIEMPRE con 0, como los scripts a los que delega: corre dentro del
// aprovisionamiento, y un fallo aquí dejaría el droplet a medias por algo que se
// arregla en un minuto desde el móvil.

import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conEnvDelRepo } from './certificado.mjs';
import { avisoDeModo, estadoDelTunel, hostnameDelTunel, modoDeAcceso, ordenDeProbarTunel,
         ponerTunel, urlDelTunel, veredictoDeSonda, UNIDAD_TUNEL } from './cloudflare.mjs';
import { execSync } from 'node:child_process';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV = conEnvDelRepo(RAIZ);
const MODO = modoDeAcceso(ENV);
const args = process.argv.slice(2);
const orden = (args.find((a) => !a.startsWith('--')) || 'estado').toLowerCase();
const SECO = args.includes('--seco');

const sh = (cmd) => {
  try { return { ok: true, out: execSync(cmd, { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim() }; }
  catch (e) { return { ok: false, out: ((e.stdout || '') + (e.stderr || '')).trim() }; }
};

/** Avisa por Telegram. Nunca puede tumbar esto: es una comodidad. */
function avisar(texto) {
  try {
    const COORD = ENV.COORD_HOME || join(process.env.HOME || '', 'src', 'telegram-coordinator');
    execFileSync(process.execPath, [join(COORD, 'scripts', 'notify.mjs')],
      { input: texto, timeout: 30_000, stdio: ['pipe', 'ignore', 'ignore'] });
  } catch { /* el log de la unidad sigue siendo la fuente de verdad */ }
}

/** Delega en un script de Tailscale, con la misma salida y los mismos argumentos. */
function delegar(script) {
  const r = spawnSync(process.execPath, [join(RAIZ, 'scripts', script), ...args.filter((a) => a.startsWith('--'))],
    { stdio: 'inherit', env: process.env });
  process.exit(0);   // ⚠ 0 siempre: los scripts de Tailscale ya salen con 0 por su cuenta
}

const aviso = avisoDeModo(ENV);
if (aviso) console.error(aviso);

/** Sonda al túnel por su nombre público, con su veredicto. */
function sondear() {
  const host = hostnameDelTunel(ENV);
  if (!host) return '(sin CF_HOSTNAME no hay nada que probar)';
  return veredictoDeSonda(sh(ordenDeProbarTunel(host)).out).texto;
}

switch (orden) {
  case 'unir': {
    if (MODO === 'tailscale') delegar('tailscale-unir.mjs');
    console.log(`[acceso] modo cloudflare${SECO ? ' (SECO)' : ''}`);
    const r = ponerTunel(ENV, sh, SECO);
    console.log(r.mensaje);
    if (!r.hecho) { if (!SECO) avisar(`❌ Web móvil por Cloudflare: ${r.mensaje}`); break; }
    // Se le da un momento para registrar la conexión antes de probar: recién
    // arrancado, la sonda daría 530 y se leería como roto.
    let est = estadoDelTunel(sh);
    for (let i = 0; i < 12 && !est.conectado; i++) { sh('sleep 2'); est = estadoDelTunel(sh); }
    const veredicto = sondear();
    const m = `${est.conectado ? '✅ Túnel conectado a Cloudflare.' : `⚠ El túnel aún no registra conexión${est.ultimoError ? `: ${est.ultimoError}` : ''}.`}\n` +
      `${veredicto}\n\nDesde el móvil (sin ninguna app, con tu login de Access):\n  ${r.url}\n` +
      'Ábrela y dale a «Añadir a pantalla de inicio» para instalarla.';
    console.log(m);
    avisar(m);
    break;
  }
  case 'desunir': {
    if (MODO === 'tailscale') delegar('tailscale-desunir.mjs');
    // Un túnel no deja nada que limpiar al morir el droplet: el túnel sigue
    // existiendo en Cloudflare y el dev siguiente se conecta con el mismo token.
    // Dos conectores a la vez tampoco chocan: Cloudflare reparte entre ellos.
    console.log('[acceso] modo cloudflare: no hay nada que dar de baja; el túnel vive en Cloudflare y el próximo dev lo reusa.');
    break;
  }
  case 'estado': {
    console.log(`acceso        : ${MODO}${aviso ? '  (ver aviso arriba)' : ''}`);
    if (MODO === 'tailscale') {
      const r = sh('tailscale status --json 2>/dev/null');
      let nombre = null;
      try { nombre = JSON.parse(r.out).Self?.DNSName?.replace(/\.$/, '') || null; } catch { /* fuera */ }
      console.log(`nodo          : ${nombre ?? 'fuera de la tailnet'}`);
      console.log('detalle       : node scripts/cweb.mjs url   ·   node scripts/cweb.mjs cert');
      break;
    }
    const est = estadoDelTunel(sh);
    const host = hostnameDelTunel(ENV);
    console.log(`túnel         : ${est.activa ? 'unidad activa' : 'unidad PARADA'}, ${est.conectado ? 'conectado a Cloudflare' : 'SIN conexión registrada'}` +
      (est.ultimoError ? `\n                último error: ${est.ultimoError}` : ''));
    console.log(`nombre        : ${host || 'SIN CF_HOSTNAME'}`);
    console.log(`sonda         : ${sondear()}`);
    if (host) console.log(`\nDesde el móvil:\n  ${urlDelTunel(host)}`);
    break;
  }
  default:
    console.log(`No sé qué es "${orden}". Órdenes: unir · desunir --si · estado  (y --seco)`);
    process.exit(2);
}
