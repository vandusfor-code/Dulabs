import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { descifrarSecreto } from "@/lib/crypto";
import { clasificarFalloIA, registrarFalloIA } from "@/lib/alertas";
import { construirMensajesConHistorial, type MensajeHistorialIA } from "@/lib/historial-conversacion";
import {
  especialistaPorServicio,
  especialistaPorId,
  crearCitaEspecialista,
  confirmarCita,
  categoriaDeServicio,
  especialistasPorCategoria,
  crearCitaEnCategoria,
  citasDelDiaEnCategoria,
  hayHuecoLibreEseDia,
  propuestaPendientePara,
  aceptarPropuesta,
  rechazarPropuesta,
  citaActivaPara,
  cancelarCita,
} from "@/lib/especialistas";
import {
  notificarNuevaSolicitud,
  notificarCitaAutoConfirmada,
  notificarCitaCanceladaPorClienta,
  formatearFechaHora,
} from "@/lib/especialistas-notificar";
import { nombreConocido, recordarNombreCliente } from "@/lib/clientes-conocidos";
import { interpretarNombreWhatsapp } from "@/lib/nombre-whatsapp";
import { enviarWhatsApp as enviarTextoDirecto, enviarBotonesWhatsApp } from "@/lib/whatsapp-outbound";
import type { ClienteConfig } from "@/lib/supabase";
import type { Especialista, CitaEspecialista } from "@/lib/especialistas";

const MODELO = "claude-sonnet-5";

// Red de seguridad real (ver huboResultadoRealDeAgendaEsteTurno más abajo):
// frases que suenan a "tu cita ya quedó". Si el texto final del modelo trae
// alguna de estas SIN que ninguna herramienta de agenda haya devuelto un
// resultado real en ese mismo turno, no se envía tal cual -- es exactamente
// el patrón del hallazgo real del 2026-08-27 (confirmó una hora que la
// propia herramienta acababa de reportar ocupada, sin volver a consultarla).
// A propósito solo frases con una señal fuerte de "esto acaba de pasar
// ahora mismo" (ya, listo, acabo de) -- NO frases genéricas como "confirmada
// para" o "queda confirmada" sueltas, que también son la forma normal de
// responder "¿a qué hora era mi cita?" sobre una cita YA existente de antes
// (ver "--- Cita existente ---" más abajo) sin haber llamado ninguna
// herramienta en ese turno -- esas SÍ son respuestas legítimas y no deben
// bloquearse.
const FRASES_CONFIRMACION_CITA = [
  "ya quedo",
  "ya te la deje",
  "ya la deje",
  "ya lo deje",
  "quedo agendad",
  "ya esta agendad",
  "listo, quedo",
  "te la acabo de agendar",
  "te la deje agendad",
];

function normalizarParaComparar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function pareceConfirmarCitaEnTexto(texto: string): boolean {
  const n = normalizarParaComparar(texto);
  return FRASES_CONFIRMACION_CITA.some((frase) => n.includes(frase));
}

// Nicol (pestañas) también trabaja por fuera del spa -- su disponibilidad
// real solo se puede ofrecer después de las 3pm entre semana, y desde la
// mañana los sábados (domingo el spa no abre). Regla específica de este
// negocio, no una configuración general de horarios por especialista.
function pestanasDisponible(inicio: Date): boolean {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(inicio);
  const dia = partes.find((p) => p.type === "weekday")?.value;
  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? "0");
  if (dia === "Sun") return false;
  if (dia === "Sat") return true;
  return hora >= 15;
}

// Daniela solo atiende MANOS en las tardes, desde las 2:00 pm entre semana
// -- sin este chequeo, la categoría compartida "manos" podía asignarle una
// cita de la mañana con tal de que su agenda estuviera vacía a esa hora, sin
// importar que ella no trabaje mañanas (bug real en producción, 2026-08-26:
// una clienta pidió cita con Carla, Carla tenía un choque real, y el sistema
// terminó reservando con Daniela en la mañana en su lugar).
// Los SÁBADOS es distinto: ella misma confirmó (formulario de configuración,
// 2026-08-26) que sí trabaja desde las 9:00 am ese día, no solo desde las 2pm.
function danielaDisponible(inicio: Date): boolean {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(inicio);
  const dia = partes.find((p) => p.type === "weekday")?.value;
  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? "0");
  if (dia === "Sun") return false;
  if (dia === "Sat") return hora >= 9;
  return hora >= 14;
}

