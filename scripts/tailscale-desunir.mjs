// Dar de baja este nodo de la tailnet, para que su nombre quede libre YA.
//
// Lo corre el gancho `pre_destroy` del servicio `claude-web`: el lanzador lo
// ejecuta por SSH justo antes de destruir el droplet. Es el simétrico del
// `install`, que es quien une el nodo.
//
// ⚠⚠ POR QUÉ AQUÍ Y NO EN EL LANZADOR. El nodo se da de baja con **su propia
// clave**, así que no hace falta ninguna credencial capaz de borrar
// dispositivos ajenos. La alternativa —que el lanzador llame a la API de
// Tailscale— exigía repartir un token que puede borrar CUALQUIER dispositivo de
// la tailnet, incluido el móvil del dueño; y `types/mini.json` y `types/dev.json`
// llevan los dos `llavero: true`, así que «sólo en el mini» hoy no existe.
//
// ⚠ Y ESTE COMANDO NUNCA PUEDE IMPEDIR QUE SE DESTRUYA EL DROPLET. Sale con 0
// pase lo que pase: si la limpieza pudiera tumbar el apagado, una molestia
// (nombre ocupado 75 min) se convertiría en una factura (droplet vivo). Es el
// `|| true` del 2026-09-04 llevado a la estructura.
//
// Uso:  node scripts/tailscale-desunir.mjs [--si]
//         sin `--si` es SECO: dice qué haría y no lo hace.

import { execSync } from 'node:child_process';
import { ordenDeDesunir } from './nodo.mjs';

const orden = ordenDeDesunir();

// ⚠ El seco va ANTES de nada que pueda negarse: un ensayo no desune, así que no
// puede hacer daño (lección de `banco-k`, 2026-09-08).
if (!process.argv.includes('--si')) {
  console.log(`🧪 SECO — no he tocado la tailnet.\n   correría: ${orden}\n` +
    '   Para hacerlo de verdad, repite con `--si`.');
  process.exit(0);
}

// ¿Está siquiera dentro? Desunir algo que no está unido no es un error, es un
// no-op — y decirlo es mejor que un mensaje de fallo que nadie sabe interpretar.
let dentro = false;
try {
  const s = JSON.parse(execSync('tailscale status --json 2>/dev/null', { encoding: 'utf8', timeout: 20_000 }));
  dentro = s.BackendState === 'Running';
} catch { /* sin tailscale, o no contesta: se intenta igual y se reporta */ }

if (!dentro) {
  console.log('· tailscale no está dentro de ninguna tailnet: nada que desunir.');
  process.exit(0);
}

try {
  execSync(orden, { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
  console.log('✅ Nodo dado de baja: su nombre queda libre al instante ' +
    '(medido 2026-09-10: 2 s, contra ~75 min esperando a la limpieza por inactividad).');
} catch (e) {
  // Se DICE y se sigue. Quien llama va a destruir el droplet a continuación, y
  // el nodo se limpiará solo en ~75 min: peor es no destruirlo.
  const m = ((e.stdout || '') + (e.stderr || '')).trim().slice(-300);
  console.error(`⚠ No pude dar de baja el nodo: ${m || e.message}`);
  console.error('  No pasa nada grave: se limpiará solo en ~75 min. Lo que se pierde es ' +
    'poder relanzar ANTES de esa ventana sin que el nombre salga sufijado.');
}
process.exit(0);   // ⚠ 0 SIEMPRE: ver la cabecera
