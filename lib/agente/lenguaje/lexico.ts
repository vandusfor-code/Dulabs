/**
 * LÉXICO DECLARATIVO del lenguaje del cliente (Bloque 28) — solo DATOS, sin lógica.
 *
 * Todo está ya normalizado (minúsculas, sin tildes ni signos): lo compara `normalizar()`.
 * Agregar una expresión = agregar una línea aquí (y su caso en lib/agente/agente-lenguaje.test.ts).
 *
 * Qué NO va aquí: productos, precios, stock, modalidad de un cliente, estados de pedidos. Eso es del
 * backend y de las herramientas. Este léxico solo sirve para que el backend reconozca, sin adivinar,
 * las respuestas a SUS preguntas (entrega, pago, cantidades, correcciones, salidas) y para que no
 * confunda una pregunta o una intención con un dato.
 */

// ---------------------------------------------------------------------------
// 1. Errores frecuentes y abreviaciones (palabra -> palabra correcta)
// ---------------------------------------------------------------------------
export const CORRECCIONES_PALABRA: Readonly<Record<string, string>> = {
  // querer
  kiero: "quiero", qiero: "quiero", keiro: "quiero", quero: "quiero", kero: "quiero", qero: "quiero", qiere: "quiere", kiere: "quiere",
  // entrega
  domisilio: "domicilio", domicilo: "domicilio", domicillo: "domicilio", domisilo: "domicilio", domicio: "domicilio", domiclio: "domicilio",
  recojer: "recoger", recojerlo: "recogerlo", recojerla: "recogerla", recogo: "recojo", recoje: "recoge", recogerloo: "recogerlo",
  // pago
  transferecia: "transferencia", tranferencia: "transferencia", trasferencia: "transferencia", transferensia: "transferencia",
  transfencia: "transferencia", transferncia: "transferencia", trasnferencia: "transferencia", tranferecia: "transferencia",
  transfe: "transferencia", transfer: "transferencia", tranfer: "transferencia", tranferir: "transferir", trasferir: "transferir",
  trasfiero: "transfiero", tranfiero: "transfiero", efetivo: "efectivo", efectibo: "efectivo",
  // modalidad
  mallor: "mayor", mayorr: "mayor", maior: "mayor", mallorista: "mayorista", mayorsita: "mayorista", mayoritsa: "mayorista", mayorisa: "mayorista",
  detall: "detal", detalll: "detal",
  // catálogo y pedido
  catologo: "catalogo", catalgo: "catalogo", catalog: "catalogo", catalojo: "catalogo", catalogoo: "catalogo", pedidio: "pedido", pedio: "pedido",
  // cortesía y conectores
  porfa: "por favor", porfis: "por favor", xfa: "por favor", xfavor: "por favor", porfavor: "por favor", plis: "por favor", pls: "por favor", please: "por favor",
  grax: "gracias", grasias: "gracias", gracia: "gracias", grcias: "gracias",
  tambn: "tambien", tmb: "tambien", tb: "tambien", tbn: "tambien",
  q: "que", k: "que", xq: "porque", pq: "porque", porq: "porque",
  // afirmaciones
  sii: "si", sisi: "si", okey: "ok", oki: "ok", okis: "ok", okay: "ok", oka: "ok", okk: "ok",
};

/** Correcciones de dos o más palabras (sobre el texto ya corregido palabra a palabra). */
export const CORRECCIONES_FRASE: ReadonlyArray<readonly [string, string]> = [
  ["en tiendo", "en tienda"],
  ["recoger en tiendo", "recoger en tienda"],
  ["x mayor", "por mayor"],
  ["al x mayor", "al por mayor"],
  ["x favor", "por favor"],
  ["x transferencia", "por transferencia"],
  ["a domicilo", "a domicilio"],
];

