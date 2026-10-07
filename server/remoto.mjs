// MODO REMOTO: la web vive en el MINI y el coordinador (con claude) en el DEV.
//
// Pedido por el dueño el 2026-10-07: «que siempre sea el mini el que tenga el claude web.
// Así sólo trato con un app. Y el app me muestra las conversaciones aunque el dev no exista,
// y si escribo algo […] le transmite el msg a claude del dev (si existe dev), o me indica que
// no hay dev a quien enviarle el msg».
//
// Cómo, en tres piezas, y ninguna toca el contrato del log (telegram-coordinator/docs/log-de-mensajes.md):
//
//  1. LEER con dev vivo: cada SONDEO_MS se trae por SSH `data/{mensajes,sessions,executors}` y
//     `coordinador.json` del dev a un ESPEJO local, que es lo que el resto del servidor sirve
//     como si fuera el `data/` de siempre. Se copia fichero a fichero y sólo lo que cambió
//     (temporal + rename), así el vigilante del SSE ve cambios reales y nunca un fichero a medias.
//  2. LEER sin dev: el espejo se rellena con la FOTO que el dev deja en el almacén
//     (`foveal-vision-data/coordinador/<máquina>/mensajes/`, la escribe estado-por-tema.mjs),
//     fusionada por `id`. Se quita `coordinador.json`: no hay bot, y fingir latido mentiría.
//  3. ESCRIBIR: con dev, el mensaje se deja en `data/entrada/` DEL DEV por SSH (temporal + mv,
//     que es lo que espera src/entrada.ts del coordinador). Sin dev, se NIEGA y se dice: nada se
//     guarda para luego, porque una orden vieja ejecutada al nacer otro dev sería una sorpresa.
//
// Quién es «el dev» es un DATO (R16): el droplet con tag `atendida` y sin `control`, por la API de
// DigitalOcean. El mini lleva `control`; el dev, `atendida` (lo pone `launch`). Si hay varios, el
// más reciente. Sin DO_TOKEN no se puede saber, y entonces se dice «no sé», no «no hay dev».
//
// ⚠ Lo que se ve va unos segundos por detrás del dev (SONDEO_MS). Es el precio de no tocar el
// coordinador; si molesta, se baja el sondeo.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync,
  unlinkSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { encolarEnvio } from './datos.mjs';

export const SONDEO_MS = Number(process.env.CWEB_REMOTO_SONDEO_MS ?? 3000);
const DEV_CACHE_MS = 30_000;
const ALMACEN_CADA_MS = 60_000;

export const remotoActivo = (env = process.env) => env.CWEB_REMOTO === '1';

function correr(cmd, args, { input = null, timeout = 20_000 } = {}) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    const t = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', (e) => { clearTimeout(t); res({ code: -1, out: Buffer.alloc(0), err: e.message }); });
    p.on('close', (code) => { clearTimeout(t); res({ code, out: Buffer.concat(out), err: Buffer.concat(err).toString() }); });
    if (input !== null) p.stdin.end(input); else p.stdin.end();
  });
}

/** Escribe sólo si cambia, por temporal + rename. Devuelve true si escribió. */
function ponerSiCambia(ruta, contenido) {
  if (existsSync(ruta) && readFileSync(ruta).equals(contenido)) return false;
  mkdirSync(dirname(ruta), { recursive: true });
  const tmp = `${ruta}.espejo-tmp`;
  writeFileSync(tmp, contenido);
  renameSync(tmp, ruta);
  return true;
}

