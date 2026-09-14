/**
 * FASE 10 (Concurrencia, autorizado) — E2E real contra Supabase (tenant y
 * número SIEMPRE descartables) del hallazgo corregido en
 * app/api/dashboard/conversaciones/handoff/route.ts: dos agentes que tocan
 * "Tomar" casi al mismo tiempo sobre la MISMA conversación sin asignación
 * previa.
 *
 * Antes de la corrección, el INSERT en dulabs_conversacion_asignaciones no
 * revisaba su error -- si dos requests concurrentes leían
 * asignacionExistente=null y ambas intentaban el INSERT, la segunda fallaba
 * por el UNIQUE (phone_number_id, telefono_cliente) y ese error se
 * ignoraba en silencio: el endpoint respondía {success:true} a AMBOS
 * agentes, aunque solo uno realmente quedó asignado.
 *
 * Esta prueba reproduce la MISMA secuencia de operaciones que
 * handoff/route.ts (leer -> si no existe, insertar; código 23505 = otro
 * agente ganó la carrera, no es un error real) contra Postgres real, con
 * dos "agentes" disparando en paralelo de verdad (Promise.all), y verifica
 * que el resultado es determinista: exactamente un ganador, y quien pierde
 * la carrera lo sabe (no recibe un falso "quedó asignada a mí").
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

// Misma secuencia que el branch "tomar" de handoff/route.ts tras la
// corrección de F10: lee, y si no hay asignación previa, intenta el INSERT
// tratando 23505 como "alguien más ganó la carrera", nunca como error real.
async function intentarTomarConversacion(
  supabase: SupabaseClient,
  input: { phoneNumberId: string; telefonoCliente: string; miembroId: number },
): Promise<{ gane: boolean; errorInesperado: string | null }> {
  const { data: existente } = await supabase
    .from("dulabs_conversacion_asignaciones")
    .select("id, miembro_id")
    .eq("phone_number_id", input.phoneNumberId)
    .eq("telefono_cliente", input.telefonoCliente)
    .maybeSingle();

  if (existente) return { gane: existente.miembro_id === input.miembroId, errorInesperado: null };

  const { error } = await supabase.from("dulabs_conversacion_asignaciones").insert({
    phone_number_id: input.phoneNumberId,
    telefono_cliente: input.telefonoCliente,
    miembro_id: input.miembroId,
    asignado_por: input.miembroId,
  });
  if (!error) return { gane: true, errorInesperado: null };
  if (error.code === "23505") return { gane: false, errorInesperado: null };
  return { gane: false, errorInesperado: error.message };
}

describe(
  "F10 -- concurrencia real: dos agentes toman la misma conversación al mismo tiempo",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const sufijo = randomUUID().slice(0, 8);
    const tenantId = randomUUID();
    const phoneNumberId = `f10-race-${sufijo}`;
    const telefonoCliente = "573000000050";
    const userIds: string[] = [];

    after(async () => {
      if (!HAS_SUPABASE) return;
      await admin.from("dulabs_conversacion_asignaciones").delete().eq("phone_number_id", phoneNumberId);
      await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
      for (const userId of userIds) {
        await admin.auth.admin.deleteUser(userId);
      }
    });

    // dulabs_conversacion_asignaciones.miembro_id tiene FK real a
    // dulabs_miembros_equipo(id) -- hacen falta dos miembros de equipo
    // reales (con su propio auth.users) para que la carrera sea contra la
    // MISMA restricción que protege producción, no un id inventado.
    async function crearMiembroDescartable(sufijoAgente: string): Promise<number> {
      const email = `f10-race-${sufijo}-${sufijoAgente}@example.com`;
      const { data: userData, error: userErr } = await admin.auth.admin.createUser({
        email,
        password: `F10Test-${randomUUID()}`,
        email_confirm: true,
      });
      if (userErr) throw userErr;
      userIds.push(userData.user.id);
      const { data: miembroFila, error: miembroErr } = await admin
        .from("dulabs_miembros_equipo")
        .insert({ tenant_id: tenantId, user_id: userData.user.id, email, rol: "agente", estado: "activo" })
        .select("id")
        .single();
      if (miembroErr) throw miembroErr;
      return miembroFila.id as number;
    }

    it("exactamente un agente gana la carrera; el otro lo sabe (no un falso success)", async () => {
      const [miembroId1, miembroId2] = await Promise.all([crearMiembroDescartable("a"), crearMiembroDescartable("b")]);

      const [resultadoAgente1, resultadoAgente2] = await Promise.all([
        intentarTomarConversacion(admin, { phoneNumberId, telefonoCliente, miembroId: miembroId1 }),
        intentarTomarConversacion(admin, { phoneNumberId, telefonoCliente, miembroId: miembroId2 }),
      ]);

      assert.equal(resultadoAgente1.errorInesperado, null, resultadoAgente1.errorInesperado ?? undefined);
      assert.equal(resultadoAgente2.errorInesperado, null, resultadoAgente2.errorInesperado ?? undefined);

      const ganadores = [resultadoAgente1, resultadoAgente2].filter((r) => r.gane).length;
      assert.equal(ganadores, 1, "exactamente un agente debe ganar la carrera de asignación, nunca cero ni dos");

      const { data: filaFinal } = await admin
        .from("dulabs_conversacion_asignaciones")
        .select("miembro_id")
        .eq("phone_number_id", phoneNumberId)
        .eq("telefono_cliente", telefonoCliente)
        .maybeSingle();
      assert.ok(filaFinal?.miembro_id === miembroId1 || filaFinal?.miembro_id === miembroId2);

      // Quien ganó en el resultado reportado por la función debe coincidir
      // EXACTAMENTE con quién quedó realmente asignado en la base -- esto es
      // justo lo que estaba roto antes de la corrección (un falso "gané").
      const miembroGanadorReportado = resultadoAgente1.gane ? miembroId1 : miembroId2;
      assert.equal(filaFinal?.miembro_id, miembroGanadorReportado);
    });
  },
);
