// La app de lectura. Vue 3 desde su build ESM, sin bundler y sin paso de build:
// desplegar es `git pull` + reiniciar, que es lo que permite tocar este repo
// desde el celular.
//
// ⚠⚠ LA REGLA QUE NO SE NEGOCIA: `html: false` en markdown-it.
// Esta app enseña la salida de un modelo que corre en una máquina con
// `bypassPermissions`. Dejar pasar HTML crudo de ahí es abrir XSS en tu propia
// consola de shell remoto. Tiene test.

import { createApp, ref, computed, onMounted, nextTick } from './vendor/vue.esm-browser.prod.js';
import { crearRenderer } from './markdown.js';
import { PLANTILLA } from './plantilla.js';
import { SinRed, explicarFallo } from './diagnostico.js';
import { ESCAPE, decidirArranque, leerGuardada, guardarDireccion,
         olvidarDireccion, normalizarDireccion, sePuedeProbar } from './direccion.js';
import { leerAbierta, guardarAbierta, leerLeido, marcarLeido, primerNoLeido, faltaAtras,
         tieneNoLeido, hashDe, aReabrir } from './lectura.js';
import { leerBorrador, guardarBorrador, leerPendientes, apuntarPendiente,
         descartarPendiente, confirmarRecibidos } from './borradores.js';

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
  // ⚠ Detrás de Cloudflare Access, una sesión caducada NO es un error: es un 200
  // con la página de login en HTML, después de una redirección. Parsearlo como
  // JSON daría «Unexpected token <», que se lee como servidor roto. Se dice lo
  // que es y lo que hay que hacer (recargar: el login vuelve a poner la sesión).
  const tipo = r.headers.get('content-type') || '';
  if (r.redirected || !/json/i.test(tipo)) {
    throw new Error('El acceso pide volver a entrar: la sesión caducó. Recarga la app ' +
      '(ciérrala y ábrela) y haz el login otra vez.');
  }
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
      // Modo remoto (la web en el mini): lo primero es si HAY dev.
      if (c.remoto && !c.remoto.dev) {
        return c.remoto.error && /DO_TOKEN|API/.test(c.remoto.error)
          ? `⚠ No sé si hay dev (${c.remoto.error}). Lo que ves es la última copia guardada.`
          : '📴 No hay dev ahora mismo. Ves la última copia guardada en el almacén. ' +
            'Lo que escribas no se puede enviar: no hay claude que lo atienda.';
      }
      if (c.remoto?.dev && c.remoto.error) {
        return `⚠ El dev ${c.remoto.dev.nombre} existe pero no contesta (${c.remoto.error}). Ves lo último que llegó.`;
      }
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

    // ------------------------------------------------ dónde te quedaste
    // Ver `lectura.js`. `corteLeido` es el primer mensaje sin leer AL ABRIR, y se
    // queda fijo mientras la conversación siga abierta: si se moviera al leer, la
    // marca de «sin leer» huiría por delante del dedo.
    const corteLeido = ref(null);

    /** Recordar qué está abierto, en el almacén y en la URL de esta pestaña. */
    function recordarAbierta(sesion) {
      guardarAbierta(window.localStorage, sesion);
      try { history.replaceState(null, '', location.pathname + location.search + hashDe(sesion)); }
      catch { /* sin history no se pierde nada más que el atajo */ }
    }

    /**
     * Marca leído lo que ya se VIO entero: el último mensaje cuyo FINAL está por
     * encima del borde de abajo (la caja de escribir, si está). Por el final y no
     * por el principio: una respuesta larga de la que sólo se vio el título no
     * está leída, y la próxima vez hay que volver a ella.
     *
     * ⚠ Sólo con la pestaña VISIBLE: un mensaje que llega con el móvil en el
     * bolsillo no se ha leído aunque esté dentro de la ventana.
     */
    function marcarVistos() {
      if (!abierta.value || document.visibilityState !== 'visible') return;
      const pie = document.querySelector('footer');
      const borde = pie ? pie.getBoundingClientRect().top : window.innerHeight;
      const els = document.querySelectorAll('main [data-id]');
      for (let i = els.length - 1; i >= 0; i--) {
        if (els[i].getBoundingClientRect().bottom <= borde + 2) {
          marcarLeido(window.localStorage, abierta.value, els[i].dataset.id);
          return;
        }
      }
    }
    let marcaPendiente = false;
    function alDesplazar() {
      if (marcaPendiente) return;
      marcaPendiente = true;
      requestAnimationFrame(() => { marcaPendiente = false; marcarVistos(); });
    }

    /** Lleva el scroll al primer sin leer o, si no hay, al final. */
    async function situar() {
      await nextTick();
      // ⚠ `scrollTo` calculado y NO `scrollIntoView`: en móvil, cuando el destino
      // no puede llegar arriba (la conversación se acaba antes), `scrollIntoView`
      // desplaza además el visual viewport y se lleva la cabecera fuera de la
      // pantalla. Visto en Chrome con emulación móvil el 2026-10-08.
      const marca = corteLeido.value && document.querySelector('main .sin-leer');
      if (marca) {
        const cabecera = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
        window.scrollTo(0, window.scrollY + marca.getBoundingClientRect().top - cabecera - 8);
      } else window.scrollTo(0, document.body.scrollHeight);
      marcarVistos();
    }

    async function abrir(sesion) {
      abierta.value = sesion; mensajes.value = []; hayMas.value = false;
      corteLeido.value = null;
      cargando.value = true; error.value = '';
      recordarAbierta(sesion);
      // Lo escrito y lo enviado sin confirmar vuelven ANTES de pedir nada: si el
      // servidor no contesta, es justo cuando más falta verlo (ver `borradores.js`).
      borrador.value = leerBorrador(window.localStorage, sesion);
      pendientes.value = leerPendientes(window.localStorage, sesion);
      requestAnimationFrame(crecer);
      try {
        const r = await api(`/api/sesiones/${encodeURIComponent(sesion)}/mensajes`);
        mensajes.value = r.mensajes; hayMas.value = r.hay_mas;
        confirmar();
        ejecutor.value = r.ejecutor ?? { nombre: null, registra: null };
        // Si lo primero sin leer queda antes de la página, se piden más hasta
        // llegar. Con tope: la purga deja 300 por tema, así que 10 páginas de 50
        // sobran, y un id raro no puede dejar esto pidiendo para siempre.
        const leido = leerLeido(window.localStorage, sesion);
        for (let i = 0; i < 10 && faltaAtras(mensajes.value, leido, hayMas.value); i++) {
          const m = await api(`/api/sesiones/${encodeURIComponent(sesion)}` +
            `/mensajes?desde=${encodeURIComponent(mensajes.value[0].id)}`);
          mensajes.value = [...m.mensajes, ...mensajes.value]; hayMas.value = m.hay_mas;
        }
        corteLeido.value = primerNoLeido(mensajes.value, leido);
      } catch (e) {
        error.value = explicarFallo(e, 'leer esta conversación', location.origin);
      } finally { cargando.value = false; }
      if (!error.value) await situar();
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
    /** Modo remoto sin dev: se puede escribir, y el servidor contesta que no hay a quién mandarlo. */
    const sinDev = computed(() => Boolean(coordinador.value.remoto && !coordinador.value.remoto.dev));

    /**
     * El aviso de la caja. Los dos casos que hay que decir ANTES de escribir, no
     * después: sin sesión el mensaje se rechaza, y con un ejecutor que no
     * registra su conversación, lo que escribas **no se verá aquí** — su
     * respuesta va sólo a Telegram, y escribir sin ver nada se lee como que la
     * app está rota.
     */
    const avisoEjecutor = computed(() => {
      const e = ejecutor.value;
      if (sinDev.value) return '';   // el aviso de arriba ya lo dice, y mejor
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
    // Enviados que todavía no han vuelto en el log. Ver `borradores.js`.
    const pendientes = ref([]);
    const copiado = ref('');

    /** Cada tecla va a disco: la pestaña puede morir sin avisar. */
    function alEscribir() {
      crecer();
      if (abierta.value) guardarBorrador(window.localStorage, abierta.value, borrador.value);
    }

    /** Quita de los pendientes los que ya aparecen en la conversación. */
    function confirmar() {
      if (!abierta.value) return;
      pendientes.value = confirmarRecibidos(window.localStorage, abierta.value, mensajes.value);
    }

    function descartar(p) {
      pendientes.value = descartarPendiente(window.localStorage, abierta.value, p.ts);
    }

    /** Copiar al portapapeles; si el navegador no deja (http sin TLS), el texto
     *  sigue seleccionable en la tarjeta, que es la garantía de verdad. */
    async function copiar(p) {
      try { await navigator.clipboard.writeText(p.texto); copiado.value = p.ts; }
      catch { copiado.value = 'no:' + p.ts; }
      setTimeout(() => { if (copiado.value.endsWith(p.ts)) copiado.value = ''; }, 2000);
    }

    /** Volver a mandar uno pendiente: se pone en la caja, no se envía a ciegas. */
    function aCaja(p) {
      borrador.value = p.texto;
      alEscribir();
      caja.value?.focus();
    }

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
      const sesion = abierta.value;
      // Se apunta ANTES del POST: si la pestaña muere a mitad, ya está en disco.
      const apuntado = apuntarPendiente(window.localStorage, sesion, texto);
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
        guardarBorrador(window.localStorage, sesion, '');
        if (abierta.value === sesion) {
          borrador.value = '';
          pendientes.value = leerPendientes(window.localStorage, sesion);
          confirmar();   // por si el SSE ya lo trajo antes que esta respuesta
        }
        requestAnimationFrame(crecer);
      } catch (e) {
        // Falló: sigue en la caja (y en su borrador), así que la tarjeta sobra.
        const resto = descartarPendiente(window.localStorage, sesion, apuntado.ts);
        if (abierta.value === sesion) pendientes.value = resto;
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
     * ESTE momento, así que un falso negativo —el móvil recuperando cobertura, la
     * web reiniciándose— que impidiera guardar la dirección buena sería peor que
     * el aviso.
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
        // ⚠ Antes de probar, hay que poder probar. Bajar de https a http bloquea
        // el `fetch` por contenido mixto, y entonces «no contesta» sería una
        // afirmación que nadie ha comprobado. Ver `sePuedeProbar` en
        // `direccion.js`, que es donde está el porqué y lo que tiene el test.
        const p = sePuedeProbar(location.origin, r.origen);
        if (!p.puede) {
          errorDireccion.value = p.motivo;
          puedeForzar.value = true;
          return;
        }
        probando.value = true;
        const vale = await contesta(r.origen);
        probando.value = false;
        if (!vale) {
          errorDireccion.value = `No he conseguido alcanzar ${r.origen}. ` +
            'La causa más común es que la máquina se rehízo: cambia la IP Y el token, ' +
            'así que la dirección guardada deja de valer entera. Pide la de ahora con ' +
            '"/use cweb" → "url" y pégala tal cual, con su "?t=".';
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
      marcarVistos();
      // El borrador NO se borra del disco: se queda para cuando vuelvas.
      abierta.value = null; mensajes.value = []; borrador.value = ''; corteLeido.value = null;
      pendientes.value = [];
      recordarAbierta(null);
      cargarLista();
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
      // ⚠ Y con la pestaña oculta tampoco: bajar solo dejaría lo nuevo «visto» por
      // el scroll y, al volver, estarías debajo de lo que no has leído.
      const abajo = window.scrollY + window.innerHeight > document.body.scrollHeight - 120;
      mensajes.value = [...mensajes.value, ...nuevos];
      confirmar();
      if (abajo && document.visibilityState === 'visible') {
        requestAnimationFrame(() => { window.scrollTo(0, document.body.scrollHeight); marcarVistos(); });
      }
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
            ...(d.coordinador.remoto ? { remoto: d.coordinador.remoto } : {}),
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

    onMounted(async () => {
      window.addEventListener('scroll', alDesplazar, { passive: true });
      document.addEventListener('visibilitychange', alDesplazar);
      escuchar();
      await cargarLista();
      // Reabrir donde estabas: el navegador del móvil descarta la pestaña y al
      // volver la recarga desde cero (ver `lectura.js`).
      const s = aReabrir({
        hash: location.hash,
        guardada: leerAbierta(window.localStorage),
        existentes: sesiones.value.map((x) => x.sesion),
      });
      if (s) abrir(s);
      else if (location.hash) recordarAbierta(null);
      // El service worker sólo sirve para que la app ABRA sin red; los datos
      // siempre vienen del servidor. Si el navegador no lo soporta —o no estamos
      // en un contexto seguro— no pasa nada: la app funciona igual.
      navigator.serviceWorker?.register('/sw.js').catch(() => {});
    });

    return {
      sesiones, abierta, mensajes, hayMas, cargando, error, nombre,
      coordinador, avisoCoordinador, pendienteAqui,
      borrador, enviando, caja, enviar, crecer, alEscribir,
      pendientes, copiado, copiar, descartar, aCaja, ejecutor, avisoEjecutor, sinDev,
      verDireccion, direccionEscrita, direccionGuardada, probando,
      errorDireccion, puedeForzar, usarDireccion, olvidarServidor,
      origenActual: location.origin,
      abrir, volver, masAntiguos, cuando, AUTOR, corteLeido,
      noLeido: (s) => tieneNoLeido(s, leerLeido(window.localStorage, s.sesion)),
      render: (t) => md.render(String(t ?? '')),
      esCorte: (m) => m.autor === 'sistema' && m.origen === 'creset',
    };
  },

  template: PLANTILLA,
}).mount('#app');
