/**
 * La verificación de SOLO LECTURA del agente de Delacour (supabase/provisioning/delacour/09_verificar_agente_solo_lectura.sql), contra un Postgres embebido (PGlite: Postgres compilado a WASM en
 * memoria; sin red, sin Docker y sin tocar ninguna base real). Es lo que corre el dueño en el SQL Editor de Supabase, así que se prueba ANTES:
 *   - sus listas (herramientas, llaves de `negocio`, modelo) son EXACTAMENTE las del código: si el código cambia una y el SQL no, esta prueba falla;
 *   - NO cambia nada (ni una sola palabra de escritura) y no muestra claves ni teléfonos completos;
 *   - sobre una configuración sana todo da «ok», y cada problema que debe detectar (una llave de más que haría callar al agente, una herramienta de venta que falta, el modelo equivocado, una
 *     credencial mal escrita, el agente apagado, y sobre todo «sin saldo» o credencial rechazada en los turnos de los últimos días) sale en SU fila.
 * Negocios, claves y teléfonos FICTICIOS.
 */
import "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { businessConfigSchema } from "@/lib/agente/config";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { SUPPORTED_MODELS } from "@/lib/ia-proveedores/registro";

const TD = "00000000-0000-4000-8000-0000000000d1"; // Delacour (ficticio)
const TX = "00000000-0000-4000-8000-0000000000d2"; // otro negocio
const CREADOR = "22222222-2222-4222-8222-222222222222";

