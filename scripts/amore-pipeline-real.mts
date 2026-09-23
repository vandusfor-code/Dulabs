// Validación REAL del código de ESTA RAMA, SIN desplegarlo.
//
// Ejecuta en este proceso el MISMO pipeline de producción (lib/whatsapp-qr-pipeline.ts) contra los datos REALES de AMORE:
// Supabase real, Nylas real, Gemini REAL (con el catálogo real como contexto) y, por defecto, las respuestas salen de
// verdad por el WhatsApp de AMORE hacia el número de prueba. La entrada NO se envía por WhatsApp (eso la atendería el
// bot DESPLEGADO, con el código viejo): se registra en la bandeja igual que lo hace el worker y se procesa acá.
//
// Efectos reales (solo con --confirmar): filas de sesión/estado de la conversación del número de prueba, mensajes en la
// bandeja de AMORE, y los mensajes de respuesta al número de prueba. Salvaguardas:
// - Sin --confirmar no escribe ni envía nada (verifica configuración y muestra el plan).
// - Solo AMORE y solo el número de prueba. Las notificaciones a Jessica (traspaso humano) NUNCA se envían: se registran.
// - Nunca confirma una reserva real sin --permitir-reserva.
// - Al terminar cierra la sesión de agenda abierta con "cancelar" (salvo reserva creada).
// - --sin-enviar: nada sale por WhatsApp (las respuestas se registran en la bandeja para conservar el historial).
// - Nunca imprime secretos.
//
// Uso (mientras corre, NO escribir desde el número de prueba -- lo atendería el bot desplegado):
//   npx tsx --env-file=.env.local scripts/amore-pipeline-real.mts --escenario flujo_cristal [--confirmar] [--sin-enviar] [--permitir-reserva]
//   npx tsx --env-file=.env.local scripts/amore-pipeline-real.mts --mensajes "Hola|Quiero hacerme las uñas|..." --confirmar
// Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NYLAS_API_KEY, NYLAS_GRANT_ID_AMORE, GEMINI_KEY y, salvo con
// --sin-enviar, WHATSAPP_WORKER_URL + WHATSAPP_WORKER_SECRET.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { atenderMensajeWhatsAppQR, type DepsPipelineWhatsAppQR } from "@/lib/whatsapp-qr-pipeline";
import { iniciarNuevaSesionAgendaV2, iniciarGestionCitasAgendaV2, type AgendaV2RouterDeps } from "@/lib/agenda-v2/router";
import { AMORE_TENANT_ID, resolverNylasGrantIdParaTenant } from "@/lib/nylas/nylas-grant";
import { createNylasEventsClient, resolveNylasApiKeyFromEnv } from "@/lib/nylas/nylas-client";
import { resolverCalendarIdNylasDeEspecialista } from "@/lib/nylas/nylas-calendario-especialista";
import { clasificarMensajeConGemini } from "@/lib/amore-entrada-gemini";
import { enviarMensajeWhatsApp } from "@/lib/whatsapp-worker-client";
import { sesionAgendaReal, contrastarConAgendaReal } from "@/lib/testing/amore-contraste-real";

const ESCENARIOS: Record<string, string[]> = {
  flujo_cristal: ["Hola", "Quiero hacerme las uñas", "dipping", "Quiero con Cristal", "¿Qué tienes disponible con Cristal?", "mejor el viernes", "¿puede ser después de las 3?"],
  numeros: ["Hola", "1", "2", "1", "2"],
  consultas: ["Hola hermosa", "¿Cuánto cuesta el dipping?", "¿Cuánto demora?", "¿Hacen keratina?", "Estoy mirando porque quiero hacerme las uñas para una boda jajaja", "gracias"],
  cambios: ["Quiero una cita", "uñas", "dipping", "me da igual", "mejor con Cristal", "mejor el sábado", "¿cuánto cuesta?", "el sábado entonces"],
};

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const bandera = (n: string) => process.argv.includes(`--${n}`);
const digitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const ultimos10 = (s: string | null | undefined) => digitos(s).slice(-10);

