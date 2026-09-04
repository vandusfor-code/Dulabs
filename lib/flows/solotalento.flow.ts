/**
 * SOLOTALENTO SAS — Flow determinístico (autorizado).
 *
 * Fuente oficial del contenido: "INFORMACIÓN PARA EL CHAT BOT (5).docx".
 * Sin IA -- selección de menú por texto libre validado (regex), igual
 * criterio que Daniela para menús de más de 3 opciones (WhatsApp limita los
 * botones nativos --interactive.type:"button"-- a 3 por mensaje, ver
 * lib/whatsapp-outbound.ts:139-164; no existe un tipo de nodo "list").
 *
 * servicio/necesidad guardan el DÍGITO crudo seleccionado (decisión
 * explícita autorizada) -- no existe en el Flow Engine un mecanismo
 * genérico para asignar un valor LITERAL en prosa desde un menú de más de 3
 * opciones sin construir infraestructura nueva (question/buttons no lo
 * permiten; save_data solo exporta variables ya existentes). El mapeo
 * dígito → texto queda documentado acá:
 *
 *   servicio: 1=SG-SST 2=PESV 3=SARLAFT/Oficial de Cumplimiento 4=BASC
 *             5=Auditorías 6=Capacitaciones 7=Hablar con nuestra asesora
 *   necesidad (SG-SST/PESV): 1=Implementarlo desde cero 2=Actualizarlo o
 *             mantenerlo 3=Realizar una auditoría 4=(SG-SST) Prepararte
 *             para una evaluación o visita / (PESV) Revisar su cumplimiento
 *             y oportunidades de mejora 5=Orientación sobre una necesidad
 *             específica
 *   necesidad (SARLAFT): 1=Implementar el sistema 2=Actualizar o
 *             fortalecerlo 3=Realizar una auditoría o revisión
 *             4=Acompañamiento como Oficial de Cumplimiento 5=Capacitación
 *             6=Orientación sobre una necesidad específica
 *   necesidad (BASC): 1=Implementación 2=Actualización o mantenimiento
 *             3=Auditoría interna 4=Preparación para auditoría
 *             5=Capacitación 6=Orientación sobre una necesidad específica
 *   necesidad (Auditorías): 1=SG-SST 2=PESV 3=SARLAFT 4=BASC 5=Otro sistema
 *             o proceso
 *   necesidad (Capacitaciones): 1=SG-SST 2=Seguridad vial / PESV
 *             3=SARLAFT / Cumplimiento 4=BASC 5=Habilidades comerciales y
 *             servicio 6=Otro tema
 *   ruta 7: necesidad queda sin definir (nunca se pregunta), tal como pide
 *             el spec ("necesidad = null").
 *
 * Corrección de texto (autorizada) -- únicos cambios respecto al documento
 * oficial, ambos por bloqueo REAL de Claim Security (verificado con
 * filterClaimSecuredEffects, no modificado): la palabra "asesor" (standalone,
 * masculina) matchea DOMAIN_CAPABILITY_RULES (support.transferred) sin
 * evidencia verificada:
 *   "Hablar con un asesor" -> "Hablar con nuestra asesora" (menú principal)
 *   "Asesoría sobre una necesidad específica" -> "Orientación sobre una
 *     necesidad específica" (4 submenús: SG-SST, PESV, SARLAFT, BASC)
 *   "con un asesor de SOLOTALENTO SAS" -> "con nuestra asesora de
 *     SOLOTALENTO SAS" (mensaje de transferencia ruta 7)
 * Todo lo demás es texto literal del documento, sin cambios.
 *
 * Transferencia: mismo mecanismo GENÉRICO real que usa Daniela
 * (lib/flows/daniela-router.flow.ts) -- action actionType:"transferir_soporte"
 * -> end. NO se usa el nodo "human" (su campo assignTo es puramente
 * decorativo: solo aparece en la etiqueta visual del canvas del Builder,
 * lib/flow-builder/canvas-adapter.ts:128, nunca se persiste ni notifica a
 * nadie). NO existe una capacidad real de asignar a "Alejandra" por nombre
 * -- ni "human.assignTo" ni el actionType "asignar_miembro" (declarado en
 * types.ts/schemas.ts/action-capabilities.ts pero SIN executor real en
 * InternalActionExecutor -- fallaría en runtime con
 * internal_action_not_supported). Reportado, no inventado.
 */
