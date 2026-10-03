/**
 * FASE 3B.3 — esquema de configuración del checkout con aceptación (campos, oficina, cierre, envíos,
 * motivos y textos) y verificación del responsable.
 *
 *   1. Delacour (y cualquier perfil anterior) sigue válido y sin bloques nuevos.
 *   2. Sin valores comerciales por defecto: cada decisión pendiente (D1–D18) es obligatoria DENTRO de su
 *      bloque; si falta, la configuración es inválida.
 *   3. Fail-closed: un bloque que el runtime aún no implementa deja la configuración inválida (el agente
 *      no responde); al implementarlo, el mismo bloque pasa.
 *   4. De la configuración a las políticas del motor: exactas, sin agregar nada.
 *   5. Responsable: miembro del MISMO negocio, activo; nunca de otro negocio.
 *
 * Valores FICTICIOS de prueba (no son decisiones del negocio). Nada toca Supabase.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHECKOUT_OPCIONES_LEGADO,
  FUNCIONES_3B_IMPLEMENTADAS,
  FUNCIONES_FASE_3B,
  checkoutOpcionesSchema,
  funcionesNoDisponibles,
  pagosPara,
  politicaDeAceptacion,
  reservaAlAceptar,
  resolverCheckoutOpciones,
  type CheckoutOpciones,
  type FuncionFase3B,
} from "@/lib/agente/perfil-negocio";
import { parseAgentConfig, type AgentConfigRow } from "@/lib/agente/config";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { createMemoryMiembrosStore, verificarResponsable, type ResponsableConfig } from "@/lib/agente/responsable";

const TENANT_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const TENANT_B = "bbbbbbbb-0000-4000-8000-00000000000b";

/** Texto con saltos de línea, emojis y mayúsculas: debe quedar EXACTAMENTE igual (sintético, no el aviso real). */
const AVISO_PRUEBA = "⚠️ AVISO DE PRUEBA:\n\nLínea uno del aviso.\n\n📦 Línea dos, con *negrita*.\n\n¿Confirmas? 🙏";

const CIERRE_COMPLETO = {
  modo: "aceptacion_humana",
  validacion_resumen: "boton_datos_correctos",
  mostrar_numero_pedido: false,
  textos: { aviso: AVISO_PRUEBA, tras_aviso_confirma: "Respuesta de prueba 😊" },
  responsable: { miembro_id: 41, respaldo_miembro_id: null, canales: ["panel"] },
  aceptan: "solo_responsable",
  reserva: { tipo: "sin_reserva" },
  vencimiento: { tipo: "sin_vencimiento" },
  reserva_tras_aceptar: { tipo: "plataforma" },
  respuesta_tras_aviso: { si_ya_respondio_persona: "no_responder" },
  pregunta_sin_respuesta: "handoff_inmediato",
} as const;

const OFICINA = {
  transportadora: "Transportadora de Prueba",
  oferta: "solo_si_cliente_pide",
  pide_direccion: false,
  pide_barrio: false,
  seleccion: { tipo: "texto_libre" },
  documento: { modo: "requerido", tipos: ["cc", "ce"], retencion: { tipo: "dias", dias: 30 }, si_se_niega: "handoff" },
} as const;

const ENVIOS = {
  cobertura: { tipo: "lista_blanca", ciudades: ["bogota", "medellin", "cali"] },
  tiempos: [
    { ciudades: ["bogota"], texto: "Texto de prueba Bogotá", corte: { hora_limite: "11:30", zona_horaria: "America/Bogota", dias: ["lun", "mar", "mie", "jue", "vie"], festivos: { tipo: "no_aplica_en", fechas: ["2026-12-08"] }, texto_antes: "Antes del corte", texto_despues: "Después del corte" } },
    { ciudades: "resto_con_cobertura", texto: "Texto de prueba resto" },
  ],
  sin_certeza: "handoff",
  ciudad_desconocida_en_checkout: "handoff",
} as const;

