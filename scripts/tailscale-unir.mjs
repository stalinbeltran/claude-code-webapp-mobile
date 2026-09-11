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
// log de la unidad. Este proyecto ya filtró un token una vez.
//
// ⚠⚠ Y «va por el entorno» NO BASTABA — decía eso y filtraba igual, medido el
// 2026-09-10. `execSync` lanza con `/bin/sh -c`, así que el shell expandía
// `"$TS_AUTHKEY"` **antes** de que `sudo` existiera y la clave acababa en el
// `COMMAND=` del journal; y `--preserve-env` la escribía otra vez en el `ENV=`.
// Ahora viaja en un fichero 0600 que se borra siempre: ver `ordenDeUnir()` en
// `nodo.mjs`, donde está el detalle y el porqué.
//
// ⚠ Y NO ABORTA si falta la authkey. Corre dentro del aprovisionamiento: hacer
// fallar todo el `install` porque falte una clave dejaría el droplet a medias por
// algo que se arregla en un minuto. Se dice qué falta y se sigue (R2: degradar
// con un defecto declarado, no fallar a mitad).

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { avisoDeDeriva, avisoDeServeHuerfano, nombreCorto, ordenDeServir,
         ordenDeUnir, publicacion, publicacionSobrante, serveHuerfano,
         urlPublica } from './nodo.mjs';
import { conEnvDelRepo, ponerCertificadoSiHay } from './certificado.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠ El entorno MÁS el `.env` del repo, que es donde el lanzador deja `TS_*`.
const ENV = conEnvDelRepo(RAIZ);
const NOMBRE = ENV.CWEB_HOSTNAME ?? 'dev';
const PUERTO_WEB = ENV.CWEB_PORT ?? '8020';
// Esquema y puerto son DATO: `publicacion()` en `nodo.mjs`. Desde el 2026-09-11:
// `https` si el llavero trae certificado, `http` si no, salvo `CWEB_TS_ESQUEMA`.
const PUB = publicacion(ENV);
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
  return String(ENV.TS_AUTHKEY ?? '').trim();
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
  console.log(`   serve que pondría   : ${PUB.bandera} → http://127.0.0.1:${PUERTO_WEB}`);
  console.log(`   certificado         : ${ENV.TS_CERT_B64 && ENV.TS_KEY_B64 ? 'viene en el llavero (no se imprime)' : 'NO viene; con https se pediría a Let\'s Encrypt'}`);
  console.log(`   URL que quedaría    : ${urlPublica(e.nombre ?? `${NOMBRE}.<tailnet>`, PUB)}`);
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
  // La clave va a un fichero 0600 y `tailscale` la lee de ahí. Nada que expandir
  // en el shell, nada que preservar en el entorno: `sudo` no la ve y no la
  // registra. `root` lo lee igual (se salta los permisos), que es lo que hace
  // falta porque `tailscale up` corre como root.
  //
  // ⚠ Su regla de caducidad, escrita al lado (regla 3): se borra en el `finally`,
  // pase lo que pase. Si aun así sobrevive a un SIGKILL, muere con la máquina:
  // vive bajo `os.tmpdir()`, en un directorio propio 0700 y con nombre aleatorio.
  let dir = null, r;
  try {
    dir = mkdtempSync(join(tmpdir(), 'tsjoin-'));
    const f = join(dir, 'authkey');
    writeFileSync(f, clave, { mode: 0o600 });
    r = sh(ordenDeUnir(f, NOMBRE));
  } finally {
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* se va con la máquina */ } }
  }
  if (!r.ok) {
    // Y el error tampoco puede llevarla dentro.
    console.error(`[tailscale] no pude unir el nodo:\n${r.out.split(clave).join('«CLAVE»').slice(-500)}`);
    process.exit(0);
  }
  e = estado();
}

// ⚠ `--bg` para que la configuración sobreviva a este proceso: sin él, `serve`
// se queda en primer plano y al morir deja de servir.
const ponerServe = () => sh(ordenDeServir(PUB, PUERTO_WEB));
const publicado = () => {
  try { return JSON.parse(sh('tailscale serve status --json').out || 'null'); } catch { return null; }
};

// ⚠⚠ EL CERTIFICADO VA ANTES DEL `serve`, y sólo con `https`: si el llavero trae
// uno que vale para este nodo, tailscaled lo reutiliza y rehacer el dev no gasta
// ninguna de las 5 emisiones semanales de Let's Encrypt (medido el 2026-09-11).
// Se comprueba contra el nombre que la tailnet DIO, no contra el pedido: un cert
// de `dev` no sirve si el nodo entró como `dev-1`, y colocarlo no fallaría —
// tailscaled lo ignoraría y pediría otro—, que es justo el gasto silencioso.
if (PUB.esquema === 'https') console.log(ponerCertificadoSiHay(e.nombre, ENV).mensaje);

