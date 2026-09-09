// Tests del servidor de lectura.
//
// El orden es el de la R10: por consecuencia del fallo, no por facilidad.
//
//   1. DÓNDE ESCUCHA. Es el único fallo de este fichero que se paga con la
//      máquina: un `0.0.0.0` en un droplet público deja abierto a Internet un
//      camino al mismo sitio al que llega un mensaje de Telegram — donde `claude`
//      corre con `bypassPermissions`— y sin la allowlist del bot, que no cubre
//      esto. En esta misma máquina hay precedente de lo contrario: `fv.api`
//      escucha en `0.0.0.0:8010` (medido el 2026-09-09).
//      ⚠ Por eso no se comprueba sólo la constante: se INTENTA CONECTAR desde
//      una IP no-loopback de la propia máquina, que es lo que haría alguien de
//      fuera. Una invariante que importa es un test, no una frase (R14).
//   2. QUE SE NIEGUE SIN `DATA_DIR`. Servir un log vacío se leería como «no has
//      hablado con claude nunca», que es indistinguible de un log que sí está
//      pero no encuentra. R2: o degrada con un defecto declarado, o falla ANTES
//      de empezar.
//   3. QUE ARRANQUE SOLO, contra el fixture y sin coordinador. Es la prueba de la
//      R3 —«una pieza que no se puede usar sola no es una pieza»— y la razón de
//      que el fixture esté también en este repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';
import { connect } from 'node:net';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE = join(RAIZ, 'tests', 'fixtures');

const { HOST, crearServidor, raizDatos } = await import('../server/index.mjs');

/** Levanta el servidor en un puerto libre y devuelve cómo pararlo. */
function levantar(raiz = FIXTURE) {
  const s = crearServidor(raiz);
  return new Promise((res) => s.listen(0, HOST, () => res({
    server: s,
    puerto: s.address().port,
    direccion: s.address().address,
    cerrar: () => new Promise((r) => s.close(r)),
  })));
}

const pedir = async (puerto, ruta, host = HOST) => {
  const r = await fetch(`http://${host}:${puerto}${ruta}`);
  return { code: r.status, cuerpo: await r.json() };
};