/** Perfil "tipo Aquí Sí Lo Compras" con TODOS los bloques (valores de prueba). */
const COMPLETO = {
  entregas: ["domicilio", "oficina_transportadora"],
  pagos: [{ metodo: "contra_entrega" }],
  campos: { nombre_completo: true, telefono: { modo: "requerido", acepta_mismo_whatsapp: true }, departamento: true, barrio: true },
  oficina: OFICINA,
  cierre: CIERRE_COMPLETO,
  envios: ENVIOS,
  handoff: { motivos_deterministas: ["queja", "garantia", "devolucion", "cambio"] },
  textos: { ubicacion: "Ubicación de prueba", confianza: "Confianza de prueba" },
};

const parse = (o: unknown) => checkoutOpcionesSchema.safeParse(o);
const valido = (o: unknown) => {
  const r = parse(o);
  assert.ok(r.success, JSON.stringify(!r.success ? r.error.issues : null));
  return r.data as CheckoutOpciones;
};
const invalido = (o: unknown, nota: string) => assert.equal(parse(o).success, false, nota);
const sin = <T extends Record<string, unknown>>(o: T, k: keyof T) => {
  const c = { ...o };
  delete c[k];
  return c;
};

const fila = (checkout_opciones: unknown): AgentConfigRow => ({
  id_tenant: TENANT_A,
  phone_number_id: "100000000000009",
  tipo: "catalog_sales",
  habilitado: true,
  proveedor: "gemini",
  modelo: "gemini-3.6-flash",
  credencial_ref: "env:GEMINI_KEY_PRUEBA",
  nivel_razonamiento: "low",
  herramientas: [...AGENT_TOOL_NAMES],
  canal: "retail",
  negocio: { nombre_negocio: "Negocio Ficticio" },
  checkout_conversacional: true,
  vocabulario: null,
  checkout_opciones,
  meta_token_plataforma: false,
});
const config = (o: unknown) => parseAgentConfig(fila(o), { tenantId: TENANT_A, phoneNumberId: "100000000000009" });

// ===========================================================================

describe("Fase 3B.3 · Delacour y los perfiles de siempre no cambian", () => {
  it("el perfil de Delacour sigue válido, idéntico y sin bloques nuevos", () => {
    assert.deepEqual(valido(CHECKOUT_OPCIONES_LEGADO), CHECKOUT_OPCIONES_LEGADO);
    assert.deepEqual(funcionesNoDisponibles(CHECKOUT_OPCIONES_LEGADO), []);
    assert.equal(politicaDeAceptacion(CHECKOUT_OPCIONES_LEGADO), null);
    assert.equal(reservaAlAceptar(CHECKOUT_OPCIONES_LEGADO), null);
    assert.equal(config(CHECKOUT_OPCIONES_LEGADO).kind, "ok");
    // Delacour sigue sin contra entrega (no la ofrece) y con sus pagos de siempre.
    assert.deepEqual(pagosPara(CHECKOUT_OPCIONES_LEGADO, "domicilio"), ["pago_en_tienda", "transferencia"]);
  });

  it("cierre explícito 'boton_confirmar' = el de siempre (permitido)", () => {
    const o = valido({ ...CHECKOUT_OPCIONES_LEGADO, cierre: { modo: "boton_confirmar" } });
    assert.deepEqual(funcionesNoDisponibles(o), []);
    assert.equal(config(o).kind, "ok");
  });

  it("contra entrega: con lo que viaja (domicilio u oficina), nunca con recoger en tienda", () => {
    const o = valido({ entregas: ["domicilio", "oficina_transportadora"], pagos: [{ metodo: "contra_entrega" }], oficina: OFICINA, cierre: CIERRE_COMPLETO });
    assert.deepEqual(pagosPara(o, "domicilio"), ["contra_entrega"]);
    assert.deepEqual(pagosPara(o, "oficina_transportadora"), ["contra_entrega"]);
    invalido({ entregas: ["tienda", "domicilio"], pagos: [{ metodo: "contra_entrega", solo_con: ["tienda"] }] }, "contra entrega con tienda");
    invalido({ entregas: ["tienda"], pagos: [{ metodo: "contra_entrega" }] }, "solo tienda + contra entrega: sin pago posible");
  });
});

