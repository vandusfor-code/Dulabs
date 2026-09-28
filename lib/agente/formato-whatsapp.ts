/**
 * Formato de WhatsApp para el texto que redacta el modelo.
 *
 * WhatsApp usa *negrita*, _cursiva_ y ~tachado~ con UN solo símbolo. El modelo a veces escribe
 * Markdown (**negrita**, títulos con #, [texto](url)): WhatsApp muestra la negrita pero deja los
 * asteriscos a la vista ("*Dije Hoja en Plata*" con los * visibles). Aquí se convierte al formato
 * de WhatsApp sin tocar el contenido (precios, referencias, enlaces quedan iguales).
 */
export function formatoWhatsApp(texto: string): string {
  return texto
    .split("\n")
    .map((linea) =>
      linea
        // "### Título" -> "*Título*"
        .replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/, (_m, t: string) => `*${t.replace(/\*+/g, "")}*`)
        // Viñeta "* item" -> "• item" (un * al inicio de línea no es negrita)
        .replace(/^(\s*)\*\s+(?=\S)/, "$1• ")
        // **negrita** / __negrita__ -> *negrita*
        .replace(/\*\*([^*\n]+?)\*\*/g, "*$1*")
        .replace(/__([^_\n]+?)__/g, "*$1*")
        // ~~tachado~~ -> ~tachado~
        .replace(/~~([^~\n]+?)~~/g, "~$1~")
        // [texto](https://…) -> texto: https://…
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, t: string, url: string) => (t === url ? url : `${t}: ${url}`)),
    )
    .join("\n");
}
