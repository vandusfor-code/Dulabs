// Diagnóstico de disponibilidad REAL de AMORE -- SOLO LECTURA.
//
// Para cada profesional elegible y cada día del horizonte muestra, con las MISMAS funciones del bot:
//   1. jornada laboral (horario propio o general) y bloqueos      5. citas DuLabs que ocupan tiempo
//   2. eventos que devuelve Nylas (hora, busy/libre, día completo) 6. horarios que calcula el backend (lógica ACTUAL)
//   3/4. cuáles ocupan (busy) y cuáles están marcados "Libre"     7-9. errores de Nylas (403 / 404 / otros / timeout)
//   10. lo que AMORE ofrece de verdad (calcularDiasCandidatosReales) y la causa si no ofrece nada
// y, para aislar la causa REAL del bug, los horarios que habría calculado la lógica ANTERIOR sobre los mismos datos
// (eventos "Libre" contados como ocupados). Nunca escribe nada; nunca imprime claves ni el calendar_id completo.
//
// Uso:
//   npx tsx --env-file=.env.local scripts/amore-diagnostico-disponibilidad.mts [--servicio "Dipping"] [--profesional "Cristal"] [--dias 14] [--detalle]
// Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NYLAS_API_KEY, NYLAS_GRANT_ID_AMORE.
import { createClient } from "@supabase/supabase-js";
import { AMORE_TENANT_ID, resolverNylasGrantIdParaTenant } from "@/lib/nylas/nylas-grant";
import { createNylasEventsClient, resolveNylasApiKeyFromEnv } from "@/lib/nylas/nylas-client";
import { resolverCalendarIdNylasDeEspecialista } from "@/lib/nylas/nylas-calendario-especialista";
import { eventosNylasComoVentanas } from "@/lib/nylas/nylas-eventos-ocupados";
import type { NylasEvent } from "@/lib/nylas/nylas-types";
import { ventanasLaboralesEspecialista, bloqueosDelDia, restarBloqueos, generarHorariosLibres } from "@/lib/especialistas";
import { citasOcupadasDelDia } from "@/lib/disponibilidad-servicio";
import { calcularHorariosDeEspecialista } from "@/lib/disponibilidad-servicio-nylas";
import { resolverEspecialistasElegiblesParaServicio } from "@/lib/asignacion-categoria";
import { calcularDiasCandidatosReales, causaSinDias, HORIZONTE_DIAS_A_EVALUAR } from "@/lib/agenda-v2/disponibilidad";
import { sumarDias } from "@/lib/parse-fecha-colombia";
import { fechaColombiaDesdeIso, horaColombiaDesdeIso } from "@/lib/timezone-colombia";
import { normalizeText } from "@/lib/flow-triggers/normalize-text";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const DETALLE = process.argv.includes("--detalle");

function enmascarar(valor: string): string {
  const [local, dominio] = valor.split("@");
  if (dominio) return `${local!.slice(0, 2)}***@${dominio}`;
  return `${valor.slice(0, 4)}***(${valor.length} car.)`;
}
const hora = (d: Date) => horaColombiaDesdeIso(d.toISOString());
function describirEvento(e: NylasEvent): string {
  const tipo = e.busy === false ? "LIBRE" : e.busy === true ? "busy" : "busy?(sin dato)";
  const cuando =
    e.when.object === "timespan"
      ? `${hora(new Date(e.when.start_time * 1000))}-${hora(new Date(e.when.end_time * 1000))}`
      : e.when.object === "date"
        ? `día completo ${e.when.date}`
        : `días ${e.when.start_date}..${e.when.end_date}`;
  return `${cuando} ${tipo}${e.status && e.status !== "confirmed" ? ` [${e.status}]` : ""}`;
}

