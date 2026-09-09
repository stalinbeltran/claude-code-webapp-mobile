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
      <span class="estado" v-if="!abierta && sesiones.length">{{ sesiones.length }}</span>
    </header>

    <main>
      <div v-if="error" class="error">{{ error }}</div>

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
  `;
