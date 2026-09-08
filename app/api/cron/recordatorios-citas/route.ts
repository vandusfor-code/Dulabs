import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { clienteDeEspecialista, notificarRecordatorioCita } from "@/lib/especialistas-notificar";
import { enviarRecordatorioAmore, type DepsRecordatorioAmore } from "@/lib/amore-recordatorio-citas";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import type { ClienteConfig } from "@/lib/supabase";

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
 * Busca citas confirmadas cuyo inicio cae en la ventana de 55 a 65 minutos
 * desde ahora (MISMA ventana ya establecida, sin cambios) y les manda el
 * recordatorio una sola vez -- `recordatorio_enviado` (ya existente en
 * producción, ver 20260825230000_recordatorio_citas.sql) evita reenviarlo
 * en la siguiente pasada, y solo se marca DESPUÉS de un envío exitoso real
 * (un fallo de envío nunca lo marca, así el siguiente intento reintenta sin
 * duplicar nada).
 *
 * AMORE (autorizado, Fase Final) -- único cambio de comportamiento real:
 * sus citas se envían por el canal WhatsApp-QR/Baileys (enviarRecordatorioAmore)
 * en vez del canal de Meta Cloud API que usa el resto de tenants
 * (notificarRecordatorioCita) -- AMORE no tiene un token real de Meta, ver
 * lib/amore-recordatorio-citas.ts. Cualquier otro tenant sigue EXACTAMENTE
 * el mismo camino de siempre, sin ningún cambio.
 */
export async function ejecutarRecordatoriosCitas(deps: DepsEjecutarRecordatorios = {}): Promise<{ enviados: number; errores: string[] }> {
  const supabase = deps.supabase ?? supabaseAdmin();
  const ahoraFn = deps.ahora ?? (() => new Date());
  const buscarCliente = deps.clienteDeEspecialista ?? clienteDeEspecialista;
  const notificarMeta = deps.notificarRecordatorioCita ?? notificarRecordatorioCita;

  const ahora = ahoraFn();
  const desde = new Date(ahora.getTime() + 55 * 60_000);
  const hasta = new Date(ahora.getTime() + 65 * 60_000);

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

  for (const cita of (citas ?? []) as CitaPendienteRecordatorio[]) {
    try {
      let ok: boolean;

      if (cita.id_tenant === AMORE_TENANT_ID) {
        ok = await enviarRecordatorioAmore(supabase, cita.id_tenant, cita, deps.amoreDeps);
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
