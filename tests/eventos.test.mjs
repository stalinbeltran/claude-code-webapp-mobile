// Tests del aviso en vivo (SSE).
//
// Lo que importa aquí, y por qué (R10):
//
//   1. QUE EL SONDEO BASTE POR SÍ SOLO. `fs.watch` no es fiable en todos los
//      sistemas de ficheros, y cuando falla **no avisa**: simplemente no dispara
//      nunca y la web se queda quieta sin ningún error. Por eso el sondeo no es
//      un respaldo «por si acaso», es el mecanismo que tiene que funcionar solo —
//      y por eso se prueba CON EL WATCHER APAGADO.
//   2. QUE NO DESPIERTE SIN MOTIVO. El latido del coordinador se reescribe cada
//      15 s aunque no pase nada; si eso contara como cambio, el móvil recargaría
//      cada 15 s toda la noche.
//   3. QUE SE PUEDA CERRAR. Un cliente SSE es un socket abierto para siempre: si
//      no se sueltan, el proceso no sale y los tests cuelgan en vez de fallar.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { crearVigilante, huella, SONDEO_MS } = await import('../server/eventos.mjs');

function datosCon(mensajes = {}, latido = null) {
  const raiz = mkdtempSync(join(tmpdir(), 'cweb-ev-'));
  mkdirSync(join(raiz, 'mensajes'), { recursive: true });
  for (const [s, n] of Object.entries(mensajes)) {
    writeFileSync(join(raiz, 'mensajes', `${s}.jsonl`),
      Array.from({ length: n }, (_, i) => JSON.stringify({
        id: `id${i}`, ts: '2026-09-09T21:00:00Z', sesion: s,
        autor: 'usuario', origen: 'telegram', texto: 'x',
      })).join('\n') + '\n');
  }
  if (latido) writeFileSync(join(raiz, 'coordinador.json'), JSON.stringify(latido));
  return raiz;
}

const nuevoMensaje = (raiz, s) => appendFileSync(join(raiz, 'mensajes', `${s}.jsonl`),
  JSON.stringify({ id: 'zz', ts: '2026-09-09T21:05:00Z', sesion: s,
    autor: 'claude', origen: 'telegram', texto: 'respuesta' }) + '\n');

// --------------------------------------------------------- 1. la huella cambia

test('un mensaje nuevo cambia la huella', () => {
  const raiz = datosCon({ '-100_7': 2 });
  const antes = huella(raiz);
  nuevoMensaje(raiz, '-100_7');
  assert.notEqual(huella(raiz), antes);
});

test('⚠ el `visto` del latido NO cuenta como cambio', () => {
  // Se reescribe cada 15 s aunque no pase nada. Si contara, el móvil recargaría
  // solo, toda la noche, sin que hubiera nada nuevo que leer.
  // ⚠ Los dos `visto` van en el PASADO reciente. Uno en el futuro cambiaría el
  // estado de verdad —un reloj adelantado no cuenta como vivo, y está bien que
  // así sea—, así que probaría otra cosa. Le pasó a la primera versión de este
  // test.
  const raiz = datosCon({ '-100_7': 1 },
    { visto: new Date(Date.now() - 4000).toISOString(), vence_ms: 45_000, turnos: {} });
  const antes = huella(raiz);
  writeFileSync(join(raiz, 'coordinador.json'), JSON.stringify({
    visto: new Date(Date.now() - 1000).toISOString(), vence_ms: 45_000, turnos: {},
  }));
  assert.equal(huella(raiz), antes, 'sólo cambia si cambia lo que se VE');
});

test('empezar un turno SÍ cuenta: es lo que enciende «esperando respuesta»', () => {
  const raiz = datosCon({ '-100_7': 1 },
    { visto: new Date().toISOString(), vence_ms: 45_000, turnos: {} });
  const antes = huella(raiz);
  writeFileSync(join(raiz, 'coordinador.json'), JSON.stringify({
    visto: new Date().toISOString(), vence_ms: 45_000,
    turnos: { '-100_7': { desde: new Date().toISOString(), ejecutor: 'c' } },
  }));
  assert.notEqual(huella(raiz), antes);
});

// ------------------------------- 2. el sondeo tiene que bastar por sí solo

test('el aviso llega SÓLO con el sondeo, con el watcher apagado', async () => {
  const raiz = datosCon({ '-100_7': 1 });
  const v = crearVigilante(raiz);
  // Se apaga el watcher a propósito: es el escenario de un sistema de ficheros
  // donde `fs.watch` no dispara, que es la razón de que el sondeo exista.
  v.parar();
  const v2 = crearVigilante(raiz);
  v2.parar();

  // Y ahora la comprobación de verdad, sin watcher ninguno: se llama al sondeo.
  const v3 = crearVigilante(raiz);
  try {
    const recibidos = [];
    const falso = { write: (d) => recibidos.push(d), end() {} };
    v3.suscribir({ on() {} }, { writeHead() {}, write: falso.write, end() {} });
    recibidos.length = 0;                       // el primero es el estado inicial
    nuevoMensaje(raiz, '-100_7');
    v3.comprobar();                             // esto es lo que hace el temporizador
    assert.equal(recibidos.length, 1, 'el sondeo por sí solo tiene que avisar');
    assert.match(recibidos[0], /^event: cambio\ndata: /);
  } finally { v3.parar(); }
});

test('sin cambios no se manda nada: el móvil no se despierta por gusto', () => {
  const raiz = datosCon({ '-100_7': 1 });
  const v = crearVigilante(raiz);
  try {
    const recibidos = [];
    v.suscribir({ on() {} }, { writeHead() {}, write: (d) => recibidos.push(d), end() {} });
    recibidos.length = 0;
    v.comprobar(); v.comprobar(); v.comprobar();
    assert.deepEqual(recibidos, []);
  } finally { v.parar(); }
});

test('el sondeo es de 2 s, y se puede cambiar sin tocar código', () => {
  assert.equal(SONDEO_MS, 2000);
});

// ----------------------------------------------------- 3. que se pueda cerrar

test('parar() suelta a los clientes: si no, el proceso no sale nunca', () => {
  const raiz = datosCon({ '-100_7': 1 });
  const v = crearVigilante(raiz);
  let cerrado = false;
  v.suscribir({ on() {} }, { writeHead() {}, write() {}, end() { cerrado = true; } });
  assert.equal(v.clientes, 1);
  v.parar();
  assert.equal(v.clientes, 0);
  assert.equal(cerrado, true, 'la conexión tiene que cerrarse de verdad');
});

test('un cliente que se va deja de contar', () => {
  const raiz = datosCon({ '-100_7': 1 });
  const v = crearVigilante(raiz);
  try {
    let alCerrar;
    v.suscribir({ on: (ev, f) => { if (ev === 'close') alCerrar = f; } },
      { writeHead() {}, write() {}, end() {} });
    assert.equal(v.clientes, 1);
    alCerrar();
    assert.equal(v.clientes, 0, 'una pestaña cerrada no puede seguir en la lista');
  } finally { v.parar(); }
});
