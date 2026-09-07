/**
 * MODO AGENDA GUIADA (autorizado). Prueba el orquestador nuevo
 * (decidirPasoGuiado, dentro de resolver.ts) contra el banco REAL de AMORE,
 * sin Supabase real (deps inyectados), sin Gemini real. Sigue el mismo
 * criterio ya establecido en resolver-agendamiento.test.ts: los pasos que
 * de verdad requieren Nylas (buscar disponibilidad, crear la cita) se
 * prueban en lib/flow/executors/internal-action-executor-agendamiento-nylas.test.ts
 * (describe "MODO AGENDA GUIADA") -- acá se prueba que resolver.ts arme
 * correctamente el menú/selección en cada paso y delegue esas 2 acciones
 * exactamente cuando corresponde (modo="agendar_buscar_disponibilidad"/
 * "agendar_crear_cita", el mismo mecanismo real ya existente).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverEscenario } from "@/lib/bot-escenarios/resolver";
import { AMORE_ESCENARIOS_SEED } from "@/lib/bot-escenarios/seed-amore";
import type { AgendamientoEnCurso, ContextoConversacional, EscenarioRow, MenuAgendamiento } from "@/lib/bot-escenarios/tipos";
import type { ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";
import { ID_CANCELAR, ID_CAMBIAR_HORARIO, ID_CONFIRMAR_CITA } from "@/lib/bot-escenarios/agendamiento-guiado";

const FAKE_SUPABASE = {} as SupabaseClient;
const TENANT = "amore-test";

const ESCENARIOS: EscenarioRow[] = AMORE_ESCENARIOS_SEED.map((s, i) => ({ ...s, id: `e${i}`, tenantId: TENANT }));

const CATALOGO: ServicioCatalogoReal[] = [
  { id: "s-dipping", nombre: "Dipping", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-pressón", nombre: "Press On", precio: 80000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-manospies", nombre: "Manos y Pies Semi", precio: 80000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-retoques", nombre: "Retoques", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
];

const ESPECIALISTAS_ELEGIBLES = [
  { especialistaId: 1, nombre: "Mary" },
  { especialistaId: 2, nombre: "Cristal" },
];
const ESPECIALISTAS_REALES = [
  { id: 1, nombre: "Mary" },
  { id: 2, nombre: "Cristal" },
];

async function resolver(
  mensaje: string,
  ctx: ContextoConversacional = {},
  opts: { nombreConocido?: string | null } = {},
) {
  return resolverEscenario({
    supabase: FAKE_SUPABASE,
    tenantId: TENANT,
    mensaje,
    contexto: ctx,
    turno: 0,
    telefonoCliente: "573148127388",
    deps: {
      cargarEscenarios: async () => ESCENARIOS,
      cargarCatalogo: async () => CATALOGO,
      cargarProfesionales: async () => ({ profesionales: [] }),
      cargarConocimiento: async () => [],
      cargarEspecialistas: async () => ESPECIALISTAS_REALES,
      resolverEspecialistasElegibles: async () => ({ modo: "explicita", especialistas: ESPECIALISTAS_ELEGIBLES }),
      buscarNombreConocido: async () => opts.nombreConocido ?? null,
      guardarNombreCliente: async () => {},
    },
  });
}

async function conversar(mensajes: string[], opts: { nombreConocido?: string | null } = {}) {
  let ctx: ContextoConversacional = {};
  let r;
  for (const m of mensajes) {
    r = await resolver(m, ctx, opts);
    ctx = r.contexto;
  }
  return r!;
}

describe("1. 'Quiero una cita' -> SELECCION_SERVICIO, nunca depende de Gemini", () => {
  it("activa el modo guiado y muestra el menú real de servicios", async () => {
    const r = await resolver("quiero una cita");
    assert.equal(r.escenarioCodigo, "070_agendamiento");
    assert.equal(r.modo, "deterministic");
    assert.equal(r.requiereIA, false, "nunca depende de Gemini para entrar al modo guiado");
    assert.equal(r.contexto.agendamiento?.modo, "guiado");
    assert.equal(r.contexto.agendamiento?.paso, "SELECCION_SERVICIO");
    assert.match(r.respuestaTexto ?? "", /¿Qué servicio deseas realizarte\?/);
    assert.match(r.respuestaTexto ?? "", /1\. Dipping/);
  });

  it("18/19. 'Hola'/'¿Qué es Dipping?' NUNCA inician el modo guiado", async () => {
    const rHola = await resolver("Hola");
    assert.equal(rHola.contexto.agendamiento, undefined, "'Hola' nunca activa agendamiento");

    const rInfo = await resolver("¿Qué es Dipping?");
    assert.equal(rInfo.contexto.agendamiento, undefined, "una pregunta informativa aislada nunca activa agendamiento");
  });
});

describe("2/3. Selección de servicio -- por número o por texto exacto, siempre contra el UUID real", () => {
  it("selecciona por número exacto ('1' = Dipping) -> avanza a SELECCION_PROFESIONAL con especialistas reales elegibles", async () => {
    const r = await conversar(["quiero una cita", "1"]);
    assert.equal(r.contexto.agendamiento?.servicioId, "s-dipping");
    assert.equal(r.contexto.agendamiento?.servicioNombre, "Dipping");
    assert.equal(r.contexto.agendamiento?.paso, "SELECCION_PROFESIONAL");
    assert.match(r.respuestaTexto ?? "", /¿Tienes alguna profesional de preferencia\?/);
    assert.match(r.respuestaTexto ?? "", /1\. Mary/);
    assert.match(r.respuestaTexto ?? "", /Cualquier profesional/);
  });

  it("selecciona por texto exacto ('Dipping') -> mismo resultado que por número", async () => {
    const r = await conversar(["quiero una cita", "Dipping"]);
    assert.equal(r.contexto.agendamiento?.servicioId, "s-dipping");
    assert.equal(r.contexto.agendamiento?.paso, "SELECCION_PROFESIONAL");
  });

  it("20. NUNCA depende de Gemini: un texto que no coincide con ninguna opción real pide de nuevo, sin inventar ni aproximar", async () => {
    const r = await conversar(["quiero una cita", "no sé, algo bonito"]);
    assert.match(r.respuestaTexto ?? "", /Por favor selecciona una de las opciones disponibles/);
    assert.equal(r.contexto.agendamiento?.paso, "SELECCION_SERVICIO", "se queda en el mismo paso, nunca avanza con un dato inventado");
    assert.equal(r.contexto.agendamiento?.servicioId, undefined);
  });
});

describe("Selección de profesional", () => {
  it("selecciona una profesional real por número -> avanza a SELECCION_FECHA", async () => {
    const r = await conversar(["quiero una cita", "1", "2"]); // 1=Dipping, 2=Cristal
    assert.equal(r.contexto.agendamiento?.especialistaId, 2);
    assert.equal(r.contexto.agendamiento?.especialistaNombre, "Cristal");
    assert.equal(r.contexto.agendamiento?.paso, "SELECCION_FECHA");
    assert.match(r.respuestaTexto ?? "", /¿Qué día prefieres\?/);
  });

  it("'Cualquier profesional' -> especialistaId queda sin definir (id de control ANY, nunca un UUID inventado)", async () => {
    const r = await conversar(["quiero una cita", "1", "Cualquier profesional"]);
    assert.equal(r.contexto.agendamiento?.especialistaId, undefined);
    assert.equal(r.contexto.agendamiento?.paso, "SELECCION_FECHA");
  });
});

describe("4/6. Selección de fecha -> delega la disponibilidad real a agendar_buscar_disponibilidad (Nylas, sin duplicar)", () => {
  it("selecciona la primera fecha real del menú -> fechaISO real, modo=agendar_buscar_disponibilidad", async () => {
    const r = await conversar(["quiero una cita", "1", "2", "1"]);
    assert.equal(r.modo, "agendar_buscar_disponibilidad");
    assert.ok(r.contexto.agendamiento?.fechaISO, "debe quedar una fecha ISO real, nunca inventada por Gemini");
    assert.equal(r.contexto.agendamiento?.paso, "SELECCION_HORARIO");
  });

  it("'Ver más fechas' pagina determinísticamente sin perder el resto del acumulador", async () => {
    const r = await conversar(["quiero una cita", "1", "2", "5"]); // 5 = "Ver más fechas"
    assert.equal(r.contexto.agendamiento?.paso, "SELECCION_FECHA");
    assert.equal(r.contexto.agendamiento?.servicioId, "s-dipping", "el servicio ya elegido se conserva");
    assert.equal(r.contexto.agendamiento?.especialistaId, 2, "la profesional ya elegida se conserva");
    assert.match(r.respuestaTexto ?? "", /¿Qué día prefieres\?/);
  });
});

const MENU_HORARIO: MenuAgendamiento = {
  tipo: "horario",
  opciones: [
    { numero: 1, id: "1::2026-09-11T08:00:00-05:00", label: "Cristal — 8:00 AM", sinonimos: ["cristal 08:00"] },
    { numero: 2, id: "2::2026-09-11T10:00:00-05:00", label: "Cristal — 10:00 AM", sinonimos: ["cristal 10:00"] },
  ],
};

function acumuladorListoParaHorario(overrides: Partial<AgendamientoEnCurso> = {}): AgendamientoEnCurso {
  return {
    modo: "guiado",
    paso: "SELECCION_HORARIO",
    servicioId: "s-dipping",
    servicioNombre: "Dipping",
    duracionMin: 120,
    precio: 60000,
    fechaISO: "2026-09-11",
    menuActual: MENU_HORARIO,
    ...overrides,
  };
}

describe("7. Selección de horario -- resuelve el slot EXACTO por número, nunca por aproximación", () => {
  it("'1' resuelve exactamente ese slot (especialista + hora reales) y pasa a pedir el nombre si no se conoce", async () => {
    const r = await resolver("1", { agendamiento: acumuladorListoParaHorario() }, { nombreConocido: null });
    assert.equal(r.contexto.agendamiento?.horarioSeleccionadoISO, "2026-09-11T08:00:00-05:00");
    assert.equal(r.contexto.agendamiento?.especialistaSeleccionadaId, 1);
    assert.equal(r.contexto.agendamiento?.especialistaSeleccionadaNombre, "Mary");
    assert.match(r.respuestaTexto ?? "", /¿A nombre de quién dejamos la reserva\?/);
  });

  it("con nombre ya conocido, pasa directo al menú de CONFIRMACION con el resumen real", async () => {
    const r = await resolver("2", { agendamiento: acumuladorListoParaHorario() }, { nombreConocido: "Valentina" });
    assert.equal(r.contexto.agendamiento?.paso, "CONFIRMACION");
    assert.equal(r.contexto.agendamiento?.nombreCliente, "Valentina");
    assert.match(r.respuestaTexto ?? "", /Servicio: Dipping/);
    assert.match(r.respuestaTexto ?? "", /Profesional: Cristal/);
    assert.match(r.respuestaTexto ?? "", /Hora: 10:00 AM/);
    assert.match(r.respuestaTexto ?? "", /¿Deseas confirmar tu cita\?/);
  });

  it("16. nombre pendiente (texto libre, cliente nuevo) se captura, pide cumpleaños (sección 14, sin cambios) y luego avanza a CONFIRMACION", async () => {
    const previo = await resolver("1", { agendamiento: acumuladorListoParaHorario() }, { nombreConocido: null });
    assert.equal(previo.contexto.agendamiento?.nombrePendiente, true);

    const conNombre = await resolver("Valentina Gómez", previo.contexto);
    assert.equal(conNombre.contexto.agendamiento?.nombreCliente, "Valentina Gómez");
    assert.equal(conNombre.contexto.agendamiento?.cumpleanosPendiente, true, "cliente nuevo -- se pide cumpleaños una sola vez antes de confirmar");

    const r = await resolver("15 de marzo", conNombre.contexto);
    assert.equal(r.contexto.agendamiento?.paso, "CONFIRMACION");
    assert.match(r.respuestaTexto ?? "", /¿Deseas confirmar tu cita\?/);
  });
});

const MENU_CONFIRMACION: MenuAgendamiento = {
  tipo: "confirmacion",
  opciones: [
    { numero: 1, id: ID_CONFIRMAR_CITA, label: "Confirmar cita", sinonimos: ["confirmar cita", "confirmar"] },
    { numero: 2, id: ID_CAMBIAR_HORARIO, label: "Cambiar horario", sinonimos: ["cambiar horario"] },
    { numero: 3, id: ID_CANCELAR, label: "Cancelar", sinonimos: ["cancelar"] },
  ],
};

function acumuladorListoParaConfirmar(): AgendamientoEnCurso {
  return {
    modo: "guiado",
    paso: "CONFIRMACION",
    servicioId: "s-dipping",
    servicioNombre: "Dipping",
    duracionMin: 120,
    precio: 60000,
    fechaISO: "2026-09-11",
    horarioSeleccionadoISO: "2026-09-11T08:00:00-05:00",
    especialistaSeleccionadaId: 1,
    especialistaSeleccionadaNombre: "Mary",
    nombreCliente: "Valentina",
    menuActual: MENU_CONFIRMACION,
  };
}

describe("8/9/10/11. Confirmación -- botón real, nunca la interpretación de 'sí' por Gemini para decidir la reserva", () => {
  it("'1' (Confirmar cita) -> delega en agendar_crear_cita (Nylas real, sin duplicar la creación)", async () => {
    const r = await resolver("1", { agendamiento: acumuladorListoParaConfirmar() });
    assert.equal(r.modo, "agendar_crear_cita");
  });

  it("'Confirmar cita' (texto exacto) también resuelve igual", async () => {
    const r = await resolver("Confirmar cita", { agendamiento: acumuladorListoParaConfirmar() });
    assert.equal(r.modo, "agendar_crear_cita");
  });

  it("'sí' explícito también resuelve a confirmar (vocabulario cerrado ya existente, nunca Gemini decidiendo)", async () => {
    const r = await resolver("sí", { agendamiento: acumuladorListoParaConfirmar() });
    assert.equal(r.modo, "agendar_crear_cita");
  });

  it("10. 'Cambiar horario' -> vuelve a agendar_buscar_disponibilidad (re-consulta real, nunca reutiliza un horario obsoleto)", async () => {
    const r = await resolver("2", { agendamiento: acumuladorListoParaConfirmar() });
    assert.equal(r.modo, "agendar_buscar_disponibilidad");
    assert.equal(r.contexto.agendamiento?.horarioSeleccionadoISO, undefined, "la selección obsoleta se limpia");
  });

  it("11. 'Cancelar' -> nunca crea la reserva, limpia el agendamiento por completo", async () => {
    const r = await resolver("3", { agendamiento: acumuladorListoParaConfirmar() });
    assert.notEqual(r.modo, "agendar_crear_cita");
    assert.equal(r.contexto.agendamiento, undefined);
  });

  it("texto ambiguo ('creo que sí') NUNCA confirma -- pide de nuevo la selección real", async () => {
    const r = await resolver("creo que sí", { agendamiento: acumuladorListoParaConfirmar() });
    assert.notEqual(r.modo, "agendar_crear_cita");
    assert.match(r.respuestaTexto ?? "", /Por favor selecciona una de las opciones disponibles/);
  });
});

describe("Cancelación explícita en cualquier paso del modo guiado", () => {
  it("'cancela' durante SELECCION_SERVICIO limpia el agendamiento por completo", async () => {
    const previo = await resolver("quiero una cita");
    const r = await resolver("cancela", previo.contexto);
    assert.equal(r.contexto.agendamiento, undefined);
  });

  it("'no' durante SELECCION_PROFESIONAL limpia el agendamiento por completo", async () => {
    const previo = await conversar(["quiero una cita", "1"]);
    const r = await resolver("no", previo.contexto);
    assert.equal(r.contexto.agendamiento, undefined);
  });
});

describe("17. Interrupción informativa durante el modo guiado -- responde y conserva EXACTAMENTE el mismo menú pendiente", () => {
  it("'¿Cuánto cuesta el Dipping?' durante SELECCION_PROFESIONAL responde el precio y vuelve al mismo menú", async () => {
    const previo = await conversar(["quiero una cita", "1"]); // ya en SELECCION_PROFESIONAL
    assert.equal(previo.contexto.agendamiento?.paso, "SELECCION_PROFESIONAL");

    const r = await resolver("¿cuánto cuesta el dipping?", previo.contexto);
    assert.match(r.respuestaTexto ?? "", /60\.000|\$60/, "responde el precio real");

    // El estado guiado sigue INTACTO -- mismo paso, mismo menú, mismo servicio.
    assert.equal(r.contexto.agendamiento?.modo, "guiado");
    assert.equal(r.contexto.agendamiento?.paso, "SELECCION_PROFESIONAL");
    assert.equal(r.contexto.agendamiento?.servicioId, "s-dipping");
    assert.deepEqual(r.contexto.agendamiento?.menuActual, previo.contexto.agendamiento?.menuActual);

    // Y el siguiente mensaje real retoma el menú de profesionales con normalidad.
    const r2 = await resolver("2", r.contexto);
    assert.equal(r2.contexto.agendamiento?.especialistaId, 2);
    assert.equal(r2.contexto.agendamiento?.paso, "SELECCION_FECHA");
  });
});

describe("Compatibilidad hacia atrás -- un agendamiento SIN `modo` (de antes de esta fase) nunca se fuerza al modo guiado", () => {
  it("un agendamiento ya en curso, sin `modo`, sigue funcionando con la modalidad anterior (texto libre)", async () => {
    const legacy: ContextoConversacional = { agendamiento: { servicioId: "s-dipping", servicioNombre: "Dipping", duracionMin: 120 } };
    const r = await resolver("el viernes", legacy);
    // Modalidad anterior: extrae la fecha de texto libre directamente (nunca
    // un menú) -- con servicio+fecha ya completos, el siguiente paso real es
    // consultar disponibilidad (mismo comportamiento de siempre, ver
    // resolver-agendamiento.test.ts caso C).
    assert.equal(r.modo, "agendar_buscar_disponibilidad");
    assert.ok(r.contexto.agendamiento?.fechaISO, "la fecha se extrajo de texto libre, comportamiento de la modalidad anterior intacto");
    assert.equal(r.contexto.agendamiento?.modo, undefined, "nunca se le agrega modo='guiado' a una conversación que ya estaba en curso");
  });
});
