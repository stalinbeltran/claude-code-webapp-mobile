// Tests del acceso por Cloudflare Tunnel, la alternativa a Tailscale.
//
// Lo que se fija aquí:
//   - el modo lo decide `CWEB_ACCESO` y, sin él, el DATO (hay token → cloudflare);
//   - el token NUNCA pasa por la línea de órdenes ni por la unidad: va a un
//     fichero 0600 de root que la unidad lee con `EnvironmentFile=`;
//   - **200 en la sonda es la ALARMA**: significa que Access no protege la web
//     y está abierta al mundo. La redirección al login (302) es lo bueno;
//   - `unir`/`desunir` delegan en Tailscale cuando el modo es tailscale;
//   - lo que la PWA necesita detrás de Access: el manifest con credenciales, la
//     sesión caducada explicada, y un latido en el flujo de eventos.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { modoDeAcceso, avisoDeModo, hostnameDelTunel, urlDelTunel, unidadDelTunel,
         contenidoEntornoTunel, ordenesDeInstalarTunel, ordenDeProbarTunel, veredictoDeSonda,
         ponerTunel, FICHERO_ENTORNO_TUNEL, UNIDAD_TUNEL, RUTA_UNIDAD_TUNEL } from '../scripts/cloudflare.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const fuente = (...p) => readFileSync(join(RAIZ, ...p), 'utf8');
const TOKEN = 'eyJhIjoiUFJVRUJBIiwidCI6IjEyMzQ1Njc4OTAifQ';

// --- el modo ----------------------------------------------------------------

test('sin nada, el acceso es tailscale: lo que había', () => {
  assert.equal(modoDeAcceso({}), 'tailscale');
});

test('con token de túnel y sin CWEB_ACCESO, el dato decide: cloudflare', () => {
  assert.equal(modoDeAcceso({ CF_TUNNEL_TOKEN: TOKEN }), 'cloudflare');
});

test('CWEB_ACCESO explícito manda sobre el dato, en las dos direcciones', () => {
  assert.equal(modoDeAcceso({ CF_TUNNEL_TOKEN: TOKEN, CWEB_ACCESO: 'tailscale' }), 'tailscale');
  assert.equal(modoDeAcceso({ CWEB_ACCESO: 'cloudflare' }), 'cloudflare');
  assert.equal(modoDeAcceso({ CWEB_ACCESO: ' Cloudflare ' }), 'cloudflare');
});

test('⚠ el puente env_prefix quita el CWEB_: se acepta ACCESO a secas', () => {
  assert.equal(modoDeAcceso({ ACCESO: 'cloudflare' }), 'cloudflare');
  assert.equal(modoDeAcceso({ ACCESO: 'tailscale', CF_TUNNEL_TOKEN: TOKEN }), 'tailscale');
});

test('un valor que no es ninguno de los dos se ignora, y se dice', () => {
  assert.equal(modoDeAcceso({ CWEB_ACCESO: 'ngrok', CF_TUNNEL_TOKEN: TOKEN }), 'cloudflare');
  assert.match(avisoDeModo({ CWEB_ACCESO: 'ngrok' }), /ngrok/);
  assert.equal(avisoDeModo({ CWEB_ACCESO: 'cloudflare' }), '');
  assert.equal(avisoDeModo({}), '');
});

// --- nombre y URL ------------------------------------------------------------

test('el hostname se limpia venga como venga', () => {
  assert.equal(hostnameDelTunel({ CF_HOSTNAME: 'claude.ejemplo.com' }), 'claude.ejemplo.com');
  assert.equal(hostnameDelTunel({ CF_HOSTNAME: 'https://claude.ejemplo.com/' }), 'claude.ejemplo.com');
  assert.equal(hostnameDelTunel({ CF_HOSTNAME: ' claude.ejemplo.com/api?x ' }), 'claude.ejemplo.com');
  assert.equal(hostnameDelTunel({}), '');
  assert.equal(urlDelTunel('claude.ejemplo.com'), 'https://claude.ejemplo.com/');
});

// --- el token no se ve --------------------------------------------------------

