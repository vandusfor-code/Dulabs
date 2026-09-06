/**
 * Corrección (autorizada) -- prueba de integración REAL, solo lectura, de
 * la disponibilidad de AMORE contra Nylas de verdad (nunca mockeado). Se
 * salta automáticamente si faltan credenciales reales (mismo patrón que
 * lib/reserva-servicio.test.ts) -- así `npm run test:flow` en CI sin
 * secretos reales simplemente la omite, y localmente (o con las
 * credenciales cargadas) corre de verdad contra Nylas y Supabase.
 *
 * NUNCA crea, modifica ni borra ningún evento -- solo GET de eventos
 * (createNylasEventsClient es de solo lectura; no se importa ningún
 * cliente de escritura acá).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { listarHorariosDisponiblesPorServicioConNylas } from "@/lib/disponibilidad-servicio-nylas";
import { createNylasEventsClient, resolveNylasApiKeyFromEnv } from "@/lib/nylas/nylas-client";
import { resolverNylasGrantIdParaTenant, AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const HAS_NYLAS = Boolean(process.env.NYLAS_API_KEY && process.env.NYLAS_GRANT_ID_AMORE);
const PUEDE_CORRER = HAS_SUPABASE && HAS_NYLAS;

const DIPPING_SERVICIO_ID = "1c7d139b-44b6-447b-b6ee-3307d1d57204";
const FECHA_VIERNES = "2026-09-11"; // viernes real, America/Bogota -- mismo dia usado en la prueba real de WhatsApp

describe(
  "Disponibilidad real de AMORE contra Nylas (solo lectura, sin mocks)",
  { skip: !PUEDE_CORRER && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NYLAS_API_KEY + NYLAS_GRANT_ID_AMORE" },
  () => {
    it("Dipping, viernes 2026-09-11, 120 min, America/Bogota -- llega realmente a Nylas y devuelve horarios reales", async () => {
      const supabase: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      });

      // El grant se resuelve EXACTAMENTE como en producción -- desde la
      // variable de entorno, nunca hardcodeado en este test tampoco.
      const grantId = resolverNylasGrantIdParaTenant(AMORE_TENANT_ID);
      assert.ok(grantId, "NYLAS_GRANT_ID_AMORE debe estar configurada para que este test corra");

      const apiKey = resolveNylasApiKeyFromEnv();
      assert.ok(apiKey, "NYLAS_API_KEY debe estar configurada para que este test corra");

      const nylasClient = createNylasEventsClient(apiKey!);

      const resultado = await listarHorariosDisponiblesPorServicioConNylas(
        supabase,
        { idTenant: AMORE_TENANT_ID, servicioId: DIPPING_SERVICIO_ID, fecha: FECHA_VIERNES },
        { nylasClient, grantId: grantId! },
      );

      assert.equal(resultado.ok, true, "la consulta real a Nylas debe resolverse correctamente, sin error tecnico");
      if (!resultado.ok) return;

      assert.equal(resultado.servicio.nombre, "Dipping");
      assert.equal(resultado.servicio.duracionMin, 120);
      assert.ok(resultado.especialistas.length > 0, "debe haber al menos una especialista real elegible para Dipping");

      // Ninguna especialista debe quedar "no_confirmado" (eso significaria
      // que Nylas de verdad fallo para su calendario) -- con el grant
      // correcto, todas deben resolverse con datos confirmados.
      for (const e of resultado.especialistas) {
        assert.equal(e.estado, "ok", `${e.nombre} no debe quedar "no_confirmado" con el grant real correctamente configurado`);
      }

      const hayHorarios = resultado.especialistas.some((e) => e.horarios.length > 0);
      assert.ok(hayHorarios, "debe haber al menos un horario real disponible ese viernes (agenda confirmada libre)");
    });
  },
);
