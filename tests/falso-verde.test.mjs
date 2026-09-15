// ⚠⚠ EL FALSO VERDE DEL 2026-09-15, que es el fallo que estos tests existen para
// que no vuelva.
//
// Qué pasó, medido: un dev recién nacido arrancó `claude-web` a las 15:36:42 SIN
// token, así que se ató sólo a `127.0.0.1` — el bind se decide AL ARRANCAR. A las
// 15:46:53 se creó el token con `cweb instalar`… que NO reiniciaba la unidad. Y
// `arrancar` hacía `systemctl start` sobre algo ya activo, o sea nada.
//
// Resultado: `instalar` decía «🔑 token listo», `estado` decía «abierto con token
// en la puerta» —porque miraba el DISCO— y el móvil no podía entrar. Los cuatro
// mandos en verde y ninguno capaz de arreglarlo por más veces que se pulsaran.
//
// Las dos mitades del arreglo, y son distintas:
//   1. que NO PUEDA PASAR  → el servidor crea el token al arrancar si falta.
//   2. que si pasa SE VEA  → `estado` lee el socket, no el disco, y lo grita.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FUENTE = readFileSync(join(RAIZ, 'scripts', 'cweb.mjs'), 'utf8');

/** Arranca el servidor de verdad en una casa vacía y devuelve lo que imprime. */
function arrancaEnCasaVacia({ puerto }) {
  const casa = mkdtempSync(join(tmpdir(), 'cweb-casa-'));
  const datos = join(casa, 'datos');
  mkdirSync(datos, { recursive: true });
  return new Promise((res) => {
    const hijo = spawn(process.execPath, [join(RAIZ, 'server', 'index.mjs')], {
      env: { ...process.env, HOME: casa, CWEB_DATA_DIR: datos, DATA_DIR: datos,
             CWEB_PORT: String(puerto), CWEB_TOKEN: '', CWEB_BIND: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let salida = '';
    const acabar = () => { hijo.kill('SIGKILL'); res({ salida, casa }); };
    hijo.stdout.on('data', (d) => { salida += d; if (/Web de lectura/.test(salida)) setTimeout(acabar, 250); });
    hijo.stderr.on('data', (d) => { salida += d; });
    setTimeout(acabar, 6000);
  });
}

// ── 1. QUE NO PUEDA PASAR ───────────────────────────────────────────────────

test('⚠⚠ sin token, el servidor CREA uno al arrancar y se ata al puerto público', async () => {
  // Falla con el código anterior: allí `token()` iba sin `crear`, no había token
  // y el servidor se quedaba en 127.0.0.1 — que es exactamente cómo nació el dev
  // del 2026-09-15 y por qué ningún mando podía arreglarlo después.
  const { salida, casa } = await arrancaEnCasaVacia({ puerto: 18921 });
  assert.match(salida, /0\.0\.0\.0:18921/, 'tiene que atarse al comodín, no a loopback');
  assert.doesNotMatch(salida, /SIN token/, 'ya no puede quedarse sin puerta');
  assert.ok(existsSync(join(casa, '.config', 'cweb.env')), 'y el token queda guardado');
});

test('⚠ lo dice, pero NO imprime el token: este log lo lee `cweb log` desde Telegram', async () => {
  const { salida, casa } = await arrancaEnCasaVacia({ puerto: 18922 });
  assert.match(salida, /he creado uno nuevo/i, 'un token nuevo es un hecho, y se anuncia');
  const t = readFileSync(join(casa, '.config', 'cweb.env'), 'utf8').split('=')[1].trim();
  assert.ok(t.length > 10);
  assert.ok(!salida.includes(t), 'el valor NUNCA va al journal');
});

// ── 2. QUE SI PASA, SE VEA ──────────────────────────────────────────────────

test('⚠⚠ `estado` mira el SOCKET, no el disco', () => {
  // La línea que mentía: `hayToken ? 'abierto con token en la puerta' : …`, que
  // deduce el bind de que exista un fichero. Aquí se fija que ya no se deduce.
  assert.match(FUENTE, /function bindReal\(/, 'hay que preguntarle al kernel');
  assert.match(FUENTE, /ss -ltnH/, 'y se le pregunta con `ss`');
  assert.doesNotMatch(FUENTE, /abierto con token en la puerta/,
    'ése era el texto del falso verde: no puede volver');
});

test('⚠⚠ y GRITA cuando hay token y el proceso no lo usa', () => {
  assert.match(FUENTE, /HAY TOKEN PERO LA WEB NO LO ESTÁ USANDO/,
    'el desacuerdo entre disco y socket es el fallo, y tiene que decirse');
  assert.match(FUENTE, /bindReal\(\) : \{ publico: false/, '`estado` lo consulta de verdad');
});

test('⚠ y un `NO SÉ` no se convierte en veredicto', () => {
  // Sin `ss` no se puede saber a qué está atada. Decir «loopback» ahí sería
  // inventarse el fallo; decir «abierto» sería el falso verde otra vez.
  const cuerpo = FUENTE.slice(FUENTE.indexOf('function bindReal('), FUENTE.indexOf('function ufwAbierto('));
  assert.match(cuerpo, /command not found[\s\S]{0,40}return null/,
    '`bindReal` devuelve null si no puede mirar, en vez de suponer');
  assert.match(FUENTE, /b === null \? '❔ no sé a qué está atada/,
    'y `estado` lo dice como un NO SÉ, no como un veredicto');
});

// ── 3. LOS DOS MANDOS QUE NO HACÍAN NADA ────────────────────────────────────

test('⚠⚠ `instalar` REINICIA: crear el token sin reiniciar no cambia el bind', () => {
  const cuerpo = FUENTE.slice(FUENTE.indexOf('function instalar('), FUENTE.indexOf('function estado('));
  assert.match(cuerpo, /systemctl restart/, 'falla con el código anterior: sólo hacía `enable`');
  // El orden es la invariante: token → reinicio → puerto. Al revés habría un
  // instante con el puerto abierto y sin puerta.
  assert.ok(cuerpo.indexOf('crear: true') < cuerpo.indexOf('systemctl restart'), 'token antes del reinicio');
  assert.ok(cuerpo.indexOf('systemctl restart') < cuerpo.indexOf('ufw allow'), 'reinicio antes del puerto');
});

test('⚠⚠ `arrancar` es `restart`: un `start` sobre algo activo no hace nada', () => {
  assert.match(FUENTE, /case 'arrancar':[^\n]*systemctl restart/,
    'falla con el código anterior: era `systemctl start`, y se pulsó 3 veces sin efecto');
});

// ── 4. UNA SOLA DEFINICIÓN DEL SERVICIO ─────────────────────────────────────

test('⚠⚠ la unidad que escribe `instalar` es equivalente a la del lanzador', () => {
  // Las dos escriben /etc/systemd/system/claude-web.service y gana la última, así
  // que si difieren el servicio depende de su historia. Divergían en el
  // `ExecStart`: el lanzador usa `bash -lc` (carga ~/.bashrc y con él los
  // secretos de la máquina) y aquí era `/usr/bin/env node`, que no carga nada.
  assert.match(FUENTE, /ExecStart=\/bin\/bash -lc 'exec node server\/index\.mjs'/,
    'falla con el código anterior: era /usr/bin/env node');
  assert.doesNotMatch(FUENTE, /ExecStart=\/usr\/bin\/env node/);
});
