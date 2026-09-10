// Tests de «cambiar la dirección del servidor sin reinstalar la app».
//
// ⚠⚠ EL FALLO QUE ESTO EVITA, medido el 2026-09-10: la PWA instalada guarda un
// `start_url` FIJO. Cuando la máquina se rehizo y el nodo entró en la tailnet
// como `dev-2`, el icono del móvil abría una app que no podía hablar con nadie,
// y la única salida documentada era **reinstalarla** — que es exactamente lo
// que no se hace desde un móvil cuando sólo querías leer algo.
//
// Y el fallo que hay que no cometer AL ARREGLARLO es peor que el original: una
// dirección mal guardada deja el icono saltando para siempre a un sitio que no
// existe, sin forma de corregirlo. De ahí el escape y el anti-bucle, que son
// las dos cosas que más se prueban aquí.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLAVE, ESCAPE, normalizarDireccion, decidirArranque,
         leerGuardada, guardarDireccion, olvidarDireccion } from '../web/direccion.js';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));

// ------------------------------------------------------- normalizar

test('lo que se teclea en un móvil vale: sin esquema, con ruta y con mayúsculas', () => {
  // Nadie escribe `https://` a mano en un teléfono.
  assert.equal(normalizarDireccion('dev.tured.ts.net:8443').origen, 'https://dev.tured.ts.net:8443');
  assert.equal(normalizarDireccion('https://dev.tured.ts.net:8443/').origen, 'https://dev.tured.ts.net:8443');
  assert.equal(normalizarDireccion('  DEV.tured.ts.net:8443  ').origen, 'https://dev.tured.ts.net:8443');
});

test('⚠ se guarda SÓLO el origen, nunca la ruta', () => {
  // Pegar la URL con `/api/salud` o con el `?aqui` del escape es lo normal al
  // copiar de un mensaje. Guardar la ruta haría que el salto acabara en un
  // sitio que no es la app — o, con el escape pegado, que no volviera a saltar.
  assert.equal(normalizarDireccion('dev.tured.ts.net:8443/api/salud').origen,
    'https://dev.tured.ts.net:8443');
  assert.equal(normalizarDireccion(`https://dev.tured.ts.net:8443/?${ESCAPE}=1`).origen,
    'https://dev.tured.ts.net:8443');
});

test('⚠ sólo https, salvo loopback', () => {
  // Se entra por `tailscale serve`, que ES https. Un http:// aquí es un error
  // de tecleo o alguien mandándote a otro sitio.
  assert.equal(normalizarDireccion('http://ejemplo.com').ok, false);
  assert.equal(normalizarDireccion('http://localhost:8020').origen, 'http://localhost:8020');
  assert.equal(normalizarDireccion('http://127.0.0.1:8020').origen, 'http://127.0.0.1:8020');
});

test('lo que no es una dirección se RECHAZA con un motivo legible', () => {
  for (const malo of ['', '   ', 'no es una url', 'javascript:alert(1)']) {
    const r = normalizarDireccion(malo);
    assert.equal(r.ok, false, `«${malo}» no debería pasar`);
    assert.ok(r.motivo && r.motivo.length > 10, 'un rechazo sin motivo no se puede corregir desde el móvil');
  }
});

// ------------------------------------------------------- el salto

test('sin nada guardado NO se salta: es el caso normal y no puede costar nada', () => {
  assert.equal(decidirArranque({ guardada: null, origenActual: 'https://dev.x.ts.net:8443' }).ir, null);
});

test('⚠⚠ si lo guardado ES este origen no se salta: sería un BUCLE de recargas', () => {
  // El peor fallo posible aquí: la app quedaría inservible sin llegar a pintar
  // ni un mensaje que explicara por qué.
  const o = 'https://dev.x.ts.net:8443';
  assert.equal(decidirArranque({ guardada: o, origenActual: o }).ir, null);
});

test('con otra dirección guardada, se salta a ella', () => {
  assert.equal(
    decidirArranque({ guardada: 'https://dev.x.ts.net:8443', origenActual: 'https://dev-2.x.ts.net:8443' }).ir,
    'https://dev.x.ts.net:8443');
});

