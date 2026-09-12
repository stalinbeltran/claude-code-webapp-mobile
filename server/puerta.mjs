// LA PUERTA: quién puede entrar a esta web cuando está en un puerto público.
//
// ⚠⚠ POR QUÉ EXISTE, y es la razón de todo lo demás de este fichero.
// Desde el 2026-09-12 esta app **no usa Tailscale** (decisión del dueño: «cero
// tailscale»). Sin Tailscale y sin túnel, la única forma de que un móvil llegue
// es el **puerto público del droplet**. Y por ese puerto se llega al mismo sitio
// al que llega un mensaje de Telegram — una máquina donde `claude` corre con
// `bypassPermissions` — pero **sin la allowlist del bot**, que no cubre esto.
//
// Así que la exposición y la puerta son **la misma decisión**, y por eso van en
// el mismo sitio y con el mismo test: se ata a un puerto público **si y sólo si**
// hay token. Sin token no se abre, se dice, y se queda en loopback. Separarlas
// sería dejar que una llegue sin la otra, que es como se queda algo abierto.
//
// Es el patrón que ya usa `foveal-vision-web` en esta misma flota (token en la
// URL, `?t=`), y se copia a propósito en vez de inventar otro: es la única forma
// de pasarle un secreto a un móvil pegando un enlace.
//
// ⚠ LO QUE ESTO NO ES: el token viaja en claro, porque no hay TLS. Quien vea el
// tráfico ve el token. Es el mismo trato que ya se aceptó para
// `foveal-vision-web`, y está escrito en el README para que sea una decisión y
// no un descuido.

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/** Dónde se guarda el token de ESTA máquina. Fuera del repo: es un secreto de la
 *  máquina, no del proyecto, y el repo se copia a los workspaces. Modo 600. */
export const FICHERO_TOKEN = join(homedir(), '.config', 'cweb.env');

/** El nombre de la cookie. Con prefijo para no chocar con nada del mismo origen. */
export const COOKIE = 'cweb_t';

function leerEnv(f) {
  try {
    if (!existsSync(f)) return {};
    return Object.fromEntries(readFileSync(f, 'utf8').split('\n')
      .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]));
  } catch { return {}; }
}

/**
 * El token de la puerta, con su orden de precedencia DECLARADO:
 *
 *  1. `CWEB_TOKEN` del entorno — lo que manda si alguien lo pone a mano.
 *  2. el `.env` del repo — es lo que escribe el lanzador con `env_prefix: CWEB_`,
 *     y es el ÚNICO camino por el que un token **sobrevive a rehacer la máquina**
 *     (vive en el llavero del lanzador, no aquí).
 *  3. `~/.config/cweb.env`, generado la primera vez. Efímero como la máquina: al
 *     rehacerla hay uno nuevo, y se pregunta por Telegram.
 *
 * ⚠ Sin `crear` NO inventa nada, y esto importa: quien sólo pregunta (`estado`,
 * `url`) tiene que poder distinguir «no hay token» de «hay uno nuevo porque
 * preguntaste». Un `url` que crea un token cambia la respuesta al preguntarla.
 */
export function token({ env = process.env, raizRepo = null, crear = false } = {}) {
  const delEntorno = String(env.CWEB_TOKEN ?? '').trim();
  if (delEntorno) return delEntorno;

  if (raizRepo) {
    const delRepo = leerEnv(join(raizRepo, '.env'));
    for (const clave of ['CWEB_TOKEN', 'WEB_TOKEN']) {
      if (delRepo[clave]) return delRepo[clave];
    }
  }

  const guardado = leerEnv(FICHERO_TOKEN).CWEB_TOKEN;
  if (guardado) return guardado;
  if (!crear) return '';

  const nuevo = randomBytes(18).toString('base64url');
  mkdirSync(dirname(FICHERO_TOKEN), { recursive: true });
  writeFileSync(FICHERO_TOKEN, `CWEB_TOKEN=${nuevo}\n`, { mode: 0o600 });
  try { chmodSync(FICHERO_TOKEN, 0o600); } catch { /* ya nació 600 */ }
  return nuevo;
}

/** ¿La conexión entró por loopback? Entonces ya está dentro de la máquina. */
export function esLocal(direccionLocal) {
  const d = String(direccionLocal ?? '').replace(/^::ffff:/, '');
  return d === '127.0.0.1' || d === '::1';
}

/**
 * ¿Se deja pasar esta petición?
 *
 * Tres reglas, en este orden, y las tres tienen test:
 *
 *  1. **Por loopback se pasa sin token.** Quien ya está dentro de la máquina no
 *     necesita la puerta — y de ahí cuelgan la sonda de `cweb estado` y el túnel
 *     SSH de emergencia. Es el mismo criterio con el que el freno del coordinador
 *     le pregunta a `foveal-vision-web` desde 127.0.0.1.
 *  2. **Sin token configurado NO se pasa nada que no sea local.** Ni siquiera se
 *     debería llegar aquí (sin token no se ata un puerto público), pero el freno
 *     va en los dos sitios: si alguien ata a mano, la puerta sigue cerrada.
 *  3. **Con token, vale `?t=` o la cookie.** La query es cómo se pega un enlace
 *     en un móvil; la cookie es lo que hace que las llamadas a `/api/…` que
 *     vienen después sigan entrando sin arrastrar el token en cada URL.
 *
 * ⚠ La comparación es de longitud constante. Un `===` sobre un secreto filtra su
 * prefijo por tiempo, y aquí el secreto es la única barrera que hay.
 */
export function autorizado({ local = false, consulta = '', cookies = '', tokenBueno = '' } = {}) {
  if (local) return { ok: true, via: 'loopback' };
  if (!tokenBueno) return { ok: false, motivo: 'no hay token configurado en esta máquina' };
  if (iguales(consulta, tokenBueno)) return { ok: true, via: 'query' };
  if (iguales(cookieDe(cookies, COOKIE), tokenBueno)) return { ok: true, via: 'cookie' };
  return { ok: false, motivo: 'falta el token' };
}

/** Comparación en tiempo constante, sin depender de longitudes iguales. */
export function iguales(a, b) {
  const x = String(a ?? ''), y = String(b ?? '');
  if (!x || !y) return false;
  let dif = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    dif |= x.charCodeAt(i % x.length || 0) ^ y.charCodeAt(i % y.length || 0);
  }
  return dif === 0;
}

/** El valor de una cookie de la cabecera `Cookie`, o ''. */
export function cookieDe(cabecera, nombre) {
  for (const trozo of String(cabecera ?? '').split(';')) {
    const i = trozo.indexOf('=');
    if (i < 0) continue;
    if (trozo.slice(0, i).trim() === nombre) return trozo.slice(i + 1).trim();
  }
  return '';
}
