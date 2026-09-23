// Diagnóstico de disponibilidad REAL de AMORE -- SOLO LECTURA.
//
// Para qué: contrastar lo que el bot responde ("no hay días con Cristal") contra el estado real del sistema. Recorre,
// por profesional elegible y por cada día del horizonte, EXACTAMENTE las mismas funciones que usa el bot
// (ventanasLaboralesEspecialista, bloqueosDelDia, resolverCalendarIdNylasDeEspecialista, cliente de Nylas,
// calcularHorariosDeEspecialista, calcularDiasCandidatosReales) y muestra en qué filtro se cae cada día.
//
// Nunca escribe nada (solo SELECT en Supabase y GET de eventos en Nylas). Nunca imprime claves, tokens ni el
// calendar_id completo (se enmascara).
//
// Uso:
//   npx tsx --env-file=.env.local scripts/amore-diagnostico-disponibilidad.mts [--servicio "Dipping"] [--profesional "Cristal"]
// Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NYLAS_API_KEY, NYLAS_GRANT_ID_AMORE.
import { createClient } from "@supabase/supabase-js";
import { AMORE_TENANT_ID, resolverNylasGrantIdParaTenant } from "@/lib/nylas/nylas-grant";
import { createNylasEventsClient, resolveNylasApiKeyFromEnv } from "@/lib/nylas/nylas-client";
import { resolverCalendarIdNylasDeEspecialista } from "@/lib/nylas/nylas-calendario-especialista";
import { eventosNylasComoVentanas } from "@/lib/nylas/nylas-eventos-ocupados";
import { ventanasLaboralesEspecialista, bloqueosDelDia, restarBloqueos } from "@/lib/especialistas";
import { calcularHorariosDeEspecialista } from "@/lib/disponibilidad-servicio-nylas";
import { resolverEspecialistasElegiblesParaServicio } from "@/lib/asignacion-categoria";
import { calcularDiasCandidatosReales, causaSinDias, HORIZONTE_DIAS_A_EVALUAR } from "@/lib/agenda-v2/disponibilidad";
import { sumarDias } from "@/lib/parse-fecha-colombia";
import { fechaColombiaDesdeIso, horaColombiaDesdeIso } from "@/lib/timezone-colombia";
import { normalizeText } from "@/lib/flow-triggers/normalize-text";

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function enmascarar(valor: string): string {
  const [local, dominio] = valor.split("@");
  if (dominio) return `${local!.slice(0, 2)}***@${dominio}`;
  return `${valor.slice(0, 4)}***(${valor.length} car.)`;
}

