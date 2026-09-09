// La configuración del renderizador, aparte de la app.
//
// Está separada de `app.js` por una razón concreta: `app.js` importa Vue, que
// necesita un navegador, así que nada de lo que viva ahí se puede probar en Node.
// Y lo que hay aquí es justamente lo que MÁS falta hace probar (R17: una
// comprobación que no corre sola no existe).
//
// Recibe el constructor en vez de importarlo porque `markdown-it@14` no
// distribuye ESM: en el navegador llega como `window.markdownit` y en el test se
// carga el mismo fichero vendorizado. Un solo camino, probado.

/**
 * @param {Function} markdownit el constructor UMD ya cargado
 */
export function crearRenderer(markdownit) {
  const md = markdownit({
    // ⚠⚠ INNEGOCIABLE. Esta app enseña la salida de un modelo que corre en una
    // máquina con `bypassPermissions`: dejar pasar HTML crudo de ahí es abrir XSS
    // en tu propia consola de shell remoto. Tiene test, y ese test es el más
    // importante de este repo.
    html: false,
    linkify: true,   // las rutas y URLs que escribe claude, tocables
    breaks: false,   // markdown de verdad: un salto suelto no es un <br>
  });

  // ⚠ El scroll horizontal de una tabla se queda DENTRO de la tabla. Si no,
  // leer una tabla ancha mueve la conversación entera de lado — y las tablas son
  // justo lo que peor se lee en Telegram, o sea el motivo de esta app.
  // markdown-it no las envuelve, así que se envuelven aquí.
  const abrir = md.renderer.rules.table_open;
  md.renderer.rules.table_open = (t, i, o, e, self) =>
    '<div class="tabla">' + (abrir ? abrir(t, i, o, e, self) : self.renderToken(t, i, o));
  const cerrar = md.renderer.rules.table_close;
  md.renderer.rules.table_close = (t, i, o, e, self) =>
    (cerrar ? cerrar(t, i, o, e, self) : self.renderToken(t, i, o)) + '</div>';

  // Los enlaces salen a otra pestaña, y sin poder tocar la nuestra.
  const enlace = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (t, i, o, e, self) => {
    t[i].attrSet('target', '_blank');
    t[i].attrSet('rel', 'noopener noreferrer');
    return enlace ? enlace(t, i, o, e, self) : self.renderToken(t, i, o);
  };

  return md;
}