const CONFIRMAR = bandera("confirmar");
const SIN_ENVIAR = bandera("sin-enviar");
const PERMITIR_RESERVA = bandera("permitir-reserva");
const mensajes = arg("mensajes")?.split("|").map((m) => m.trim()).filter(Boolean) ?? ESCENARIOS[arg("escenario") ?? "flujo_cristal"];
if (!mensajes) {
  console.error(`[pipeline] escenario desconocido. Disponibles: ${Object.keys(ESCENARIOS).join(", ")}`);
  process.exit(1);
}

const requeridas = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NYLAS_API_KEY", "NYLAS_GRANT_ID_AMORE", "GEMINI_KEY", ...(SIN_ENVIAR ? [] : ["WHATSAPP_WORKER_URL", "WHATSAPP_WORKER_SECRET"])];
const faltan = requeridas.filter((k) => !process.env[k]);
if (faltan.length > 0) {
  console.error(`[pipeline] faltan variables de entorno: ${faltan.join(", ")} (solo se revisa su presencia, nunca se imprimen).`);
  process.exit(1);
}

const supabase: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const nylasClient = createNylasEventsClient(resolveNylasApiKeyFromEnv()!);
const nylasDeps = { nylasClient, grantId: resolverNylasGrantIdParaTenant(AMORE_TENANT_ID)! };

// Mismo formato de teléfono que ya usa la conversación real del número de prueba con AMORE (si existe).
const prueba10 = ultimos10(arg("telefono-prueba") ?? "3148127388");
const { data: convs } = await supabase.from("dulabs_chat_conversaciones").select("id, telefono").eq("id_tenant", AMORE_TENANT_ID);
const convExistente = (convs ?? []).find((c) => ultimos10(c.telefono as string) === prueba10);
const TELEFONO = (convExistente?.telefono as string | undefined) ?? `57${prueba10}`;

console.log(`[pipeline] código de ESTA rama contra datos REALES de AMORE -- cliente de prueba ***${prueba10.slice(-4)}`);
console.log(`[pipeline] respuestas por WhatsApp: ${SIN_ENVIAR ? "NO (--sin-enviar)" : "SÍ, reales, al número de prueba"}   reservas reales: ${PERMITIR_RESERVA ? "PERMITIDAS" : "bloqueadas"}`);
console.log(`[pipeline] mensajes: ${JSON.stringify(mensajes)}`);
if (!CONFIRMAR) {
  console.log("[pipeline] modo verificación: configuración OK. Agrega --confirmar para ejecutar.");
  process.exit(0);
}

// --- Bandeja: la entrada se registra igual que la registra el worker (así Gemini ve el historial real) --------------------
async function conversacionId(): Promise<number> {
  const { data } = await supabase.from("dulabs_chat_conversaciones").select("id, telefono").eq("id_tenant", AMORE_TENANT_ID);
  const c = (data ?? []).find((x) => ultimos10(x.telefono as string) === prueba10);
  if (c) return c.id as number;
  const { data: nueva, error } = await supabase
    .from("dulabs_chat_conversaciones")
    .insert({ id_tenant: AMORE_TENANT_ID, telefono: TELEFONO, nombre_visible: "Prueba DuLabs (validación)" })
    .select("id")
    .single();
  if (error || !nueva) throw new Error(`no se pudo crear la conversación de prueba: ${error?.message ?? "?"}`);
  return nueva.id as number;
}
const CONVERSACION = await conversacionId();
async function registrarEnBandeja(direccion: "entrante" | "saliente", texto: string, wamid: string | null) {
  await supabase.from("dulabs_chat_mensajes").insert({
    id_tenant: AMORE_TENANT_ID,
    conversacion_id: CONVERSACION,
    direccion,
    tipo: "texto",
    texto,
    whatsapp_message_id: wamid,
    origen: direccion === "saliente" ? "automatico" : "humano",
  });
}