const faltan = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NYLAS_API_KEY", "NYLAS_GRANT_ID_AMORE"].filter((k) => !process.env[k]);
if (faltan.length > 0) {
  console.error(`[diagnóstico] faltan variables de entorno: ${faltan.join(", ")} (solo se revisa su presencia, nunca se imprimen).`);
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const grantId = resolverNylasGrantIdParaTenant(AMORE_TENANT_ID)!;
const nylas = createNylasEventsClient(resolveNylasApiKeyFromEnv()!);

const buscado = normalizeText(argumento("servicio") ?? "Dipping");
const { data: servicios } = await supabase.from("dulabs_servicios").select("id, nombre, duracion_min, activo").eq("id_tenant", AMORE_TENANT_ID).eq("activo", true);
const servicio = (servicios ?? []).find((s) => s.id === argumento("servicio") || normalizeText(s.nombre as string) === buscado);
if (!servicio) {
  console.error(`[diagnóstico] servicio no encontrado. Activos: ${(servicios ?? []).map((s) => s.nombre).join(", ")}`);
  process.exit(1);
}

const hoy = fechaColombiaDesdeIso(new Date().toISOString());
console.log(`\nAMORE -- diagnóstico de disponibilidad (solo lectura)`);
console.log(`Servicio: ${servicio.nombre} (${servicio.duracion_min} min)   Hoy (Bogotá): ${hoy}   Horizonte: ${HORIZONTE_DIAS_A_EVALUAR} días\n`);

const elegibles = await resolverEspecialistasElegiblesParaServicio(supabase, AMORE_TENANT_ID, servicio.id as string);
const filtroProfesional = argumento("profesional");
const profesionales = elegibles.especialistas.filter((e) => !filtroProfesional || normalizeText(e.nombre) === normalizeText(filtroProfesional));
console.log(`Elegibles para el servicio (modo ${elegibles.modo}), en el orden del menú: ${elegibles.especialistas.map((e, i) => `${i + 1}. ${e.nombre}`).join("  ")}\n`);

for (const p of profesionales) {
  const calendarId = await resolverCalendarIdNylasDeEspecialista(supabase, AMORE_TENANT_ID, p.especialistaId);
  const { data: horario } = await supabase.from("dulabs_horario_especialista").select("dia_semana, hora_inicio, hora_fin, activo").eq("id_tenant", AMORE_TENANT_ID).eq("especialista_id", p.especialistaId);
  const filasActivas = (horario ?? []).filter((h) => h.activo);

  console.log(`== ${p.nombre} (id ${p.especialistaId}) ==`);
  console.log(`   calendario Nylas: ${calendarId ? enmascarar(calendarId) : "NINGUNO (solo citas DuLabs)"}`);
  console.log(`   horario propio: ${filasActivas.length > 0 ? filasActivas.map((h) => `d${h.dia_semana} ${String(h.hora_inicio).slice(0, 5)}-${String(h.hora_fin).slice(0, 5)}`).join(", ") : "sin filas -> horario general del salón (L-V 9-19, S 9-18)"}`);

  const dias = await calcularDiasCandidatosReales(supabase, { idTenant: AMORE_TENANT_ID, servicioId: servicio.id as string, profesionalId: p.especialistaId }, { nylasClient: nylas, grantId });
  if (dias.ok) {
    const causa = dias.opciones.length === 0 ? ` -> causa: ${causaSinDias(dias)}${dias.detalleNoConfirmado ? ` (${dias.detalleNoConfirmado})` : ""}` : "";
    console.log(`   LO QUE EL BOT OFRECERÍA: ${dias.opciones.length > 0 ? dias.opciones.map((o) => o.fechaIso).join(", ") : "ningún día"}${causa}`);
  } else {
    console.log(`   LO QUE EL BOT OFRECERÍA: error ${dias.motivo}`);
  }

  console.log(`   fecha       jornada libre           nylas         eventos (ocupan/libres/día completo)   horarios`);
  for (let offset = 0; offset <= HORIZONTE_DIAS_A_EVALUAR; offset++) {
    const fecha = sumarDias(hoy, offset);
    const ventanas = restarBloqueos(
      await ventanasLaboralesEspecialista(supabase, p.especialistaId, AMORE_TENANT_ID, fecha),
      await bloqueosDelDia(supabase, p.especialistaId, AMORE_TENANT_ID, fecha),
    );
    const jornada = ventanas.length > 0 ? ventanas.map((v) => `${horaColombiaDesdeIso(v.apertura.toISOString())}-${horaColombiaDesdeIso(v.cierre.toISOString())}`).join(",") : "-- (no labora / bloqueado)";

    let estadoNylas = "sin calendario";
    let eventos = "";
    if (calendarId && ventanas.length > 0) {
      try {
        const lista = await nylas.listEvents({
          grantId,
          calendarId,
          startUnix: Math.floor(ventanas[0]!.apertura.getTime() / 1000),
          endUnix: Math.ceil(ventanas[ventanas.length - 1]!.cierre.getTime() / 1000),
        });
        const ocupan = eventosNylasComoVentanas(lista, fecha).length;
        const libres = lista.filter((e) => e.busy === false).length;
        const diaCompleto = lista.filter((e) => e.when.object !== "timespan").length;
        estadoNylas = "ok";
        eventos = `${lista.length} (${ocupan}/${libres}/${diaCompleto})`;
      } catch (err) {
        const status = (err as { status?: number }).status;
        estadoNylas = status ? `ERROR HTTP ${status}` : "ERROR (red/timeout)";
      }
    }

    let horarios = "";
    if (ventanas.length > 0) {
      const r = await calcularHorariosDeEspecialista(supabase, { idTenant: AMORE_TENANT_ID, especialista: { id: p.especialistaId, nombre: p.nombre }, fecha, duracionMin: servicio.duracion_min as number }, { nylasClient: nylas, grantId });
      horarios = r.estado === "ok" ? `${r.horarios.length}${r.horarios.length > 0 ? ` (${r.horarios.slice(0, 3).join(" ")}${r.horarios.length > 3 ? " …" : ""})` : ""}` : `no confirmado (${r.detalleNoConfirmado ?? "?"})`;
    }
    console.log(`   ${fecha}  ${jornada.padEnd(22)}  ${estadoNylas.padEnd(12)}  ${eventos.padEnd(37)}  ${horarios}`);
  }
  console.log("");
}
