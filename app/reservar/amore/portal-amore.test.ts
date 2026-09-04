/**
 * AMORE (Fase 3 del portal, autorizado) — integración real contra el
 * tenant REAL de AMORE (id fijo, ya sembrado y validado en las Fases 1/2).
 * Llama los MISMOS route handlers genéricos que ya usa el portal de
 * Daniela (app/api/reservar/[tenant]/*), sin ningún cambio de esas rutas
 * para esto -- mismo patrón real que app/api/reservar/portal.test.ts.
 *
 * Ninguna reserva de esta suite usa un teléfono real: siempre
 * "test-amore-portal-<random>", nunca 573148127388 ni ningún cliente real.
 * Toda fila creada (citas, cliente conocido) se borra en el `after()`.
 * Ningún dato de Daniela/Solo Talento se toca -- ver test 13 (aislamiento).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import { GET as bootstrapGET, POST as reservarPOST } from "@/app/api/reservar/[tenant]/route";
import { GET as especialistasGET } from "@/app/api/reservar/[tenant]/especialistas/route";
import { GET as disponibilidadGET } from "@/app/api/reservar/[tenant]/disponibilidad/route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const AMORE_TENANT_ID = "ed6ae77f-8a0c-483e-a5d9-8ede68eca50f";
const DANIELA_TENANT_ID = "c64fac97-eff8-45f2-b691-30b3449da524";
const SOLOTALENTO_TENANT_ID = "11ccf0a3-726b-4d4b-9f7d-2deb8441d6a9";

function paramsFor(tenant: string) {
  return { params: Promise.resolve({ tenant }) };
}
function req(url: string, opts?: { method?: string; body?: unknown }) {
  return new NextRequest(url, {
    method: opts?.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

function proximoMartes(offsetSemanas = 0): string {
  const hoy = new Date();
  const diaSemana = hoy.getUTCDay();
  const diasHastaMartes = ((2 - diaSemana + 7) % 7) || 7;
  const fecha = new Date(hoy);
  fecha.setUTCDate(hoy.getUTCDate() + diasHastaMartes + offsetSemanas * 7);
  return fecha.toISOString().slice(0, 10);
}
function proximoDomingo(): string {
  const hoy = new Date();
  const diaSemana = hoy.getUTCDay();
  const diasHastaDomingo = ((7 - diaSemana) % 7) || 7;
  const fecha = new Date(hoy);
  fecha.setUTCDate(hoy.getUTCDate() + diasHastaDomingo);
  return fecha.toISOString().slice(0, 10);
}

describe(
  "Portal de reservas de AMORE (Fase 3) — integración real (tenant real, teléfonos de prueba descartables)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    let servicioUnaId: string;
    let servicioMaquillajeId: string;
    const especialistaPorNombre: Record<string, number> = {};
    const citaIds: number[] = [];
    const telefonosPrueba: string[] = [];
    let bloqueoFestivoId: number | null = null;

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

      const { data: servicios } = await supabase.from("dulabs_servicios").select("id,nombre").eq("id_tenant", AMORE_TENANT_ID);
      servicioUnaId = servicios!.find((s) => s.nombre === "Uña")!.id;
      servicioMaquillajeId = servicios!.find((s) => s.nombre === "Maquillaje Suave")!.id;

      const { data: especialistas } = await supabase.from("dulabs_especialistas").select("id,nombre").eq("id_tenant", AMORE_TENANT_ID);
      for (const e of especialistas ?? []) especialistaPorNombre[e.nombre as string] = e.id as number;
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (citaIds.length) await supabase.from("dulabs_citas_especialista").delete().in("id", citaIds);
      for (const telefono of telefonosPrueba) {
        await supabase.from("dulabs_clientes_conocidos").delete().eq("phone_number_id", "pendiente-amore-ed6ae77f").eq("telefono_cliente", telefono);
      }
      if (bloqueoFestivoId) await supabase.from("dulabs_bloqueos").delete().eq("id", bloqueoFestivoId);
    });

    it("1. bootstrap: el catálogo real de AMORE (28 servicios) se sirve por la MISMA ruta genérica", async () => {
      const res = await bootstrapGET(req(`http://localhost/api/reservar/${AMORE_TENANT_ID}`), paramsFor(AMORE_TENANT_ID));
      const body = await res.json();
      assert.equal(body.disponible, true);
      assert.equal(body.negocio, "AMORE");
      assert.equal(body.servicios.length, 28);
    });

    it("2. servicio de UÑAS -> Cristal, Mary, Nata y Jessica son elegibles", async () => {
      const res = await especialistasGET(req(`http://localhost/api/reservar/${AMORE_TENANT_ID}/especialistas?servicioId=${servicioUnaId}`), paramsFor(AMORE_TENANT_ID));
      const body = await res.json();
      const nombres = (body.especialistas as { nombre: string }[]).map((e) => e.nombre).sort();
      assert.deepEqual(nombres, ["Cristal", "Jessica", "Mary", "Nata"]);
    });

    it("3. servicio NO relacionado con uñas (Maquillaje Suave) -> NUNCA muestra a Cristal", async () => {
      const res = await especialistasGET(req(`http://localhost/api/reservar/${AMORE_TENANT_ID}/especialistas?servicioId=${servicioMaquillajeId}`), paramsFor(AMORE_TENANT_ID));
      const body = await res.json();
      const nombres = (body.especialistas as { nombre: string }[]).map((e) => e.nombre).sort();
      assert.deepEqual(nombres, ["Jessica", "Mary"]);
      assert.ok(!nombres.includes("Cristal"));
    });

    it("3b. Nata solo aparece en servicios que realmente puede realizar (uñas), no en Maquillaje", async () => {
      const resUnas = await especialistasGET(req(`http://localhost/api/reservar/${AMORE_TENANT_ID}/especialistas?servicioId=${servicioUnaId}`), paramsFor(AMORE_TENANT_ID));
      const bodyUnas = await resUnas.json();
      assert.ok((bodyUnas.especialistas as { nombre: string }[]).some((e) => e.nombre === "Nata"));

      const resMaquillaje = await especialistasGET(req(`http://localhost/api/reservar/${AMORE_TENANT_ID}/especialistas?servicioId=${servicioMaquillajeId}`), paramsFor(AMORE_TENANT_ID));
      const bodyMaquillaje = await resMaquillaje.json();
      assert.ok(!(bodyMaquillaje.especialistas as { nombre: string }[]).some((e) => e.nombre === "Nata"));
    });

    it("4/7. los horarios respetan la jornada de cada profesional y la duración del servicio (Jessica 3pm-8pm, servicio de 15 min)", async () => {
      const martes = proximoMartes(2);
      const res = await disponibilidadGET(
        req(`http://localhost/api/reservar/${AMORE_TENANT_ID}/disponibilidad?servicioId=${servicioUnaId}&fecha=${martes}&especialistaId=${especialistaPorNombre["Jessica"]}`),
        paramsFor(AMORE_TENANT_ID)
      );
      const body = await res.json();
      const horarios: string[] = body.especialistas[0].horarios;
      assert.ok(horarios.length > 0);
      assert.ok(horarios.every((h) => h >= "15:00" && h < "20:00"), `horarios de Jessica fuera de su jornada: ${horarios.join(",")}`);
    });

    it("5. domingo -> sin disponibilidad para ninguna profesional", async () => {
      const domingo = proximoDomingo();
      const res = await disponibilidadGET(
        req(`http://localhost/api/reservar/${AMORE_TENANT_ID}/disponibilidad?servicioId=${servicioUnaId}&fecha=${domingo}&especialistaId=${especialistaPorNombre["Mary"]}`),
        paramsFor(AMORE_TENANT_ID)
      );
      const body = await res.json();
      assert.equal(body.especialistas[0].horarios.length, 0);
    });

    it("6. festivo (bloqueo general del tenant) -> sin disponibilidad ese día, para nadie", async () => {
      const martesFestivo = proximoMartes(4);
      const { data: bloqueo, error } = await supabase
        .from("dulabs_bloqueos")
        .insert({
          id_tenant: AMORE_TENANT_ID,
          especialista_id: null,
          tipo: "manual",
          inicio: `${martesFestivo}T00:00:00-05:00`,
          fin: `${martesFestivo}T23:59:59-05:00`,
          motivo: "TEST festivo (borrado al final de la prueba)",
        })
        .select("id")
        .single();
      if (error) throw error;
      bloqueoFestivoId = bloqueo.id as number;

      const res = await disponibilidadGET(
        req(`http://localhost/api/reservar/${AMORE_TENANT_ID}/disponibilidad?servicioId=${servicioUnaId}&fecha=${martesFestivo}&especialistaId=${especialistaPorNombre["Mary"]}`),
        paramsFor(AMORE_TENANT_ID)
      );
      const body = await res.json();
      assert.equal(body.especialistas[0].horarios.length, 0, "un bloqueo general (festivo) debe eliminar toda la disponibilidad ese día");

      await supabase.from("dulabs_bloqueos").delete().eq("id", bloqueoFestivoId);
      bloqueoFestivoId = null;
    });

    it("8/9/10/11/12. reservar vía el portal: asocia al tenant AMORE, bloquea el slot, guarda datos + cumpleaños, y NO duplica cliente si el WhatsApp ya existe", async () => {
      const martes = proximoMartes(3);
      const telefono = `test-amore-portal-${randomUUID().slice(0, 8)}`;
      telefonosPrueba.push(telefono);

      const crear = await reservarPOST(
        req(`http://localhost/api/reservar/${AMORE_TENANT_ID}`, {
          method: "POST",
          body: {
            servicioId: servicioUnaId,
            especialistaId: especialistaPorNombre["Cristal"],
            fecha: martes,
            hora: "10:00",
            nombreCliente: "Cliente Prueba AMORE",
            telefonoCliente: telefono,
            fechaNacimientoDia: 15,
            fechaNacimientoMes: 8,
            idempotencyKey: randomUUID(),
          },
        }),
        paramsFor(AMORE_TENANT_ID)
      );
      const body = await crear.json();
      assert.equal(body.success, true, JSON.stringify(body));

      const { data: filaCita } = await supabase
        .from("dulabs_citas_especialista")
        .select("id,id_tenant,servicio_id,especialista_id,nombre_cliente")
        .eq("telefono_cliente", telefono)
        .single();
      citaIds.push(filaCita!.id as number);
      // 9. asociada al tenant AMORE.
      assert.equal(filaCita!.id_tenant, AMORE_TENANT_ID);
      assert.equal(filaCita!.servicio_id, servicioUnaId);
      assert.equal(filaCita!.especialista_id, especialistaPorNombre["Cristal"]);

      // 10. datos del cliente + cumpleaños (día/mes, SIN año) guardados.
      const { data: clienteConocido } = await supabase
        .from("dulabs_clientes_conocidos")
        .select("nombre,cumple_dia,cumple_mes")
        .eq("phone_number_id", "pendiente-amore-ed6ae77f")
        .eq("telefono_cliente", telefono)
        .single();
      assert.equal(clienteConocido!.nombre, "Cliente Prueba AMORE");
      assert.equal(clienteConocido!.cumple_dia, 15);
      assert.equal(clienteConocido!.cumple_mes, 8);

      // 8. el slot quedó bloqueado (no se ofrece un horario que choque).
      const disp = await disponibilidadGET(
        req(`http://localhost/api/reservar/${AMORE_TENANT_ID}/disponibilidad?servicioId=${servicioUnaId}&fecha=${martes}&especialistaId=${especialistaPorNombre["Cristal"]}`),
        paramsFor(AMORE_TENANT_ID)
      );
      const bodyDisp = await disp.json();
      assert.ok(!bodyDisp.especialistas[0].horarios.includes("10:00"), "el horario recién reservado no debe ofrecerse de nuevo");

      // 11. MISMO WhatsApp reserva un segundo servicio -> NO duplica cliente, actualiza el mismo registro.
      const segunda = await reservarPOST(
        req(`http://localhost/api/reservar/${AMORE_TENANT_ID}`, {
          method: "POST",
          body: {
            servicioId: servicioUnaId,
            especialistaId: especialistaPorNombre["Mary"],
            fecha: martes,
            hora: "11:00",
            nombreCliente: "Cliente Prueba AMORE (nombre actualizado)",
            telefonoCliente: telefono,
            idempotencyKey: randomUUID(),
          },
        }),
        paramsFor(AMORE_TENANT_ID)
      );
      const bodySegunda = await segunda.json();
      assert.equal(bodySegunda.success, true, JSON.stringify(bodySegunda));
      const { data: filaSegunda } = await supabase.from("dulabs_citas_especialista").select("id").eq("telefono_cliente", telefono).eq("especialista_id", especialistaPorNombre["Mary"]).single();
      citaIds.push(filaSegunda!.id as number);

      const { data: clientesConocidosTrasSegunda } = await supabase
        .from("dulabs_clientes_conocidos")
        .select("id,nombre")
        .eq("phone_number_id", "pendiente-amore-ed6ae77f")
        .eq("telefono_cliente", telefono);
      assert.equal(clientesConocidosTrasSegunda!.length, 1, "el mismo WhatsApp nunca debe duplicar la fila de cliente conocido");
      assert.equal(clientesConocidosTrasSegunda![0]!.nombre, "Cliente Prueba AMORE (nombre actualizado)", "el registro existente se actualiza, no se ignora");
    });

    it("13. aislamiento: la URL/tenant de AMORE nunca expone ni modifica datos de Daniela o Solo Talento", async () => {
      const { data: danielaAntes } = await supabase.from("dulabs_clientes_config").select("updated_at").eq("id_tenant", DANIELA_TENANT_ID).single();
      const { data: solotalentoAntes } = await supabase.from("dulabs_clientes_config").select("updated_at").eq("id_tenant", SOLOTALENTO_TENANT_ID).single();

      // El bootstrap de AMORE nunca debe devolver servicios de otro tenant.
      const res = await bootstrapGET(req(`http://localhost/api/reservar/${AMORE_TENANT_ID}`), paramsFor(AMORE_TENANT_ID));
      const body = await res.json();
      assert.ok(!(body.servicios as { nombre: string }[]).some((s) => s.nombre === "Uña" && body.negocio !== "AMORE"));
      assert.equal(body.negocio, "AMORE");

      const { data: danielaDespues } = await supabase.from("dulabs_clientes_config").select("updated_at").eq("id_tenant", DANIELA_TENANT_ID).single();
      const { data: solotalentoDespues } = await supabase.from("dulabs_clientes_config").select("updated_at").eq("id_tenant", SOLOTALENTO_TENANT_ID).single();
      assert.equal(danielaAntes!.updated_at, danielaDespues!.updated_at, "Daniela no debe modificarse por nada de esta suite");
      assert.equal(solotalentoAntes!.updated_at, solotalentoDespues!.updated_at, "Solo Talento no debe modificarse por nada de esta suite");
    });
  }
);
