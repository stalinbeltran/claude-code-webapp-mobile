// Tests de la PWA: el manifest y el service worker.
//
// ⚠⚠ El caso que de verdad importa aquí no es «que se pueda instalar»: es que el
// service worker **no reintroduzca por la puerta de atrás** el fallo que el resto
// del servidor evita con `cache-control: no-store`. Un armazón viejo servido
// desde caché es indistinguible de un servidor caído: abres la app, ves lo de
// siempre, y no hay forma de saber que estás mirando una versión de hace tres
// despliegues. Por eso va RED PRIMERO, y la caché sólo cuando la red falla.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(dirname(fileURLToPath(import.meta.url))), 'web');
const manifest = JSON.parse(readFileSync(join(WEB, 'manifest.webmanifest'), 'utf8'));
const sw = readFileSync(join(WEB, 'sw.js'), 'utf8');

/** Las rutas que el service worker precachea, sacadas del propio array. */
const armazon = () => [...sw.match(/const ARMAZON = \[([\s\S]*?)\];/)[1]
  .matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('el manifest trae lo que la instalación exige', () => {
  for (const campo of ['name', 'short_name', 'start_url', 'display', 'icons']) {
    assert.ok(manifest[campo], `sin \`${campo}\` el navegador no ofrece instalarla`);
  }
  assert.equal(manifest.display, 'standalone', 'instalada tiene que abrirse sin barra del navegador');
  assert.ok(manifest.icons.some((i) => i.purpose?.includes('maskable')),
    'sin un icono `maskable`, Android lo mete en una caja blanca');
  for (const i of manifest.icons) {
    assert.ok(existsSync(join(WEB, i.src.replace(/^\//, ''))), `falta el icono ${i.src}`);
  }
});

test('⚠ el service worker va a la RED primero, no a la caché', () => {
  // El orden importa y se comprueba en el orden real del código: la llamada a
  // `fetch` tiene que estar ANTES del `caches.match`.
  const iFetch = sw.indexOf('await fetch(e.request)');
  const iCache = sw.indexOf('caches.match(e.request)');
  assert.ok(iFetch > 0 && iCache > 0, 'tienen que estar los dos');
  assert.ok(iFetch < iCache,
    'con la caché primero, un despliegue nuevo no llegaría al móvil hasta vaciarla ' +
    'a mano — y la app parecería congelada sin decir por qué');
  assert.match(sw, /catch\b[\s\S]{0,200}caches\.match/,
    'la caché sólo puede entrar en el camino de error');
});

test('⚠ el service worker NO toca `/api/`: los datos vienen siempre del servidor', () => {
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)/);
  assert.ok(!armazon().some((r) => r.startsWith('/api')),
    'ni una ruta de API en lo que se precachea');
  // Enseñar una conversación de ayer como si fuera de ahora es justo lo que el
  // aviso de «el bot parece parado» existe para evitar.
});

test('las cachés viejas se borran al activar', () => {
  assert.match(sw, /caches\.keys\(\)/);
  assert.match(sw, /caches\.delete/, 'si no, ocupan sitio en el móvil para siempre');
});

test('todo lo que precachea el armazón EXISTE', () => {
  const rutas = armazon();
  assert.ok(rutas.length >= 5);
  for (const r of rutas) {
    const f = r === '/' ? join(WEB, 'index.html') : join(WEB, r.replace(/^\//, ''));
    assert.ok(existsSync(f), `el armazón precachea ${r} y no existe: install fallaría entero`);
  }
});