import type { FlowDefinition } from "@/lib/flow/types";

// Bienvenida dividida en dos mensajes consecutivos (autorizado): separada en
// dos envíos de WhatsApp -- msg-welcome-1 (nodo message) seguido del propio
// texto del nodo question q-main-menu (que ya necesitaba su propio texto
// para mostrar el menú al pedir la entrada). Ningún texto del menú, ruta,
// condición, variable, trigger ni mecanismo de transferencia cambió.
//
// Cambio de saludo (autorizado, pedido explícito de la cliente) — texto de
// SOLOTALENTO_WELCOME_1 reemplazado por el exacto solicitado (agrega "...y la
// intervención estratégica de sus equipos de trabajo", elimina la frase
// "Estamos aquí para orientarte."). Publicado como versión 2 del flow real
// (ver scripts/_publicar-solotalento-v2-produccion.mts) -- la versión 1
// sigue existiendo, solo dejó de ser la publicada.
export const SOLOTALENTO_WELCOME_1 = `👋 ¡Bienvenido a SOLOTALENTO SAS, tu firma consultora!

Nos especializamos en acompañar a las empresas en la gestión, cumplimiento y fortalecimiento de sus sistemas, procesos y la intervención estratégica de sus equipos de trabajo.`;

export const SOLOTALENTO_WELCOME_2 = `¿En qué podemos ayudarte?

1️⃣ SG-SST
2️⃣ PESV
3️⃣ SARLAFT / Oficial de Cumplimiento
4️⃣ BASC
5️⃣ Auditorías
6️⃣ Capacitaciones
7️⃣ Hablar con nuestra asesora

👉 Escribe el número de la opción que deseas.`;

export const SOLOTALENTO_SUB_SGSST = `🦺 SG-SST

Podemos ayudarte a implementar, fortalecer y mantener el Sistema de Gestión de Seguridad y Salud en el Trabajo de tu empresa.

¿Qué necesitas?

1️⃣ Implementarlo desde cero
2️⃣ Actualizarlo o mantenerlo
3️⃣ Realizar una auditoría
4️⃣ Prepararte para una evaluación o visita
5️⃣ Orientación sobre una necesidad específica

👉 Escribe el número de la opción.`;

export const SOLOTALENTO_SUB_PESV = `🚗 PESV – Plan Estratégico de Seguridad Vial

Podemos acompañarte en la implementación, actualización, mantenimiento y fortalecimiento de tu PESV.

¿Qué necesitas?

1️⃣ Implementarlo desde cero
2️⃣ Actualizarlo o mantenerlo
3️⃣ Realizar una auditoría
4️⃣ Revisar su cumplimiento y oportunidades de mejora
5️⃣ Orientación sobre una necesidad específica

👉 Escribe el número de la opción.`;

export const SOLOTALENTO_SUB_SARLAFT = `🛡️ SARLAFT / Oficial de Cumplimiento

Podemos ayudarte a fortalecer la gestión de riesgos y el cumplimiento de las obligaciones relacionadas con SARLAFT.

¿Qué necesitas?

1️⃣ Implementar el sistema
2️⃣ Actualizar o fortalecerlo
3️⃣ Realizar una auditoría o revisión
4️⃣ Acompañamiento como Oficial de Cumplimiento
5️⃣ Capacitación
6️⃣ Orientación sobre una necesidad específica

👉 Escribe el número de la opción.`;

