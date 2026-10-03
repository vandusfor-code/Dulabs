/**
 * FASE 3B.9D — configuración completa y activación controlada de Aquí Sí Lo Compras. TODO en memoria (runtime y esquemas REALES; nada toca Supabase,
 * Gemini ni Meta).
 *
 *   1. El aviso obligatorio: EXACTO (747 bytes, SHA-256), y cualquier alteración se detecta.
 *   2. La configuración completa: válida con el esquema del runtime, sin los bloques que el runtime no implementa, sin nada de otro negocio.
 *   3. La fila resultante de 03 / 05 contra el parser REAL del runtime (deshabilitada => disabled; habilitada => ok; con compuerta cerrada => inválida).
 *   4. Los SQL: son EXACTAMENTE lo generado; el 03 NO trae un responsable por defecto; cada script escribe solo lo previsto y mantiene sus guardas.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { leerConfigAceptacion } from "@/lib/agente/aceptacion-humana";
import { businessConfigSchema, parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import { CREDENCIAL_GEMINI_ASLC, HERRAMIENTAS_ASLC, IDENTIDAD_ASLC_PRODUCCION, evaluarConfigCompleta, filaBaseAslc, generarSqlAprovisionamiento } from "@/lib/agente/aprovisionamiento";
import {
  AVISO_OFICIAL_BYTES,
  AVISO_OFICIAL_SHA256,
  DECISIONES_ASLC,
  ETAPAS_ASLC,
  POLITICAS_ASLC,
  SQL_IDENTIDAD,
  TEXTOS_ASLC,
  archivosDeActivacion,
  comprobacionesDeEtapa,
  configuracionCompletaAslc,
  generarSqlAbrirAlPublico,
  generarSqlActivacionControlada,
  generarSqlConfiguracionCompleta,
  generarSqlFrenoDeEmergencia,
  generarSqlReanudarTrasFreno,
  generarSqlVerEquipo,
  negocioCompletoAslc,
  sha256Utf8,
  verificarAviso,
  type DatosEtapaAslc,
  type FilaAgenteVerificable,
} from "@/lib/agente/activacion-aslc";
import { FUNCIONES_3B_IMPLEMENTADAS, FUNCIONES_FASE_3B, funcionesNoDisponibles, politicaDeAceptacion, type FuncionFase3B } from "@/lib/agente/perfil-negocio";

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");
const AVISO = (JSON.parse(leer("supabase/provisioning/aslc/textos-aprobados.json")) as { aviso: string }).aviso;
const RESPONSABLE = 41;
const sinComentarios = (sql: string) => sql.replace(/--.*$/gm, "");
/** Sin comentarios NI literales de texto: para contar sentencias reales (un mensaje de error que cita un UPDATE no es una escritura). */
const sinLit = (sql: string) => sinComentarios(sql).replace(/'(?:[^']|'')*'/g, "''");

/** Lo que ven los clientes (todo menos las políticas para el modelo, que NOMBRAN los pagos prohibidos para prohibirlos). */
const AJENO = /joya|joyer[ií]a|\baretes?\b|\bcollar(es)?\b|\banillos?\b|\bdijes?\b|\bpulseras?\b|delacour|💍|💖|pago en tienda|recoger en tienda|nequi|daviplata|transferencia/i;

const CERRADA: Readonly<Record<FuncionFase3B, boolean>> = { ...FUNCIONES_3B_IMPLEMENTADAS, cierre_aceptacion_humana: false };

/** La fila de dulabs_agente_runtime_config como queda tras 02 + 03 (y 05 con `habilitado`). */
function fila(over: Partial<AgentConfigRow> = {}): AgentConfigRow {
  return {
    id_tenant: IDENTIDAD_ASLC_PRODUCCION.idTenant,
    phone_number_id: IDENTIDAD_ASLC_PRODUCCION.phoneNumberId,
    tipo: "catalog_sales",
    habilitado: false,
    proveedor: "gemini",
    modelo: "gemini-3.6-flash",
    credencial_ref: CREDENCIAL_GEMINI_ASLC,
    nivel_razonamiento: null,
    herramientas: [...HERRAMIENTAS_ASLC],
    canal: "retail",
    negocio: negocioCompletoAslc(),
    vocabulario: null,
    checkout_opciones: configuracionCompletaAslc({ aviso: AVISO, miembroId: RESPONSABLE, respaldoMiembroId: null }),
    checkout_conversacional: true,
    meta_token_plataforma: false,
    transcripcion_audio: false,
    ...over,
  };
}
const esperado = { tenantId: IDENTIDAD_ASLC_PRODUCCION.idTenant, phoneNumberId: IDENTIDAD_ASLC_PRODUCCION.phoneNumberId };

// ===========================================================================
// 1. El aviso obligatorio
// ===========================================================================