describe("Fase 3B.3 · sin valores comerciales por defecto: cada decisión es obligatoria en su bloque", () => {
  it("el perfil completo (valores de prueba) es válido y conserva los textos EXACTOS", () => {
    const o = valido(COMPLETO);
    assert.equal(o.cierre?.modo === "aceptacion_humana" && o.cierre.textos.aviso, AVISO_PRUEBA, "byte a byte, sin recortar ni normalizar");
  });

  it("cierre con aceptación sin cualquiera de sus decisiones => inválido", () => {
    const decisiones = [
      "validacion_resumen", // D1
      "mostrar_numero_pedido", // D14
      "textos",
      "responsable", // D8
      "aceptan", // D7
      "reserva", // D5
      "vencimiento", // D6
      "reserva_tras_aceptar", // D18
      "respuesta_tras_aviso", // D11
      "pregunta_sin_respuesta", // D12
    ] as const;
    for (const d of decisiones) invalido({ ...COMPLETO, cierre: sin(CIERRE_COMPLETO, d) }, `falta ${d}`);
    invalido({ ...COMPLETO, cierre: { ...CIERRE_COMPLETO, textos: { aviso: AVISO_PRUEBA } } }, "falta el texto tras el aviso");
    invalido({ ...COMPLETO, cierre: { ...CIERRE_COMPLETO, reserva: { tipo: "ttl" } } }, "reserva con plazo sin minutos");
    invalido({ ...COMPLETO, cierre: { ...CIERRE_COMPLETO, reserva: { tipo: "72h" } } }, "nada de 72 h implícitas");
  });

  it("textos controlados: nunca se recortan; espacios al borde o vacíos => inválido", () => {
    invalido({ ...COMPLETO, cierre: { ...CIERRE_COMPLETO, textos: { aviso: ` ${AVISO_PRUEBA}`, tras_aviso_confirma: "ok" } } }, "espacio al inicio");
    invalido({ ...COMPLETO, cierre: { ...CIERRE_COMPLETO, textos: { aviso: "   ", tras_aviso_confirma: "ok" } } }, "solo espacios");
    invalido({ ...COMPLETO, textos: { ubicacion: "Texto con salto al final\n" } }, "salto de línea al final");
  });

  it("oficina: el bloque existe si y solo si se ofrece la entrega; sin transportadora ni decisiones => inválido", () => {
    invalido({ ...COMPLETO, oficina: undefined }, "oficina ofrecida sin bloque");
    invalido({ ...COMPLETO, entregas: ["domicilio"] }, "bloque sin ofrecer la entrega");
    for (const d of ["transportadora", "oferta", "pide_direccion", "pide_barrio", "seleccion", "documento"] as const) invalido({ ...COMPLETO, oficina: sin(OFICINA, d) }, `oficina sin ${d}`);
    invalido({ ...COMPLETO, oficina: { ...OFICINA, documento: { modo: "requerido", tipos: ["cc"], si_se_niega: "handoff" } } }, "documento sin retención (D4)");
    invalido({ ...COMPLETO, oficina: { ...OFICINA, documento: { modo: "requerido", tipos: [], retencion: { tipo: "sin_borrado_automatico" }, si_se_niega: "handoff" } } }, "documento sin tipos (D4)");
    invalido({ ...COMPLETO, oficina: { ...OFICINA, documento: { ...OFICINA.documento, si_se_niega: "continuar" } } }, "negarse al documento siempre pasa a una persona");
    invalido({ ...COMPLETO, oficina: { ...OFICINA, documento: { ...OFICINA.documento, tipos: ["CC"] } } }, "código de tipo en minúsculas");
  });

  it("responsable: whatsapp exige destino y plantilla; el respaldo no es la misma persona", () => {
    invalido({ ...COMPLETO, cierre: { ...CIERRE_COMPLETO, responsable: { miembro_id: 41, respaldo_miembro_id: null, canales: ["whatsapp"] } } }, "whatsapp sin datos");
    invalido(
      { ...COMPLETO, cierre: { ...CIERRE_COMPLETO, responsable: { miembro_id: 41, respaldo_miembro_id: null, canales: ["panel"], whatsapp: { destino: "573000000000", plantilla: "aviso_prueba", idioma: "es" } } } },
      "datos de whatsapp sin el canal",
    );
    invalido({ ...COMPLETO, cierre: { ...CIERRE_COMPLETO, responsable: { miembro_id: 41, respaldo_miembro_id: 41, canales: ["panel"] } } }, "respaldo = responsable");
    valido({ ...COMPLETO, cierre: { ...CIERRE_COMPLETO, responsable: { miembro_id: 41, respaldo_miembro_id: 52, canales: ["panel", "whatsapp"], whatsapp: { destino: "573000000000", plantilla: "aviso_prueba", idioma: "es" } } } });
  });

  it("envíos: cobertura, tiempos y la ciudad desconocida son decisiones explícitas; sin certeza => persona", () => {
    for (const d of ["cobertura", "tiempos", "sin_certeza", "ciudad_desconocida_en_checkout"] as const) invalido({ ...COMPLETO, envios: sin(ENVIOS, d) }, `envíos sin ${d}`);
    invalido({ ...COMPLETO, envios: { ...ENVIOS, sin_certeza: "estimar" } }, "nunca estimar sin certeza");
    invalido({ ...COMPLETO, envios: { ...ENVIOS, tiempos: [{ ciudades: ["pasto"], texto: "x" }] } }, "tiempo de una ciudad sin cobertura");
    invalido({ ...COMPLETO, envios: { ...ENVIOS, tiempos: [{ ciudades: "resto_con_cobertura", texto: "a" }, { ciudades: "resto_con_cobertura", texto: "b" }] } }, "dos reglas para el resto");
    const corte = ENVIOS.tiempos[0].corte;
    invalido({ ...COMPLETO, envios: { ...ENVIOS, tiempos: [{ ciudades: ["bogota"], texto: "x", corte: sin(corte, "festivos") }] } }, "festivos sin decidir (D10)");
    invalido({ ...COMPLETO, envios: { ...ENVIOS, tiempos: [{ ciudades: ["bogota"], texto: "x", corte: { ...corte, zona_horaria: "UTC" } }] } }, "solo hora de Bogotá");
    invalido({ ...COMPLETO, envios: { ...ENVIOS, tiempos: [{ ciudades: ["bogota"], texto: "x", corte: { ...corte, hora_limite: "25:00" } }] } }, "hora inválida");
    invalido({ ...COMPLETO, envios: { ...ENVIOS, cobertura: { tipo: "lista_blanca", ciudades: ["Bogotá"] } } }, "ciudades normalizadas");
  });

  it("motivos de paso a una persona: solo de la lista cerrada", () => {
    invalido({ ...COMPLETO, handoff: { motivos_deterministas: ["cualquier_cosa"] } }, "motivo inventado");
    invalido({ ...COMPLETO, handoff: { motivos_deterministas: [] } }, "sin motivos");
  });

  it("claves desconocidas => inválido (estricto en todos los bloques)", () => {
    invalido({ ...COMPLETO, extra: true }, "raíz");
    invalido({ ...COMPLETO, campos: { ...COMPLETO.campos, cedula: true } }, "campos");
    invalido({ ...COMPLETO, cierre: { ...CIERRE_COMPLETO, reserva_por_defecto: 72 } }, "cierre");
  });
});

