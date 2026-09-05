import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { descifrarSecreto } from "@/lib/crypto";
import { clasificarFalloIA, registrarFalloIA } from "@/lib/alertas";
import { construirMensajesConHistorial, type MensajeHistorialIA } from "@/lib/historial-conversacion";
import { citaActivaPara } from "@/lib/especialistas";
import { listarHorariosDisponiblesPorServicio } from "@/lib/disponibilidad-servicio";
import { activarPausaChat } from "@/lib/pausas-chat";
import { enviarWhatsApp, enviarBotonesWhatsApp } from "@/lib/whatsapp-outbound";
import { DANIELA_BUTTON_IDS } from "@/lib/flows/daniela-button-ids";
import { configBotPorPhoneNumberId } from "@/lib/config-bot";
import type { ClienteConfig } from "@/lib/supabase";

/**
 * Fase 7 (autorizado) — asistente conversacional de Daniela.
 *
 * Fase 8A (autorizado) — conectado al webhook real (app/webhook-dulabs/route.ts)
 * a través de atenderConAsistenteDanielaIA (al final de este archivo) y del
 * gate aislado lib/asistente-daniela-gate.ts::debeUsarAsistenteDanielaIA.
 * Piloto controlado: SOLO el número autorizado puede llegar a este código en
 * producción -- ver ese archivo para las 4 condiciones exactas.
 *
 * Arquitectura elegida (ver auditoría): NO se construyó sobre el Flow
 * Engine -- ya existe lib/flows/daniela-router.flow.ts (Flow, NO activado)
 * que resuelve un problema similar con OTRA arquitectura (grafo de nodos,
 * catálogo por texto libre/categoría, reserva completa dentro del chat).
 * Esta fase pide explícitamente herramientas pequeñas de IA con
 * tool-calling y reserva por LINK al portal -- una forma de conversar
 * genuinamente distinta, no una call de más del mismo grafo. Se deja el
 * Flow router intacto, sin tocar; cuál de los dos (o si conviven) es una
 * decisión de arquitectura para una fase futura, documentada en el informe,
 * no tomada unilateralmente acá.
 *
 * Reutilizado tal cual (cero reimplementación):
 * - obtenerHistorialConversacion/construirMensajesConHistorial (memoria).
 * - activarPausaChat / dulabs_pausas_chat (traspaso a humano).
 * - enviarWhatsApp/enviarBotonesWhatsApp (envío).
 * - citaActivaPara (cita real del cliente).
 * - listarHorariosDisponiblesPorServicio (Fase 2 -- disponibilidad real).
 * - dulabs_servicios / dulabs_servicio_especialista (Fase 1 -- catálogo real).
 */

const MODELO = "claude-sonnet-5";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://dulabs.co";

// --- Paso 5 del pedido: experiencia inicial, texto EXACTO y determinista --
// (nunca redactado por el modelo -- igual de crítico que el saludo con
// botones de LEGACY, mostrar_opciones_saludo en especialista-solicitud-ia.ts,
// pero acá el texto es fijo en vez de compuesto por la IA, por instrucción
// explícita de esta fase).
export const MENSAJE_SALUDO_1 = "👋 Hola, un gusto tenerte nuevamente por acá ❤️";
export const MENSAJE_SALUDO_2 = "¿Qué estás buscando? ❤️";

export const MENSAJE_PRODUCTOS =
  "Claro que sí 😊\nPara ayudarte con los productos, Dani te contestará para brindarte toda la información.\n\nEspera un momentito 💗";

export const MENSAJE_SERVICIOS_SPA =
  "Claro que sí, con gusto te ayudo a agendar tu próxima cita 💗\n\n¿Ya tienes pensado qué servicio te gustaría realizarte?";

export const MENSAJE_SEGUIMIENTO_SIN_RESPUESTA =
  "Te pedimos disculpas 💗 Dani se encuentra ocupada en este momento, pero apenas tenga el espacio estará respondiéndote.";

const DURACION_PAUSA_TRASPASO_MS = 24 * 60 * 60 * 1000; // mismo criterio que el traspaso ya usado (Flow: pauseDurationHours 24)
export const DURACION_SEGUIMIENTO_MS = 5 * 60 * 1000; // Paso 5 del pedido: 5 minutos

/** Envía el saludo inicial fijo -- dos mensajes + botones, NUNCA compuesto por el modelo. */
export async function enviarSaludoInicial(supabase: SupabaseClient, cliente: ClienteConfig, telefonoCliente: string): Promise<void> {
  await enviarWhatsApp(supabase, cliente, telefonoCliente, MENSAJE_SALUDO_1);
  await enviarBotonesWhatsApp(supabase, cliente, telefonoCliente, MENSAJE_SALUDO_2, [
    { id: DANIELA_BUTTON_IDS.SERVICIOS_SPA, titulo: "Servicios de Spa" },
    { id: DANIELA_BUTTON_IDS.PRODUCTOS, titulo: "Productos" },
  ]);
}

/** Botón "Productos": mensaje fijo + traspaso real (dulabs_pausas_chat) -- nunca sigue inventando respuestas sobre productos. */
export async function manejarBotonProductos(supabase: SupabaseClient, cliente: ClienteConfig, telefonoCliente: string): Promise<void> {
  await enviarWhatsApp(supabase, cliente, telefonoCliente, MENSAJE_PRODUCTOS);
  await activarPausaChat(supabase, cliente.phone_number_id, telefonoCliente, DURACION_PAUSA_TRASPASO_MS);
}

