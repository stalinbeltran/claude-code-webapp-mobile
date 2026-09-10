// Leer el log de mensajes. Sólo lectura: este repo nunca escribe en él.
//
// El formato es el contrato y vive donde su productor:
// https://github.com/stalinbeltran/telegram-coordinator/blob/main/docs/log-de-mensajes.md
// Aquí se enlaza y NO se copia — dos mitades desfasadas es como se rompe un
// contrato entre repos. `tests/fixtures/mensajes/ejemplo.jsonl` es la copia real
// que permite probar esto sin el coordinador.
//
// Por qué se lee el fichero ENTERO y no por el final
// --------------------------------------------------
// Porque la purga lo acota a 300 mensajes por sesión, así que hablamos de
// cientos de KB. Leer por el final es más código y más formas de equivocarse
// para un problema que a esta escala no existe. ⚠ Si algún día duele —y se
// notará en `/api/sesiones`, que lee todos los ficheros— la salida es un índice
// por sesión, no leer al revés.

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

/** Cuántos mensajes devuelve una página. */
export const PAGINA = 50;

/**
 * El nombre de una conversación: `Tema <threadId>`.
 *
 * ⚠ Se DERIVA del `sessionId`, no se guarda (decisión P9). El `threadId` es un
 * hecho de Telegram, así que esto no se puede perder ni desincronizar (R16) — y
 * por eso este proyecto no tiene ningún `temas.json` que respaldar. El precio,
 * aceptado a sabiendas: con varios temas hay que recordar cuál es cuál.
 */
export function nombreDe(sesion) {
  const i = String(sesion).lastIndexOf('_');
  const hilo = i < 0 ? '' : sesion.slice(i + 1);
  if (!hilo) return String(sesion);
  // "main" es el General del grupo, el tema sin hilo. Llamarlo "Tema main" sería
  // exacto y no se entendería.
  return hilo === 'main' ? 'Tema principal' : `Tema ${hilo}`;
}

const ficheroDe = (raiz, sesion) =>
  join(raiz, 'mensajes', `${String(sesion).replace(/[^\w.-]/g, '_')}.jsonl`);

/**
 * Las líneas de una sesión, en orden. Una línea corrupta se SALTA y se cuenta;
 * no tumba la lectura — un fichero a medias (el coordinador escribiendo justo
 * ahora) tiene que poder leerse igual.
 */
function lineasDe(raiz, sesion) {
  const f = ficheroDe(raiz, sesion);
  if (!existsSync(f)) return { mensajes: [], rotas: 0 };
  const mensajes = [];
  let rotas = 0;
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try {
      const m = JSON.parse(l);
      if (m && m.id && m.autor) mensajes.push(m); else rotas++;
    } catch { rotas++; }
  }
  return { mensajes, rotas };
}

/** Los ids de sesión que tienen log, sacados de los nombres de fichero. */
export function sesiones(raiz) {
  const dir = join(raiz, 'mensajes');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.jsonl')).map((n) => n.slice(0, -6));
}

/**
 * La lista para la pantalla de inicio: una fila por conversación, la más
 * reciente arriba.
 */
export function listarSesiones(raiz) {
  return sesiones(raiz).map((sesion) => {
    const { mensajes } = lineasDe(raiz, sesion);
    const ultimo = mensajes[mensajes.length - 1];
    return {
      sesion,
      nombre: nombreDe(sesion),
      mensajes: mensajes.length,
      ultimo: ultimo ? { ts: ultimo.ts, autor: ultimo.autor, extracto: extracto(ultimo.texto) } : null,
      // El mtime es el latido del fichero: sirve para ordenar aunque el log esté
      // vacío o ilegible, y no depende de que el contenido sea correcto.
      visto: statSync(ficheroDe(raiz, sesion)).mtimeMs,
    };
  }).sort((a, b) => b.visto - a.visto);
}