describe("Fase 3B.3 · fail-closed: ningún bloque se enciende a medias", () => {
  it("Fase 3B.4: campos y oficina ya los atiende el checkout; el cierre con aceptación sigue BLOQUEADO (faltan 3B.5 y 3B.7)", () => {
    assert.deepEqual(
      Object.entries(FUNCIONES_3B_IMPLEMENTADAS).filter(([, v]) => v).map(([k]) => k).sort(),
      // Fase 3B.6: el motor de envíos ya lo atiende el runtime (herramienta, guardián, derivación y checkout).
      ["campos", "envios", "oficina"],
    );
    const o = valido(COMPLETO);
    // (COMPLETO trae dos tipos de documento: elegir entre varios también espera D4.)
    assert.deepEqual(funcionesNoDisponibles(o).sort(), ["cierre_aceptacion_humana", "documento_varios_tipos", "handoff_determinista", "textos_fijos"].sort());
    assert.deepEqual(config(o), { kind: "invalid", reason: "checkout_feature_unavailable" });
    // Sin cierre por aceptación, campos y oficina ni siquiera son válidos (con el botón "Confirmar" se perderían).
    invalido({ ...CHECKOUT_OPCIONES_LEGADO, campos: { barrio: true } }, "campos sin aceptación");
    invalido({ entregas: ["domicilio", "oficina_transportadora"], pagos: [{ metodo: "contra_entrega" }], oficina: OFICINA }, "oficina sin aceptación");
    // Uno solo basta para bloquear.
    const base = { entregas: ["domicilio"], pagos: [{ metodo: "contra_entrega" }] };
    const conOficina = { entregas: ["domicilio", "oficina_transportadora"], pagos: [{ metodo: "contra_entrega" }], cierre: CIERRE_COMPLETO };
    const solo: Array<[FuncionFase3B[], unknown]> = [
      [["cierre_aceptacion_humana"], { ...base, cierre: CIERRE_COMPLETO }],
      [["handoff_determinista"], { ...CHECKOUT_OPCIONES_LEGADO, handoff: { motivos_deterministas: ["queja"] } }],
      [["textos_fijos"], { ...CHECKOUT_OPCIONES_LEGADO, textos: { ubicacion: "x" } }],
      [["cierre_aceptacion_humana", "documento_varios_tipos"], { ...conOficina, oficina: OFICINA }],
      [["cierre_aceptacion_humana", "oficina_lista"], { ...conOficina, oficina: { ...OFICINA, documento: { modo: "no_pedir" }, seleccion: { tipo: "lista", oficinas: ["Oficina Centro"] } } }],
    ];
    for (const [f, opciones] of solo) {
      assert.deepEqual(funcionesNoDisponibles(valido(opciones)).sort(), [...f].sort(), f.join("+"));
      assert.deepEqual(config(opciones), { kind: "invalid", reason: "checkout_feature_unavailable" }, f.join("+"));
    }
    // Un tipo de documento (o "sin especificar", D4): ya lo atiende el checkout.
    for (const tipos of [["cc"], "sin_especificar"] as const) {
      const ok = valido({ ...conOficina, oficina: { ...OFICINA, documento: { ...OFICINA.documento, tipos } } });
      assert.deepEqual(funcionesNoDisponibles(ok), ["cierre_aceptacion_humana"], JSON.stringify(tipos));
    }
  });

  it("cuando un bloque se implemente, el mismo perfil deja de bloquearse (la compuerta funciona)", () => {
    const todas = Object.fromEntries(FUNCIONES_FASE_3B.map((f) => [f, true])) as Record<FuncionFase3B, boolean>;
    assert.deepEqual(funcionesNoDisponibles(valido(COMPLETO), todas), []);
  });

  it("una configuración rota nunca cae a otra: inválida, no 'sin agente'", () => {
    assert.equal(resolverCheckoutOpciones({ ...COMPLETO, cierre: { modo: "aceptacion_humana" } }).ok, false);
    assert.deepEqual(config({ ...COMPLETO, cierre: { modo: "aceptacion_humana" } }), { kind: "invalid", reason: "checkout_options_invalid" });
  });
});

