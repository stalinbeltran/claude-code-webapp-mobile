// Tests del certificado que viaja con la flota.
//
// ⚠⚠ EL FALLO QUE ESTO CAZA, medido el 2026-09-11: Let's Encrypt da 5 certificados
// por semana y por nombre exacto, y cada dev rehecho pedía uno nuevo porque el
// certificado moría con el droplet. El sexto dev de la semana nacía con TODO verde
// —nodo, serve, unidad— y el móvil colgado en un handshake TLS contra un 429.
//
// Lo que se fija aquí:
//   - el esquema por defecto lo decide un DATO (hay certificado o no), y nunca se
//     pide uno a Let's Encrypt sin que alguien lo diga;
//   - un certificado se coloca SÓLO si vale para el nombre que la tailnet dio, y
//     antes del `serve`, en los dos scripts que lo ponen;
//   - el contenido del par no pasa por la línea de órdenes;
//   - `cert exportar` no sale por el chat de Telegram.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publicacion, certificadoDelEntorno, certificadoVale, lineasParaExportar,
         ordenesDePonerCertificado, rutasCertificado, leerEnv } from '../scripts/nodo.mjs';
import { ponerCertificadoSiHay, estado } from '../scripts/certificado.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(RAIZ, 'tests', 'fixtures', 'certificado');
// ⚠ Un par AUTOFIRMADO y de PRUEBA para `dev.ejemplo.ts.net`, válido 100 años. No
// es secreto de nada: no existe ese nodo ni esa tailnet. Generado el 2026-09-11 con
// openssl (P-256), y está en el repo a propósito: sin él no se puede probar
// `certificadoVale`, que es lo que decide si se gasta una emisión o no.
const CRT = readFileSync(join(FIX, 'dev.ejemplo.ts.net.crt'), 'utf8');
const KEY = readFileSync(join(FIX, 'dev.ejemplo.ts.net.key'), 'utf8');
const b64 = (t) => Buffer.from(t).toString('base64');
const ENV_CON_CERT = { TS_CERT_B64: b64(CRT), TS_KEY_B64: b64(KEY) };
const fuente = (f) => readFileSync(join(RAIZ, 'scripts', f), 'utf8');

// --- el esquema lo decide un dato -------------------------------------------

test('⚠⚠ sin certificado y sin CWEB_TS_ESQUEMA se publica por http: no se pide nada a Let\'s Encrypt', () => {
  assert.equal(publicacion({}).esquema, 'http');
  assert.equal(publicacion({}).puerto, '8080');
});

test('con certificado en el entorno el defecto es https', () => {
  const p = publicacion(ENV_CON_CERT);
  assert.equal(p.esquema, 'https');
  assert.equal(p.bandera, '--https=8443');
});

test('⚠ medio par NO es un certificado: con uno solo de los dos sigue siendo http', () => {
  assert.equal(publicacion({ TS_CERT_B64: b64(CRT) }).esquema, 'http');
  assert.equal(publicacion({ TS_KEY_B64: b64(KEY) }).esquema, 'http');
  assert.equal(certificadoDelEntorno({ TS_CERT_B64: b64(CRT) }), null);
});

test('CWEB_TS_ESQUEMA explícito manda sobre el dato, en las dos direcciones', () => {
  assert.equal(publicacion({ ...ENV_CON_CERT, CWEB_TS_ESQUEMA: 'http' }).esquema, 'http');
  assert.equal(publicacion({ CWEB_TS_ESQUEMA: 'https' }).esquema, 'https');
});

test('basura en base64 no es un certificado', () => {
  assert.equal(certificadoDelEntorno({ TS_CERT_B64: 'hola', TS_KEY_B64: 'mundo' }), null);
  assert.equal(certificadoDelEntorno({ TS_CERT_B64: b64('no es pem'), TS_KEY_B64: b64(KEY) }), null);
});

// --- ida y vuelta del par ---------------------------------------------------

test('decodificar lo exportado devuelve el mismo par', () => {
  const lineas = lineasParaExportar({ crt: CRT, key: KEY });
  assert.equal(lineas.length, 2);
  assert.match(lineas[0], /^TS_CERT_B64=[A-Za-z0-9+/=]+$/);
  assert.match(lineas[1], /^TS_KEY_B64=[A-Za-z0-9+/=]+$/);
  const env = leerEnv(lineas.join('\n'));
  assert.deepEqual(certificadoDelEntorno(env), { crt: CRT, key: KEY });
});

test('cada línea exportada es UNA línea: un PEM tiene saltos y el .env no los admite', () => {
  for (const l of lineasParaExportar({ crt: CRT, key: KEY })) assert.ok(!l.includes('\n'));
});

