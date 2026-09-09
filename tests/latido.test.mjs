// Tests de cómo la web LEE el latido del coordinador.
//
// Lo que se juega (R10): con esto la web distingue «claude está pensando» de «el
// bot está parado». Los dos se ven igual desde fuera —una conversación que no
// avanza— y equivocarse tiene coste en las dos direcciones: decir «esperando
// respuesta» por un turno de hace una hora deja un aviso puesto para siempre; y
// decir que el bot está caído cuando está trabajando hace que reinicies un
// servicio que iba bien.
//
// El contrato del fichero vive donde su productor
// (`telegram-coordinator/docs/log-de-mensajes.md`); aquí sólo se prueba que este
// lado lo respeta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { leerLatido } = await import('../server/datos.mjs');

/** Un `data/` con el latido que se le diga. */
function conLatido(contenido) {
  const raiz = mkdtempSync(join(tmpdir(), 'cweb-latido-'));
  mkdirSync(join(raiz, 'mensajes'), { recursive: true });
  if (contenido !== undefined) {
    writeFileSync(join(raiz, 'coordinador.json'),
      typeof contenido === 'string' ? contenido : JSON.stringify(contenido));
  }
  return raiz;
}

const AHORA = Date.parse('2026-09-09T21:00:00Z');
const hace = (ms) => new Date(AHORA - ms).toISOString();

test('un latido fresco: vivo, y con sus turnos', () => {
  const r = leerLatido(conLatido({
    visto: hace(3_000), vence_ms: 45_000,
    turnos: { '-100_7': { desde: hace(20_000), ejecutor: 'c' } },
  }), AHORA);
  assert.equal(r.vivo, true);
  assert.deepEqual(Object.keys(r.turnos), ['-100_7']);
});

test('⚠ si el latido VENCIÓ, los turnos se descartan con él', () => {
  const r = leerLatido(conLatido({
    visto: hace(10 * 60_000), vence_ms: 45_000,
    turnos: { '-100_7': { desde: hace(10 * 60_000), ejecutor: 'c' } },
  }), AHORA);
  assert.equal(r.vivo, false);
  assert.deepEqual(r.turnos, {},
    'un «esperando respuesta» apoyado en un fichero que dejó de refrescarse hace ' +
    'diez minutos se queda puesto para siempre tras una caída');
});

test('la caducidad se lee del PROPIO fichero, no de una constante de aquí', () => {
  // Si el coordinador cambia su ritmo de latido, esto tiene que enterarse solo.
  // Una copia de la regla en este repo sería una segunda definición que diverge.
  const raiz = conLatido({ visto: hace(60_000), vence_ms: 600_000, turnos: {} });
  assert.equal(leerLatido(raiz, AHORA).vivo, true,
    'con `vence_ms` de 10 min, un latido de hace 1 min sigue vivo');
});

test('sin fichero NO es «caído»: es un coordinador que aún no tiene esta versión', () => {
  const r = leerLatido(conLatido(undefined), AHORA);
  assert.equal(r.hay, false, 'se distingue con `hay`, para poder decirlo distinto');
  assert.equal(r.vivo, false);
});

test('un latido ilegible es una DUDA, no un «está bien»', () => {
  const r = leerLatido(conLatido('{esto no es json'), AHORA);
  assert.equal(r.hay, true);
  assert.equal(r.vivo, false);
  assert.equal(r.roto, true);
});

test('un `visto` en el futuro no cuenta como vivo', () => {
  // Un reloj mal puesto no puede convertirse en «todo bien» para siempre.
  const r = leerLatido(conLatido({ visto: hace(-60_000), vence_ms: 45_000, turnos: {} }), AHORA);
  assert.equal(r.vivo, false);
});
