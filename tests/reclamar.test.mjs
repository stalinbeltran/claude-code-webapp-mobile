// Tests del reclamador del nombre.
//
// ⚠⚠ ESTO BORRA NODOS DE UNA TAILNET DONDE ESTÁ EL MÓVIL DEL DUEÑO, así que el
// esfuerzo va por la consecuencia del fallo (R10). Lo que se comprueba aquí no
// es que funcione: es que **no borre lo que no toca**, y sobre todo que un
// ensayo no borre NADA — que es la propiedad de la que uno se fía para probarlo
// en vivo.
//
// El `fetch` se inyecta, así que estos tests no tocan la red ni necesitan
// credenciales. Lo que NO prueban, y hay que saberlo: que la API de Tailscale
// conteste lo que aquí se finge. Eso sólo se sabe con un OAuth client de verdad.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reclamar, credenciales } from '../scripts/tailscale-reclamar.mjs';

const CRED = { id: 'tskey-client-FALSO', secreto: 'FALSO' };
const AHORA = new Date('2026-09-10T17:36:00Z');

const DEVICES = [
  { id: '1', name: 'dev-1.ejemplo.ts.net', lastSeen: '2026-09-10T17:35:58Z' }, // vivo
  { id: '2', name: 'dev.ejemplo.ts.net',   lastSeen: '2026-09-10T02:35:38Z' }, // el que estorba
  { id: '4', name: 'redmi-note-12.ejemplo.ts.net', lastSeen: '2026-09-10T17:35:00Z' },
];

/** Un `fetch` de mentira que APUNTA todo lo que se le pide. */
function fetchFalso({ devices = DEVICES, tokenOk = true, listaOk = true, borrarOk = true } = {}) {
  const llamadas = [];
  const fn = async (url, opciones = {}) => {
    llamadas.push({ url, metodo: opciones.method ?? 'GET' });
    if (url.endsWith('/oauth/token')) {
      return { ok: tokenOk, status: tokenOk ? 200 : 401, json: async () => ({ access_token: 'tok' }) };
    }
    if (url.endsWith('/tailnet/-/devices')) {
      return { ok: listaOk, status: listaOk ? 200 : 500, json: async () => ({ devices }) };
    }
    return { ok: borrarOk, status: borrarOk ? 200 : 403, json: async () => ({}) };
  };
  fn.llamadas = llamadas;
  return fn;
}

test('⚠⚠ EN SECO NO SE MANDA NI UN SOLO DELETE', () => {
  const f = fetchFalso();
  return reclamar({ nombre: 'dev', credenciales: CRED, seco: true, fetch: f, ahora: AHORA })
    .then((r) => {
      assert.deepEqual(f.llamadas.filter((l) => l.metodo === 'DELETE'), [],
        'si un ensayo puede borrar, no es un ensayo — y es de lo que uno se fía para probarlo en vivo');
      assert.deepEqual(r.borrados, []);
      assert.deepEqual(r.propuestos.map((d) => d.name), ['dev.ejemplo.ts.net'],
        'pero sí dice exactamente qué borraría');
    });
});

test('⚠⚠ borrando de verdad, toca SOLO el que estorba', async () => {
  const f = fetchFalso();
  const r = await reclamar({ nombre: 'dev', credenciales: CRED, seco: false, fetch: f, ahora: AHORA });
  const borrados = f.llamadas.filter((l) => l.metodo === 'DELETE');
  assert.equal(borrados.length, 1, 'ni el vivo ni el móvil del dueño');
  assert.match(borrados[0].url, /\/device\/2$/);
  assert.deepEqual(r.borrados.map((d) => d.id), ['2']);
});

test('⚠⚠ si no se puede LISTAR, no se borra nada', async () => {
  const f = fetchFalso({ listaOk: false });
  const r = await reclamar({ nombre: 'dev', credenciales: CRED, seco: false, fetch: f, ahora: AHORA });
  assert.equal(r.ok, false);
  assert.deepEqual(f.llamadas.filter((l) => l.metodo === 'DELETE'), [],
    'no saber qué hay no es permiso para borrar');
});

test('⚠ si el OAuth client no da token, se para antes de mirar nada', async () => {
  const f = fetchFalso({ tokenOk: false });
  const r = await reclamar({ nombre: 'dev', credenciales: CRED, seco: false, fetch: f, ahora: AHORA });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /token/);
  assert.equal(f.llamadas.length, 1, 'no sigue preguntando con un token que no tiene');
});

test('⚠ sin credenciales NO revienta y NO borra: el aprovisionamiento sigue (R2)', async () => {
  const f = fetchFalso();
  const r = await reclamar({ nombre: 'dev', credenciales: { id: '', secreto: '' }, seco: false, fetch: f });
  assert.equal(r.ok, false);
  assert.equal(f.llamadas.length, 0, 'ni una llamada');
  assert.match(r.avisos.join(' '), /devices:core/, 'y dice cómo se arregla');
});

test('un DELETE que falla se DICE, y no se cuenta como borrado', async () => {
  const f = fetchFalso({ borrarOk: false });
  const r = await reclamar({ nombre: 'dev', credenciales: CRED, seco: false, fetch: f, ahora: AHORA });
  assert.deepEqual(r.borrados, [], 'un 403 no es un borrado');
  assert.match(r.avisos.join('\n'), /no pude borrar/);
});

test('⚠ `--ya` sólo cambia el umbral, no las demás reglas', async () => {
  // Con `ya`, un nodo recién callado SÍ se borra (hay prueba de que la máquina
  // ya no existe) — pero el móvil del dueño sigue sin tocarse, porque no casa
  // con el nombre.
  const f = fetchFalso();
  const r = await reclamar({ nombre: 'dev', credenciales: CRED, seco: true, ya: true, fetch: f, ahora: AHORA });
  assert.deepEqual(r.propuestos.map((d) => d.name), ['dev.ejemplo.ts.net']);
});

test('las credenciales se leen del entorno y NO se inventan', () => {
  const c = credenciales({ TS_OAUTH_CLIENT_ID: 'abc', TS_OAUTH_CLIENT_SECRET: 'xyz' }, '/no/existe');
  assert.deepEqual(c, { id: 'abc', secreto: 'xyz' });
  assert.deepEqual(credenciales({}, '/no/existe'), { id: '', secreto: '' });
});
