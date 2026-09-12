// Gobernar la web de lectura desde Telegram: dónde está, si corre, arrancarla y
// pararla. Es el equivalente de `foveal-vision/scripts/web_app.py` para esta app,
// y existe por la regla 4 de escritura del coordinador: **un comando nuevo no
// está terminado hasta que se puede invocar desde el móvil**.
//
// Uso:  node scripts/cweb.mjs [estado|url|arrancar|parar|instalar|log|acceso|tailscale|cert [exportar]]
//
// ⚠ Este script NO decide dónde escucha el servidor: eso está en
// `server/index.mjs` y es 127.0.0.1 siempre. Aquí sólo se enciende y se apaga.

import { execFileSync, execSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { avisoDeDeriva, avisoDeServeHuerfano, esquemaPublicado, publicacion,
         publicacionSobrante, serveHuerfano } from './nodo.mjs';
import { conEnvDelRepo, estado as estadoCertificado, exportar as exportarCertificado } from './certificado.mjs';
import { estadoDelTunel, hostnameDelTunel, modoDeAcceso, ordenDeProbarTunel, urlDelTunel,
         veredictoDeSonda } from './cloudflare.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UNIDAD = 'claude-web';
// ⚠ El entorno MÁS el `.env` del repo (donde el lanzador deja `TS_*`): sin
// leerlo, `publicacion()` no vería el certificado y diría `http`.
const ENV = conEnvDelRepo(RAIZ);
const PUERTO = ENV.CWEB_PORT ?? '8020';
const PUB = publicacion(ENV);
// Por dónde se llega: tailscale o cloudflare. Lo decide `CWEB_ACCESO` o el dato
// (hay token de túnel). Ver `scripts/cloudflare.mjs` y `scripts/acceso.mjs`.
const MODO = modoDeAcceso(ENV);
/** El nombre que este nodo DEBERÍA tener: el mismo defecto que `tailscale-unir.mjs`,
 *  porque es el que quedó escrito en la PWA instalada en el móvil. */
const NOMBRE = ENV.CWEB_HOSTNAME ?? 'dev';

/** El esquema de una clave `host:puerto` del `serve status`, o null si no se sabe. */
const esquemaDe = (serve, clave) =>
  esquemaPublicado(serve, (String(clave).match(/:(\d+)$/) || [])[1] || '');

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
  console.log(`acceso        : ${MODO}  (CWEB_ACCESO, o el dato: hay token de túnel → cloudflare)`);
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

/** El nombre DNS real de este nodo, o null si no está en la tailnet. Se PREGUNTA. */
function nombreDelNodo() {
  const r = sh('tailscale status --json 2>/dev/null');
  if (!r.startsWith('{')) return null;
  try { return JSON.parse(r).Self?.DNSName?.replace(/\.$/, '') || null; } catch { return null; }
}

/** La dirección por Cloudflare: el nombre público del túnel, SONDEADO. */
function urlCloudflare() {
  const host = hostnameDelTunel(ENV);
  if (!host) {
    return 'Desde el móvil: todavía NO se puede llegar por Cloudflare.\n' +
      '  Falta CF_HOSTNAME (en el llavero, CWEB_CF_HOSTNAME): el "public hostname" del túnel.';
  }
  const est = estadoDelTunel(sh);
  const v = veredictoDeSonda(sh(ordenDeProbarTunel(host)).trim());
  return `Desde el móvil (sin ninguna app, con tu login de Access):\n  ${urlDelTunel(host)}\n\n` +
    `túnel: ${est.activa ? 'activo' : 'PARADO'}, ${est.conectado ? 'conectado' : 'sin conexión registrada'}\n${v.texto}`;
}

/**
 * La dirección desde la que se llega, LEÍDA del estado real de `tailscale serve`.
 *
 * ⚠⚠ No se compone a mano, y ésta es la razón: la primera versión devolvía
 * `https://<nodo>/` porque dio por hecho el puerto 443 — y aquí el 443 lo tiene
 * `sshd`, así que el serve está en el 8443. Esa URL **parecía correcta y no
 * cargaba**: abrirla desde el móvil se lee como «la web está rota», que es el
 * peor sitio donde poner un error. Medido el 2026-09-10.
 *
 * La regla, que vale para todo este script: se PREGUNTA por el estado, no se
 * supone. Aquí es literalmente lo que `tailscale serve status` imprime.
 */
function url() {
  if (MODO === 'cloudflare') return urlCloudflare();
  const s = sh('tailscale serve status 2>/dev/null');
  const dnsNodo = nombreDelNodo();

  // ⚠⚠ NO se coge «el primer https:// que salga», que es lo que hacía y lo que
  // dio la URL muerta el 2026-09-10. `serve status` puede publicar VARIOS hosts
  // —el del nodo y los que quedaron de un nombre anterior— y ahí el orden no
  // significa nada. Se elige el que es de ESTE nodo, y para eso hay que
  // comparar, no leer.
  let serve = null;
  try { serve = JSON.parse(sh('tailscale serve status --json 2>/dev/null')); } catch { /* abajo se degrada */ }
  const { propios, huerfanos, sabe } = serveHuerfano(dnsNodo, serve);

  // ⚠⚠ Y EL ESQUEMA TAMPOCO SE SUPONE, desde el 2026-09-11. Esto ponía `https://`
  // a pelo, que era verdad mientras sólo hubiera una forma de publicar; desde que
  // se publica por `http` (ver `publicacion()` en `nodo.mjs`) una URL con el
  // esquema equivocado **parece correcta y no carga** — exactamente el fallo del
  // puerto 443 que esta misma función existe para no repetir. Se lee del `TCP` que
  // el propio `serve status --json` trae.
  const publicada = sabe && propios.length
    ? `${esquemaDe(serve, propios[0]) ?? PUB.esquema}://${propios[0]}`   // el del nodo, comprobado
    : (s.match(/https?:\/\/\S+/) || [])[0];                             // sin poder comparar, lo que diga el status

  // ⚠ Si TODO lo publicado es huérfano, no hay URL buena que dar. Devolver la
  // muerta «porque es lo que dice el status» es exactamente el fallo que costó
  // la app entera: el comando que existe para no suponer acabó mintiendo con
  // total confianza. Aquí se dice qué pasa y el comando que lo arregla.
  const huerfano = avisoDeServeHuerfano(dnsNodo, serve, PUB, PUERTO);
  if (sabe && huerfanos.length && !propios.length) return huerfano;

  if (publicada) {
    // ⚠⚠ Y se dice si el nodo NO se llama como debería. Ésta es la pregunta que
    // se hace justo cuando la app «no funciona» desde el móvil, así que es donde
    // tiene que estar la respuesta: una URL correcta a secas no explica por qué
    // la que tienes guardada dejó de servir (medido el 2026-09-10).
    const deriva = avisoDeDeriva(NOMBRE, dnsNodo, PUB);
    // ⚠ Y si además sobra una puerta publicada (la `--https` que queda viva al
    // pasar a `--http`), se dice: es la que cuelga al móvil pidiendo un certificado
    // que no va a llegar, y desde aquí es invisible porque el host es el correcto.
    const { sobran } = publicacionSobrante(dnsNodo, serve, PUB);
    const sobra = sobran.length
      ? `⚠ Además sobra publicado: ${sobran.join(', ')}, y lo declarado es ` +
        `${PUB.bandera}. Esa puerta de más es la que deja al móvil esperando un ` +
        `certificado. Se quita con:\n  sudo -n tailscale serve reset\n` +
        `  node scripts/tailscale-serve.mjs`
      : '';
    return `Desde el móvil (con Tailscale activo):\n  ${publicada.replace(/\/$/, '')}/` +
      (deriva ? `\n\n${deriva}` : '') +
      (huerfano ? `\n\n${huerfano}` : '') +
      (sobra ? `\n\n${sobra}` : '');
  }
  const nodo = sh('tailscale status --json 2>/dev/null');
  const dentro = nodo.startsWith('{') && /"BackendState":\s*"Running"/.test(nodo);
  return 'Desde el móvil: todavía NO se puede llegar.\n' +
    '  Escucha sólo en loopback a propósito (quien alcance este puerto tiene\n' +
    '  shell en esta máquina).\n' +
    (dentro
      ? '  El nodo SÍ está en la tailnet, pero no hay ningún `serve` puesto.\n' +
        '  Ponlo con:  tailscale   (esta misma sesión)\n'
      : '  Y este server aún no está en la tailnet: ver docs/decisiones.md, P3.\n') +
    `  Por túnel SSH mientras tanto:  ssh -L ${PUERTO}:127.0.0.1:${PUERTO} <esta-máquina>`;
}

const orden = (process.argv[2] || '').trim().toLowerCase() || 'estado';
switch (orden) {
  case 'estado': process.exit(estado());
  case 'url': console.log(url()); break;
  case 'instalar': process.exit(instalar());
  case 'arrancar': console.log(sh(`sudo -n systemctl start ${UNIDAD}`) || '▶️ arrancada'); estado(); break;
  case 'parar': console.log(sh(`sudo -n systemctl stop ${UNIDAD}`) || '⏹️ parada'); break;
  case 'log': console.log(sh(`journalctl -u ${UNIDAD} -n 40 -o cat --no-pager`)); break;
  case 'acceso': {
    // Relanza el acceso que toque (Tailscale o Cloudflare) DESDE TELEGRAM. Es el
    // camino genérico; `tailscale` se conserva para el que ya lo tenga en los dedos.
    const r = sh(`node ${join(RAIZ, 'scripts', 'acceso.mjs')} unir 2>&1`);
    console.log(r || '(sin salida)');
    break;
  }
  case 'tailscale': {
    // Relanza el configurador. Hace falta poder hacerlo DESDE TELEGRAM: la
    // primera vez suele faltar un permiso en la tailnet, y quien lo da está en
    // el móvil, no delante de la máquina.
    //
    // ⚠ Se EJECUTA el script, no se arranca una unidad. La primera versión hacía
    // `systemctl start ts-serve`, y esa unidad es transitoria (`systemd-run`): en
    // cuanto termina, deja de existir. El `start` fallaba, el `tail` enseñaba el
    // log VIEJO, y parecía que había reintentado cuando no había hecho nada.
    // Medido el 2026-09-10, y costó una vuelta entera.
    const r = sh(`node ${join(RAIZ, 'scripts', 'tailscale-serve.mjs')} --esperar 1 2>&1`);
    console.log(r || '(sin salida)');
    break;
  }
  case 'cert': {
    // El certificado con el que se publica por https: qué tiene tailscaled, qué
    // trae el llavero y si coinciden. Existe porque el fallo del 2026-09-11 era
    // INVISIBLE desde aquí: nodo bien, serve bien, unidad activa, y el móvil
    // colgado en un handshake TLS contra un 429 de Let's Encrypt.
    //
    // `cert exportar` imprime el par en las dos líneas que van al llavero. Es la
    // ÚNICA orden de este script que saca un secreto por stdout, y es para que la
    // lea `entornos recoger` del lanzador, no una persona: el ejecutor de Telegram
    // la rechaza a propósito (ver telegram/executors/cweb.json).
    const que = (process.argv[3] || '').trim().toLowerCase();
    const dns = nombreDelNodo();
    if (que === 'exportar') {
      const lineas = dns ? exportarCertificado(dns) : null;
      if (!lineas) {
        console.error(dns
          ? `no hay certificado en tailscaled para ${dns}: nada que exportar`
          : 'el nodo no está en la tailnet: no sé de qué nombre sería el certificado');
        process.exit(1);
      }
      console.log(lineas.join('\n'));
      break;
    }
    if (que) { console.log(`No sé qué es "cert ${que}". Órdenes: cert · cert exportar`); process.exit(2); }
    console.log(`publicación   : ${PUB.bandera}` +
      (String(ENV.CWEB_TS_ESQUEMA ?? '').trim() ? ' (por CWEB_TS_ESQUEMA)' : ' (por defecto: https sólo si el llavero trae certificado)'));
    console.log(estadoCertificado(dns, ENV));
    break;
  }
  default:
    // ⚠ El último caso SE NIEGA, nunca es una acción por defecto: así es como se
    // acaba corriendo lo que nadie pidió (medido el 2026-09-08 en otro lanzador).
    console.log(`No sé qué es "${orden}".\nÓrdenes: estado · url · arrancar · parar · instalar · log · acceso · tailscale · cert`);
    process.exit(2);
}