test('leerEnv: comentarios, comillas y líneas sin forma', () => {
  const e = leerEnv('# c\nA=1\nB="dos"\nC=\'tres\'\nsin igual\n D = con espacios \n1MAL=x\n');
  assert.deepEqual(e, { A: '1', B: 'dos', C: 'tres', D: 'con espacios' });
});

// --- si VALE para este nodo --------------------------------------------------

test('vale para su nombre, con o sin punto final', () => {
  assert.equal(certificadoVale(CRT, 'dev.ejemplo.ts.net').vale, true);
  assert.equal(certificadoVale(CRT, 'dev.ejemplo.ts.net.').vale, true);
});

test('⚠⚠ el caso real: la tailnet dio `dev-1` y el certificado es de `dev`', () => {
  const v = certificadoVale(CRT, 'dev-1.ejemplo.ts.net');
  assert.equal(v.vale, false);
  assert.match(v.motivo, /dev-1\.ejemplo\.ts\.net/);
  assert.match(v.motivo, /dev\.ejemplo\.ts\.net/);
});

test('caducado no vale, y dice cuándo caducó', () => {
  const v = certificadoVale(CRT, 'dev.ejemplo.ts.net', new Date('2200-01-01T00:00:00Z'));
  assert.equal(v.vale, false);
  assert.match(v.motivo, /caducó el 2126-08-18/);
});

test('sin nombre de nodo no se afirma que valga', () => {
  assert.equal(certificadoVale(CRT, null).vale, false);
  assert.equal(certificadoVale('no es pem', 'dev.ejemplo.ts.net').vale, false);
});

// --- cómo se coloca ----------------------------------------------------------

test('las rutas son las que lee tailscaled: <dir>/<dominio>.crt y .key', () => {
  assert.deepEqual(rutasCertificado('dev.ejemplo.ts.net.'), {
    crt: '/var/lib/tailscale/certs/dev.ejemplo.ts.net.crt',
    key: '/var/lib/tailscale/certs/dev.ejemplo.ts.net.key',
  });
  assert.equal(rutasCertificado(''), null);
});

test('⚠⚠ el contenido NO pasa por la línea de órdenes: sólo rutas, y la clave queda 0600', () => {
  const ordenes = ordenesDePonerCertificado('dev.ejemplo.ts.net', '/tmp/x/c.crt', '/tmp/x/c.key');
  assert.equal(ordenes.length, 3);
  for (const o of ordenes) {
    assert.ok(!o.includes('BEGIN'), o);
    assert.match(o, /^sudo -n install /);
  }
  assert.match(ordenes[1], /-m 0644 .*\/tmp\/x\/c\.crt \/var\/lib\/tailscale\/certs\/dev\.ejemplo\.ts\.net\.crt$/);
  assert.match(ordenes[2], /-m 0600 .*\/tmp\/x\/c\.key \/var\/lib\/tailscale\/certs\/dev\.ejemplo\.ts\.net\.key$/);
});

/** Un `sudo -n cat`/`install` fingido: `almacen` es lo que tailscaled tendría. */
function ejecutorFingido(almacen = {}) {
  const ordenes = [];
  return {
    ordenes,
    ejecutar: (cmd) => {
      ordenes.push(cmd);
      const m = cmd.match(/^sudo -n cat (\S+)$/);
      if (m) return almacen[m[1]] ? { ok: true, out: almacen[m[1]].trim() } : { ok: false, out: 'No such file' };
      const i = cmd.match(/^sudo -n install -m \d+ -o root -g root (\S+) (\S+)$/);
      if (i) { almacen[i[2]] = readFileSync(i[1], 'utf8'); return { ok: true, out: '' }; }
      return { ok: true, out: '' };
    },
  };
}

