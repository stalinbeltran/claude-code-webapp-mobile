// Dejar libre el nombre del nodo borrando el que lo ocupa y ya está muerto.
//
// Por qué existe
// -------------
// La authkey es efímera y los nodos muertos se borran solos, pero tardan
// **~75 min** (medido el 2026-09-10). Rehacer el dev antes de esa ventana
// encuentra el nombre ocupado, el nodo entra como `dev-1`, y la URL de la PWA
// instalada en el móvil muere. Esto cierra la ventana entera.
//
// ⚠⚠ BORRA COSAS DE VERDAD, Y EN ESTA TAILNET ESTÁ EL MÓVIL DEL DUEÑO.
// Por eso:
//   · el modo por defecto es **SECO**: enseña qué borraría y no borra;
//   · para borrar hay que pedirlo con `--si`, explícito;
//   · qué es seguro borrar lo decide `nodosAReclamar()` en `nodo.mjs`, que tiene
//     sus cuatro reglas y sus tests. Aquí sólo se habla por HTTP.
//
// ⚠ El SECO va ANTES de cualquier comprobación que pueda negarse: un ensayo no
// borra nada, así que nunca puede hacer daño, y bloquearlo impediría mirar qué
// pasaría justo cuando más falta hace. Es la lección de `banco-k` (2026-09-08).
//
// Uso:  node scripts/tailscale-reclamar.mjs [--nombre dev] [--si] [--ya]
//         --si    borra de verdad (sin esto, seco)
//         --ya    da por muerto lo que ocupa el nombre SIN esperar a que calle.
//                 Sólo con prueba de que la máquina ya no existe: es lo que pasa
//                 justo después de que DigitalOcean confirme el destroy.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodosAReclamar } from './nodo.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.tailscale.com/api/v2';

const arg = (n, def) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : def; };

/** Las credenciales, del entorno o del `.env` del repo. NUNCA se imprimen. */
export function credenciales(env = process.env, raiz = RAIZ) {
  const del = (k) => {
    if (env[k]) return env[k].trim();
    const f = join(raiz, '.env');
    if (!existsSync(f)) return '';
    const m = readFileSync(f, 'utf8').match(new RegExp(`^\\s*${k}\\s*=\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  };
  return { id: del('TS_OAUTH_CLIENT_ID'), secreto: del('TS_OAUTH_CLIENT_SECRET') };
}

/**
 * Reclama el nombre. El `fetch` se inyecta para poder probar esto entero sin
 * credenciales y sin tocar la tailnet: la orquestación es lo que hay que
 * comprobar, y es lo que decide si se borra algo que no tocaba.
 */
export async function reclamar({ nombre, credenciales: cred, seco = true, ya = false,
                                 fetch: fetchFn = fetch, ahora = new Date() }) {
  if (!cred?.id || !cred?.secreto) {
    return { ok: false, motivo: 'sin credenciales', borrados: [], avisos: [
      'No hay TS_OAUTH_CLIENT_ID/TS_OAUTH_CLIENT_SECRET: no puedo reclamar el nombre.',
      'Se crea en https://login.tailscale.com/admin/settings/oauth con scope `devices:core`.'] };
  }

  // 1. Un token corto a partir del OAuth client (que no caduca, al revés que
  //    una API key, que muere a los 90 días).
  const rt = await fetchFn(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cred.id, client_secret: cred.secreto,
                                grant_type: 'client_credentials' }).toString(),
  });
  if (!rt.ok) return { ok: false, motivo: `el OAuth client no me da token (HTTP ${rt.status})`,
                       borrados: [], avisos: [] };
  const token = (await rt.json())?.access_token;
  if (!token) return { ok: false, motivo: 'el OAuth client contestó sin access_token', borrados: [], avisos: [] };
  const auth = { headers: { authorization: `Bearer ${token}` } };

  // 2. Qué hay. Si no se puede leer, NO se borra nada: no saber es un resultado.
  const rd = await fetchFn(`${API}/tailnet/-/devices`, auth);
  if (!rd.ok) return { ok: false, motivo: `no pude listar los nodos (HTTP ${rd.status})`,
                       borrados: [], avisos: [] };
  const devices = (await rd.json())?.devices;

  // 3. Qué se puede borrar. La cautela vive ahí, no aquí.
  const { borrar, avisos } = nodosAReclamar(devices, nombre,
    { ahora, inactivoDesdeMs: ya ? 0 : undefined });

  if (seco) return { ok: true, seco: true, borrados: [], propuestos: borrar, avisos };

  const borrados = [];
  for (const d of borrar) {
    const r = await fetchFn(`${API}/device/${encodeURIComponent(d.id)}`, { method: 'DELETE', ...auth });
    if (r.ok) borrados.push(d);
    else avisos.push(`no pude borrar \`${d.name}\` (HTTP ${r.status})`);
  }
  return { ok: true, seco: false, borrados, propuestos: borrar, avisos };
}

// --------------------------------------------------------------- como comando
if (import.meta.url === `file://${process.argv[1]}`) {
  const nombre = arg('--nombre', process.env.CWEB_HOSTNAME ?? 'dev');
  const seco = !process.argv.includes('--si');
  const r = await reclamar({ nombre, credenciales: credenciales(), seco,
                             ya: process.argv.includes('--ya') });

  if (!r.ok) { console.error(`❌ ${r.motivo}`); r.avisos.forEach((a) => console.error(`   ${a}`)); process.exit(0); }
  for (const a of r.avisos) console.log(a);
  const lista = (ds) => ds.map((d) => `  · ${d.name}  (visto ${d.lastSeen ?? '¿?'})`).join('\n');

  if (r.seco) {
    console.log(r.propuestos.length
      ? `🧪 SECO — borraría ${r.propuestos.length} nodo(s) para dejar libre "${nombre}":\n${lista(r.propuestos)}\n\n` +
        'Para hacerlo de verdad, repite con `--si`.'
      : `🧪 SECO — nada que borrar: el nombre "${nombre}" ya está libre.`);
  } else {
    console.log(r.borrados.length
      ? `🧹 Borrado(s) ${r.borrados.length} nodo(s); "${nombre}" queda libre:\n${lista(r.borrados)}`
      : `Nada que borrar: "${nombre}" ya estaba libre.`);
  }
  process.exit(0);   // ⚠ 0 siempre: esto corre dentro de un aprovisionamiento
}