/** Botón "Servicios de Spa": mensaje fijo de apertura -- a partir de ahí, conversación con herramientas. */
export async function manejarBotonServiciosSpa(supabase: SupabaseClient, cliente: ClienteConfig, telefonoCliente: string): Promise<void> {
  await enviarWhatsApp(supabase, cliente, telefonoCliente, MENSAJE_SERVICIOS_SPA);
}

// ---------------------------------------------------------------------------
// Paso 3/4 del pedido — catálogo real. Consultas de solo lectura sobre
// dulabs_servicios/dulabs_servicio_especialista (Fase 1), SIEMPRE filtradas
// por id_tenant -- nunca se acepta un tenant que no sea el resuelto del
// contexto seguro del webhook (ver generarRespuestaAsistenteDaniela).
// ---------------------------------------------------------------------------

export type ServicioCatalogoReal = {
  id: string;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  precio: number | null;
  duracionMin: number;
};

/**
 * buscar_servicios — lista/busca servicios REALES activos del tenant. Sin
 * `texto`, devuelve el catálogo completo activo (para "¿qué servicios
 * tienen?"); con `texto`, filtra por coincidencia en nombre/categoría/
 * descripción (para "¿tienen manicure?", "algo para pies").
 */
export async function buscarServicios(
  supabase: SupabaseClient,
  params: { idTenant: string; texto?: string }
): Promise<ServicioCatalogoReal[]> {
  let query = supabase
    .from("dulabs_servicios")
    .select("id, nombre, categoria, descripcion, precio, duracion_min")
    .eq("id_tenant", params.idTenant)
    .eq("activo", true)
    .order("nombre", { ascending: true });

  const texto = params.texto?.trim();
  if (texto) {
    // Fase 8A.2 (autorizado) — bug real encontrado con el catálogo real de
    // Daniela: el patrón SIN comillas rompe el parser de filtros `.or()` de
    // PostgREST en cuanto el texto trae una coma (ej. "Cejas, depilación
    // sola", uno de sus servicios reales) -- PGRST100 "failed to parse logic
    // tree". Envolver el patrón entre comillas dobles (escapando comillas
    // dobles literales) es la sintaxis que PostgREST espera para valores con
    // caracteres especiales dentro de `.or()`.
    const patron = `"%${texto.replace(/"/g, '\\"')}%"`;
    query = query.or(`nombre.ilike.${patron},categoria.ilike.${patron},descripcion.ilike.${patron}`);
  }

  const { data, error } = await query;
  if (error) {
    console.error(`[asistente-daniela] buscarServicios falló (id_tenant=${params.idTenant}, texto=${JSON.stringify(params.texto)}):`, error.message);
  }
  return ((data ?? []) as { id: string; nombre: string; categoria: string | null; descripcion: string | null; precio: number | null; duracion_min: number }[]).map(
    (s) => ({ id: s.id, nombre: s.nombre, categoria: s.categoria, descripcion: s.descripcion, precio: s.precio, duracionMin: s.duracion_min })
  );
}

/**
 * consultar_servicio — resuelve UN servicio real por nombre (para precio/
 * duración puntual, ej. "¿cuánto cuesta el semipermanente?"). Puede devolver
 * 0 (no existe -- nunca se inventa), 1 (encontrado) o varios (ambiguo, el
 * caller debe pedir aclaración con las opciones reales, nunca adivinar).
 */
export async function consultarServicio(supabase: SupabaseClient, params: { idTenant: string; nombre: string }): Promise<ServicioCatalogoReal[]> {
  return buscarServicios(supabase, { idTenant: params.idTenant, texto: params.nombre });
}

/** generar_link_reserva — URL real del portal público de ESTE tenant (Fase 4). Pura, nunca inventa un dominio ni un tenant ajeno. */
export function generarLinkReserva(idTenant: string): string {
  return `${SITE_URL}/reservar/${idTenant}`;
}

/**
 * consultar_disponibilidad — delega TODO el cálculo a
 * listarHorariosDisponiblesPorServicio (Fase 2/3): mismo motor que usan el
 * portal público y el panel. Esta consulta es de SOLO LECTURA -- nunca crea
 * una cita (la reserva real siempre pasa por el link del portal, ver Paso
 * "INTENCIÓN DE AGENDAR" del pedido).
 */
export async function consultarDisponibilidadReal(
  supabase: SupabaseClient,
  params: { idTenant: string; servicioId: string; fecha: string; especialistaId?: number }
) {
  return listarHorariosDisponiblesPorServicio(supabase, params);
}

/** consultar_cita_cliente — cita real activa de este cliente, vía la primitiva YA existente (lib/especialistas.ts), sin duplicar su lógica. */
export async function consultarCitaCliente(supabase: SupabaseClient, params: { phoneNumberId: string; telefonoCliente: string }) {
  return citaActivaPara(supabase, params.phoneNumberId, params.telefonoCliente);
}

export type MotivoTransferencia = "producto" | "tema_administrativo" | "cancelar_o_reagendar" | "duda_no_resuelta";

