// El certificado de la web móvil: colocarlo en tailscaled y sacarlo de ahí.
//
// Es la mitad CON efectos de lo que `nodo.mjs` decide en puro: qué par viene en
// el entorno, si vale para este nodo, y qué órdenes lo dejan donde tailscaled lo
// lee. Aquí se ejecutan esas órdenes, se leen ficheros y se escriben temporales.
//
// Por qué existe, medido el 2026-09-11: Let's Encrypt da 5 certificados por
// semana y por nombre exacto, y cada dev rehecho pedía uno nuevo, porque el
// certificado moría con el droplet. El sexto dev de la semana nacía sin web
// móvil. Con esto, el certificado se pide UNA vez y luego viaja con la flota:
// cada dev nuevo lo COLOCA antes de poner el `serve`, y tailscaled lo reutiliza
// sin llamar a nadie (leído en `feature/acme/certstore.go` de Tailscale).
//
// ⚠ NADA de aquí puede tumbar el aprovisionamiento: `ponerCertificadoSiHay()`
// devuelve un mensaje, nunca lanza. Sin certificado la web sigue saliendo (por
// `http`, o por `https` pidiendo uno), y eso es mejor que un droplet a medias.
//
// ⚠ El contenido del par NUNCA pasa por la línea de órdenes: va a ficheros
// temporales 0600 en un directorio 0700 que se borra siempre, y `install` los
// copia como root. Es la misma regla que la authkey en `ordenDeUnir()`.

import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { certificadoDelEntorno, certificadoVale, leerEnv, lineasParaExportar,
         ordenesDePonerCertificado, rutasCertificado } from './nodo.mjs';