// --- Salida: todo se registra; al número de prueba sale de verdad; a cualquier otro número (Jessica) NUNCA --------------
let respuestasTurno: string[] = [];
let notificacionesRetenidas = 0;
const enviar = (async (p: Parameters<typeof enviarMensajeWhatsApp>[0]) => {
  if (ultimos10(p.telefono) !== prueba10) {
    notificacionesRetenidas++;
    console.log(`   [retenido, NO enviado] mensaje a ***${ultimos10(p.telefono).slice(-4)} (notificación interna): ${p.mensaje.slice(0, 90)}…`);
    return { ok: true, data: { ok: true } };
  }
  respuestasTurno.push(p.mensaje);
  if (SIN_ENVIAR) {
    await registrarEnBandeja("saliente", p.mensaje, null);
    return { ok: true, data: { ok: true } };
  }
  return enviarMensajeWhatsApp(p); // el worker persiste el eco saliente real
}) as typeof enviarMensajeWhatsApp;

const intenciones: string[] = [];
const agendaV2: AgendaV2RouterDeps = { enviarMensajeWhatsApp: enviar };
const iniciarAgendaV2 = (p: Parameters<typeof iniciarNuevaSesionAgendaV2>[0]) => iniciarNuevaSesionAgendaV2(p, agendaV2);
const deps: DepsPipelineWhatsAppQR = {
  atencionHumana: { enviarMensajeWhatsApp: enviar },
  registroCliente: { enviarMensajeWhatsApp: enviar, iniciarAgendaV2 },
  compraProducto: { enviarMensajeWhatsApp: enviar },
  agendaV2,
  entradaAmore: {
    enviarMensajeWhatsApp: enviar,
    iniciarAgendaV2,
    iniciarGestionCitasAgendaV2: (p) => iniciarGestionCitasAgendaV2(p, agendaV2),
    // Gemini REAL -- solo se observa (intención, fallo técnico, tamaño del contexto real recibido).
    clasificarConGemini: async (p) => {
      const r = await clasificarMensajeConGemini(p);
      intenciones.push(`${r.intent}${r.errorTecnico ? " (ERROR TÉCNICO)" : ""} ctx=${p.contextoNegocio ? `${p.contextoNegocio.length} car.` : "SIN DATOS"}${r.detectedServiceMention ? ` servicio="${r.detectedServiceMention}"` : ""}${r.detectedProfessionalMention ? ` prof="${r.detectedProfessionalMention}"` : ""}${r.detectedDateMention ? ` fecha="${r.detectedDateMention}"` : ""}`);
      return r;
    },
  },
};

async function turno(texto: string, n: number) {
  const wamid = `validacion-${Date.now()}-${n}`;
  respuestasTurno = [];
  intenciones.length = 0;
  await registrarEnBandeja("entrante", texto, wamid);
  const r = await atenderMensajeWhatsAppQR({ supabase, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto, wamid }, deps);
  return { r, respuestas: [...respuestasTurno], gemini: [...intenciones] };
}

