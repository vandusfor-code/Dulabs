// Prueba REAL de punta a punta del bot de AMORE por WhatsApp:
//
//   DuLabs (3148127388) --WhatsApp real--> AMORE --worker--> /api/whatsapp-qr-bot --> bot (gates, Agenda V2, Gemini,
//   Nylas) --worker--> WhatsApp real --> bandeja de DuLabs
//
// Envía cada mensaje DESDE la sesión de WhatsApp de DuLabs (worker, POST /tenants/<dulabs>/enviar), espera las
// respuestas reales de AMORE que el worker de DuLabs persiste en dulabs_chat_mensajes, y después de cada turno
// CONTRASTA la respuesta contra el estado real del sistema (sesión de Agenda V2 + agenda real con Nylas): si el bot dice
// "no hay días" y la agenda real sí los tiene, o si ofrece un día/hora que la agenda real no tiene, el turno FALLA.
//
// OJO: prueba el bot DESPLEGADO en producción (el que responde a WhatsApp de verdad). Para validar el código de una rama
// SIN desplegarlo, usar scripts/amore-pipeline-real.mts.
//
// ENVÍA MENSAJES REALES. Salvaguardas:
// - Sin --confirmar no envía nada (solo muestra el plan y verifica la configuración).
// - Solo AMORE (tenant fijo) y solo desde el número de prueba.
// - Nunca envía una confirmación de reserva ("sí"/"1" en el paso de confirmar) sin --permitir-reserva: el turno se
//   detiene antes, así ninguna cita real queda creada por accidente.
// - Al terminar envía "cancelar" para cerrar la sesión de agenda abierta (salvo que se haya creado una reserva).
// - Nunca imprime claves, tokens ni secretos.
//
// Uso:
//   npx tsx --env-file=.env.local scripts/amore-conversacion-real.mts --escenario cristal [--confirmar] [--permitir-reserva]
//   npx tsx --env-file=.env.local scripts/amore-conversacion-real.mts --mensajes "Hola|Quiero una cita|..." --confirmar
// Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_WORKER_URL, WHATSAPP_WORKER_SECRET, NYLAS_API_KEY,
// NYLAS_GRANT_ID_AMORE.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AMORE_TENANT_ID, resolverNylasGrantIdParaTenant } from "@/lib/nylas/nylas-grant";
import { createNylasEventsClient, resolveNylasApiKeyFromEnv } from "@/lib/nylas/nylas-client";
import { sesionAgendaReal, contrastarConAgendaReal } from "@/lib/testing/amore-contraste-real";

const ESCENARIOS: Record<string, string[]> = {
  // El bug reportado, con lenguaje natural en vez de números.
  cristal: ["Hola", "Quiero una cita", "uñas", "dipping", "Quiero con Cristal"],
  // El mismo bug por el camino exacto de la conversación real (menús numéricos).
  cristal_numeros: ["Hola", "1", "2", "1", "2"],
  natural: ["Hola hermosa", "Estoy mirando porque quiero hacerme las uñas para una boda jajaja", "¿Cuánto cuesta el dipping?", "¿Cuánto demora?"],
  me_da_igual: ["Hola", "Quiero una cita", "uñas", "dipping", "me da igual quién"],
};

function arg(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const bandera = (nombre: string) => process.argv.includes(`--${nombre}`);
const digitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const ultimos10 = (s: string | null | undefined) => digitos(s).slice(-10);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TELEFONO_PRUEBA = ultimos10(arg("telefono-prueba") ?? "3148127388");
const CONFIRMAR = bandera("confirmar");
const PERMITIR_RESERVA = bandera("permitir-reserva");
const mensajes = arg("mensajes")?.split("|").map((m) => m.trim()).filter(Boolean) ?? ESCENARIOS[arg("escenario") ?? "cristal"];
if (!mensajes) {
  console.error(`[real] escenario desconocido. Disponibles: ${Object.keys(ESCENARIOS).join(", ")}`);
  process.exit(1);
}

const requeridas = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "WHATSAPP_WORKER_URL", "WHATSAPP_WORKER_SECRET", "NYLAS_API_KEY", "NYLAS_GRANT_ID_AMORE"];
const faltan = requeridas.filter((k) => !process.env[k]);
if (faltan.length > 0) {
  console.error(`[real] faltan variables de entorno: ${faltan.join(", ")} (solo se revisa su presencia, nunca se imprimen).`);
  process.exit(1);
}

const supabase: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const nylasDeps = { nylasClient: createNylasEventsClient(resolveNylasApiKeyFromEnv()!), grantId: resolverNylasGrantIdParaTenant(AMORE_TENANT_ID)! };