describe("3B.9D · el aviso obligatorio es EXACTO y cualquier alteración se detecta", () => {
  it("el aprobado: 747 bytes y el SHA-256 fijado; verificarAviso lo acepta", () => {
    assert.equal(Buffer.byteLength(AVISO, "utf8"), AVISO_OFICIAL_BYTES);
    assert.equal(sha256Utf8(AVISO), AVISO_OFICIAL_SHA256);
    assert.doesNotThrow(() => verificarAviso(AVISO));
  });

  it("una letra, un emoji, un espacio, un salto de línea de más o saltos CRLF => se rechaza", () => {
    for (const alterado of [AVISO.replace("IMPORTANTE", "IMPORTANTES"), AVISO.replace("🙏", ""), AVISO.replace("📦", "📦 "), `${AVISO}\n`, AVISO.replace(/\n/g, "\r\n"), AVISO.replace("recibirlo?", "recibirlo.")]) {
      assert.throws(() => verificarAviso(alterado), /byte a byte/);
      assert.throws(() => configuracionCompletaAslc({ aviso: alterado, miembroId: RESPONSABLE }), /byte a byte/);
    }
  });
});

// ===========================================================================
// 2. La configuración completa
// ===========================================================================

describe("3B.9D · la configuración completa de ASLC", () => {
  const config = () => configuracionCompletaAslc({ aviso: AVISO, miembroId: RESPONSABLE, respaldoMiembroId: 42 });

  it("es válida con el esquema del runtime y completa (sin nada pendiente)", () => {
    const e = evaluarConfigCompleta(JSON.parse(JSON.stringify(config())) as Record<string, unknown>);
    assert.equal(e.lista, true, JSON.stringify(e.pendientes));
    assert.deepEqual(e.pendientes, []);
  });

  it("lo que definió el negocio: solo contraentrega, envío gratis, Inter Rapidísimo, 2–3 días hábiles, corte 11:30 de Bogotá, sin certeza = persona, datos del pedido, documento en oficina (si se niega: persona)", () => {
    const c = config();
    assert.deepEqual(c.pagos, [{ metodo: "contra_entrega" }]);
    assert.deepEqual(c.entregas, ["domicilio", "oficina_transportadora"]);
    assert.deepEqual(c.campos, { nombre_completo: true, telefono: { modo: "requerido", acepta_mismo_whatsapp: DECISIONES_ASLC.telefonoAceptaMismoWhatsapp }, departamento: true, barrio: true });
    assert.equal(c.oficina?.transportadora, "Inter Rapidísimo");
    assert.equal(c.oficina?.documento.modo, "requerido");
    if (c.oficina?.documento.modo === "requerido") assert.equal(c.oficina.documento.si_se_niega, "handoff");
    assert.equal(c.envios?.envio_gratis, true);
    assert.equal(c.envios?.transportadora_habitual, "Inter Rapidísimo");
    assert.equal(c.envios?.sin_certeza, "handoff");
    assert.equal(c.envios?.ciudad_desconocida_en_checkout, "handoff");
    const [bogota, resto] = c.envios!.tiempos;
    assert.deepEqual(bogota.ciudades, ["bogota"]);
    assert.equal(bogota.corte?.hora_limite, "11:30");
    assert.equal(bogota.corte?.zona_horaria, "America/Bogota");
    assert.equal(resto.ciudades, "resto_con_cobertura");
    assert.deepEqual(resto.dias_habiles, { min: 2, max: 3 });
    // El flujo del negocio: resumen validado por el cliente, aviso EXACTO y, si una persona ya escribió, la IA NO responde (caso 15).
    assert.equal(c.cierre?.modo, "aceptacion_humana");
    if (c.cierre?.modo === "aceptacion_humana") {
      assert.equal(c.cierre.validacion_resumen, "boton_datos_correctos");
      assert.equal(c.cierre.textos.aviso, AVISO);
      assert.equal(c.cierre.respuesta_tras_aviso.si_ya_respondio_persona, "no_responder");
      assert.deepEqual(c.cierre.responsable, { miembro_id: RESPONSABLE, respaldo_miembro_id: 42, canales: ["panel"] });
    }
  });

  it("NO usa los bloques que el runtime no implementa (handoff, textos) ni textos de decisión / envíos: la única compuerta es la del cierre, y está ABIERTA", () => {
    const c = config();
    assert.equal(c.handoff, undefined);
    assert.equal(c.textos, undefined);
    assert.equal(c.envios?.textos, undefined);
    if (c.cierre?.modo === "aceptacion_humana") {
      assert.equal(c.cierre.textos.aceptado, undefined);
      assert.equal(c.cierre.textos.rechazado, undefined);
      assert.equal(c.cierre.textos.cancelado, undefined);
    }
    assert.deepEqual(funcionesNoDisponibles(c), [], "con las compuertas REALES nada queda bloqueado");
    assert.deepEqual(funcionesNoDisponibles(c, CERRADA), ["cierre_aceptacion_humana"], "con la compuerta de antes, el cierre era lo único que la bloqueaba");
    assert.equal(FUNCIONES_3B_IMPLEMENTADAS.cierre_aceptacion_humana, true);
    for (const f of ["handoff_determinista", "textos_fijos", "documento_varios_tipos", "oficina_lista"] as const) assert.equal(FUNCIONES_3B_IMPLEMENTADAS[f], false, `${f} sigue sin implementarse`);
  });

  it("las decisiones adoptadas están en la configuración (reserva 12 h, vencimiento 24 h, documento 30 días) y se traducen a la política del motor", () => {
    const p = politicaDeAceptacion(config());
    assert.deepEqual(p, {
      reservation: { kind: "ttl", minutes: DECISIONES_ASLC.reservaMinutos },
      expiration: { kind: "after", minutes: DECISIONES_ASLC.vencimientoMinutos },
      document: { kind: "required_for_office", allowedTypes: ["no_especificado"], retention: { kind: "days", days: DECISIONES_ASLC.documentoRetencionDias } },
    });
    assert.equal(DECISIONES_ASLC.reservaMinutos, 720);
    assert.equal(DECISIONES_ASLC.vencimientoMinutos, 1440);
  });

  it("nada de otro negocio ni datos personales en lo que ve el cliente; y cabe en la columna (≈4 KB; la BD admite 32 KB)", () => {
    const c = config();
    const textos = [
      c.cierre?.modo === "aceptacion_humana" ? c.cierre.textos.tras_aviso_confirma : "",
      ...c.envios!.tiempos.flatMap((t) => [t.texto, t.corte?.texto_antes ?? "", t.corte?.texto_despues ?? ""]),
      c.envios?.texto_resumen ?? "",
      TEXTOS_ASLC.notaEnvioPanel,
    ];
    for (const t of textos) assert.ok(!AJENO.test(t), `texto ajeno: ${t}`);
    const crudo = JSON.stringify(c);
    assert.ok(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(crudo), "sin correos");
    assert.ok(!/\b(57)?3\d{9}\b/.test(crudo), "sin teléfonos");
    assert.ok(Buffer.byteLength(crudo, "utf8") < 8_000);
  });
});

