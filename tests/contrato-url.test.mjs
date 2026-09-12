// El CONTRATO de la dirección: qué se le entrega al lanzador, y qué al humano.
//
// ⚠⚠ EL FALLO QUE ESTO CAZA, reproducido el 2026-09-12 ejecutando el código:
// `cweb url` devolvía un texto que mezclaba el dato con su explicación, y el
// lanzador consume ese mismo texto por un contrato estrecho —*la última línea no
// vacía que contenga `://`*, `do_droplet.py:2591`—. Cuando el `serve` quedaba en
// un estado raro, la última línea era el comando que lo arregla:
//
//     sudo -n tailscale serve --bg --http=8080 http://127.0.0.1:8020
//
// …y `launch` anunciaba ESO como el link del dueño, con un «Ábrelo:» delante.
// Un dato que parece bueno y no lo es cuesta más que no darlo: se abre desde el
// móvil, no carga, y se concluye que la app está rota cuando lo único roto era
// el mensajero.
//
// Aquí se fija el arreglo por los dos lados: que el dato sea siempre un dato
// (`esDireccion`), y que los avisos NO se lo coman ni lo contaminen.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { esDireccion, resolverDireccion, publicacion } from '../scripts/nodo.mjs';

const PUB = publicacion({});                       // http, 8080
const NODO = 'dev.ejemplo.ts.net.';

/** El parser del lanzador, copiado tal cual (`url_de_servicio`, do_droplet.py). */
function loQueEntenderiaElLanzador(salida) {
  const lineas = String(salida).split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lineas.length) return null;
  return lineas[lineas.length - 1].includes('://') ? lineas[lineas.length - 1] : null;
}

// --------------------------------------------------------- esDireccion

test('⚠⚠ una dirección es una dirección; una ORDEN que lleva una dentro, no', () => {
  assert.equal(esDireccion('http://dev.ejemplo.ts.net:8080/'), true);
  assert.equal(esDireccion('https://claude.ejemplo.com/'), true);

  // Ésta es exactamente la línea que el lanzador anunciaba como link.
  assert.equal(esDireccion('sudo -n tailscale serve --bg --http=8080 http://127.0.0.1:8020'), false,
    'lo que la distingue es que tiene ESPACIOS; un includes("://") no puede verlo');

  for (const malo of ['', null, undefined, '  ', 'Desde el móvil: http://x/', 'ssh -L 8020:127.0.0.1:8020']) {
    assert.equal(esDireccion(malo), false, `«${malo}» no es una dirección`);
  }
});

// --------------------------------------------------- resolverDireccion

test('lo normal: hay serve propio, sale la dirección y no sobra ningún aviso', () => {
  const serve = { TCP: { 8080: { HTTP: true } }, Web: { 'dev.ejemplo.ts.net:8080': {} } };
  const r = resolverDireccion({ dnsNodo: NODO, serve, pub: PUB, nombrePedido: 'dev' });
  assert.equal(r.direccion, 'http://dev.ejemplo.ts.net:8080/');
  assert.deepEqual(r.avisos, []);
  assert.equal(r.motivo, '');
});

test('⚠⚠ el caso que rompía: todo lo publicado es de otro nombre → NO hay dirección', () => {
  const serve = { TCP: { 8080: { HTTP: true } }, Web: { 'dev-2.ejemplo.ts.net:8080': {} } };
  const r = resolverDireccion({ dnsNodo: NODO, serve, pub: PUB, nombrePedido: 'dev' });

  assert.equal(r.direccion, null, 'dar la muerta «porque es lo que dice el status» costó la app entera');
  assert.ok(r.motivo, 'y se dice por qué, en una línea');
  assert.equal(r.avisos.length, 1, 'la explicación larga sigue estando, aparte');

  // AQUÍ está el fallo, demostrado: la explicación, leída con el contrato del
  // lanzador, produce una «dirección» que es una orden de shell.
  const enganio = loQueEntenderiaElLanzador(r.avisos[0]);
  assert.match(enganio, /^sudo -n tailscale serve/,
    'el texto para humanos SÍ engaña al parser: por eso el dato va aparte');
  assert.equal(esDireccion(enganio), false, 'y por eso el freno es esDireccion(), no includes("://")');

  // Y el contrato nuevo no puede entregar eso: no hay dirección que entregar.
  assert.equal(r.direccion, null);
});

