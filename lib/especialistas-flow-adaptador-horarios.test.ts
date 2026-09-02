/**
 * Rediseño de agendamiento (autorizado) — lista real de horarios y
 * resolución determinista de la selección de la clienta.
 *
 * Mismo patrón que especialistas-flow-adaptador.test.ts: integración REAL
 * contra dulabs_especialistas/dulabs_citas_especialista (tenant y
 * phone_number_id descartables, nunca los de Daniela), se salta sin
 * credenciales. resolverSeleccionHorario/formatearListaHorarios son puras
 * (sin I/O) y se prueban exhaustivamente sin red.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  listarHorariosDisponiblesEspecialista,
  resolverSeleccionHorario,
  formatearListaHorarios,
} from "@/lib/especialistas-flow-adaptador";
import { crearCitaEspecialista } from "@/lib/especialistas";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("resolverSeleccionHorario — puro, sin red (Parte 9/10/11 del pedido)", () => {
  const HORARIOS = ["15:00", "16:00", "17:00"];

  it("selección por índice 'la segunda' -> index=2 -> 16:00", () => {
    const r = resolverSeleccionHorario({ horariosDisponibles: HORARIOS, seleccionTipo: "index", seleccionIndice: 2 });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.hora, "16:00");
  });

  it("selección por índice 'la primera' -> index=1 -> 15:00", () => {
    const r = resolverSeleccionHorario({ horariosDisponibles: HORARIOS, seleccionTipo: "index", seleccionIndice: 1 });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.hora, "15:00");
  });

  it("selección por índice 'la última' -> index=3 (largo real de la lista) -> 17:00", () => {
    const r = resolverSeleccionHorario({ horariosDisponibles: HORARIOS, seleccionTipo: "index", seleccionIndice: HORARIOS.length });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.hora, "17:00");
  });

  it("índice fuera de rango (4, la lista solo tiene 3) -> RECHAZA, nunca inventa", () => {
    const r = resolverSeleccionHorario({ horariosDisponibles: HORARIOS, seleccionTipo: "index", seleccionIndice: 4 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "fuera_de_lista");
  });

  it("índice 0 -> RECHAZA (1-based, 0 no es válido)", () => {
    const r = resolverSeleccionHorario({ horariosDisponibles: HORARIOS, seleccionTipo: "index", seleccionIndice: 0 });
    assert.equal(r.ok, false);
  });

  it("selección por hora 'la de las 4' -> time='16:00', SÍ está en la lista -> acepta", () => {
    const r = resolverSeleccionHorario({ horariosDisponibles: HORARIOS, seleccionTipo: "time", seleccionHora: "16:00" });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.hora, "16:00");
  });

  it("selección por hora inventada por la IA (18:00, NO está en la lista real) -> RECHAZA SIEMPRE", () => {
    const r = resolverSeleccionHorario({ horariosDisponibles: HORARIOS, seleccionTipo: "time", seleccionHora: "18:00" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "fuera_de_lista");
  });

  it("'esa' sin contexto suficiente -> IA no manda ni index ni time -> ambiguo, nunca adivina", () => {
    const r = resolverSeleccionHorario({ horariosDisponibles: HORARIOS });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "ambiguo");
  });

  it("lista vacía -- cualquier selección se rechaza (no hay nada real que elegir)", () => {
    const r = resolverSeleccionHorario({ horariosDisponibles: [], seleccionTipo: "index", seleccionIndice: 1 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "fuera_de_lista");
  });

  it("seleccionIndice no entero (ej. 1.5) -> RECHAZA", () => {
    const r = resolverSeleccionHorario({ horariosDisponibles: HORARIOS, seleccionTipo: "index", seleccionIndice: 1.5 });
    assert.equal(r.ok, false);
  });
});

describe("formatearListaHorarios — determinista, nunca redactado por IA", () => {
  it("numera con emoji y formatea am/pm en español", () => {
    const texto = formatearListaHorarios(["15:00", "16:00", "17:00"]);
    assert.equal(texto, "1️⃣ 3:00 p. m.\n2️⃣ 4:00 p. m.\n3️⃣ 5:00 p. m.");
  });

  it("mañana vs tarde correctos (12h)", () => {
    const texto = formatearListaHorarios(["09:00", "12:00", "00:30"]);
    assert.equal(texto, "1️⃣ 9:00 a. m.\n2️⃣ 12:00 p. m.\n3️⃣ 12:30 a. m.");
  });

  it("lista vacía -> texto vacío", () => {
    assert.equal(formatearListaHorarios([]), "");
  });
});

describe(
  "listarHorariosDisponiblesEspecialista — integración real (tenant descartable)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_ID = randomUUID();
    const PHONE_NUMBER_ID = `test-horarios-${Date.now()}`;
    const especialistaIds: number[] = [];
    const citaIds: number[] = [];

    function proximoMartes(): string {
      const hoy = new Date();
      const diaSemana = hoy.getUTCDay();
      const diasHastaMartes = ((2 - diaSemana + 7) % 7) || 7;
      const fecha = new Date(hoy);
      fecha.setUTCDate(hoy.getUTCDate() + diasHastaMartes);
      return fecha.toISOString().slice(0, 10);
    }
    const FECHA = proximoMartes();

    function proximoDomingo(): string {
      const hoy = new Date();
      const diaSemana = hoy.getUTCDay();
      const diasHastaDomingo = ((0 - diaSemana + 7) % 7) || 7;
      const fecha = new Date(hoy);
      fecha.setUTCDate(hoy.getUTCDate() + diasHastaDomingo);
      return fecha.toISOString().slice(0, 10);
    }
    const DOMINGO = proximoDomingo();

    // Fecha DISTINTA de FECHA -- el test de desborde llena TODA la ventana
    // de Carla ese día; usar una fecha aparte evita chocar con la cita que
    // deja el test anterior ("un horario recién ocupado desaparece").
    function proximoMiercoles(): string {
      const hoy = new Date();
      const diaSemana = hoy.getUTCDay();
      const diasHastaMiercoles = ((3 - diaSemana + 7) % 7) || 7;
      const fecha = new Date(hoy);
      fecha.setUTCDate(hoy.getUTCDate() + diasHastaMiercoles);
      return fecha.toISOString().slice(0, 10);
    }
    const FECHA_DESBORDE = proximoMiercoles();

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const filas = [
        { nombre: "Nicol", numero_whatsapp: "573000000201", servicio: "pestañas", duracion_min: 90, requiere_aprobacion: true, bloquea_horario: true, es_general: false },
        { nombre: "Carla", numero_whatsapp: "573000000202", servicio: "manos", duracion_min: 60, requiere_aprobacion: false, bloquea_horario: true, es_general: false },
        { nombre: "Daniela", numero_whatsapp: "573000000203", servicio: "manos", duracion_min: 60, requiere_aprobacion: false, bloquea_horario: true, es_general: false },
      ];
      for (const fila of filas) {
        const { data, error } = await supabase
          .from("dulabs_especialistas")
          .insert({ id_tenant: TENANT_ID, phone_number_id: PHONE_NUMBER_ID, activo: true, ...fila })
          .select("id")
          .single();
        if (error) throw error;
        especialistaIds.push(data!.id as number);
      }
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (citaIds.length) await supabase.from("dulabs_citas_especialista").delete().in("id", citaIds);
      if (especialistaIds.length) await supabase.from("dulabs_especialistas").delete().in("id", especialistaIds);
    });

    it("lista real para servicio exclusivo (pestañas) -- todos los horarios devueltos respetan la ventana real de Nicol (>=15h entre semana)", async () => {
      const r = await listarHorariosDisponiblesEspecialista(supabase, {
        phoneNumberId: PHONE_NUMBER_ID,
        servicio: "pestañas volumen ruso",
        fecha: FECHA,
      });
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.especialistaResuelto, "Nicol");
        assert.ok(r.horarios.length > 0);
        for (const h of r.horarios) {
          const hora = Number(h.split(":")[0]);
          assert.ok(hora >= 15, `${h} debe estar en la ventana real de Nicol (>=15h)`);
        }
      }
    });

    it("lista real para categoría manos -- resuelve a Carla (fija), NUNCA a Daniela en el primer intento", async () => {
      const r = await listarHorariosDisponiblesEspecialista(supabase, {
        phoneNumberId: PHONE_NUMBER_ID,
        servicio: "semipermanente en manos",
        fecha: FECHA,
      });
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.especialistaResuelto, "Carla");
        assert.ok(r.horarios.length > 0);
        assert.ok(r.horarios.includes("09:00"), "un martes de 9 a 19h con Carla libre, 09:00 debe estar disponible");
      }
    });

    it("servicio no reconocido ('masaje') -> ok:false, NUNCA cae a 'manos' por defecto", async () => {
      const r = await listarHorariosDisponiblesEspecialista(supabase, {
        phoneNumberId: PHONE_NUMBER_ID,
        servicio: "masaje relajante",
        fecha: FECHA,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "servicio_no_manejado");
    });

    it("domingo -- spa cerrado, lista vacía (no es un error, es una respuesta real)", async () => {
      const r = await listarHorariosDisponiblesEspecialista(supabase, {
        phoneNumberId: PHONE_NUMBER_ID,
        servicio: "manos",
        fecha: DOMINGO,
      });
      assert.equal(r.ok, true);
      if (r.ok) assert.deepEqual(r.horarios, []);
    });

    it("un horario recién ocupado desaparece de la lista real", async () => {
      const antes = await listarHorariosDisponiblesEspecialista(supabase, {
        phoneNumberId: PHONE_NUMBER_ID,
        servicio: "manos",
        fecha: FECHA,
        duracionMinInput: 60,
      });
      assert.equal(antes.ok, true);
      if (!antes.ok) return;
      assert.ok(antes.horarios.includes("11:00"));

      const carlaId = especialistaIds[1]!; // Carla, insertada segunda
      const inicio = new Date(`${FECHA}T11:00:00-05:00`);
      const resultado = await crearCitaEspecialista(supabase, {
        especialistaId: carlaId,
        idTenant: TENANT_ID,
        phoneNumberId: PHONE_NUMBER_ID,
        telefonoCliente: "573009990001",
        nombreCliente: "Ocupante",
        servicio: "manos",
        inicio,
        duracionMin: 60,
        bloqueaHorario: true,
        origen: "manual",
      });
      assert.equal(resultado.ok, true);
      if (resultado.ok) citaIds.push(resultado.cita.id);

      const despues = await listarHorariosDisponiblesEspecialista(supabase, {
        phoneNumberId: PHONE_NUMBER_ID,
        servicio: "manos",
        fecha: FECHA,
        duracionMinInput: 60,
      });
      assert.equal(despues.ok, true);
      if (despues.ok) assert.equal(despues.horarios.includes("11:00"), false, "11:00 ya no debe aparecer como disponible");
    });

    it("desborde a Daniela cuando Carla queda sin ningún hueco ese día", async () => {
      // Un solo bloque de 10h (toda la ventana 9-19h de un martes) para
      // Carla la deja sin NINGÚN hueco -- fuerza el mismo desborde real que
      // ya usa agendarCitaEspecialista.
      const carlaId = especialistaIds[1]!;
      const inicio = new Date(`${FECHA_DESBORDE}T09:00:00-05:00`);
      const resultado = await crearCitaEspecialista(supabase, {
        especialistaId: carlaId,
        idTenant: TENANT_ID,
        phoneNumberId: PHONE_NUMBER_ID,
        telefonoCliente: "573009990002",
        nombreCliente: "Bloqueo total",
        servicio: "manos",
        inicio,
        duracionMin: 600,
        bloqueaHorario: true,
        origen: "manual",
      });
      assert.equal(resultado.ok, true);
      if (resultado.ok) citaIds.push(resultado.cita.id);

      const r = await listarHorariosDisponiblesEspecialista(supabase, {
        phoneNumberId: PHONE_NUMBER_ID,
        servicio: "semipermanente en manos",
        fecha: FECHA_DESBORDE,
        duracionMinInput: 60,
      });
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.especialistaResuelto, "Daniela", "con Carla sin ningún hueco, debe desbordar a Daniela");
        for (const h of r.horarios) {
          const hora = Number(h.split(":")[0]);
          assert.ok(hora >= 14, `${h} debe estar en la ventana real de Daniela entre semana (>=14h)`);
        }
      }
    });
  },
);