describe("3B.9D · negocio (políticas para el modelo)", () => {
  it("es válido; ≤12 políticas de ≤300 caracteres; recoge las reglas del negocio y NUNCA promete abrir el paquete antes de pagar", () => {
    const n = negocioCompletoAslc();
    assert.equal(businessConfigSchema.safeParse(n).success, true);
    assert.equal(n.nombre_negocio, "Aquí Sí Lo Compras");
    assert.ok(n.politicas && n.politicas.length >= 4 && n.politicas.length <= 12);
    for (const p of n.politicas ?? []) assert.ok(p.length <= 300, p);
    const todas = (n.politicas ?? []).join("\n");
    assert.match(todas, /contraentrega/i);
    assert.match(todas, /estafa/i);
    assert.match(todas, /NUNCA prometas que podrá abrir el paquete antes de pagar/);
    assert.match(todas, /Nunca confirmes ni des por aceptado un pedido/);
    assert.deepEqual([...POLITICAS_ASLC], n.politicas);
    // Sin saludo, tono ni conocimiento inventados.
    assert.equal(n.saludo, undefined);
    assert.equal(n.tono, undefined);
    assert.equal(n.conocimiento, undefined);
    assert.ok(!/joya|joyer[ií]a|delacour|💍|💖/i.test(JSON.stringify(n)));
  });
});

// ===========================================================================
// 3. La fila resultante contra el parser REAL del runtime
// ===========================================================================

describe("3B.9D · la fila que dejan 02 + 03 + 05, leída por el parser REAL del runtime", () => {
  it("tras el 03 (fila DESHABILITADA): el agente no corre (disabled)", () => {
    assert.deepEqual(parseAgentConfig(fila({ habilitado: false }), esperado), { kind: "disabled" });
  });

  it("tras el 05 (HABILITADA): configuración válida con las compuertas reales; checkout y audio encendidos; sin confirm_order; token propio; la persona responsable llega al motor", () => {
    const r = parseAgentConfig(fila({ habilitado: true, transcripcion_audio: true }), esperado);
    assert.equal(r.kind, "ok", JSON.stringify(r));
    const cfg = (r as { config: AgentRuntimeConfig }).config;
    assert.equal(cfg.checkoutEnabled, true);
    assert.equal(cfg.audioTranscription, true);
    assert.equal(cfg.metaPlatformToken, false);
    assert.ok(!cfg.tools.includes("confirm_order") && cfg.tools.includes("consultar_envio"));
    assert.equal(cfg.credentialRef, CREDENCIAL_GEMINI_ASLC);
    const aceptacion = leerConfigAceptacion(cfg);
    assert.ok(aceptacion, "el negocio usa la aceptación humana");
    assert.equal(aceptacion.responsable.miembro_id, RESPONSABLE);
    assert.equal(aceptacion.aceptan, "responsable_y_admins");
    assert.equal(aceptacion.textoTrasAviso, TEXTOS_ASLC.trasAvisoConfirma);
    assert.equal(aceptacion.siYaRespondioPersona, "no_responder");
    assert.equal(aceptacion.notaEnvio, TEXTOS_ASLC.notaEnvioPanel);
    assert.deepEqual(aceptacion.textosDecision, { aceptado: null, rechazado: null, cancelado: null }, "sin texto configurado no se le escribe nada al cliente");
  });

  it("con la compuerta de ANTES (cerrada) la misma fila sería inválida y callaría; y con el candado del 02 también (nunca otro bot)", () => {
    const habilitada = fila({ habilitado: true, transcripcion_audio: true });
    assert.deepEqual(parseAgentConfig(habilitada, esperado, { funciones3b: CERRADA }), { kind: "invalid", reason: "checkout_feature_unavailable" });
    const base = filaBaseAslc();
    assert.deepEqual(parseAgentConfig({ ...fila({ habilitado: true }), checkout_opciones: base.checkout_opciones, checkout_conversacional: false }, esperado), { kind: "invalid", reason: "activation_pending" });
  });

  it("sin checkout conversacional (si el 03 no se corrió) la configuración con aceptación humana es inválida: el modelo nunca conserva confirm_order", () => {
    assert.deepEqual(parseAgentConfig(fila({ habilitado: true, checkout_conversacional: false }), esperado), { kind: "invalid", reason: "checkout_required_for_acceptance" });
  });

  it("todas las compuertas se abren solo para lo que ASLC usa: ningún bloque no implementado queda encendido a medias", () => {
    for (const f of FUNCIONES_FASE_3B) {
      const usadaPorAslc = ["campos", "oficina", "cierre_aceptacion_humana", "envios"].includes(f);
      assert.equal(FUNCIONES_3B_IMPLEMENTADAS[f], usadaPorAslc, f);
    }
  });
});

