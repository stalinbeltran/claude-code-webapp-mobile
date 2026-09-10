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

// `window.markdownit` lo deja el UMD que carga index.html (no distribuye ESM).
// La configuración vive en su propio módulo para poder probarla sin navegador.
const md = crearRenderer(window.markdownit);

const api = async (ruta) => {
  const r = await fetch(ruta, { headers: { accept: 'application/json' } });
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
    const coordinador = ref({ vivo: false, hay: false, turnos: {} });
    const pendienteAqui = computed(() => Boolean(coordinador.value.turnos?.[abierta.value]));

    /** El aviso, o cadena vacía si no hay nada que decir. Los tres casos son
     *  distintos a propósito: «no hay latido» es un coordinador viejo, no una
     *  caída, y confundirlos manda a reiniciar algo que funciona. */
    const avisoCoordinador = computed(() => {
      const c = coordinador.value;
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
        coordinador.value = r.coordinador ?? { vivo: false, hay: false, turnos: {} };
      } catch (e) {
        // Se DICE que no se pudo, en vez de enseñar una lista vacía — que se
        // leería como «no has hablado con claude nunca».
        error.value = `No pude leer las conversaciones: ${e.message}`;
      } finally { cargando.value = false; }
    }

    async function abrir(sesion) {
      abierta.value = sesion; mensajes.value = []; hayMas.value = false;
      cargando.value = true; error.value = '';
      try {
        const r = await api(`/api/sesiones/${encodeURIComponent(sesion)}/mensajes`);
        mensajes.value = r.mensajes; hayMas.value = r.hay_mas;
        requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
      } catch (e) {
        error.value = `No pude leer esta conversación: ${e.message}`;
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
      } catch (e) { error.value = e.message; }
    }

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
        const r = await fetch(`/api/sesiones/${encodeURIComponent(abierta.value)}/mensajes`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ texto }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `${r.status}`);
        borrador.value = '';
        requestAnimationFrame(crecer);
      } catch (e) {
        error.value = `No pude enviarlo: ${e.message}. Sigue escrito aquí abajo.`;
      } finally {
        enviando.value = false;
      }
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
            ...coordinador.value, vivo: d.coordinador.vivo, hay: d.coordinador.hay,
            turnos: Object.fromEntries((d.coordinador.turnos ?? []).map((s) => [s, true])),
          };
          if (abierta.value) await refrescarAbierta();
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
      borrador, enviando, caja, enviar, crecer,
      abrir, volver, masAntiguos, cuando, AUTOR,
      render: (t) => md.render(String(t ?? '')),
      esCorte: (m) => m.autor === 'sistema' && m.origen === 'creset',
    };
  },

  template: PLANTILLA,
}).mount('#app');