/** El dev, preguntando a la API de DO. `null` = no hay; lanza si no se puede saber. */
export async function buscarDev(env, fetchFn = fetch) {
  if (!env.DO_TOKEN) throw new Error('sin DO_TOKEN en esta máquina: no puedo preguntar si hay dev');
  const r = await fetchFn('https://api.digitalocean.com/v2/droplets?per_page=200',
    { headers: { Authorization: `Bearer ${env.DO_TOKEN}` }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`la API de DigitalOcean contestó ${r.status}`);
  const { droplets = [] } = await r.json();
  return elegirDev(droplets, env.CWEB_DEV_ETIQUETA || 'atendida');
}

/** Puro, para el test: atendida y no control; el más reciente. */
// `etiqueta` es configurable (CWEB_DEV_ETIQUETA) para poder probar el caso «sin dev» con el dev vivo.
export function elegirDev(droplets, etiqueta = 'atendida') {
  const cands = droplets
    .filter((d) => (d.tags ?? []).includes(etiqueta) && !(d.tags ?? []).includes('control'))
    .filter((d) => d.status === 'active')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const d = cands[0];
  if (!d) return null;
  const ip = (d.networks?.v4 ?? []).find((n) => n.type === 'public')?.ip_address;
  return ip ? { nombre: d.name, id: d.id, ip } : null;
}

/** Fusiona por id las fotos de todas las máquinas que hay en el almacén. Puro sobre textos. */
export function fusionarFotos(textos) {
  const porId = new Map();
  for (const t of textos) {
    for (const l of String(t).split('\n')) {
      if (!l.trim()) continue;
      try { const o = JSON.parse(l); if (o?.id && !porId.has(o.id)) porId.set(o.id, l); } catch { /* rota */ }
    }
  }
  return [...porId.keys()].sort().map((k) => porId.get(k)).join('\n') + (porId.size ? '\n' : '');
}

export function crearEspejo({ raiz, env = process.env, log = console.log, buscar = () => buscarDev(env) }) {
  const usuario = env.CWEB_DEV_USER || 'deploy';
  const clave = env.CWEB_SSH_KEY || join(homedir(), '.ssh', 'do_flota');
  const dataDev = env.CWEB_DEV_DATA || '$HOME/src/telegram-coordinator/data';
  const almacen = env.CWEB_ALMACEN || join(homedir(), 'src', 'foveal-vision-data');
  mkdirSync(join(raiz, 'mensajes'), { recursive: true });

  let dev = null, devVisto = 0, devError = null;
  let ultimoAlmacen = 0;
  const estado = { modo: 'remoto', dev: null, fuente: null, desde: null, error: null };

  const sshArgs = (ip) => ['-i', clave, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${join(homedir(), '.ssh', 'known_hosts_cweb')}`,
    '-o', 'ControlMaster=auto', '-o', `ControlPath=${join(tmpdir(), 'cweb-ssh-%C')}`, '-o', 'ControlPersist=120',
    `${usuario}@${ip}`];

  function guardarEstado() {
    ponerSiCambia(join(raiz, 'remoto.json'), Buffer.from(JSON.stringify(estado) + '\n'));
  }

  async function quienEsDev() {
    if (Date.now() - devVisto < DEV_CACHE_MS) return dev;
    try { dev = await buscar(); devError = null; } catch (e) { devError = e.message; }
    devVisto = Date.now();
    return dev;
  }

  async function desdeDev(d) {
    const r = await correr('ssh', [...sshArgs(d.ip),
      `cd "${dataDev}" 2>/dev/null && tar cf - mensajes sessions executors coordinador.json 2>/dev/null; true`],
    { timeout: 20_000 });
    if (r.code !== 0 || !r.out.length) throw new Error(`no pude leer el dev por SSH: ${r.err.split('\n').filter(Boolean).pop() || 'sin salida'}`);
    const tmp = mkdtempSync(join(tmpdir(), 'cweb-espejo-'));
    try {
      const x = await correr('tar', ['xf', '-', '-C', tmp], { input: r.out });
      if (x.code !== 0) throw new Error(`tar: ${x.err}`);
      for (const sub of ['mensajes', 'sessions', 'executors']) {
        const src = join(tmp, sub);
        const vistos = new Set();
        if (existsSync(src)) {
          for (const f of readdirSync(src)) {
            if (!statSync(join(src, f)).isFile()) continue;
            vistos.add(f);
            ponerSiCambia(join(raiz, sub, f), readFileSync(join(src, f)));
          }
        }
        // sessions/ y executors/ son ESTADO: lo que el dev ya no tiene, aquí tampoco
        // (un /end tiene que verse). mensajes/ es historia: no se borra nunca.
        if (sub !== 'mensajes' && existsSync(join(raiz, sub))) {
          for (const f of readdirSync(join(raiz, sub))) if (!vistos.has(f)) rmSync(join(raiz, sub, f), { force: true });
        }
      }
      const lat = join(tmp, 'coordinador.json');
      if (existsSync(lat)) ponerSiCambia(join(raiz, 'coordinador.json'), readFileSync(lat));
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }

  async function desdeAlmacen() {
    if (Date.now() - ultimoAlmacen < ALMACEN_CADA_MS) return;
    ultimoAlmacen = Date.now();
    if (!existsSync(join(almacen, '.git'))) throw new Error(`no encuentro el repo de datos en ${almacen}`);
    await correr('git', ['-C', almacen, 'fetch', '-q', 'origin'], { timeout: 60_000 });
    const ls = await correr('git', ['-C', almacen, 'ls-tree', '-r', '--name-only', 'origin/main', '--', 'coordinador']);
    if (ls.code !== 0) throw new Error(`no pude listar el almacén: ${ls.err.trim()}`);
    const porTema = new Map();
    for (const ruta of ls.out.toString().split('\n')) {
      const m = /^coordinador\/[^/]+\/mensajes\/([^/]+)\.jsonl$/.exec(ruta);
      if (!m) continue;
      const s = await correr('git', ['-C', almacen, 'show', `origin/main:${ruta}`]);
      if (s.code === 0) porTema.set(m[1], [...(porTema.get(m[1]) ?? []), s.out.toString()]);
    }
    for (const [tema, textos] of porTema) {
      const local = join(raiz, 'mensajes', `${tema}.jsonl`);
      const ya = existsSync(local) ? readFileSync(local, 'utf8') : '';
      ponerSiCambia(local, Buffer.from(fusionarFotos([ya, ...textos])));
    }
  }

  async function vuelta() {
    const d = await quienEsDev();
    try {
      if (d) {
        await desdeDev(d);
        Object.assign(estado, { dev: { nombre: d.nombre, ip: d.ip }, fuente: 'dev', desde: new Date().toISOString(), error: null });
      } else {
        rmSync(join(raiz, 'coordinador.json'), { force: true });
        await desdeAlmacen();
        Object.assign(estado, { dev: null, fuente: 'almacén', error: devError });
        if (!estado.desde || estado.fuente !== 'almacén') estado.desde = new Date().toISOString();
      }
    } catch (e) {
      // El dev existe pero no contesta: se dice, y se sigue enseñando lo último.
      Object.assign(estado, { dev: d ? { nombre: d.nombre, ip: d.ip } : null, error: e.message,
        ...(d ? {} : { fuente: 'almacén' }) });
      if (!d) rmSync(join(raiz, 'coordinador.json'), { force: true });
    }
    guardarEstado();
  }

  let timer = null, corriendo = false;
  return {
    estado: () => ({ ...estado }),
    async vuelta() { if (corriendo) return; corriendo = true; try { await vuelta(); } finally { corriendo = false; } },
    arrancar() {
      this.vuelta();
      timer = setInterval(() => this.vuelta(), SONDEO_MS);
      timer.unref();
    },
    parar() { clearInterval(timer); },
    /** Manda el mensaje al dev. Sin dev: {error, sinDev: true}. */
    async enviar(sesion, texto) {
      devVisto = 0;   // se pregunta de nuevo: enviar a un dev que ya no existe es lo que hay que evitar
      const d = await quienEsDev();
      if (!d) {
        return { sinDev: true, error: devError
          ? `No sé si hay dev (${devError}). No lo he enviado.`
          : 'No hay ningún dev vivo al que enviarle el mensaje. No lo he enviado ni guardado: cuando nazca un dev, escríbelo otra vez.' };
      }
      // La validación es la de siempre (encolarEnvio), sobre un directorio local de paso.
      const paso = join(raiz, '.saliente');
      const r = encolarEnvio(paso, sesion, texto);
      if (r.error) return r;
      const f = join(paso, 'entrada', r.encolado);
      const contenido = readFileSync(f);
      unlinkSync(f);
      const n = r.encolado;
      const s = await correr('ssh', [...sshArgs(d.ip),
        `mkdir -p "${dataDev}/entrada" && cat > "${dataDev}/entrada/${n}.escribiendo" && mv "${dataDev}/entrada/${n}.escribiendo" "${dataDev}/entrada/${n}"`],
      { input: contenido, timeout: 20_000 });
      if (s.code !== 0) return { error: `No pude dejarlo en el dev ${d.nombre}: ${s.err.split('\n').filter(Boolean).pop() || 'SSH falló'}. No se ha enviado.` };
      setTimeout(() => this.vuelta(), 500);
      return { encolado: n, dev: d.nombre };
    },
  };
}
