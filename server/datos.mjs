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

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
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
