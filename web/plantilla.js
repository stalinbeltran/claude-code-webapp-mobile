// La plantilla de la app, aparte.
//
// Está separada por lo mismo que `markdown.js`: `app.js` importa Vue y usa
// `window.markdownit`, así que no se puede cargar en Node — y una plantilla con
// un error de sintaxis **no falla al escribirla, falla al montar**, o sea en el
// móvil y sin decir dónde. Aquí se puede compilar en un test (R17).
//
// La interfaz, por orden de lo que pide la especificación:
//   · una columna, móvil primero;
//   · burbujas tuyas a la derecha, las de claude a ANCHO COMPLETO — su contenido
//     es estructurado, y una tabla en una burbuja estrecha no se lee;
//   · la DIVISORIA de un `creset`, para no enseñar un hilo que claude ya no tiene;
//   · y el `origen` visible cuando no es Telegram, para poder distinguir una
//     vuelta de `repetir` de algo que escribiste tú.

export const PLANTILLA = `
    <header>
      <button v-if="abierta" class="atras" @click="volver">‹ Atrás</button>
      <h1>{{ abierta ? nombre : 'Conversaciones' }}</h1>
      <span v-if="abierta && ejecutor.nombre" class="quien-atiende">{{ ejecutor.nombre }}</span>
      <span class="estado" v-if="!abierta && sesiones.length">{{ sesiones.length }}</span>
    </header>

    <main>
      <div v-if="error" class="error">{{ error }}</div>

      <!-- Cambiar de servidor. Va PLEGADO y sólo cuando hay un error de red: es
           la salida para «la máquina se rehízo y cambió de nombre», no algo que
           haya que ver cada día. Desplegarlo es una decisión, no un tropiezo. -->
      <div v-if="error" class="servidor">
        <button class="enlace" @click="verDireccion = !verDireccion">
          {{ verDireccion ? '▾' : '▸' }} Cambiar la dirección del servidor
        </button>
        <div v-if="verDireccion" class="servidor-caja">
          <p class="pista">
            Pídela por Telegram con <b>/use cweb</b> y luego <b>url</b>. Se guarda en este
            móvil y la app saltará sola: no hay que reinstalarla.
          </p>
          <input
            v-model="direccionEscrita"
            type="url"
            inputmode="url"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            placeholder="dev.tured.ts.net:8080"
            @keydown.enter.prevent="usarDireccion(false)">
          <div class="fila-botones">
            <button class="enviar" :disabled="probando" @click="usarDireccion(false)">
              {{ probando ? 'probando…' : 'Guardar e ir' }}
            </button>
            <button v-if="puedeForzar" class="secundario" @click="usarDireccion(true)">
              Ir de todos modos
            </button>
          </div>
          <p v-if="errorDireccion" class="error-linea">{{ errorDireccion }}</p>
          <p class="pista tenue">Abriendo desde: {{ origenActual }}</p>
          <p v-if="direccionGuardada && direccionGuardada !== origenActual" class="pista">
            Guardada: {{ direccionGuardada }}
            <button class="enlace" @click="olvidarServidor">olvidarla</button>
          </p>
        </div>
      </div>

      <!-- Que el bot esté parado se DICE. Enseñar el último log como si fuera de
           ahora es fallar a mitad: parece que claude no te contestó. -->
      <div v-if="avisoCoordinador" class="aviso">{{ avisoCoordinador }}</div>
      <div v-if="cargando" class="cargando">cargando…</div>

      <!-- lista -->
      <template v-if="!abierta && !cargando">
        <p v-if="!sesiones.length && !error" class="vacio">
          Todavía no hay ninguna conversación registrada.<br>
          Escríbele a claude por Telegram y vuelve.
        </p>
        <button v-for="s in sesiones" :key="s.sesion" class="fila" @click="abrir(s.sesion)">
          <span class="arriba">
            <span class="nombre">{{ s.nombre }}</span>
            <span class="cuando">{{ cuando(s.ultimo?.ts) }}</span>
          </span>
          <span class="extracto">{{ s.ultimo?.extracto || '(sin mensajes)' }}</span>
          <span class="cuantos">
            {{ s.mensajes }} mensaje(s)
            <span v-if="s.ejecutor?.nombre">· lo atiende <b>{{ s.ejecutor.nombre }}</b></span>
            <span v-if="s.pendiente" class="pendiente">· ⏳ esperando respuesta</span>
          </span>
        </button>
      </template>

      <!-- conversación -->
      <template v-if="abierta && !cargando">
        <button v-if="hayMas" class="mas" @click="masAntiguos">Cargar más antiguos</button>
        <template v-for="m in mensajes" :key="m.id">
          <div v-if="esCorte(m)" class="corte">conversación reiniciada</div>
          <div v-else class="msg" :class="m.autor">
            <div class="quien">{{ AUTOR[m.autor] }} · {{ cuando(m.ts) }}<template v-if="m.origen !== 'telegram'"> · {{ m.origen }}</template></div>
            <div class="cuerpo md" v-html="render(m.texto)"></div>
          </div>
        </template>
        <p v-if="!mensajes.length" class="vacio">Esta conversación todavía no tiene mensajes.</p>
        <!-- Sin streaming no hay señal de vida: sin esto, la web parece colgada
             mientras claude piensa, que pueden ser minutos. -->
        <p v-if="pendienteAqui" class="pendiente esperando">⏳ claude está respondiendo…</p>
      </template>
    </main>

    <!-- Escribir. Va FUERA del main y pegado abajo: en un móvil, el sitio donde
         se escribe no puede depender de dónde esté el scroll. -->
    <footer v-if="abierta">
      <!-- Lo que escribas aquí va al ejecutor LIGADO al tema, no a claude
           siempre. Decirlo en el sitio donde escribes es lo que evita mandarle a
           otro ejecutor algo pensado para claude. -->
      <div v-if="avisoEjecutor" class="aviso-caja">{{ avisoEjecutor }}</div>
      <div class="fila-caja">
      <textarea
        v-model="borrador"
        :disabled="enviando || !ejecutor.nombre"
        rows="1"
        :placeholder="ejecutor.nombre ? 'Escribe a ' + ejecutor.nombre + '…' : 'Sin sesión abierta en este tema'"
        @keydown.enter.exact.prevent="enviar"
        @input="crecer"
        ref="caja"></textarea>
      <button class="enviar" :disabled="!borrador.trim() || enviando || !ejecutor.nombre" @click="enviar">
        {{ enviando ? '…' : 'Enviar' }}
      </button>
      </div>
    </footer>
  `;