// ---------------------------------------------------------------------------
// 2. Preguntas (una pregunta NUNCA es una respuesta a una selección)
// ---------------------------------------------------------------------------
/** Palabras que, al INICIO de un mensaje, lo vuelven pregunta aunque no tenga "?". */
export const INICIO_DE_PREGUNTA = [
  "cuanto", "cuanta", "cuantos", "cuantas", "cuando", "donde", "cual", "cuales", "a que hora", "a cuanto",
  "puedo", "puedes", "pueden", "se puede", "hay", "tienen", "tienes", "hacen", "manejan", "aceptan", "reciben", "cobran",
  "es posible", "sera que", "me pueden", "me puedes", "incluye", "tiene costo", "tiene algun costo", "llega", "demora", "tarda",
] as const;

// ---------------------------------------------------------------------------
// 3. Entrega y pago (lo que el backend acepta como respuesta a SUS preguntas)
// ---------------------------------------------------------------------------
export const ENTREGA = {
  tienda: [
    "recoger", "recojo", "recogerlo", "recogerla", "recogerlos", "recogerlas", "recoge", "retiro", "retirar", "retirarlo", "tienda", "local",
    "paso por el", "paso por ella", "paso por la tienda", "paso por tienda", "voy por el", "voy por ella", "voy a recoger", "voy a recogerlo", "lo recojo",
  ],
  domicilio: [
    "domicilio", "envio", "enviar", "envien", "enviarlo", "enviarla", "enviarlos", "me lo envian", "me la envian", "mandar", "manden", "mandarlo",
    "me lo mandan", "que me lo manden", "que me lo lleven", "que me la lleven", "a mi casa", "a la casa", "llegue a mi casa", "a domicilio",
  ],
} as const;

export const PAGO = {
  pago_en_tienda: [
    "pago en tienda", "en tienda", "tienda", "efectivo", "efectivo en tienda", "local", "en el local", "pago en el local", "en persona", "pago presencial",
    "presencial", "pago alla", "pago ahi", "voy a pagar alla", "pagar alla", "pago al recoger", "al recoger", "pago cuando vaya", "cuando vaya", "cuando pase",
  ],
  transferencia: [
    "transferencia", "transferir", "transfiero", "te transfiero", "consignacion", "consignar", "consigno", "nequi", "daviplata", "bancolombia", "pse",
    "transferencia bancaria", "por transferencia", "pago por transferencia",
  ],
  /**
   * Depende de la entrega: con "recoger en tienda" es pago en tienda; con domicilio sería contra entrega,
   * que Delacour no ofrece: entonces el backend explica las opciones (nunca elige por el cliente).
   */
  segun_entrega: ["contra entrega", "contraentrega", "cuando llegue", "al llegar", "cuando me llegue", "pago cuando llegue", "pago al recibir", "al recibir"],
} as const;

// ---------------------------------------------------------------------------
// 4. Correcciones, dudas, esperas y salidas (checkout)
// ---------------------------------------------------------------------------
/** Marcadores de corrección ("no, mejor…", "perdón, era…"): el cliente cambia un dato que ya dio. */
export const MARCADORES_CORRECCION = ["no", "mejor", "perdon", "perdona", "disculpa", "era", "eran", "cambia", "cambialo", "cambiar", "corrijo", "en realidad", "mas bien", "me equivoque", "prefiero"] as const;

/** Mensaje COMPLETO que cancela el registro del pedido. */
export const SALIDA_CANCELAR = [
  "cancelar", "cancela", "cancelalo", "cancelala", "cancelar pedido", "cancelar el pedido", "cancela el pedido", "cancelar mi pedido", "quiero cancelar",
  "quiero cancelar el pedido", "ya no quiero", "ya no lo quiero", "ya no la quiero", "ya no quiero nada", "no quiero nada", "olvidalo",
] as const;

/** Mensaje COMPLETO que vuelve a la selección para cambiar productos (conserva los productos). */
export const SALIDA_MODIFICAR = [
  "modificar", "modificar pedido", "modificar el pedido", "modificar mi pedido", "quiero modificar", "quiero modificar el pedido", "cambiar pedido",
  "cambiar mi pedido", "cambiar el pedido", "cambiar productos", "cambiar los productos", "quiero cambiar productos", "quiero cambiar el producto",
  "cambiar el producto", "quiero otro producto", "mejor quiero otro", "mejor otro producto", "quiero agregar otro producto", "agregar otro producto",
  "quiero ver otros", "quiero seguir viendo", "seguir comprando", "quiero agregar mas productos",
] as const;