test('⚠⚠ el escape manda SOBRE TODO, y por eso va primero', () => {
  // Es la salida de emergencia: una dirección guardada que ya no responde
  // dejaría el icono del móvil saltando siempre a un sitio muerto. Una salida
  // que dependa de que el resto esté bien no es una salida.
  assert.equal(decidirArranque({
    guardada: 'https://dev.x.ts.net:8443',
    origenActual: 'https://dev-2.x.ts.net:8443',
    escape: true,
  }).ir, null);
});

// ------------------------------------------------------- el almacén

test('guardar, leer y olvidar', () => {
  const mem = new Map();
  const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v),
               removeItem: (k) => mem.delete(k) };
  assert.equal(leerGuardada(st), null);
  assert.equal(guardarDireccion(st, 'https://dev.x.ts.net:8443'), true);
  assert.equal(mem.get(CLAVE), 'https://dev.x.ts.net:8443');
  assert.equal(leerGuardada(st), 'https://dev.x.ts.net:8443');
  olvidarDireccion(st);
  assert.equal(leerGuardada(st), null);
});

test('⚠ un almacén que LANZA no puede tumbar la app', () => {
  // En modo incógnito de algunos navegadores `localStorage` existe y lanza al
  // escribir. Caerse entera por no poder guardar una preferencia sería cambiar
  // un problema por otro peor.
  const roto = { getItem() { throw new Error('nope'); }, setItem() { throw new Error('nope'); },
                 removeItem() { throw new Error('nope'); } };
  assert.equal(leerGuardada(roto), null);
  assert.equal(guardarDireccion(roto, 'https://x.ts.net'), false, 'y se DICE que no se pudo');
  assert.equal(olvidarDireccion(roto), false);
  assert.doesNotThrow(() => leerGuardada(undefined));
});

// ------------------------------------------------------- que llegue al móvil

test('⚠⚠ los controles para cambiar de servidor están en la PLANTILLA', () => {
  const plantilla = readFileSync(join(RAIZ, 'web', 'plantilla.js'), 'utf8');
  assert.match(plantilla, /usarDireccion/, 'sin el botón, la lógica no la alcanza nadie');
  assert.match(plantilla, /direccionEscrita/, 'y sin el campo, no hay dónde escribirla');
  assert.match(plantilla, /olvidarServidor/, 'y hay que poder deshacerlo');
  // Y sale bajo el error de red, no en un menú: es cuando hace falta.
  assert.match(plantilla, /v-if="error"[\s\S]{0,400}Cambiar la dirección del servidor/);
});

test('⚠ el diagnóstico ya NO manda a reinstalar la app', () => {
  const diag = readFileSync(join(RAIZ, 'web', 'diagnostico.js'), 'utf8');
  const texto = diag.slice(diag.indexOf('export function explicarFallo'));
  assert.ok(!/vuelve a instalar/i.test(texto),
    'reinstalar dejó de hacer falta; un consejo viejo se sigue igual, porque ' +
    'quien lo lee no puede saber que lo es');
  assert.match(texto, /no he podido preguntár|no he podido preguntar/i,
    'y dice lo que NO sabe: con el servidor inalcanzable no se puede afirmar nada de él');
});

test('⚠ el salto ocurre ANTES de montar la app, y con `replace`', () => {
  // Las dos cosas del pegamento que se rompen en silencio:
  //
  // 1. Si el salto fuera después de `createApp`, la app pintaría la lista vacía
  //    y el 🔴 durante un instante antes de irse — o sea enseñaría un error que
  //    no es el suyo, que es justo lo que este mecanismo existe para no hacer.
  // 2. `location.href` deja el origen MUERTO en el historial, así que el botón
  //    «atrás» del móvil vuelve a él y vuelve a saltar. `replace` no.
  //
  // ⚠ Esto NO sustituye a probarlo en un navegador, que aquí no hay ninguno.
  // Fija la forma, no el comportamiento.
  const app = readFileSync(join(RAIZ, 'web', 'app.js'), 'utf8');
  const iSalto = app.indexOf('decidirArranque(');
  const iMonta = app.indexOf('createApp(');
  assert.ok(iSalto > 0, 'app.js tiene que consultar `decidirArranque`');
  assert.ok(iMonta > 0);
  assert.ok(iSalto < iMonta,
    'el salto va antes de montar: si no, se enseña un error que no es el de esta máquina');
  assert.match(app, /location\.replace\(/,
    '`href` dejaría el origen muerto en el historial y el «atrás» del móvil volvería a saltar');
});
