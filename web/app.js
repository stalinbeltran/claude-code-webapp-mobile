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

    async function cargarLista() {
      cargando.value = true; error.value = '';
      try {
        sesiones.value = (await api('/api/sesiones')).sesiones;
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

    const volver = () => { abierta.value = null; mensajes.value = []; cargarLista(); };

    onMounted(cargarLista);

    return {
      sesiones, abierta, mensajes, hayMas, cargando, error, nombre,
      abrir, volver, masAntiguos, cuando, AUTOR,
      render: (t) => md.render(String(t ?? '')),
      esCorte: (m) => m.autor === 'sistema' && m.origen === 'creset',
    };
  },

  template: PLANTILLA,
}).mount('#app');