const MENSAJES_TRANSFERENCIA: Record<MotivoTransferencia, string> = {
  producto: MENSAJE_PRODUCTOS,
  tema_administrativo: "Ese tema prefiero que lo revise directamente Daniela para darte la información correcta 💕. Un momentico, por favor.",
  cancelar_o_reagendar: "Para cancelar o cambiar tu cita, Daniela te ayuda directamente por acá 💗. Un momentico, por favor.",
  duda_no_resuelta: "No quiero darte una información incorrecta 😊. Voy a pasar tu conversación directamente con Daniela para que pueda ayudarte. Un momentico, por favor.",
};

/**
 * gestionar_transferencia — traspaso real y determinista a Daniela. El
 * MENSAJE lo decide esta función (nunca el modelo) -- reutiliza
 * activarPausaChat tal cual, sin ningún mecanismo paralelo de pausa.
 */
export async function gestionarTransferencia(
  supabase: SupabaseClient,
  cliente: ClienteConfig,
  telefonoCliente: string,
  motivo: MotivoTransferencia
): Promise<{ mensajeEnviado: string }> {
  const mensaje = MENSAJES_TRANSFERENCIA[motivo] ?? MENSAJES_TRANSFERENCIA.duda_no_resuelta;
  await enviarWhatsApp(supabase, cliente, telefonoCliente, mensaje);
  await activarPausaChat(supabase, cliente.phone_number_id, telefonoCliente, DURACION_PAUSA_TRASPASO_MS);
  return { mensajeEnviado: mensaje };
}

// ---------------------------------------------------------------------------
// Regla fundamental del pedido: "la IA puede ser creativa en la FORMA, no en
// los HECHOS". Guarda de código (no solo una instrucción de prompt) -- mismo
// principio ya probado necesario en especialista-solicitud-ia.ts
// (huboResultadoRealDeAgendaEsteTurno): un texto final que suena a que
// afirma un precio o duración concreta SOLO se deja pasar si en ESTE turno
// de verdad se consultó el catálogo real (buscar_servicios/consultar_servicio).
// Si no, se bloquea y se pide reconfirmar -- nunca se arriesga a dejar pasar
// un precio inventado.
// ---------------------------------------------------------------------------

const PATRON_AFIRMA_PRECIO_O_DURACION = /\$\s?[\d.,]{3,}|(?<!\d)\d{1,3}\s?(min|minutos|hora|horas)\b/i;

export function pareceAfirmarPrecioODuracion(texto: string): boolean {
  return PATRON_AFIRMA_PRECIO_O_DURACION.test(texto);
}

// --- Herramientas de IA (Paso "HERRAMIENTAS DE IA" del pedido) ------------
// Deliberadamente pequeñas y de solo lectura salvo gestionar_transferencia
// (que solo pausa el chat, nunca toca citas/servicios). Nada de SQL
// arbitrario: cada una es una función de dominio concreta y auditable.

const TOOLS: Anthropic.Tool[] = [
  {
    name: "buscar_servicios",
    description:
      "Consulta el catálogo REAL de servicios activos del negocio. Úsala para '¿qué servicios tienen?', '¿tienen algo para pies?', o para recomendar opciones reales. Sin 'texto', devuelve el catálogo completo. NUNCA inventes un servicio que esta herramienta no haya devuelto.",
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Palabra o categoría para filtrar (ej. 'manos', 'pestañas'). Omite para el catálogo completo." },
      },
    },
  },
  {
    name: "consultar_servicio",
    description:
      "Busca UN servicio real puntual por nombre para responder su precio/duración exacta (ej. '¿cuánto cuesta el semipermanente?'). Puede devolver varias coincidencias -- si es así, pide que aclare cuál en vez de asumir. Si no devuelve nada, ese servicio NO existe en el catálogo -- nunca afirmes que sí lo hacen.",
    input_schema: {
      type: "object",
      properties: { nombre: { type: "string", description: "Nombre o parte del nombre del servicio mencionado por la clienta." } },
      required: ["nombre"],
    },
  },
  {
    name: "consultar_disponibilidad",
    description:
      "Consulta horarios REALES disponibles para un servicio en una fecha. Es SOLO LECTURA -- nunca crea una cita. Úsala cuando pregunten por disponibilidad puntual (ej. '¿tienen espacio mañana?'), no para agendar (para eso usa generar_link_reserva).",
    input_schema: {
      type: "object",
      properties: {
        servicio_id: { type: "string", description: "id real del servicio (de buscar_servicios/consultar_servicio)." },
        fecha: { type: "string", description: "Fecha en formato YYYY-MM-DD." },
      },
      required: ["servicio_id", "fecha"],
    },
  },
  {
    name: "generar_link_reserva",
    description:
      "Genera el link real al portal de reservas de este negocio. Úsala en cuanto detectes intención clara de agendar (ej. 'quiero una cita', 'quiero agendar', 'quiero hacerme las uñas', o tras confirmar qué servicio quiere). La reserva final siempre la hace la clienta en ese link -- tú nunca creas la cita.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "consultar_cita_cliente",
    description: "Consulta si esta clienta ya tiene una cita activa real (para '¿cuándo tengo mi cita?', '¿qué cita tengo?').",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "gestionar_transferencia",
    description:
      "Pasa la conversación a Daniela y pausa la IA para este chat. ÚSALA para: preguntas de productos (aunque ya se haya usado el botón), temas de pago/facturación, pedidos de cancelar o reagendar una cita, o cualquier pregunta que no puedas responder con datos reales sin inventar. Después de llamarla, el mensaje de traspaso YA se envió -- no escribas nada más en este turno.",
    input_schema: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          enum: ["producto", "tema_administrativo", "cancelar_o_reagendar", "duda_no_resuelta"],
          description: "Por qué se transfiere -- determina el mensaje exacto que recibe la clienta.",
        },
      },
      required: ["motivo"],
    },
  },
];

