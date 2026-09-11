// Poner la web detrás de `tailscale serve`, en cuanto el nodo esté conectado.
//
// Por qué es un script commiteado y no un comando tecleado: tecleado no deja
// rastro de QUÉ se lanzó, y esto hay que repetirlo **cada vez que se rehaga el
// dev**. Commiteado, «¿cómo se puso?» es una pregunta con respuesta.
//
// ⚠⚠ EL PUERTO NO ES EL 443, Y NO ES UN CAPRICHO. En esta máquina `sshd` escucha
// en `0.0.0.0:443` —o sea también en la interfaz de la tailnet—, así que publicar
// ahí chocaría. Medido el 2026-09-09 y confirmado el 2026-09-10. Se elige mover
// ESTO y no `sshd`: tocar el puerto por el que se entra a la máquina, desde dentro
// de la máquina, es la clase de cambio que te deja fuera.
//
// ⚠⚠ Y EL ESQUEMA ES `http` DESDE EL 2026-09-11: sin certificado. El porqué está
// medido en `publicacion()` de `nodo.mjs` (Let's Encrypt da 5 certificados por
// semana y por nombre, y este nombre se reusa en cada dev a propósito). Lo que eso
// cuesta —la PWA deja de poder INSTALARSE, porque `http` no es contexto seguro—
// está en el README, § «Lo que cuesta no tener certificado».
//
// Uso:  node scripts/tailscale-serve.mjs [--esperar <minutos>]

import { execFileSync, execSync } from 'node:child_process';
import { ordenDeProbar, ordenDeServir, publicacion, publicacionSobrante,
         serveHuerfano, urlPublica } from './nodo.mjs';
import { conEnvDelRepo, ponerCertificadoSiHay } from './certificado.mjs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠ El entorno MÁS el `.env` del repo: ahí es donde el lanzador deja `TS_*`, y
// sin leerlo `publicacion()` no vería el certificado y publicaría por `http`.
const ENV = conEnvDelRepo(RAIZ);
const PUERTO_WEB = ENV.CWEB_PORT ?? '8020';
const PUB = publicacion(ENV);
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

/** El nombre DNS del nodo y su IP, o null si aún no ha entrado en la tailnet.
 *  ⚠ La IP hace falta para poder PROBARSE a sí mismo: con `--accept-dns=false`
 *  esta máquina no resuelve su propio MagicDNS (ver `ordenDeProbar`). */
function nombreDelNodo() {
  const r = sh('tailscale status --json');
  if (!r.ok) return null;
  try {
    const s = JSON.parse(r.out);
    if (s.BackendState !== 'Running') return null;
    const dns = s.Self?.DNSName?.replace(/\.$/, '') || null;
    return dns ? { dns, ip: (s.Self?.TailscaleIPs || [])[0] || null } : null;
  } catch { return null; }
}

console.log(`[serve] esperando a que el nodo entre en la tailnet (hasta ${MINUTOS} min)…`);
let nodo = null;
for (let s = 0; s < MINUTOS * 60; s += 5) {
  nodo = nombreDelNodo();
  if (nodo) break;
  execFileSync('sleep', ['5']);
}

if (!nodo) {
  const m = `⏳ Tailscale: el server sigue SIN autorizar tras ${MINUTOS} min.\n` +
    'El enlace de login caduca; para sacar uno nuevo: `sudo tailscale up --hostname=dev`.';
  console.error(m);
  avisar(m);
  process.exit(0);   // ⚠ 0 siempre: esto corre como unidad y un fallo al final sería un BUCLE
}

const nombre = nodo.dns;
console.log(`[serve] nodo conectado: ${nombre}`);

