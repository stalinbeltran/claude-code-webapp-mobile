// Modo remoto: la web en el mini, el coordinador en el dev (server/remoto.mjs).
// Lo caro de equivocarse: mandar una orden a una máquina que no es el dev, o enseñar como
// «no hay dev» algo que sólo es «no sé». Se prueba eso, sin red: el dev es un fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { elegirDev, fusionarFotos, crearEspejo } from '../server/remoto.mjs';
import { leerLatido } from '../server/datos.mjs';
import { raizDatos } from '../server/index.mjs';

const d = (name, tags, created, ip = '1.2.3.4', status = 'active') =>
  ({ name, id: name, tags, created_at: created, status, networks: { v4: [{ type: 'public', ip_address: ip }] } });

test('el dev es el atendido SIN control, el más reciente; el mini nunca', () => {
  const mini = d('mini', ['control', 'atendida'], '2026-10-01');
  assert.equal(elegirDev([mini]), null);
  assert.equal(elegirDev([mini, d('prueba', ['ephemeral'], '2026-10-07')]), null, 'sin atendida no es el dev');
  const viejo = d('dev', ['ephemeral', 'atendida'], '2026-10-01', '5.5.5.5');
  const nuevo = d('dev', ['ephemeral', 'atendida'], '2026-10-06', '6.6.6.6');
  assert.equal(elegirDev([mini, viejo, nuevo]).ip, '6.6.6.6');
  assert.equal(elegirDev([d('dev', ['atendida'], 'x', '7.7.7.7', 'off')]), null, 'apagado no recibe órdenes');
});

test('fusionar fotos: por id, ordenado, sin duplicar, sin líneas rotas', () => {
  const a = '{"id":"b","t":1}\n{"id":"a","t":1}\nroto\n';
  const b = '{"id":"a","t":1}\n{"id":"c","t":1}\n';
  assert.deepEqual(fusionarFotos([a, b]).trim().split('\n').map((l) => JSON.parse(l).id), ['a', 'b', 'c']);
});

test('sin dev, ENVIAR se niega y no deja nada', async () => {
  const raiz = mkdtempSync(join(tmpdir(), 'rem-'));
  const e = crearEspejo({ raiz, env: {}, buscar: async () => null });
  const r = await e.enviar('-100_7', 'hola');
  assert.equal(r.sinDev, true);
  assert.match(r.error, /No hay ningún dev/);
  assert.ok(!existsSync(join(raiz, '.saliente')), 'sin dev no se prepara ni se guarda nada');
});

test('si no se puede saber si hay dev, dice «no sé», no «no hay»', async () => {
  const raiz = mkdtempSync(join(tmpdir(), 'rem-'));
  const e = crearEspejo({ raiz, env: {}, buscar: async () => { throw new Error('sin DO_TOKEN'); } });
  const r = await e.enviar('-100_7', 'hola');
  assert.equal(r.sinDev, true);
  assert.match(r.error, /No sé si hay dev/);
});

test('sin dev, la vuelta quita el latido y lo dice en remoto.json, que viaja con el latido', async () => {
  const raiz = mkdtempSync(join(tmpdir(), 'rem-'));
  writeFileSync(join(raiz, 'coordinador.json'), JSON.stringify({ visto: new Date().toISOString(), vence_ms: 45000, turnos: {} }));
  const e = crearEspejo({ raiz, env: { CWEB_ALMACEN: join(raiz, 'no-hay') }, buscar: async () => null });
  await e.vuelta();
  assert.ok(!existsSync(join(raiz, 'coordinador.json')), 'sin dev no puede quedar un latido que parezca vivo');
  const l = leerLatido(raiz);
  assert.equal(l.vivo, false);
  assert.equal(l.remoto.dev, null);
  assert.equal(l.remoto.fuente, 'almacén');
});

test('en modo remoto el espejo NO es el DATA_DIR de la máquina (en el mini es el del Lanzador)', () => {
  const casa = mkdtempSync(join(tmpdir(), 'rem-'));
  mkdirSync(join(casa, 'src', 'telegram-coordinator', 'data'), { recursive: true });
  const r = raizDatos({ CWEB_REMOTO: '1', DATA_DIR: join(casa, 'src', 'telegram-coordinator', 'data') }, casa);
  assert.equal(r.remoto, true);
  assert.ok(!r.raiz.includes('telegram-coordinator'), r.raiz);
  assert.ok(existsSync(join(r.raiz, 'mensajes')));
});
