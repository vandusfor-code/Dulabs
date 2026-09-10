import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { clienteDeEspecialista, notificarRecordatorioCita } from "@/lib/especialistas-notificar";
import { enviarRecordatorioAmore, type DepsRecordatorioAmore } from "@/lib/amore-recordatorio-citas";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import type { ClienteConfig } from "@/lib/supabase";
import { obtenerConfigComunicaciones } from "@/lib/comunicaciones/config";
import { ANTICIPACIONES_RECORDATORIO_MINUTOS } from "@/lib/comunicaciones/tipos";

export const runtime = "nodejs";
export const maxDuration = 60;

type CitaPendienteRecordatorio = {
  id: number;
  id_tenant: string;
  especialista_id: number;
  phone_number_id: string;
  telefono_cliente: string | null;
  nombre_cliente: string;
  servicio: string;
  inicio: string;
};

export interface DepsEjecutarRecordatorios {
  supabase?: SupabaseClient;
  ahora?: () => Date;
  clienteDeEspecialista?: typeof clienteDeEspecialista;
  notificarRecordatorioCita?: typeof notificarRecordatorioCita;
  amoreDeps?: DepsRecordatorioAmore;
  /** Inyectable para pruebas -- default real: obtenerConfigComunicaciones (lib/comunicaciones/config.ts). */
  obtenerConfigComunicaciones?: typeof obtenerConfigComunicaciones;
  /**
   * SOLO para pruebas -- JAMÁS se usa en producción real (route.ts nunca lo
   * pasa). Restringe la consulta a un único tenant desechable, para que un
   * test nunca pueda barrer/tocar una cita real de producción (mismo
   * criterio de seguridad exacto ya establecido en
   * app/api/cron/seguimiento-traspaso/route.ts tras un incidente real).
   */
  soloIdTenant?: string;
}

/**
 * Núcleo real del cron -- extraído a función propia para que las pruebas
 * puedan invocarlo con `soloIdTenant` fijado a un tenant de prueba y
 * dependencias falsas (WhatsApp/Meta nunca reales), sin pasar por HTTP ni
 * por la tabla completa de producción.
 *
 * Busca citas confirmadas cuyo inicio cae dentro de una ventana AMPLIA
 * (10 min a 2885 min desde ahora -- cubre las 9 anticipaciones reales
 * posibles, 15 min a 2 días, con el mismo margen ±5 min de siempre) y para
 * cada cita evalúa, según la anticipación REAL configurada por su tenant
 * (dulabs_comunicaciones_config.recordatorio_anticipacion_minutos, mejora
 * autorizada -- antes esto era fijo/no leído, ver
 * lib/comunicaciones/config.ts), si YA es su momento exacto de enviarse
 * (objetivo = inicio - anticipación, con el mismo margen ±5 min de siempre
 * -- un tenant sin configuración guardada usa 60 min, IDÉNTICO al
 * comportamiento anterior sin ningún cambio). `recordatorio_enviado` (ya
 * existente en producción, ver 20260825230000_recordatorio_citas.sql) evita
 * reenviarlo en la siguiente pasada, y solo se marca DESPUÉS de un envío
 * exitoso real (un fallo de envío nunca lo marca, así el siguiente intento
 * reintenta sin duplicar nada).
 *
 * AMORE (autorizado, Fase Final) -- único cambio de comportamiento real:
 * sus citas se envían por el canal WhatsApp-QR/Baileys (enviarRecordatorioAmore)
 * en vez del canal de Meta Cloud API que usa el resto de tenants
 * (notificarRecordatorioCita) -- AMORE no tiene un token real de Meta, ver
 * lib/amore-recordatorio-citas.ts. Cualquier otro tenant sigue EXACTAMENTE
 * el mismo camino de siempre, sin ningún cambio.
 *
 * Mejora Recordatorios (autorizado) -- el TEXTO del mensaje de AMORE ahora
 * también viene de esa misma configuración (recordatorio_mensaje, con las
 * variables {{nombre}}/{{servicio}}/{{profesional}}/{{fecha}}/{{hora}}
 * reemplazadas de verdad), en vez del texto fijo de siempre. Deliberadamente
 * NO se toca el interruptor "activo" (recordatorio_activo): hoy el envío es
 * incondicional para todos los tenants (nunca lo filtró), y como la tabla
 * está vacía en producción (ninguna fila para AMORE todavía), conectar ese
 * interruptor apagaría de inmediato los recordatorios reales de AMORE que
 * SÍ están funcionando -- queda documentado como hallazgo aparte, no como
 * parte de este cambio.
 */