/** Una línea para la lista, sin markdown que ahí no se va a renderizar. */
function extracto(texto, tope = 90) {
  const plano = String(texto ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*`>|_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plano.length > tope ? plano.slice(0, tope) + '…' : plano;
}

/**
 * Una página de mensajes, **hacia atrás**: los `limite` anteriores a `desde`.
 * Sin `desde`, los últimos — que es con lo que se abre una conversación.
 *
 * `hay_mas` va explícito y no se deduce de que vengan `limite` justos: con esa
 * heurística, una página exacta hace creer que quedan más y la siguiente llega
 * vacía.
 */
export function leerMensajes(raiz, sesion, { desde = null, limite = PAGINA } = {}) {
  const { mensajes, rotas } = lineasDe(raiz, sesion);
  const corte = desde ? mensajes.findIndex((m) => m.id >= desde) : mensajes.length;
  const fin = corte < 0 ? mensajes.length : corte;
  const ini = Math.max(0, fin - limite);
  return {
    sesion,
    nombre: nombreDe(sesion),
    mensajes: mensajes.slice(ini, fin),
    hay_mas: ini > 0,
    total: mensajes.length,
    // Si hubo líneas ilegibles se DICE. Callarlas haría que una conversación
    // incompleta se leyera como completa.
    ...(rotas ? { rotas } : {}),
  };
}

/**
 * El latido del coordinador: si sigue vivo y qué está atendiendo ahora.
 *
 * El contrato está donde su productor:
 * `telegram-coordinator/docs/log-de-mensajes.md` § «El latido».
 *
 * ⚠ La regla de caducidad **viene dentro del fichero** (`vence_ms`), y se usa la
 * suya, no una copia nuestra: si el coordinador cambia su ritmo de latido, esto
 * se entera solo. Una constante repetida aquí sería una segunda definición que
 * diverge sin que nadie se entere.
 *
 * ⚠⚠ Y si el latido venció, **los turnos se descartan con él**. No se puede
 * enseñar «esperando respuesta» apoyándose en un fichero que dejó de refrescarse
 * hace una hora: eso es exactamente lo que hace que un aviso se quede puesto para
 * siempre tras una caída.
 *
 * @returns {{vivo: boolean, hay: boolean, visto: string|null, turnos: object}}
 */
export function leerLatido(raiz, ahora = Date.now()) {
  const f = join(raiz, 'coordinador.json');
  if (!existsSync(f)) {
    // «No hay latido» NO es «está caído»: también es un coordinador que todavía
    // no tiene esta versión. Se distingue con `hay`, para poder decirlo distinto.
    return { vivo: false, hay: false, visto: null, turnos: {} };
  }
  try {
    const l = JSON.parse(readFileSync(f, 'utf8'));
    const edad = ahora - new Date(l.visto).getTime();
    const vivo = Number.isFinite(edad) && edad >= 0 && edad < (Number(l.vence_ms) || 45_000);
    return {
      vivo,
      hay: true,
      visto: l.visto ?? null,
      edad_ms: Number.isFinite(edad) ? edad : null,
      turnos: vivo ? (l.turnos ?? {}) : {},
    };
  } catch {
    // Un latido ilegible es una duda, no un «está bien».
    return { vivo: false, hay: true, visto: null, turnos: {}, roto: true };
  }
}

/** Tope de un mensaje escrito desde la app. Suficiente para pegar una instrucción
 *  larga, y lejos de poder llenar el disco a base de POSTs. */
export const TOPE_ENVIO = 32_000;

/**
 * Deja un mensaje para que el coordinador lo atienda.
 *
 * ⚠ Esta web **no ejecuta nada**: escribe un fichero y ya. Quien lo recoge y
 * corre el turno es el coordinador (`src/entrada.ts`), que es quien tiene el
 * cerrojo, el log y la sesión. Es la decisión P6, y es lo que hace que haya **un
 * solo camino** por el que se ejecuta un turno — el mismo que el de Telegram.
 *
 * ⚠ Se escribe en un temporal y se renombra: el coordinador vigila ese
 * directorio, y un fichero a medio escribir se leería como JSON roto.
 */
export function encolarEnvio(raiz, sesion, texto) {
  const t = String(texto ?? '').trim();
  if (!t) return { error: 'El mensaje está vacío.' };
  if (t.length > TOPE_ENVIO) {
    return { error: `El mensaje pasa de ${TOPE_ENVIO} caracteres (${t.length}).` };
  }
  if (!/^-?\d+_(\d+|main)$/.test(String(sesion))) {
    return { error: `"${sesion}" no parece un tema.` };
  }

  const dir = join(raiz, 'entrada');
  mkdirSync(dir, { recursive: true });
  const nombre = `${Date.now()}-${randomBytes(4).toString('hex')}.json`;
  const destino = join(dir, nombre);
  const tmp = `${destino}.escribiendo`;
  writeFileSync(tmp, JSON.stringify({ sesion, texto: t, cuando: new Date().toISOString() }));
  renameSync(tmp, destino);
  return { encolado: nombre };
}

/**
 * Qué ejecutor está ligado a un tema, y si su conversación se registra aquí.
 *
 * ⚠ Por qué la app tiene que ENSEÑARLO. Un mensaje escrito aquí entra por el
 * MISMO camino que uno de Telegram, así que lo atiende el ejecutor que esté
 * ligado al tema — no `c` siempre. Eso es lo correcto (si la app usara otro
 * ejecutor, el mismo tema se comportaría distinto según por dónde escribas), pero
 * deja al usuario teniendo que RECORDAR cuál está activo. Pasó el 2026-09-10:
 * escribió desde la app con `repetir` abierto y le contestó `repetir`.
 *
 * Recordarlo no es un mecanismo. Enseñarlo, sí.
 *
 * ⚠ Y `registra` importa tanto como el nombre: sólo `c` deja rastro en el log
 * (decisión P4), así que **lo que escribas a cualquier otro ejecutor no se verá
 * en esta app** — su respuesta va sólo a Telegram. Escribir y no ver nada se lee
 * como que la app está rota.
 *
 * @returns {{nombre:string|null, registra:boolean|null}} `registra: null` = no se
 *   pudo saber (el ejecutor lo declara otro repo y su JSON no está aquí). No se
 *   supone: se dice que no se sabe.
 */
export function ejecutorDe(raiz, sesion) {
  const f = join(raiz, 'sessions', `${String(sesion).replace(/[^\w.-]/g, '_')}.json`);
  if (!existsSync(f)) return { nombre: null, registra: null };
  let nombre = null;
  try { nombre = JSON.parse(readFileSync(f, 'utf8')).executor ?? null; } catch { /* corrupto */ }
  if (!nombre) return { nombre: null, registra: null };

  // El JSON del ejecutor sólo está aquí si lo declara el propio coordinador; los
  // federados viven en el repo que los trae y este proceso no los ve.
  const def = join(raiz, 'executors', `${nombre.replace(/[^\w.-]/g, '_')}.json`);
  if (!existsSync(def)) return { nombre, registra: null };
  try { return { nombre, registra: JSON.parse(readFileSync(def, 'utf8')).registrar === true }; }
  catch { return { nombre, registra: null }; }
}
