// El acceso por Cloudflare Tunnel: la alternativa a Tailscale, y cómo se elige.
//
// Por qué existe (decisión del dueño, 2026-09-12): Tailscale quedó marcado como
// VÁLIDO —todo lo que mordió está cerrado con test— pero «seguro van a salir
// nuevos», y se quiere probar otro camino. La única restricción: la app tiene
// que poder INSTALARSE en el móvil, o sea `https://` con certificado que el móvil
// acepte y un nombre que no cambie al rehacer el dev.
//
// Qué da este camino, comprobado en vivo el 2026-09-12 00:37 UTC desde el dev con
// un túnel rápido (`cloudflared tunnel --url http://127.0.0.1:8099`): HTTPS
// válido, sin abrir ningún puerto (el túnel SALE del droplet), en 0,38 s.
//
//   - el certificado lo pone Cloudflare en su borde: no hay Let's Encrypt, ni
//     límite de 5 por semana, ni nada que viajar;
//   - el nombre es tuyo (`claude.<tu-dominio>`) y no depende de que un nodo
//     recupere su nombre: un dev nuevo levanta el MISMO túnel con el mismo token;
//   - el token del túnel no caduca (la authkey de Tailscale sí, a los 90 días);
//   - en el móvil no hace falta ninguna app: quien abre la web se identifica con
//     Cloudflare Access (login de Google o PIN por correo) y la sesión dura lo
//     que se configure, hasta un mes.
//
// Lo que cuesta, dicho entero: un dominio en Cloudflare (unos dólares al año), y
// que **el tráfico pasa en claro por el borde de Cloudflare**, que termina el TLS
// — con Tailscale nunca salía de tus máquinas. Y Access es la ÚNICA barrera: sin
// una policy puesta, la web está abierta al mundo. Por eso `veredictoDeSonda()`
// grita si la sonda vuelve con 200 en vez de con la redirección al login.
//
// ⚠ El bind de `server/index.mjs` a 127.0.0.1 NO se toca: `cloudflared` hace de
// proxy contra ese mismo loopback, igual que hacía `tailscale serve` (P2).
//
// ⚠ EL TOKEN NO SE IMPRIME NI VIAJA POR LA LÍNEA DE ÓRDENES. La documentación
// de Cloudflare enseña `cloudflared service install <token>`, y eso deja el
// token en el `ps`, en el journal y en el fichero de la unidad. Aquí va a
// `/etc/cloudflared/claude-web.env` (root, 0600) por un temporal 0600 más
// `install`, y la unidad lo lee con `EnvironmentFile=`: la misma regla que la
// authkey en `ordenDeUnir()` y que el certificado en `certificado.mjs`.

import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const UNIDAD_TUNEL = 'cloudflared-claude-web';
export const FICHERO_ENTORNO_TUNEL = '/etc/cloudflared/claude-web.env';
export const RUTA_UNIDAD_TUNEL = `/etc/systemd/system/${UNIDAD_TUNEL}.service`;
export const DEB_CLOUDFLARED =
  'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb';

