// Tests de `web/lectura.js`: reabrir la conversación y situarse en lo no leído.
//
// Pedido el 2026-10-08: el navegador del móvil descarta la pestaña y al volver
// la app abría en la lista; y al abrir, el scroll iba al final en vez de a lo
// que no habías leído. La parte de navegador (scroll real) se comprobó en
// Chrome; aquí va la lógica que decide, que es donde se esconden los fallos
// mudos (un id que des-lee, una sesión purgada que se reabre para siempre).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAVE_ABIERTA, leerAbierta, guardarAbierta, leerLeido, marcarLeido,
  primerNoLeido, faltaAtras, tieneNoLeido, sesionDelHash, hashDe, aReabrir,
} from '../web/lectura.js';

/** Un `localStorage` de mentira; `roto` imita el incógnito, que lanza al escribir. */
function almacen({ roto = false } = {}) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (roto) throw new Error('QuotaExceeded'); m.set(k, String(v)); },
    removeItem: (k) => { if (roto) throw new Error('QuotaExceeded'); m.delete(k); },
  };
}

const M = (id, autor = 'claude') => ({ id, autor });
const hilo = [M('a1', 'usuario'), M('a2'), M('a3', 'usuario'), M('a4'), M('a5', 'sistema')];

test('la conversación abierta se guarda, se lee y se olvida', () => {
  const s = almacen();
  assert.equal(leerAbierta(s), null);
  guardarAbierta(s, '-100_7');
  assert.equal(s.getItem(CLAVE_ABIERTA), '-100_7');
  assert.equal(leerAbierta(s), '-100_7');
  guardarAbierta(s, null);
  assert.equal(leerAbierta(s), null, 'al volver a la lista no se reabre nada');
});

test('⚠ un almacén que lanza (incógnito) no tumba nada', () => {
  const s = almacen({ roto: true });
  assert.equal(guardarAbierta(s, 'x'), false);
  assert.equal(marcarLeido(s, 'x', 'a1'), null);
  assert.equal(leerAbierta(undefined), null);
});

test('⚠ lo leído sólo AVANZA: volver a mirar arriba no des-lee lo de abajo', () => {
  const s = almacen();
  assert.equal(marcarLeido(s, 't', 'a4'), 'a4');
  assert.equal(marcarLeido(s, 't', 'a2'), 'a4', 'subir el scroll no puede retroceder la marca');
  assert.equal(leerLeido(s, 't'), 'a4');
  assert.equal(marcarLeido(s, 't', 'a5'), 'a5');
  assert.equal(leerLeido(s, 'otro'), null, 'cada conversación lleva su marca');
});

test('el primer no leído es el siguiente a la marca que no escribiste tú', () => {
  assert.equal(primerNoLeido(hilo, 'a1'), 'a2');
  assert.equal(primerNoLeido(hilo, 'a2'), 'a4', 'tu propio mensaje (a3) no está «sin leer»');
  assert.equal(primerNoLeido(hilo, 'a4'), 'a5', 'un aviso del sistema sí cuenta');
  assert.equal(primerNoLeido(hilo, 'a5'), null, 'todo leído: se abre por el final');
});

test('⚠ sin marca no hay «sin leer»: una conversación nunca abierta aquí va al final', () => {
  // Tratarla entera como nueva mandaría al principio de 300 mensajes.
  assert.equal(primerNoLeido(hilo, null), null);
  assert.equal(tieneNoLeido({ ultimo: { id: 'a5', autor: 'claude' } }, null), false);
});

test('pide más antiguos sólo si lo no leído puede quedar antes de la página', () => {
  const pagina = [M('b1'), M('b2')];
  assert.equal(faltaAtras(pagina, 'a9', true), true, 'la marca es anterior a la página y hay más');
  assert.equal(faltaAtras(pagina, 'a9', false), false, 'sin más que pedir, no se pide');
  assert.equal(faltaAtras(pagina, 'b1', true), false, 'la marca ya está dentro de la página');
  assert.equal(faltaAtras(pagina, null, true), false);
  assert.equal(faltaAtras([], 'a1', true), false);
});

test('la lista marca «nuevo» sólo si lo último lo escribió otro y es posterior', () => {
  assert.equal(tieneNoLeido({ ultimo: { id: 'a5', autor: 'claude' } }, 'a4'), true);
  assert.equal(tieneNoLeido({ ultimo: { id: 'a5', autor: 'claude' } }, 'a5'), false);
  assert.equal(tieneNoLeido({ ultimo: { id: 'a5', autor: 'usuario' } }, 'a4'), false);
  assert.equal(tieneNoLeido({ ultimo: null }, 'a4'), false);
  assert.equal(tieneNoLeido({ ultimo: { ts: 'x', autor: 'claude' } }, 'a4'), false,
    'un servidor viejo (sin id en `ultimo`) no inventa «nuevo»');
});

test('el # de la URL va y vuelve, con el signo del chat', () => {
  assert.equal(hashDe('-1004383895505_2'), '#s=-1004383895505_2');
  assert.equal(sesionDelHash(hashDe('-1004383895505_2')), '-1004383895505_2');
  assert.equal(sesionDelHash(hashDe('a b/c')), 'a b/c');
  assert.equal(hashDe(null), '');
  assert.equal(sesionDelHash(''), null);
  assert.equal(sesionDelHash('#otra'), null);
  assert.equal(sesionDelHash('#s=%E0%A4%A'), null, 'un # mal codificado no lanza');
});

test('al arrancar se reabre: la URL de la pestaña manda, luego lo guardado', () => {
  const existentes = ['-1_2', '-1_main'];
  assert.equal(aReabrir({ hash: '#s=-1_2', guardada: '-1_main', existentes }), '-1_2');
  assert.equal(aReabrir({ hash: '', guardada: '-1_main', existentes }), '-1_main');
  assert.equal(aReabrir({ hash: '', guardada: null, existentes }), null, 'nada guardado: la lista');
});

test('⚠ una conversación que ya no existe NO se reabre', () => {
  // Purgada, o de otro coordinador: reabrirla dejaría la app en un hilo vacío
  // cada vez que arranca.
  assert.equal(aReabrir({ hash: '#s=-1_9', guardada: '-1_8', existentes: ['-1_2'] }), null);
  assert.equal(aReabrir({ hash: '#s=-1_9', guardada: '-1_2', existentes: ['-1_2'] }), '-1_2',
    'si la de la URL no está, se prueba la guardada');
});
