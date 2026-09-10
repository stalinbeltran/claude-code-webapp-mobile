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

import { nombreCorto, hayDeriva, avisoDeDeriva, ordenDeUnir, nodosAReclamar } from '../scripts/nodo.mjs';

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

// ---------------------------------------------------------------------------
// La authkey: que unirse NO la deje escrita en el journal.
//
// ⚠⚠ MEDIDO EL 2026-09-10, y es el fallo más caro de este fichero: el script
// DECÍA en su cabecera que la clave «va por el ENTORNO, nunca en la línea de
// comando»… y la filtraba igual, dos veces en la misma línea del journal. La
// protección estaba escrita en el comentario y no en el código, que es la peor
// combinación posible: se lee como resuelto y nadie vuelve a mirarlo.
// ---------------------------------------------------------------------------

test('⚠⚠ la orden de unir NO contiene la clave por ningún lado', () => {
  const clave = 'tskey-auth-FALSAFALSA1234-FALSAFALSAFALSAFALSA';
  const orden = ordenDeUnir('/tmp/tsjoin-xyz/authkey', 'dev');
  assert.ok(!orden.includes(clave), 'la clave no puede viajar en `argv`: sudo lo registra entero');
  assert.match(orden, /--auth-key=file:/, 'se pasa la RUTA, y tailscale la lee de ahí');
  assert.match(orden, /--hostname=dev/);
});

test('⚠⚠ y no la mete por la otra puerta: `$TS_AUTHKEY` ni `--preserve-env`', () => {
  // Los dos filtraban, y por mecanismos distintos:
  //  · `"$TS_AUTHKEY"` lo expande /bin/sh ANTES de que sudo exista -> `COMMAND=`
  //  · `--preserve-env=TS_AUTHKEY` hace que sudo registre `ENV=TS_AUTHKEY=<clave>`
  const orden = ordenDeUnir('/tmp/x/authkey', 'dev');
  assert.ok(!orden.includes('$TS_AUTHKEY'),
    'una variable en la orden la expande el shell antes que sudo: acaba en el journal');
  assert.ok(!orden.includes('preserve-env'),
    'sudo escribe en claro las variables que le pides preservar');
});