const sh = (cmd) => {
  try {
    return { ok: true, out: execSync(cmd, { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (e) { return { ok: false, out: ((e.stdout || '') + (e.stderr || '')).trim() }; }
};

/**
 * El entorno del proceso MÁS el `.env` del repo, que es donde el lanzador deja
 * las variables del puente `env_prefix` (`TS_AUTHKEY`, `TS_CERT_B64`…).
 *
 * El entorno real manda; el fichero sólo rellena lo que falte. Hace falta porque
 * estos scripts corren desde tres sitios con tres entornos distintos —el
 * `install` del aprovisionamiento, la unidad de systemd y una sesión SSH— y en
 * ninguno de los tres viene `TS_*` en el entorno: viene en el `.env`.
 */
export function conEnvDelRepo(raiz, env = process.env) {
  const f = join(raiz, '.env');
  const delFichero = existsSync(f) ? leerEnv(readFileSync(f, 'utf8')) : {};
  return { ...delFichero, ...env };
}

/** El par que tailscaled tiene HOY para este nodo, o null. Como root: el directorio es 0700. */
export function certificadoDelNodo(dns, ejecutar = sh) {
  const r = rutasCertificado(dns);
  if (!r) return null;
  const crt = ejecutar(`sudo -n cat ${r.crt}`);
  const key = ejecutar(`sudo -n cat ${r.key}`);
  if (!crt.ok || !key.ok || !crt.out || !key.out) return null;
  return { crt: crt.out + '\n', key: key.out + '\n' };
}

const fecha = (d) => (d ? d.toISOString().slice(0, 10) : '?');

/**
 * Coloca en tailscaled el par que venga en el entorno, si vale para este nodo.
 *
 * @returns {{hecho: boolean, mensaje: string}} — `hecho` es «tailscaled tiene el
 * del llavero» (ya lo tenía, o se acaba de poner). El mensaje se imprime tal cual.
 *
 * Los tres casos en que NO se coloca, y cada uno dice qué pasa después:
 *   - no viene par en el entorno → tailscaled pedirá uno a Let's Encrypt (1 de 5);
 *   - viene pero no vale (otro nombre, caducado) → ídem, y se dice por qué;
 *   - el nodo ya tiene uno MÁS NUEVO (lo renovó tailscaled) → se respeta el del
 *     nodo, y lo que toca es recogerlo al llavero, no pisarlo con el viejo.
 */
export function ponerCertificadoSiHay(dns, env = process.env, ejecutar = sh, ahora = new Date()) {
  const par = certificadoDelEntorno(env);
  if (!par) {
    return {
      hecho: false,
      mensaje: '[cert] no hay certificado en el entorno (TS_CERT_B64/TS_KEY_B64): tailscaled ' +
        'pedirá uno a Let\'s Encrypt en el primer acceso, 1 de los 5 por semana de este nombre. ' +
        'Cuando lo tenga, guárdalo en el llavero:  cweb cert  →  entornos recoger (lanzador).',
    };
  }
  const v = certificadoVale(par.crt, dns, ahora);
  if (!v.vale) {
    return { hecho: false, mensaje: `[cert] el certificado del llavero NO vale para este nodo: ${v.motivo}. No lo coloco.` };
  }
  const actual = certificadoDelNodo(dns, ejecutar);
  if (actual) {
    if (actual.crt.trim() === par.crt.trim() && actual.key.trim() === par.key.trim()) {
      return { hecho: true, mensaje: `[cert] tailscaled ya tiene el certificado del llavero (caduca el ${fecha(v.caduca)}, ${v.dias} días).` };
    }
    const va = certificadoVale(actual.crt, dns, ahora);
    if (va.vale && va.caduca > v.caduca) {
      return {
        hecho: false,
        mensaje: `[cert] el nodo ya tiene un certificado MÁS NUEVO que el del llavero (caduca el ` +
          `${fecha(va.caduca)} contra ${fecha(v.caduca)}): lo respeto. Recógelo al llavero:  entornos recoger`,
      };
    }
  }
  let dir = null;
  try {
    dir = mkdtempSync(join(tmpdir(), 'tscert-'));
    const tc = join(dir, 'c.crt');
    const tk = join(dir, 'c.key');
    writeFileSync(tc, par.crt, { mode: 0o600 });
    writeFileSync(tk, par.key, { mode: 0o600 });
    for (const orden of ordenesDePonerCertificado(dns, tc, tk)) {
      const r = ejecutar(orden);
      if (!r.ok) return { hecho: false, mensaje: `[cert] no pude colocarlo en tailscaled: ${r.out.slice(-300)}` };
    }
  } finally {
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* se va con la máquina */ } }
  }
  return {
    hecho: true,
    mensaje: `[cert] certificado del llavero colocado en tailscaled (caduca el ${fecha(v.caduca)}, ` +
      `${v.dias} días): no se pide ninguno a Let's Encrypt.`,
  };
}

/**
 * Lo que va al llavero: dos líneas `TS_CERT_B64=…` y `TS_KEY_B64=…`, o null si
 * el nodo no tiene certificado. Es lo que lee `entornos recoger` del lanzador.
 */
export function exportar(dns, ejecutar = sh) {
  const par = certificadoDelNodo(dns, ejecutar);
  return par ? lineasParaExportar(par) : null;
}

/** El estado, para `cweb cert`: qué tiene el nodo, qué trae el llavero y si coinciden. */
export function estado(dns, env = process.env, ejecutar = sh, ahora = new Date()) {
  const lineas = [];
  if (!dns) {
    lineas.push('nodo          : fuera de la tailnet, no sé qué nombre tendría el certificado');
    return lineas.join('\n');
  }
  const actual = certificadoDelNodo(dns, ejecutar);
  if (actual) {
    const v = certificadoVale(actual.crt, dns, ahora);
    lineas.push(`en tailscaled : sí, para ${dns}: ${v.vale ? `vale, caduca el ${fecha(v.caduca)} (${v.dias} días)` : `NO vale: ${v.motivo}`}`);
  } else {
    lineas.push('en tailscaled : NO hay ninguno. Se pedirá a Let\'s Encrypt en el primer acceso https (1 de 5 por semana)');
  }
  const par = certificadoDelEntorno(env);
  if (par) {
    const v = certificadoVale(par.crt, dns, ahora);
    const igual = actual && actual.crt.trim() === par.crt.trim();
    lineas.push(`en el llavero : sí: ${v.vale ? `vale, caduca el ${fecha(v.caduca)}` : `NO vale: ${v.motivo}`}` +
      (actual ? (igual ? '. Es el MISMO que tiene tailscaled' : '. ⚠ DISTINTO del que tiene tailscaled') : ''));
    if (actual && !igual) {
      const va = certificadoVale(actual.crt, dns, ahora);
      lineas.push(va.vale && va.caduca > v.caduca
        ? '                el del nodo es más nuevo → recógelo:  entornos recoger  (lanzador), y luego  llavero enviar <otra>'
        : '                el del llavero es el bueno → colócalo:  tailscale  (esta sesión)');
    }
  } else {
    lineas.push('en el llavero : NO (TS_CERT_B64/TS_KEY_B64 vacías)' +
      (actual ? '. Guárdalo, o el próximo dev pedirá otro:  entornos recoger  (lanzador)' : ''));
  }
  return lineas.join('\n');
}
