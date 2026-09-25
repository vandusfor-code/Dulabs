/**
 * Publica (y opcionalmente activa) el Flow de PUBLI BORDADOS (v3: registra una SOLICITUD por flow
 * completado; exige la migración 20261120000000_dulabs_pb_solicitudes.sql aplicada)
 * (lib/flows/publibordados.flow.ts) con las MISMAS funciones que usan el
 * panel y los scripts de Solo Talento: createFlow / createFlowVersion /
 * publishFlowVersion (lib/flow/flow-store.ts) y activarFlowParaNumero
 * (lib/flow/flow-activation.ts, la de POST /api/flows/[id]/activate).
 * Solo toca el tenant y el número que se pasan por argumento.
 *
 * Uso (lee SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de .env.local):
 *   npx tsx scripts/_publicar-publibordados.mts --tenant=<uuid> --numero=<phone_number_id>
 *       → SOLO LECTURA: valida el flow y muestra el estado actual. No escribe nada.
 *   … --publicar            → crea el flow (o una versión nueva) y la publica. No lo activa.
 *   … --publicar --activar  → además deja flow_activo=true / flow_id en ese número
 *                             y habilita el módulo Clientes del dashboard para ese tenant
 *                             (dulabs_tenant_modulos: id_tenant + modulo "publibordados_clientes").
 *
 * No toca ia_pausada: mientras siga en true, el número no responde aunque el
 * flow esté activo (el gate de ia_pausada corre antes que Flow en el webhook).
 * Idempotente: si el flow ya existe (mismo slug), publica una versión nueva.
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFlow, createFlowVersion, getFlowById, listFlowVersions, listFlows } from "@/lib/flow/flow-store";
import { activarFlowParaNumero } from "@/lib/flow/flow-activation";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { publibordadosFlow } from "@/lib/flows/publibordados.flow";

const SLUG = "publibordados-calificacion";
const MODULO_CLIENTES = "publibordados_clientes";

const envPath = new URL("../.env.local", import.meta.url);
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const arg = (nombre: string) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split("=")[1]?.trim();
const flag = (nombre: string) => process.argv.includes(`--${nombre}`);

async function main() {
  const tenantId = arg("tenant");
  const phoneNumberId = arg("numero");
  const publicar = flag("publicar");
  const activar = flag("activar");
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error("Falta --tenant=<uuid del negocio>");
  if (!phoneNumberId || !/^\d{6,20}$/.test(phoneNumberId)) throw new Error("Falta --numero=<phone_number_id>");
  if (activar && !publicar) throw new Error("--activar requiere --publicar");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");

  const definition = publibordadosFlow();
  const validacion = validateFlowForPublish(definition);
  if (validacion.errors.length > 0) throw new Error(`El flow no pasa la validación: ${JSON.stringify(validacion.errors)}`);

  const supabase: SupabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // El número debe existir y ser de ESTE tenant (misma regla que la activación del panel).
  const { data: numero, error: errNumero } = await supabase
    .from("dulabs_clientes_config")
    .select("id_tenant, phone_number_id, nombre_negocio, ia_pausada, ia_restringida_a, flow_activo, flow_id")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (errNumero) throw errNumero;
  if (!numero || numero.id_tenant !== tenantId) throw new Error("El número no existe o no pertenece a ese tenant");

  const existente = (await listFlows(supabase, { tenantId })).find((f) => f.slug === SLUG) ?? null;
  const versionPublicada = existente?.published_version_id
    ? (await listFlowVersions(supabase, { tenantId, flowId: existente.id, limit: 50 })).find((v) => v.id === existente.published_version_id)
    : undefined;
  const { data: modulo, error: errModulo } = await supabase
    .from("dulabs_tenant_modulos")
    .select("habilitado")
    .eq("id_tenant", tenantId)
    .eq("modulo", MODULO_CLIENTES)
    .maybeSingle();
  // Migración de solicitudes (20261120000000_dulabs_pb_solicitudes.sql): el flow v3 registra cada
  // solicitud con registrar_en_modulo → dulabs_pb_registrar_solicitud. Se comprueba con una lectura
  // inofensiva (listar solicitudes del propio tenant, 1 fila).
  const { error: errSolicitudes } = await supabase.rpc("dulabs_pb_listar_solicitudes", { p_tenant: tenantId, p_filtro: { limite: 1 } });
  const migracionSolicitudes = !errSolicitudes;
  // Migración de respaldo/conciliación (20261121000000_dulabs_registros_modulo.sql): sin ella un
  // registro fallido solo quedaría en logs. Lectura inofensiva: resumen del propio tenant.
  const { error: errRegistros } = await supabase.rpc("dulabs_registro_modulo_resumen", { p_tenant: tenantId, p_modulo: MODULO_CLIENTES });
  const migracionRegistros = !errRegistros;

  const resumen: Record<string, unknown> = {
    modo: publicar ? (activar ? "publicar + activar" : "publicar") : "solo lectura",
    numero: numero,
    flowExistente: existente
      ? { id: existente.id, status: existente.status, versionPublicada: versionPublicada?.version_number ?? null }
      : null,
    // Si la tabla de módulos no existe todavía, se informa en vez de fallar (solo lectura).
    migracionSolicitudes: migracionSolicitudes ? true : `falta aplicar 20261120000000_dulabs_pb_solicitudes.sql (${errSolicitudes?.message})`,
    migracionRegistros: migracionRegistros ? true : `falta aplicar 20261121000000_dulabs_registros_modulo.sql (${errRegistros?.message})`,
    moduloClientes: errModulo ? `no se pudo leer dulabs_tenant_modulos: ${errModulo.message}` : Boolean(modulo?.habilitado),
    definicion: { nodos: definition.nodes.length, conexiones: definition.edges.length, validacion: "OK" },
  };

  if (publicar && (!migracionSolicitudes || !migracionRegistros)) {
    console.log(JSON.stringify(resumen, null, 2));
    throw new Error(
      "No se publica: primero deben aplicarse las migraciones 20261120000000_dulabs_pb_solicitudes.sql y 20261121000000_dulabs_registros_modulo.sql (sin ellas una solicitud podría no registrarse o no quedar recuperable).",
    );
  }

  if (!publicar) {
    console.log(JSON.stringify(resumen, null, 2));
    return;
  }

  const flow =
    existente ??
    (await createFlow(supabase, { tenantId, slug: SLUG, name: definition.name, description: definition.description }));
  const versiones = await listFlowVersions(supabase, { tenantId, flowId: flow.id, limit: 1 });
  const versionNumber = (versiones[0]?.version_number ?? 0) + 1;
  const version = await createFlowVersion(supabase, { tenantId, flowId: flow.id, versionNumber, definition, publish: true });
  const flowPublicado = await getFlowById(supabase, tenantId, flow.id);
  resumen.publicado = {
    flowId: flow.id,
    version: version.version_number,
    versionId: version.id,
    status: flowPublicado?.status,
    esLaVersionPublicada: flowPublicado?.published_version_id === version.id,
  };

  if (activar) {
    const r = await activarFlowParaNumero(supabase, { tenantId, flowId: flow.id, phoneNumberId });
    if (!r.ok) throw new Error(`No se pudo activar: ${r.reason}`);
    resumen.activado = { phone_number_id: r.row.phone_number_id, flow_activo: r.row.flow_activo, flow_id: r.row.flow_id, ia_pausada: r.row.ia_pausada };

    const { error: errHabilitar } = await supabase
      .from("dulabs_tenant_modulos")
      .upsert({ id_tenant: tenantId, modulo: MODULO_CLIENTES, habilitado: true, updated_at: new Date().toISOString() }, { onConflict: "id_tenant,modulo" });
    if (errHabilitar) throw errHabilitar;
    resumen.moduloClientes = true;
  }

  console.log(JSON.stringify(resumen, null, 2));
}

main().catch((err) => {
  console.error("ERROR", err instanceof Error ? err.message : err);
  process.exit(1);
});