/** Una IP de esta máquina que NO sea loopback: la que vería alguien de fuera. */
function ipExterna() {
  for (const nombre of Object.keys(networkInterfaces())) {
    for (const i of networkInterfaces()[nombre] ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return null;
}

// ------------------------------------------------- 1. el freno: dónde escucha

test('escucha en loopback y NO en la IP pública de la máquina', async () => {
  const s = await levantar();
  try {
    assert.equal(s.direccion, '127.0.0.1',
      'si esto cambia, el puerto queda abierto a Internet sin ninguna allowlist');

    const ip = ipExterna();
    assert.ok(ip, 'esta máquina no tiene ninguna IP no-loopback: no se pudo ' +
      'comprobar lo que de verdad importa. Se dice en vez de callarlo.');

    // Lo que haría alguien de fuera. Tiene que ser RECHAZADO, no atendido.
    const rechazado = await new Promise((res) => {
      const c = connect({ host: ip, port: s.puerto, timeout: 3000 });
      c.on('connect', () => { c.destroy(); res(false); });
      c.on('error', () => res(true));
      c.on('timeout', () => { c.destroy(); res(true); });
    });
    assert.ok(rechazado,
      `se pudo conectar desde ${ip}:${s.puerto} — el servidor está expuesto`);
  } finally {
    await s.cerrar();
  }
});

// -------------------------------------------- 2. que se niegue antes de empezar

test('sin DATA_DIR usa el sitio de siempre, y lo ANUNCIA', () => {
  // El defecto existe para que un droplet nuevo traiga la web funcionando sin que
  // nadie recuerde configurar nada. Pero se marca, porque un defecto silencioso
  // que acierta es indistinguible de uno que falla.
  const casa = mkdtempSync(join(tmpdir(), 'cweb-casa-'));
  mkdirSync(join(casa, 'src', 'telegram-coordinator', 'data'), { recursive: true });
  const r = raizDatos({}, casa);
  assert.equal(r.raiz, join(casa, 'src', 'telegram-coordinator', 'data'));
  assert.equal(r.porDefecto, true, 'y se sabe que fue por defecto, para poder decirlo');
});

test('si tampoco está el sitio de siempre, se NIEGA y dice las dos salidas', () => {
  const casa = mkdtempSync(join(tmpdir(), 'cweb-vacia-'));
  const r = raizDatos({}, casa);
  assert.ok('error' in r, 'servir un log vacío se leería como «no has hablado nunca»');
  assert.match(r.error, /DATA_DIR/);
  assert.match(r.error, /telegram-coordinator\/data/, 'dice dónde miró');
  assert.match(r.error, /fixtures/, 'y cómo probarlo sin coordinador');
});

test('con un DATA_DIR que no existe, también se niega', () => {
  const r = raizDatos({ DATA_DIR: join(mkdtempSync(join(tmpdir(), 'cweb-')), 'no-existe') });
  assert.ok('error' in r);
  assert.match(r.error, /no existe/);
});

test('con DATA_DIR válido, lo resuelve a ruta absoluta', () => {
  const r = raizDatos({ DATA_DIR: './tests/fixtures' });
  assert.ok('raiz' in r);
  assert.ok(r.raiz.startsWith('/'), 'absoluta, para no depender del cwd');
});

// ------------------------------------ 3. que sirva, y que arranque SIN el otro repo

test('arranca contra el fixture, sin coordinador: es la prueba de la R3', async () => {
  const s = await levantar();
  try {
    const { code, cuerpo } = await pedir(s.puerto, '/api/salud');
    assert.equal(code, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.log, 'presente',
      'el fixture trae su `mensajes/`, así que este repo se puede clonar solo y arrancar');
  } finally {
    await s.cerrar();
  }
});

test('si el log todavía no existe lo DICE, en vez de fingir que está', async () => {
  const vacio = mkdtempSync(join(tmpdir(), 'cweb-vacio-'));
  const s = await levantar(vacio);
  try {
    const { cuerpo } = await pedir(s.puerto, '/api/salud');
    assert.match(cuerpo.log, /todavía no/,
      '«el coordinador aún no ha escrito» es un estado normal, y distinto de «roto»');
  } finally {
    await s.cerrar();
  }
});

test('una ruta desconocida de la API da 404 en JSON, no un 500 ni un cuelgue', async () => {
  const s = await levantar();
  try {
    const { code, cuerpo } = await pedir(s.puerto, '/api/lo-que-sea');
    assert.equal(code, 404);
    assert.match(cuerpo.error, /No existe/);
  } finally {
    await s.cerrar();
  }
});

// ---------------------------------------------------------- 4. la API de lectura

test('GET /api/sesiones lista las conversaciones, con su nombre derivado', async () => {
  const s = await levantar();
  try {
    const { code, cuerpo } = await pedir(s.puerto, '/api/sesiones');
    assert.equal(code, 200);
    const [x] = cuerpo.sesiones;
    assert.equal(x.sesion, '-1001234567_7');
    assert.equal(x.nombre, 'Tema 7', 'el nombre se DERIVA del id: nada que guardar (P9)');
    assert.equal(x.mensajes, 7);
    assert.equal(x.ultimo.autor, 'usuario');
    assert.ok(x.ultimo.extracto.length <= 91, 'el extracto va sin markdown y acotado');
  } finally { await s.cerrar(); }
});

test('GET .../mensajes devuelve la última página y dice si hay más', async () => {
  const s = await levantar();
  try {
    const { cuerpo } = await pedir(s.puerto, '/api/sesiones/-1001234567_7/mensajes?limite=3');
    assert.equal(cuerpo.mensajes.length, 3);
    assert.equal(cuerpo.total, 7);
    assert.equal(cuerpo.hay_mas, true);
    assert.equal(cuerpo.mensajes.at(-1).origen, 'web', 'la ÚLTIMA página es la más reciente');
  } finally { await s.cerrar(); }
});

test('?desde= pagina hacia atrás sin repetir ni saltarse nada', async () => {
  const s = await levantar();
  try {
    const p1 = (await pedir(s.puerto, '/api/sesiones/-1001234567_7/mensajes?limite=3')).cuerpo;
    const p2 = (await pedir(s.puerto,
      `/api/sesiones/-1001234567_7/mensajes?limite=3&desde=${p1.mensajes[0].id}`)).cuerpo;
    const juntos = [...p2.mensajes, ...p1.mensajes].map((x) => x.id);
    assert.equal(new Set(juntos).size, juntos.length, 'ni un mensaje repetido en el borde');
    assert.deepEqual(juntos, [...juntos].sort(), 'y siguen en orden');
    assert.equal(p2.hay_mas, true, 'de 7, quedan 1 por detrás');
  } finally { await s.cerrar(); }
});

test('una sesión que no existe da una página vacía, no un error', async () => {
  const s = await levantar();
  try {
    const { code, cuerpo } = await pedir(s.puerto, '/api/sesiones/no_existe/mensajes');
    assert.equal(code, 200, 'un tema sin log todavía es normal, no un fallo');
    assert.deepEqual(cuerpo.mensajes, []);
    assert.equal(cuerpo.hay_mas, false);
  } finally { await s.cerrar(); }
});

test('un id con ../ no se sale del directorio de mensajes', async () => {
  const s = await levantar();
  try {
    const { code, cuerpo } = await pedir(s.puerto,
      `/api/sesiones/${encodeURIComponent('../../../etc/passwd')}/mensajes`);
    assert.equal(code, 200);
    assert.deepEqual(cuerpo.mensajes, [],
      'las barras se convierten en `_` al formar el nombre: no hay forma de salir');
  } finally { await s.cerrar(); }
});

// ------------------------------------------------------------ 5. los estáticos

test('sirve la app: index, el módulo y el vendor', async () => {
  const s = await levantar();
  try {
    for (const [ruta, tipo] of [['/', 'text/html'], ['/app.js', 'text/javascript'],
      ['/estilo.css', 'text/css'], ['/vendor/vue.esm-browser.prod.js', 'text/javascript']]) {
      const r = await fetch(`http://${HOST}:${s.puerto}${ruta}`);
      assert.equal(r.status, 200, `${ruta} tiene que servirse`);
      assert.match(r.headers.get('content-type'), new RegExp(tipo));
    }
  } finally { await s.cerrar(); }
});

test('un `../` en un estático NO se sale de web/', async () => {
  const s = await levantar();
  try {
    for (const ruta of ['/../package.json', '/../../etc/passwd',
      `/${encodeURIComponent('../server/index.mjs')}`]) {
      const r = await fetch(`http://${HOST}:${s.puerto}${ruta}`);
      assert.equal(r.status, 404, `${ruta} no puede servirse`);
    }
  } finally { await s.cerrar(); }
});

test('una extensión desconocida no se sirve, aunque el fichero exista', async () => {
  const s = await levantar();
  try {
    // Sin la lista blanca, un `.env` que alguien deje en `web/` por error saldría
    // con un 200. La lista es lo que hace que eso no dependa de nadie.
    const r = await fetch(`http://${HOST}:${s.puerto}/vendor/README.md`);
    assert.equal(r.status, 404);
  } finally { await s.cerrar(); }
});