/** El cliente duda o se retracta SIN decir qué cambia: se le pregunta qué quiere cambiar (nada se modifica). */
export const DUDA = ["cambie de opinion", "me confundi", "me equivoque", "perdon", "perdona", "disculpa", "espera me equivoque", "me enrede", "no era eso", "eso no"] as const;

/** Pide un momento: se le espera (nada se modifica). */
export const ESPERA = ["espera", "esperame", "espere", "un momento", "un momentico", "un segundo", "un seg", "dame un momento", "ya te digo", "ahorita te digo", "dejame ver", "dejame pensar", "ya vuelvo", "ya te escribo"] as const;

/** Anuncia que va a mandar la dirección (no es la dirección). */
export const ANUNCIA_DIRECCION = ["te mando la direccion", "te envio la direccion", "ya te la mando", "ya te la envio", "te la mando", "te la envio", "ya te paso la direccion", "te paso la direccion", "espera te la mando", "dejame buscarla", "ahi te va", "ya te mando la direccion"] as const;

// ---------------------------------------------------------------------------
// 5. Respuestas cortas, saludo, cortesía y risa
// ---------------------------------------------------------------------------
export const AFIRMACIONES = ["si", "sip", "sipi", "dale", "ok", "listo", "de una", "correcto", "confirmo", "confirmado", "confirmar", "claro", "perfecto", "vale", "va", "bueno", "esta bien", "todo bien", "adelante", "hagamoslo", "de acuerdo", "hecho", "eso", "exacto", "asi es"] as const;
export const NEGACIONES = ["no", "nop", "nope", "nel", "para nada", "no gracias", "negativo"] as const;
export const SALUDOS = ["hola", "buenas", "buenos dias", "buen dia", "buenas tardes", "buenas noches", "hey", "hello", "ola", "holi", "que tal", "saludos"] as const;
export const CORTESIA = ["gracias", "muchas gracias", "mil gracias", "por favor", "gracias por favor", "ok gracias", "listo gracias", "vale gracias"] as const;

// ---------------------------------------------------------------------------
// 6. Cantidades
// ---------------------------------------------------------------------------
export const NUMEROS_EN_LETRAS: Readonly<Record<string, number>> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};
/** Unidades que pueden seguir al número ("2 und", "2uds", "2 piezas"). */
export const UNIDADES = ["u", "un", "und", "unds", "ud", "uds", "unidad", "unidades", "pieza", "piezas", "pz", "pzs"] as const;
/** Verbos / marcadores que pueden ir ANTES de una cantidad en un mensaje de solo cantidad. */
export const ANTES_DE_CANTIDAD = [
  "quiero", "dame", "deme", "necesito", "ponme", "pongame", "ponle", "agregame", "agrega", "me llevo", "llevo", "seria", "serian", "que sean", "sean",
  "eran", "era", "son", "cambia a", "cambialo a", "cambiala a", "mejor", "no", "perdon", "mejor que sean", "solo", "solamente", "dejame", "dejalo en", "quiero solo",
] as const;
/** Lo que puede ir DESPUÉS de la cantidad sin nombrar un producto nuevo ("de esos", "por favor"). */
export const DESPUES_DE_CANTIDAD = ["de esos", "de esas", "de ese", "de esa", "de este", "de esta", "de estos", "de estas", "por favor", "no mas", "nada mas"] as const;
/** Una unidad más / menos del producto señalado (o del único). */
export const SUMAR_UNO = ["uno mas", "una mas", "otro mas", "otra mas", "agregame otro", "agregame otra", "agrega otro", "agrega otra", "ponme otro", "ponme otra", "quiero otro igual", "quiero otra igual", "otro igual", "otra igual", "dame otro", "dame otra", "suma uno", "uno adicional", "quiero agregar uno mas", "agrega uno mas", "agregar uno mas", "quiero uno mas", "quiero una mas", "otra unidad", "una unidad mas"] as const;
export const RESTAR_UNO = ["quita uno", "quita una", "quitale uno", "quitale una", "uno menos", "una menos", "resta uno", "resta una", "saca uno", "saca una"] as const;
/** Quitar un producto de la selección / del pedido ("quita ese", "borra el primero"). */
export const QUITAR = ["quita", "quitar", "quitale", "elimina", "eliminar", "borra", "borrar", "saca", "sacar", "no quiero", "ya no quiero", "remueve", "retira"] as const;