const faltan = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NYLAS_API_KEY", "NYLAS_GRANT_ID_AMORE"].filter((k) => !process.env[k]);
if (faltan.length > 0) {
  console.error(`[diagnóstico] faltan variables de entorno: ${faltan.join(", ")} (solo se revisa su presencia, nunca se imprimen).`);
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const grantId = resolverNylasGrantIdParaTenant(AMORE_TENANT_ID)!;
const nylas = createNylasEventsClient(resolveNylasApiKeyFromEnv()!);
const nylasDeps = { nylasClient: nylas, grantId };

const buscado = normalizeText(arg("servicio") ?? "Dipping");
const { data: servicios } = await supabase.from("dulabs_servicios").select("id, nombre, duracion_min, activo").eq("id_tenant", AMORE_TENANT_ID).eq("activo", true);
const servicio = (servicios ?? []).find((s) => s.id === arg("servicio") || normalizeText(s.nombre as string) === buscado);
if (!servicio) {
  console.error(`[diagnóstico] servicio no encontrado. Activos: ${(servicios ?? []).map((s) => s.nombre).join(", ")}`);
  process.exit(1);
}
const duracion = servicio.duracion_min as number;
const dias = Math.min(Number(arg("dias") ?? HORIZONTE_DIAS_A_EVALUAR), 31);

const hoy = fechaColombiaDesdeIso(new Date().toISOString());
console.log(`\nAMORE -- diagnóstico de disponibilidad REAL (solo lectura)`);
console.log(`Servicio: ${servicio.nombre} (${duracion} min)   Hoy (Bogotá): ${hoy}   Días evaluados: ${dias + 1}`);

const elegibles = await resolverEspecialistasElegiblesParaServicio(supabase, AMORE_TENANT_ID, servicio.id as string);
const filtro = arg("profesional");
const profesionales = elegibles.especialistas.filter((e) => !filtro || normalizeText(e.nombre) === normalizeText(filtro));
console.log(`Menú real de profesionales (modo ${elegibles.modo}): ${elegibles.especialistas.map((e, i) => `${i + 1}. ${e.nombre}`).join("  ")}\n`);

const resumen: string[] = [];
for (const p of profesionales) {
  const calendarId = await resolverCalendarIdNylasDeEspecialista(supabase, AMORE_TENANT_ID, p.especialistaId);
  const { data: horario } = await supabase.from("dulabs_horario_especialista").select("dia_semana, hora_inicio, hora_fin, activo").eq("id_tenant", AMORE_TENANT_ID).eq("especialista_id", p.especialistaId);
  const filas = (horario ?? []).filter((h) => h.activo);

  console.log(`══ ${p.nombre} (id ${p.especialistaId}) ══`);
  console.log(`   calendario Nylas: ${calendarId ? enmascarar(calendarId) : "NINGUNO (solo citas DuLabs)"}`);
  console.log(`   horario laboral: ${filas.length > 0 ? filas.map((h) => `d${h.dia_semana} ${String(h.hora_inicio).slice(0, 5)}-${String(h.hora_fin).slice(0, 5)}`).join(", ") : "sin filas propias -> horario general del salón (L-V 9-19, S 9-18, D cerrado)"}`);
  console.log("   fecha       jornada libre       citas  nylas         eventos (busy/libre/día-compl.)   ANTES  AHORA");

  let diasAntes = 0;
  let diasAhora = 0;
  const errores = new Map<string, number>();
  let eventosLibres = 0;
  for (let offset = 0; offset <= dias; offset++) {
    const fecha = sumarDias(hoy, offset);
    const base = await ventanasLaboralesEspecialista(supabase, p.especialistaId, AMORE_TENANT_ID, fecha);
    const bloqueos = await bloqueosDelDia(supabase, p.especialistaId, AMORE_TENANT_ID, fecha);
    const ventanas = restarBloqueos(base, bloqueos);
    if (ventanas.length === 0) {
      console.log(`   ${fecha}  ${(base.length === 0 ? "no labora" : `bloqueado (${bloqueos.length} bloqueo/s)`).padEnd(18)}`);
      continue;
    }
    const jornada = ventanas.map((v) => `${hora(v.apertura)}-${hora(v.cierre)}`).join(",");
    const desde = ventanas[0]!.apertura;
    const hasta = ventanas[ventanas.length - 1]!.cierre;
    const citas = await citasOcupadasDelDia(supabase, p.especialistaId, desde.toISOString(), hasta.toISOString());

    let estadoNylas = "sin calendario";
    let resumenEventos = "";
    let lista: NylasEvent[] = [];
    if (calendarId) {
      try {
        lista = await nylas.listEvents({ grantId, calendarId, startUnix: Math.floor(desde.getTime() / 1000), endUnix: Math.ceil(hasta.getTime() / 1000) });
        estadoNylas = "ok";
        const libres = lista.filter((e) => e.busy === false && e.status !== "cancelled").length;
        eventosLibres += libres;
        resumenEventos = `${lista.length} (${eventosNylasComoVentanas(lista, fecha).length}/${libres}/${lista.filter((e) => e.when.object !== "timespan").length})`;
      } catch (err) {
        const status = (err as { status?: number }).status;
        const nombre = err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted")) ? "TIMEOUT" : status ? `HTTP ${status}` : `ERROR ${(err as Error).message?.slice(0, 40)}`;
        estadoNylas = nombre;
        errores.set(nombre, (errores.get(nombre) ?? 0) + 1);
      }
    }

    // AHORA: exactamente el motor del bot.
    const actual = await calcularHorariosDeEspecialista(supabase, { idTenant: AMORE_TENANT_ID, especialista: { id: p.especialistaId, nombre: p.nombre }, fecha, duracionMin: duracion }, nylasDeps);
    const ahora = actual.estado === "ok" ? `${actual.horarios.length}` : `NO CONF.`;
    if (actual.estado === "ok" && actual.horarios.length > 0) diasAhora++;

    // ANTES: mismos datos, eventos "Libre" contados como ocupados, y un error de Nylas = 0 horarios.
    let antes = "0";
    if (estadoNylas === "ok" || estadoNylas === "sin calendario") {
      try {
        const ocupadasAntes = [...citas, ...eventosNylasComoVentanas(lista.map((e) => ({ ...e, busy: undefined })), fecha)];
        const n = generarHorariosLibres(ventanas, ocupadasAntes, duracion).filter((d) => d.getTime() > Date.now()).length;
        antes = String(n);
        if (n > 0) diasAntes++;
      } catch {
        antes = "?"; // evento de forma desconocida: la lógica actual lo marca "no confirmado"
      }
    }

    const marca = antes === "0" && ahora !== "0" && ahora !== "NO CONF." ? "  <== el bug: ANTES 0, AHORA hay" : "";
    console.log(`   ${fecha}  ${jornada.padEnd(18)}  ${String(citas.length).padEnd(5)}  ${estadoNylas.padEnd(12)}  ${resumenEventos.padEnd(31)}  ${antes.padEnd(5)}  ${ahora}${marca}`);
    if (DETALLE && lista.length > 0) for (const e of lista) console.log(`        · evento ${describirEvento(e)}`);
    if (DETALLE && citas.length > 0) for (const c of citas) console.log(`        · cita DuLabs ${hora(c.apertura)}-${hora(c.cierre)}`);
    if (DETALLE && actual.estado === "ok" && actual.horarios.length > 0) console.log(`        · horarios AHORA: ${actual.horarios.join(" ")}`);
  }

  const bot = await calcularDiasCandidatosReales(supabase, { idTenant: AMORE_TENANT_ID, servicioId: servicio.id as string, profesionalId: p.especialistaId }, nylasDeps);
  const ofrece = bot.ok ? (bot.opciones.length > 0 ? bot.opciones.map((o) => o.fechaIso).join(", ") : `ningún día -- causa: ${causaSinDias(bot)}${bot.detalleNoConfirmado ? ` (${bot.detalleNoConfirmado})` : ""}`) : `error ${bot.motivo}`;
  console.log(`   ► LO QUE AMORE OFRECE AHORA: ${ofrece}`);
  console.log(`   ► días con horarios: ANTES ${diasAntes} / AHORA ${diasAhora}   eventos "Libre" vistos: ${eventosLibres}   errores Nylas: ${errores.size > 0 ? [...errores].map(([k, v]) => `${k} x${v}`).join(", ") : "ninguno"}\n`);
  resumen.push(`${p.nombre.padEnd(10)} ANTES ${String(diasAntes).padEnd(3)} AHORA ${String(diasAhora).padEnd(3)} libres=${String(eventosLibres).padEnd(3)} errores=${errores.size > 0 ? [...errores].map(([k, v]) => `${k}x${v}`).join(",") : "0"}   ofrece: ${ofrece}`);
}

console.log("RESUMEN (días con al menos un horario, lógica ANTERIOR vs ACTUAL, mismos datos reales):");
for (const l of resumen) console.log(`  ${l}`);
