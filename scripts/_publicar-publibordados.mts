/**
 * Publica (y opcionalmente activa) el Flow de PUBLI BORDADOS
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
 *   … --publicar --activar  → además deja flow_activo=true / flow_id en ese número.
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
    .select("id_tenant, phone_number_id, nombre_negocio, ia_pausada, flow_activo, flow_id")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (errNumero) throw errNumero;
  if (!numero || numero.id_tenant !== tenantId) throw new Error("El número no existe o no pertenece a ese tenant");

  const existente = (await listFlows(supabase, { tenantId })).find((f) => f.slug === SLUG) ?? null;
  const resumen: Record<string, unknown> = {
    modo: publicar ? (activar ? "publicar + activar" : "publicar") : "solo lectura",
    numero: numero,
    flowExistente: existente ? { id: existente.id, status: existente.status, published_version_id: existente.published_version_id } : null,
    definicion: { nodos: definition.nodes.length, conexiones: definition.edges.length, validacion: "OK" },
  };

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
  }

  console.log(JSON.stringify(resumen, null, 2));
}

main().catch((err) => {
  console.error("ERROR", err instanceof Error ? err.message : err);
  process.exit(1);
});