const MENSAJE_RESPALDO =
  "¡Uy, disculpa! 😅 Dame un segundo, ya te ayudo -- si no te respondo enseguida, escríbeme de nuevo por aquí y seguimos.";

const MAX_TURNOS_HERRAMIENTA = 4;

// ---------------------------------------------------------------------------
// Fase 8A.4 (autorizado) — conocimiento operativo real de Daniela, tomado de
// dulabs_config_bot.respuestas (el formulario que ella misma llenó en
// /config-bot/[token], ver lib/config-bot.ts). Hasta esta fase ningún
// componente de la IA leía esta tabla -- las reglas de asignación,
// horarios por persona y políticas de negocio que Daniela ya confirmó
// simplemente no llegaban a la conversación.
//
// Deliberadamente NO se repiten acá los precios/duraciones de servicios
// (eso sigue viniendo SOLO de dulabs_servicios vía buscar_servicios/
// consultar_servicio -- una sola fuente de verdad para esos datos, evita que
// este texto se desactualice y contradiga al catálogo real). Este bloque
// cubre exactamente lo que dulabs_servicios NO puede representar: horarios
// por profesional, prioridad de asignación, y políticas del negocio.
//
// Función pura (nunca toca la red) para poder probarla con cualquier forma
// de `respuestas` sin depender de Supabase -- respuestas es JSON libre
// (jsonb sin esquema fijo, ver la migración), así que cada acceso es
// defensivo: un campo ausente o con otra forma simplemente no genera línea,
// nunca revienta ni inventa un valor.
const DIAS_LABEL: Record<string, string> = { lun: "lunes", mar: "martes", mie: "miércoles", jue: "jueves", vie: "viernes", sab: "sábado", dom: "domingo" };
const NOMBRE_PERSONA: Record<string, string> = { carla: "Carla", kelly: "Kelly", daniela: "Daniela", nicol: "Nicol" };