const sh = (cmd) => {
  try {
    return { ok: true, out: execSync(cmd, { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (e) { return { ok: false, out: ((e.stdout || '') + (e.stderr || '')).trim() }; }
};

/** Una variable de configuración, con o sin el prefijo `CWEB_`.
 *  El puente `env_prefix` del lanzador QUITA el prefijo (`CWEB_ACCESO` llega
 *  como `ACCESO`) y `entornos aplicar` lo conserva: se aceptan las dos formas. */
export const leeConfig = (env, nombre) => String(env?.[`CWEB_${nombre}`] ?? env?.[nombre] ?? '').trim();

export const tokenDelTunel = (env = process.env) => String(env?.CF_TUNNEL_TOKEN ?? '').trim();

/** `claude.ejemplo.com`, venga como venga: sin esquema, sin barra, sin espacios. */
export function hostnameDelTunel(env = process.env) {
  return String(env?.CF_HOSTNAME ?? '').trim().replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '').replace(/\.$/, '');
}

/**
 * Por dónde se llega a la web: `'cloudflare'` o `'tailscale'`.
 *
 * `CWEB_ACCESO` explícito manda. Sin él, lo decide un DATO: si hay token de
 * túnel, Cloudflare; si no, Tailscale, que es lo que había. Así una máquina con
 * los dos secretos hace lo que se le dijo, y una con uno solo hace lo único que
 * puede — sin que nadie tenga que acordarse de una variable más.
 */
export function modoDeAcceso(env = process.env) {
  const pedido = leeConfig(env, 'ACCESO').toLowerCase();
  if (pedido === 'cloudflare' || pedido === 'tailscale') return pedido;
  return tokenDelTunel(env) ? 'cloudflare' : 'tailscale';
}

/** El aviso cuando `CWEB_ACCESO` dice algo que no es ninguno de los dos, o ''. */
export function avisoDeModo(env = process.env) {
  const pedido = leeConfig(env, 'ACCESO');
  if (!pedido || ['cloudflare', 'tailscale'].includes(pedido.toLowerCase())) return '';
  return `⚠ CWEB_ACCESO="${pedido}" no es ni cloudflare ni tailscale: lo ignoro y decido ` +
    `por el dato (${modoDeAcceso(env)}).`;
}

export const urlDelTunel = (host) => `https://${String(host ?? '').replace(/\/$/, '')}/`;

/** `TUNNEL_TOKEN=…`, que es lo que `cloudflared tunnel run` lee del entorno. */
export const contenidoEntornoTunel = (token) => `TUNNEL_TOKEN=${String(token).trim()}\n`;

/**
 * La unidad de systemd. Sin el token dentro: lo lee de `EnvironmentFile`, que
 * systemd abre como root ANTES de bajar a `DynamicUser`. `cloudflared` no
 * necesita ningún privilegio: sale hacia Cloudflare y entra a 127.0.0.1:puerto.
 */
export function unidadDelTunel(ficheroEntorno = FICHERO_ENTORNO_TUNEL) {
  return `[Unit]
Description=${UNIDAD_TUNEL} (tunel de Cloudflare hacia la web de lectura, en 127.0.0.1)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
DynamicUser=yes
EnvironmentFile=${ficheroEntorno}
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

/** Las órdenes que dejan el túnel instalado y corriendo, a partir de dos temporales. */
export function ordenesDeInstalarTunel(tmpEntorno, tmpUnidad) {
  return [
    'sudo -n install -d -m 0755 -o root -g root /etc/cloudflared',
    `sudo -n install -m 0600 -o root -g root ${tmpEntorno} ${FICHERO_ENTORNO_TUNEL}`,
    `sudo -n install -m 0644 -o root -g root ${tmpUnidad} ${RUTA_UNIDAD_TUNEL}`,
    'sudo -n systemctl daemon-reload',
    `sudo -n systemctl enable ${UNIDAD_TUNEL}`,
    // `restart` y no `start`: si la unidad ya corría con otro token, `start` no
    // haría nada y el token nuevo quedaría escrito sin usarse.
    `sudo -n systemctl restart ${UNIDAD_TUNEL}`,
  ];
}

/** La sonda: el código HTTP de `/api/salud` a través de Cloudflare, sin seguir redirecciones. */
export const ordenDeProbarTunel = (host) =>
  `curl -s -o /dev/null --max-time 20 -w '%{http_code}' ${urlDelTunel(host)}api/salud`;

/**
 * Qué significa el código que devolvió la sonda. Lo importante no es «llega o
 * no llega»: es que **200 es la ALARMA**. Sin Access delante, la web contesta a
 * cualquiera del mundo, y desde dentro se ve exactamente igual de bien.
 *
 * @returns {{llega: boolean, protegida: boolean|null, texto: string}}
 */
export function veredictoDeSonda(codigo) {
  const c = String(codigo ?? '').trim();
  if (c === '200') {
    return { llega: true, protegida: false, texto:
      '⚠⚠ LA WEB ESTÁ ABIERTA AL MUNDO: la sonda entró sin login (200). Cloudflare ' +
      'Access no la está protegiendo. Pon la policy en Zero Trust → Access → ' +
      'Applications AHORA, o para el túnel:  sudo -n systemctl stop ' + UNIDAD_TUNEL };
  }
  if (c === '302' || c === '401' || c === '403') {
    return { llega: true, protegida: true, texto:
      `✅ Llega por Cloudflare y Access la protege (la sonda sin sesión recibió ${c}: ` +
      'redirección al login).' };
  }
  if (c === '530') {
    return { llega: false, protegida: null, texto:
      '❌ Cloudflare contesta 530: el nombre apunta a un túnel que NO está conectado. ' +
      `Mira \`systemctl status ${UNIDAD_TUNEL}\` y \`journalctl -u ${UNIDAD_TUNEL} -n 30\`.` };
  }
  if (c === '000' || c === '') {
    return { llega: false, protegida: null, texto:
      '❌ No hay respuesta: el nombre no resuelve o no llega a Cloudflare. ¿Está ' +
      'creado el "public hostname" del túnel con ese nombre?' };
  }
  return { llega: false, protegida: null, texto:
    `❌ La sonda recibió ${c}. Con 502/503, el túnel está pero la app no contesta en ` +
    '127.0.0.1 (¿arrancada?). Con otro código, mira el journal del túnel.' };
}

// ---------------------------------------------------------------------------
// Con efectos.
// ---------------------------------------------------------------------------

/** Instala `cloudflared` si no está. El .deb oficial, la última versión. */
export function instalarCloudflared(ejecutar = sh) {
  if (ejecutar('command -v cloudflared').ok) return { ok: true, out: 'ya estaba' };
  const r = ejecutar(
    `curl -fsSL -o /tmp/cloudflared.deb ${DEB_CLOUDFLARED} && sudo -n dpkg -i /tmp/cloudflared.deb; ` +
    'rm -f /tmp/cloudflared.deb');
  return r.ok ? { ok: true, out: 'instalado' } : r;
}

/**
 * Deja el túnel instalado y corriendo con el token del entorno.
 * @returns {{hecho: boolean, mensaje: string, url: string|null}} — nunca lanza.
 */
export function ponerTunel(env = process.env, ejecutar = sh, seco = false) {
  const token = tokenDelTunel(env);
  const host = hostnameDelTunel(env);
  if (!token) {
    return { hecho: false, url: null, mensaje:
      '[cloudflare] no hay CF_TUNNEL_TOKEN: no puedo levantar el túnel. En el llavero del ' +
      'lanzador se llama CWEB_CF_TUNNEL_TOKEN (README § «Acceso por Cloudflare»).' };
  }
  if (!host) {
    return { hecho: false, url: null, mensaje:
      '[cloudflare] no hay CF_HOSTNAME (el "public hostname" del túnel, p. ej. ' +
      'claude.tudominio.com): sin él no sé qué dirección anunciar ni probar. En el ' +
      'llavero: CWEB_CF_HOSTNAME.' };
  }
  if (seco) {
    return { hecho: false, url: urlDelTunel(host), mensaje:
      `[cloudflare] SECO: instalaría cloudflared, escribiría ${FICHERO_ENTORNO_TUNEL} (0600, ` +
      `sin imprimirlo) y ${RUTA_UNIDAD_TUNEL}, y arrancaría ${UNIDAD_TUNEL}. URL: ${urlDelTunel(host)}` };
  }
  const inst = instalarCloudflared(ejecutar);
  if (!inst.ok) return { hecho: false, url: null, mensaje: `[cloudflare] no pude instalar cloudflared: ${inst.out.slice(-300)}` };

  let dir = null;
  try {
    dir = mkdtempSync(join(tmpdir(), 'cftunel-'));
    const tmpEntorno = join(dir, 'claude-web.env');
    const tmpUnidad = join(dir, `${UNIDAD_TUNEL}.service`);
    writeFileSync(tmpEntorno, contenidoEntornoTunel(token), { mode: 0o600 });
    writeFileSync(tmpUnidad, unidadDelTunel(), { mode: 0o644 });
    for (const orden of ordenesDeInstalarTunel(tmpEntorno, tmpUnidad)) {
      const r = ejecutar(orden);
      if (!r.ok) {
        // El error de una orden nunca lleva el token: ninguna orden lo lleva.
        return { hecho: false, url: null, mensaje: `[cloudflare] falló «${orden.replace(dir, '<tmp>')}»: ${r.out.slice(-300)}` };
      }
    }
  } finally {
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* se va con la máquina */ } }
  }
  return { hecho: true, url: urlDelTunel(host), mensaje:
    `[cloudflare] túnel ${UNIDAD_TUNEL} instalado y arrancado (cloudflared ${inst.out}).` };
}

/** La unidad está activa y el túnel registró conexión con Cloudflare. */
export function estadoDelTunel(ejecutar = sh) {
  const activa = ejecutar(`systemctl is-active ${UNIDAD_TUNEL}`).out === 'active';
  const j = ejecutar(`journalctl -u ${UNIDAD_TUNEL} -n 40 --no-pager -o cat 2>/dev/null`).out;
  const conectado = /Registered tunnel connection/.test(j);
  const ultimoError = (j.split('\n').filter((l) => /ERR|error/i.test(l)).pop() || '').slice(0, 200);
  return { activa, conectado, ultimoError };
}