export const SOLOTALENTO_SUB_BASC = `🔐 BASC

Podemos ayudarte a implementar, fortalecer y mantener tu sistema de gestión BASC.

¿Qué necesitas?

1️⃣ Implementación
2️⃣ Actualización o mantenimiento
3️⃣ Auditoría interna
4️⃣ Preparación para auditoría
5️⃣ Capacitación
6️⃣ Orientación sobre una necesidad específica

👉 Escribe el número de la opción.`;

export const SOLOTALENTO_SUB_AUDITORIAS = `🔎 AUDITORÍAS

Realizamos auditorías y revisiones para identificar incumplimientos, riesgos y oportunidades de mejora.

¿Qué deseas auditar?

1️⃣ SG-SST
2️⃣ PESV
3️⃣ SARLAFT
4️⃣ BASC
5️⃣ Otro sistema o proceso

👉 Escribe el número de la opción.`;

export const SOLOTALENTO_SUB_CAPACITACIONES = `🎓 CAPACITACIONES

Contamos con capacitaciones prácticas para fortalecer las competencias de tu equipo.

¿Qué tema te interesa?

1️⃣ SG-SST
2️⃣ Seguridad vial / PESV
3️⃣ SARLAFT / Cumplimiento
4️⃣ BASC
5️⃣ Habilidades comerciales y servicio
6️⃣ Otro tema

👉 Escribe el número de la opción.`;

export const SOLOTALENTO_TRANSFER_1_6 = `✅ ¡Perfecto! Hemos identificado lo que necesitas.

Ahora te comunicaremos con nuestra asesora para brindarte una orientación personalizada.

⏳ Un momento, por favor...`;

export const SOLOTALENTO_TRANSFER_7 = `🤝 ¡Claro que sí!

Te comunicaremos directamente con nuestra asesora de SOLOTALENTO SAS para brindarte una atención personalizada.

⏳ Un momento, por favor...`;

