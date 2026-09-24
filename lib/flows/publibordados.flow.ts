/**
 * PUBLI BORDADOS — Flow determinístico de calificación (sin IA).
 *
 * Bienvenida → persona natural / empresa → nombre → producto (dos pantallas
 * de botones: WhatsApp admite máximo 3 por mensaje) → cantidad → aviso de
 * precio al por mayor si cantidad >= 6 → mensaje de traspaso →
 * transferir_soporte → fin.
 *
 * Transferencia: mismo mecanismo genérico que Solo Talento y Daniela
 * (action actionType:"transferir_soporte" -> end), que pausa el chat en
 * dulabs_pausas_chat. Pausa de 720 h (30 días) para que el bot no vuelva a
 * saludar mientras la asesora atiende; Solo Talento usa 24 h.
 *
 * Los botones guardan su id en la variable (tipo_cliente, producto); la
 * cantidad se guarda como número (validación "number").
 */
import type { FlowDefinition } from "@/lib/flow/types";

export const PUBLIBORDADOS_BIENVENIDA = `Hola 👋 Bienvenido a Publi Bordados.
Para nosotros es un gusto atenderte.`;
export const PUBLIBORDADOS_TIPO_CLIENTE = "¿Eres persona natural o empresa?";
export const PUBLIBORDADOS_NOMBRE = "¡Perfecto! ¿Cuál es tu nombre?";
export const PUBLIBORDADOS_PRODUCTO = "¿Qué productos necesitas personalizar?";
export const PUBLIBORDADOS_MAS_OPCIONES = "Estas son las demás opciones:";
export const PUBLIBORDADOS_CANTIDAD = "¿Cuántas unidades necesitas?";
export const PUBLIBORDADOS_MAYORISTA = "Perfecto 👍 Desde 6 unidades aplicamos precio al por mayor.";
export const PUBLIBORDADOS_TRASPASO = "Perfecto. En un momento uno de nuestros asesores te atenderá.";

export const PUBLIBORDADOS_UMBRAL_MAYORISTA = 6;
export const PUBLIBORDADOS_PAUSA_HORAS = 720;

export function publibordadosFlow(): FlowDefinition {
  return {
    name: "Publi Bordados – Calificación",
    description:
      "Flow determinístico de Publi Bordados: tipo de cliente, nombre, producto, cantidad (precio al por mayor desde 6) y traspaso a asesora vía transferir_soporte. Sin IA.",
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
      {
        id: "q-nombre",
        type: "question",
        config: { text: PUBLIBORDADOS_NOMBRE, variableKey: "nombre", required: true, validation: { kind: "text" } },
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
      {
        id: "btn-producto-mas",
        type: "buttons",
        config: {
          text: PUBLIBORDADOS_MAS_OPCIONES,
          variableKey: "producto",
          buttons: [
            { id: "uniformes", label: "🦺 Uniformes" },
            { id: "otros", label: "🧵 Otros" },
          ],
        },
      },
      {
        id: "q-cantidad",
        type: "question",
        config: { text: PUBLIBORDADOS_CANTIDAD, variableKey: "cantidad", required: true, validation: { kind: "number" } },
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
      { id: "e-nombre-producto", source: "q-nombre", target: "btn-producto" },
      { id: "e-producto-gorras", source: "btn-producto", target: "q-cantidad", sourceHandle: "button:gorras" },
      { id: "e-producto-prendas", source: "btn-producto", target: "q-cantidad", sourceHandle: "button:prendas_de_vestir" },
      { id: "e-producto-mas", source: "btn-producto", target: "btn-producto-mas", sourceHandle: "button:mas_opciones" },
      { id: "e-mas-uniformes", source: "btn-producto-mas", target: "q-cantidad", sourceHandle: "button:uniformes" },
      { id: "e-mas-otros", source: "btn-producto-mas", target: "q-cantidad", sourceHandle: "button:otros" },
      { id: "e-cantidad-cond", source: "q-cantidad", target: "cond-mayorista" },
      { id: "e-cond-true", source: "cond-mayorista", target: "msg-mayorista", sourceHandle: "true" },
      { id: "e-cond-false", source: "cond-mayorista", target: "msg-traspaso", sourceHandle: "false" },
      { id: "e-mayorista-traspaso", source: "msg-mayorista", target: "msg-traspaso" },
      { id: "e-traspaso-act", source: "msg-traspaso", target: "act-transferir-soporte" },
      { id: "e-act-end", source: "act-transferir-soporte", target: "end-transferido" },
    ],
    variables: [
      { key: "tipo_cliente", label: "Tipo de cliente", type: "string" },
      { key: "nombre", label: "Nombre", type: "string" },
      { key: "producto", label: "Producto", type: "string" },
      { key: "cantidad", label: "Cantidad", type: "number" },
    ],
  };
}