function comoObjeto(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function comoTexto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function formatearDias(dias: unknown): string {
  if (!Array.isArray(dias) || dias.length === 0) return "";
  return dias.map((d) => DIAS_LABEL[String(d)] ?? String(d)).join(", ");
}

export function construirContextoOperativoDesdeConfigBot(respuestas: unknown): string {
  const r = comoObjeto(respuestas);
  const lineas: string[] = [];

  // --- Horarios por persona ---
  const personas = comoObjeto(r.personas);
  const lineasPersonas: string[] = [];
  for (const clave of ["carla", "kelly", "daniela", "nicol"]) {
    const p = comoObjeto(personas[clave]);
    const dias = formatearDias(p.dias);
    const inicio = comoTexto(p.inicio);
    const fin = comoTexto(p.fin);
    if (!dias || !inicio || !fin) continue;
    let linea = `${NOMBRE_PERSONA[clave]}: ${dias}, ${inicio} a ${fin}`;
    if (p.sabadoDistinto === true) {
      const sabInicio = comoTexto(p.sabInicio);
      const sabFin = comoTexto(p.sabFin);
      if (sabInicio && sabFin) linea += ` (sábado ${sabInicio} a ${sabFin})`;
    }
    lineasPersonas.push(linea);
  }
  if (lineasPersonas.length) lineas.push(`Horarios reales del equipo:\n${lineasPersonas.join("\n")}`);

  // --- Reglas de asignación (SOLO lo que Daniela confirmó, nunca inferido) ---
  const reglas = comoObjeto(r.reglas);
  const lineasReglas: string[] = [];
  const prioridadManos = comoTexto(reglas.prioridadManos);
  if (prioridadManos === "carla_primero") {
    lineasReglas.push("Manos: Carla es la primera opción; Daniela solo entra si Carla no tiene NINGÚN cupo ese día.");
  } else if (prioridadManos === "daniela_primero") {
    lineasReglas.push("Manos: primero se intenta con Daniela; si no tiene espacio, pasa a Carla.");
  } else if (prioridadManos === "cualquiera") {
    lineasReglas.push("Manos: no importa el orden, atiende quien tenga cupo primero a esa hora.");
  }
  const danielaPies = comoTexto(reglas.danielaPies);
  if (danielaPies === "no") lineasReglas.push("Pies: Kelly es la fija, Carla es el respaldo. Daniela nunca hace pies.");
  else if (danielaPies === "si") lineasReglas.push("Pies: Kelly es la fija, Carla es el respaldo. Daniela puede atender pies como último recurso.");
  const retiros = comoTexto(reglas.retiros);
  if (retiros === "cualquiera") lineasReglas.push("Retiros: los puede hacer cualquiera del equipo, no tiene que ser quien hace el servicio nuevo.");
  else if (retiros === "mismo") lineasReglas.push("Retiros: solo los hace la misma persona que va a realizar el servicio nuevo.");
  const combinados = comoTexto(reglas.serviciosCombinados);
  if (combinados === "paralelo") lineasReglas.push("Dos servicios el mismo día: se asignan a dos personas distintas, en paralelo.");
  else if (combinados === "misma_persona") lineasReglas.push("Dos servicios el mismo día: los hace la misma persona, uno seguido del otro.");
  if (comoTexto(reglas.confirmacion) === "no" && comoTexto(reglas.confirmacionDetalle)) {
    lineasReglas.push(`Confirmación de citas (excepción indicada por Daniela): ${comoTexto(reglas.confirmacionDetalle)}`);
  }
  if (lineasReglas.length) lineas.push(`Reglas reales de asignación:\n${lineasReglas.join("\n")}`);

  // --- Asociaciones servicio -> profesional (SOLO las que Daniela definió explícitamente) ---
  const servicios = comoObjeto(r.servicios);
  const NOMBRE_SERVICIO: Record<string, string> = { cejasSola: "Cejas, depilación sola", cejasHenna: "Cejas, depilación con henna", hidralips: "Hidralips" };
  const lineasServicios: string[] = [];
  for (const [clave, nombreServicio] of Object.entries(NOMBRE_SERVICIO)) {
    const quien = comoTexto(servicios[clave]);
    if (quien && NOMBRE_PERSONA[quien]) lineasServicios.push(`${nombreServicio} → ${NOMBRE_PERSONA[quien]}`);
  }
  if (lineasServicios.length) lineas.push(`Quién realiza cada servicio (confirmado por Daniela):\n${lineasServicios.join("\n")}`);

  // --- Negocio / políticas ---
  const negocio = comoObjeto(r.negocio);
  const lineasNegocio: string[] = [];
  const lvAbre = comoTexto(negocio.lvAbre);
  const lvCierra = comoTexto(negocio.lvCierra);
  if (lvAbre && lvCierra) lineasNegocio.push(`Lunes a viernes: ${lvAbre} a ${lvCierra}.`);
  const sabAbre = comoTexto(negocio.sabAbre);
  const sabCierra = comoTexto(negocio.sabCierra);
  if (sabAbre && sabCierra) lineasNegocio.push(`Sábados: ${sabAbre} a ${sabCierra}.`);
  if (comoTexto(negocio.domingo) === "cerrado") lineasNegocio.push("Domingos: cerrado.");
  else if (comoTexto(negocio.domingo) === "abierto") lineasNegocio.push("Domingos: sí se trabaja.");
  if (comoTexto(negocio.abre8am) === "si") {
    const detalle = comoTexto(negocio.abre8amDetalle);
    lineasNegocio.push(`A veces abren desde las 8:00 a.m. si se pide con anticipación.${detalle ? ` ${detalle}` : ""}`);
  }
  if (comoTexto(negocio.festivos) === "cerrado") lineasNegocio.push("Festivos: cerrado.");
  else if (comoTexto(negocio.festivos) === "normal") lineasNegocio.push("Festivos: trabajan normal.");
  const tiempoCancelacion = comoTexto(negocio.tiempoCancelacion);
  if (tiempoCancelacion) lineasNegocio.push(`Para cancelar o cambiar la hora, avisar con: ${tiempoCancelacion}.`);
  if (comoTexto(negocio.cobroCancelacion) === "no") lineasNegocio.push("No se cobra nada por cancelar tarde o no presentarse.");
  else if (comoTexto(negocio.cobroCancelacion) === "si") {
    const monto = comoTexto(negocio.montoCancelacion);
    lineasNegocio.push(`Si cancela tarde o no se presenta, se cobra${monto ? ` ${monto}` : ""}.`);
  }
  if (lineasNegocio.length) lineas.push(`Horario y políticas del negocio:\n${lineasNegocio.join("\n")}`);

  return lineas.join("\n\n");
}

/**
 * Núcleo conversacional (Paso 2 en adelante del pedido). NO crea citas, NO
 * calcula disponibilidad ni duración por su cuenta -- todo hecho concreto
 * viene de una herramienta real de este mismo turno (ver
 * pareceAfirmarPrecioODuracion). Personalidad: femenina, cercana, breve,
 * nunca menciona herramientas/IA/Supabase/"intención detectada".
 *
 * Devuelve el texto final a enviar, o null si una herramienta ya mandó todo
 * lo necesario por su cuenta (ej. gestionar_transferencia).
 */
export async function generarRespuestaAsistenteDaniela(params: {
  supabase: SupabaseClient;
  cliente: ClienteConfig;
  textoUsuario: string;
  telefonoRemitente: string;
  historial?: MensajeHistorialIA[];
  /**
   * Fase 8A.2 (autorizado) — SOLO para tests: inyecta un `.messages.create`
   * falso sin tocar la red real de Anthropic, para poder probar la
   * estructura del loop (ej. "catálogo vacío -> no agota turnos sin
   * responder") sin depender de ANTHROPIC_API_KEY ni del juicio real del
   * modelo. El webhook real nunca pasa esto -- siempre usa el cliente real.
   */
  anthropicOverride?: { messages: { create: (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> } };
}): Promise<string | null> {
  const apiKey = params.cliente.api_key_ia ? descifrarSecreto(params.cliente.api_key_ia) : process.env.ANTHROPIC_API_KEY;
  if (!params.anthropicOverride && !apiKey) {
    await registrarFalloIA({
      tipo: "sin_key",
      mensaje: "No hay api_key_ia del tenant ni ANTHROPIC_API_KEY en el servidor",
      idTenant: params.cliente.id_tenant,
      phoneNumberId: params.cliente.phone_number_id,
      nombreNegocio: params.cliente.nombre_negocio,
    });
    return null;
  }

  const anthropic = params.anthropicOverride ?? new Anthropic({ apiKey: apiKey! });
  const idTenant = params.cliente.id_tenant;
  let terminarConversacionAhora = false;
  let huboConsultaCatalogoEsteTurno = false;

  // Fase 8A.4 (autorizado) — conocimiento operativo real (horarios por
  // persona, prioridad de asignación, políticas de negocio) desde
  // dulabs_config_bot, aislado por el phone_number_id real de este tenant
  // (columna unique, ver lib/config-bot.ts). Si el tenant no tiene fila
  // (la mayoría hoy) o el formato no trae nada útil, el bloque queda vacío y
  // simplemente no se agrega -- nunca revienta la conversación.
  const configBot = await configBotPorPhoneNumberId(params.supabase, params.cliente.phone_number_id);
  const contextoOperativo = configBot ? construirContextoOperativoDesdeConfigBot(configBot.respuestas) : "";

  const systemFinal =
    `Eres la asistente conversacional de ${params.cliente.nombre_negocio}, un spa de belleza. Eres una ASESORA EXPERTA en uñas, manicure, pedicure, semipermanente, dipping, base rubber, forrado en gel/acrílico, press on, cejas, depilación, henna, pestañas e hidralips -- no un simple buscador de servicios. ` +
    `Tu personalidad: femenina, amable, cercana, empática, profesional, natural y BREVE. Puedes usar "amiga", "claro que sí", "con gusto", "te puede quedar divino", 💗, ✨ -- sin exagerar, nunca como una lista de emojis. Nunca hables como un sistema técnico ni digas "como inteligencia artificial".\n\n` +
    `--- Regla innegociable: nunca inventes un hecho DE ${params.cliente.nombre_negocio} ---\n` +
    `Puedes ser creativa en CÓMO conversas, nunca en QUÉ afirmas como hecho concreto de este negocio. Qué servicios ofrece, sus precios, su duración, su disponibilidad, y si la clienta tiene una cita: SIEMPRE debes consultarlo con una herramienta antes de afirmarlo. Si una herramienta no te devuelve ese dato, dilo con honestidad ("no encuentro ese servicio en las opciones disponibles ahora mismo") y ofrece mostrar alternativas reales -- nunca digas "sí, lo tenemos" sin haberlo consultado en este mismo turno.\n\n` +
    `--- Conocimiento experto vs. oferta real (regla fundamental) ---\n` +
    `SÍ puedes usar tu conocimiento general para explicar qué es una técnica, cómo funciona, para quién es adecuada, y comparar técnicas entre sí (ej. "¿qué es el dipping?", "¿qué diferencia hay entre dipping y acrílicas?") -- eso es explicación general, no un hecho de este negocio, y no necesita herramienta. PERO nunca confundas "sé qué es esta técnica" con "este negocio la ofrece": la ÚNICA fuente de qué se puede reservar aquí es buscar_servicios/consultar_servicio. Si te preguntan por una técnica que no aparece ahí, puedes explicar de forma general qué es, pero debes decir explícitamente que no la tienes registrada entre lo que se ofrece aquí ahora mismo, y ofrecer alternativas reales -- nunca digas que sí se realiza sin haberlo confirmado con la herramienta en este turno. Nunca uses conocimiento de otros salones/internet para inventar qué ofrece este negocio -- tu conocimiento técnico es solo para EXPLICAR, COMPARAR y ORIENTAR, jamás para inventar la oferta.\n\n` +
    `--- Servicios y precios ---\n` +
    `Usa buscar_servicios o consultar_servicio antes de mencionar cualquier servicio, precio o duración concreta. Si hay varias coincidencias, pregunta cuál en vez de adivinar. Si la clienta no sabe qué quiere, hazle preguntas naturales (ej. "¿buscas algo para tus manos, tus pies, o quieres consentirte con otro servicio? ✨") antes de consultar el catálogo. Cuando recomiendes, combina lo que la clienta te contó + tu conocimiento técnico de las diferencias entre opciones + el catálogo real -- explica brevemente por qué esa opción encaja antes de nombrarla.\n\n` +
    `--- Si buscar_servicios o consultar_servicio devuelven una lista vacía ---\n` +
    `Una lista vacía es una respuesta válida, NO un error: significa que ese servicio concreto no está en el catálogo ahora mismo. NO seguir intentando la misma búsqueda con términos distintos una y otra vez -- como máximo un segundo intento con otra palabra si tiene sentido, y si sigue vacío, dilo con honestidad de inmediato (ej. "no encontré una opción que coincida exactamente con lo que buscas 💗 ¿me cuentas un poco más sobre lo que te gustaría conseguir?") o usa gestionar_transferencia si no puedes orientarla más. Nunca dejes que la conversación se quede sin una respuesta de texto por seguir buscando.\n\n` +
    `--- Agendar ---\n` +
    `En cuanto detectes intención clara de agendar (ej. "quiero una cita", "quiero agendar", "quiero hacerme las uñas", o después de que confirme qué servicio quiere), usa generar_link_reserva y comparte el link con un mensaje cálido invitándola a elegir servicio/profesional/fecha/horario ahí. Nunca crees la cita tú misma ni prometas un horario exacto sin haberlo consultado con consultar_disponibilidad.\n\n` +
    `--- Disponibilidad ---\n` +
    `Si preguntan por disponibilidad puntual (ej. "¿tienen espacio mañana?"), usa consultar_disponibilidad -- es solo información, la reserva la confirma ella en el link.\n\n` +
    `--- Su cita actual ---\n` +
    `Si pregunta por una cita que ya tiene, usa consultar_cita_cliente.\n\n` +
    `--- Cuándo transferir a Daniela ---\n` +
    `Usa gestionar_transferencia para: preguntas de productos, temas de pago/facturación, pedidos de cancelar/reagendar una cita existente, o cualquier cosa que no puedas responder sin arriesgarte a inventar. Después de llamarla, el mensaje ya se envió solo -- no agregues nada más.\n\n` +
    `--- Reglas de forma ---\n` +
    `Nunca menciones que eres una IA, que usas herramientas, "Supabase", bases de datos, ni digas cosas como "intención detectada". Responde como lo haría Daniela en persona: cálida, breve, directa.` +
    (contextoOperativo
      ? `\n\n--- Conocimiento operativo real de este negocio (confirmado directamente por Daniela, nunca inventado) ---\n` +
        `Úsalo para responder cosas como "¿quién me puede atender?", "¿tienen espacio esta semana?" o cualquier pregunta sobre horarios/políticas del negocio -- pero los precios y duraciones de servicios SIEMPRE siguen viniendo de buscar_servicios/consultar_servicio, nunca de este bloque.\n\n` +
        contextoOperativo
      : "");

  const bloquesHerramienta: Anthropic.ToolUseBlock[] = [];

  async function ejecutarHerramienta(nombre: string, input: Record<string, unknown>): Promise<string> {
    if (nombre === "buscar_servicios" || nombre === "consultar_servicio") huboConsultaCatalogoEsteTurno = true;

    if (nombre === "buscar_servicios") {
      const resultados = await buscarServicios(params.supabase, { idTenant, texto: typeof input.texto === "string" ? input.texto : undefined });
      return JSON.stringify({ servicios: resultados });
    }
    if (nombre === "consultar_servicio") {
      const resultados = await consultarServicio(params.supabase, { idTenant, nombre: String(input.nombre ?? "") });
      return JSON.stringify({ servicios: resultados });
    }
    if (nombre === "consultar_disponibilidad") {
      const resultado = await consultarDisponibilidadReal(params.supabase, {
        idTenant,
        servicioId: String(input.servicio_id ?? ""),
        fecha: String(input.fecha ?? ""),
      });
      return JSON.stringify(resultado);
    }
    if (nombre === "generar_link_reserva") {
      return JSON.stringify({ link: generarLinkReserva(idTenant) });
    }
    if (nombre === "consultar_cita_cliente") {
      const cita = await consultarCitaCliente(params.supabase, { phoneNumberId: params.cliente.phone_number_id, telefonoCliente: params.telefonoRemitente });
      return JSON.stringify({ cita });
    }
    if (nombre === "gestionar_transferencia") {
      const motivo = (["producto", "tema_administrativo", "cancelar_o_reagendar", "duda_no_resuelta"] as const).includes(
        input.motivo as MotivoTransferencia
      )
        ? (input.motivo as MotivoTransferencia)
        : "duda_no_resuelta";
      await gestionarTransferencia(params.supabase, params.cliente, params.telefonoRemitente, motivo);
      terminarConversacionAhora = true;
      return JSON.stringify({ success: true });
    }
    return JSON.stringify({ success: false, error: "Herramienta desconocida" });
  }

  const messages = construirMensajesConHistorial(params.historial ?? [], params.textoUsuario);

  for (let turno = 0; turno < MAX_TURNOS_HERRAMIENTA; turno++) {
    // Parte 13/14 (autorizado) — la ausencia de resultados de catálogo es un
    // resultado válido, nunca una excepción técnica: en el ÚLTIMO turno
    // permitido no se ofrecen herramientas, así que Claude está OBLIGADO a
    // cerrar con un texto real (aunque sea "no encontré una opción que
    // encaje" o una transferencia sugerida en palabras) en vez de intentar
    // otra tool_use más y caer en "se agotaron los turnos" -> MENSAJE_RESPALDO.
    const esUltimoTurno = turno === MAX_TURNOS_HERRAMIENTA - 1;
    let response: Anthropic.Message;
    try {
      response = await anthropic.messages.create({
        model: MODELO,
        max_tokens: 1024,
        system: [{ type: "text", text: systemFinal, cache_control: { type: "ephemeral" } }],
        ...(esUltimoTurno ? {} : { tools: TOOLS }),
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
      return MENSAJE_RESPALDO;
    }

    const bloques = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    bloquesHerramienta.push(...bloques);

    if (bloques.length === 0 || response.stop_reason !== "tool_use") {
      const texto = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (!texto) {
        await registrarFalloIA({
          tipo: "otro",
          mensaje: `La IA del asistente de Daniela devolvió texto vacío (stop_reason=${response.stop_reason}). Mensaje: "${params.textoUsuario.slice(0, 200)}"`,
          idTenant: params.cliente.id_tenant,
          phoneNumberId: params.cliente.phone_number_id,
          nombreNegocio: params.cliente.nombre_negocio,
        });
        return MENSAJE_RESPALDO;
      }
      // Guarda real de código: un texto que suena a que afirma un precio o
      // duración concreta SOLO se deja pasar si en ESTE turno de verdad se
      // consultó el catálogo -- nunca se confía solo en la instrucción de
      // prompt de arriba.
      if (pareceAfirmarPrecioODuracion(texto) && !huboConsultaCatalogoEsteTurno) {
        await registrarFalloIA({
          tipo: "otro",
          mensaje: `Posible precio/duración SIN respaldo de catálogo en este turno -- texto bloqueado: "${texto.slice(0, 300)}". Mensaje de la clienta: "${params.textoUsuario.slice(0, 200)}"`,
          idTenant: params.cliente.id_tenant,
          phoneNumberId: params.cliente.phone_number_id,
          nombreNegocio: params.cliente.nombre_negocio,
        });
        return "Dame un segundito para confirmarte ese dato con precisión 🙏 ¿me repites qué servicio te interesa?";
      }
      return texto;
    }

    messages.push({ role: "assistant", content: response.content });
    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const bloque of bloques) {
      const resultado = await ejecutarHerramienta(bloque.name, bloque.input as Record<string, unknown>);
      resultados.push({ type: "tool_result", tool_use_id: bloque.id, content: resultado });
    }
    if (terminarConversacionAhora) return null;
    messages.push({ role: "user", content: resultados });
  }

  // Parte 13/14 (autorizado) — inalcanzable en la práctica: el último turno
  // (turno === MAX_TURNOS_HERRAMIENTA - 1) nunca ofrece `tools`, así que
  // Claude no puede devolver tool_use ahí y el `return texto`/MENSAJE_RESPALDO
  // por texto vacío de más arriba siempre corta el loop antes de llegar acá.
  // Se conserva solo como red de seguridad defensiva (y porque TypeScript no
  // puede probar que un for-loop acotado siempre retorna desde adentro).
  await registrarFalloIA({
    tipo: "otro",
    mensaje: `[Inesperado] Se agotaron los ${MAX_TURNOS_HERRAMIENTA} turnos de herramienta en el asistente de Daniela sin que el último turno (sin tools) devolviera texto. Mensaje: "${params.textoUsuario.slice(0, 200)}"`,
    idTenant: params.cliente.id_tenant,
    phoneNumberId: params.cliente.phone_number_id,
    nombreNegocio: params.cliente.nombre_negocio,
  });
  return MENSAJE_RESPALDO;
}

/**
 * Fase 8A — punto de entrada único llamado por app/webhook-dulabs/route.ts
 * cuando el gate (lib/asistente-daniela-gate.ts) ya confirmó que este
 * mensaje debe atenderse con el nuevo asistente. Decide entre: saludo
 * determinista (primer mensaje), botón de menú (Servicios de Spa/Productos,
 * deterministas, nunca redactados por el modelo), o la conversación con
 * herramientas. Estructuralmente igual al criterio ya usado por LEGACY
 * (especialista-solicitud-ia.ts: esPrimerMensaje = historial vacío).
 */
export type AccionAsistenteDaniela = "saludo" | "boton_productos" | "boton_servicios_spa" | "conversacion" | "sin_texto";

/**
 * Devuelve qué rama se ejecutó -- el webhook real ignora el valor de
 * retorno, pero permite probar la lógica de despacho (Fase 8A, Paso 14
 * puntos K/L/M) sin depender de efectos secundarios invisibles (con el
 * cliente de prueba sin token real de Meta, enviarWhatsApp no deja ningún
 * rastro en la base de datos -- ver lib/whatsapp-outbound.ts).
 */
export async function atenderConAsistenteDanielaIA(params: {
  supabase: SupabaseClient;
  cliente: ClienteConfig;
  telefonoRemitente: string;
  mensaje: { text?: { body?: string } | null; interactive?: { type?: string; button_reply?: { id?: string } | null } | null };
  historial: MensajeHistorialIA[];
}): Promise<AccionAsistenteDaniela> {
  const buttonId =
    params.mensaje.interactive?.type === "button_reply" ? params.mensaje.interactive.button_reply?.id?.trim() : undefined;

  if (params.historial.length === 0 && !buttonId) {
    await enviarSaludoInicial(params.supabase, params.cliente, params.telefonoRemitente);
    return "saludo";
  }
  if (buttonId === DANIELA_BUTTON_IDS.PRODUCTOS) {
    await manejarBotonProductos(params.supabase, params.cliente, params.telefonoRemitente);
    return "boton_productos";
  }
  if (buttonId === DANIELA_BUTTON_IDS.SERVICIOS_SPA) {
    await manejarBotonServiciosSpa(params.supabase, params.cliente, params.telefonoRemitente);
    return "boton_servicios_spa";
  }

  const textoUsuario = params.mensaje.text?.body?.trim() ?? "";
  if (!textoUsuario) return "sin_texto";

  const respuesta = await generarRespuestaAsistenteDaniela({
    supabase: params.supabase,
    cliente: params.cliente,
    textoUsuario,
    telefonoRemitente: params.telefonoRemitente,
    historial: params.historial,
  });
  if (respuesta) await enviarWhatsApp(params.supabase, params.cliente, params.telefonoRemitente, respuesta);
  return "conversacion";
}
