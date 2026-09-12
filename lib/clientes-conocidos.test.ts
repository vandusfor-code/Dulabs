/**
 * FASE F7 (Contacts + Variables + Tags, autorizado) — smoke test de
 * integración REAL para resolverOCrearContacto/actualizarCampoPersonalizado
 * (dulabs_clientes_conocidos.custom_fields). Mismo patrón que
 * lib/flow/flow-orchestrator-store-supabase.test.ts / especialistas-flow-
 * adaptador.test.ts: se salta sin credenciales, usa un phone_number_id
 * descartable (tenant_id random, sin FK a una tabla de tenants real), limpia
 * al final. No toca ningún tenant/número real de AMORE/Daniela/Solo Talento.
 *
 * IMPORTANTE (autorizado explícitamente por el usuario) -- la migración
 * 20260926000000_dulabs_clientes_conocidos_custom_fields.sql está creada
 * pero DELIBERADAMENTE NO aplicada contra esta base ("NO tocar producción").
 * Los tests que dependen de la columna `custom_fields` ya existiendo se
 * AUTO-DETECTAN (probe en `before`) y se marcan `skip` en tiempo de
 * ejecución (t.skip(...), nunca como fallo) cuando la columna todavía no
 * existe -- volverán a correr y validar de verdad en cuanto se aplique la
 * migración, sin tocar este archivo.
 *
 * Cubre:
 *  - 1. crear contacto (parte "nombre placeholder": no depende de la
 *    migración; parte "custom_fields = {}": sí depende, con skip dinámico)
 *  - 2. recuperar contacto existente
 *  - 3. deduplicación bajo concurrencia (unique real (phone_number_id,
 *    telefono_cliente), no solo código) -- no depende de la migración
 *  - 4. tenant isolation (dos "tenants" -- distintos phone_number_id -- no
 *    se contaminan) -- depende de la migración (custom_fields real)
 *  - 5. custom fields persistentes (sobreviven una relectura) -- depende
 *  - 7. save_data custom_field persiste (actualizarCampoPersonalizado) -- depende
 *  - 9. variable persiste entre dos ejecuciones distintas del mismo
 *    contacto -- depende
 *  - 10. contacto sin custom fields funciona correctamente ('{}' por
 *    default, nunca null/undefined) -- depende
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolverOCrearContacto, actualizarCampoPersonalizado } from "@/lib/clientes-conocidos";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const MIGRATION_PENDING_REASON =
  "columna dulabs_clientes_conocidos.custom_fields no existe todavía -- migración 20260926000000 creada pero NO aplicada (autorizado explícitamente: 'NO tocar producción')";

describe(
  "FASE F7 — resolverOCrearContacto / actualizarCampoPersonalizado (Supabase real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    let hasCustomFieldsColumn = false;
    // id_tenant es uuid real en la tabla -- randomUUID(), no un slug de texto.
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const PHONE_A = `f7-contactos-phone-a-${Date.now()}`;
    const PHONE_B = `f7-contactos-phone-b-${Date.now()}`;
    const TELEFONO = "573000001111";

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const probe = await supabase.from("dulabs_clientes_conocidos").select("custom_fields").limit(1);
      hasCustomFieldsColumn = probe.error?.code !== "42703";
      if (!hasCustomFieldsColumn) {
        console.warn(
          `[F7 test] ${MIGRATION_PENDING_REASON} -- los tests marcados 'depende de la migración' se saltan (skip), no fallan.`,
        );
      }
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      await supabase.from("dulabs_clientes_conocidos").delete().eq("phone_number_id", PHONE_A);
      await supabase.from("dulabs_clientes_conocidos").delete().eq("phone_number_id", PHONE_B);
    });

    it("1a. crea el contacto si no existe (nombre placeholder = telefonoCliente) -- no depende de la migración", async () => {
      await resolverOCrearContacto(supabase, {
        idTenant: TENANT_A,
        phoneNumberId: PHONE_A,
        telefonoCliente: TELEFONO,
      });
      const { data } = await supabase
        .from("dulabs_clientes_conocidos")
        .select("nombre")
        .eq("phone_number_id", PHONE_A)
        .eq("telefono_cliente", TELEFONO)
        .maybeSingle();
      assert.equal(data?.nombre, TELEFONO);
    });

    it("1b. el contacto recién creado arranca con custom_fields = {} (depende de la migración)", async (t) => {
      if (!hasCustomFieldsColumn) return t.skip(MIGRATION_PENDING_REASON);
      const resultado = await resolverOCrearContacto(supabase, {
        idTenant: TENANT_A,
        phoneNumberId: PHONE_A,
        telefonoCliente: TELEFONO,
      });
      assert.deepEqual(resultado.customFields, {});
    });

    it("2. recupera el contacto ya existente sin crear una fila duplicada", async () => {
      await resolverOCrearContacto(supabase, {
        idTenant: TENANT_A,
        phoneNumberId: PHONE_A,
        telefonoCliente: TELEFONO,
      });
      const { count } = await supabase
        .from("dulabs_clientes_conocidos")
        .select("id", { count: "exact", head: true })
        .eq("phone_number_id", PHONE_A)
        .eq("telefono_cliente", TELEFONO);
      assert.equal(count, 1);
    });

    it("3. deduplicación bajo concurrencia -- 5 llamadas simultáneas, una sola fila real", async () => {
      const phoneConcurrencia = `${PHONE_A}-concurrencia`;
      try {
        await Promise.all(
          Array.from({ length: 5 }, () =>
            resolverOCrearContacto(supabase, {
              idTenant: TENANT_A,
              phoneNumberId: phoneConcurrencia,
              telefonoCliente: TELEFONO,
            }),
          ),
        );
        const { count } = await supabase
          .from("dulabs_clientes_conocidos")
          .select("id", { count: "exact", head: true })
          .eq("phone_number_id", phoneConcurrencia)
          .eq("telefono_cliente", TELEFONO);
        assert.equal(count, 1);
      } finally {
        await supabase.from("dulabs_clientes_conocidos").delete().eq("phone_number_id", phoneConcurrencia);
      }
    });

    it("4. tenant isolation -- el mismo número de teléfono en OTRO phone_number_id (otro tenant) es un contacto distinto", async (t) => {
      if (!hasCustomFieldsColumn) return t.skip(MIGRATION_PENDING_REASON);
      await resolverOCrearContacto(supabase, {
        idTenant: TENANT_B,
        phoneNumberId: PHONE_B,
        telefonoCliente: TELEFONO,
      });
      await actualizarCampoPersonalizado(supabase, {
        idTenant: TENANT_B,
        phoneNumberId: PHONE_B,
        telefonoCliente: TELEFONO,
        customFields: { plan: "tenant-b-plan" },
      });

      const contactoA = await resolverOCrearContacto(supabase, {
        idTenant: TENANT_A,
        phoneNumberId: PHONE_A,
        telefonoCliente: TELEFONO,
      });
      // El contacto de PHONE_A (tenant A) NUNCA debe ver el custom_field que
      // se guardó del lado de PHONE_B (tenant B), aunque el número de
      // teléfono del cliente sea idéntico -- el identificador real es
      // (phone_number_id, telefono_cliente), nunca solo telefono_cliente.
      assert.equal(contactoA.customFields.plan, undefined);
    });

    it("5. custom_fields persistentes -- sobreviven una relectura independiente", async (t) => {
      if (!hasCustomFieldsColumn) return t.skip(MIGRATION_PENDING_REASON);
      await actualizarCampoPersonalizado(supabase, {
        idTenant: TENANT_A,
        phoneNumberId: PHONE_A,
        telefonoCliente: TELEFONO,
        customFields: { ciudad: "Bogotá" },
      });
      const relectura = await resolverOCrearContacto(supabase, {
        idTenant: TENANT_A,
        phoneNumberId: PHONE_A,
        telefonoCliente: TELEFONO,
      });
      assert.equal(relectura.customFields.ciudad, "Bogotá");
    });

    it("7. actualizarCampoPersonalizado hace MERGE, nunca replace -- un campo previo no se borra", async (t) => {
      if (!hasCustomFieldsColumn) return t.skip(MIGRATION_PENDING_REASON);
      await actualizarCampoPersonalizado(supabase, {
        idTenant: TENANT_A,
        phoneNumberId: PHONE_A,
        telefonoCliente: TELEFONO,
        customFields: { ciudad: "Bogotá" },
      });
      await actualizarCampoPersonalizado(supabase, {
        idTenant: TENANT_A,
        phoneNumberId: PHONE_A,
        telefonoCliente: TELEFONO,
        customFields: { correo: "ana@test.com" },
      });
      const { data } = await supabase
        .from("dulabs_clientes_conocidos")
        .select("custom_fields")
        .eq("phone_number_id", PHONE_A)
        .eq("telefono_cliente", TELEFONO)
        .maybeSingle();
      // 'ciudad' de la primera llamada sigue presente -- merge, no replace.
      assert.equal(data?.custom_fields.ciudad, "Bogotá");
      assert.equal(data?.custom_fields.correo, "ana@test.com");
    });

    it("9. una variable guardada en la ejecución 1 está disponible en una ejecución 2 distinta del mismo contacto", async (t) => {
      if (!hasCustomFieldsColumn) return t.skip(MIGRATION_PENDING_REASON);
      const phoneNueva = `${PHONE_A}-turno2`;
      try {
        // "Ejecución 1": contacto nuevo, guarda un dato real.
        const ejecucion1 = await resolverOCrearContacto(supabase, {
          idTenant: TENANT_A,
          phoneNumberId: phoneNueva,
          telefonoCliente: TELEFONO,
        });
        assert.deepEqual(ejecucion1.customFields, {});
        await actualizarCampoPersonalizado(supabase, {
          idTenant: TENANT_A,
          phoneNumberId: phoneNueva,
          telefonoCliente: TELEFONO,
          customFields: { ultimoServicio: "corte" },
        });

        // "Ejecución 2": conversación totalmente nueva del MISMO contacto
        // (mismo phone_number_id + telefono_cliente) -- debe ver el dato
        // guardado en la ejecución anterior sin que nadie se lo repita.
        const ejecucion2 = await resolverOCrearContacto(supabase, {
          idTenant: TENANT_A,
          phoneNumberId: phoneNueva,
          telefonoCliente: TELEFONO,
        });
        assert.equal(ejecucion2.customFields.ultimoServicio, "corte");
      } finally {
        await supabase.from("dulabs_clientes_conocidos").delete().eq("phone_number_id", phoneNueva);
      }
    });

    it("10. contacto sin custom fields funciona correctamente ('{}' real, nunca null)", async (t) => {
      if (!hasCustomFieldsColumn) return t.skip(MIGRATION_PENDING_REASON);
      const phoneVacio = `${PHONE_A}-vacio`;
      try {
        const resultado = await resolverOCrearContacto(supabase, {
          idTenant: TENANT_A,
          phoneNumberId: phoneVacio,
          telefonoCliente: TELEFONO,
        });
        assert.deepEqual(resultado.customFields, {});
        assert.equal(Object.keys(resultado.customFields).length, 0);
      } finally {
        await supabase.from("dulabs_clientes_conocidos").delete().eq("phone_number_id", phoneVacio);
      }
    });

    it("recordarNombreCliente sigue funcionando igual -- regresión, no depende de la migración", async () => {
      const { recordarNombreCliente, nombreConocido } = await import("@/lib/clientes-conocidos");
      const phoneLegacy = `${PHONE_A}-legacy`;
      try {
        await recordarNombreCliente(supabase, {
          idTenant: TENANT_A,
          phoneNumberId: phoneLegacy,
          telefonoCliente: TELEFONO,
          nombre: "Ana Real",
        });
        const nombre = await nombreConocido(supabase, phoneLegacy, TELEFONO);
        assert.equal(nombre, "Ana Real");
      } finally {
        await supabase.from("dulabs_clientes_conocidos").delete().eq("phone_number_id", phoneLegacy);
      }
    });
  },
);
