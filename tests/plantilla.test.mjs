// Tests de la plantilla de la interfaz.
//
// ⚠⚠ LO QUE ESTO NO PRUEBA, Y HAY QUE SABERLO: **la interfaz no se ha abierto
// nunca en un navegador.** En esta máquina no hay ninguno (`which google-chrome
// chromium` → nada, comprobado el 2026-09-09), así que Vue no ha llegado a
// montar el componente ni una sola vez. Lo que hay aquí caza el fallo más
// frecuente —una etiqueta sin cerrar, que en Vue no falla al escribirla sino al
// MONTAR, o sea en el móvil y sin decir dónde— y nada más.
//
// ⚠ Se intentó lo correcto y no salió: `compile()` del build de Vue necesita un
// `document` de verdad (falla con «document is not defined», y con un stub
// mínimo se rompe más adentro). Queda anotado como pendiente: en cuanto haya un
// navegador en la máquina, esto se sustituye por un montaje real.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { PLANTILLA } = await import('../web/plantilla.js');

/** Las que se cierran solas en HTML y no necesitan `</…>`. */
const VACIAS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source']);

test('las etiquetas de la plantilla están balanceadas', () => {
  const pila = [];
  for (const m of PLANTILLA.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, cierre, nombre, , autocierre] = m;
    if (VACIAS.has(nombre.toLowerCase()) || autocierre) continue;
    if (cierre) {
      const abierta = pila.pop();
      assert.equal(abierta, nombre,
        `</${nombre}> cierra un <${abierta ?? 'nada'}>: una etiqueta descuadrada ` +
        'no falla al escribirla, falla al montar — en el móvil y sin decir dónde');
    } else {
      pila.push(nombre);
    }
  }
  assert.deepEqual(pila, [], `quedaron etiquetas sin cerrar: ${pila.join(', ')}`);
});

test('usa sólo directivas que Vue entiende', () => {
  const usadas = new Set([...PLANTILLA.matchAll(/\s(v-[\w-]+)/g)].map((m) => m[1]));
  const conocidas = new Set(['v-if', 'v-else', 'v-else-if', 'v-for', 'v-html', 'v-bind',
    'v-on', 'v-model', 'v-show', 'v-text', 'v-slot', 'v-pre', 'v-cloak', 'v-once', 'v-memo']);
  for (const d of usadas) {
    assert.ok(conocidas.has(d), `"${d}" no es una directiva de Vue: se ignoraría en silencio`);
  }
});

test('cada v-for lleva su :key', () => {
  // Sin `key`, Vue reusa nodos entre mensajes distintos y el markdown renderizado
  // de uno acaba en la burbuja de otro al llegar mensajes nuevos.
  for (const m of PLANTILLA.matchAll(/<[^>]*\sv-for=[^>]*>/g)) {
    assert.match(m[0], /:key=/, `un v-for sin :key: ${m[0].slice(0, 70)}`);
  }
});

test('el markdown se pinta con v-html, y SÓLO ahí', () => {
  // `v-html` es la única puerta por la que entra HTML al DOM. Que esté en un solo
  // sitio es lo que hace que baste con un `html: false` para cerrarla.
  const veces = [...PLANTILLA.matchAll(/v-html=/g)].length;
  assert.equal(veces, 1, 'una sola, y es la del cuerpo del mensaje');
  assert.match(PLANTILLA, /class="cuerpo md" v-html="render\(m\.texto\)"/);
});

test('la divisoria del creset está en la plantilla', () => {
  assert.match(PLANTILLA, /esCorte\(m\)/);
  assert.match(PLANTILLA, /class="corte"/);
});

test('la plantilla no lleva backticks dentro: cerrarían su propio literal', () => {
  // Pasó el 2026-09-09 al escribir un comentario con `c` dentro del template:
  // el fichero dejó de parsearse entero. El test que la importa ya lo caza, pero
  // el error que da —«Unexpected identifier»— no dice de qué va, así que este
  // lo nombra.
  assert.doesNotMatch(PLANTILLA, /`/, 'usa comillas normales dentro de la plantilla');
  assert.doesNotMatch(PLANTILLA, /\$\{/, 'y nada de interpolación: eso lo hace Vue con {{ }}');
});