// Igual que generarRespuestaIA (lib/ia.ts), pero con UNA herramienta real:
// crear una solicitud de cita para un servicio que tiene especialista propia
// con agenda (ej. pestañas -> Nicol). El resto de servicios del negocio
// (uñas, cejas...) el modelo los sigue tratando en texto libre, como
// siempre -- esta herramienta solo existe para los servicios que de verdad
// tienen un calendario real detrás.
//
// El modelo NUNCA confirma la cita por su cuenta: la herramienta hace el
// intento de reserva atómico (ver lib/especialistas.ts, constraint EXCLUDE)
// y le devuelve el resultado real. Si el horario ya está ocupado, el modelo
// se entera por la propia herramienta -- no puede inventarse disponibilidad.
export async function generarRespuestaConEspecialistaIA(params: {
  supabase: SupabaseClient;
  cliente: ClienteConfig;
  systemPromptBase: string;
  textoUsuario: string;
  telefonoRemitente: string;
  // Nombre de perfil crudo que llega de Meta (contacts[].profile.name) --
  // solo una pista, nunca un nombre confirmado (ver interpretarNombreWhatsapp).
  nombrePerfilWhatsapp?: string | null;
  historial?: MensajeHistorialIA[];
}): Promise<string | null> {
  const apiKey = params.cliente.api_key_ia ? descifrarSecreto(params.cliente.api_key_ia) : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    await registrarFalloIA({
      tipo: "sin_key",
      mensaje: "No hay api_key_ia del tenant ni ANTHROPIC_API_KEY en el servidor",
      idTenant: params.cliente.id_tenant,
      phoneNumberId: params.cliente.phone_number_id,
      nombreNegocio: params.cliente.nombre_negocio,
    });
    return null;
  }

  const anthropic = new Anthropic({ apiKey });
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" }); // YYYY-MM-DD

  // Si esta clienta tiene un horario propuesto esperando respuesta, su
  // próximo mensaje probablemente es un sí/no a eso -- no una solicitud
  // nueva. Se lo decimos al modelo explícitamente en vez de esperar que lo
  // adivine del historial.
  const propuesta = await propuestaPendientePara(params.supabase, params.cliente.phone_number_id, params.telefonoRemitente);

  // Si NO hay una propuesta esperando respuesta, revisamos si la clienta ya
  // tiene una cita activa (pendiente o confirmada) -- así puede pedir
  // cambiarle la hora o cancelarla sin repetir servicio y fecha. Si hay
  // propuesta pendiente, priorizamos esa (ver más abajo): su próximo mensaje
  // es más probablemente la respuesta a eso.
  const citaActiva = propuesta ? null : await citaActivaPara(params.supabase, params.cliente.phone_number_id, params.telefonoRemitente);

  // Nombre que la clienta dio de verdad en una cita anterior (no el de
  // perfil de WhatsApp, que no es confiable) -- si existe, se le puede
  // hablar por su nombre aunque esta conversación empiece días después,
  // fuera de la ventana de 24h que cubre el historial reciente del chat.
  const nombreYaConocido = await nombreConocido(params.supabase, params.cliente.phone_number_id, params.telefonoRemitente);

  // true cuando una herramienta ya mandó el mensaje final por su cuenta
  // (botones, traspaso a Daniela) -- la función corta el ciclo y devuelve
  // null, para que el llamador no mande nada más encima de lo ya enviado.
  let terminarConversacionAhora = false;

  // Red de seguridad real (no solo una instrucción de texto): hallazgo del
  // 2026-08-27 -- el modelo llegó a decirle a una clienta "ya quedó" agendada
  // a una hora que la MISMA herramienta acababa de reportar ocupada dos
  // mensajes antes, sin volver a llamar la herramienta en ese turno. Confiar
  // en que el prompt por sí solo evite esto ya se intentó y no fue
  // suficiente -- esto lo bloquea a nivel de código. true SOLO cuando una
  // herramienta de agenda devolvió de verdad un resultado (éxito o fallo)
  // EN ESTE MISMO turno -- se revisa antes de dejar salir cualquier texto
  // final que suene a confirmación.
  let huboResultadoRealDeAgendaEsteTurno = false;

  const tools: Anthropic.Tool[] = [
    {
      name: "crear_solicitud_cita",
      description:
        "Agenda la cita para un servicio con agenda real -- queda CONFIRMADA de una vez, no necesita aprobación de nadie. Solo llamar cuando ya tengas servicio, fecha, hora y nombre confirmados por la clienta. Si el horario pedido está ocupado, la herramienta te devuelve los horarios ya tomados ese día para que le propongas a la clienta uno libre.",
      input_schema: {
        type: "object",
        properties: {
          servicio: { type: "string", description: "Nombre del servicio, ej. 'pestañas'" },
          fecha: { type: "string", description: "Fecha en formato YYYY-MM-DD" },
          hora: { type: "string", description: "Hora en formato HH:MM (24h)" },
          nombre_cliente: { type: "string", description: "Nombre de la clienta" },
          duracion_min: {
            type: "number",
            description:
              "Duración estimada en minutos según lo que diga la información del negocio para ese servicio (ej. 180 para algo que toma 3 horas). Si no tienes esa información, omite este campo.",
          },
        },
        required: ["servicio", "fecha", "hora", "nombre_cliente"],
      },
    },
    {
      name: "derivar_a_daniela_por_producto",
      description:
        "Usar cuando la clienta muestra interés en comprar un PRODUCTO del spa (no un servicio que se agenda, como uñas/pestañas/cejas). Aplica sin importar en qué momento de la conversación pase -- desde el saludo inicial, o después de haber hablado de otra cosa. Envía el mensaje de traspaso y pausa la IA para esta clienta; Daniela responde personalmente desde su celular. Después de llamarla no hace falta escribir nada más, ella ya se encarga del mensaje.",
      input_schema: {
        type: "object",
        properties: {
          mensaje: {
            type: "string",
            description:
              "Mensaje corto y cálido avisando que Daniela responde personalmente en un momento (ej. \"¡Claro que sí, cariño! En un momento Dani te responde 💛\"). Si lo omites, se usa un mensaje por defecto.",
          },
        },
      },
    },
  ];

  // Saludo con botones (Servicio de Spa / Productos) SOLO al inicio de una
  // conversación nueva -- si ya hay historial, no tiene sentido repetirlo.
  const esPrimerMensaje = (params.historial?.length ?? 0) === 0;
  if (esPrimerMensaje) {
    tools.push({
      name: "mostrar_opciones_saludo",
      description:
        "Envía el saludo de bienvenida al inicio de una conversación NUEVA, seguido de dos botones reales de WhatsApp para que la clienta elija entre 'Servicio de Spa' o 'Productos'. Llamar UNA sola vez, como parte del primer saludo (nunca a mitad de conversación). Esta herramienta ya envía todo -- no escribas ningún mensaje de texto aparte en el mismo turno.",
      input_schema: {
        type: "object",
        properties: {
          mensaje_bienvenida: {
            type: "string",
            description:
              "El primer mensaje de bienvenida (ej. \"¡Hola! Bienvenida, Laura 🥰💕 ¿Cómo estás?\"), siguiendo las reglas de SALUDOS de tus instrucciones.",
          },
        },
        required: ["mensaje_bienvenida"],
      },
    });
  }

  let systemFinal =
    `${params.systemPromptBase}\n\n` +
    `--- Agenda real ---\n` +
    `Hoy es ${hoy} (hora de Colombia). Para el servicio con agenda propia (ver la herramienta disponible) SÍ tienes una forma real de agendar la cita: usa crear_solicitud_cita solo cuando ya tengas confirmados por la clienta el servicio, la fecha, la hora y el nombre. No la llames antes de tener los cuatro datos completos.\n` +
    `La respuesta trae "estado": "confirmada" (dile a la clienta que quedó agendada, ya sin nada más que hacer) o "pendiente" (dile que quedó como solicitud y que le confirman por este mismo chat en un rato -- NUNCA digas "confirmada" ni "agendada" si el estado es pendiente). No asumas cuál va a ser, revisa siempre lo que te devuelve la herramienta.\n` +
    `La respuesta también trae "con": el nombre de quién REALMENTE va a atender la cita. Si la clienta pidió a alguien en particular pero el servicio se manejaba entre varias personas (manos o pies) y no era esa persona exclusiva, puede que "con" no sea la persona que ella pidió -- en ese caso, díselo con naturalidad en la misma confirmación ("te la dejé con Carla que tenía espacio a esa hora, ¿te sirve?"), nunca digas el nombre de quien ella pidió si la herramienta te devolvió otro nombre distinto.\n` +
    `Si la herramienta te dice que el horario está ocupado, te va a devolver los horarios que ya están tomados ese día (horarios_tomados, ya en hora de Colombia). Mira esa lista, calcula tú misma 1 o 2 huecos libres dentro del horario de atención del negocio, y ofréceselos a la clienta en tu respuesta de texto ("tengo espacio a las X o a las Y, ¿cuál te queda mejor?") -- NO vuelvas a llamar la herramienta para "probar" otro horario a ciegas, eso ya lo sabes por la lista que te devolvió. Nunca inventes ni asumas disponibilidad que la herramienta no te confirmó.\n` +
    `Para cualquier OTRO servicio que no tenga esa herramienta, sigues funcionando igual que siempre: solo tomas nota de la solicitud en texto, sin agenda real todavía.\n\n` +
    `--- Regla innegociable: nunca inventes una confirmación ---\n` +
    `NUNCA le digas a la clienta que su cita "ya quedó", "quedó confirmada" o "quedó agendada" a menos que hayas llamado crear_solicitud_cita o cambiar_hora_mi_cita EN ESTE MISMO mensaje y la herramienta te haya devuelto success:true. No repitas ni dediques de un turno anterior si en este turno no volviste a llamar la herramienta -- la disponibilidad pudo cambiar. Si la clienta manda un sticker, un emoji suelto, una nota de voz o cualquier cosa que no sea texto claro como respuesta a una pregunta de horario, NO lo interpretes como un "sí" a nada -- pídele con cariño que te confirme por escrito el servicio, el día y la hora exactos en un solo mensaje, y espera esa respuesta antes de llamar la herramienta.\n\n` +
    `--- Productos y saludo con botones ---\n` +
    `El spa también vende productos, aparte de los servicios que se agendan. Si en cualquier momento la clienta muestra interés en un PRODUCTO (comprarlo, preguntarle el precio para llevar, etc.) y no en un servicio agendable, usa derivar_a_daniela_por_producto -- sin importar si pasa en el saludo inicial o después de ya haber hablado de una cita. Esa herramienta ya manda el mensaje; no le sigas escribiendo nada más después de llamarla. Si más adelante en el MISMO chat vuelve a tocar ese mismo producto antes de que Daniela responda, no llames la herramienta otra vez ni repitas el mensaje completo -- solo dile brevemente que Daniela ya le va a responder. Esto NO te bloquea para nada más: si en cualquier momento pide agendar un SERVICIO, ayúdala con toda normalidad, sin que lo del producto se lo impida.` +
    (esPrimerMensaje
      ? `\nComo esta es una conversación NUEVA, tu saludo va con mostrar_opciones_saludo (mensaje de bienvenida + botones "Servicio de Spa"/"Productos") en vez del saludo de texto normal en dos mensajes. Si la clienta escribe algo que ya deja claro qué quiere en su primer mensaje (ej. ya pide una cita puntual), igual saluda primero con esta herramienta antes de avanzar -- no te saltes el saludo.`
      : "");

  // Prioridad del nombre: 1) lo que la clienta confirme explícitamente en
  // este chat, 2) el que ya quedó guardado y confirmado de una cita
  // anterior, 3) una suposición razonable sacada del perfil de WhatsApp
  // (nunca se usa para agendar sin que ella la confirme primero), 4)
  // ninguno -- nunca se inventa un nombre.
  const nombreInterpretado = nombreYaConocido ? null : interpretarNombreWhatsapp(params.nombrePerfilWhatsapp);

  if (nombreYaConocido) {
    systemFinal +=
      `\n\n--- Nombre conocido ---\n` +
      `Esta clienta ya se llamó "${nombreYaConocido}" en una cita anterior confirmada. Puedes saludarla y hablarle por ese nombre con naturalidad (no en cada mensaje), sin necesidad de volver a confirmarlo.`;
  } else if (nombreInterpretado) {
    systemFinal +=
      `\n\n--- Posible nombre (sin confirmar) ---\n` +
      `Por el perfil de WhatsApp, esta clienta podría llamarse "${nombreInterpretado}" -- es solo una suposición. No le preguntes de entrada "¿cómo te llamas?"; puedes usarlo con naturalidad si ayuda en la conversación, pero ANTES de dejar una cita registrada con crear_solicitud_cita, confírmalo primero con algo como: "Antes de dejarla agendada, solo quiero confirmar un detallito: ¿la cita es para ti, ${nombreInterpretado}? 💕". Si dice que sí, usa "${nombreInterpretado}" como nombre_cliente. Si dice que no o que es para otra persona, pregúntale el nombre correcto y usa ese en su lugar -- nunca asumas que el nombre supuesto es el correcto.`;
  } else {
    systemFinal +=
      `\n\n--- Sin nombre confiable ---\n` +
      `No tienes ningún nombre confiable de esta clienta todavía. No se lo preguntes de entrada -- conversa normal, y cuando llegue el momento de dejar una cita registrada, pídeselo ahí: "Para dejar tu cita registrada, ¿me compartes tu nombre, por favor? 🥰".`;
  }

  if (propuesta) {
    tools.push(
      {
        name: "aceptar_propuesta_horario",
        description: "La clienta acepta el nuevo horario que la especialista le propuso. Llamar sin argumentos.",
        input_schema: { type: "object", properties: {} },
      },
      {
        name: "rechazar_propuesta_horario",
        description:
          "La clienta NO acepta el horario propuesto y quiere otro. Llamar sin argumentos -- después ayúdala a buscar un nuevo horario con crear_solicitud_cita.",
        input_schema: { type: "object", properties: {} },
      }
    );
    systemFinal +=
      `\n\n--- Propuesta de horario pendiente ---\n` +
      `Le propusiste a esta clienta ${propuesta.servicio} el ${formatearFechaHora(propuesta.inicio)}, y está esperando que responda si le sirve. ` +
      `Interpreta su próximo mensaje como esa respuesta: si acepta (sí, dale, listo, me sirve, etc.) usa aceptar_propuesta_horario. Si no acepta o pide otro horario, usa rechazar_propuesta_horario, y luego ayúdala a encontrar uno nuevo con crear_solicitud_cita como de costumbre.`;
  } else if (citaActiva) {
    tools.push(
      {
        name: "cambiar_hora_mi_cita",
        description:
          "Cambia la fecha/hora de la cita que la clienta ya tiene agendada, a una nueva -- si está libre, queda CONFIRMADA de una vez, no necesita aprobación. Solo llamar cuando ya tengas la nueva fecha y hora confirmadas por la clienta. Si el nuevo horario está ocupado, te devuelve los horarios tomados ese día para proponer alternativas.",
        input_schema: {
          type: "object",
          properties: {
            fecha: { type: "string", description: "Nueva fecha en formato YYYY-MM-DD" },
            hora: { type: "string", description: "Nueva hora en formato HH:MM (24h)" },
          },
          required: ["fecha", "hora"],
        },
      },
      {
        name: "cancelar_mi_cita",
        description:
          "Cancela DEFINITIVAMENTE la cita que la clienta ya tiene agendada. NUNCA la llames en el mismo mensaje en que la clienta pide cancelar por primera vez -- antes debes preguntarle el motivo con cariño y ofrecerle reagendar en vez de cancelar. Pasa confirmado=true SOLO si, después de eso, la clienta insiste en que sí quiere cancelar.",
        input_schema: {
          type: "object",
          properties: {
            confirmado: {
              type: "boolean",
              description:
                "true únicamente si ya le preguntaste el motivo, le ofreciste reagendar, y aun así insiste en cancelar. Si es la primera vez que lo pide, NO llames esta herramienta todavía -- solo responde preguntándole.",
            },
          },
          required: ["confirmado"],
        },
      }
    );
    systemFinal +=
      `\n\n--- Cita existente ---\n` +
      `Esta clienta ya tiene una cita confirmada de ${citaActiva.servicio} el ${formatearFechaHora(citaActiva.inicio)}. ` +
      `Si te pregunta por su cita, dile esa fecha y hora. Si pide cambiar la hora, usa cambiar_hora_mi_cita en cuanto tengas la nueva fecha/hora.\n` +
      `Si dice que quiere CANCELAR, la primera vez NO llames cancelar_mi_cita todavía (ni siquiera con confirmado=false) -- solo respóndele: reacciona con cariño (algo como "Ay no 😢 ¿pasó algo?"), pregúntale el motivo, y pregúntale si prefiere que le ayudes a reagendarla para otro día en vez de perderla del todo. Solo si después de eso insiste en que sí quiere cancelar, ahí sí llama cancelar_mi_cita con confirmado=true. Si en cambio prefiere otro horario, ayúdala con cambiar_hora_mi_cita.`;
  } else {
    systemFinal +=
      `\n\n--- Sin cita registrada ---\n` +
      `No hay ninguna cita en el sistema a nombre de este número. Si la clienta dice que ya tenía una cita agendada de antes (por ejemplo, la agendó por llamada, Instagram o en persona, antes de que existiera este sistema), no le digas que no existe ni la hagas dudar: pídele el servicio, la fecha y la hora que recuerda, y regístrala igual que una solicitud nueva con crear_solicitud_cita.`;
  }

  // Cierra el paso: guarda el nombre, y confirma sola o avisa a la
  // especialista según requiera_aprobacion -- pestañas (Nicol) siempre pide
  // aprobación manual porque su disponibilidad real no la sabe el sistema
  // (también trabaja por fuera); manos/pies confirman solas.
  async function finalizarCitaCreada(especialista: Especialista, cita: CitaEspecialista): Promise<string> {
    if (cita.telefono_cliente) {
      await recordarNombreCliente(params.supabase, {
        idTenant: especialista.id_tenant,
        phoneNumberId: especialista.phone_number_id,
        telefonoCliente: cita.telefono_cliente,
        nombre: cita.nombre_cliente,
      });
    }
    if (especialista.requiere_aprobacion) {
      await notificarNuevaSolicitud(params.cliente, especialista, cita);
      return JSON.stringify({ success: true, estado: "pendiente", con: especialista.nombre });
    }
    const confirmada = (await confirmarCita(params.supabase, cita.id)) ?? cita;
    await notificarCitaAutoConfirmada(params.cliente, especialista, confirmada);
    return JSON.stringify({ success: true, estado: "confirmada", con: especialista.nombre });
  }

  async function ejecutarHerramientaConNombre(nombre: string, input: Record<string, unknown>): Promise<string> {
    // Cualquier herramienta que de verdad toca la agenda cuenta como
    // "consultó la realidad en este turno" -- ver huboResultadoRealDeAgendaEsteTurno
    // arriba. Se marca ANTES de ejecutar, no solo en el camino feliz: incluso
    // un resultado de error es un resultado real que el modelo ya tiene en
    // sus manos antes de escribir su respuesta final.
    if (
      nombre === "crear_solicitud_cita" ||
      nombre === "cambiar_hora_mi_cita" ||
      nombre === "aceptar_propuesta_horario" ||
      nombre === "rechazar_propuesta_horario" ||
      nombre === "cancelar_mi_cita"
    ) {
      huboResultadoRealDeAgendaEsteTurno = true;
    }
    if (nombre === "aceptar_propuesta_horario") {
      if (!propuesta) return JSON.stringify({ success: false, error: "No hay ninguna propuesta pendiente." });
      const cita = await aceptarPropuesta(params.supabase, propuesta.id);
      return JSON.stringify(cita ? { success: true } : { success: false, error: "Esa propuesta ya no está disponible." });
    }
    if (nombre === "rechazar_propuesta_horario") {
      if (!propuesta) return JSON.stringify({ success: false, error: "No hay ninguna propuesta pendiente." });
      const cita = await rechazarPropuesta(params.supabase, propuesta.id);
      return JSON.stringify(cita ? { success: true } : { success: false, error: "Esa propuesta ya no está disponible." });
    }
    if (nombre === "cancelar_mi_cita") {
      if (!citaActiva) return JSON.stringify({ success: false, error: "No tiene ninguna cita activa." });
      // Candado real, no solo una instrucción de texto: sin confirmado=true
      // no se cancela nada, sin importar qué tan segura suene la clienta en
      // el primer mensaje -- obliga a pasar por la pregunta del motivo.
      if (input.confirmado !== true) {
        return JSON.stringify({
          success: false,
          error: "Todavía no canceles. Primero pregúntale con cariño el motivo y ofrécele reagendar en vez de cancelar. Solo si insiste, vuelve a llamar esta herramienta con confirmado=true.",
        });
      }
      const cita = await cancelarCita(params.supabase, citaActiva.id, "La clienta canceló por WhatsApp");
      if (!cita) return JSON.stringify({ success: false, error: "Esa cita ya no se puede cancelar." });
      const especialista = await especialistaPorId(params.supabase, citaActiva.especialista_id);
      if (especialista) await notificarCitaCanceladaPorClienta(params.cliente, especialista, cita);
      return JSON.stringify({ success: true });
    }
    if (nombre === "cambiar_hora_mi_cita") {
      if (!citaActiva) return JSON.stringify({ success: false, error: "No tiene ninguna cita activa." });
      const especialista = await especialistaPorId(params.supabase, citaActiva.especialista_id);
      if (!especialista) return JSON.stringify({ success: false, error: "No se pudo procesar el cambio." });

      const fecha = String(input.fecha ?? "");
      const hora = String(input.hora ?? "");
      const nuevoInicio = new Date(`${fecha}T${hora}:00-05:00`);
      if (Number.isNaN(nuevoInicio.getTime())) return JSON.stringify({ success: false, error: "Fecha u hora inválida." });

      const resultado = await crearCitaEspecialista(params.supabase, {
        especialistaId: especialista.id,
        idTenant: especialista.id_tenant,
        phoneNumberId: especialista.phone_number_id,
        telefonoCliente: params.telefonoRemitente,
        nombreCliente: citaActiva.nombre_cliente,
        servicio: citaActiva.servicio,
        inicio: nuevoInicio,
        duracionMin: especialista.duracion_min,
        bloqueaHorario: especialista.bloquea_horario,
        origen: "whatsapp_ia",
      });
      if (!resultado.ok) {
        if (resultado.motivo === "ocupado") {
          const ocupados = await citasDelDiaEnCategoria(params.supabase, [especialista], fecha);
          return JSON.stringify({ success: false, ocupado: true, horarios_tomados: ocupados });
        }
        return JSON.stringify({ success: false, error: "No se pudo cambiar el horario, intenta de nuevo." });
      }
      // Solo se cancela la cita anterior si la nueva quedó creada -- si el
      // horario pedido estaba ocupado, la clienta conserva su cita original.
      await cancelarCita(params.supabase, citaActiva.id, "Cambiada a un nuevo horario");
      return finalizarCitaCreada(especialista, resultado.cita);
    }
    if (nombre === "mostrar_opciones_saludo") {
      const mensajeBienvenida = String(input.mensaje_bienvenida ?? "").trim();
      if (mensajeBienvenida) {
        await enviarTextoDirecto(params.supabase, params.cliente, params.telefonoRemitente, mensajeBienvenida);
      }
      await enviarBotonesWhatsApp(params.supabase, params.cliente, params.telefonoRemitente, "¿En qué estás interesada?", [
        { id: "opcion_spa", titulo: "Servicio de Spa" },
        { id: "opcion_productos", titulo: "Productos" },
      ]);
      terminarConversacionAhora = true;
      return JSON.stringify({ success: true });
    }
    if (nombre === "derivar_a_daniela_por_producto") {
      const mensaje =
        typeof input.mensaje === "string" && input.mensaje.trim()
          ? input.mensaje.trim()
          : "¡Claro que sí, cariño! En un momento Dani te responde 💛";
      await enviarTextoDirecto(params.supabase, params.cliente, params.telefonoRemitente, mensaje);
      // Sin pausa de chat completo a propósito: si la clienta después pide un
      // SERVICIO (una cita), el bot debe poder ayudarle con normalidad -- lo
      // único que se evita es que la IA insista en el tema del producto.
      terminarConversacionAhora = true;
      return JSON.stringify({ success: true });
    }
    return ejecutarHerramienta(input);
  }

  async function ejecutarHerramienta(input: Record<string, unknown>): Promise<string> {
    const servicio = String(input.servicio ?? "");
    const fecha = String(input.fecha ?? "");
    const hora = String(input.hora ?? "");
    const inicio = new Date(`${fecha}T${hora}:00-05:00`);
    if (Number.isNaN(inicio.getTime())) {
      return JSON.stringify({ success: false, error: "Fecha u hora inválida." });
    }
    const nombreCliente = String(input.nombre_cliente ?? "Clienta");

    // Primero se busca una especialidad PROPIA y exclusiva (ej. pestañas ->
    // Nicol/Daniela, un solo recurso, un solo horario). Si el servicio
    // pedido no calza con ninguna, cae a la categoría compartida (manos:
    // Daniela y Carla / pies: Kelly) -- varias personas intercambiables,
    // se agenda con la primera que esté libre.
    const especialistaExclusiva = await especialistaPorServicio(params.supabase, params.cliente.phone_number_id, servicio);

    if (especialistaExclusiva) {
      if (especialistaExclusiva.servicio.toLowerCase() === "pestañas" && !pestanasDisponible(inicio)) {
        return JSON.stringify({
          success: false,
          error: "Nicol solo tiene disponibilidad para pestañas después de las 3:00 pm entre semana, o desde la mañana los sábados (domingo el spa no abre). Pídele a la clienta un horario dentro de ese rango.",
        });
      }
      const duracionMin =
        typeof input.duracion_min === "number" && input.duracion_min > 0 ? input.duracion_min : especialistaExclusiva.duracion_min;
      const resultado = await crearCitaEspecialista(params.supabase, {
        especialistaId: especialistaExclusiva.id,
        idTenant: especialistaExclusiva.id_tenant,
        phoneNumberId: especialistaExclusiva.phone_number_id,
        telefonoCliente: params.telefonoRemitente,
        nombreCliente,
        servicio,
        inicio,
        duracionMin,
        bloqueaHorario: especialistaExclusiva.bloquea_horario,
        origen: "whatsapp_ia",
      });
      if (!resultado.ok) {
        if (resultado.motivo === "ocupado") {
          const ocupados = await citasDelDiaEnCategoria(params.supabase, [especialistaExclusiva], fecha);
          return JSON.stringify({ success: false, ocupado: true, horarios_tomados: ocupados });
        }
        return JSON.stringify({ success: false, error: "No se pudo agendar, intenta de nuevo." });
      }
      return finalizarCitaCreada(especialistaExclusiva as Especialista, resultado.cita);
    }

    const categoria = categoriaDeServicio(servicio);
    let candidatas = await especialistasPorCategoria(params.supabase, params.cliente.phone_number_id, categoria);
    // Regla propia de este negocio (formulario de configuración, 2026-08-26):
    // para MANOS, Carla es la fija -- solo se desborda a Daniela si Carla no
    // tiene ningún hueco libre ese día completo (mismo patrón que pies con
    // Kelly/Carla más abajo). Por eso Daniela NUNCA es candidata en el primer
    // intento; solo se prueba con ella en la rama "ocupado" si de verdad
    // aplica, y siempre respetando su ventana real (ver danielaDisponible).
    if (categoria === "manos") {
      candidatas = candidatas.filter((e) => e.nombre.toLowerCase() !== "daniela");
    }
    if (candidatas.length === 0) {
      return JSON.stringify({ success: false, error: `No manejamos "${servicio}" con agenda propia todavía.` });
    }

    const duracionMin =
      typeof input.duracion_min === "number" && input.duracion_min > 0 ? input.duracion_min : candidatas[0].duracion_min;

    const resultado = await crearCitaEnCategoria(params.supabase, candidatas, {
      telefonoCliente: params.telefonoRemitente,
      nombreCliente,
      servicio,
      inicio,
      duracionMin,
      origen: "whatsapp_ia",
    });

    if (!resultado.ok) {
      if (resultado.motivo === "ocupado") {
        // Regla propia de este negocio (la definió la dueña, 2026-08-26):
        // para PIES, Kelly es la fija -- solo se desborda a Carla si Kelly
        // NO tiene ningún hueco libre ese día completo, no solo a la hora
        // pedida. Nunca se ofrece a Carla mientras Kelly tenga espacio en
        // algún otro momento del día.
        if (categoria === "pies") {
          const kelly = candidatas.find((e) => e.nombre.toLowerCase() === "kelly") ?? candidatas[0];
          const kellyTieneHueco = await hayHuecoLibreEseDia(params.supabase, kelly, fecha, duracionMin);
          if (!kellyTieneHueco) {
            const candidatasManos = await especialistasPorCategoria(params.supabase, params.cliente.phone_number_id, "manos");
            const carla = candidatasManos.find((e) => e.nombre.toLowerCase() === "carla");
            if (carla) {
              const resultadoCarla = await crearCitaEnCategoria(params.supabase, [carla], {
                telefonoCliente: params.telefonoRemitente,
                nombreCliente,
                servicio,
                inicio,
                duracionMin,
                origen: "whatsapp_ia",
              });
              if (resultadoCarla.ok) return finalizarCitaCreada(resultadoCarla.especialista, resultadoCarla.cita);
            }
          }
        }
        // Mismo patrón para MANOS: Carla es la fija, Daniela solo entra si
        // Carla no tiene ningún hueco libre ese día completo Y el horario
        // pedido cae dentro de la ventana real de Daniela.
        if (categoria === "manos") {
          const carla = candidatas.find((e) => e.nombre.toLowerCase() === "carla") ?? candidatas[0];
          const carlaTieneHueco = await hayHuecoLibreEseDia(params.supabase, carla, fecha, duracionMin);
          if (!carlaTieneHueco && danielaDisponible(inicio)) {
            const candidatasTodasManos = await especialistasPorCategoria(params.supabase, params.cliente.phone_number_id, "manos");
            const daniela = candidatasTodasManos.find((e) => e.nombre.toLowerCase() === "daniela");
            if (daniela) {
              const resultadoDaniela = await crearCitaEnCategoria(params.supabase, [daniela], {
                telefonoCliente: params.telefonoRemitente,
                nombreCliente,
                servicio,
                inicio,
                duracionMin,
                origen: "whatsapp_ia",
              });
              if (resultadoDaniela.ok) return finalizarCitaCreada(resultadoDaniela.especialista, resultadoDaniela.cita);
            }
          }
        }
        const ocupados = await citasDelDiaEnCategoria(params.supabase, candidatas, fecha);
        return JSON.stringify({ success: false, ocupado: true, horarios_tomados: ocupados });
      }
      return JSON.stringify({ success: false, error: "No se pudo agendar, intenta de nuevo." });
    }

    return finalizarCitaCreada(resultado.especialista, resultado.cita);
  }

  // Red de seguridad: la clienta NUNCA debe quedarse sin respuesta. Antes,
  // si la IA se quedaba sin turnos de herramienta (o devolvía texto vacío),
  // la función devolvía null y el webhook simplemente no mandaba nada --
  // silencio total, sin ningún aviso ni para la clienta ni para el negocio.
  // Ahora en cualquiera de esos dos casos se manda este mensaje de
  // respaldo y se alerta al dueño (registrarFalloIA, con su propio
  // deduplicado de 6h) para que quede visible que algo falló.
  const MENSAJE_RESPALDO =
    "¡Uy, disculpa! Se me complicó un poco agendar tu cita en este momento 😅 Dame un segundo, ya te ayudo — si no te respondo enseguida, escríbeme de nuevo por aquí y seguimos.";

  async function respaldoPorFalloSilencioso(mensaje: string): Promise<string> {
    await registrarFalloIA({
      tipo: "otro",
      mensaje,
      idTenant: params.cliente.id_tenant,
      phoneNumberId: params.cliente.phone_number_id,
      nombreNegocio: params.cliente.nombre_negocio,
    });
    return MENSAJE_RESPALDO;
  }

  const messages = construirMensajesConHistorial(params.historial ?? [], params.textoUsuario);
  const MAX_TURNOS_HERRAMIENTA = 4;

  for (let turno = 0; turno < MAX_TURNOS_HERRAMIENTA; turno++) {
    let response: Anthropic.Message;
    try {
      response = await anthropic.messages.create({
        model: MODELO,
        max_tokens: 1024,
        system: [{ type: "text", text: systemFinal, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
      });
    } catch (err) {
      const { tipo, mensaje, status } = clasificarFalloIA(err);
      await registrarFalloIA({
        tipo,
        mensaje,
        status,
        idTenant: params.cliente.id_tenant,
        phoneNumberId: params.cliente.phone_number_id,
        nombreNegocio: params.cliente.nombre_negocio,
      });
      // Antes esto devolvía null (silencio total para la clienta). El dueño
      // ya queda alertado arriba con el tipo real de fallo (rate_limit,
      // sobrecarga, sin_saldo...) -- pero la clienta también necesita algo,
      // en vez de que el chat simplemente no conteste.
      return MENSAJE_RESPALDO;
    }

    const bloquesHerramienta = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (bloquesHerramienta.length === 0 || response.stop_reason !== "tool_use") {
      const texto = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (texto) {
        // Guardia real (no una instrucción de prompt más): si el texto suena
        // a "tu cita ya quedó" pero ninguna herramienta de agenda devolvió un
        // resultado real EN ESTE turno, no se envía -- se registra como
        // fallo y se le pide a la clienta que reconfirme en un solo mensaje,
        // en vez de arriesgarse a mandar una confirmación falsa.
        if (!huboResultadoRealDeAgendaEsteTurno && pareceConfirmarCitaEnTexto(texto)) {
          await registrarFalloIA({
            tipo: "otro",
            mensaje: `Posible confirmación de cita SIN respaldo de herramienta en este turno -- texto bloqueado, no se envió: "${texto.slice(0, 300)}". Mensaje de la clienta: "${params.textoUsuario.slice(0, 200)}"`,
            idTenant: params.cliente.id_tenant,
            phoneNumberId: params.cliente.phone_number_id,
            nombreNegocio: params.cliente.nombre_negocio,
          });
          return "Dame un segundito para dejarte esto bien confirmado 🙏 ¿Me repites en un solo mensaje el servicio, el día y la hora exactos que necesitas? Así te lo agendo de una sin enredos.";
        }
        return texto;
      }
      return respaldoPorFalloSilencioso(
        `La IA devolvió texto vacío (stop_reason=${response.stop_reason}) intentando agendar una cita. Mensaje de la clienta: "${params.textoUsuario.slice(0, 200)}"`
      );
    }

    messages.push({ role: "assistant", content: response.content });
    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const bloque of bloquesHerramienta) {
      const resultado = await ejecutarHerramientaConNombre(bloque.name, bloque.input as Record<string, unknown>);
      resultados.push({ type: "tool_result", tool_use_id: bloque.id, content: resultado });
    }
    // Botones de saludo o traspaso a Daniela: esas herramientas ya mandaron
    // el mensaje final por su cuenta -- no hay que pedirle a la IA otro
    // turno de texto encima (se mandaría un mensaje de más).
    if (terminarConversacionAhora) return null;
    messages.push({ role: "user", content: resultados });
  }

  return respaldoPorFalloSilencioso(
    `Se agotaron los ${MAX_TURNOS_HERRAMIENTA} turnos de herramienta sin que la IA diera una respuesta final al intentar agendar una cita. Mensaje de la clienta: "${params.textoUsuario.slice(0, 200)}"`
  );
}