// ---------------------------------------------------------------------------
// 7. Nombre: palabras que NUNCA forman parte de un nombre (intención, comando, producto, pregunta)
// ---------------------------------------------------------------------------
export const NO_ES_NOMBRE = new Set([
  "quiero", "quiere", "comprar", "compra", "pedido", "pedir", "pedirlo", "precio", "precios", "vale", "valor", "cuanto", "cuesta", "cuestan", "cuando", "donde",
  "como", "catalogo", "link", "mandame", "enviame", "pasame", "muestrame", "espera", "esperame", "mejor", "domicilio", "tienda", "transferencia", "efectivo",
  "pago", "pagar", "envio", "recoger", "recojo", "arete", "aretes", "collar", "collares", "dije", "dijes", "pulsera", "pulseras", "anillo", "anillos",
  "cadena", "cadenas", "joya", "joyas", "producto", "productos", "ese", "esa", "este", "esta", "eso", "esto", "esos", "esas", "otro", "otra", "unidades",
  "gracias", "hola", "buenas", "si", "no", "ok", "listo", "dale", "usa", "usar", "mismo", "misma", "numero", "telefono", "whatsapp", "cancelar", "modificar",
  "confirmar", "confirmo", "direccion", "calle", "carrera", "ciudad", "barrio", "referencia", "foto", "fotos", "asesora", "asesor", "ayuda", "cambiar",
  "cambia", "agregar", "agrega", "quita", "quitar", "nada", "ninguno", "ninguna", "yo", "mio", "mia", "claro", "perfecto", "bueno", "igual", "tambien",
  "detal", "mayor", "mayorista", "todo", "todos", "dos", "tres", "uno", "una", "por", "favor", "que", "porque", "hay", "tienen", "tienes", "puedo",
]);
/**
 * Palabras de NO_ES_NOMBRE que SÍ aparecen en nombres de negocio ("Tienda Mayorista Luna", "Joyas Mary"):
 * se aceptan si el nombre trae además una palabra propia; solas ("tienda", "mayorista") nunca son un nombre.
 */
export const NOMBRE_COMERCIAL = new Set(["tienda", "local", "mayor", "mayorista", "detal", "joya", "joyas"]);
/** Palabras que acompañan una opción de entrega/pago sin ser un dato ("prefiero a domicilio", "mejor en el local"). */
export const CONECTORES_OPCION = new Set([
  "a", "al", "el", "la", "los", "las", "en", "de", "del", "por", "para", "mi", "me", "lo", "que", "y", "o", "es", "mejor", "prefiero", "quiero", "seria",
  "pues", "entonces", "bien", "si", "no", "ok", "listo", "dale", "pago", "pagar", "pagaria", "pagarlo", "voy", "paso", "vaya", "cuando", "ahi", "alla",
  "mas", "sera", "hago", "con", "hacer", "hacerlo", "va", "ser",
]);
/** Prefijos con los que se presenta un nombre ("soy Laura", "es Duvan", "a nombre de Ana"). */
export const PREFIJOS_NOMBRE = ["a nombre de", "ponlo a nombre de", "a nombre", "mi nombre es", "el nombre es", "nombre", "me llamo", "yo soy", "soy", "es", "con", "se llama"] as const;

