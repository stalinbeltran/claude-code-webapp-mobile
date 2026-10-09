// Tests de `web/borradores.js`: lo escrito y lo enviado no se pierden.
//
// Pedido el 2026-10-09: una recarga se llevaba lo escrito sin enviar, y un
// envío con el servidor ocupado podía no volver nunca sin dejar copia.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PREFIJO_BORRADOR, MAX_PENDIENTES, leerBorrador, guardarBorrador, leerPendientes,
  apuntarPendiente, descartarPendiente, confirmarRecibidos,
} from '../web/borradores.js';

function almacen({ roto = false } = {}) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (roto) throw new Error('QuotaExceeded'); m.set(k, String(v)); },
    removeItem: (k) => { if (roto) throw new Error('QuotaExceeded'); m.delete(k); },
  };
}
const S = '-100_7';
const T0 = new Date('2026-10-09T10:00:00Z');

test('el borrador sobrevive (es disco) y vacío se borra', () => {
  const s = almacen();
  guardarBorrador(s, S, 'a medias');
  assert.equal(leerBorrador(s, S), 'a medias');
  assert.equal(leerBorrador(s, 'otro'), '', 'es por conversación');
  guardarBorrador(s, S, '   ');
  assert.equal(s.getItem(PREFIJO_BORRADOR + S), null);
});

test('⚠ un almacén que lanza (incógnito) no tumba nada', () => {
  const s = almacen({ roto: true });
  assert.equal(guardarBorrador(s, S, 'x'), false);
  assert.deepEqual(apuntarPendiente(s, S, 'x', T0).texto, 'x');
  assert.deepEqual(leerPendientes(s, S), []);
  assert.deepEqual(confirmarRecibidos(s, S, []), []);
});

test('un envío queda pendiente hasta que VUELVE como mensaje tuyo', () => {
  const s = almacen();
  apuntarPendiente(s, S, 'haz X\r\n', T0);
  assert.equal(confirmarRecibidos(s, S, [
    { autor: 'claude', texto: 'haz X', ts: '2026-10-09T10:00:05Z' },
  ]).length, 1, 'que lo diga claude no es que te llegara a ti');
  assert.equal(confirmarRecibidos(s, S, [
    { autor: 'usuario', texto: 'haz X', ts: '2026-10-09T10:00:05Z' },
  ]).length, 0);
  assert.deepEqual(leerPendientes(s, S), []);
});

test('⚠ un mensaje VIEJO igual no confirma el envío de ahora', () => {
  const s = almacen();
  apuntarPendiente(s, S, 'sí', T0);
  const resto = confirmarRecibidos(s, S, [{ autor: 'usuario', texto: 'sí', ts: '2026-10-08T09:00:00Z' }]);
  assert.equal(resto.length, 1);
});

test('cada llegada confirma sólo el pendiente con su texto', () => {
  const s = almacen();
  apuntarPendiente(s, S, 'uno', T0);
  apuntarPendiente(s, S, 'dos', new Date(T0.getTime() + 1000));
  const resto = confirmarRecibidos(s, S, [{ autor: 'usuario', texto: 'dos', ts: '2026-10-09T10:01:00Z' }]);
  assert.deepEqual(resto.map((p) => p.texto), ['uno']);
});

test('descartar a mano y el tope', () => {
  const s = almacen();
  const p = apuntarPendiente(s, S, 'a', T0);
  assert.deepEqual(descartarPendiente(s, S, p.ts), []);
  for (let i = 0; i < MAX_PENDIENTES + 5; i++) apuntarPendiente(s, S, 't' + i, new Date(T0.getTime() + i));
  assert.equal(leerPendientes(s, S).length, MAX_PENDIENTES);
});
