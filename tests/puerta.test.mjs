// Tests de LA PUERTA: quién entra cuando la web está en un puerto público.
//
// ⚠⚠ ES EL ÚNICO FALLO DE ESTE REPO QUE SE PAGA CON LA MÁQUINA, así que va con
// el esfuerzo que pide la R10. Desde el 2026-09-12 no hay Tailscale (decisión del
// dueño), y sin Tailscale y sin túnel la única forma de que un móvil llegue es el
// puerto público del droplet. Por ese puerto se llega al mismo sitio que un
// mensaje de Telegram —una máquina donde `claude` corre con `bypassPermissions`—
// **sin la allowlist del bot**.
//
// Por eso no basta con probar la función: hay un test que **arranca el servidor
// de verdad, se ata al comodín y se conecta desde una IP no-loopback de esta
// misma máquina**, que es lo que haría alguien de fuera. Una invariante que
// importa es un test, no una frase (R14).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { autorizado, cookieDe, esLocal, iguales, COOKIE } from '../server/puerta.mjs';

const TOKEN = 'token-de-prueba-no-es-el-real';

// ------------------------------------------------------------- las piezas

test('⚠⚠ sin token configurado NO pasa nada que no sea local', () => {
  // El freno va en los DOS sitios: no se ata un puerto público sin token, y aun
  // si alguien lo atara a mano, la puerta sigue cerrada.
  const r = autorizado({ local: false, consulta: 'loquesea', cookies: `${COOKIE}=x`, tokenBueno: '' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /no hay token/);
});

test('por loopback se pasa sin token: quien está dentro, está dentro', () => {
  // De ahí cuelgan la sonda de `cweb estado` y el túnel SSH de emergencia.
  assert.equal(autorizado({ local: true, tokenBueno: '' }).ok, true);
  assert.equal(autorizado({ local: true, tokenBueno: TOKEN }).via, 'loopback');
});

test('con token: vale `?t=` y vale la cookie', () => {
  assert.equal(autorizado({ local: false, consulta: TOKEN, tokenBueno: TOKEN }).via, 'query');
  assert.equal(autorizado({ local: false, cookies: `${COOKIE}=${TOKEN}`, tokenBueno: TOKEN }).via, 'cookie');
  // La query es cómo se pega un enlace en un móvil; la cookie es lo que hace que
  // las llamadas a `/api/…` de después entren sin arrastrarlo en cada URL.
});

test('⚠ y NO vale nada más: ni vacío, ni parecido, ni prefijo', () => {
  for (const malo of ['', ' ', 'x', TOKEN.slice(0, -1), TOKEN + 'x', TOKEN.toUpperCase()]) {
    assert.equal(autorizado({ local: false, consulta: malo, tokenBueno: TOKEN }).ok, false,
      `«${malo}» no puede entrar`);
    assert.equal(autorizado({ local: false, cookies: `${COOKIE}=${malo}`, tokenBueno: TOKEN }).ok, false);
  }
});

test('⚠ la comparación no se rinde antes de tiempo (ni longitudes ni prefijos)', () => {
  assert.equal(iguales('abc', 'abc'), true);
  assert.equal(iguales('abc', 'abd'), false);
  assert.equal(iguales('abc', 'abcd'), false, 'un prefijo no es el token');
  assert.equal(iguales('abcd', 'abc'), false);
  assert.equal(iguales('', ''), false, 'vacío contra vacío NO es entrar');
  assert.equal(iguales(null, undefined), false);
});

test('esLocal entiende las formas en que llega loopback', () => {
  for (const d of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(esLocal(d), true, d);
  for (const d of ['64.227.27.32', '10.0.0.1', '', null, '0.0.0.0']) assert.equal(esLocal(d), false, String(d));
});

test('la cookie se saca de una cabecera con varias', () => {
  assert.equal(cookieDe(`a=1; ${COOKIE}=XYZ; b=2`, COOKIE), 'XYZ');
  assert.equal(cookieDe('a=1; b=2', COOKIE), '');
  assert.equal(cookieDe('', COOKIE), '');
  assert.equal(cookieDe(null, COOKIE), '');
});

// ------------------------------------------- el servidor de verdad, de fuera

/** Una IP de esta máquina que NO sea loopback: lo que usaría alguien de fuera. */
function ipNoLoopback() {
  return Object.values(networkInterfaces()).flat()
    .find((i) => i && !i.internal && i.family === 'IPv4')?.address ?? null;
}

test('⚠⚠ EN VIVO: atado al comodín, de fuera NO se entra sin token y SÍ con él', async (t) => {
  const ip = ipNoLoopback();
  if (!ip) return t.skip('esta máquina no tiene ninguna IP no-loopback');

  process.env.CWEB_TOKEN = TOKEN;
  const raiz = mkdtempSync(join(tmpdir(), 'cweb-puerta-'));
  mkdirSync(join(raiz, 'mensajes'), { recursive: true });
  writeFileSync(join(raiz, 'mensajes', 'x.jsonl'), '');

  const { crearServidor } = await import('../server/index.mjs');
  const server = crearServidor(raiz);
  await new Promise((r) => server.listen(0, '0.0.0.0', r));
  const puerto = server.address().port;

  try {
    const sin = await fetch(`http://${ip}:${puerto}/api/salud`);
    assert.equal(sin.status, 401,
      '⚠⚠ SIN TOKEN Y DESDE FUERA SE ENTRÓ: hay un shell abierto a Internet');

    const raiz2 = await fetch(`http://${ip}:${puerto}/`);
    assert.equal(raiz2.status, 401, 'ni siquiera el armazón: la puerta va ANTES de las rutas');

    const con = await fetch(`http://${ip}:${puerto}/api/salud?t=${TOKEN}`);
    assert.equal(con.status, 200, 'con el token sí, o la app no sirve para nada');
    assert.match(con.headers.get('set-cookie') ?? '', new RegExp(`^${COOKIE}=`),
      'y deja la cookie, para que las llamadas de después no arrastren el token');

    // Loopback, sin token, entra: es la sonda de `cweb estado`.
    const local = await fetch(`http://127.0.0.1:${puerto}/api/salud`);
    assert.equal(local.status, 200);
  } finally {
    delete process.env.CWEB_TOKEN;
    await new Promise((r) => server.close(r));
  }
});
