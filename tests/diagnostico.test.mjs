// Tests del mensaje que ve el usuario cuando la app no alcanza su servidor.
//
// ⚠⚠ EL CASO REAL, 2026-09-10: la app decía «No pude leer las conversaciones:
// Failed to fetch» y nada más. El servidor estaba PERFECTO (200 por su nombre
// nuevo); lo que había cambiado era el nombre del nodo en la tailnet. Con ese
// texto no hay forma de distinguir eso de «no hay red», de «Tailscale apagado»
// ni de «el servidor está caído», así que se leyó como «la app está rota».
//
// Y el service worker hace que sea el caso MÁS confuso, no el más raro: sirve el
// armazón desde caché cuando la red falla, así que la app **abre normal** y sólo
// fallan los datos. Abrir bien es justo lo que te convence de que el servidor
// está ahí.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SinRed, explicarFallo } from '../web/diagnostico.js';

const WEB = join(dirname(dirname(fileURLToPath(import.meta.url))), 'web');

test('si el servidor CONTESTÓ, manda su código: dice más que nada que inventemos', () => {
  const m = explicarFallo(new Error('500 en /api/sesiones'), 'leer las conversaciones', 'https://x');
  assert.match(m, /500 en \/api\/sesiones/);
  assert.ok(!m.includes('Tailscale'),
    'un 500 no es un problema de red: mandar a mirar Tailscale despista');
});

test('⚠⚠ si NO se llegó, se nombra el origen contra el que se falló', () => {
  const e = new SinRed(new TypeError('Failed to fetch'), '/api/sesiones');
  const m = explicarFallo(e, 'leer las conversaciones', 'https://dev.ejemplo.ts.net:8443');
  assert.match(m, /dev\.ejemplo\.ts\.net:8443/,
    'sin decir contra QUÉ falló no se puede depurar desde un móvil');
});

test('el mensaje avisa de que lo que se ve viene de la CACHÉ', () => {
  const m = explicarFallo(new SinRed(new TypeError('Failed to fetch')), 'leer', 'https://x');
  // Se comprueba lo que el mensaje SIGNIFICA, no una palabra concreta: al
  // usuario le sirve más «guardado en el móvil» que el término «caché».
  assert.match(m, /guardado en el m[óo]vil/i, 'tiene que decir que no es de ahora');
  assert.match(m, /no datos de ahora/i,
    'que la app abra bien es lo que convence de que el servidor está ahí');
});

test('da las dos causas reales, y la del nombre es la que costó el día', () => {
  const m = explicarFallo(new SinRed(new TypeError('Failed to fetch')), 'leer', 'https://x');
  assert.match(m, /Tailscale/, 'causa 1: el móvil fuera de la tailnet');
  assert.match(m, /CAMBI[ÓO] DE NOMBRE|cambió de nombre/i, 'causa 2: la máquina se rehízo');
  assert.match(m, /cweb/, 'y cómo conseguir la dirección de ahora, desde Telegram');
});

test('`SinRed` se distingue de un error normal por un DATO, no por el texto', () => {
  // Casar por el mensaje ("Failed to fetch") ataría esto al idioma y a la
  // versión del navegador: Safari dice otra cosa distinta que Chrome.
  assert.equal(new SinRed(new Error('x')).sinRed, true);
  assert.equal(new Error('x').sinRed, undefined);
});

test('no revienta si lo que llega no es un Error', () => {
  assert.match(explicarFallo('vaya', 'leer', 'https://x'), /vaya/);
  assert.doesNotThrow(() => explicarFallo(undefined, 'leer', ''));
});

test('⚠ la app USA esto de verdad, y separa los dos fallos en `api()`', () => {
  // El test que falla con el código anterior: allí `api()` dejaba escapar el
  // TypeError de `fetch` y el catch pintaba `e.message` a pelo.
  const app = readFileSync(join(WEB, 'app.js'), 'utf8');
  assert.match(app, /import \{ SinRed, explicarFallo \}/);
  assert.match(app, /throw new SinRed/, '`api()` tiene que marcar el fallo de red');
  assert.ok(!/No pude leer las conversaciones: \$\{e\.message\}/.test(app),
    'ese mensaje es justo el que no servía para nada');
});

test('⚠ y el armazón precachea `diagnostico.js`: si no, offline la app ni arranca', () => {
  const sw = readFileSync(join(WEB, 'sw.js'), 'utf8');
  assert.match(sw, /'\/diagnostico\.js'/,
    'app.js lo importa al cargar: sin él en el armazón, el import falla sin red');
});

test('⚠ y el aviso se pinta con sus saltos de línea', () => {
  const css = readFileSync(join(WEB, 'estilo.css'), 'utf8');
  const bloque = css.split('.error {')[1].split('}')[0];
  assert.match(bloque, /white-space:\s*pre-line/,
    'sin esto la lista numerada se pega en un párrafo y no se lee en el móvil');
});