// --- 1. Sesiones reales conectadas en el worker -------------------------------------------------------------------
const { data: sesiones } = await supabase.from("dulabs_whatsapp_qr_sesiones").select("id_tenant, slot, estado, numero_conectado").eq("estado", "conectado");
const remitente = (sesiones ?? []).find((s) => ultimos10(s.numero_conectado as string) === TELEFONO_PRUEBA);
const amore = (sesiones ?? []).find((s) => s.id_tenant === AMORE_TENANT_ID);
if (!remitente) {
  console.error(`[real] el número de prueba ***${TELEFONO_PRUEBA.slice(-4)} no tiene una sesión de WhatsApp CONECTADA en el worker -- conéctalo desde el panel de DuLabs.`);
  process.exit(1);
}
if (!amore?.numero_conectado) {
  console.error("[real] AMORE no tiene una sesión de WhatsApp conectada en el worker.");
  process.exit(1);
}
const numeroAmore = digitos(amore.numero_conectado as string);
console.log(`[real] remitente: tenant ${String(remitente.id_tenant).slice(0, 8)}… slot ${remitente.slot} (***${TELEFONO_PRUEBA.slice(-4)})  ->  AMORE ***${numeroAmore.slice(-4)}`);
console.log(`[real] mensajes: ${JSON.stringify(mensajes)}`);
if (!CONFIRMAR) {
  console.log("[real] modo verificación: configuración OK. Agrega --confirmar para enviar los mensajes REALES.");
  process.exit(0);
}

// --- 2. Envío real y lectura de respuestas reales -------------------------------------------------------------------
async function enviarDesdeDulabs(texto: string): Promise<void> {
  const res = await fetch(`${process.env.WHATSAPP_WORKER_URL}/tenants/${remitente!.id_tenant}/enviar?slot=${remitente!.slot ?? 1}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_WORKER_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({ telefono: numeroAmore, mensaje: texto }),
  });
  if (!res.ok) throw new Error(`el worker rechazó el envío (HTTP ${res.status})`);
}

async function respuestasDesde(desdeIso: string): Promise<string[]> {
  const { data: conv } = await supabase.from("dulabs_chat_conversaciones").select("id, telefono").eq("id_tenant", remitente!.id_tenant);
  const conversacion = (conv ?? []).find((c) => ultimos10(c.telefono as string) === ultimos10(numeroAmore));
  if (!conversacion) return [];
  const { data } = await supabase
    .from("dulabs_chat_mensajes")
    .select("texto, created_at")
    .eq("conversacion_id", conversacion.id)
    .eq("direccion", "entrante")
    .gt("created_at", desdeIso)
    .order("created_at", { ascending: true });
  return (data ?? []).map((m) => (m.texto as string | null) ?? "[sin texto]");
}

/** Espera las respuestas de AMORE: hasta que dejan de llegar mensajes nuevos durante 7 s (el bot puede mandar 2), máx 75 s. */
async function esperarRespuestas(desdeIso: string): Promise<string[]> {
  const limite = Date.now() + 75_000;
  let vistas: string[] = [];
  let ultimoCambio = Date.now();
  while (Date.now() < limite) {
    await esperar(2_000);
    const actuales = await respuestasDesde(desdeIso);
    if (actuales.length !== vistas.length) {
      vistas = actuales;
      ultimoCambio = Date.now();
    } else if (vistas.length > 0 && Date.now() - ultimoCambio > 7_000) {
      break;
    }
  }
  return vistas;
}

// --- 3. Estado real y contraste (módulo compartido con scripts/amore-pipeline-real.mts) ---------------------------------
const sesionAgendaActual = () => sesionAgendaReal(supabase, TELEFONO_PRUEBA);

// --- 4. Conversación -------------------------------------------------------------------------------------------------
let totalFallos = 0;
let reservaCreada = false;
for (const [i, mensaje] of mensajes.entries()) {
  const antes = await sesionAgendaActual();
  const esConfirmacion = antes?.step === "S5_CONFIRMAR" && /^(1|s[ií]|confirmo|dale|listo|perfecto)\b/i.test(mensaje.trim());
  if (esConfirmacion && !PERMITIR_RESERVA) {
    console.log(`\n[${i + 1}] "${mensaje}" -- DETENIDO: crearía una cita REAL. Usa --permitir-reserva si de verdad quieres reservar.`);
    break;
  }
  const desde = new Date().toISOString();
  console.log(`\n[${i + 1}] DuLabs -> AMORE: ${mensaje}`);
  await enviarDesdeDulabs(mensaje);
  const respuestas = await esperarRespuestas(desde);
  if (respuestas.length === 0) {
    console.log("   ✗ AMORE no respondió en 75 s");
    totalFallos++;
    continue;
  }
  for (const r of respuestas) console.log(`   AMORE: ${r.replace(/\n/g, "\n          ")}`);
  const despues = await sesionAgendaActual();
  console.log(`   estado real: ${despues ? `${despues.step} profesional=${despues.profesional_id ?? "-"} fecha=${despues.fecha_iso ?? "-"}` : "sin sesión de agenda activa"}`);
  if (esConfirmacion && !despues) reservaCreada = true;
  const fallos = await contrastarConAgendaReal(supabase, nylasDeps, respuestas, despues, antes);
  for (const f of fallos) console.log(`   ✗ FALLA: ${f}`);
  totalFallos += fallos.length;
}

if (!reservaCreada && (await sesionAgendaActual())) {
  console.log("\n[limpieza] cerrando la sesión de agenda de prueba con 'cancelar'…");
  await enviarDesdeDulabs("cancelar");
}
console.log(`\n[real] resultado: ${totalFallos === 0 ? "OK -- todas las respuestas coinciden con el estado real" : `${totalFallos} falla(s)`}`);
process.exit(totalFallos === 0 ? 0 : 1);