test('⚠⚠ el script tampoco las usa: es donde estaba el fallo real', () => {
  const s = readFileSync(join(RAIZ, 'scripts', 'tailscale-unir.mjs'), 'utf8');
  // ⚠ Se miran las líneas que LANZAN algo, no el fichero entero: los comentarios
  // de arriba nombran `--preserve-env` justo para explicar por qué no se usa, y
  // un test que casara con eso prohibiría documentar el fallo.
  const lanzan = s.split('\n').filter((l) => /sudo\s+-n/.test(l) && !/^\s*(\/\/|\*)/.test(l));
  assert.ok(lanzan.length > 0, 'algo tiene que lanzarse con sudo, o este test no mide nada');
  for (const l of lanzan) {
    assert.ok(!l.includes('preserve-env'),
      `sudo deja \`ENV=TS_AUTHKEY=<clave>\` en el journal — en: ${l.trim()}`);
    assert.ok(!l.includes('$TS_AUTHKEY'),
      `/bin/sh lo expande antes que sudo y acaba en el \`COMMAND=\` — en: ${l.trim()}`);
  }
  assert.match(s, /ordenDeUnir\(/, 'la orden se construye en un sitio que se puede probar');
});

test('⚠ y el fichero de la clave lleva su regla de caducidad (regla 3)', () => {
  const s = readFileSync(join(RAIZ, 'scripts', 'tailscale-unir.mjs'), 'utf8');
  assert.match(s, /mode: 0o600/, 'un fichero con una clave no puede nacer legible por todos');
  assert.match(s, /finally[\s\S]{0,200}rmSync/,
    'se borra pase lo que pase: un secreto en disco sin dueño vivo es el fallo del .resume.lock');
});

// ---------------------------------------------------------------------------
// Reclamar el nombre. AQUÍ SE BORRA DE VERDAD, así que el esfuerzo de prueba va
// por la consecuencia del fallo (R10): borrar de menos deja la URL muerta un
// rato; borrar de más echa de la tailnet una máquina viva — y en ésta está el
// móvil del dueño.
// ---------------------------------------------------------------------------

/** Los cuatro nodos reales del 2026-09-10, tal como los devolvería la API. */
const AHORA = new Date('2026-09-10T17:36:00Z');
const COMO_AQUEL_DIA = [
  { id: '1', name: 'dev-1.ejemplo.ts.net', hostname: 'dev', lastSeen: '2026-09-10T17:35:58Z' }, // el VIVO
  { id: '2', name: 'dev.ejemplo.ts.net',   hostname: 'dev', lastSeen: '2026-09-10T02:35:38Z' }, // el que estorba
  { id: '3', name: 'dev-2.ejemplo.ts.net', hostname: 'dev', lastSeen: '2026-09-10T16:37:32Z' },
  { id: '4', name: 'redmi-note-12.ejemplo.ts.net', hostname: 'Redmi Note 12', lastSeen: '2026-09-10T17:35:00Z' },
];

test('⚠⚠ el caso real: borra el que estorba y NADA más', () => {
  const { borrar } = nodosAReclamar(COMO_AQUEL_DIA, 'dev', { ahora: AHORA });
  assert.deepEqual(borrar.map((d) => d.name), ['dev.ejemplo.ts.net']);
});

test('⚠⚠ casa por el FQDN, NO por el hostname: los cuatro se llamaban `dev`', () => {
  // Casar por `hostname` habría borrado el nodo VIVO y el móvil del dueño.
  const { borrar } = nodosAReclamar(COMO_AQUEL_DIA, 'dev', { ahora: AHORA });
  assert.ok(!borrar.some((d) => d.name.startsWith('dev-1')), 'ése es el vivo');
  assert.ok(!borrar.some((d) => d.name.includes('redmi')), 'ése es el móvil del dueño');
});

test('⚠⚠ NUNCA borra uno que parezca vivo, aunque ocupe el nombre', () => {
  const vivo = [{ id: '9', name: 'dev.ejemplo.ts.net', lastSeen: '2026-09-10T17:35:58Z' }];
  const { borrar, avisos } = nodosAReclamar(vivo, 'dev', { ahora: AHORA });
  assert.deepEqual(borrar, [], 'visto hace 2 s: eso es una máquina viva');
  assert.match(avisos.join('\n'), /PARECE VIVO/, 'y lo que no se borra se DICE (regla 4)');
});

test('⚠ bajar el umbral a 0 sólo vale con prueba de que la máquina ya no existe', () => {
  // Es lo que hace el lanzador DESPUÉS de que DigitalOcean confirme el borrado:
  // ahí `lastSeen` ya no significa nada y esperar sería esperar por nada.
  const reciente = [{ id: '9', name: 'dev.ejemplo.ts.net', lastSeen: '2026-09-10T17:35:58Z' }];
  const { borrar } = nodosAReclamar(reciente, 'dev', { ahora: AHORA, inactivoDesdeMs: 0 });
  assert.deepEqual(borrar.map((d) => d.id), ['9']);
});

test('⚠ un id excluido no se toca, y se dice', () => {
  const { borrar, avisos } = nodosAReclamar(COMO_AQUEL_DIA, 'dev', { ahora: AHORA, excluirIds: ['2'] });
  assert.deepEqual(borrar, []);
  assert.match(avisos.join('\n'), /excluido a mano/);
});

test('⚠⚠ si la lista no se pudo leer, NO borra nada (el `NO SÉ` del freno)', () => {
  for (const basura of [null, undefined, 'vaya', {}, 0]) {
    const { borrar, avisos } = nodosAReclamar(basura, 'dev', { ahora: AHORA });
    assert.deepEqual(borrar, [], `con ${JSON.stringify(basura)} no se borra nada`);
    assert.ok(avisos.length > 0, 'y no se calla: no saber es un resultado');
  }
});

test('sin nombre que reclamar no se borra nada', () => {
  const { borrar } = nodosAReclamar(COMO_AQUEL_DIA, '', { ahora: AHORA });
  assert.deepEqual(borrar, []);
});

test('un `lastSeen` ilegible cuenta como MUERTO, no como vivo', () => {
  // Un nodo sin fecha legible lleva ahí desde siempre: es basura, no una máquina
  // en marcha. Y aun así sólo se borra si casa el nombre exacto.
  const raro = [{ id: '7', name: 'dev.ejemplo.ts.net', lastSeen: 'ni idea' }];
  assert.deepEqual(nodosAReclamar(raro, 'dev', { ahora: AHORA }).borrar.map((d) => d.id), ['7']);
});

test('una tailnet sin ese nombre no da nada que borrar, y sin avisos de alarma', () => {
  const otros = [{ id: '5', name: 'mini.ejemplo.ts.net', lastSeen: '2026-01-01T00:00:00Z' }];
  const { borrar, avisos } = nodosAReclamar(otros, 'dev', { ahora: AHORA });
  assert.deepEqual(borrar, []);
  assert.deepEqual(avisos, [], 'no hay nada que decir: el nombre está libre');
});
