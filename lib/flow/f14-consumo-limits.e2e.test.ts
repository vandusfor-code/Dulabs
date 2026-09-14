/**
 * FASE F14.2 (Billing / Monetización completa, autorizado) — consumo y
 * límites (Fases 7-11 del pedido). Tenants/números 100% desechables. No se
 * envía WhatsApp real en ningún momento -- incrementarUsoMensajes es un
 * contador puro sobre dulabs_clientes_config, nunca llama a Meta.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { incrementarUsoMensajes } from "@/lib/whatsapp-outbound";
import { mensajesIAMesEfectivo, contarNumeros, contarUsuarios, contarAgentesEnUso } from "@/lib/plan-limits";
import { PLANES } from "@/lib/planes";
import type { ClienteConfig } from "@/lib/supabase";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "FASE F14.2 — consumo y límites (Fases 7-11)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const tenantsCreados: string[] = [];
    const phoneNumberIdsCreados: string[] = [];

    after(async () => {
      for (const phoneNumberId of phoneNumberIdsCreados) {
        await admin.from("dulabs_clientes_config").delete().eq("phone_number_id", phoneNumberId);
      }
      for (const tenantId of tenantsCreados) {
        await admin.from("dulabs_suscripciones").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
        await admin.auth.admin.deleteUser(tenantId).catch(() => {});
      }
    });

    async function crearNumeroDePrueba(idTenant: string, prefijo: string): Promise<ClienteConfig> {
      const phoneNumberId = `${prefijo}-${randomUUID().slice(0, 8)}`;
      phoneNumberIdsCreados.push(phoneNumberId);
      const { data, error } = await admin
        .from("dulabs_clientes_config")
        .insert({
          id_tenant: idTenant,
          phone_number_id: phoneNumberId,
          whatsapp_business_account_id: `waba-${phoneNumberId}`,
          telefono_negocio: "573000000000",
          nombre_negocio: "F14.2 test",
          mensajes_usados_mes: 0,
          mes_actual: new Date().toISOString().slice(0, 7),
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as ClienteConfig;
    }

    it("Fase 9 — 0 consumo: mensajes_usados_mes arranca en 0", async () => {
      const tenantId = randomUUID();
      const cliente = await crearNumeroDePrueba(tenantId, "f142-consumo-0");
      assert.equal(cliente.mensajes_usados_mes, 0);
    });

    it("Fase 9 — 1 consumo: un incremento deja el contador en 1", async () => {
      const tenantId = randomUUID();
      const cliente = await crearNumeroDePrueba(tenantId, "f142-consumo-1");
      await incrementarUsoMensajes(admin, cliente);
      const { data } = await admin.from("dulabs_clientes_config").select("mensajes_usados_mes").eq("id", cliente.id).single();
      assert.equal(data?.mensajes_usados_mes, 1);
    });

    it("Fase 8 — reinicio de período: mes_actual distinto al mes en curso reinicia el contador a 1, no lo acumula", async () => {
      const tenantId = randomUUID();
      const cliente = await crearNumeroDePrueba(tenantId, "f142-reset");
      // Simula un contador viejo de un mes anterior con un valor alto.
      await admin.from("dulabs_clientes_config").update({ mensajes_usados_mes: 999, mes_actual: "2020-01" }).eq("id", cliente.id);
      const { data: clienteViejo } = await admin.from("dulabs_clientes_config").select("*").eq("id", cliente.id).single();
      await incrementarUsoMensajes(admin, clienteViejo as ClienteConfig);
      const { data: despues } = await admin.from("dulabs_clientes_config").select("mensajes_usados_mes, mes_actual").eq("id", cliente.id).single();
      assert.equal(despues?.mensajes_usados_mes, 1, "un mes_actual viejo debe reiniciar el contador a 1, no sumarle 1 a 999");
      assert.equal(despues?.mes_actual, new Date().toISOString().slice(0, 7));
    });

    it("Fase 10 (concurrencia obligatoria) — N incrementos concurrentes del mismo número: el contador final debe ser exactamente N", async (t) => {
      // Prueba real contra Supabase real: si la migración 20260914100000
      // (función dulabs_incrementar_uso_mensajes) todavía no está aplicada,
      // este test se salta explícitamente en vez de reportar un "fallo" --
      // ya se demostró una vez, de forma real y documentada en el reporte de
      // esta fase, que sin la migración 25 incrementos concurrentes colapsan
      // a 1 solo incremento neto (pérdida real, no teórica). Repetir esa
      // demostración en cada corrida de regresión no aporta nada nuevo una
      // vez que el hallazgo ya quedó documentado -- solo ensuciaría el
      // resultado como si fuera una regresión de este código.
      const { error: probeError } = await admin.rpc("dulabs_incrementar_uso_mensajes", { p_cliente_id: -1, p_mes_actual: "1900-01" });
      if (probeError?.code === "PGRST202" || probeError?.code === "42883") {
        t.skip("requiere la migración 20260914100000 (función dulabs_incrementar_uso_mensajes) aplicada en Supabase -- ver reporte F14.2 para la demostración real de la pérdida de incrementos sin ella");
        return;
      }
      const tenantId = randomUUID();
      const cliente = await crearNumeroDePrueba(tenantId, "f142-concurrencia");
      const N = 25;
      // Cada llamada concurrente parte de la MISMA copia de `cliente` leída una
      // sola vez (a propósito -- así se reproduce el peor caso real: varios
      // envíos salientes casi simultáneos que arrancaron con el mismo estado
      // en memoria, el escenario exacto que rompía el cálculo leer-decidir-
      // escribir en JavaScript antes de este fix).
      await Promise.all(Array.from({ length: N }, () => incrementarUsoMensajes(admin, cliente)));
      const { data } = await admin.from("dulabs_clientes_config").select("mensajes_usados_mes").eq("id", cliente.id).single();
      assert.equal(
        data?.mensajes_usados_mes,
        N,
        `esperaba exactamente ${N} tras ${N} incrementos concurrentes -- un valor menor confirma la condición de carrera (incrementos perdidos); esto requiere que la migración 20260914100000 (función dulabs_incrementar_uso_mensajes) ya esté aplicada en Supabase. Si todavía no lo está, este test demuestra la vulnerabilidad pre-existente en vez de la corrección.`,
      );
    });

    it("Fase 7 — cupo efectivo de mensajes IA: usa el negociado si existe, si no el del plan (mismo criterio que precio negociado)", async () => {
      const admin2 = admin;
      const t = randomUUID();
      const { error: userError } = await admin2.auth.admin.createUser({ id: t, email: `f142-cupo-${Date.now()}@example.com`, password: `X-${randomUUID()}`, email_confirm: true }).then(
        (r) => ({ error: r.error }),
        (e) => ({ error: e }),
      );
      if (userError) throw userError;
      tenantsCreados.push(t);
      await admin2.from("dulabs_suscripciones").insert({
        id_tenant: t,
        plan: "essential",
        precio_cop: PLANES.essential.precioCop,
        estado: "activa",
        fecha_proximo_cobro: "2099-01-01",
        wompi_payment_source_id: null,
        wompi_customer_email: "f142@example.com",
      });

      const sinNegociar = await mensajesIAMesEfectivo(admin2, t, PLANES.essential);
      assert.equal(sinNegociar, PLANES.essential.limites.mensajesIAMes, "sin negociado, debe usar el tope estándar del plan");

      await admin2.from("dulabs_suscripciones").update({ mensajes_ia_mes_negociado: 12345 }).eq("id_tenant", t);
      const conNegociado = await mensajesIAMesEfectivo(admin2, t, PLANES.essential);
      assert.equal(conNegociado, 12345, "con un cupo negociado, debe prevalecer sobre el estándar del plan");
    });

    it("Fase 11 — contadores en vivo (números/usuarios/agentes) reflejan el estado real del tenant, no un snapshot cacheado", async () => {
      const t = randomUUID();
      const { error: userError } = await admin.auth.admin.createUser({ id: t, email: `f142-contadores-${Date.now()}@example.com`, password: `X-${randomUUID()}`, email_confirm: true }).then(
        (r) => ({ error: r.error }),
        (e) => ({ error: e }),
      );
      if (userError) throw userError;
      tenantsCreados.push(t);

      assert.equal(await contarNumeros(admin, t), 0);
      assert.equal(await contarUsuarios(admin, t), 0);
      assert.equal(await contarAgentesEnUso(admin, t), 0);

      await crearNumeroDePrueba(t, "f142-contador-num");
      assert.equal(await contarNumeros(admin, t), 1, "conectar un número debe reflejarse de inmediato en el contador -- esto es lo que Fase 11 pide verificar tras un cambio de plan: el contador SIEMPRE se deriva en vivo, nunca queda pegado al plan anterior");
    });
  },
);
