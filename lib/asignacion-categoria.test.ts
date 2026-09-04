/**
 * Fase 8A.5 (autorizado) — corrección real: el portal de Daniela mostraba
 * "No hay profesionales disponibles" para 8 de sus 11 servicios reales
 * (Semipermanente, Dipping, Base Rubber, Forrado, Press on, Acrílicas)
 * porque listarHorariosDisponiblesPorServicio SOLO resolvía especialistas
 * vía dulabs_servicio_especialista, y esos 8 servicios nunca tuvieron fila
 * ahí -- la asignación real de Daniela para ellos es por CATEGORÍA (manos/
 * pies), confirmada en dulabs_config_bot.respuestas.reglas, no por servicio
 * puntual.
 *
 * Este archivo NO usa el tenant real de Daniela (para no crear datos de
 * prueba contra producción, instrucción explícita) -- usa un tenant
 * descartable con su PROPIA fila de config-bot que reproduce EXACTAMENTE
 * las mismas reglas reales confirmadas por Daniela (carla_primero,
 * danielaPies=no), para poder probar la lógica genérica sin tocar nada real.
 *
 * F/G/H del pedido (Cejas sola/con henna -> Carla, Hidralips -> Nicol) ya
 * están cubiertos por la asociación EXPLÍCITA, sin cambios de esta fase --
 * verificados contra datos reales en
 * lib/asistente-daniela-config-operativa.test.ts (Fase 8A.4). No se
 * duplican acá.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import {
  resolverReglasCategoriaDesdeConfigBot,
  resolverEspecialistasPorCategoria,
  resolverEspecialistasElegiblesParaServicio,
} from "@/lib/asignacion-categoria";
import { listarHorariosDisponiblesPorServicio, reservarCitaPorServicio } from "@/lib/disponibilidad-servicio";
import { GET as especialistasGET } from "@/app/api/reservar/[tenant]/especialistas/route";

function reqEspecialistas(tenant: string, servicioId: string) {
  return especialistasGET(
    new NextRequest(`http://localhost/api/reservar/${tenant}/especialistas?servicioId=${servicioId}`),
    { params: Promise.resolve({ tenant }) }
  );
}

describe("resolverReglasCategoriaDesdeConfigBot — función pura, refleja EXACTAMENTE lo confirmado en `reglas`", () => {
  it("prioridadManos=carla_primero -> Manos en modo prioridad, Carla antes que Daniela", () => {
    const reglas = resolverReglasCategoriaDesdeConfigBot({ reglas: { prioridadManos: "carla_primero" } });
    assert.deepEqual(reglas, [{ categoria: "Manos", modo: "prioridad", personas: ["Carla", "Daniela"] }]);
  });

  it("prioridadManos=daniela_primero -> orden invertido", () => {
    const reglas = resolverReglasCategoriaDesdeConfigBot({ reglas: { prioridadManos: "daniela_primero" } });
    assert.deepEqual(reglas, [{ categoria: "Manos", modo: "prioridad", personas: ["Daniela", "Carla"] }]);
  });

  it("prioridadManos=cualquiera -> modo todos, sin orden de corte", () => {
    const reglas = resolverReglasCategoriaDesdeConfigBot({ reglas: { prioridadManos: "cualquiera" } });
    assert.deepEqual(reglas, [{ categoria: "Manos", modo: "todos", personas: ["Carla", "Daniela"] }]);
  });

  it("danielaPies=no -> Pies en modo prioridad, Kelly y Carla, SIN Daniela", () => {
    const reglas = resolverReglasCategoriaDesdeConfigBot({ reglas: { danielaPies: "no" } });
    assert.deepEqual(reglas, [{ categoria: "Pies", modo: "prioridad", personas: ["Kelly", "Carla"] }]);
  });

  it("danielaPies=si -> Daniela entra como último recurso de Pies", () => {
    const reglas = resolverReglasCategoriaDesdeConfigBot({ reglas: { danielaPies: "si" } });
    assert.deepEqual(reglas, [{ categoria: "Pies", modo: "prioridad", personas: ["Kelly", "Carla", "Daniela"] }]);
  });

  it("sin `reglas` (o con otra forma) -> [], nunca inventa una regla", () => {
    assert.deepEqual(resolverReglasCategoriaDesdeConfigBot({}), []);
    assert.deepEqual(resolverReglasCategoriaDesdeConfigBot(null), []);
    assert.deepEqual(resolverReglasCategoriaDesdeConfigBot({ reglas: { prioridadManos: "algo-no-reconocido" } }), []);
  });
});

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "Fallback por categoría — integración real (tenant descartable, reglas idénticas a las de Daniela)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_C = randomUUID();
    const PHONE_C = `test-8a5-${Date.now()}`;
    const TENANT_D = randomUUID(); // sin config-bot -- debe comportarse EXACTAMENTE igual que antes de esta fase

    let carlaId: number, danielaId: number, kellyId: number;
    let servicioManosId: string, servicioPiesId: string, servicioSinCategoriaId: string, servicioManos120Id: string;
    const especialistaIds: number[] = [];
    const servicioIds: string[] = [];
    const horarioIds: number[] = [];
    const citaIds: number[] = [];

    // Lunes y martes de la semana entrante -- días de la semana FIJOS
    // (dia_semana JS: 1=lunes, 2=martes), nunca hoy (para no chocar con
    // fechas ya usadas por otros tests del mismo archivo de disponibilidad).
    function proximoDia(diaSemanaObjetivo: number): string {
      const hoy = new Date();
      const dia = hoy.getUTCDay();
      const diasHasta = ((diaSemanaObjetivo - dia + 7) % 7) || 7;
      const f = new Date(hoy);
      f.setUTCDate(hoy.getUTCDate() + diasHasta);
      return f.toISOString().slice(0, 10);
    }
    const FECHA_LUNES = proximoDia(1);
    const FECHA_MARTES = proximoDia(2);
    const FECHA_MIERCOLES = proximoDia(3);

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

      const { error: cfgErr } = await supabase.from("dulabs_clientes_config").insert({
        id_tenant: TENANT_C,
        phone_number_id: PHONE_C,
        nombre_negocio: "TEST_8A5",
        whatsapp_business_account_id: "test-waba-8a5",
        telefono_negocio: "573000009999",
      });
      if (cfgErr) throw cfgErr;

      // Fase 8A.8.1: sin esto, planDelTenant(TENANT_C) devuelve SIN_PLAN y el
      // endpoint /api/reservar/[tenant]/especialistas corta con [] ANTES de
      // llegar al resolver -- mismo patrón que app/api/reservar/portal.test.ts.
      const enUnMes = new Date();
      enUnMes.setMonth(enUnMes.getMonth() + 1);
      const { error: susErr } = await supabase.from("dulabs_suscripciones").insert({
        id_tenant: TENANT_C,
        plan: "starter",
        estado: "activa",
        precio_cop: 0,
        fecha_proximo_cobro: enUnMes.toISOString().slice(0, 10),
      });
      if (susErr) throw susErr;

      // MISMAS reglas reales confirmadas por Daniela -- no se inventa nada nuevo.
      const { error: botErr } = await supabase.from("dulabs_config_bot").insert({
        phone_number_id: PHONE_C,
        token: `test-8a5-token-${Date.now()}`,
        respuestas: { reglas: { prioridadManos: "carla_primero", danielaPies: "no" } },
      });
      if (botErr) throw botErr;

      const especialistas = await Promise.all(
        ["Carla", "Daniela", "Kelly"].map((nombre, i) =>
          supabase
            .from("dulabs_especialistas")
            .insert({
              id_tenant: TENANT_C,
              phone_number_id: PHONE_C,
              nombre,
              numero_whatsapp: `57300000940${i}`,
              servicio: "manos",
              duracion_min: 60,
              activo: true,
              bloquea_horario: true,
              es_general: false,
              requiere_aprobacion: false,
            })
            .select("id")
            .single()
        )
      );
      for (const e of especialistas) if (e.error) throw e.error;
      [carlaId, danielaId, kellyId] = especialistas.map((e) => e.data!.id as number);
      especialistaIds.push(carlaId, danielaId, kellyId);

      // Carla: SOLO tiene horario el lunes -- el martes queda con CERO
      // ventanas (no es "sin filas", es "vacío ese día puntual": tiene fila
      // para otro día, así que nunca respalda al horario genérico legacy).
      // Daniela y Kelly: solo el martes.
      const { data: horarios, error: hErr } = await supabase
        .from("dulabs_horario_especialista")
        .insert([
          { id_tenant: TENANT_C, especialista_id: carlaId, dia_semana: 1, hora_inicio: "09:00", hora_fin: "17:00" },
          { id_tenant: TENANT_C, especialista_id: danielaId, dia_semana: 2, hora_inicio: "09:00", hora_fin: "17:00" },
          { id_tenant: TENANT_C, especialista_id: kellyId, dia_semana: 2, hora_inicio: "09:00", hora_fin: "17:00" },
          // Fase 8A.6: miércoles Carla SÍ está de turno, pero solo 90 min
          // (09:00-10:30) -- insuficiente para un servicio de 120 min.
          // Daniela sí tiene el día completo ese mismo miércoles.
          { id_tenant: TENANT_C, especialista_id: carlaId, dia_semana: 3, hora_inicio: "09:00", hora_fin: "10:30" },
          { id_tenant: TENANT_C, especialista_id: danielaId, dia_semana: 3, hora_inicio: "09:00", hora_fin: "17:00" },
        ])
        .select("id");
      if (hErr) throw hErr;
      horarioIds.push(...((horarios ?? []) as { id: number }[]).map((h) => h.id));

      const servicios = await Promise.all([
        supabase.from("dulabs_servicios").insert({ id_tenant: TENANT_C, nombre: "TEST_8A5_manos", categoria: "Manos", duracion_min: 60 }).select("id").single(),
        supabase.from("dulabs_servicios").insert({ id_tenant: TENANT_C, nombre: "TEST_8A5_pies", categoria: "Pies", duracion_min: 60 }).select("id").single(),
        supabase.from("dulabs_servicios").insert({ id_tenant: TENANT_D, nombre: "TEST_8A5_sin_config", categoria: "Manos", duracion_min: 60 }).select("id").single(),
        supabase.from("dulabs_servicios").insert({ id_tenant: TENANT_C, nombre: "TEST_8A6_manos_120", categoria: "Manos", duracion_min: 120 }).select("id").single(),
      ]);
      for (const s of servicios) if (s.error) throw s.error;
      servicioManosId = servicios[0].data!.id as string;
      servicioPiesId = servicios[1].data!.id as string;
      servicioSinCategoriaId = servicios[2].data!.id as string;
      servicioManos120Id = servicios[3].data!.id as string;
      servicioIds.push(servicioManosId, servicioPiesId, servicioSinCategoriaId, servicioManos120Id);
      // Nota: NINGUNO de los 3 tiene fila en dulabs_servicio_especialista --
      // exactamente la situación real que causaba el bug reportado.
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (citaIds.length) await supabase.from("dulabs_citas_especialista").delete().in("id", citaIds);
      if (horarioIds.length) await supabase.from("dulabs_horario_especialista").delete().in("id", horarioIds);
      if (servicioIds.length) await supabase.from("dulabs_servicios").delete().in("id", servicioIds);
      if (especialistaIds.length) await supabase.from("dulabs_especialistas").delete().in("id", especialistaIds);
      await supabase.from("dulabs_config_bot").delete().eq("phone_number_id", PHONE_C);
      await supabase.from("dulabs_clientes_config").delete().eq("id_tenant", TENANT_C);
      await supabase.from("dulabs_suscripciones").delete().eq("id_tenant", TENANT_C);
    });

    it("1. un servicio de MANOS sin asociación directa encuentra profesionales igual (el bug reportado ya no ocurre)", async () => {
      const r = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_C, servicioId: servicioManosId, fecha: FECHA_LUNES });
      assert.equal(r.ok, true);
      if (r.ok) assert.ok(r.especialistas.length > 0);
    });

    it("2. Carla tiene prioridad sobre Daniela en MANOS cuando Carla sí tiene cupo (lunes)", async () => {
      const r = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_C, servicioId: servicioManosId, fecha: FECHA_LUNES });
      assert.equal(r.ok, true);
      if (!r.ok) return;
      assert.equal(r.especialistas.length, 1);
      assert.equal(r.especialistas[0]!.especialistaId, carlaId);
      assert.ok(r.especialistas[0]!.horarios.length > 0);
    });

    it("3. Daniela SOLO entra como respaldo de MANOS cuando Carla no tiene NINGÚN cupo ese día (martes)", async () => {
      const r = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_C, servicioId: servicioManosId, fecha: FECHA_MARTES });
      assert.equal(r.ok, true);
      if (!r.ok) return;
      assert.equal(r.especialistas.length, 1);
      assert.equal(r.especialistas[0]!.especialistaId, danielaId, "martes Carla no tiene horario -- debe pasar a Daniela");
      assert.ok(r.especialistas[0]!.horarios.length > 0);
    });

    it("4. Daniela NUNCA aparece para PIES (regla real: danielaPies=no)", async () => {
      const lunes = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_C, servicioId: servicioPiesId, fecha: FECHA_LUNES });
      const martes = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_C, servicioId: servicioPiesId, fecha: FECHA_MARTES });
      for (const r of [lunes, martes]) {
        assert.equal(r.ok, true);
        if (r.ok) assert.equal(r.especialistas.some((e) => e.especialistaId === danielaId), false);
      }
    });

    it("5. PIES usa Kelly (fija) y Carla (respaldo) según las reglas reales", async () => {
      const martes = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_C, servicioId: servicioPiesId, fecha: FECHA_MARTES });
      assert.equal(martes.ok, true);
      if (martes.ok) {
        assert.equal(martes.especialistas.length, 1);
        assert.equal(martes.especialistas[0]!.especialistaId, kellyId, "martes Kelly sí tiene horario -- es la fija");
      }

      const lunes = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_C, servicioId: servicioPiesId, fecha: FECHA_LUNES });
      assert.equal(lunes.ok, true);
      if (lunes.ok) {
        assert.equal(lunes.especialistas.length, 1);
        assert.equal(lunes.especialistas[0]!.especialistaId, carlaId, "lunes Kelly no tiene horario -- pasa a Carla como respaldo");
      }
    });

    it("Fase 8A.6: Carla 'en turno' pero sin tiempo CONTINUO suficiente cuenta como sin cupo -- pasa a Daniela igual", async () => {
      // Miércoles: Carla trabaja 09:00-10:30 (90 min) -- insuficiente para
      // un servicio de 120 min, aunque técnicamente sí tiene horario ese
      // día. Daniela sí tiene el día completo. La prioridad debe fijarse en
      // la disponibilidad REAL para la duración completa, no solo en si
      // "está de turno".
      const r = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_C, servicioId: servicioManos120Id, fecha: FECHA_MIERCOLES });
      assert.equal(r.ok, true);
      if (!r.ok) return;
      assert.equal(r.especialistas.length, 1);
      assert.equal(r.especialistas[0]!.especialistaId, danielaId, "Carla no tiene 120 min continuos ese día -- debe pasar a Daniela");
    });

    it("9/10. la duración del servicio y las citas existentes siguen aplicando correctamente sobre el especialista resuelto por categoría", async () => {
      const antes = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_C, servicioId: servicioManosId, fecha: FECHA_LUNES });
      assert.equal(antes.ok, true);
      if (!antes.ok) return;
      assert.equal(antes.especialistas[0]!.horarios.includes("10:00"), true);

      const { data: cita, error } = await supabase
        .from("dulabs_citas_especialista")
        .insert({
          especialista_id: carlaId,
          id_tenant: TENANT_C,
          phone_number_id: PHONE_C,
          telefono_cliente: "573000001234",
          nombre_cliente: "Cliente Test 8A5",
          servicio: "TEST_8A5_manos",
          servicio_id: servicioManosId,
          inicio: `${FECHA_LUNES}T10:00:00-05:00`,
          fin: `${FECHA_LUNES}T11:00:00-05:00`,
          estado: "confirmada",
          bloquea_horario: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      citaIds.push(cita!.id as number);

      const despues = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_C, servicioId: servicioManosId, fecha: FECHA_LUNES });
      assert.equal(despues.ok, true);
      if (despues.ok) assert.equal(despues.especialistas[0]!.horarios.includes("10:00"), false, "la cita ya creada debe bloquear ese horario");
    });

    it("reservarCitaPorServicio: Daniela SÍ puede reservar Manos sin asociación explícita, vía la misma regla de categoría", async () => {
      const resultado = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_C,
        especialistaId: danielaId,
        servicioId: servicioManosId,
        telefonoCliente: "573000005678",
        nombreCliente: "Cliente Test 8A5 reserva",
        inicio: new Date(`${FECHA_MARTES}T10:00:00-05:00`),
      });
      assert.equal(resultado.ok, true);
      if (resultado.ok) citaIds.push(resultado.cita.id);
    });

    it("reservarCitaPorServicio: Kelly NO puede reservar Manos (no está en la regla de esa categoría, ninguna asociación la habilita)", async () => {
      const resultado = await reservarCitaPorServicio(supabase, {
        idTenant: TENANT_C,
        especialistaId: kellyId,
        servicioId: servicioManosId,
        telefonoCliente: "573000005679",
        nombreCliente: "No debería poder",
        inicio: new Date(`${FECHA_MARTES}T11:00:00-05:00`),
      });
      assert.equal(resultado.ok, false);
      if (!resultado.ok) assert.equal(resultado.motivo, "especialista_no_habilitado");
    });

    it("11/12. tenant SIN config-bot conserva el comportamiento EXACTO de antes de esta fase (sin_especialistas_habilitados)", async () => {
      const r = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_D, servicioId: servicioSinCategoriaId, fecha: FECHA_LUNES });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "sin_especialistas_habilitados");
    });

    it("resolverEspecialistasPorCategoria: aislado por tenant -- TENANT_D no ve las reglas de TENANT_C", async () => {
      const resuelto = await resolverEspecialistasPorCategoria(supabase, TENANT_D, "Manos");
      assert.equal(resuelto, null);
    });

    // -------------------------------------------------------------------
    // Fase 8A.8.1 (autorizado) — el endpoint de listado de especialistas
    // (app/api/reservar/[tenant]/especialistas/route.ts) causaba "No hay
    // profesionales disponibles" porque reimplementaba su propia
    // resolución mirando SOLO dulabs_servicio_especialista, sin el
    // fallback por categoría. Ahora usa el MISMO
    // resolverEspecialistasElegiblesParaServicio que ya usa
    // listarHorariosDisponiblesPorServicio/reservarCitaPorServicio -- estos
    // tests prueban el endpoint directamente (mismo patrón que
    // app/api/reservar/portal.test.ts: importar el GET y llamarlo con un
    // NextRequest real) y confirman que coincide con el motor.
    // -------------------------------------------------------------------

    it("endpoint de especialistas: Manos sin asociación explícita ya NO devuelve [] (el bug reportado)", async () => {
      const res = await reqEspecialistas(TENANT_C, servicioManosId);
      const body = await res.json();
      const nombres = body.especialistas.map((e: { nombre: string }) => e.nombre);
      assert.ok(nombres.length > 0, "antes de esta fase esto era siempre []");
      assert.ok(nombres.includes("Carla"));
      assert.ok(nombres.includes("Daniela"));
    });

    it("endpoint de especialistas: Pies nunca incluye a Daniela (misma regla real, danielaPies=no)", async () => {
      const res = await reqEspecialistas(TENANT_C, servicioPiesId);
      const body = await res.json();
      const nombres = body.especialistas.map((e: { nombre: string }) => e.nombre);
      assert.equal(nombres.includes("Daniela"), false);
      assert.ok(nombres.includes("Kelly"));
      assert.ok(nombres.includes("Carla"));
    });

    it("endpoint de especialistas: Acrílicas (210 min, categoría Manos) resuelve por categoría igual que cualquier otro servicio de Manos", async () => {
      const res = await reqEspecialistas(TENANT_C, servicioManos120Id);
      const body = await res.json();
      const nombres = body.especialistas.map((e: { nombre: string }) => e.nombre);
      assert.ok(nombres.includes("Carla"));
      assert.ok(nombres.includes("Daniela"));
    });

    it("resolverEspecialistasElegiblesParaServicio: la asociación EXPLÍCITA sigue ganando sobre la categoría (Cejas -> Carla, no la regla de Manos)", async () => {
      // Cejas/Hidralips no forman parte de este tenant descartable (esos se
      // prueban contra datos reales en asistente-daniela-config-operativa.test.ts);
      // acá se prueba el PRINCIPIO con datos propios: se crea una asociación
      // explícita para el servicio de Manos apuntando a Kelly (que la regla
      // de categoría NUNCA incluiría para Manos) y se confirma que gana.
      const { error } = await supabase
        .from("dulabs_servicio_especialista")
        .insert({ id_tenant: TENANT_C, servicio_id: servicioManosId, especialista_id: kellyId });
      if (error) throw error;
      try {
        const resolucion = await resolverEspecialistasElegiblesParaServicio(supabase, TENANT_C, servicioManosId);
        assert.equal(resolucion.modo, "explicita");
        assert.deepEqual(
          resolucion.especialistas.map((e) => e.nombre),
          ["Kelly"],
          "con asociación explícita, la regla de categoría (Carla/Daniela) NO debe aplicarse"
        );
      } finally {
        await supabase.from("dulabs_servicio_especialista").delete().eq("id_tenant", TENANT_C).eq("servicio_id", servicioManosId).eq("especialista_id", kellyId);
      }
    });

    it("endpoint de especialistas y motor de disponibilidad son COHERENTES: mismo conjunto de nombres para el mismo servicio", async () => {
      const resEndpoint = await reqEspecialistas(TENANT_C, servicioManosId);
      const bodyEndpoint = await resEndpoint.json();
      const nombresEndpoint = (bodyEndpoint.especialistas as { nombre: string }[]).map((e) => e.nombre).sort();

      const resMotor = await listarHorariosDisponiblesPorServicio(supabase, { idTenant: TENANT_C, servicioId: servicioManosId, fecha: FECHA_LUNES });
      assert.equal(resMotor.ok, true);
      if (!resMotor.ok) return;
      // El motor, en modo "prioridad", puede devolver solo 1 (el ganador del
      // día); el endpoint (sin fecha) devuelve a TODOS los candidatos de la
      // regla -- lo que debe coincidir es que el ganador del motor SIEMPRE
      // esté entre los candidatos que el endpoint ofreció.
      const nombresMotor = resMotor.especialistas.map((e) => e.nombre);
      for (const nombre of nombresMotor) {
        assert.ok(nombresEndpoint.includes(nombre), `"${nombre}" resultó elegible en el motor pero no en el endpoint -- criterios distintos`);
      }
    });
  }
);