test('sin par en el entorno NO coloca nada y AVISA de que se va a pedir uno (1 de 5)', () => {
  const f = ejecutorFingido();
  const r = ponerCertificadoSiHay('dev.ejemplo.ts.net', {}, f.ejecutar);
  assert.equal(r.hecho, false);
  assert.match(r.mensaje, /Let's Encrypt/);
  assert.match(r.mensaje, /1 de los 5/);
  assert.match(r.mensaje, /entornos recoger/);
  assert.equal(f.ordenes.filter((o) => o.includes('install')).length, 0);
});

test('⚠ con par que no es de este nodo NO coloca nada y dice por qué', () => {
  const f = ejecutorFingido();
  const r = ponerCertificadoSiHay('dev-1.ejemplo.ts.net', ENV_CON_CERT, f.ejecutar);
  assert.equal(r.hecho, false);
  assert.match(r.mensaje, /NO vale/);
  assert.equal(f.ordenes.filter((o) => o.includes('install')).length, 0);
});

test('con par válido lo coloca: 3 órdenes, y en el almacén queda el par entero', () => {
  const almacen = {};
  const f = ejecutorFingido(almacen);
  const r = ponerCertificadoSiHay('dev.ejemplo.ts.net', ENV_CON_CERT, f.ejecutar);
  assert.equal(r.hecho, true, r.mensaje);
  assert.match(r.mensaje, /colocado/);
  assert.match(r.mensaje, /2126-08-18/);
  assert.equal(almacen['/var/lib/tailscale/certs/dev.ejemplo.ts.net.crt'], CRT);
  assert.equal(almacen['/var/lib/tailscale/certs/dev.ejemplo.ts.net.key'], KEY);
});

test('si tailscaled YA tiene ese mismo par, no se vuelve a escribir', () => {
  const almacen = {
    '/var/lib/tailscale/certs/dev.ejemplo.ts.net.crt': CRT,
    '/var/lib/tailscale/certs/dev.ejemplo.ts.net.key': KEY,
  };
  const f = ejecutorFingido(almacen);
  const r = ponerCertificadoSiHay('dev.ejemplo.ts.net', ENV_CON_CERT, f.ejecutar);
  assert.equal(r.hecho, true);
  assert.match(r.mensaje, /ya tiene/);
  assert.equal(f.ordenes.filter((o) => o.includes('install')).length, 0);
});

test('el estado dice las dos mitades: qué tiene tailscaled y qué trae el llavero', () => {
  const vacio = ejecutorFingido();
  const s1 = estado('dev.ejemplo.ts.net', {}, vacio.ejecutar);
  assert.match(s1, /en tailscaled : NO hay ninguno/);
  assert.match(s1, /en el llavero : NO/);
  const lleno = ejecutorFingido({
    '/var/lib/tailscale/certs/dev.ejemplo.ts.net.crt': CRT,
    '/var/lib/tailscale/certs/dev.ejemplo.ts.net.key': KEY,
  });
  const s2 = estado('dev.ejemplo.ts.net', ENV_CON_CERT, lleno.ejecutar);
  assert.match(s2, /en tailscaled : sí/);
  assert.match(s2, /MISMO que tiene tailscaled/);
  // ⚠ Y el estado NUNCA imprime el par: sólo fechas y veredictos.
  assert.ok(!s1.includes('BEGIN') && !s2.includes('BEGIN'));
  assert.ok(!s2.includes(b64(KEY).slice(0, 20)));
});

// --- los scripts que ponen el serve ------------------------------------------

test('⚠⚠ los DOS scripts colocan el certificado ANTES de la orden del serve, y sólo con https', () => {
  // En `unir` el serve se pone llamando a `ponerServe()`; en `serve`, en línea.
  const llamada = { 'tailscale-unir.mjs': 'let r = ponerServe()', 'tailscale-serve.mjs': 'const r = sh(ordenDeServir(PUB' };
  for (const f of ['tailscale-unir.mjs', 'tailscale-serve.mjs']) {
    const s = fuente(f);
    const pone = s.indexOf('ponerCertificadoSiHay(');
    const sirve = s.indexOf(llamada[f]);
    assert.ok(pone > 0, `${f}: no coloca el certificado`);
    assert.ok(sirve > 0, `${f}: no encuentro dónde pone el serve`);
    assert.ok(pone < sirve, `${f}: lo coloca DESPUÉS del serve, y tailscaled ya habría pedido uno`);
    assert.match(s, /PUB\.esquema === 'https'\) console\.log\(ponerCertificadoSiHay\(/, `${f}: lo coloca sin mirar el esquema`);
  }
});

test('⚠ y leen el .env del repo, que es donde el lanzador deja TS_*: publicacion(ENV), no publicacion()', () => {
  for (const f of ['tailscale-unir.mjs', 'tailscale-serve.mjs', 'cweb.mjs']) {
    const s = fuente(f);
    assert.match(s, /const ENV = conEnvDelRepo\(RAIZ\)/, `${f}: no lee el .env`);
    assert.match(s, /const PUB = publicacion\(ENV\)/, `${f}: publicacion sin el entorno del repo`);
    assert.ok(!/= publicacion\(\)/.test(s), `${f}: hay un publicacion() sin entorno`);
  }
});

test('⚠⚠ `cert exportar` NO sale por el chat: el ejecutor de Telegram lo rechaza', () => {
  const ex = JSON.parse(readFileSync(join(RAIZ, 'telegram', 'executors', 'cweb.json'), 'utf8'));
  assert.match(ex.command, /"cert exportar"\*\)/);
  assert.match(ex.command, /entornos recoger/);
  assert.ok(ex.ejemplos.includes('cert'));
  assert.ok(!ex.ejemplos.some((e) => /exportar/.test(e)));
});