test('⚠ un aviso NO quita la dirección: con una puerta de más la web SE VE', () => {
  // `serve --bg` añade y no reemplaza, así que al cambiar de esquema quedan las
  // dos publicadas. Negar el link aquí dejaría al dueño sin app por un aviso.
  const serve = {
    TCP: { 8080: { HTTP: true }, 8443: { HTTPS: true } },
    Web: { 'dev.ejemplo.ts.net:8080': {}, 'dev.ejemplo.ts.net:8443': {} },
  };
  const r = resolverDireccion({ dnsNodo: NODO, serve, pub: PUB, nombrePedido: 'dev' });
  assert.equal(r.direccion, 'http://dev.ejemplo.ts.net:8080/');
  assert.equal(r.avisos.length, 1, 'y la puerta de más se dice igual');
  assert.match(r.avisos[0], /sobra publicado/);
});

test('⚠ el nodo entró con otro nombre: hay dirección, y el aviso la acompaña', () => {
  const serve = { TCP: { 8080: { HTTP: true } }, Web: { 'dev-1.ejemplo.ts.net:8080': {} } };
  const r = resolverDireccion({ dnsNodo: 'dev-1.ejemplo.ts.net.', serve, pub: PUB, nombrePedido: 'dev' });
  assert.equal(r.direccion, 'http://dev-1.ejemplo.ts.net:8080/', 'la que SÍ funciona ahora');
  assert.ok(r.avisos.some((a) => /NO SE LLAMA/.test(a)), 'y se dice que el nombre derivó');
});

test('sin serve puesto no se inventa nada, y el motivo distingue los dos casos', () => {
  const fuera = resolverDireccion({ dnsNodo: NODO, serve: null, pub: PUB, dentroDeLaTailnet: false });
  assert.equal(fuera.direccion, null);
  assert.match(fuera.motivo, /todavía no está en la tailnet/);

  const dentro = resolverDireccion({ dnsNodo: NODO, serve: null, pub: PUB, dentroDeLaTailnet: true });
  assert.equal(dentro.direccion, null);
  assert.match(dentro.motivo, /no hay ningún serve/,
    'son dos arreglos distintos: unir el nodo, o poner el serve');
});

test('⚠ lo que salga del texto del status pasa por el mismo freno', () => {
  // Sin `--json` legible se cae al regex sobre el texto. Ni siquiera ahí puede
  // colarse algo que no tenga forma de dirección.
  const r = resolverDireccion({
    dnsNodo: null, serve: null, pub: PUB,
    serveTexto: 'https://dev.ejemplo.ts.net:8443 (tailnet only)\n|-- / proxy http://127.0.0.1:8020',
  });
  assert.ok(r.direccion === null || esDireccion(r.direccion.replace(/\/$/, '')),
    'o no hay, o es una dirección de verdad; nunca una frase');
});

test('⚠⚠ R17: TODA salida de resolverDireccion respeta el contrato del lanzador', () => {
  // El barrido: sea cual sea el estado, o hay una dirección que el parser del
  // lanzador entendería igual que nosotros, o no hay nada que darle. Lo que no
  // puede pasar es que los dos lados lean cosas distintas.
  const estados = [
    { serve: { TCP: { 8080: { HTTP: true } }, Web: { 'dev.ejemplo.ts.net:8080': {} } } },
    { serve: { TCP: { 8080: { HTTP: true } }, Web: { 'dev-2.ejemplo.ts.net:8080': {} } } },
    { serve: { TCP: { 8443: { HTTPS: true } }, Web: { 'dev.ejemplo.ts.net:8443': {} } } },
    { serve: null },
    { serve: {} },
    { serve: { Web: {} } },
  ];
  for (const e of estados) {
    const r = resolverDireccion({ dnsNodo: NODO, pub: PUB, nombrePedido: 'dev', ...e });
    if (r.direccion === null) {
      assert.ok(r.motivo, 'sin dirección SIEMPRE hay motivo: el lanzador lo enseña como pista');
      continue;
    }
    // Lo que se imprime en modo `--plano` es exactamente esto, y una sola línea.
    assert.equal(r.direccion.split('\n').length, 1, 'una línea, nunca dos');
    assert.equal(loQueEntenderiaElLanzador(r.direccion), r.direccion,
      'el lanzador tiene que leer EXACTAMENTE lo que le damos');
    assert.equal(esDireccion(r.direccion.replace(/\/$/, '')), true);
  }
});

// ---------------------------------------------------------------------------
// La SEGUNDA vuelta (2026-09-12): entre varias cadenas con forma de dirección,
// ¿se elige la MÍA y la DECLARADA?
// ---------------------------------------------------------------------------
//
// ⚠⚠ `esDireccion()` distingue una dirección de una orden de shell, y eso basta
// para que el lanzador no anuncie un comando. Pero NO decide **cuál** de varias
// direcciones bien formadas es la buena, y ahí quedaban tres huecos. Los tres se
// reprodujeron ejecutando el código, y los tres tienen el mismo origen: se
// elegía **por posición** en vez de comparando — que es literalmente el fallo
// del 2026-09-10 («no se coge el primer https que salga»), a medio arreglar.

