/**
 * FASE 3B.9 — VERIFICACIÓN DE SOLO LECTURA del estado de Aquí Sí Lo Compras en producción.
 *
 *   npx tsx --env-file=.env.local scripts/verificar-aslc-solo-lectura.mts [--etapa=inicial|aprovisionado]
 *
 * SOLO `select` (nunca insert/update/delete/upsert/rpc: una prueba lo verifica). No imprime secretos: tokens y WABA solo como "existe",
 * números como "…últimos4". Sin `--etapa` solo informa; con `--etapa` evalúa el checklist de esa etapa y termina con código 1 si algo falla:
 *   inicial        antes de correr 02_aprovisionar_sin_activar.sql (sin fila de agente, sin módulos).
 *   aprovisionado  después del 02: fila deshabilitada con candado, 3 módulos, IA pausada, nada más.
 * `huella_otros_negocios` y `huella_agentes_otros` sirven para comparar ANTES y DESPUÉS: no deben cambiar (Delacour y demás, intactos).
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { CREDENCIAL_GEMINI_ASLC, IDENTIDAD_ASLC_PRODUCCION } from "@/lib/agente/aprovisionamiento";

const etapa = process.argv.find((a) => a.startsWith("--etapa="))?.slice("--etapa=".length) ?? null;
if (etapa !== null && etapa !== "inicial" && etapa !== "aprovisionado") {
  console.error("--etapa debe ser 'inicial' o 'aprovisionado'");
  process.exit(2);
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (usar --env-file=.env.local).");
  process.exit(2);
}
const supabase = createClient(url, key);
const { idTenant, phoneNumberId, patronNombre } = IDENTIDAD_ASLC_PRODUCCION;
const ult4 = (s: string | null | undefined) => (s ? `…${String(s).slice(-4)}` : null);
const huella = (lineas: string[]) => createHash("md5").update([...lineas].sort().join("|")).digest("hex");
const falla = (m: string, e: { code?: string; message: string } | null): never => {
  console.error(`ERROR leyendo ${m}: ${e?.code ?? ""} ${e?.message ?? ""}`);
  process.exit(2);
};

// 1) Negocio: por tenant, phone_number_id o nombre (sin columnas secretas). La identidad EXACTA exige los tres a la vez.
const { data: candidatos, error: e1 } = await supabase
  .from("dulabs_clientes_config")
  .select("id_tenant, phone_number_id, nombre_negocio, telefono_negocio, ia_pausada, ia_restringida_a, ia_numeros_bloqueados, flow_activo, estado_conexion")
  .or(`id_tenant.eq.${idTenant},phone_number_id.eq.${phoneNumberId},nombre_negocio.ilike.%${patronNombre}%`);
if (e1) falla("dulabs_clientes_config", e1);
const filas = candidatos ?? [];
const aslc = filas.find((n) => n.id_tenant === idTenant && n.phone_number_id === phoneNumberId && new RegExp(patronNombre, "i").test(String(n.nombre_negocio ?? "")));

const salida: Record<string, unknown> = {
  generado: new Date().toISOString(),
  etapa,
  filas_que_se_parecen_a_aslc: filas.length,
  identidad: aslc
    ? {
        id_tenant: aslc.id_tenant,
        phone_number_id: aslc.phone_number_id,
        nombre_negocio: aslc.nombre_negocio,
        telefono_registrado: ult4(aslc.telefono_negocio),
        estado_conexion: aslc.estado_conexion,
        ia_pausada: aslc.ia_pausada,
        ia_restringida_a: String(aslc.ia_restringida_a ?? "").split(",").map((x) => x.trim()).filter(Boolean).map(ult4),
        numeros_bloqueados: String(aslc.ia_numeros_bloqueados ?? "").split(",").map((x) => x.trim()).filter(Boolean).length,
        flow_activo: aslc.flow_activo,
      }
    : null,
};

const checks: Record<string, boolean> = {
  una_sola_fila_que_se_parece: filas.length === 1,
  identidad_exacta_encontrada: !!aslc,
};

if (aslc) {
  const presencia = async (col: string) => {
    const { data } = await supabase.from("dulabs_clientes_config").select("id_tenant").eq("id_tenant", idTenant).not(col, "is", null);
    return (data ?? []).length > 0;
  };
  salida.credenciales = { token_meta_propio: await presencia("meta_permanent_token"), waba: await presencia("whatsapp_business_account_id") };

  // 2) Agentes: el de ASLC y una huella de los de los demás negocios.
  const { data: agentes, error: e2 } = await supabase.from("dulabs_agente_runtime_config").select("*");
  if (e2) falla("dulabs_agente_runtime_config", e2);
  const todos = agentes ?? [];
  const agenteAslc = todos.filter((a) => a.phone_number_id === phoneNumberId);
  const otros = todos.filter((a) => a.phone_number_id !== phoneNumberId);
  salida.agente_aslc = agenteAslc.map((a) => ({
    habilitado: a.habilitado,
    tipo: a.tipo,
    modelo: a.modelo,
    credencial_ref: a.credencial_ref,
    herramientas: a.herramientas?.length,
    sin_confirm_order: !(a.herramientas ?? []).includes("confirm_order"),
    checkout_conversacional: a.checkout_conversacional,
    transcripcion_audio: a.transcripcion_audio,
    meta_token_plataforma: a.meta_token_plataforma,
    vocabulario: a.vocabulario,
    checkout_opciones_claves: a.checkout_opciones ? Object.keys(a.checkout_opciones) : null,
    activacion_pendiente: a.checkout_opciones?.activacion_pendiente ?? null,
    pagos: (a.checkout_opciones?.pagos ?? []).map((p: { metodo: string }) => p.metodo),
    entregas: a.checkout_opciones?.entregas ?? null,
  }));
  salida.agentes_otros = otros.map((a) => ({ id_tenant: a.id_tenant, phone_final: ult4(a.phone_number_id), habilitado: a.habilitado, credencial_ref: a.credencial_ref }));
  salida.huella_agentes_otros = huella(otros.map((a) => JSON.stringify([a.id_tenant, a.phone_number_id, a.habilitado, a.credencial_ref, a.checkout_conversacional, a.transcripcion_audio, a.meta_token_plataforma, a.checkout_opciones])));

  // 3) Módulos: los de ASLC y una huella de los de los demás negocios.
  const { data: modulos, error: e3 } = await supabase.from("dulabs_tenant_modulos").select("id_tenant, modulo, habilitado");
  if (e3) falla("dulabs_tenant_modulos", e3);
  const mods = modulos ?? [];
  const modsAslc = mods.filter((m) => m.id_tenant === idTenant);
  salida.modulos_aslc = modsAslc.map((m) => ({ modulo: m.modulo, habilitado: m.habilitado })).sort((a, b) => a.modulo.localeCompare(b.modulo));
  salida.huella_otros_negocios = huella(mods.filter((m) => m.id_tenant !== idTenant).map((m) => `${m.id_tenant}:${m.modulo}:${m.habilitado}`));
  const habilitado = (mod: string) => modsAslc.some((m) => m.modulo === mod && m.habilitado === true);

  // 4) Equipo (sin correos) y catálogo (solo conteos).
  const { data: equipo, error: e4 } = await supabase.from("dulabs_miembros_equipo").select("id, rol, estado, nombre").eq("tenant_id", idTenant);
  salida.equipo = e4 ? `ERROR ${e4.code}` : equipo;
  const cuenta = async (tabla: string, estado?: string) => {
    const base = supabase.from(tabla).select("*", { count: "exact", head: true }).eq("id_tenant", idTenant);
    const { count, error } = await (estado ? base.eq("estado", estado) : base);
    return error ? `ERROR ${error.code}` : count;
  };
  salida.catalogo = {
    productos: await cuenta("dulabs_inventario_productos"),
    pedidos: await cuenta("dulabs_catalogo_pedidos"),
    pedidos_por_aceptar: await cuenta("dulabs_catalogo_pedidos", "pending_acceptance"),
    notificaciones: await cuenta("dulabs_catalogo_pedido_notificaciones"),
  };

  // Checklists por etapa.
  checks.ia_pausada = aslc.ia_pausada === true;
  checks.sin_agente_habilitado = !agenteAslc.some((a) => a.habilitado === true);
  checks.notificaciones_pedidos_apagado = !habilitado("notificaciones_pedidos");
  if (etapa === "inicial") {
    checks.sin_fila_de_agente = agenteAslc.length === 0;
    checks.sin_modulos = modsAslc.length === 0;
  }
  if (etapa === "aprovisionado") {
    const a = agenteAslc[0];
    checks.una_fila_de_agente = agenteAslc.length === 1;
    checks.fila_deshabilitada_con_candado =
      !!a &&
      a.habilitado === false &&
      a.checkout_opciones?.activacion_pendiente === true &&
      a.credencial_ref === CREDENCIAL_GEMINI_ASLC &&
      a.checkout_conversacional === false &&
      a.transcripcion_audio === false &&
      a.meta_token_plataforma === false &&
      a.vocabulario === null &&
      !(a.herramientas ?? []).includes("confirm_order");
    checks.solo_contra_entrega = !!a && JSON.stringify((a.checkout_opciones?.pagos ?? []).map((p: { metodo: string }) => p.metodo)) === JSON.stringify(["contra_entrega"]);
    checks.modulos_catalogo_pedidos_por_aceptar = habilitado("catalogo") && habilitado("pedidos") && habilitado("pedidos_por_aceptar");
    checks.credencial_no_compartida = !otros.some((o) => o.credencial_ref === CREDENCIAL_GEMINI_ASLC);
  }
}

salida.comprobaciones = checks;
console.log(JSON.stringify(salida, null, 2));
if (etapa !== null && Object.values(checks).some((v) => v !== true)) {
  console.error(`\nCHECKLIST '${etapa}': FALLÓ -> ${Object.entries(checks).filter(([, v]) => v !== true).map(([k]) => k).join(", ")}`);
  process.exit(1);
}
if (etapa !== null) console.error(`\nCHECKLIST '${etapa}': OK (${Object.keys(checks).length} comprobaciones).`);