let r = ponerServe();
if (!r.ok) {
  console.error(`[tailscale] el nodo está dentro, pero no pude poner el serve:\n${r.out.slice(-400)}`);
  process.exit(0);
}

// ⚠⚠ Y AHORA SE COMPRUEBA BAJO QUÉ NOMBRE QUEDÓ, que es el arreglo del
// 2026-09-10. Ese día esta línea ya existía, se ejecutó **1 s después del
// `up`**, aplicó su POST… y escribió la config con el nombre que el nodo tenía
// ANTES de que el registro asentara. Resultado: el nodo era `dev` y el serve
// publicaba `dev-2`, o sea que la app no se veía por NINGUNA de las dos
// direcciones. Reintentar a ciegas no lo arregla: el reintento es lo que lo
// escribió mal. Se comprueba el dato. Ver `serveHuerfano()` en `nodo.mjs`.
//
// ⚠ Y se RELEE el nombre del nodo: el de `e` se leyó justo después del `up`,
// que es exactamente el instante que puede mentir.
e = estado();
// ⚠⚠ Y se mira LO MISMO por sus DOS mitades, porque son dos derivas distintas:
// el HOST publicado (`serveHuerfano`, el fallo del 2026-09-10) y el ESQUEMA/PUERTO
// (`publicacionSobrante`, el del 2026-09-11). La segunda es la que deja viva la
// puerta `--https` al pasar a `--http`: mismo nombre, así que la primera no la ve,
// y es justo la que cuelga al móvil pidiendo un certificado que no va a llegar.
let { huerfanos } = serveHuerfano(e.nombre, publicado());
let { sobran } = publicacionSobrante(e.nombre, publicado(), PUB);
if (huerfanos.length || sobran.length) {
  console.log(`[tailscale] el serve no coincide con lo declarado (${PUB.bandera}): ` +
    `${[...huerfanos.map((h) => `${h} de otro nombre`), ...sobran].join(', ')}. Lo rehago.`);
  sh('sudo -n tailscale serve reset');   // `--bg` añade, no reemplaza: hay que limpiar
  r = ponerServe();
  if (!r.ok) {
    console.error(`[tailscale] no pude reponer el serve:\n${r.out.slice(-400)}`);
    process.exit(0);
  }
  ({ huerfanos } = serveHuerfano(e.nombre, publicado()));
  ({ sobran } = publicacionSobrante(e.nombre, publicado(), PUB));
  if (huerfanos.length || sobran.length) {
    // ⚠ Si tras rehacerlo SIGUE mal, se dice en voz alta en vez de terminar con
    // un ✅: un final feliz que no comprueba el dato que decide es el fallo que
    // este repo ya ha pagado tres veces.
    const m = avisoDeServeHuerfano(e.nombre, publicado(), PUB, PUERTO_WEB) ||
      `⚠⚠ EL \`serve\` NO QUEDÓ EN LO DECLARADO (${PUB.bandera}).\n` +
      `Sigue publicando: ${sobran.join(', ')}\n\n` +
      `Se arregla con esto, y es idempotente:\n` +
      `  sudo -n tailscale serve reset\n  ${ordenDeServir(PUB, PUERTO_WEB)}`;
    console.error(m);
    avisar(m);
    process.exit(0);
  }
}

// ⚠⚠ Y AHORA SE COMPRUEBA QUÉ NOMBRE TE DIERON, que es lo que faltaba.
// Hasta el 2026-09-10 esto terminaba aquí con un ✅: el `up` había salido con 0,
// el `serve` estaba puesto y la web contestaba. Todo verde, y aun así la app
// instalada en el móvil acababa de quedarse apuntando a un server muerto porque
// el nodo había entrado como `dev-1`. Un final feliz que no comprueba el dato
// que decide es el fallo que este proyecto ya ha pagado tres veces.
const deriva = avisoDeDeriva(NOMBRE, e.nombre, PUB);
if (deriva) {
  console.error(deriva);
  avisar(deriva);
  process.exit(0);   // ⚠ 0 siempre: corre dentro del aprovisionamiento
}
console.log(`✅ Listo: ${urlPublica(e.nombre ?? NOMBRE, PUB)}`);