const PREPARACION = `
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

const leer = (...partes: string[]) => readFileSync(path.join(process.cwd(), "supabase", ...partes), "utf8");
const VERIFICAR = () => leer("provisioning", "delacour", "09_verificar_agente_solo_lectura.sql");
const sinComentarios = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

/** El contenido de `array[...]` de la sección `nombre as (select unnest(array[...])` del SQL. */
function listaDelSql(sql: string, nombre: string): string[] {
  const m = new RegExp(`${nombre} as \\(\\s*select unnest\\(array\\[([^\\]]*)\\]`).exec(sql);
  assert.ok(m, `no encontré la lista «${nombre}» en el SQL`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const VENTA = AGENT_TOOL_NAMES.filter((n) => !n.startsWith("consultar_"));
/** Una configuración SANA de Delacour: las 16 de venta + las 4 del CMS, sin envíos (Delacour no tiene reglas de envío). */
const HERRAMIENTAS_SANAS = AGENT_TOOL_NAMES.filter((n) => n !== "consultar_envio");

describe("el archivo SQL", () => {
  it("sus listas son EXACTAMENTE las del código (herramientas, llaves de `negocio`, modelo)", () => {
    const sql = VERIFICAR();
    assert.deepEqual([...listaDelSql(sql, "conocidas")].sort(), [...AGENT_TOOL_NAMES].sort());
    assert.deepEqual([...listaDelSql(sql, "de_venta")].sort(), [...VENTA].sort());
    assert.deepEqual([...listaDelSql(sql, "llaves")].sort(), Object.keys(businessConfigSchema.shape).sort());
    assert.deepEqual(SUPPORTED_MODELS.gemini, ["gemini-3.6-flash"]);
    assert.ok(sql.includes(`modelo = '${SUPPORTED_MODELS.gemini[0]}'`));
  });

  it("es de SOLO LECTURA: ninguna sentencia que cambie datos o esquema", () => {
    const codigo = sinComentarios(VERIFICAR());
    assert.doesNotMatch(codigo, /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|call|do|execute)\b/i);
    assert.match(codigo.trim(), /^with\b/i, "es una sola consulta con WITH");
    assert.equal(codigo.trim().split(";").filter((x) => x.trim()).length, 1, "una sola sentencia");
  });

  it("no pide ni muestra claves, teléfonos completos ni textos de clientes", () => {
    const sql = VERIFICAR();
    assert.doesNotMatch(sinComentarios(sql), /\b(wa_id|telefono|texto_cliente|contenido|dulabs_mensajes_log)\b/i, "no lee mensajes ni teléfonos");
    assert.match(sql, /right\(n, 4\)/, "el piloto se ve por los últimos 4 dígitos");
  });
});

describe("contra un Postgres embebido", () => {
  let db: PGlite;

  before(async () => {
    db = new PGlite();
    await db.exec(PREPARACION);
    // La función de diagnóstico de las trazas lee el registro de mensajes de WhatsApp (de otro módulo): basta una tabla con las columnas que usa.
    await db.exec("create table public.dulabs_mensajes_log (wamid text, estado_entrega text, error_codigo integer, error_detalle text)");
    for (const f of [
      "20260923000000_amore_inventario_productos.sql",
      "20261105000000_dulabs_catalogo_fase1.sql",
      "20261106000000_dulabs_catalogo_publicacion.sql",
      "20261109000000_dulabs_agente_runtime.sql",
      "20261111000000_dulabs_catalogo_busqueda.sql",
      "20261113000000_dulabs_agente_trazas.sql",
      "20261215000000_dulabs_catalogo_genero.sql",
    ]) {
      await db.exec(leer("migrations", f).replace(/insert into storage\.buckets[\s\S]*?on conflict \(id\) do nothing;/i, ""));
    }
  });

  after(async () => {
    await db.close();
  });

  const sana = {
    proveedor: "gemini",
    modelo: "gemini-3.6-flash",
    credencial: "env:GEMINI_KEY_DELACOUR",
    nivel: "low",
    herramientas: HERRAMIENTAS_SANAS as readonly string[],
    canal: "retail",
    negocio: { nombre_agente: "Sofía", conocimiento: [{ tema: "Horario", info: "Lunes a sábado." }] } as Record<string, unknown>,
    habilitado: true,
  };

  /** Deja a Delacour como está en producción (tienda, módulos, agente, piezas) y aplica los cambios de cada prueba. */
  async function sembrar(cambios: Partial<typeof sana> = {}, opciones: { piezas?: boolean } = {}) {
    await db.exec(leer("migrations", "20261215000000_dulabs_catalogo_genero.sql")); // idempotente: una prueba borra la columna a propósito
    await db.exec(
      "truncate public.dulabs_agente_trazas, public.dulabs_agente_runtime_config, public.dulabs_tenant_modulos, public.dulabs_catalogo_eventos, public.dulabs_inventario_productos, public.dulabs_catalogo_secuencias, public.dulabs_catalogo_publicacion cascade",
    );
    const c = { ...sana, ...cambios };
    await db.query("insert into public.dulabs_catalogo_publicacion (id_tenant, slug, nombre_publico) values ($1, 'delacour', 'Delacour'), ($2, 'otra', 'Otra')", [TD, TX]);
    await db.query("insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado) values ($1, 'catalogo', true), ($1, 'cms_comercial', true)", [TD]);
    await db.query(
      "insert into public.dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, habilitado, proveedor, modelo, credencial_ref, nivel_razonamiento, herramientas, canal, negocio) values ($1, '100000000000001', 'catalog_sales', $2, $3, $4, $5, $6, $7, $8, $9::jsonb)",
      [TD, c.habilitado, c.proveedor, c.modelo, c.credencial, c.nivel, c.herramientas, c.canal, JSON.stringify(c.negocio)],
    );
    if (opciones.piezas !== false) {
      const ins = (nombre: string, precio: number | null, stock: number, activo = true) =>
        db.query("insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, activo, created_by, updated_by, escritura_id) values ($1, $2, $3, $4, $5, $6, $6, gen_random_uuid())", [TD, nombre, precio, stock, activo, CREADOR]);
      await ins("Anillo", 25_000, 5);
      await ins("Dije de acero", 10_000, 5);
      await ins("Pulsera", 18_000, 0);
      await ins("Retirada", 9_000, 1, false);
      await db.exec("update public.dulabs_inventario_productos set genero = 'hombre' where nombre = 'Dije de acero'");
    }
  }

  const traza = (resultado: string, extra: Record<string, unknown> = {}, horas = 1) =>
    db.query("insert into public.dulabs_agente_trazas (created_at, id_tenant, phone_number_id, contact_ref, tipo, wamid, resultado, traza) values (now() - ($1 || ' hours')::interval, $2, '100000000000001', 'abcdef012345', 'turn', 'w', $3, $4::jsonb)", [
      String(horas),
      TD,
      resultado,
      JSON.stringify({ outcome: resultado, usage: { input: 7000, output: 300, thinking: 100, cached: 4000 }, latency_ms: 2500, ...extra }),
    ]);

  const verificar = async () => {
    const r = await db.query<{ comprobacion: string; ok: boolean; detalle: string }>(VERIFICAR());
    return Object.fromEntries(r.rows.map((x) => [x.comprobacion, x]));
  };

  const COMPROBACIONES = [
    "tienda_unica", "fila_del_agente", "proveedor_y_modelo", "credencial_por_referencia", "nivel_de_razonamiento", "herramientas_conocidas", "herramientas_de_venta", "negocio_solo_llaves_conocidas", "canal",
    "agente_habilitado", "piloto", "herramientas_comerciales",
    "modulo_catalogo", "modulo_cms_comercial", "funcion_de_busqueda", "columna_genero", "piezas_activas", "piezas_de_hombre", "piezas_con_precio_cero", "piezas_sin_categoria", "piezas_agotadas", "piezas_sin_precio_mayorista",
    "turnos_7d", "resultados_7d", "errores_7d", "sin_saldo_7d", "credencial_rechazada_7d", "tokens_7d", "latencia_p95_ms", "ultimo_turno",
  ];

  beforeEach(async () => {
    await sembrar();
  });

  it("devuelve TODAS las comprobaciones, en su orden, una vez cada una", async () => {
    const r = await db.query<{ comprobacion: string }>(VERIFICAR());
    assert.deepEqual(r.rows.map((x) => x.comprobacion), COMPROBACIONES);
  });

  it("una configuración sana: todo en verdad; sin turnos todavía, los de los últimos días no fallan", async () => {
    const v = await verificar();
    for (const c of COMPROBACIONES) assert.equal(v[c].ok, c === "piezas_sin_categoria" ? false : true, `${c}: ${v[c].detalle}`);
    assert.match(v.herramientas_de_venta.detalle, /las 16 de venta están/);
    assert.match(v.credencial_por_referencia.detalle, /env:GEMINI_KEY_DELACOUR/);
    assert.match(v.piezas_de_hombre.detalle, /^1 de hombre y 2 de mujer/);
    assert.equal(v.herramientas_comerciales.detalle, "4 de 4 habilitadas");
    assert.equal(v.piloto.detalle.startsWith("sin piloto"), true);
    assert.equal(v.turnos_7d.detalle, "0 turno(s) del agente");
  });

  it("los problemas de la configuración salen en SU fila (y solo ahí)", async () => {
    await sembrar({ negocio: { nombre_agente: "Sofía", llave_nueva: "x" } });
    let v = await verificar();
    assert.equal(v.negocio_solo_llaves_conocidas.ok, false);
    assert.match(v.negocio_solo_llaves_conocidas.detalle, /llave_nueva/);
    assert.equal(v.herramientas_conocidas.ok, true);

    await sembrar({ herramientas: HERRAMIENTAS_SANAS.filter((h) => h !== "similar_products" && h !== "get_catalog_link") });
    v = await verificar();
    assert.equal(v.herramientas_de_venta.ok, false);
    assert.match(v.herramientas_de_venta.detalle, /FALTAN: .*get_catalog_link.*similar_products|FALTAN: .*similar_products.*get_catalog_link/);

    await sembrar({ herramientas: [...HERRAMIENTAS_SANAS, "herramienta_inventada"] });
    v = await verificar();
    assert.equal(v.herramientas_conocidas.ok, false);
    assert.match(v.herramientas_conocidas.detalle, /DESCONOCIDAS: herramienta_inventada/);

    // La tabla ya rechaza algunas de estas filas (CHECK de credencial); se quitan para simular filas anteriores a esas restricciones: la verificación igual las marca.
    await db.exec("alter table public.dulabs_agente_runtime_config drop constraint if exists dulabs_agente_runtime_config_credencial_ref_check, drop constraint if exists dulabs_agente_runtime_config_nivel_razonamiento_check");
    await sembrar({ modelo: "gemini-2.0-flash" });
    assert.equal((await verificar()).proveedor_y_modelo.ok, false);
    for (const credencial of ["GEMINI_KEY_DELACOUR", "env:ANTHROPIC_API_KEY", "sk-prueba-123", "env:GEMINI_KEY_delacour"]) {
      await sembrar({ credencial });
      assert.equal((await verificar()).credencial_por_referencia.ok, false, credencial);
    }
    await sembrar({ nivel: "extremo" });
    assert.equal((await verificar()).nivel_de_razonamiento.ok, false);
    await sembrar({ canal: "wholesale" });
    assert.equal((await verificar()).canal.ok, false);
  });

  it("un agente apagado se dice claro (informativa); sin fila, todo lo de la fila falla sin romper la consulta", async () => {
    await sembrar({ habilitado: false });
    assert.match((await verificar()).agente_habilitado.detalle, /^APAGADO/);
    await db.exec("delete from public.dulabs_agente_runtime_config");
    const v = await verificar();
    assert.equal(v.fila_del_agente.ok, false);
    for (const c of ["proveedor_y_modelo", "credencial_por_referencia", "nivel_de_razonamiento", "herramientas_conocidas", "herramientas_de_venta", "negocio_solo_llaves_conocidas", "canal"]) assert.equal(v[c].ok, false, c);
    assert.equal(v.agente_habilitado.detalle, "sin fila");
  });

  it("el piloto se ve por los últimos 4 dígitos, nunca el número completo", async () => {
    await sembrar({ negocio: { nombre_agente: "Sofía", comercial_piloto: ["573001112233", "573009998877"] } });
    const v = await verificar();
    assert.equal(v.piloto.detalle, "solo 2 número(s): …2233, …8877");
    assert.doesNotMatch(JSON.stringify(v), /57300111/);
  });

  it("el catálogo: módulo apagado, piezas con precio cero o sin categoría y la columna de género se ven en su fila", async () => {
    await db.exec("update public.dulabs_tenant_modulos set habilitado = false where modulo = 'catalogo'");
    assert.equal((await verificar()).modulo_catalogo.ok, false);
    await db.exec("update public.dulabs_tenant_modulos set habilitado = true where modulo = 'catalogo'; update public.dulabs_inventario_productos set precio = 0 where nombre = 'Anillo'");
    const v = await verificar();
    assert.equal(v.piezas_con_precio_cero.ok, false);
    assert.match(v.piezas_con_precio_cero.detalle, /^1 activa/);
    assert.match(v.piezas_sin_precio_mayorista.detalle, /^3 activa/, "las 3 activas no tienen precio al por mayor");
    assert.match(v.piezas_agotadas.detalle, /^1 activa/);
    await db.exec("alter table public.dulabs_inventario_productos drop column genero");
    const sinColumna = await verificar();
    assert.equal(sinColumna.columna_genero.ok, false);
    assert.match(sinColumna.piezas_de_hombre.detalle, /^0 de hombre/, "sin la columna la consulta NO se rompe");
  });

  it("SIN SALDO: los turnos con error_kind = quota (también en la pregunta lateral del checkout) salen en rojo, con cuántos y cuándo fue el último", async () => {
    await traza("replied");
    await traza("handoff", { error_kind: "quota", handoff: { source: "system", motive: "repeated_failures" } }, 5);
    await traza("handoff", { error_kind: "quota" }, 2);
    await traza("replied", { error_kind: "side_quota" }, 3);
    const v = await verificar();
    assert.equal(v.sin_saldo_7d.ok, false);
    assert.match(v.sin_saldo_7d.detalle, /^3 turno\(s\) fallaron por crédito o cupo de Gemini agotado \(el último: /);
    assert.equal(v.errores_7d.ok, false);
    assert.match(v.errores_7d.detalle, /quota 2/);
    assert.equal(v.credencial_rechazada_7d.ok, true);
  });

  it("credencial rechazada, errores de otro tipo y los de hace más de 7 días", async () => {
    await traza("fallback", { error_kind: "auth" }, 3);
    await traza("fallback", { error_kind: "timeout" }, 4);
    await traza("fallback", { error_kind: "quota" }, 24 * 8); // hace 8 días: no cuenta
    const v = await verificar();
    assert.equal(v.credencial_rechazada_7d.ok, false);
    assert.equal(v.sin_saldo_7d.ok, true, "el sin saldo de hace 8 días ya no cuenta");
    assert.match(v.errores_7d.detalle, /auth 1/);
    assert.match(v.errores_7d.detalle, /timeout 1/);
    assert.equal(v.turnos_7d.detalle, "2 turno(s) del agente");
  });

  it("tokens, latencia y resultados de los últimos 7 días", async () => {
    await traza("replied");
    await traza("replied");
    await traza("handoff");
    const v = await verificar();
    assert.equal(v.turnos_7d.detalle, "3 turno(s) del agente");
    assert.equal(v.resultados_7d.detalle, "replied 2 · handoff 1");
    assert.equal(v.tokens_7d.detalle, "entrada 21000 · salida 900 · pensamiento 300 · de caché 12000");
    assert.equal(v.latencia_p95_ms.detalle, "2500");
    assert.equal(v.errores_7d.ok, true);
    assert.match(v.ultimo_turno.detalle, /^20\d\d-/);
  });

  it("solo mira el negocio de la tienda «delacour»: lo de otro negocio no entra en las cuentas", async () => {
    await db.query("insert into public.dulabs_agente_trazas (id_tenant, phone_number_id, contact_ref, tipo, resultado, traza) values ($1, '1', 'abcdef012345', 'turn', 'fallback', '{\"error_kind\":\"quota\"}'::jsonb)", [TX]);
    const v = await verificar();
    assert.equal(v.sin_saldo_7d.ok, true);
    assert.equal(v.turnos_7d.detalle, "0 turno(s) del agente");
  });

  it("no cambia nada: las tablas quedan idénticas después de correrla", async () => {
    await traza("replied");
    const contar = async () => JSON.stringify((await db.query("select (select count(*) from public.dulabs_agente_trazas) a, (select count(*) from public.dulabs_inventario_productos) b, (select count(*) from public.dulabs_agente_runtime_config) c")).rows);
    const antes = await contar();
    await verificar();
    await verificar();
    assert.equal(await contar(), antes);
  });
});
