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

import { nombreCorto, hayDeriva, avisoDeDeriva, ordenDeUnir, nodosAReclamar,
         ordenDeDesunir, serveHuerfano, avisoDeServeHuerfano, ordenDeProbar,
         publicacion, ordenDeServir, urlPublica, esquemaPublicado,
         publicacionSobrante } from '../scripts/nodo.mjs';

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
  const a = avisoDeDeriva('dev', 'dev-1.ejemplo.ts.net.', publicacion({}));
  assert.match(a, /dev-1/, 'tiene que decir cómo se llama de verdad');
  // 1. la URL que funciona AHORA, para no quedarse tirado
  assert.match(a, /http:\/\/dev-1\.ejemplo\.ts\.net:8080\//);
  // 2. cómo recuperar el nombre estable
  assert.match(a, /login\.tailscale\.com\/admin\/machines/);
  // 3. la causa de fondo, o vuelve a pasar en el siguiente dev
  assert.match(a, /EPHEMERAL/,
    'sin authkey efímera el nodo muerto ocupa el nombre y esto se repite');
  // Y que se reconozca el síntoma que se ve desde el móvil.
  assert.match(a, /Failed to fetch/);
});

test('el puerto y el esquema del aviso no se suponen: se pasan', () => {
  // Aquí el 443 lo tiene `sshd`, así que el serve va en otro puerto. Un aviso con
  // la URL sin puerto «parecería correcta y no cargaría», que ya costó una vuelta
  // — y desde el 2026-09-11 el esquema puede ser cualquiera de los dos, así que
  // suponerlo cuesta lo mismo.
  assert.match(avisoDeDeriva('dev', 'dev-9.x.ts.net', publicacion({ CWEB_PUERTO_TS: '9999' })),
    /http:\/\/dev-9\.x\.ts\.net:9999\//);
  assert.match(avisoDeDeriva('dev', 'dev-9.x.ts.net', publicacion({ CWEB_TS_ESQUEMA: 'https' })),
    /https:\/\/dev-9\.x\.ts\.net:8443\//);
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

// ---------------------------------------------------------------------------
// Darse de baja: el simétrico de unirse, y lo que hace que no haga falta
// ninguna credencial. MEDIDO el 2026-09-10 en el dev: `tailscale logout` borró
// el nodo y el nombre `dev-1` se reutilizó en 2 s, contra los ~75 min de la
// limpieza por inactividad.
// ---------------------------------------------------------------------------

test('⚠⚠ desunirse NO necesita ninguna credencial: usa la del propio nodo', () => {
  const orden = ordenDeDesunir();
  assert.match(orden, /tailscale logout/);
  // Ésta es la propiedad que hace que toda la opción valga: si aquí apareciera
  // una clave, volveríamos al problema de repartir un token capaz de borrar
  // cualquier dispositivo de la tailnet, incluido el móvil del dueño.
  assert.ok(!/tskey-|auth-key|authkey|client_secret|--token/i.test(orden),
    'si desunirse necesitara una clave, no serviría para lo que existe');
});

test('⚠ el script de desunir es SECO por defecto y sale SIEMPRE con 0', () => {
  const s = readFileSync(join(RAIZ, 'scripts', 'tailscale-desunir.mjs'), 'utf8');
  assert.match(s, /--si/, 'para desunir de verdad hay que pedirlo');
  // Lo corre el `pre_destroy` del lanzador justo antes de destruir el droplet.
  // Un exit ≠ 0 ahí podría leerse como «no destruyas», y eso convierte una
  // molestia (nombre ocupado un rato) en una factura (droplet vivo).
  assert.ok(!/process\.exit\([^0)]/.test(s), 'nunca puede impedir que se destruya el droplet');
  assert.match(s, /catch/, 'un fallo al desunir se DICE y se sigue');
});

test('⚠ y el seco va ANTES de cualquier comprobación que pueda negarse', () => {
  const s = readFileSync(join(RAIZ, 'scripts', 'tailscale-desunir.mjs'), 'utf8');
  const iSeco = s.indexOf("includes('--si')");
  const iComprueba = s.indexOf('BackendState');
  assert.ok(iSeco > 0 && iComprueba > 0);
  assert.ok(iSeco < iComprueba,
    'un ensayo no desune nada, así que no puede hacer daño — y bloquearlo ' +
    'impediría mirar qué pasaría justo cuando más falta hace (lección de banco-k)');
});


// ---------------------------------------------------------------------------
// La OTRA deriva: nodo ↔ serve. Medido el 2026-09-10 y costó la app entera.
// ---------------------------------------------------------------------------
//
// ⚠⚠ Lo que hace a este fallo distinto del de arriba: **el nodo tenía el nombre
// CORRECTO**. Entró como `dev-2`, se puso el serve, y luego un `logout` + volver
// a unir le devolvió el nombre bueno `dev` — o sea que la reparación fue la que
// rompió. `hayDeriva()` no podía saltar (no había deriva de nombre) y aun así
// ninguna de las dos direcciones servía.

test('⚠ el caso real: el nodo es `dev` y el serve sigue publicando `dev-2`', () => {
  const r = serveHuerfano('dev.ejemplo.ts.net.', { Web: { 'dev-2.ejemplo.ts.net:8443': {} } });
  assert.equal(r.sabe, true);
  assert.deepEqual(r.huerfanos, ['dev-2.ejemplo.ts.net:8443'],
    'si esto no se detecta, `cweb url` devuelve la URL muerta con total confianza');
  assert.deepEqual(r.propios, [], 'y no hay ninguna dirección buena que dar');
});

test('el puerto y el punto final del FQDN no cuentan al comparar', () => {
  const r = serveHuerfano('dev.ejemplo.ts.net.', { Web: { 'dev.ejemplo.ts.net:8443': {} } });
  assert.deepEqual(r.huerfanos, [], 'es el mismo host: sólo cambia el puerto');
  assert.deepEqual(r.propios, ['dev.ejemplo.ts.net:8443']);
});

test('con los dos publicados se distingue cuál sirve', () => {
  const r = serveHuerfano('dev.ejemplo.ts.net.',
    { Web: { 'dev-2.ejemplo.ts.net:8443': {}, 'dev.ejemplo.ts.net:8443': {} } });
  assert.deepEqual(r.propios, ['dev.ejemplo.ts.net:8443']);
  assert.deepEqual(r.huerfanos, ['dev-2.ejemplo.ts.net:8443']);
});

test('⚠ sin poder comparar NO se afirma que haya nada roto', () => {
  // Misma regla que `hayDeriva` y que el `NO SÉ` del freno: inventarse un
  // problema manda a resetear un serve que estaba bien.
  assert.equal(serveHuerfano(null, { Web: { 'dev.ejemplo.ts.net:8443': {} } }).sabe, false);
  assert.equal(serveHuerfano('dev.ejemplo.ts.net', null).sabe, false);
  assert.equal(serveHuerfano('dev.ejemplo.ts.net', {}).sabe, false);
  assert.equal(avisoDeServeHuerfano(null, { Web: { 'x.ts.net:8443': {} } }), '');
});

test('sin huérfanos no se dice nada: un aviso que sale siempre se deja de leer', () => {
  assert.equal(avisoDeServeHuerfano('dev.ejemplo.ts.net.', { Web: { 'dev.ejemplo.ts.net:8443': {} } }), '');
});

test('el aviso trae el comando que lo arregla, y el `reset` va ANTES', () => {
  const a = avisoDeServeHuerfano('dev.ejemplo.ts.net.',
    { Web: { 'dev-2.ejemplo.ts.net:8443': {} } }, publicacion({}), '8020');
  assert.match(a, /dev-2\.ejemplo\.ts\.net:8443/, 'dice cuál sobra');
  assert.match(a, /tailscale serve reset/, 'y cómo quitarlo');
  assert.match(a, /serve --bg --http=8080 http:\/\/127\.0\.0\.1:8020/, 'y cómo reponerlo');
  assert.ok(a.indexOf('serve reset') < a.indexOf('--bg'),
    '⚠ el orden importa: `--bg` AÑADE el host nuevo y no borra el viejo, así que ' +
    'sin el reset delante quedan los dos publicados');
});

// ---------------------------------------------------------------------------
// Probarse a sí mismo por la tailnet, con `--accept-dns=false`.
// ---------------------------------------------------------------------------

test('⚠ la comprobación resuelve a mano: esta máquina NO resuelve su MagicDNS', () => {
  // Medido el 2026-09-10 con el serve ya arreglado y contestando:
  //   sin --resolve -> "000"  (curl: (6) Could not resolve host)
  //   con --resolve -> "200"
  // O sea que el paso que confirma que la web se ve decía que NO se veía,
  // siempre. Peor que no comprobar.
  const o = ordenDeProbar('dev.ejemplo.ts.net.', '100.64.0.1', publicacion({}));
  assert.match(o, /--resolve dev\.ejemplo\.ts\.net:8080:100\.64\.0\.1/);
  assert.match(o, /http:\/\/dev\.ejemplo\.ts\.net:8080\/api\/salud/);
});

test('⚠ se prueba por el FQDN, y nunca saltándose el certificado', () => {
  const o = ordenDeProbar('dev.ejemplo.ts.net', '100.64.0.1');
  assert.ok(!/127\.0\.0\.1/.test(o),
    'por loopback se probaría la app, que ya se sabe viva; lo que falla es el tramo de tailscale');
  assert.ok(!/\s-k\b/.test(o) && !/--insecure/.test(o),
    'el móvil tampoco aceptará un cert malo: si no valida, es un fallo');
});

test('sin nombre de nodo no hay nada que probar', () => {
  assert.equal(ordenDeProbar(null, '100.64.0.1'), null);
});

// ---------------------------------------------------------------------------
// CÓMO se publica: esquema y puerto, que desde el 2026-09-11 son DATO.
// ---------------------------------------------------------------------------
//
// ⚠⚠ El fallo que esto evita ya ocurrió, y no en el código sino en la factura de
// certificados: Let's Encrypt da 5 por semana y por nombre exacto, y este nombre
// se reutiliza en CADA dev a propósito (para que la PWA instalada siga
// resolviendo). El sexto dev de la semana nacía sin web móvil, y el síntoma era
// «la app tarda muchísimo» — el móvil colgado en un handshake TLS que nunca
// termina. Medido en esta máquina el 2026-09-11: 27 handshakes así en dos horas,
// con la app contestando 200 en 8 ms por loopback todo el rato.

test('por defecto se publica por http y sin certificado', () => {
  const p = publicacion({});
  assert.equal(p.esquema, 'http');
  assert.equal(p.puerto, '8080');
  assert.equal(p.bandera, '--http=8080');
});

test('⚠ se puede volver a https sin tocar código, y el puerto le sigue', () => {
  // La marcha atrás tiene que ser un dato: si algún día el certificado sobrevive
  // al rehacer la máquina, o simplemente se ha soltado el límite semanal.
  const p = publicacion({ CWEB_TS_ESQUEMA: 'https' });
  assert.equal(p.esquema, 'https');
  assert.equal(p.puerto, '8443', 'el puerto por defecto va con el esquema, no aparte');
  assert.equal(p.bandera, '--https=8443');
});

test('un `CWEB_PUERTO_TS` explícito manda sobre el defecto de cada esquema', () => {
  assert.equal(publicacion({ CWEB_PUERTO_TS: '9999' }).puerto, '9999');
  assert.equal(publicacion({ CWEB_TS_ESQUEMA: 'https', CWEB_PUERTO_TS: '9999' }).bandera,
    '--https=9999');
});

test('⚠ un esquema que no se entiende cae a http, NO se pasa tal cual', () => {
  // Pasarlo tal cual compondría `--ftp=8080` y `serve` fallaría con un error que
  // no se parece a «has escrito mal una variable». Y ninguno de los dos valores
  // puede colarse vacío: el 443 lo tiene sshd y publicar ahí chocaría.
  for (const raro of ['ftp', 'HTTPS ', '', '   ', 'sí']) {
    const p = publicacion({ CWEB_TS_ESQUEMA: raro });
    assert.ok(p.esquema === 'http' || p.esquema === 'https', `«${raro}» dio ${p.esquema}`);
    assert.match(p.bandera, /^--https?=\d+$/);
    assert.notEqual(p.puerto, '443', 'ahí escucha sshd en 0.0.0.0');
  }
  assert.equal(publicacion({ CWEB_TS_ESQUEMA: 'HTTPS' }).esquema, 'https',
    'las mayúsculas son de tecleo, no una elección distinta');
});

test('la orden de servir y la URL salen del MISMO sitio', () => {
  const p = publicacion({});
  assert.equal(ordenDeServir(p, '8020'),
    'sudo -n tailscale serve --bg --http=8080 http://127.0.0.1:8020');
  assert.equal(urlPublica('dev.ejemplo.ts.net.', p), 'http://dev.ejemplo.ts.net:8080/');
  assert.equal(urlPublica('dev.ejemplo.ts.net', publicacion({ CWEB_TS_ESQUEMA: 'https' })),
    'https://dev.ejemplo.ts.net:8443/');
});

test('⚠⚠ ningún script compone la orden del serve por su cuenta', () => {
  // R17: la comprobación corre sola. Si mañana alguien vuelve a escribir
  // `serve --bg --https=…` a mano en un script, el esquema deja de ser un dato y
  // `CWEB_TS_ESQUEMA` miente en silencio — que es peor que no tenerlo.
  //
  // ⚠ Se miran las líneas de CÓDIGO, no los comentarios: estos ficheros explican
  // el fallo del 2026-09-10 citando `serve --bg` literalmente, y un guardián que
  // salta con la explicación del fallo obliga a borrar la explicación.
  const soloCodigo = (src) => src.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

  for (const rel of ['scripts/tailscale-unir.mjs', 'scripts/tailscale-serve.mjs']) {
    const src = soloCodigo(readFileSync(join(RAIZ, rel), 'utf8'));
    assert.match(src, /ordenDeServir\(/, `${rel} tiene que componerla con ordenDeServir()`);
    assert.ok(!/serve --bg/.test(src),
      `${rel} compone la orden a mano: el esquema dejaría de ser un dato`);
  }
  // Y `cweb url` tampoco puede dar el esquema por hecho: una URL con el esquema
  // equivocado «parece correcta y no carga», que es el fallo del puerto 443 otra vez.
  const cweb = soloCodigo(readFileSync(join(RAIZ, 'scripts/cweb.mjs'), 'utf8'));
  assert.ok(!/`https:\/\/\$\{/.test(cweb), 'cweb.mjs supone https al componer la URL');
});

// ------------------------------------- la TERCERA deriva: esquema/puerto

test('el esquema de un puerto se LEE del serve, no se deduce del número', () => {
  // El propio `serve status --json` lo trae. Comprobado en esta máquina el
  // 2026-09-11 con las dos puertas vivas a la vez.
  const serve = { TCP: { 8443: { HTTPS: true }, 8080: { HTTP: true } } };
  assert.equal(esquemaPublicado(serve, '8443'), 'https');
  assert.equal(esquemaPublicado(serve, 8080), 'http');
  assert.equal(esquemaPublicado(serve, '9999'), null, 'lo que no está no se inventa');
  assert.equal(esquemaPublicado(null, '8080'), null);
});

test('⚠⚠ la puerta https que sobra al pasar a http SE DETECTA', () => {
  // `serve --bg` AÑADE y no reemplaza, así que cambiar de bandera deja las dos
  // publicadas. `serveHuerfano` no la ve porque el host ES el de este nodo — y es
  // justo la que cuelga al móvil pidiendo un certificado que no va a llegar.
  const serve = {
    TCP: { 8443: { HTTPS: true }, 8080: { HTTP: true } },
    Web: { 'dev.ejemplo.ts.net:8443': {}, 'dev.ejemplo.ts.net:8080': {} },
  };
  assert.deepEqual(serveHuerfano('dev.ejemplo.ts.net.', serve).huerfanos, [],
    'el host es el bueno: la deriva de NOMBRE no puede verla');

  const { sobran, sabe } = publicacionSobrante('dev.ejemplo.ts.net.', serve, publicacion({}));
  assert.equal(sabe, true);
  assert.deepEqual(sobran, ['dev.ejemplo.ts.net:8443 (https)']);
});

test('cuando lo publicado ES lo declarado, no sobra nada', () => {
  const serve = { TCP: { 8080: { HTTP: true } }, Web: { 'dev.ejemplo.ts.net:8080': {} } };
  assert.deepEqual(publicacionSobrante('dev.ejemplo.ts.net.', serve, publicacion({})).sobran, []);
});

test('⚠ sin poder comparar NO se afirma que sobre nada: quien llama a esto RESETEA', () => {
  // Mismo criterio que `serveHuerfano` y que el `NO SÉ` del freno del
  // coordinador, y aquí importa el doble: resetear por no saber se lleva por
  // delante un serve puesto a mano.
  assert.equal(publicacionSobrante(null, { Web: { 'x:8443': {} } }, publicacion({})).sabe, false);
  assert.deepEqual(publicacionSobrante(null, { Web: { 'x:8443': {} } }, publicacion({})).sobran, []);
  // Publicado sin `TCP` legible: el puerto está, el esquema no se sabe -> no sobra.
  const sinTcp = { Web: { 'dev.ejemplo.ts.net:8443': {} } };
  assert.deepEqual(publicacionSobrante('dev.ejemplo.ts.net.', sinTcp, publicacion({})).sobran, []);
});