export async function ejecutarRecordatoriosCitas(deps: DepsEjecutarRecordatorios = {}): Promise<{ enviados: number; errores: string[] }> {
  const supabase = deps.supabase ?? supabaseAdmin();
  const ahoraFn = deps.ahora ?? (() => new Date());
  const buscarCliente = deps.clienteDeEspecialista ?? clienteDeEspecialista;
  const notificarMeta = deps.notificarRecordatorioCita ?? notificarRecordatorioCita;
  const obtenerConfig = deps.obtenerConfigComunicaciones ?? obtenerConfigComunicaciones;

  const ahora = ahoraFn();
  const TOLERANCIA_MIN = 5;
  const minAnticipacion = Math.min(...ANTICIPACIONES_RECORDATORIO_MINUTOS);
  const maxAnticipacion = Math.max(...ANTICIPACIONES_RECORDATORIO_MINUTOS);
  const desde = new Date(ahora.getTime() + (minAnticipacion - TOLERANCIA_MIN) * 60_000);
  const hasta = new Date(ahora.getTime() + (maxAnticipacion + TOLERANCIA_MIN) * 60_000);

  let consulta = supabase
    .from("dulabs_citas_especialista")
    .select("id, id_tenant, especialista_id, phone_number_id, telefono_cliente, nombre_cliente, servicio, inicio")
    .eq("estado", "confirmada")
    .eq("recordatorio_enviado", false)
    .not("telefono_cliente", "is", null)
    .gte("inicio", desde.toISOString())
    .lt("inicio", hasta.toISOString());
  if (deps.soloIdTenant) {
    consulta = consulta.eq("id_tenant", deps.soloIdTenant);
  }
  const { data: citas, error } = await consulta;

  if (error) {
    // Nunca rompe el cron -- no-op seguro (mismo criterio que
    // encuestas-seguimiento con sus propias tablas).
    return { enviados: 0, errores: [`no se pudo consultar dulabs_citas_especialista: ${error.message}`] };
  }

  let enviados = 0;
  const errores: string[] = [];
  const clientesCache = new Map<string, ClienteConfig | null>();
  const configCache = new Map<string, Awaited<ReturnType<typeof obtenerConfigComunicaciones>>>();

  for (const cita of (citas ?? []) as CitaPendienteRecordatorio[]) {
    try {
      // Momento exacto de esta cita según la anticipación REAL configurada
      // por su tenant (60 min = comportamiento idéntico al de siempre si el
      // tenant nunca guardó nada). Mismo margen ±5 min de siempre -- todavía
      // no es su momento -> se omite en ESTA pasada, la siguiente (cada
      // ~10 min) la vuelve a evaluar sin perderla (recordatorio_enviado
      // sigue en false).
      if (!configCache.has(cita.id_tenant)) {
        configCache.set(cita.id_tenant, await obtenerConfig(supabase, cita.id_tenant));
      }
      const config = configCache.get(cita.id_tenant)!;
      const objetivoMs = new Date(cita.inicio).getTime() - config.recordatorioAnticipacionMinutos * 60_000;
      const dentroDeVentana = ahora.getTime() > objetivoMs - TOLERANCIA_MIN * 60_000 && ahora.getTime() <= objetivoMs + TOLERANCIA_MIN * 60_000;
      if (!dentroDeVentana) continue;

      let ok: boolean;

      if (cita.id_tenant === AMORE_TENANT_ID) {
        // Solo se pasa la plantilla cuando el tenant YA tiene una fila real
        // guardada -- si nunca configuró nada (caso de AMORE hoy, tabla
        // vacía), el motor sigue usando construirTextoRecordatorioAmore
        // EXACTO de siempre (incluye el formato especial de multi-servicio),
        // para que el día del deploy ningún recordatorio cambie de texto sin
        // que el admin haya guardado nada todavía.
        const mensajePlantilla = config.tieneConfiguracionGuardada ? config.recordatorioMensaje : undefined;
        ok = await enviarRecordatorioAmore(supabase, cita.id_tenant, cita, deps.amoreDeps, mensajePlantilla);
      } else {
        if (!clientesCache.has(cita.phone_number_id)) {
          clientesCache.set(cita.phone_number_id, await buscarCliente(supabase, cita.phone_number_id));
        }
        const cliente = clientesCache.get(cita.phone_number_id) ?? null;
        if (!cliente) {
          errores.push(`${cita.id}: sin configuración de cliente para ${cita.phone_number_id}`);
          continue;
        }
        ok = await notificarMeta(cliente, cita);
      }

      if (!ok) {
        errores.push(`${cita.id}: no se pudo enviar el recordatorio`);
        continue;
      }
      await supabase.from("dulabs_citas_especialista").update({ recordatorio_enviado: true }).eq("id", cita.id);
      enviados++;
    } catch (err) {
      errores.push(`${cita.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { enviados, errores };
}

// Disparado periódicamente por QStash (mismo mecanismo que
// /api/cron/encuestas-seguimiento -- ver lib/cron-auth.ts: los crons
// nativos de Vercel en plan Hobby solo corren 1 vez al día, insuficiente
// para avisar "1 hora antes"). Pensado para correr cada ~10 minutos.
//
// Acepta GET y POST -- QStash crea sus Schedules en POST por defecto, y no
// vale la pena obligar a cambiarlo a mano en su panel cuando aceptar ambos
// es gratis.
async function manejar(request: NextRequest) {
  const cuerpo = await request.text();
  if (!(await solicitudAutorizadaCron(request, cuerpo))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const resultado = await ejecutarRecordatoriosCitas();
  return Response.json(resultado);
}

export async function GET(request: NextRequest) {
  return manejar(request);
}

export async function POST(request: NextRequest) {
  return manejar(request);
}
