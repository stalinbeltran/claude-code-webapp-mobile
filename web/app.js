// La app de lectura. Vue 3 desde su build ESM, sin bundler y sin paso de build:
// desplegar es `git pull` + reiniciar, que es lo que permite tocar este repo
// desde el celular.
//
// ⚠⚠ LA REGLA QUE NO SE NEGOCIA: `html: false` en markdown-it.
// Esta app enseña la salida de un modelo que corre en una máquina con
// `bypassPermissions`. Dejar pasar HTML crudo de ahí es abrir XSS en tu propia
// consola de shell remoto. Tiene test.

import { createApp, ref, computed, onMounted } from './vendor/vue.esm-browser.prod.js';
import { crearRenderer } from './markdown.js';
import { PLANTILLA } from './plantilla.js';
import { SinRed, explicarFallo } from './diagnostico.js';
import { ESCAPE, decidirArranque, leerGuardada, guardarDireccion,
         olvidarDireccion, normalizarDireccion } from './direccion.js';

// ⚠⚠ EL SALTO VA ANTES DE MONTAR NADA, y a propósito: si esta app se abrió desde
// un origen que ya no sirve (la PWA instalada guarda un `start_url` fijo), lo
// último que ayuda es pintar la lista vacía y el 🔴 durante un segundo antes de
// irse. Ver `direccion.js` para por qué se salta en vez de pedirle los datos a
// otro host.
{
  const guardada = leerGuardada(window.localStorage);
  const escape = new URLSearchParams(location.search).has(ESCAPE);
  const { ir } = decidirArranque({ guardada, origenActual: location.origin, escape });
  if (ir) location.replace(ir);   // `replace`: no deja el origen muerto en el historial
}

// `window.markdownit` lo deja el UMD que carga index.html (no distribuye ESM).
// La configuración vive en su propio módulo para poder probarla sin navegador.
const md = crearRenderer(window.markdownit);

// ⚠ Los dos fallos se separan aquí y no en el `catch` de cada llamada: «no
// llegué al servidor» y «contestó 500» piden mensajes distintos, y desde el
// móvil el primero es el que hay que explicar entero (ver `diagnostico.js`).
const api = async (ruta) => {
  let r;
  try {
    r = await fetch(ruta, { headers: { accept: 'application/json' } });
  } catch (e) {
    throw new SinRed(e, ruta);
  }
  if (!r.ok) throw new Error(`${r.status} en ${ruta}`);
  return r.json();
};

