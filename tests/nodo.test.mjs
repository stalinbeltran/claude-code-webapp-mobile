// Tests de la deriva de nombre del nodo en la tailnet.
//
// ⚠⚠ EL FALLO QUE ESTO CAZA, medido el 2026-09-10: `tailscale up --hostname=dev`
// salió con código 0, el `serve` quedó puesto y la web contestaba 200 — y aun
// así la app instalada en el móvil se había quedado sin servidor, porque el nodo
// había entrado en la tailnet como `dev-1`. Todo verde y todo roto.
//
// Es la lección de siempre del proyecto: **`Result=success` no dice que se
// hiciera lo que pediste.** Se comprueba el dato que decide —qué nombre te
// dieron—, no el código de salida.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nombreCorto, hayDeriva, avisoDeDeriva } from '../scripts/nodo.mjs';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));

test('el nombre corto sale del DNSName, con o sin punto final', () => {
  assert.equal(nombreCorto('dev-1.ejemplo.ts.net.'), 'dev-1');
  assert.equal(nombreCorto('dev.ejemplo.ts.net'), 'dev');
  assert.equal(nombreCorto('dev'), 'dev');
  assert.equal(nombreCorto(null), null);
  assert.equal(nombreCorto(''), null);
});

test('⚠ el caso real: se pidió `dev` y la tailnet dio `dev-1`', () => {
  assert.equal(hayDeriva('dev', 'dev-1.ejemplo.ts.net.'), true,
    'si esto no se detecta, la URL de la PWA deja de servir sin que nadie lo diga');
});

test('sin deriva no se dice nada: un aviso que sale siempre se deja de leer', () => {
  assert.equal(hayDeriva('dev', 'dev.ejemplo.ts.net.'), false);
  assert.equal(avisoDeDeriva('dev', 'dev.ejemplo.ts.net.'), '');
});

test('⚠ sin saber el nombre NO se afirma que haya deriva', () => {
  // El nodo todavía no ha entrado en la tailnet. Inventarse un problema manda a
  // borrar nodos buenos en la consola; es tan malo como callar el que hay.
  assert.equal(hayDeriva('dev', null), false);
  assert.equal(hayDeriva('dev', ''), false);
  assert.equal(avisoDeDeriva('dev', null), '');
});

test('el aviso trae las TRES cosas que hacen falta para salir del atasco', () => {
  const a = avisoDeDeriva('dev', 'dev-1.ejemplo.ts.net.', '8443');
  assert.match(a, /dev-1/, 'tiene que decir cómo se llama de verdad');
  // 1. la URL que funciona AHORA, para no quedarse tirado
  assert.match(a, /https:\/\/dev-1\.ejemplo\.ts\.net:8443\//);
  // 2. cómo recuperar el nombre estable
  assert.match(a, /login\.tailscale\.com\/admin\/machines/);
  // 3. la causa de fondo, o vuelve a pasar en el siguiente dev
  assert.match(a, /EPHEMERAL/,
    'sin authkey efímera el nodo muerto ocupa el nombre y esto se repite');
  // Y que se reconozca el síntoma que se ve desde el móvil.
  assert.match(a, /Failed to fetch/);
});

test('el puerto del aviso no se supone: se pasa', () => {
  // Aquí el 443 lo tiene `sshd`, así que el serve va en el 8443. Un aviso con la
  // URL sin puerto «parecería correcta y no cargaría», que ya costó una vuelta.
  assert.match(avisoDeDeriva('dev', 'dev-9.x.ts.net', '9999'), /dev-9\.x\.ts\.net:9999\//);
});

test('⚠⚠ el script de unir COMPRUEBA el nombre antes de dar el ✅', () => {
  // Éste es el test que falla con el código anterior: allí el script terminaba
  // en un `✅ Listo` sin haber mirado nunca qué nombre le dieron.
  const s = readFileSync(join(RAIZ, 'scripts', 'tailscale-unir.mjs'), 'utf8');
  assert.match(s, /avisoDeDeriva\(/, 'el script tiene que comprobar la deriva');
  const iDeriva = s.indexOf('avisoDeDeriva(NOMBRE');
  const iListo = s.indexOf('✅ Listo');
  assert.ok(iDeriva > 0 && iListo > 0, 'tienen que estar los dos');
  assert.ok(iDeriva < iListo,
    'la comprobación va ANTES del ✅: un final feliz que no mira el dato que ' +
    'decide es exactamente el fallo del 2026-09-10');
});

test('⚠ y el aviso del script NO puede tumbar el aprovisionamiento', () => {
  const s = readFileSync(join(RAIZ, 'scripts', 'tailscale-unir.mjs'), 'utf8');
  // Regla del coordinador: una unidad con Restart=on-failure convierte un fallo
  // al final en un BUCLE (62 relanzamientos el 2026-09-04).
  assert.match(s, /function avisar[\s\S]{0,400}catch/,
    'el aviso va envuelto en try/catch: es una comodidad, no puede matar el trabajo');
  assert.ok(!/process\.exit\([^0]/.test(s), 'este script sale siempre con 0');
});