// ⚠⚠ PRIMERO SE LIMPIA LO QUE PUBLIQUE OTRO NOMBRE, y esto es el arreglo del
// 2026-09-10. `serve --bg` AÑADE el host de ahora pero **no borra el de antes**:
// si el nodo cambió de nombre desde la última vez (un `logout` + volver a unir
// para recuperar el nombre bueno), quedan los dos publicados, y el que lea el
// status después puede coger el muerto. Ese día el serve se quedó entero bajo
// `dev-2` mientras el nodo ya se llamaba `dev`, y la app dejó de verse por las
// DOS direcciones. Ver `serveHuerfano()` en `nodo.mjs`.
//
// ⚠ El `reset` sólo se hace si hay algo huérfano: es destructivo (se lleva
// cualquier serve puesto a mano) y no hay motivo para pagarlo cuando no sobra
// nada. Si no se puede comparar, NO se resetea: no saber no es motivo para
// borrar.
let serveActual = null;
try { serveActual = JSON.parse(sh('tailscale serve status --json').out || 'null'); } catch { /* se degrada */ }
// ⚠ Dos derivas, dos comprobaciones: el HOST que sobra (nombre anterior, el fallo
// del 2026-09-10) y el ESQUEMA/PUERTO que sobra (pasar de `--https` a `--http` deja
// LAS DOS puertas publicadas, medido el 2026-09-11). La de más no es inofensiva:
// es la que cuelga al móvil pidiendo un certificado que no va a llegar.
const { huerfanos } = serveHuerfano(nombre, serveActual);
const { sobran } = publicacionSobrante(nombre, serveActual, PUB);
if (huerfanos.length || sobran.length) {
  console.log(`[serve] limpiando lo que no es ${PUB.bandera}: ` +
    `${[...huerfanos.map((h) => `${h} de otro nombre`), ...sobran].join(', ')}`);
  const limpieza = sh('sudo -n tailscale serve reset');
  if (!limpieza.ok) console.error(`[serve] no pude limpiarlos:\n${limpieza.out.slice(-300)}`);
}

// ⚠⚠ EL CERTIFICADO VA ANTES DEL `serve`, y sólo con `https`. Si el llavero trae
// uno que vale para este nodo, tailscaled lo encuentra y no pide ninguno a Let's
// Encrypt (5 por semana y por nombre, medido el 2026-09-11). Si no lo trae, se
// dice AHORA que va a pedir uno, para que nadie descubra el gasto por el 429.
if (PUB.esquema === 'https') console.log(ponerCertificadoSiHay(nombre, ENV).mensaje);

// ⚠ `--bg` para que la configuración quede puesta y sobreviva a este proceso:
// `tailscale serve` sin él se queda en primer plano y al morir deja de servir.
const r = sh(ordenDeServir(PUB, PUERTO_WEB));
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
  // ⚠ Publicando por `http` este permiso ya no hace falta (el de HTTPS/certificados
  // es lo que pedía ese enlace), así que si aparece es otra cosa: se pasa el suyo
  // tal cual y no se interpreta.
  const m = `❌ No pude poner la web detrás de Tailscale:\n${r.out.slice(-600)}${pistaHttps}`;
  console.error(m);
  avisar(m);
  process.exit(0);
}

// No se anuncia hasta comprobarlo: un puerto configurado no es una web que responda.
const prueba = sh(ordenDeProbar(nombre, nodo.ip, PUB));
const url = urlPublica(nombre, PUB);
// ⚠ Y NO se promete «añádela a la pantalla de inicio» cuando se publica por `http`:
// sin contexto seguro no hay service worker, y sin service worker Android no ofrece
// instalarla. Prometer un botón que no va a salir es el aviso que enseña a
// desconfiar del resto del mensaje.
const comoGuardarla = PUB.esquema === 'https'
  ? 'Ábrela y dale a «Añadir a pantalla de inicio» para instalarla.'
  : 'Ábrela y guárdala en marcadores. ⚠ Sin certificado Android NO ofrece ' +
    '«Añadir a pantalla de inicio»: eso pide contexto seguro (README § «Lo que ' +
    'cuesta no tener certificado»).';
const m = prueba.out === '200'
  ? `✅ La web de lectura ya se ve desde tu móvil (con Tailscale activo):\n\n${url}\n\n` +
    comoGuardarla
  : `⚠ Tailscale ya sirve la web en ${url}, pero al probarla me contestó ` +
    `"${prueba.out || 'nada'}" en vez de 200. Mira \`cweb log\`.`;
console.log(m);
avisar(m);