// --- Conversación ------------------------------------------------------------------------------------------------------
let fallos = 0;
let reserva = false;
let anterior = "";
for (const [i, texto] of mensajes.entries()) {
  const antes = await sesionAgendaReal(supabase, TELEFONO);
  const afirmacion = /^(1|s[ií]|confirmo|dale|listo|perfecto|ok)\b/i.test(texto.trim());
  if (antes?.step === "S5_CONFIRMAR" && afirmacion && !PERMITIR_RESERVA) {
    console.log(`\n[${i + 1}] "${texto}" -- DETENIDO: crearía una cita REAL. Usa --permitir-reserva.`);
    break;
  }
  console.log(`\n[${i + 1}] CLIENTA: ${texto}`);
  const { r, respuestas, gemini } = await turno(texto, i);
  console.log(`   capa: ${r.ok ? r.manejadoPor : `ERROR ${r.motivo}`}${gemini.length ? `   Gemini: ${gemini.join(" | ")}` : ""}`);
  for (const m of respuestas) console.log(`   AMORE: ${m.replace(/\n/g, "\n          ")}`);
  const despues = await sesionAgendaReal(supabase, TELEFONO);
  console.log(`   estado real: ${despues ? `${despues.step} profesional=${despues.profesional_id ?? "-"} fecha=${despues.fecha_iso ?? "-"}` : "sin sesión de agenda activa"}`);

  // Señales de calidad observables (además del contraste con la agenda real).
  const avisos: string[] = [];
  if (respuestas.length === 0 && r.ok && r.manejadoPor !== "atencion_humana") avisos.push("no respondió nada");
  if (respuestas.join("\n") === anterior && anterior) avisos.push("repitió EXACTAMENTE la respuesta anterior (posible bucle)");
  if (/No reconocí esa opción/.test(respuestas.join("\n"))) avisos.push("no entendió el mensaje (menú repetido)");
  if (r.ok && r.manejadoPor === "atencion_humana" && !/persona|jessica|asesor|alguien/i.test(texto)) avisos.push("TRANSFERENCIA a humano no pedida");
  if (gemini.some((g) => g.includes("ERROR TÉCNICO"))) avisos.push("Gemini falló técnicamente");
  for (const a of avisos) console.log(`   ⚠ ${a}`);
  anterior = respuestas.join("\n");

  if (antes?.step === "S5_CONFIRMAR" && afirmacion && !despues) reserva = true;
  const f = await contrastarConAgendaReal(supabase, nylasDeps, respuestas, despues, antes);
  for (const x of f) console.log(`   ✗ FALLA: ${x}`);
  fallos += f.length;
}

// --- Verificación de la reserva en la FUENTE (tabla de citas + calendario real de Nylas) --------------------------------
if (reserva) {
  const { data: citas } = await supabase
    .from("dulabs_citas_especialista")
    .select("id, especialista_id, servicio, inicio, fin, estado, telefono_cliente, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  const cita = (citas ?? []).find((c) => ultimos10(c.telefono_cliente as string) === prueba10);
  if (!cita) {
    console.log("\n[reserva] ✗ FALLA: la confirmación no dejó ninguna cita en dulabs_citas_especialista");
    fallos++;
  } else {
    console.log(`\n[reserva] ✓ cita ${cita.id} en la base: ${cita.servicio} -- especialista ${cita.especialista_id} -- ${cita.inicio} -> ${cita.fin} (${cita.estado})`);
    const calendarId = await resolverCalendarIdNylasDeEspecialista(supabase, AMORE_TENANT_ID, cita.especialista_id as number);
    if (calendarId) {
      const inicio = new Date(cita.inicio as string);
      const fin = new Date(cita.fin as string);
      const eventos = await nylasClient.listEvents({ grantId: nylasDeps.grantId, calendarId, startUnix: Math.floor(inicio.getTime() / 1000) - 60, endUnix: Math.ceil(fin.getTime() / 1000) + 60 });
      const coincide = eventos.some((e) => e.when.object === "timespan" && e.when.start_time === Math.floor(inicio.getTime() / 1000));
      console.log(coincide ? "[reserva] ✓ el evento existe en el calendario REAL de la profesional (Nylas)" : "[reserva] ✗ FALLA: no hay evento en el calendario real a esa hora");
      if (!coincide) fallos++;
    }
  }
} else if (await sesionAgendaReal(supabase, TELEFONO)) {
  console.log("\n[limpieza] cerrando la sesión de agenda de prueba con 'cancelar'…");
  await turno("cancelar", 999);
}

if (notificacionesRetenidas > 0) console.log(`\n[pipeline] ${notificacionesRetenidas} notificación(es) interna(s) retenida(s) -- nunca se enviaron.`);
console.log(`\n[pipeline] resultado: ${fallos === 0 ? "OK -- todas las respuestas coinciden con el estado real" : `${fallos} falla(s)`}`);
process.exit(fallos === 0 ? 0 : 1);