/** Una hora legible desde el móvil: hoy la hora, antes el día. */
function cuando(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  return mismoDia
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

const AUTOR = { usuario: 'tú', claude: 'claude', sistema: 'sistema' };

createApp({
  setup() {
    const sesiones = ref([]);
    const abierta = ref(null);      // id de la conversación abierta, o null
    const mensajes = ref([]);
    const hayMas = ref(false);
    const cargando = ref(true);
    const error = ref('');
    const nombre = computed(() =>
      sesiones.value.find((s) => s.sesion === abierta.value)?.nombre ?? '');
    // ⚠ `consultado` NO es un detalle: sin él, el valor inicial (`hay: false`)
    //   se lee como «este coordinador no escribe latido», que es una afirmación
    //   SOBRE EL SERVIDOR hecha justo cuando no se ha podido hablar con él.
    //   Medido el 2026-09-10: salía con el servidor perfecto y el móvil fuera
    //   de la tailnet. Ver `diagnostico.js`.
    const coordinador = ref({ vivo: false, hay: false, turnos: {}, consultado: false });
    const pendienteAqui = computed(() => Boolean(coordinador.value.turnos?.[abierta.value]));

    /** El aviso, o cadena vacía si no hay nada que decir. Los tres casos son
     *  distintos a propósito: «no hay latido» es un coordinador viejo, no una
     *  caída, y confundirlos manda a reiniciar algo que funciona. */
    const avisoCoordinador = computed(() => {
      const c = coordinador.value;
      if (!c.consultado) return '';   // no se le ha podido preguntar: el 🔴 de red ya lo dice
      if (c.vivo) return '';
      if (!c.hay) return '⚠ No sé si el bot está vivo: este coordinador todavía no escribe latido. ' +
        'Lo que ves puede estar al día o no.';
      if (c.roto) return '⚠ El latido del bot no se puede leer. No sé si está vivo.';
      return '🔴 El bot parece PARADO (no da señales). Lo que ves es lo último que llegó, ' +
        'no lo de ahora — y un mensaje que le mandes por Telegram no se atenderá.';
    });

    async function cargarLista() {
      cargando.value = true; error.value = '';
      try {
        const r = await api('/api/sesiones');
        sesiones.value = r.sesiones;
        coordinador.value = { ...(r.coordinador ?? { vivo: false, hay: false, turnos: {} }), consultado: true };
      } catch (e) {
        // Se DICE que no se pudo, en vez de enseñar una lista vacía — que se
        // leería como «no has hablado con claude nunca».
        error.value = explicarFallo(e, 'leer las conversaciones', location.origin);
      } finally { cargando.value = false; }
    }

    async function abrir(sesion) {
      abierta.value = sesion; mensajes.value = []; hayMas.value = false;
      cargando.value = true; error.value = '';
      try {
        const r = await api(`/api/sesiones/${encodeURIComponent(sesion)}/mensajes`);
        mensajes.value = r.mensajes; hayMas.value = r.hay_mas;
        ejecutor.value = r.ejecutor ?? { nombre: null, registra: null };
        requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
      } catch (e) {
        error.value = explicarFallo(e, 'leer esta conversación', location.origin);
      } finally { cargando.value = false; }
    }

    async function masAntiguos() {
      const primero = mensajes.value[0];
      if (!primero) return;
      try {
        const r = await api(`/api/sesiones/${encodeURIComponent(abierta.value)}` +
          `/mensajes?desde=${encodeURIComponent(primero.id)}`);
        mensajes.value = [...r.mensajes, ...mensajes.value];
        hayMas.value = r.hay_mas;
      } catch (e) { error.value = explicarFallo(e, 'traer lo más antiguo', location.origin); }
    }

    const ejecutor = ref({ nombre: null, registra: null });

    /**
     * El aviso de la caja. Los dos casos que hay que decir ANTES de escribir, no
     * después: sin sesión el mensaje se rechaza, y con un ejecutor que no
     * registra su conversación, lo que escribas **no se verá aquí** — su
     * respuesta va sólo a Telegram, y escribir sin ver nada se lee como que la
     * app está rota.
     */
    const avisoEjecutor = computed(() => {
      const e = ejecutor.value;
      if (!e.nombre) return '⚠ Este tema no tiene ninguna sesión abierta. ' +
        'Ábrela desde Telegram con /use c y vuelve.';
      if (e.registra === false) return `⚠ Aquí atiende «${e.nombre}», y sus respuestas ` +
        'NO se ven en esta app: sólo se registra la conversación de `c`. Míralas en Telegram.';
      if (e.registra === null) return `⚠ Aquí atiende «${e.nombre}». No sé si sus respuestas ` +
        'se registran aquí (lo declara otro repo); si no aparecen, míralas en Telegram.';
      return '';
    });

    const borrador = ref('');
    const enviando = ref(false);
    const caja = ref(null);

    /** La caja crece con el texto, hasta un tope. Una caja de una línea para una
     *  instrucción de diez es exactamente lo que hace que no la uses. */
    function crecer() {
      const el = caja.value;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    }

    /**
     * Manda lo escrito. ⚠ Lo que devuelve el servidor es un 202: el turno NO ha
     * corrido todavía. Aparecerá por el SSE como cualquier otro mensaje —incluido
     * el tuyo—, así que aquí no se pinta nada a mano: una copia optimista se
     * quedaría descolgada si el coordinador lo rechaza.
     */
    async function enviar() {
      const texto = borrador.value.trim();
      if (!texto || enviando.value) return;
      enviando.value = true;
      error.value = '';
      try {
        let r;
        try {
          r = await fetch(`/api/sesiones/${encodeURIComponent(abierta.value)}/mensajes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ texto }),
          });
        } catch (fallo) { throw new SinRed(fallo, 'enviar'); }
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `${r.status}`);
        borrador.value = '';
        requestAnimationFrame(crecer);
      } catch (e) {
        error.value = e?.sinRed
          ? explicarFallo(e, 'enviarlo', location.origin) + '\n\nSigue escrito aquí abajo.'
          : `No pude enviarlo: ${e.message}. Sigue escrito aquí abajo.`;
      } finally {
        enviando.value = false;
      }
    }


    // ------------------------------------------------ cambiar de servidor
    // Ver `direccion.js`. Aquí sólo va lo que necesita navegador: el almacén, la
    // comprobación previa y el salto.
    const verDireccion = ref(false);           // desplegable: NO sale si no se pide
    const direccionEscrita = ref('');
    const direccionGuardada = ref(leerGuardada(window.localStorage));
    const probando = ref(false);
    const errorDireccion = ref('');
    const puedeForzar = ref(false);

    /**
     * ¿Contesta algo en esa dirección? Con `mode: 'no-cors'`, que es la pieza
     * que hace que esto no necesite CORS: la respuesta llega OPACA —no se puede
     * leer ni el status— pero **la petición sólo LANZA si no se llegó**, que es
     * justo lo único que hay que distinguir aquí.
     */
    async function contesta(origen) {
      try {
        await fetch(`${origen}/api/salud`, { mode: 'no-cors', cache: 'no-store' });
        return true;
      } catch { return false; }
    }

    /**
     * Guarda la dirección y salta.
     *
     * ⚠ La comprobación AVISA PERO NO BLOQUEA (`forzar`), que es la misma regla
     * que `/use` con `requiere` en el coordinador: mira desde ESTE móvil y en
     * ESTE momento, así que un falso negativo —Tailscale levantándose, un DNS
     * lento— que impidiera guardar la dirección buena sería peor que el aviso.
     * Lo que sí evita es el fallo caro: guardar una dirección mal tecleada y
     * dejar el icono del móvil saltando para siempre a un sitio que no existe.
     */
    async function usarDireccion(forzar = false) {
      errorDireccion.value = ''; puedeForzar.value = false;
      const r = normalizarDireccion(direccionEscrita.value);
      if (!r.ok) { errorDireccion.value = r.motivo; return; }

      if (r.origen === location.origin) {
        errorDireccion.value = 'Esa es la dirección desde la que ya estás abriendo la app.';
        return;
      }

      if (!forzar) {
        probando.value = true;
        const vale = await contesta(r.origen);
        probando.value = false;
        if (!vale) {
          errorDireccion.value = `No he conseguido alcanzar ${r.origen}. ` +
            'Comprueba que Tailscale está encendido y que la dirección es la que te dio ' +
            '"/use cweb" → "url".';
          puedeForzar.value = true;
          return;
        }
      }

      if (!guardarDireccion(window.localStorage, r.origen)) {
        errorDireccion.value = 'No he podido guardarla en este móvil (¿modo incógnito?). ' +
          'Puedo llevarte igual, pero habrá que repetirlo la próxima vez.';
        puedeForzar.value = true;
        // No se salta a ciegas: que no se pueda guardar cambia lo que va a pasar
        // después, así que se dice ANTES en vez de descubrirlo al volver.
        return;
      }
      location.replace(r.origen);
    }

    /** Olvidar la dirección guardada y quedarse en el origen de verdad. */
    function olvidarServidor() {
      olvidarDireccion(window.localStorage);
      direccionGuardada.value = null;
      errorDireccion.value = '';
      location.replace(location.origin);
    }

    const volver = () => {
      abierta.value = null; mensajes.value = []; borrador.value = ''; cargarLista();
    };

    /** Traer sólo lo que falta de la conversación abierta, sin recargarla entera:
     *  reemplazarla haría saltar el scroll cada vez que llega un mensaje. */
    async function refrescarAbierta() {
      const r = await api(`/api/sesiones/${encodeURIComponent(abierta.value)}/mensajes`);
      const tengo = new Set(mensajes.value.map((m) => m.id));
      const nuevos = r.mensajes.filter((m) => !tengo.has(m.id));
      if (!nuevos.length) return;
      // Sólo se baja del todo si ya estabas abajo. Si estabas leyendo algo de
      // más arriba, un mensaje nuevo no puede robarte el sitio.
      const abajo = window.scrollY + window.innerHeight > document.body.scrollHeight - 120;
      mensajes.value = [...mensajes.value, ...nuevos];
      if (abajo) requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
    }

    /**
     * El aviso en vivo. SSE **reconecta solo**, que en un móvil que entra y sale
     * de cobertura es la mitad del valor — por eso no hay ningún reintento
     * escrito aquí: lo hace el navegador con el `retry` que manda el servidor.
     *
     * ⚠ Lo que llega es «algo cambió», no los mensajes: entonces se piden por la
     * API de siempre. Así hay una sola forma de leer un mensaje en vez de dos que
     * pueden divergir.
     */
    function escuchar() {
      const es = new EventSource('/api/eventos');
      es.addEventListener('cambio', async (ev) => {
        try {
          const d = JSON.parse(ev.data);
          coordinador.value = {
            ...coordinador.value, consultado: true,
            vivo: d.coordinador.vivo, hay: d.coordinador.hay,
            turnos: Object.fromEntries((d.coordinador.turnos ?? []).map((s) => [s, true])),
          };
          if (abierta.value) {
            await refrescarAbierta();
            // El ejecutor puede cambiar mientras miras: un `/use c` desde
            // Telegram tiene que verse aquí sin recargar.
            const r = await api(`/api/sesiones/${encodeURIComponent(abierta.value)}/mensajes?limite=1`);
            ejecutor.value = r.ejecutor ?? ejecutor.value;
          }
          else await cargarLista();
        } catch { /* un evento mal formado no puede romper la pantalla */ }
      });
    }

    onMounted(() => {
      cargarLista();
      escuchar();
      // El service worker sólo sirve para que la app ABRA sin red; los datos
      // siempre vienen del servidor. Si el navegador no lo soporta —o no estamos
      // en un contexto seguro— no pasa nada: la app funciona igual.
      navigator.serviceWorker?.register('/sw.js').catch(() => {});
    });

    return {
      sesiones, abierta, mensajes, hayMas, cargando, error, nombre,
      coordinador, avisoCoordinador, pendienteAqui,
      borrador, enviando, caja, enviar, crecer, ejecutor, avisoEjecutor,
      verDireccion, direccionEscrita, direccionGuardada, probando,
      errorDireccion, puedeForzar, usarDireccion, olvidarServidor,
      origenActual: location.origin,
      abrir, volver, masAntiguos, cuando, AUTOR,
      render: (t) => md.render(String(t ?? '')),
      esCorte: (m) => m.autor === 'sistema' && m.origen === 'creset',
    };
  },

  template: PLANTILLA,
}).mount('#app');