// ===========================================================================
// 4. Los SQL
// ===========================================================================

describe("3B.9D · SQL: lo generado, solo lo previsto y con sus guardas", () => {
  const archivos = archivosDeActivacion(AVISO);
  const repo = (nombre: string) => leer(`supabase/provisioning/aslc/${nombre}`);

  it("cada archivo del repositorio es EXACTAMENTE lo que genera el código (nada escrito a mano que se desvíe)", () => {
    assert.deepEqual(Object.keys(archivos), ["03_configurar_completo_sin_activar.sql", "05_activacion_controlada.sql", "06_abrir_al_publico.sql", "07_freno_de_emergencia.sql", "08_ver_equipo_solo_lectura.sql", "09_cambiar_responsable.sql", "10_reanudar_tras_freno.sql"]);
    for (const [nombre, sql] of Object.entries(archivos)) assert.equal(repo(nombre), sql, nombre);
    assert.equal(repo("02_aprovisionar_sin_activar.sql"), generarSqlAprovisionamiento(), "el 02 (YA aplicado en producción) no cambió");
  });

  it("todos identifican a ASLC con la MISMA identidad que el 02 (tenant + phone_number_id + nombre; nunca telefono_negocio)", () => {
    assert.ok(generarSqlAprovisionamiento().includes(SQL_IDENTIDAD));
    for (const nombre of ["03_configurar_completo_sin_activar.sql", "05_activacion_controlada.sql", "06_abrir_al_publico.sql", "07_freno_de_emergencia.sql", "09_cambiar_responsable.sql", "10_reanudar_tras_freno.sql"]) {
      assert.ok(archivos[nombre].includes(SQL_IDENTIDAD), nombre);
    }
    assert.ok(archivos["08_ver_equipo_solo_lectura.sql"].includes(`tenant_id::text = '${IDENTIDAD_ASLC_PRODUCCION.idTenant}'`));
    for (const sql of Object.values(archivos)) assert.ok(!/telefono_negocio/.test(sql));
  });

  it("03: NO trae una persona responsable por defecto (sin editarlo, aborta); dos únicas líneas a editar; exige responsable ACTIVO con rol que decide; guarda el hash del aviso", () => {
    const sql = archivos["03_configurar_completo_sin_activar.sql"];
    assert.match(sql, /v_responsable bigint := null;/);
    assert.match(sql, /v_respaldo bigint := null;/);
    assert.equal((sql.match(/:= null;\s+-- ← EDITAR/g) ?? []).length, 2, "exactamente DOS líneas para editar");
    for (const guarda of ["PATRICIA_REAL_PENDIENTE", "estado = 'activo'", "rol in ('admin', 'agente')", "el respaldo no puede ser la misma persona", "ia_pausada is true", "habilitado = false", AVISO_OFICIAL_SHA256, "sha256(convert_to("]) {
      assert.ok(sql.includes(guarda), guarda);
    }
  });

  it("03: el JSON incrustado ES la configuración y el negocio validados (con el responsable como marcador que el script reemplaza)", () => {
    const sql = archivos["03_configurar_completo_sin_activar.sql"];
    const cfg = /\$cfg\$\n([\s\S]*?)\n\$cfg\$::jsonb/.exec(sql)?.[1];
    const neg = /\$neg\$\n([\s\S]*?)\n\$neg\$::jsonb/.exec(sql)?.[1];
    assert.ok(cfg && neg);
    assert.deepEqual(JSON.parse(cfg), JSON.parse(JSON.stringify(configuracionCompletaAslc({ aviso: AVISO, miembroId: 1 }))));
    assert.deepEqual(JSON.parse(neg), JSON.parse(JSON.stringify(negocioCompletoAslc())));
    assert.equal((JSON.parse(cfg) as { cierre: { textos: { aviso: string } } }).cierre.textos.aviso, AVISO, "el aviso pegado en el SQL es EXACTAMENTE el aprobado");
    assert.ok(!/activacion_pendiente/.test(cfg), "sin el candado");
  });

  it("03 escribe SOLO la fila del agente deshabilitada; no habilita, no toca la pausa ni la restricción ni módulos", () => {
    const sql = sinLit(archivos["03_configurar_completo_sin_activar.sql"]);
    assert.deepEqual([...sql.matchAll(/\bupdate\s+(public\.\w+)/g)].map((m) => m[1]), ["public.dulabs_agente_runtime_config"]);
    assert.ok(!/insert\s+into|delete\s+from|truncate|drop\s|alter\s|dulabs_tenant_modulos\s+set/i.test(sql));
    assert.ok(!/habilitado\s*=\s*true/.test(sql) && !/ia_pausada\s*=/.test(sql) && !/ia_restringida_a\s*=\s*(null|')/.test(sql));
  });

  it("05 (activación CONTROLADA): se NIEGA si la IA no está restringida; exige configuración completa, responsable activo y notificaciones apagado; no toca la restricción", () => {
    const sql = archivos["05_activacion_controlada.sql"];
    const sin = sinLit(sql);
    for (const guarda of ["NO está restringida a números de prueba", "coalesce(btrim(v_restringida), '') = ''", "activacion_pendiente' is not null", "'{cierre,modo}'", "checkout_conversacional debe estar encendido", "estado = 'activo'", "rol in ('admin', 'agente')", "modulo = 'notificaciones_pedidos' and habilitado"]) {
      assert.ok(sql.includes(guarda), guarda);
    }
    assert.ok(/set habilitado = true, transcripcion_audio = true/.test(sin));
    assert.ok(/set ia_pausada = false/.test(sin));
    assert.ok(!/ia_restringida_a\s*=\s*null/.test(sin), "no abre al público");
    assert.deepEqual([...sin.matchAll(/\bupdate\s+(public\.\w+)/g)].map((m) => m[1]), ["public.dulabs_agente_runtime_config", "public.dulabs_clientes_config"]);
    assert.ok(!/insert\s+into|delete\s+from|dulabs_tenant_modulos\s+set/i.test(sin));
  });

  it("06 (abrir al público): solo quita la restricción, y solo con la activación controlada en marcha y la configuración completa", () => {
    const sql = archivos["06_abrir_al_publico.sql"];
    const sin = sinLit(sql);
    assert.ok(/update public\.dulabs_clientes_config set ia_restringida_a = null/.test(sin));
    assert.deepEqual([...sin.matchAll(/\bupdate\s+(public\.\w+)/g)].map((m) => m[1]), ["public.dulabs_clientes_config"]);
    for (const guarda of ["ya está abierto al público", "ia_pausada is false", "habilitado is true", "activacion_pendiente' is not null", "modulo = 'notificaciones_pedidos' and habilitado"]) assert.ok(sql.includes(guarda), guarda);
    assert.ok(!/ia_pausada\s*=\s*false/.test(sin), "no cambia la pausa");
  });

  it("07 (freno): UNA sola sentencia que pausa; no borra ni cambia nada más", () => {
    const sin = sinComentarios(archivos["07_freno_de_emergencia.sql"]);
    assert.equal((sin.match(/;/g) ?? []).length, 1);
    assert.ok(/set ia_pausada = true/.test(sin) && !/delete|insert|ia_restringida_a\s*=/i.test(sin));
    assert.equal(generarSqlFrenoDeEmergencia(), archivos["07_freno_de_emergencia.sql"]);
  });

  it("10 (reanudar tras el freno): quita SOLO la pausa y deja la restricción como estaba; nunca es la primera activación; exige configuración completa y responsable activo", () => {
    const sql = archivos["10_reanudar_tras_freno.sql"];
    const sin = sinLit(sql);
    assert.deepEqual([...sin.matchAll(/\bupdate\s+(public\.\w+)/g)].map((m) => m[1]), ["public.dulabs_clientes_config"]);
    assert.ok(/update public\.dulabs_clientes_config set ia_pausada = false where/.test(sin));
    assert.ok(!/ia_restringida_a\s*=|habilitado\s*=\s*true|transcripcion_audio\s*=/.test(sin), "no toca la restricción, no habilita, no cambia el audio");
    assert.ok(!/insert\s+into|delete\s+from|dulabs_tenant_modulos\s+set/i.test(sin));
    for (const guarda of ["no hay nada que reanudar", "habilitado is true", "la primera activación es 05_activacion_controlada.sql", "activacion_pendiente' is not null", "'{cierre,modo}'", "estado = 'activo'", "rol in ('admin', 'agente')", "modulo = 'notificaciones_pedidos' and habilitado", "is not distinct from v_restringida"]) {
      assert.ok(sql.includes(guarda), guarda);
    }
    assert.equal(generarSqlReanudarTrasFreno(), sql);
    assert.ok(archivos["07_freno_de_emergencia.sql"].includes("10_reanudar_tras_freno.sql"), "el freno indica cómo reanudar");
  });

  it("cada script con guardas es UNA sola sentencia (un bloque DO atómico), sin begin;/commit; explícitos que podrían dejar una transacción abierta en el editor", () => {
    for (const nombre of ["03_configurar_completo_sin_activar.sql", "05_activacion_controlada.sql", "06_abrir_al_publico.sql", "09_cambiar_responsable.sql", "10_reanudar_tras_freno.sql"]) {
      const sql = archivos[nombre];
      assert.equal((sql.match(/^do \$\$$/gm) ?? []).length, 1, `${nombre}: un solo bloque DO`);
      assert.ok(/^end \$\$;$/m.test(sql), `${nombre}: termina el bloque`);
      assert.ok(!/^(begin|commit);$/m.test(sql), `${nombre}: sin transacción explícita`);
    }
  });

  it("08 (equipo): solo lectura, sin correos; dice quién sirve como responsable", () => {
    const sin = sinComentarios(generarSqlVerEquipo());
    assert.ok(!/\b(insert|update|delete|drop|alter|truncate|create)\b/i.test(sin));
    assert.equal((sin.match(/;/g) ?? []).length, 1);
    assert.ok(!/email/i.test(sin));
    assert.ok(/sirve_como_responsable/.test(sin));
  });

  it("09 (cambiar responsable): solo toca el responsable dentro de checkout_opciones, validado contra el equipo real", () => {
    const sql = archivos["09_cambiar_responsable.sql"];
    const sin = sinLit(sql);
    assert.match(sql, /v_responsable bigint := null;/);
    assert.deepEqual([...sin.matchAll(/\bupdate\s+(public\.\w+)/g)].map((m) => m[1]), ["public.dulabs_agente_runtime_config"]);
    assert.ok(/set checkout_opciones = v_opciones, updated_at = now\(\)/.test(sin));
    assert.ok(!/habilitado\s*=|ia_pausada\s*=|ia_restringida_a\s*=/.test(sin));
    for (const guarda of ["PATRICIA_REAL_PENDIENTE", "estado = 'activo'", "rol in ('admin', 'agente')"]) assert.ok(sql.includes(guarda), guarda);
  });

  it("ningún script usa el operador jsonb ? (algunos clientes SQL lo toman por un parámetro), ni contiene datos del cliente ni secretos", () => {
    for (const [nombre, sql] of Object.entries(archivos)) {
      assert.ok(!/\s\?\s*'/.test(sinComentarios(sql)), `${nombre}: operador ?`);
      assert.ok(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(sql), `${nombre}: correo`);
      assert.ok(!/\b(57)?3\d{9}\b/.test(sql), `${nombre}: teléfono`);
      assert.ok(!/AIza|sk-[A-Za-z0-9]{20}|eyJ[A-Za-z0-9_-]{20}|Bearer /.test(sql), `${nombre}: secreto`);
    }
  });

  it("solo el 05 (primera activación) y el 10 (reanudar tras el freno) quitan la pausa, solo el 07 la pone y solo el 06 quita la restricción: ninguna combinación abre al público por accidente", () => {
    const quita = (sql: string) => /ia_pausada\s*=\s*false/.test(sinComentarios(sql));
    const pone = (sql: string) => /ia_pausada\s*=\s*true/.test(sinComentarios(sql));
    const abre = (sql: string) => /ia_restringida_a\s*=\s*null/.test(sinComentarios(sql));
    assert.deepEqual(Object.entries(archivos).filter(([, s]) => quita(s)).map(([n]) => n), ["05_activacion_controlada.sql", "10_reanudar_tras_freno.sql"]);
    assert.deepEqual(Object.entries(archivos).filter(([, s]) => pone(s)).map(([n]) => n), ["07_freno_de_emergencia.sql"]);
    assert.deepEqual(Object.entries(archivos).filter(([, s]) => abre(s)).map(([n]) => n), ["06_abrir_al_publico.sql"]);
    assert.equal(generarSqlConfiguracionCompleta({ aviso: AVISO }), archivos["03_configurar_completo_sin_activar.sql"]);
    assert.equal(generarSqlActivacionControlada(), archivos["05_activacion_controlada.sql"]);
    assert.equal(generarSqlAbrirAlPublico(), archivos["06_abrir_al_publico.sql"]);
  });
});

// ===========================================================================
// 5. La verificación por etapas (la lógica que juzga el estado REAL de producción, probada con filas en memoria)
// ===========================================================================

describe("3B.9D · verificación por etapas: el veredicto de cada etapa sale de la fila REAL, con el parser y las compuertas reales", () => {
  const EQUIPO = [
    { id: RESPONSABLE, rol: "agente", estado: "activo" },
    { id: 52, rol: "admin", estado: "activo" },
    { id: 53, rol: "lectura", estado: "activo" },
    { id: 54, rol: "agente", estado: "invitado" },
    { id: 55, rol: "agente", estado: "suspendido" },
  ];
  const MODULOS = ["catalogo", "pedidos", "pedidos_por_aceptar"].map((modulo) => ({ modulo, habilitado: true }));
  const PRUEBA = "573001110000"; // número ficticio de prueba

  const comoFila = (r: AgentConfigRow) => r as unknown as FilaAgenteVerificable;
  function datos(over: Partial<DatosEtapaAslc> = {}): DatosEtapaAslc {
    return { iaPausada: true, iaRestringidaA: PRUEBA, agenteAslc: [comoFila(fila())], agentesOtros: [{ credencial_ref: "env:GEMINI_KEY_DELACOUR" }], modulosAslc: MODULOS, equipo: EQUIPO, ...over };
  }
  const mal = (c: Record<string, boolean>) => Object.entries(c).filter(([, v]) => v !== true).map(([k]) => k);
  const controlado = (over: Partial<AgentConfigRow> = {}, d: Partial<DatosEtapaAslc> = {}) =>
    datos({ iaPausada: false, agenteAslc: [comoFila(fila({ habilitado: true, transcripcion_audio: true, ...over }))], ...d });
  type Opciones = { cierre: { textos: { aviso: string }; responsable: { miembro_id: number; respaldo_miembro_id: number | null } }; pagos: Array<{ metodo: string }> };
  const conOpciones = (cambio: (o: Opciones) => void): AgentConfigRow => {
    const o = JSON.parse(JSON.stringify(fila().checkout_opciones)) as Opciones;
    cambio(o);
    return fila({ checkout_opciones: o });
  };

  it("hay cinco etapas y sin etapa solo se informa el estado de seguridad básico", () => {
    assert.deepEqual([...ETAPAS_ASLC], ["inicial", "aprovisionado", "configurado", "controlado", "publico"]);
    assert.deepEqual(Object.keys(comprobacionesDeEtapa(null, datos())).sort(), ["ia_pausada", "notificaciones_pedidos_apagado", "sin_agente_habilitado"]);
  });

  it("inicial: sin fila de agente ni módulos y con la IA pausada; con cualquier fila o módulo, falla", () => {
    const vacio = datos({ agenteAslc: [], modulosAslc: [] });
    assert.deepEqual(mal(comprobacionesDeEtapa("inicial", vacio)), []);
    assert.deepEqual(mal(comprobacionesDeEtapa("inicial", datos({ modulosAslc: [], agenteAslc: [comoFila(fila())] }))), ["sin_fila_de_agente"]);
    assert.deepEqual(mal(comprobacionesDeEtapa("inicial", datos({ agenteAslc: [], modulosAslc: MODULOS }))), ["sin_modulos"]);
  });

  it("aprovisionado: lo que deja el 02 (fila deshabilitada con candado, 3 módulos, IA pausada) pasa; sin candado o con otro pago, falla", () => {
    const base = { ...filaBaseAslc(), habilitado: false } as unknown as FilaAgenteVerificable;
    assert.deepEqual(mal(comprobacionesDeEtapa("aprovisionado", datos({ agenteAslc: [base] }))), []);
    const sinCandado = { ...base, checkout_opciones: { ...(base.checkout_opciones as object), activacion_pendiente: undefined } } as FilaAgenteVerificable;
    assert.deepEqual(mal(comprobacionesDeEtapa("aprovisionado", datos({ agenteAslc: [sinCandado] }))), ["fila_deshabilitada_con_candado"]);
    assert.deepEqual(mal(comprobacionesDeEtapa("aprovisionado", datos({ agenteAslc: [base], iaPausada: false }))), ["ia_pausada"]);
    assert.deepEqual(mal(comprobacionesDeEtapa("aprovisionado", datos({ agenteAslc: [base], modulosAslc: MODULOS.slice(0, 2) }))), ["modulos_catalogo_pedidos_por_aceptar"]);
  });

  it("configurado: lo que deja el 03 pasa TODO; cada defecto lo detecta una comprobación concreta", () => {
    assert.deepEqual(mal(comprobacionesDeEtapa("configurado", datos())), []);
    const quien = (d: DatosEtapaAslc, esperadas: string[], opts?: Parameters<typeof comprobacionesDeEtapa>[2]) => assert.deepEqual(mal(comprobacionesDeEtapa("configurado", d, opts)).sort(), esperadas.sort());
    quien(datos({ agenteAslc: [comoFila(fila({ checkout_opciones: { entregas: ["domicilio"], pagos: [{ metodo: "contra_entrega" }], activacion_pendiente: true }, checkout_conversacional: false }))] }), [
      "sin_candado_de_activacion",
      "cierre_aceptacion_humana",
      "envios_cargados",
      "checkout_conversacional_encendido",
      "aviso_oficial_exacto",
      "responsable_activa_con_rol_que_decide",
      "valida_con_las_compuertas_reales",
    ]);
    // Una letra distinta: la configuración sigue siendo válida, pero el aviso ya NO es el aprobado.
    quien(datos({ agenteAslc: [comoFila(conOpciones((o) => (o.cierre.textos.aviso = o.cierre.textos.aviso.replace("IMPORTANTE", "IMPORTANTES"))))] }), ["aviso_oficial_exacto"]);
    // Un espacio al final: además de no ser el aprobado, el esquema del runtime lo rechaza.
    quien(datos({ agenteAslc: [comoFila(conOpciones((o) => (o.cierre.textos.aviso = `${o.cierre.textos.aviso} `)))] }), ["aviso_oficial_exacto", "valida_con_las_compuertas_reales"]);
    quien(datos({ agenteAslc: [comoFila(fila({ checkout_conversacional: false }))] }), ["checkout_conversacional_encendido", "valida_con_las_compuertas_reales"]);
    quien(datos({ agenteAslc: [comoFila(fila({ herramientas: [...HERRAMIENTAS_ASLC, "confirm_order"] }))] }), ["sin_confirm_order"]);
    quien(datos({ agenteAslc: [comoFila(conOpciones((o) => (o.pagos = [{ metodo: "contra_entrega" }, { metodo: "transferencia" }])))] }), ["solo_contra_entrega"]);
    quien(datos({ agentesOtros: [{ credencial_ref: CREDENCIAL_GEMINI_ASLC }] }), ["credencial_propia_no_compartida"]);
    quien(datos({ modulosAslc: [...MODULOS, { modulo: "notificaciones_pedidos", habilitado: true }] }), ["notificaciones_pedidos_apagado"]);
    quien(datos({ modulosAslc: MODULOS.slice(1) }), ["modulos_catalogo_pedidos_por_aceptar"]);
    quien(datos({ iaPausada: false }), ["ia_pausada"]);
    quien(datos({ agenteAslc: [comoFila(fila({ habilitado: true }))] }), ["sin_agente_habilitado", "fila_deshabilitada"]);
    quien(datos({ agenteAslc: [comoFila(fila()), comoFila(fila())] }), ["una_fila_de_agente"]);
    quien(datos(), ["valida_con_las_compuertas_reales"], { funciones3b: CERRADA });
  });

  it("la persona responsable (y el respaldo) solo valen si están ACTIVAS con rol admin o agente: invitada, suspendida, rol lectura o inexistente fallan", () => {
    const con = (miembro: number, respaldo: number | null = null) => datos({ agenteAslc: [comoFila(fila({ checkout_opciones: configuracionCompletaAslc({ aviso: AVISO, miembroId: miembro, respaldoMiembroId: respaldo }) }))] });
    assert.deepEqual(mal(comprobacionesDeEtapa("configurado", con(RESPONSABLE, 52))), []);
    for (const id of [53, 54, 55, 999]) assert.ok(mal(comprobacionesDeEtapa("configurado", con(id))).includes("responsable_activa_con_rol_que_decide"), String(id));
    for (const id of [53, 54, 55, 999]) assert.ok(mal(comprobacionesDeEtapa("configurado", con(RESPONSABLE, id))).includes("respaldo_valido_si_hay"), `respaldo ${id}`);
    // El esquema ya impide que el respaldo sea la misma persona; si alguien lo forzara directo en la base, la verificación también lo detecta.
    const forzada = datos({ agenteAslc: [comoFila(conOpciones((o) => (o.cierre.responsable.respaldo_miembro_id = RESPONSABLE)))] });
    assert.ok(mal(comprobacionesDeEtapa("configurado", forzada)).includes("respaldo_valido_si_hay"));
  });

  it("controlado: agente habilitado, IA sin pausa, audio encendido y RESTRINGIDA a números de prueba; sin restricción (o pausada, o sin audio) falla", () => {
    const quien = (d: DatosEtapaAslc, esperadas: string[]) => assert.deepEqual(mal(comprobacionesDeEtapa("controlado", d)).sort(), esperadas.sort());
    quien(controlado(), []);
    quien(controlado({}, { iaRestringidaA: null }), ["restringida_a_numeros_de_prueba"]);
    quien(controlado({}, { iaRestringidaA: " , " }), ["restringida_a_numeros_de_prueba"]);
    quien(controlado({}, { iaPausada: true }), ["ia_activa_sin_pausa"]);
    quien(controlado({ transcripcion_audio: false }), ["transcripcion_audio_encendida"]);
    quien(controlado({ habilitado: false }), ["agente_habilitado"]);
    quien(controlado({}, { modulosAslc: [...MODULOS, { modulo: "notificaciones_pedidos", habilitado: true }] }), ["notificaciones_pedidos_apagado"]);
  });

  it("publico: igual que controlado pero SIN restricción; con una restricción puesta, falla", () => {
    assert.deepEqual(mal(comprobacionesDeEtapa("publico", controlado({}, { iaRestringidaA: null }))), []);
    assert.deepEqual(mal(comprobacionesDeEtapa("publico", controlado({}, { iaRestringidaA: "" }))), []);
    assert.deepEqual(mal(comprobacionesDeEtapa("publico", controlado())), ["sin_restriccion_abierta_al_publico"]);
  });

  it("la herramienta de verificación usa esta función (no una copia) y juzga con el parser real", () => {
    const src = leer("scripts/verificar-aslc-solo-lectura.mts");
    assert.ok(/import \{[^}]*comprobacionesDeEtapa[^}]*\} from "@\/lib\/agente\/activacion-aslc"/.test(src));
    assert.ok(!/parseAgentConfig/.test(src), "el script no duplica la lógica: la lleva la función probada");
  });
});