describe("Fase 3B.3 · de la configuración a las políticas del motor (exactas)", () => {
  it("sin reserva / sin vencimiento / documento por días / reserva de la plataforma al aceptar", () => {
    assert.deepEqual(politicaDeAceptacion(valido(COMPLETO)), {
      reservation: { kind: "none" },
      expiration: { kind: "none" },
      document: { kind: "required_for_office", allowedTypes: ["cc", "ce"], retention: { kind: "days", days: 30 } },
    });
    assert.deepEqual(reservaAlAceptar(valido(COMPLETO)), { kind: "platform" });
  });

  it("reserva y vencimiento con plazo; documento sin borrado automático; plazo propio al aceptar", () => {
    const o = valido({
      ...COMPLETO,
      oficina: { ...OFICINA, documento: { modo: "requerido", tipos: ["cc"], retencion: { tipo: "sin_borrado_automatico" }, si_se_niega: "handoff" } },
      cierre: { ...CIERRE_COMPLETO, reserva: { tipo: "ttl", minutos: 120 }, vencimiento: { tipo: "tras", minutos: 2880 }, reserva_tras_aceptar: { tipo: "ttl", minutos: 4320 } },
    });
    assert.deepEqual(politicaDeAceptacion(o), {
      reservation: { kind: "ttl", minutes: 120 },
      expiration: { kind: "after", minutes: 2880 },
      document: { kind: "required_for_office", allowedTypes: ["cc"], retention: { kind: "no_automatic_deletion" } },
    });
    assert.deepEqual(reservaAlAceptar(o), { kind: "ttl", minutes: 4320 });
  });

  it("sin oficina o con documento 'no_pedir': nunca se recoge documento", () => {
    const sinOficina = valido({ entregas: ["domicilio"], pagos: [{ metodo: "contra_entrega" }], cierre: CIERRE_COMPLETO });
    assert.deepEqual(politicaDeAceptacion(sinOficina)?.document, { kind: "not_collected" });
    const noPedir = valido({ ...COMPLETO, oficina: { ...OFICINA, documento: { modo: "no_pedir" } } });
    assert.deepEqual(politicaDeAceptacion(noPedir)?.document, { kind: "not_collected" });
  });

  it("plazos fuera de los límites técnicos => inválido", () => {
    invalido({ ...COMPLETO, cierre: { ...CIERRE_COMPLETO, reserva: { tipo: "ttl", minutos: 0 } } }, "0 minutos");
    invalido({ ...COMPLETO, cierre: { ...CIERRE_COMPLETO, vencimiento: { tipo: "tras", minutos: 43_201 } } }, "más de 30 días");
    invalido({ ...COMPLETO, oficina: { ...OFICINA, documento: { ...OFICINA.documento, retencion: { tipo: "dias", dias: 0 } } } }, "retención 0 días");
  });
});