test('⚠⚠ la unidad NO lleva el token: lo lee de EnvironmentFile, y corre sin privilegios', () => {
  const u = unidadDelTunel();
  assert.ok(!u.includes(TOKEN));
  assert.match(u, new RegExp(`EnvironmentFile=${FICHERO_ENTORNO_TUNEL.replace(/\//g, '\\/')}`));
  assert.match(u, /ExecStart=\/usr\/bin\/cloudflared --no-autoupdate tunnel run\n/);
  assert.match(u, /DynamicUser=yes/);
  assert.match(u, /Restart=always/);
});

test('el fichero de entorno es la línea que cloudflared lee', () => {
  assert.equal(contenidoEntornoTunel(` ${TOKEN} `), `TUNNEL_TOKEN=${TOKEN}\n`);
});

test('⚠⚠ ninguna orden lleva el token: sólo rutas; el entorno queda 0600 de root; restart y no start', () => {
  const ordenes = ordenesDeInstalarTunel('/tmp/x/claude-web.env', '/tmp/x/u.service');
  for (const o of ordenes) assert.ok(!o.includes(TOKEN) && !o.includes('TUNNEL_TOKEN'), o);
  assert.match(ordenes[1], /-m 0600 -o root -g root \/tmp\/x\/claude-web\.env \/etc\/cloudflared\/claude-web\.env$/);
  assert.match(ordenes[2], new RegExp(`-m 0644 .* ${RUTA_UNIDAD_TUNEL.replace(/\//g, '\\/')}$`));
  assert.ok(ordenes.some((o) => o === 'sudo -n systemctl daemon-reload'));
  assert.ok(ordenes.some((o) => o === `sudo -n systemctl restart ${UNIDAD_TUNEL}`));
  assert.ok(!ordenes.some((o) => /systemctl start /.test(o)));
});

// --- la sonda y su veredicto --------------------------------------------------

test('la sonda va al FQDN público por https, sin seguir redirecciones, y pide sólo el código', () => {
  const o = ordenDeProbarTunel('claude.ejemplo.com');
  assert.match(o, /https:\/\/claude\.ejemplo\.com\/api\/salud/);
  assert.match(o, /%\{http_code\}/);
  assert.ok(!/-L\b/.test(o), 'seguir la redirección al login la convertiría en un 200 falso');
});

test('⚠⚠ 200 ES LA ALARMA: sin Access la web está abierta al mundo', () => {
  const v = veredictoDeSonda('200');
  assert.equal(v.llega, true);
  assert.equal(v.protegida, false);
  assert.match(v.texto, /ABIERTA AL MUNDO/);
  assert.match(v.texto, new RegExp(`systemctl stop ${UNIDAD_TUNEL}`));
});

test('302/401/403 es lo bueno: llega y Access la protege', () => {
  for (const c of ['302', '401', '403']) {
    const v = veredictoDeSonda(c);
    assert.equal(v.llega, true, c);
    assert.equal(v.protegida, true, c);
    assert.match(v.texto, /✅/);
  }
});

test('530 es túnel sin conectar; 000 es que no resuelve; el resto se explica', () => {
  assert.match(veredictoDeSonda('530').texto, /NO está conectado/);
  assert.match(veredictoDeSonda('000').texto, /no resuelve|no llega/);
  assert.match(veredictoDeSonda('').texto, /no resuelve|no llega/);
  assert.match(veredictoDeSonda('502').texto, /127\.0\.0\.1/);
  for (const c of ['530', '000', '502']) assert.equal(veredictoDeSonda(c).llega, false);
});

// --- ponerTunel con un shell fingido -----------------------------------------------

function ejecutorFingido({ cloudflared = true } = {}) {
  const ordenes = [];
  const ficheros = {};
  return {
    ordenes, ficheros,
    ejecutar: (cmd) => {
      ordenes.push(cmd);
      if (cmd === 'command -v cloudflared') return cloudflared ? { ok: true, out: '/usr/bin/cloudflared' } : { ok: false, out: '' };
      const i = cmd.match(/^sudo -n install -m \d+ -o root -g root (\S+) (\S+)$/);
      if (i) { ficheros[i[2]] = readFileSync(i[1], 'utf8'); return { ok: true, out: '' }; }
      return { ok: true, out: '' };
    },
  };
}

