/**
 * CMS comercial — SEGURIDAD DE LOS TEXTOS. PURO.
 *
 * Todo lo que escribe la administradora es DATO comercial, nunca instrucción. La barrera principal es ESTRUCTURAL (el contenido viaja a ARIA solo como resultado
 * de una herramienta del backend, jamás en el prompt de sistema, y la guarda de anclaje vigila lo que ARIA dice). Esto es el cinturón adicional:
 *   - texto plano: sin etiquetas HTML ni caracteres de control (React escapa al pintar; esto evita además que se guarde código por accidente);
 *   - frases que intentan DAR ÓRDENES al asistente («ignora las instrucciones anteriores», «system prompt», «actúa como un asistente…»): se bloquean al
 *     publicar. Es una heurística y NO es la barrera principal: se prueba con textos comerciales reales para que no dé falsos positivos;
 *   - el enlace mayorista nunca puede quedar escrito en un texto visible para clientes detal.
 */

const sinTildes = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Controles (menos salto de línea y tabulador) y caracteres invisibles o de dirección de texto que podrían ocultar contenido. */
const CONTROL_E_INVISIBLES = "[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f-\\x9f\\u{200b}-\\u{200f}\\u{2028}\\u{2029}\\u{202a}-\\u{202e}\\u{2066}-\\u{2069}\\u{feff}]";

/** Quita caracteres de control (menos salto de línea y tabulador), unifica saltos de línea y recorta. */
export function normalizarTexto(valor: string): string {
  return valor
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(new RegExp(CONTROL_E_INVISIBLES, "gu"), "")
    .trim();
}

/** ¿Trae caracteres de control o de dirección de texto invisibles (que ocultarían contenido)? */
export function tieneControlOInvisible(valor: string): boolean {
  return new RegExp(CONTROL_E_INVISIBLES, "u").test(valor);
}

/** ¿Parece HTML? (una etiqueta `<b>`, `</p>`, `<!--`, `<?`). Un «<3» o «precio < 50» no cuenta. */
export function contieneHtml(valor: string): boolean {
  return /<[a-zA-Z/!?]/.test(valor);
}

/** Patrones inequívocos de órdenes al asistente. Se evalúan sobre el texto en minúsculas y sin tildes. */
const ORDENES_AL_ASISTENTE: ReadonlyArray<readonly [string, RegExp]> = [
  ["ignorar_instrucciones", /\bignor\w*\s+(?:todas?\s+)?(?:las\s+|tus\s+|sus\s+|mis\s+|estas\s+)?(?:instrucciones|reglas|indicaciones|ordenes|restricciones)\b/],
  ["ignore_instructions", /\bignore\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|earlier)?\s*(?:instructions|rules|prompts?)\b/],
  ["olvidar_lo_anterior", /\b(?:olvida|olvidar|olvide)\w*\s+(?:todo\s+)?(?:lo\s+)?(?:anterior|previo|que\s+te\s+(?:dijeron|dije|dijo))\b/],
  ["forget_everything", /\bforget\s+(?:everything|all|your|the)\b/],
  ["system_prompt", /\b(?:system|developer)\s*(?:prompt|message|instruction)s?\b|\bprompt\s+del\s+sistema\b|\binstrucciones\s+del\s+sistema\b/],
  ["a_partir_de_ahora", /\b(?:a\s+partir\s+de\s+ahora|de\s+ahora\s+en\s+adelante)\s*,?\s*(?:eres|seras|actuaras|debes|responde|responderas|solo|siempre|nunca|ignora)\b/],
  ["rol_asistente", /\b(?:actua|actues|comportate|finge|simula|pretende)\s+(?:como|ser)\s+(?:un|una|el|la)?\s*(?:asistente|bot|chatbot|ia|inteligencia\s+artificial|modelo|sistema|programador|desarrollador|administrador)\b/],
  ["you_are_now", /\byou\s+are\s+now\b|\bpretend\s+(?:to\s+be|you\s+are)\b|\bact\s+as\s+(?:an?\s+)?(?:assistant|ai|model|developer|system)\b/],
  ["ahora_eres", /\b(?:ahora\s+eres|eres\s+ahora|tu\s+nuevo\s+rol|tu\s+nueva\s+tarea)\b/],
  ["responde_siempre", /\b(?:responde|contesta|responderas|contestaras)\s+(?:siempre|unicamente|exclusivamente|solamente)\b/],
  ["nunca_digas", /\bnunca\s+(?:menciones|digas|reveles|respondas|contestes|le\s+digas)\b/],
  ["revelar_prompt", /\b(?:revela|muestra|imprime|repite|divulga)\w*\s+(?:tu|el|tus|las|los)\s+(?:prompt|instrucciones|reglas|configuracion)\b/],
  ["herramienta_orden", /\b(?:llama|ejecuta|invoca|usa|utiliza)\w*\s+(?:a\s+)?(?:la\s+|las\s+|esta\s+)?(?:herramienta|herramientas|funcion|tool)\b|\btool\s*call\b|\bfunction\s*call\b/],
  ["jailbreak", /\bjailbreak\b|\bdo\s+anything\s+now\b|\bdan\s+mode\b|\bmodo\s+desarrollador\b/],
];

/** Código de la primera orden al asistente que encuentre el texto; null = ninguna. */
export function ordenAlAsistente(valor: string): string | null {
  const t = sinTildes(valor).replace(/\s+/g, " ");
  for (const [codigo, re] of ORDENES_AL_ASISTENTE) if (re.test(t)) return codigo;
  return null;
}

/**
 * ¿Escribió el enlace del catálogo MAYORISTA (`/catalogo/<tienda>/mayor/<token>`) o el patrón de su ruta? Un texto visible para detal jamás puede traerlo:
 * el token es un secreto que solo se comparte con quien el negocio autorice.
 */
export function contieneEnlaceMayorista(valor: string): boolean {
  return /\/catalogo\/[a-z0-9-]+\/mayor\b/i.test(valor) || /\/mayor\/[A-Za-z0-9_-]{8,}/.test(valor);
}

/** Cadenas con aspecto de secreto (llaves, tokens largos): no tienen cabida en contenido comercial ni en la auditoría. */
export function pareceSecreto(valor: string): boolean {
  return (
    /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/.test(valor) ||
    /\bAIza[0-9A-Za-z_-]{30,}\b/.test(valor) ||
    /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(valor) ||
    /\b(?:bearer|token|apikey|api_key|secret|password|contrasena|clave)\s*[:=]\s*\S{12,}/i.test(sinTildes(valor))
  );
}
