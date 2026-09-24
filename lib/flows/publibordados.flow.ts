/**
 * PUBLI BORDADOS — Flow determinístico de calificación (sin IA).
 *
 * Bienvenida → persona natural / empresa → nombre → (empresa: nombre de la
 * empresa) → producto (dos pantallas de botones: WhatsApp admite máximo 3
 * por mensaje) → cantidad → aviso de precio al por mayor si cantidad >= 6 →
 * guardar cliente → mensaje de traspaso → transferir_soporte → fin.
 *
 * Transferencia: mismo mecanismo genérico que Solo Talento y Daniela
 * (action actionType:"transferir_soporte" -> end), que pausa el chat en
 * dulabs_pausas_chat. Pausa de 720 h (30 días) para que el bot no vuelva a
 * saludar mientras la asesora atiende; Solo Talento usa 24 h.
 *
 * Blindaje de entradas (v2), todo con piezas que el motor ya tiene:
 *  - Texto en una pregunta de botones: el motor ya acepta la etiqueta o el id
 *    escritos sin importar mayúsculas, tildes, emojis ni puntuación
 *    ("EMPRESA.", "gorras"). Lo que no coincide EXACTAMENTE con una opción
 *    sale por la conexión "text" a un mensaje de reintento y vuelve a la
 *    misma pregunta (con sus botones). Sin esa conexión el motor no enviaba
 *    nada: el cliente quedaba sin respuesta. Nunca se adivina una opción.
 *  - Nombre / empresa: regex que exige al menos una letra (un emoji o "..."
 *    se vuelve a pedir).
 *  - Cantidad: regex de entero 1–999999 (acepta "06"; rechaza "6 unidades",
 *    "-3", "0", "1.5", "Infinity", que la validación "number" del motor
 *    dejaba pasar o no explicaba). Se guarda como texto de dígitos; la
 *    condición de mayorista la compara numéricamente.
 *
 * Cliente: el nodo save_data escribe en custom_fields del contacto real
 * (dulabs_clientes_conocidos, por número del negocio + teléfono del cliente)
 * con el mecanismo existente del orquestador (persistContactCustomFields,
 * merge con escritura optimista). Claves con prefijo pb_. El flow guarda SOLO
 * los datos que capturó: nunca toca el estado ni el asesor que administran
 * las asesoras desde el módulo Clientes (un cliente sin estado es "Nuevo").
 *
 * Política de runtime propia (FlowDefinition.runtimePolicy, mecanismo genérico
 * del motor): determinista (sin atajos fuera del grafo ni IA legacy) y
 * reinicio con "reiniciar"/"menú"/"inicio" o tras 24 h sin actividad.
 */
import type { FlowDefinition } from "@/lib/flow/types";

export const PUBLIBORDADOS_BIENVENIDA = `Hola 👋 Bienvenido a Publi Bordados.
Para nosotros es un gusto atenderte.`;
export const PUBLIBORDADOS_TIPO_CLIENTE = "¿Eres persona natural o empresa?";
export const PUBLIBORDADOS_NOMBRE = "¡Perfecto! ¿Cuál es tu nombre?";
export const PUBLIBORDADOS_NOMBRE_EMPRESA = "¿Cuál es el nombre de tu empresa?";
export const PUBLIBORDADOS_PRODUCTO = "¿Qué productos necesitas personalizar?";
export const PUBLIBORDADOS_MAS_OPCIONES = "Estas son las demás opciones:";
export const PUBLIBORDADOS_CANTIDAD = "¿Cuántas unidades necesitas?";
export const PUBLIBORDADOS_MAYORISTA = "Perfecto 👍 Desde 6 unidades aplicamos precio al por mayor.";
export const PUBLIBORDADOS_TRASPASO = "Perfecto. En un momento uno de nuestros asesores te atenderá.";

export const PUBLIBORDADOS_REINTENTO_OPCION = "No logré identificar tu respuesta 🙏 Por favor elige una de las opciones:";
export const PUBLIBORDADOS_REINTENTO_NOMBRE = "Por favor escríbenos tu nombre 🙂";
export const PUBLIBORDADOS_REINTENTO_NOMBRE_EMPRESA = "Por favor escríbenos el nombre de tu empresa 🙂";
export const PUBLIBORDADOS_REINTENTO_CANTIDAD = "Escríbenos solo el número de unidades, por ejemplo: 20";

export const PUBLIBORDADOS_UMBRAL_MAYORISTA = 6;
export const PUBLIBORDADOS_PAUSA_HORAS = 720;

