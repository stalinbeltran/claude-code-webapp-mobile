// Tests del renderizado.
//
// ⚠⚠ EL PRIMERO ES EL TEST MÁS IMPORTANTE DE ESTE REPO. Esta app enseña la
// salida de un modelo que corre en una máquina donde `claude` tiene
// `bypassPermissions`. Si `html: false` se pierde en un refactor, cualquier cosa
// que ese modelo escriba —o que le hagan escribir— se ejecuta en el navegador con
// el que administras esa máquina. No es una preferencia de estilo: es la puerta.
//
// Lo demás está por consecuencia del fallo (R10): después de la puerta, lo que
// importa es que las TABLAS se lean, porque son justo lo que peor enseña Telegram
// y el motivo por el que existe esta app.
//
// El renderizador se carga del MISMO fichero vendorizado que usa el navegador
// (`markdown-it@14` no distribuye ESM, así que aquí se evalúa su UMD). Probar
// otro markdown-it distinto del que se sirve no probaría nada.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));

/** Carga el UMD vendorizado y devuelve su `markdownit`. */
function cargarMarkdownIt() {
  const codigo = readFileSync(join(RAIZ, 'web', 'vendor', 'markdown-it.min.js'), 'utf8');
  const ctx = createContext({ window: {}, self: {}, globalThis: {} });
  runInContext(codigo, ctx);
  const md = ctx.window.markdownit ?? ctx.markdownit ?? ctx.globalThis.markdownit;
  assert.ok(typeof md === 'function', 'el vendor tiene que exponer `markdownit`');
  return md;
}

const { crearRenderer } = await import('../web/markdown.js');
const md = crearRenderer(cargarMarkdownIt());

// ------------------------------------------------------------------ la puerta

/** Las etiquetas VIVAS de un HTML: `<p>` cuenta, `&lt;img&gt;` no. Es la
 *  distinción que importa aquí — el texto escapado DEBE verse; lo que no puede
 *  existir es una etiqueta que el navegador ejecute. */
const etiquetas = (html) => [...html.matchAll(/<([a-zA-Z][\w-]*)([^>]*)>/g)]
  .map((m) => ({ nombre: m[1].toLowerCase(), atributos: m[2] }));

test('⚠ el HTML crudo se ESCAPA: `html: false` es la puerta de esta app', () => {
  const salida = md.render('Mira esto: <img src=x onerror="alert(1)"> y <script>robar()</script>');

  const vivas = etiquetas(salida).map((e) => e.nombre);
  assert.deepEqual(vivas, ['p'],
    `del modelo no puede sobrevivir NINGUNA etiqueta; sólo las que pone markdown-it. Salieron: ${vivas}`);
  for (const e of etiquetas(salida)) {
    assert.doesNotMatch(e.atributos, /\bon\w+\s*=/i, 'ni un manejador de eventos');
  }
  // Y tiene que VERSE: escapar no es borrar. Si desapareciera, leerías una
  // respuesta mutilada sin saberlo.
  assert.match(salida, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(salida, /&lt;script&gt;/);
});

test('tampoco pasa un `javascript:` en un enlace', () => {
  const salida = md.render('[toca aquí](javascript:alert(1))');
  assert.doesNotMatch(salida, /href="javascript:/i);
});

// ------------------------------------- lo que Telegram enseña peor: las tablas

test('una tabla se envuelve para que su scroll NO mueva la página', () => {
  const salida = md.render('| a | b |\n|---|---|\n| 1 | 2 |');
  assert.match(salida, /<div class="tabla">\s*<table>/,
    'sin el envoltorio, leer una tabla ancha arrastra la conversación entera');
  assert.match(salida, /<\/table>\s*<\/div>/);
  assert.match(salida, /<th>a<\/th>/);
});

test('encabezados, listas anidadas, negritas y código en línea', () => {
  const salida = md.render(
    '## Título\n\n- uno\n  - hijo\n- dos\n\ntexto **fuerte** y `fichero.ts`');
  assert.match(salida, /<h2>Título<\/h2>/);
  assert.match(salida, /<ul>[\s\S]*<ul>[\s\S]*<li>hijo/, 'la anidada, anidada');
  assert.match(salida, /<strong>fuerte<\/strong>/);
  assert.match(salida, /<code>fichero\.ts<\/code>/);
});

test('las citas y los bloques de código salen como tales', () => {
  assert.match(md.render('> una cita'), /<blockquote>/);
  assert.match(md.render('```\nunas líneas\n```'), /<pre><code>/);
});

// ------------------------------------------------------------------ enlaces

test('los enlaces se abren fuera y sin poder tocar esta pestaña', () => {
  const salida = md.render('mira https://ejemplo.com/x y [esto](https://otro.com)');
  const enlaces = salida.match(/<a [^>]*>/g) ?? [];
  assert.equal(enlaces.length, 2, 'linkify tiene que convertir también la URL suelta');
  for (const a of enlaces) {
    assert.match(a, /target="_blank"/);
    assert.match(a, /rel="noopener noreferrer"/);
  }
});

test('un salto de línea suelto NO es un <br>: es markdown de verdad', () => {
  const salida = md.render('primera\nsegunda');
  assert.doesNotMatch(salida, /<br>/,
    'con `breaks: true`, una tabla mal alineada se convierte en un churro de <br>');
});

// ---------------------------------- y el fixture entero, que es lo que se verá

test('el fixture real se renderiza entero sin dejar HTML vivo', () => {
  const lineas = readFileSync(
    join(RAIZ, 'tests', 'fixtures', 'mensajes', '-1001234567_7.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lineas.length >= 7);
  for (const m of lineas) {
    const html = md.render(m.texto);
    assert.doesNotMatch(html, /<script|onerror=|javascript:/i);
  }
  const conTabla = lineas.find((m) => m.texto.includes('|---|'));
  assert.match(md.render(conTabla.texto), /<div class="tabla">/,
    'la respuesta con tabla del fixture es exactamente el caso que motivó la app');
});