test('sin token no hace nada y dice el nombre del llavero', () => {
  const f = ejecutorFingido();
  const r = ponerTunel({}, f.ejecutar);
  assert.equal(r.hecho, false);
  assert.match(r.mensaje, /CWEB_CF_TUNNEL_TOKEN/);
  assert.equal(f.ordenes.length, 0);
});

test('con token pero sin hostname tampoco: no sabría qué anunciar ni probar', () => {
  const f = ejecutorFingido();
  const r = ponerTunel({ CF_TUNNEL_TOKEN: TOKEN }, f.ejecutar);
  assert.equal(r.hecho, false);
  assert.match(r.mensaje, /CWEB_CF_HOSTNAME/);
  assert.equal(f.ordenes.length, 0);
});

test('--seco no ejecuta nada y no imprime el token', () => {
  const f = ejecutorFingido();
  const r = ponerTunel({ CF_TUNNEL_TOKEN: TOKEN, CF_HOSTNAME: 'claude.ejemplo.com' }, f.ejecutar, true);
  assert.equal(r.hecho, false);
  assert.equal(f.ordenes.length, 0);
  assert.ok(!r.mensaje.includes(TOKEN));
  assert.equal(r.url, 'https://claude.ejemplo.com/');
});

test('con todo, instala: el token acaba en el fichero de entorno de root y en ningún otro sitio', () => {
  const f = ejecutorFingido();
  const r = ponerTunel({ CF_TUNNEL_TOKEN: TOKEN, CF_HOSTNAME: 'claude.ejemplo.com' }, f.ejecutar);
  assert.equal(r.hecho, true, r.mensaje);
  assert.equal(f.ficheros[FICHERO_ENTORNO_TUNEL], `TUNNEL_TOKEN=${TOKEN}\n`);
  assert.ok(!f.ficheros[RUTA_UNIDAD_TUNEL].includes(TOKEN));
  for (const o of f.ordenes) assert.ok(!o.includes(TOKEN), o);
  assert.ok(!r.mensaje.includes(TOKEN));
  assert.ok(f.ordenes.some((o) => o === `sudo -n systemctl restart ${UNIDAD_TUNEL}`));
});

test('si cloudflared no está, lo instala del .deb oficial antes de nada', () => {
  const f = ejecutorFingido({ cloudflared: false });
  ponerTunel({ CF_TUNNEL_TOKEN: TOKEN, CF_HOSTNAME: 'claude.ejemplo.com' }, f.ejecutar);
  const i = f.ordenes.findIndex((o) => /cloudflared-linux-amd64\.deb/.test(o) && /dpkg -i/.test(o));
  assert.ok(i >= 0, 'no instala cloudflared');
  assert.ok(i < f.ordenes.findIndex((o) => /systemctl restart/.test(o)));
});

// --- el despachador y lo que la PWA necesita detrás de Access ------------------------

test('⚠ acceso.mjs delega en los scripts de Tailscale cuando el modo es tailscale', () => {
  const s = fuente('scripts', 'acceso.mjs');
  assert.match(s, /if \(MODO === 'tailscale'\) delegar\('tailscale-unir\.mjs'\)/);
  assert.match(s, /if \(MODO === 'tailscale'\) delegar\('tailscale-desunir\.mjs'\)/);
  assert.match(s, /const ENV = conEnvDelRepo\(RAIZ\)/);
  assert.match(s, /modoDeAcceso\(ENV\)/);
});

test('⚠ y el ejecutor de Telegram sabe pedir `acceso`', () => {
  const ex = JSON.parse(fuente('telegram', 'executors', 'cweb.json'));
  assert.ok(ex.ejemplos.includes('acceso'));
});

test('⚠⚠ el manifest pide credenciales: detrás de Access, sin esto la PWA no se instala', () => {
  const html = fuente('web', 'index.html');
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest" crossorigin="use-credentials">/);
});

test('⚠ una sesión de Access caducada se explica, no se lee como «servidor roto»', () => {
  const js = fuente('web', 'app.js');
  assert.match(js, /r\.redirected/);
  assert.match(js, /volver a entrar/);
});

test('⚠ el flujo de eventos late: Cloudflare corta las conexiones mudas', () => {
  const ev = fuente('server', 'eventos.mjs');
  assert.match(ev, /: latido\\n\\n/);
  assert.match(ev, /LATIDO_MS = 30_000/);
});