/** Al menos una letra, hasta 80 caracteres (el motor ya recorta espacios). */
const TEXTO_CON_LETRA = "^(?=.*\\p{L}).{1,80}$";
/** Entero de 1 a 999999; admite ceros a la izquierda ("06"). */
const CANTIDAD_ENTERA = "^0*[1-9][0-9]{0,5}$";

/** custom_fields que el flow guarda en el contacto (dulabs_clientes_conocidos). */
export const PUBLIBORDADOS_CAMPOS = {
  tipo_cliente: "pb_tipo_cliente",
  nombre: "pb_nombre",
  nombre_empresa: "pb_nombre_empresa",
  producto: "pb_producto",
  cantidad: "pb_cantidad",
} as const;

export const PUBLIBORDADOS_PALABRAS_REINICIO = ["reiniciar", "menú", "menu", "inicio"];
export const PUBLIBORDADOS_INACTIVIDAD_HORAS = 24;

export function publibordadosFlow(): FlowDefinition {
  return {
    name: "Publi Bordados – Calificación",
    description:
      "Flow determinístico de Publi Bordados: tipo de cliente, nombre, empresa, producto, cantidad (precio al por mayor desde 6), guardado del cliente y traspaso a asesora vía transferir_soporte. Sin IA.",
    runtimePolicy: {
      deterministic: true,
      restart: { keywords: PUBLIBORDADOS_PALABRAS_REINICIO, afterInactivityHours: PUBLIBORDADOS_INACTIVIDAD_HORAS },
    },
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg-bienvenida", type: "message", config: { text: PUBLIBORDADOS_BIENVENIDA } },
      {
        id: "btn-tipo-cliente",
        type: "buttons",
        config: {
          text: PUBLIBORDADOS_TIPO_CLIENTE,
          variableKey: "tipo_cliente",
          buttons: [
            { id: "persona_natural", label: "Persona natural" },
            { id: "empresa", label: "Empresa" },
          ],
        },
      },
      { id: "msg-reintento-tipo", type: "message", config: { text: PUBLIBORDADOS_REINTENTO_OPCION } },
      {
        id: "q-nombre",
        type: "question",
        config: {
          text: PUBLIBORDADOS_NOMBRE,
          variableKey: "nombre",
          required: true,
          validation: { kind: "regex", pattern: TEXTO_CON_LETRA, flags: "u", message: PUBLIBORDADOS_REINTENTO_NOMBRE },
        },
      },
      {
        id: "cond-es-empresa",
        type: "condition",
        config: { rules: [{ field: "tipo_cliente", operator: "equals", value: "empresa" }], match: "all" },
      },
      {
        id: "q-nombre-empresa",
        type: "question",
        config: {
          text: PUBLIBORDADOS_NOMBRE_EMPRESA,
          variableKey: "nombre_empresa",
          required: true,
          validation: { kind: "regex", pattern: TEXTO_CON_LETRA, flags: "u", message: PUBLIBORDADOS_REINTENTO_NOMBRE_EMPRESA },
        },
      },
      {
        id: "btn-producto",
        type: "buttons",
        config: {
          text: PUBLIBORDADOS_PRODUCTO,
          variableKey: "producto",
          buttons: [
            { id: "gorras", label: "🧢 Gorras" },
            { id: "prendas_de_vestir", label: "👕 Prendas de vestir" },
            { id: "mas_opciones", label: "➕ Más opciones" },
          ],
        },
      },
      { id: "msg-reintento-producto", type: "message", config: { text: PUBLIBORDADOS_REINTENTO_OPCION } },
      {
        id: "btn-producto-mas",
        type: "buttons",
        config: {
          text: PUBLIBORDADOS_MAS_OPCIONES,
          variableKey: "producto",
          buttons: [
            { id: "uniformes", label: "🦺 Uniformes" },
            { id: "otros", label: "🧵 Otros" },
            { id: "volver", label: "⬅️ Ver anteriores" },
          ],
        },
      },
      { id: "msg-reintento-producto-mas", type: "message", config: { text: PUBLIBORDADOS_REINTENTO_OPCION } },
      {
        id: "q-cantidad",
        type: "question",
        config: {
          text: PUBLIBORDADOS_CANTIDAD,
          variableKey: "cantidad",
          required: true,
          validation: { kind: "regex", pattern: CANTIDAD_ENTERA, message: PUBLIBORDADOS_REINTENTO_CANTIDAD },
        },
      },
      {
        id: "cond-mayorista",
        type: "condition",
        config: {
          rules: [{ field: "cantidad", operator: "greater_or_equal", value: PUBLIBORDADOS_UMBRAL_MAYORISTA }],
          match: "all",
        },
      },
      { id: "msg-mayorista", type: "message", config: { text: PUBLIBORDADOS_MAYORISTA } },
      {
        id: "save-cliente",
        type: "save_data",
        config: {
          mappings: Object.entries(PUBLIBORDADOS_CAMPOS).map(([variable, targetKey]) => ({
            variable,
            target: "custom_field" as const,
            targetKey,
          })),
        },
      },
      { id: "msg-traspaso", type: "message", config: { text: PUBLIBORDADOS_TRASPASO } },
      {
        id: "act-transferir-soporte",
        type: "action",
        config: { actionType: "transferir_soporte", pauseDurationHours: PUBLIBORDADOS_PAUSA_HORAS },
      },
      { id: "end-transferido", type: "end", config: { tags: ["publibordados", "transferido"] } },
    ],
    edges: [
      { id: "e-start-bienvenida", source: "start", target: "msg-bienvenida" },
      { id: "e-bienvenida-tipo", source: "msg-bienvenida", target: "btn-tipo-cliente" },
      { id: "e-tipo-persona", source: "btn-tipo-cliente", target: "q-nombre", sourceHandle: "button:persona_natural" },
      { id: "e-tipo-empresa", source: "btn-tipo-cliente", target: "q-nombre", sourceHandle: "button:empresa" },
      { id: "e-tipo-texto", source: "btn-tipo-cliente", target: "msg-reintento-tipo", sourceHandle: "text" },
      { id: "e-reintento-tipo", source: "msg-reintento-tipo", target: "btn-tipo-cliente" },
      { id: "e-nombre-cond", source: "q-nombre", target: "cond-es-empresa" },
      { id: "e-cond-empresa-true", source: "cond-es-empresa", target: "q-nombre-empresa", sourceHandle: "true" },
      { id: "e-cond-empresa-false", source: "cond-es-empresa", target: "btn-producto", sourceHandle: "false" },
      { id: "e-empresa-producto", source: "q-nombre-empresa", target: "btn-producto" },
      { id: "e-producto-gorras", source: "btn-producto", target: "q-cantidad", sourceHandle: "button:gorras" },
      { id: "e-producto-prendas", source: "btn-producto", target: "q-cantidad", sourceHandle: "button:prendas_de_vestir" },
      { id: "e-producto-mas", source: "btn-producto", target: "btn-producto-mas", sourceHandle: "button:mas_opciones" },
      { id: "e-producto-texto", source: "btn-producto", target: "msg-reintento-producto", sourceHandle: "text" },
      { id: "e-reintento-producto", source: "msg-reintento-producto", target: "btn-producto" },
      { id: "e-mas-uniformes", source: "btn-producto-mas", target: "q-cantidad", sourceHandle: "button:uniformes" },
      { id: "e-mas-otros", source: "btn-producto-mas", target: "q-cantidad", sourceHandle: "button:otros" },
      { id: "e-mas-volver", source: "btn-producto-mas", target: "btn-producto", sourceHandle: "button:volver" },
      { id: "e-mas-texto", source: "btn-producto-mas", target: "msg-reintento-producto-mas", sourceHandle: "text" },
      { id: "e-reintento-producto-mas", source: "msg-reintento-producto-mas", target: "btn-producto-mas" },
      { id: "e-cantidad-cond", source: "q-cantidad", target: "cond-mayorista" },
      { id: "e-cond-true", source: "cond-mayorista", target: "msg-mayorista", sourceHandle: "true" },
      { id: "e-cond-false", source: "cond-mayorista", target: "save-cliente", sourceHandle: "false" },
      { id: "e-mayorista-save", source: "msg-mayorista", target: "save-cliente" },
      { id: "e-save-traspaso", source: "save-cliente", target: "msg-traspaso" },
      { id: "e-traspaso-act", source: "msg-traspaso", target: "act-transferir-soporte" },
      { id: "e-act-end", source: "act-transferir-soporte", target: "end-transferido" },
    ],
    variables: [
      { key: "tipo_cliente", label: "Tipo de cliente", type: "string" },
      { key: "nombre", label: "Nombre", type: "string" },
      // "" por defecto: una persona natural deja vacío el nombre de empresa
      // que pudo quedar de una solicitud anterior como empresa.
      { key: "nombre_empresa", label: "Empresa", type: "string", defaultValue: "" },
      { key: "producto", label: "Producto", type: "string" },
      { key: "cantidad", label: "Cantidad", type: "string" },
    ],
  };
}