describe("Fase 3B.3 · responsable: miembro del MISMO negocio, activo (multi-negocio)", () => {
  const store = createMemoryMiembrosStore([
    { id: 41, tenantId: TENANT_A, estado: "activo", rol: "agente", email: "persona.a@negocio-a.test" },
    { id: 52, tenantId: TENANT_A, estado: "activo", rol: "admin", email: "respaldo.a@negocio-a.test" },
    { id: 53, tenantId: TENANT_A, estado: "suspendido", rol: "agente", email: "suspendida@negocio-a.test" },
    { id: 54, tenantId: TENANT_A, estado: "activo", rol: "agente", email: null },
    { id: 77, tenantId: TENANT_B, estado: "activo", rol: "admin", email: "persona.b@negocio-b.test" },
  ]);
  const resp = (over: Partial<ResponsableConfig>): ResponsableConfig => ({ miembro_id: 41, respaldo_miembro_id: null, canales: ["panel"], ...over });

  it("válido: miembro activo del mismo negocio (y respaldo activo del mismo negocio)", async () => {
    const r = await verificarResponsable(store, TENANT_A, resp({ respaldo_miembro_id: 52 }));
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.miembro.id, 41);
    assert.equal(r.ok && r.respaldo?.id, 52);
  });

  it("A nunca usa un responsable (ni un respaldo) de B", async () => {
    assert.deepEqual(await verificarResponsable(store, TENANT_A, resp({ miembro_id: 77 })), { ok: false, error: "responsable_de_otro_negocio" });
    assert.deepEqual(await verificarResponsable(store, TENANT_A, resp({ respaldo_miembro_id: 77 })), { ok: false, error: "respaldo_de_otro_negocio" });
    assert.deepEqual(await verificarResponsable(store, TENANT_B, resp({ miembro_id: 41 })), { ok: false, error: "responsable_de_otro_negocio" });
  });

  it("inexistente, suspendido o sin correo (con canal correo) => no se usa", async () => {
    assert.deepEqual(await verificarResponsable(store, TENANT_A, resp({ miembro_id: 999 })), { ok: false, error: "responsable_no_existe" });
    assert.deepEqual(await verificarResponsable(store, TENANT_A, resp({ miembro_id: 53 })), { ok: false, error: "responsable_inactivo" });
    assert.deepEqual(await verificarResponsable(store, TENANT_A, resp({ miembro_id: 54, canales: ["correo"] })), { ok: false, error: "responsable_sin_correo" });
    assert.deepEqual(await verificarResponsable(store, TENANT_A, resp({ respaldo_miembro_id: 53 })), { ok: false, error: "respaldo_inactivo" });
  });
});
