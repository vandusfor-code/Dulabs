/**
 * Fase 7 — cron de seguimiento cuando Daniela no responde tras un traspaso.
 *
 * REGLA ABSOLUTA DE ESTA SUITE (tras el incidente real de la Fase 7: una
 * corrida anterior de este archivo, contra la ruta HTTP sin restricción,
 * procesó pausas REALES de producción de 3 tenants distintos y les mandó un
 * mensaje real de WhatsApp): esta prueba NUNCA vuelve a invocar la ruta HTTP
 * (que barre TODA la tabla). Llama directamente a ejecutarSeguimientoTraspaso
 * con `soloPhoneNumberId` fijado a un phone_number_id de prueba propio --
 * así, sin importar qué filas reales existan en dulabs_pausas_chat en el
 * momento de correr, la consulta JAMÁS puede tocar una que no sea de esta
 * prueba. Además, el dulabs_clientes_config de prueba se crea SIN
 * meta_permanent_token, así que aunque algo fallara, enviarWhatsApp no
 * podría enviar nada real (ver lib/whatsapp-outbound.ts, "sin token de
 * Meta" es un no-op silencioso, nunca un error).
 *
 * El único destinatario autorizado para un envío real de WhatsApp en toda
 * la Fase 7 es +57 314 812 7388 -- esta prueba no envía nada real en
 * absoluto, así que ni siquiera ese número entra en juego aquí.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "Cron seguimiento-traspaso — integración real (aislada por phone_number_id de prueba)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    let ejecutarSeguimientoTraspaso: typeof import("./route").ejecutarSeguimientoTraspaso;
    let GET: (req: NextRequest) => Promise<Response>;
    const TENANT = randomUUID();
    const PHONE = `test-cron7-${Date.now()}`; // nunca un phone_number_id real
    const pausaIds: number[] = [];

    before(async () => {
      if (!HAS_SUPABASE) return;
      ({ ejecutarSeguimientoTraspaso, GET } = await import("./route"));
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

      // Cliente de prueba SIN token real de Meta -- defensa en profundidad:
      // aunque el filtro de phone_number_id fallara, no habría forma de
      // que esto dispare un envío real.
      const { error } = await supabase.from("dulabs_clientes_config").insert({
        id_tenant: TENANT,
        phone_number_id: PHONE,
        nombre_negocio: "TEST_7_cron_seguimiento",
        meta_permanent_token: null,
        whatsapp_business_account_id: `test-waba-${PHONE}`,
        telefono_negocio: "0000000000",
      });
      if (error) throw error;
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (pausaIds.length) await supabase.from("dulabs_pausas_chat").delete().in("id", pausaIds);
      await supabase.from("dulabs_clientes_config").delete().eq("phone_number_id", PHONE);
    });

    it("rechaza sin autorización (no toca la base de datos -- seguro de correr siempre)", async () => {
      const res = await GET(new NextRequest("http://x/api/cron/seguimiento-traspaso"));
      assert.equal(res.status, 401);
    });

    it("detecta una pausa vencida (>5 min) sin seguimiento enviado, y NO una recién creada ni una ya marcada -- SOLO dentro de nuestro propio phone_number_id de prueba", async () => {
      const ahora = Date.now();
      const hace10min = new Date(ahora - 10 * 60_000).toISOString();
      const hastaFuturo = new Date(ahora + 60 * 60_000).toISOString();

      const { data: filas, error } = await supabase
        .from("dulabs_pausas_chat")
        .insert([
          { phone_number_id: PHONE, telefono_cliente: "573001110001", pausado_hasta: hastaFuturo, pausado_desde: hace10min, seguimiento_enviado: false },
          { phone_number_id: PHONE, telefono_cliente: "573001110002", pausado_hasta: hastaFuturo, pausado_desde: new Date(ahora).toISOString(), seguimiento_enviado: false },
          { phone_number_id: PHONE, telefono_cliente: "573001110003", pausado_hasta: hastaFuturo, pausado_desde: hace10min, seguimiento_enviado: true },
        ])
        .select("id");
      if (error) throw error;
      pausaIds.push(...(filas ?? []).map((f) => f.id as number));

      // Llamada DIRECTA a la función, con soloPhoneNumberId -- nunca a la
      // ruta HTTP, y nunca sin el filtro.
      const resultado = await ejecutarSeguimientoTraspaso(supabase, { soloPhoneNumberId: PHONE });
      assert.equal(resultado.enviados, 1, "solo la vencida (10 min) sin seguimiento debía procesarse");
      assert.deepEqual(resultado.errores, []);

      const { data: trasCorrida } = await supabase
        .from("dulabs_pausas_chat")
        .select("telefono_cliente, seguimiento_enviado")
        .eq("phone_number_id", PHONE)
        .order("telefono_cliente");
      const porTelefono = new Map(trasCorrida!.map((f) => [f.telefono_cliente, f.seguimiento_enviado]));
      assert.equal(porTelefono.get("573001110001"), true, "la vencida sin seguimiento debía marcarse enviada");
      assert.equal(porTelefono.get("573001110002"), false, "la reciente (<5min) nunca debía tocarse");
      assert.equal(porTelefono.get("573001110003"), true, "la ya marcada se mantiene sin re-procesar (estaba en true desde antes)");
    });

    it("con soloPhoneNumberId de otro valor, NUNCA ve nuestras propias filas de prueba (confirma el aislamiento en ambos sentidos)", async () => {
      const resultado = await ejecutarSeguimientoTraspaso(supabase, { soloPhoneNumberId: "un-numero-que-no-existe" });
      assert.equal(resultado.enviados, 0);
    });
  }
);