test('⚠⚠ entre dos puertas PROPIAS gana la DECLARADA, no la primera', () => {
  // Medido: con `pub` = https/8443 y las dos vivas, entregaba la vieja (8080) Y
  // a la vez avisaba de que la 8080 sobraba. Un dato que se contradice con el
  // consejo de al lado no se sigue: se ignoran los dos.
  //
  // ⚠ Y el test anterior no lo cazaba por casualidad: probaba la migración
  // contraria (https→http), donde 8080 es a la vez la declarada y la primera
  // por orden alfabético. Un caso que pasa por coincidencia no es cobertura.
  const serve = {
    TCP: { 8080: { HTTP: true }, 8443: { HTTPS: true } },
    Web: { 'dev.ejemplo.ts.net:8080': {}, 'dev.ejemplo.ts.net:8443': {} },
  };
  const httpsPub = publicacion({ CWEB_TS_ESQUEMA: 'https' });
  const r = resolverDireccion({ dnsNodo: NODO, serve, pub: httpsPub, nombrePedido: 'dev' });

  assert.equal(r.direccion, 'https://dev.ejemplo.ts.net:8443/', 'la declarada');
  assert.ok(!r.avisos.some((a) => a.includes(r.direccion.replace(/\/$/, ''))),
    '⚠ y nunca puede sobrar la misma que se entrega: eso es entregarla y mandar borrarla');
});

test('si lo DECLARADO no está publicado, se da lo que hay pero se DICE', () => {
  // Callarlo dejaría una dirección que funciona hoy y desaparece en cuanto
  // alguien reponga el serve, sin nada que lo explicara.
  const serve = { TCP: { 8080: { HTTP: true } }, Web: { 'dev.ejemplo.ts.net:8080': {} } };
  const r = resolverDireccion({ dnsNodo: NODO, serve,
    pub: publicacion({ CWEB_TS_ESQUEMA: 'https' }), nombrePedido: 'dev' });
  assert.equal(r.direccion, 'http://dev.ejemplo.ts.net:8080/');
  assert.ok(r.avisos.some((a) => /NO está publicado/.test(a)));
});

test('⚠⚠ el camino de reserva coge el FQDN, no el nombre corto', () => {
  // La salida real de `tailscale serve status` trae las dos formas, y el primer
  // match es el nombre CORTO. Todo el resto del código usa el FQDN a propósito:
  // este nodo se une con `--accept-dns=false` y no resuelve su propio nombre corto.
  const r = resolverDireccion({
    dnsNodo: NODO, serve: null, pub: PUB, nombrePedido: 'dev', dentroDeLaTailnet: true,
    serveTexto: 'http://dev:8080 (tailnet only)\nhttp://dev.ejemplo.ts.net:8080 (tailnet only)\n' +
                '|-- / proxy http://127.0.0.1:8020\n',
  });
  assert.equal(r.direccion, 'http://dev.ejemplo.ts.net:8080/');
});

test('⚠⚠ el camino de reserva NUNCA entrega la dirección de otro nodo', () => {
  // Reproducido: con el JSON diciendo «nada publicado» y el texto aún enseñando
  // un huérfano, devolvía `http://dev-2…:8080/` y con `avisos` VACÍO. Son cuatro
  // llamadas a `tailscale` en instantes distintos: que discrepen no es hipotético.
  const r = resolverDireccion({
    dnsNodo: NODO, serve: { TCP: {}, Web: {} }, pub: PUB, nombrePedido: 'dev',
    dentroDeLaTailnet: true,
    serveTexto: 'http://dev-2.ejemplo.ts.net:8080 (tailnet only)\n',
  });
  assert.equal(r.direccion, null, 'de otro nodo no es una dirección que darte');
  assert.match(r.motivo, /ninguna es de este nodo/);
});

test('⚠ sin nombre con el que comparar se dice NO SÉ, no se entrega a ciegas', () => {
  // Es el criterio del freno del coordinador: entregar una dirección sin poder
  // comprobar de quién es fue exactamente lo que costó la app el 2026-09-10.
  const r = resolverDireccion({
    dnsNodo: null, serve: null, pub: PUB,
    serveTexto: 'http://loquesea.ts.net:8080 (tailnet only)\n',
  });
  assert.equal(r.direccion, null);
  assert.match(r.motivo, /no puedo comprobar de quién es/);
});