export function solotalentoFlow(): FlowDefinition {
  return {
    name: "SOLOTALENTO SAS",
    description:
      "Flow determinístico de SOLOTALENTO SAS -- menú de 7 servicios, submenús de necesidad, transferencia a asesora vía transferir_soporte. Sin IA.",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg-welcome-1", type: "message", config: { text: SOLOTALENTO_WELCOME_1 } },
      {
        id: "q-main-menu",
        type: "question",
        config: { text: SOLOTALENTO_WELCOME_2, variableKey: "servicio", required: true, validation: { kind: "regex", pattern: "^[1-7]$" } },
      },

      { id: "cond-1", type: "condition", config: { rules: [{ field: "servicio", operator: "equals", value: "1" }], match: "all" } },
      { id: "cond-2", type: "condition", config: { rules: [{ field: "servicio", operator: "equals", value: "2" }], match: "all" } },
      { id: "cond-3", type: "condition", config: { rules: [{ field: "servicio", operator: "equals", value: "3" }], match: "all" } },
      { id: "cond-4", type: "condition", config: { rules: [{ field: "servicio", operator: "equals", value: "4" }], match: "all" } },
      { id: "cond-5", type: "condition", config: { rules: [{ field: "servicio", operator: "equals", value: "5" }], match: "all" } },
      { id: "cond-6", type: "condition", config: { rules: [{ field: "servicio", operator: "equals", value: "6" }], match: "all" } },

      {
        id: "q-sub-sgsst",
        type: "question",
        config: { text: SOLOTALENTO_SUB_SGSST, variableKey: "necesidad", required: true, validation: { kind: "regex", pattern: "^[1-5]$" } },
      },
      {
        id: "q-sub-pesv",
        type: "question",
        config: { text: SOLOTALENTO_SUB_PESV, variableKey: "necesidad", required: true, validation: { kind: "regex", pattern: "^[1-5]$" } },
      },
      {
        id: "q-sub-sarlaft",
        type: "question",
        config: { text: SOLOTALENTO_SUB_SARLAFT, variableKey: "necesidad", required: true, validation: { kind: "regex", pattern: "^[1-6]$" } },
      },
      {
        id: "q-sub-basc",
        type: "question",
        config: { text: SOLOTALENTO_SUB_BASC, variableKey: "necesidad", required: true, validation: { kind: "regex", pattern: "^[1-6]$" } },
      },
      {
        id: "q-sub-auditorias",
        type: "question",
        config: { text: SOLOTALENTO_SUB_AUDITORIAS, variableKey: "necesidad", required: true, validation: { kind: "regex", pattern: "^[1-5]$" } },
      },
      {
        id: "q-sub-capacitaciones",
        type: "question",
        config: { text: SOLOTALENTO_SUB_CAPACITACIONES, variableKey: "necesidad", required: true, validation: { kind: "regex", pattern: "^[1-6]$" } },
      },

      { id: "msg-transfer-1-6", type: "message", config: { text: SOLOTALENTO_TRANSFER_1_6 } },
      { id: "msg-transfer-7", type: "message", config: { text: SOLOTALENTO_TRANSFER_7 } },

      { id: "act-transferir-soporte", type: "action", config: { actionType: "transferir_soporte", pauseDurationHours: 24 } },
      { id: "end-transferido", type: "end", config: { tags: ["solotalento", "transferido"] } },
    ],
    edges: [
      { id: "e-start-welcome1", source: "start", target: "msg-welcome-1" },
      { id: "e-welcome1-menu", source: "msg-welcome-1", target: "q-main-menu" },
      { id: "e-menu-cond1", source: "q-main-menu", target: "cond-1" },

      { id: "e-cond1-true", source: "cond-1", target: "q-sub-sgsst", sourceHandle: "true" },
      { id: "e-cond1-false", source: "cond-1", target: "cond-2", sourceHandle: "false" },
      { id: "e-cond2-true", source: "cond-2", target: "q-sub-pesv", sourceHandle: "true" },
      { id: "e-cond2-false", source: "cond-2", target: "cond-3", sourceHandle: "false" },
      { id: "e-cond3-true", source: "cond-3", target: "q-sub-sarlaft", sourceHandle: "true" },
      { id: "e-cond3-false", source: "cond-3", target: "cond-4", sourceHandle: "false" },
      { id: "e-cond4-true", source: "cond-4", target: "q-sub-basc", sourceHandle: "true" },
      { id: "e-cond4-false", source: "cond-4", target: "cond-5", sourceHandle: "false" },
      { id: "e-cond5-true", source: "cond-5", target: "q-sub-auditorias", sourceHandle: "true" },
      { id: "e-cond5-false", source: "cond-5", target: "cond-6", sourceHandle: "false" },
      { id: "e-cond6-true", source: "cond-6", target: "q-sub-capacitaciones", sourceHandle: "true" },
      { id: "e-cond6-false", source: "cond-6", target: "msg-transfer-7", sourceHandle: "false" },

      { id: "e-sub-sgsst-transfer", source: "q-sub-sgsst", target: "msg-transfer-1-6" },
      { id: "e-sub-pesv-transfer", source: "q-sub-pesv", target: "msg-transfer-1-6" },
      { id: "e-sub-sarlaft-transfer", source: "q-sub-sarlaft", target: "msg-transfer-1-6" },
      { id: "e-sub-basc-transfer", source: "q-sub-basc", target: "msg-transfer-1-6" },
      { id: "e-sub-auditorias-transfer", source: "q-sub-auditorias", target: "msg-transfer-1-6" },
      { id: "e-sub-capacitaciones-transfer", source: "q-sub-capacitaciones", target: "msg-transfer-1-6" },

      { id: "e-transfer16-act", source: "msg-transfer-1-6", target: "act-transferir-soporte" },
      { id: "e-transfer7-act", source: "msg-transfer-7", target: "act-transferir-soporte" },
      { id: "e-act-end", source: "act-transferir-soporte", target: "end-transferido" },
    ],
    variables: [
      { key: "servicio", label: "Servicio", type: "string" },
      { key: "necesidad", label: "Necesidad", type: "string" },
    ],
  };
}