// ---------------------------------------------------------------------------
// 8. Dirección y ciudad
// ---------------------------------------------------------------------------
/** Palabras que señalan una dirección colombiana (con o sin número). */
export const MARCAS_DIRECCION = new Set([
  "calle", "cl", "cll", "clle", "carrera", "cra", "kra", "kr", "cr", "crr", "carrer", "avenida", "av", "avda", "diagonal", "dg", "diag", "transversal", "tv",
  "trans", "transv", "circular", "cq", "manzana", "mz", "mza", "casa", "apto", "apartamento", "apt", "ap", "torre", "bloque", "interior", "int", "barrio", "br",
  "conjunto", "urbanizacion", "urb", "vereda", "sector", "km", "kilometro", "edificio", "edif", "piso", "oficina", "etapa", "lote", "finca", "condominio",
]);
/** Prefijos que no son parte de la dirección ("mi dirección es …", "vivo en …"). */
export const PREFIJOS_DIRECCION = ["mi direccion es", "la direccion es", "direccion", "mi direccion", "vivo en", "es en", "queda en", "domicilio en", "a la", "en la", "en el"] as const;
/** Ubicación vaga (sin calle ni número): se pide la dirección exacta, nunca se inventa. */
export const UBICACION_VAGA = ["centro", "por el centro", "cerca", "cerca de", "por aca", "por alla", "al lado", "frente", "por la", "por el"] as const;

// ---------------------------------------------------------------------------
// 9. Intención de compra (a nivel de PEDIDO; "quiero ese" es elegir un producto, no esto)
// ---------------------------------------------------------------------------
export const COMPRA_PEDIDO = [
  "quiero el pedido", "hagamos el pedido", "hacer el pedido", "quiero hacer el pedido", "quiero hacer mi pedido", "listo para comprar", "vamos a comprar",
  "voy a comprar", "procedamos", "procedamos con el pedido", "quiero proceder", "quiero proceder con el pedido", "sigamos con el pedido", "pasemos al pedido",
  "cerrar el pedido", "quiero cerrar el pedido", "listo quiero comprar", "ya quiero comprar", "quiero finalizar la compra", "finalicemos",
] as const;

/** Verbos de ELEGIR/AGREGAR un producto ("también quiero ese", "agrégame el collar"): dentro del checkout se orienta a "modificar pedido". */
export const VERBOS_PRODUCTO = ["quiero", "agrega", "agregame", "agregar", "anade", "anademe", "tambien", "ponme", "dame", "me llevo", "me interesa", "muestrame", "busco", "mandame", "enviame", "quisiera"] as const;
/** Lo que el cliente puede estar pidiendo como producto (nombres de joyas y deícticos). */
export const PALABRAS_PRODUCTO = ["arete", "aretes", "collar", "collares", "dije", "dijes", "pulsera", "pulseras", "anillo", "anillos", "cadena", "cadenas", "tobillera", "tobilleras", "candonga", "candongas", "joya", "joyas", "producto", "productos", "ese", "esa", "este", "esta", "esos", "esas", "otro producto", "otra joya", "otra cosa", "algo mas"] as const;
/** Pide el catálogo o el enlace ("pásame el catálogo", "mándame el link", "quiero ver todo"). */
export const PIDE_CATALOGO = ["catalogo", "link", "enlace", "pagina", "tienda en linea", "ver todo", "quiero ver todo", "ver los productos", "ver mas productos"] as const;

// ---------------------------------------------------------------------------
// 10. Modalidad (solo la PRIMERA clasificación; un cambio después lo hace una asesora)
// ---------------------------------------------------------------------------
/** Inferir DETAL es seguro (es el canal restrictivo). Mensaje COMPLETO. */
export const DETAL_INICIAL = ["soy particular", "particular", "es para mi", "para mi", "para uso personal", "uso personal", "persona natural", "es un regalo", "para regalar", "compra personal", "compro para mi"] as const;
/** MAYORISTA solo con la palabra explícita. Mensaje COMPLETO. "tengo una tienda" o "soy empresa" NO clasifican. */
export const MAYOR_INICIAL = ["mayor", "al mayor", "por mayor", "al por mayor", "mayorista", "soy mayorista", "compra mayorista", "precio mayorista", "mayoreo"] as const;
