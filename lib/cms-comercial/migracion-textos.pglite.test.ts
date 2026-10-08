/**
 * CMS comercial — la MIGRACIÓN de los textos de ARIA (supabase/provisioning/delacour/04–07) ejecutada de verdad en Postgres embebido, con un Delacour SINTÉTICO (24 temas
 * con textos inventados). Demuestra, paso a paso:
 *   04  borradores (nunca publicados), el mínimo mayorista pasa a variable, no pisa, no toca el prompt ni otros negocios;
 *   05  herramientas comerciales solo con contenido publicado (y sin temas críticos pendientes); válido para ARIA;
 *   06  retirar del prompt SOLO lo indicado y publicado; ARIA lo responde desde el CMS (herramienta real, canal y variables);
 *   las reversas, las guardas fuera de orden y el estado (07).
 * Solo lo ejecuta esta prueba: nada se corre en producción.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { businessConfigSchema, parseAgentConfig, type AgentConfigRow } from "@/lib/agente/config";
import { buildSystemInstruction, type TurnFacts } from "@/lib/agente/contexto";
import { emptyConversationState } from "@/lib/agente/estado";
import { executeAgentTool, type AgentToolsDeps, type AgentTurnToolContext } from "@/lib/agente/herramientas";
import { AGENT_TOOL_NAMES, HERRAMIENTAS_COMERCIALES } from "@/lib/agente/nombres-herramientas";
import { checksumDe } from "@/lib/cms-comercial/checksum";
import { TEXTOS_MIGRABLES, TEMAS_QUE_SE_QUEDAN_EN_EL_PERFIL, CLAVES_CRITICAS } from "@/lib/cms-comercial/migracion-textos";
import { crearLectorSupabase } from "@/lib/cms-comercial/lector";
import {
  CONOCIMIENTO_SINTETICO,
  HERRAMIENTAS_ARIA_HOY,
  crearDelacourSintetico,
  scriptEstadoMigracion,
  scriptHabilitarHerramientas,
  scriptMigrarTextos,
  scriptRetirarDelPrompt,
  scriptReversaHabilitarHerramientas,
  scriptReversaMigrarTextos,
  scriptReversaRetirarDelPrompt,
  type OpcionesDelacour,
} from "@/lib/cms-comercial/testing/delacour";
import { AHORA, TENANT_A, TENANT_B } from "@/lib/cms-comercial/testing/fixtures";
import type { BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { validar } from "@/lib/cms-comercial/validacion";
import { variablesDeNegocio } from "@/lib/cms-comercial/variables-negocio";

const abiertas: BaseCms[] = [];
afterEach(async () => {
  while (abiertas.length) await abiertas.pop()?.cerrar();
});

async function delacour(opciones: OpcionesDelacour = {}) {
  const b = await crearDelacourSintetico({ aria: {}, ...opciones });
  abiertas.push(b);
  return b;
}

interface FilaEntidad {
  id: string;
  clave: string;
  estado: string;
  rev: number;
  version_activa: number | null;
  borrador: Record<string, unknown> | null;
  created_by: string | null;
  archivada_at: string | null;
}
const contenidos = (b: BaseCms, tenant = TENANT_A) =>
  b.sql<FilaEntidad>("select id, clave, estado, rev, version_activa, borrador, created_by, archivada_at from public.dulabs_cms_entidades where id_tenant = $1 and tipo = 'contenido' order by clave", [tenant]);
const una = async (b: BaseCms, clave: string) => (await contenidos(b)).find((e) => e.clave === clave)!;

interface FilaAria {
  id: string;
  negocio: { conocimiento?: Array<{ tema: string; info: string }> } & Record<string, unknown>;
  herramientas: string[];
  updated_at: string;
}
const aria = async (b: BaseCms) => (await b.sql<FilaAria>("select id, negocio, herramientas, updated_at from public.dulabs_agente_runtime_config order by phone_number_id"))[0];
const temasDelPrompt = async (b: BaseCms) => ((await aria(b)).negocio.conocimiento ?? []).map((k) => k.tema);

/** Publica un contenido como lo hace la aplicación: con el checksum del contenido canónico. */
async function publicar(b: BaseCms, clave: string, nota = "Publicación de prueba") {
  const e = await una(b, clave);
  const r = await b.sql<{ r: { resultado: string } }>("select public.dulabs_cms_publicar($1::uuid, $2::uuid, $3::int, $4::int, $5, $6, null::uuid, $7) as r", [TENANT_A, e.id, e.rev, e.version_activa ?? 0, checksumDe(e.borrador), nota, "Ana"]);
  assert.equal(r[0].r.resultado, "ok", `${clave}: ${JSON.stringify(r[0].r)}`);
}
const publicarTodos = async (b: BaseCms, excepto: readonly string[] = []) => {
  for (const e of await contenidos(b)) if (!excepto.includes(e.clave) && e.estado === "borrador") await publicar(b, e.clave);
};
/** Edita el borrador como lo haría la administradora. */
async function editar(b: BaseCms, clave: string, cambios: Record<string, unknown>) {
  const e = await una(b, clave);
  // Sin borrador pendiente (ya se publicó), se parte de lo que está publicado: así el contenido sigue siendo completo y válido.
  const base = e.borrador ?? (await b.sql<{ c: Record<string, unknown> }>("select public.dulabs_cms_contenido_activo($1::uuid, $2::uuid) as c", [TENANT_A, e.id]))[0].c;
  const r = await b.sql<{ r: { resultado: string } }>("select public.dulabs_cms_guardar_borrador($1::uuid, $2::uuid, $3::jsonb, $4::int, null::uuid, $5) as r", [TENANT_A, e.id, JSON.stringify({ ...base, ...cambios }), e.rev, "Ana"]);
  assert.equal(r[0].r.resultado, "ok");
}
/** Un ajuste de sesión solo para este script (se limpia al terminar: PGlite conserva la sesión entre llamadas). */
async function conAjuste(b: BaseCms, nombre: string, valor: string, script: string) {
  try {
    await b.aplicarSql(`set ${nombre} = '${valor}'; ${script}`);
  } finally {
    await b.aplicarSql(`reset ${nombre}`);
  }
}
const retirar = (b: BaseCms, claves: string) => conAjuste(b, "dulabs.retirar_temas", claves, scriptRetirarDelPrompt());
const restaurar = (b: BaseCms, claves: string) => conAjuste(b, "dulabs.restaurar_temas", claves, scriptReversaRetirarDelPrompt());
const estadoPorTema = async (b: BaseCms) => Object.fromEntries((await b.sql<{ tema: string; en_el_prompt: boolean | null; en_el_cms: string; fuente: string | null }>(scriptEstadoMigracion())).map((r) => [r.tema, r]));
const conteos = async (b: BaseCms) => ({
  entidades: (await b.sql("select 1 from public.dulabs_cms_entidades")).length,
  versiones: (await b.sql("select 1 from public.dulabs_cms_versiones")).length,
  auditoria: (await b.sql("select 1 from public.dulabs_cms_auditoria")).length,
});
const textoOriginal = (tema: string) => CONOCIMIENTO_SINTETICO.find((k) => k.tema === tema)!.info;

/** Todo el recorrido hasta tener las herramientas habilitadas (los textos siguen en el prompt). */
async function hastaHerramientas(b: BaseCms) {
  await b.aplicarSql(scriptMigrarTextos());
  await publicarTodos(b);
  await b.aplicarSql(scriptHabilitarHerramientas());
}

// ===========================================================================
// 04 — borradores
// ===========================================================================

describe("04_migrar_textos_a_borradores.sql", () => {
  it("crea los 22 temas como BORRADORES (ninguno publicado), con tema, audiencia, orden, título y el texto original, sin usuario; Despedida y Datos del pedido no se migran", async () => {
    const b = await delacour();
    await b.aplicarSql(scriptMigrarTextos());
    const filas = await contenidos(b);
    assert.equal(filas.length, 22);
    for (const e of filas) assert.deepEqual([e.estado, e.version_activa, e.created_by, e.archivada_at, e.rev], ["borrador", null, null, null, 1], e.clave);
    for (const t of TEXTOS_MIGRABLES) {
      const e = filas.find((x) => x.clave === t.clave);
      assert.ok(e, t.clave);
      const original = CONOCIMIENTO_SINTETICO.find((k) => k.tema === t.legado)!;
      assert.deepEqual(Object.keys(e.borrador ?? {}).sort(), ["audiencia", "orden", "palabras_clave", "tema", "texto", "titulo"], t.clave);
      assert.deepEqual([e.borrador?.tema, e.borrador?.audiencia, e.borrador?.orden, e.borrador?.titulo], [t.tema, t.audiencia, t.orden, original.tema], t.clave);
      assert.deepEqual(e.borrador?.palabras_clave, []);
    }
    for (const nombre of TEMAS_QUE_SE_QUEDAN_EN_EL_PERFIL) assert.ok(!filas.some((e) => e.borrador?.titulo === nombre), nombre);
    const auditoria = await b.sql<{ accion: string; actor_etiqueta: string; actor_user_id: string | null }>("select accion, actor_etiqueta, actor_user_id from public.dulabs_cms_auditoria order by id");
    assert.equal(auditoria.length, 22);
    for (const a of auditoria) assert.deepEqual([a.accion, a.actor_etiqueta, a.actor_user_id], ["crear", "Migración del conocimiento de ARIA (DuLabs)", null]);
    assert.equal((await b.sql("select 1 from public.dulabs_cms_versiones")).length, 0, "nada se publicó");
  });

  it("el mínimo mayorista escrito a mano ($750.000 o 750000) pasa a la variable {{minimo_mayorista}}; el resto de cada texto queda IGUAL", async () => {
    const b = await delacour();
    await b.aplicarSql(scriptMigrarTextos());
    assert.equal((await una(b, "venta-al-por-mayor")).borrador?.texto, "La compra inicial mayorista parte desde {{minimo_mayorista}} en productos surtidos.");
    assert.equal((await una(b, "emprendimiento")).borrador?.texto, "Si vas a emprender, tu primera compra mayorista es de {{minimo_mayorista}} pesos y te asesoramos.");
    for (const t of TEXTOS_MIGRABLES.filter((x) => !["venta-al-por-mayor", "emprendimiento"].includes(x.clave))) assert.equal((await una(b, t.clave)).borrador?.texto, textoOriginal(t.legado), t.clave);
  });

  it("solo reemplaza el monto exacto: «$7.500.000», «1750000», «750.0001» y «$750.000,50» NO se tocan; «750.000» suelto y «$ 750.000» sí", async () => {
    const b = await delacour({
      aria: {
        conocimiento: [
          { tema: "Venta al por mayor", info: "Desde 750.000 (o $ 750.000) y hasta $7.500.000; código 1750000; ref 750.0001; saldo $750.000,50." },
          { tema: "Envíos", info: "Pedidos de $750000, $750.000." },
        ],
      },
    });
    await b.aplicarSql(scriptMigrarTextos());
    assert.equal((await una(b, "venta-al-por-mayor")).borrador?.texto, "Desde {{minimo_mayorista}} (o {{minimo_mayorista}}) y hasta $7.500.000; código 1750000; ref 750.0001; saldo $750.000,50.");
    assert.equal((await una(b, "envios")).borrador?.texto, "Pedidos de {{minimo_mayorista}}, {{minimo_mayorista}}.");
  });

  it("sin mínimo configurado no se reemplaza nada (los textos pasan tal cual)", async () => {
    const b = await delacour({ aria: { negocio: { pedido: { direccion_tienda: "Local 12" } } } });
    await b.aplicarSql(scriptMigrarTextos());
    assert.equal((await una(b, "venta-al-por-mayor")).borrador?.texto, textoOriginal("Venta al por mayor"));
  });

  it("cada borrador es VÁLIDO para el CMS: el validador de publicación no da errores (variables resueltas con el mínimo y la dirección configurados)", async () => {
    const b = await delacour();
    await b.aplicarSql(scriptMigrarTextos());
    const { variables, minimoMayorista } = variablesDeNegocio((await aria(b)).negocio);
    assert.deepEqual(variables.minimo_mayorista, "$750.000");
    for (const e of await contenidos(b)) {
      const r = validar("contenido", e.borrador, { ahora: AHORA, productos: new Map(), categorias: new Map(), assets: new Map(), elementos: new Map(), variables, minimoMayorista });
      assert.equal(r.ok, true, `${e.clave}: ${JSON.stringify(r.errores)}`);
    }
  });

  it("NO toca el prompt ni la configuración de ARIA: la fila queda idéntica (también updated_at)", async () => {
    const b = await delacour();
    const antes = JSON.stringify(await aria(b));
    await b.aplicarSql(scriptMigrarTextos());
    assert.equal(JSON.stringify(await aria(b)), antes);
  });

  it("se puede repetir y NO pisa lo que la administradora editó o publicó", async () => {
    const b = await delacour();
    await b.aplicarSql(scriptMigrarTextos());
    await editar(b, "envios", { texto: "Texto nuevo de la administradora." });
    await publicar(b, "garantias");
    const antes = JSON.stringify([await contenidos(b), await conteos(b)]);
    await b.aplicarSql(scriptMigrarTextos());
    assert.equal(JSON.stringify([await contenidos(b), await conteos(b)]), antes);
    assert.equal((await una(b, "envios")).borrador?.texto, "Texto nuevo de la administradora.");
    assert.equal((await una(b, "garantias")).estado, "publicada");
  });

  it("reconoce los nombres sin importar mayúsculas, tildes ni espacios de más, y conserva el nombre escrito como título", async () => {
    const b = await delacour({
      aria: {
        conocimiento: [
          { tema: "ENVIOS", info: "Envíos a todo el país." },
          { tema: "  medios   DE pago ", info: "Transferencia." },
          { tema: "garantias", info: "30 días." },
          { tema: "COLECCION VIDA ETERNA", info: "Línea especial." },
        ],
      },
    });
    await b.aplicarSql(scriptMigrarTextos());
    const filas = await contenidos(b);
    assert.deepEqual(filas.map((e) => e.clave), ["coleccion-vida-eterna", "envios", "garantias", "medios-de-pago"]);
    assert.deepEqual(filas.map((e) => e.borrador?.titulo), ["COLECCION VIDA ETERNA", "ENVIOS", "garantias", "medios DE pago"]);
  });

  it("un tema que NO está en la tabla no se migra ni se toca; sin textos (o vacíos) no hace nada", async () => {
    const b = await delacour({ aria: { conocimiento: [{ tema: "Tema nuevo del negocio", info: "Algo que nadie previó." }, { tema: "Envíos", info: "" }] } });
    const antes = JSON.stringify(await aria(b));
    await b.aplicarSql(scriptMigrarTextos());
    assert.equal((await contenidos(b)).length, 0);
    assert.equal(JSON.stringify(await aria(b)), antes);
    const vacio = await delacour({ aria: { conocimiento: [] } });
    await vacio.aplicarSql(scriptMigrarTextos());
    assert.equal((await contenidos(vacio)).length, 0);
  });

  it("solo siembra el negocio de la tienda «delacour»: el contenido de otro negocio ni se toca ni se cuenta", async () => {
    const b = await delacour();
    await b.aplicarSql(`select public.dulabs_cms_crear('${TENANT_B}', 'contenido', 'envios', '{"tema":"envios"}'::jsonb, null, 'Eva')`);
    await b.aplicarSql(scriptMigrarTextos());
    assert.equal((await contenidos(b)).length, 22);
    const ajenas = await contenidos(b, TENANT_B);
    assert.deepEqual([ajenas.length, ajenas[0].estado, ajenas[0].borrador], [1, "borrador", { tema: "envios" }]);
  });

  it("se NIEGA fuera de orden y no deja nada: sin migración del CMS, sin tabla de ARIA, sin módulo, sin tienda, con tienda duplicada, sin configuración o con dos", async () => {
    await assert.rejects((await delacour({ migracion: false })).aplicarSql(scriptMigrarTextos()), /falta aplicar la migración/);
    await assert.rejects((await delacour({ aria: undefined })).aplicarSql(scriptMigrarTextos()), /no existe la configuración de ARIA/);
    const sinModulo = await delacour({ modulo: false });
    await assert.rejects(sinModulo.aplicarSql(scriptMigrarTextos()), /el módulo cms_comercial no está habilitado/);
    assert.deepEqual(await conteos(sinModulo), { entidades: 0, versiones: 0, auditoria: 0 });
    await assert.rejects((await delacour({ tiendas: 0 })).aplicarSql(scriptMigrarTextos()), /exactamente UNA publicación.*hay 0/);
    await assert.rejects((await delacour({ tiendas: 2 })).aplicarSql(scriptMigrarTextos()), /exactamente UNA publicación.*hay 2/);
    await assert.rejects((await delacour({ aria: { filas: 0 } })).aplicarSql(scriptMigrarTextos()), /exactamente UNA configuración de ARIA.*hay 0/);
    await assert.rejects((await delacour({ aria: { filas: 2 } })).aplicarSql(scriptMigrarTextos()), /exactamente UNA configuración de ARIA.*hay 2/);
  });

  it("los borradores NO los ve ni ARIA ni la tienda: el lector de la aplicación no devuelve contenido", async () => {
    const b = await delacour();
    await b.aplicarSql(scriptMigrarTextos());
    const snap = await crearLectorSupabase(b.supabase).cargar(TENANT_A);
    assert.equal(snap?.contenidos.length, 0);
  });
});

describe("04_migrar_textos_a_borradores.reversa.sql", () => {
  it("archiva SOLO los borradores que nadie ha tocado; lo editado o publicado se queda; el prompt no cambia", async () => {
    const b = await delacour();
    await b.aplicarSql(scriptMigrarTextos());
    await editar(b, "envios", { texto: "Editado por la administradora." });
    await publicar(b, "garantias");
    const prompt = JSON.stringify(await aria(b));
    await b.aplicarSql(scriptReversaMigrarTextos());
    const filas = await contenidos(b);
    const archivadas = filas.filter((e) => e.archivada_at !== null).map((e) => e.clave);
    assert.equal(archivadas.length, 20);
    assert.ok(!archivadas.includes("envios") && !archivadas.includes("garantias"));
    assert.equal((await una(b, "envios")).archivada_at, null);
    assert.equal((await una(b, "garantias")).estado, "publicada");
    assert.equal(JSON.stringify(await aria(b)), prompt);
    // Idempotente.
    const antes = JSON.stringify([await contenidos(b), await conteos(b)]);
    await b.aplicarSql(scriptReversaMigrarTextos());
    assert.equal(JSON.stringify([await contenidos(b), await conteos(b)]), antes);
  });

  it("sin nada migrado no hace nada; sin tienda se niega", async () => {
    const vacio = await delacour();
    await vacio.aplicarSql(scriptReversaMigrarTextos());
    assert.deepEqual(await conteos(vacio), { entidades: 0, versiones: 0, auditoria: 0 });
    await assert.rejects((await delacour({ tiendas: 0 })).aplicarSql(scriptReversaMigrarTextos()), /no existe una publicación/);
  });
});

// ===========================================================================
// 05 — herramientas comerciales
// ===========================================================================

describe("05_habilitar_herramientas_comerciales.sql", () => {
  it("se NIEGA mientras no haya ningún texto publicado (solo borradores, o nada)", async () => {
    const b = await delacour();
    await assert.rejects(b.aplicarSql(scriptHabilitarHerramientas()), /todavía no hay ningún texto comercial publicado/);
    await b.aplicarSql(scriptMigrarTextos());
    await assert.rejects(b.aplicarSql(scriptHabilitarHerramientas()), /todavía no hay ningún texto comercial publicado/);
    assert.deepEqual((await aria(b)).herramientas, [...HERRAMIENTAS_ARIA_HOY]);
  });

  it("se NIEGA si un tema crítico sigue sin publicar (nombra cuáles); pasa al publicarlo, o con la confirmación explícita", async () => {
    const b = await delacour();
    await b.aplicarSql(scriptMigrarTextos());
    await publicarTodos(b, ["envios", "garantias"]);
    await assert.rejects(b.aplicarSql(scriptHabilitarHerramientas()), /siguen sin publicar: envios · garantias/);
    assert.deepEqual((await aria(b)).herramientas, [...HERRAMIENTAS_ARIA_HOY]);
    await publicar(b, "envios");
    await assert.rejects(b.aplicarSql(scriptHabilitarHerramientas()), /siguen sin publicar: garantias/);
    // Un tema NO crítico sin publicar no frena.
    const otro = await delacour();
    await otro.aplicarSql(scriptMigrarTextos());
    await publicarTodos(otro, ["regalos"]);
    await otro.aplicarSql(scriptHabilitarHerramientas());
    // Con la confirmación explícita, aun con un crítico pendiente.
    await conAjuste(b, "dulabs.permitir_temas_sin_publicar", "si", scriptHabilitarHerramientas());
    assert.deepEqual((await aria(b)).herramientas.slice(-4), [...HERRAMIENTAS_COMERCIALES]);
  });

  it("un tema crítico ARCHIVADO no frena (la administradora decidió no usarlo)", async () => {
    const b = await delacour();
    await b.aplicarSql(scriptMigrarTextos());
    await publicarTodos(b, ["envios"]);
    const e = await una(b, "envios");
    await b.sql("select public.dulabs_cms_archivar($1::uuid, $2::uuid, null::uuid, 'Ana')", [TENANT_A, e.id]);
    await b.aplicarSql(scriptHabilitarHerramientas());
    assert.deepEqual((await aria(b)).herramientas.slice(-4), [...HERRAMIENTAS_COMERCIALES]);
  });

  it("agrega SOLO las cuatro, al final y en su orden, sin quitar ni reordenar las demás; el prompt no cambia; repetirlo no hace nada", async () => {
    const b = await delacour();
    const antes = await aria(b);
    await hastaHerramientas(b);
    const despues = await aria(b);
    assert.deepEqual(despues.herramientas, [...antes.herramientas, ...HERRAMIENTAS_COMERCIALES]);
    assert.deepEqual(despues.negocio, antes.negocio);
    const marca = JSON.stringify(await aria(b));
    await b.aplicarSql(scriptHabilitarHerramientas());
    assert.equal(JSON.stringify(await aria(b)), marca);
  });

  it("si ya tenía alguna de las cuatro, agrega solo las que faltan (sin duplicar)", async () => {
    const b = await delacour({ aria: { herramientas: [...HERRAMIENTAS_ARIA_HOY, "consultar_ofertas"] } });
    await b.aplicarSql(scriptMigrarTextos());
    await publicarTodos(b);
    await b.aplicarSql(scriptHabilitarHerramientas());
    const h = (await aria(b)).herramientas;
    assert.equal(h.filter((x) => x === "consultar_ofertas").length, 1);
    for (const n of HERRAMIENTAS_COMERCIALES) assert.ok(h.includes(n), n);
  });

  it("la configuración resultante es VÁLIDA para ARIA (el cargador de la aplicación la acepta) y trae las cuatro herramientas", async () => {
    const b = await delacour();
    await hastaHerramientas(b);
    const fila = (await b.sql<AgentConfigRow>("select id_tenant, phone_number_id, tipo, habilitado, proveedor, modelo, credencial_ref, nivel_razonamiento, herramientas, canal, negocio from public.dulabs_agente_runtime_config"))[0];
    const r = parseAgentConfig(fila, { tenantId: TENANT_A, phoneNumberId: fila.phone_number_id });
    assert.equal(r.kind, "ok", JSON.stringify(r));
    if (r.kind === "ok") for (const n of HERRAMIENTAS_COMERCIALES) assert.ok(r.config.tools.includes(n), n);
  });

  it("se NIEGA si la lista superaría las 30 herramientas permitidas, y no deja nada", async () => {
    const muchas = Array.from({ length: 28 }, (_, i) => `herramienta_${i}`);
    const b = await delacour({ aria: { herramientas: muchas } });
    await b.aplicarSql(scriptMigrarTextos());
    await publicarTodos(b);
    await assert.rejects(b.aplicarSql(scriptHabilitarHerramientas()), /superaría el máximo permitido \(30\)/);
    assert.deepEqual((await aria(b)).herramientas, muchas);
  });

  it("se NIEGA fuera de orden (sin módulo, sin configuración de ARIA) y no toca otros negocios", async () => {
    await assert.rejects((await delacour({ modulo: false })).aplicarSql(scriptHabilitarHerramientas()), /el módulo cms_comercial no está habilitado/);
    await assert.rejects((await delacour({ aria: { filas: 0 } })).aplicarSql(scriptHabilitarHerramientas()), /exactamente UNA configuración de ARIA/);
    const b = await delacour();
    await b.aplicarSql(scriptMigrarTextos());
    await publicarTodos(b);
    await b.aplicarSql(`insert into public.dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, habilitado, proveedor, modelo, credencial_ref, herramientas, canal, negocio)
      values ('${TENANT_B}', '999', 'catalog_sales', true, 'gemini', 'gemini-3.6-flash', 'env:GEMINI_KEY_PRUEBA', array['search_products'], 'retail', '{}'::jsonb)`);
    await b.aplicarSql(scriptHabilitarHerramientas());
    const ajena = await b.sql<{ herramientas: string[] }>("select herramientas from public.dulabs_agente_runtime_config where id_tenant = $1", [TENANT_B]);
    assert.deepEqual(ajena[0].herramientas, ["search_products"]);
  });
});

describe("05_habilitar_herramientas_comerciales.reversa.sql", () => {
  it("quita SOLO las cuatro (ARIA vuelve a ser la de antes) y es repetible", async () => {
    const b = await delacour();
    const antes = await aria(b);
    await hastaHerramientas(b);
    await b.aplicarSql(scriptReversaHabilitarHerramientas());
    assert.deepEqual((await aria(b)).herramientas, antes.herramientas);
    assert.deepEqual((await aria(b)).negocio, antes.negocio);
    await b.aplicarSql(scriptReversaHabilitarHerramientas());
    assert.deepEqual((await aria(b)).herramientas, antes.herramientas);
  });

  it("se NIEGA si un tema crítico ya se retiró del prompt (solo vive en el CMS); con la confirmación explícita sí", async () => {
    const b = await delacour();
    await hastaHerramientas(b);
    await retirar(b, "envios");
    await assert.rejects(b.aplicarSql(scriptReversaHabilitarHerramientas()), /ya no están en el prompt y solo viven en el CMS: envios/);
    assert.ok((await aria(b)).herramientas.includes("consultar_ofertas"), "no se tocó nada");
    // Restaurar el tema destraba la reversa sin confirmación.
    await restaurar(b, "envios");
    await b.aplicarSql(scriptReversaHabilitarHerramientas());
    assert.ok(!(await aria(b)).herramientas.includes("consultar_ofertas"));
    // O confirmándolo.
    const c = await delacour();
    await hastaHerramientas(c);
    await retirar(c, "garantias");
    await conAjuste(c, "dulabs.confirmar_reversa_herramientas", "si", scriptReversaHabilitarHerramientas());
    assert.ok(!(await aria(c)).herramientas.includes("consultar_ofertas"));
  });

  it("un tema NO crítico retirado no frena la reversa", async () => {
    const b = await delacour();
    await hastaHerramientas(b);
    await retirar(b, "regalos");
    await b.aplicarSql(scriptReversaHabilitarHerramientas());
    assert.ok(!(await aria(b)).herramientas.includes("consultar_ofertas"));
  });
});

// ===========================================================================
// 06 — retirar del prompt
// ===========================================================================

describe("06_retirar_textos_del_prompt.sql", () => {
  it("se NIEGA sin temas, con una clave que no es de la tabla, sin las herramientas habilitadas y con un tema que no está publicado", async () => {
    const b = await delacour();
    await b.aplicarSql(scriptMigrarTextos());
    await publicarTodos(b);
    await assert.rejects(retirar(b, "envios"), /las herramientas comerciales de ARIA no están habilitadas/);
    await b.aplicarSql(scriptHabilitarHerramientas());
    await assert.rejects(b.aplicarSql(scriptRetirarDelPrompt()), /indica los temas a retirar/);
    await assert.rejects(retirar(b, "   "), /indica los temas a retirar/);
    await assert.rejects(retirar(b, "envios,inventado"), /«inventado» no es un tema de la tabla/);
    await assert.rejects(retirar(b, "despedida"), /«despedida» no es un tema de la tabla/);
    await assert.rejects(retirar(b, "datos-del-pedido"), /no es un tema de la tabla/);
    assert.equal((await temasDelPrompt(b)).length, 24, "ningún intento cambió el prompt");
    // Un tema editado después de publicar sigue publicado; uno pausado o despublicado NO se puede retirar.
    const e = await una(b, "regalos");
    await b.sql("select public.dulabs_cms_pausar($1::uuid, $2::uuid, null::uuid, 'Ana')", [TENANT_A, e.id]);
    await assert.rejects(retirar(b, "regalos"), /el tema «regalos» no está publicado en el CMS/);
    assert.equal((await temasDelPrompt(b)).length, 24);
  });

  it("se NIEGA si el tema sigue como borrador; y si falla UNO de varios, no se retira NINGUNO (atómico)", async () => {
    const b = await delacour();
    await b.aplicarSql(scriptMigrarTextos());
    await publicarTodos(b, ["horario"]);
    // «Horario» es crítico y quedó sin publicar: se habilitan las herramientas con la confirmación explícita para poder probar el 06.
    await conAjuste(b, "dulabs.permitir_temas_sin_publicar", "si", scriptHabilitarHerramientas());
    await assert.rejects(retirar(b, "envios,horario"), /el tema «horario» no está publicado/);
    assert.equal((await temasDelPrompt(b)).length, 24, "envios tampoco se retiró");
    assert.ok((await temasDelPrompt(b)).includes("Horario"));
  });

  it("se NIEGA si el tema nunca se migró (no existe en el CMS)", async () => {
    const b = await delacour({ aria: { conocimiento: CONOCIMIENTO_SINTETICO.filter((k) => k.tema !== "Servicios") } });
    await hastaHerramientas(b);
    assert.equal((await contenidos(b)).some((e) => e.clave === "servicios"), false);
    await assert.rejects(retirar(b, "servicios"), /el tema «servicios» no está publicado en el CMS/);
  });

  it("retira SOLO los temas indicados y publicados: el resto del prompt queda igual y en el mismo orden; las demás claves del negocio no cambian y sigue siendo válido para ARIA", async () => {
    const b = await delacour();
    await hastaHerramientas(b);
    const antes = await aria(b);
    await retirar(b, "promociones, envios");
    const despues = await aria(b);
    assert.deepEqual(despues.negocio.conocimiento, (antes.negocio.conocimiento ?? []).filter((k) => !["Promociones", "Envíos"].includes(k.tema)));
    assert.equal(despues.negocio.conocimiento?.length, 22);
    const sinConocimiento = (n: Record<string, unknown>) => Object.fromEntries(Object.entries(n).filter(([k]) => k !== "conocimiento"));
    assert.deepEqual(sinConocimiento(despues.negocio), sinConocimiento(antes.negocio));
    assert.deepEqual(despues.herramientas, antes.herramientas);
    assert.ok(businessConfigSchema.safeParse(despues.negocio).success);
    // Lo retirado sigue en el CMS, publicado.
    for (const c of ["promociones", "envios"]) assert.equal((await una(b, c)).estado, "publicada");
  });

  it("es repetible: volver a retirar lo ya retirado no cambia nada ni falla", async () => {
    const b = await delacour();
    await hastaHerramientas(b);
    await retirar(b, "envios");
    const marca = JSON.stringify((await aria(b)).negocio);
    await retirar(b, "envios");
    assert.equal(JSON.stringify((await aria(b)).negocio), marca);
  });

  it("el prompt de ARIA ya NO lleva el texto retirado (y sí los demás), y la configuración sigue siendo válida", async () => {
    const b = await delacour();
    await hastaHerramientas(b);
    await retirar(b, "envios");
    const fila = (await b.sql<AgentConfigRow>("select id_tenant, phone_number_id, tipo, habilitado, proveedor, modelo, credencial_ref, nivel_razonamiento, herramientas, canal, negocio from public.dulabs_agente_runtime_config"))[0];
    const r = parseAgentConfig(fila, { tenantId: TENANT_A, phoneNumberId: fila.phone_number_id });
    assert.equal(r.kind, "ok", JSON.stringify(r));
    if (r.kind !== "ok") return;
    const facts: TurnFacts = { channel: "retail", channelSource: "number_config", customerName: null, activeOrder: null, handoffActive: false };
    const prompt = buildSystemInstruction(r.config, emptyConversationState(), facts);
    assert.ok(!prompt.includes(textoOriginal("Envíos")), "el texto retirado no está en el prompt");
    assert.ok(prompt.includes(textoOriginal("Garantías")), "los demás siguen");
    assert.ok(prompt.includes("=== INFORMACIÓN COMERCIAL (herramientas del sistema) ==="), "y las reglas de las herramientas están");
  });

  it("ARIA responde desde el CMS lo que se retiró: la herramienta real devuelve el texto publicado, respeta la audiencia y resuelve {{minimo_mayorista}}", async () => {
    const b = await delacour();
    await hastaHerramientas(b);
    await retirar(b, "envios,venta-al-por-mayor");
    const negocio = (await aria(b)).negocio;
    const deps = {
      ownsPhoneNumber: async () => true,
      log: () => {},
      comercial: { cargar: (tenantId: string) => crearLectorSupabase(b.supabase).cargar(tenantId) },
    } as unknown as AgentToolsDeps;
    const ctx = (channel: "retail" | "wholesale"): AgentTurnToolContext => ({
      tenantId: TENANT_A,
      phoneNumberId: "100000000000001",
      waId: "573001112233",
      channel,
      requestId: "req-migracion-0001",
      wamid: "wamid.x",
      turn: 1,
      state: emptyConversationState(),
      pendingChoice: new Set(),
      designated: new Set(),
      customerText: "hola",
      images: [],
      handedOff: false,
      handoffMotive: null,
      newProposal: null,
      comercial: { valores: variablesDeNegocio(negocio).variables, nowMs: AHORA },
    });
    const consultar = async (tema: string, canal: "retail" | "wholesale") => {
      const r = await executeAgentTool("consultar_contenido_comercial", { tema }, AGENT_TOOL_NAMES, ctx(canal), deps);
      assert.equal(r.ok, true);
      return (r as unknown as { data: { empty: boolean; items: Array<{ text: string; title: string }> } }).data;
    };
    const envios = await consultar("envios", "retail");
    assert.equal(envios.empty, false);
    assert.equal(envios.items[0].text, textoOriginal("Envíos"));
    // Lo mayorista: el cliente DETAL no lo recibe; el MAYORISTA sí, con el mínimo ya resuelto desde la configuración (una sola fuente).
    const detal = await consultar("mayoristas", "retail");
    assert.equal(detal.empty, true);
    const mayor = await consultar("mayoristas", "wholesale");
    assert.equal(mayor.empty, false);
    assert.ok(mayor.items.some((i) => i.text === "La compra inicial mayorista parte desde $750.000 en productos surtidos."), JSON.stringify(mayor));
    assert.ok(!JSON.stringify(mayor).includes("{{"), "ninguna variable sin resolver");
  });

  it("solo toca el negocio de la tienda: la configuración de otro negocio queda igual", async () => {
    const b = await delacour();
    await b.aplicarSql(`insert into public.dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, habilitado, proveedor, modelo, credencial_ref, herramientas, canal, negocio)
      values ('${TENANT_B}', '999', 'catalog_sales', true, 'gemini', 'gemini-3.6-flash', 'env:GEMINI_KEY_PRUEBA', array['search_products'], 'retail', '{"conocimiento":[{"tema":"Envíos","info":"Otro negocio."}]}'::jsonb)`);
    await hastaHerramientas(b);
    await retirar(b, "envios");
    const ajena = await b.sql<{ negocio: unknown }>("select negocio from public.dulabs_agente_runtime_config where id_tenant = $1", [TENANT_B]);
    assert.deepEqual(ajena[0].negocio, { conocimiento: [{ tema: "Envíos", info: "Otro negocio." }] });
  });
});

describe("06_retirar_textos_del_prompt.reversa.sql", () => {
  it("devuelve al prompt el texto PUBLICADO hoy (aunque la administradora lo haya cambiado), con las variables resueltas, al final; lo que ya está se salta; es repetible", async () => {
    const b = await delacour();
    await hastaHerramientas(b);
    await retirar(b, "envios,venta-al-por-mayor,garantias");
    assert.equal((await temasDelPrompt(b)).length, 21);
    // La administradora cambia y vuelve a publicar un texto después de retirarlo.
    await editar(b, "envios", { texto: "Enviamos a todo el país por transportadora." });
    await publicar(b, "envios", "Cambio de texto");
    await restaurar(b, "envios,venta-al-por-mayor,garantias,regalos");
    const k = (await aria(b)).negocio.conocimiento ?? [];
    assert.equal(k.length, 24, "regalos nunca se retiró: se salta");
    assert.deepEqual(k.slice(-3), [
      { tema: "Envíos", info: "Enviamos a todo el país por transportadora." },
      { tema: "Venta al por mayor", info: "La compra inicial mayorista parte desde $750.000 en productos surtidos." },
      { tema: "Garantías", info: textoOriginal("Garantías") },
    ]);
    assert.ok(businessConfigSchema.safeParse((await aria(b)).negocio).success);
    const marca = JSON.stringify((await aria(b)).negocio);
    await restaurar(b, "envios,garantias");
    assert.equal(JSON.stringify((await aria(b)).negocio), marca);
  });

  it("resuelve {{direccion_tienda}} y {{nombre_negocio}} con la configuración del negocio, y se NIEGA con una variable desconocida o si falta la dirección o el nombre", async () => {
    const b = await delacour();
    await hastaHerramientas(b);
    await retirar(b, "ubicacion,quienes-somos,reclamos");
    await editar(b, "ubicacion", { texto: "Estamos en {{direccion_tienda}}." });
    await publicar(b, "ubicacion", "Con variable");
    await editar(b, "quienes-somos", { texto: "Somos {{nombre_negocio}}, con diseños propios." });
    await publicar(b, "quienes-somos", "Con variable");
    await editar(b, "reclamos", { texto: "Escríbenos a {{correo_inventado}}." });
    await publicar(b, "reclamos", "Variable desconocida");
    await restaurar(b, "ubicacion,quienes-somos");
    const k = (await aria(b)).negocio.conocimiento ?? [];
    assert.deepEqual(k.slice(-2), [
      { tema: "Ubicación", info: "Estamos en Centro Comercial Ficticio, local 12." },
      { tema: "Quiénes somos", info: "Somos Joyería Ficticia, con diseños propios." },
    ]);
    await assert.rejects(restaurar(b, "reclamos"), /variable desconocida/);
    // Sin la dirección configurada, o sin el nombre, el texto no se restaura a medias.
    await retirar(b, "ubicacion,quienes-somos");
    await b.aplicarSql(`update public.dulabs_agente_runtime_config set negocio = negocio #- '{pedido,direccion_tienda}'`);
    await assert.rejects(restaurar(b, "ubicacion"), /usa \{\{direccion_tienda\}\} y la dirección no está configurada/);
    await b.aplicarSql(`update public.dulabs_agente_runtime_config set negocio = negocio - 'nombre_negocio'`);
    await assert.rejects(restaurar(b, "quienes-somos"), /usa \{\{nombre_negocio\}\} y el nombre no está configurado/);
  });

  it("se NIEGA sin temas, con una clave que no es de la tabla o con un tema que no está publicado, y no cambia nada", async () => {
    const b = await delacour();
    await hastaHerramientas(b);
    await retirar(b, "envios");
    const marca = JSON.stringify((await aria(b)).negocio);
    await assert.rejects(b.aplicarSql(scriptReversaRetirarDelPrompt()), /indica los temas a restaurar/);
    await assert.rejects(restaurar(b, "inventado"), /no es un tema de la tabla/);
    const e = await una(b, "envios");
    await b.sql("select public.dulabs_cms_pausar($1::uuid, $2::uuid, null::uuid, 'Ana')", [TENANT_A, e.id]);
    await assert.rejects(restaurar(b, "envios"), /no está publicado en el CMS; no hay texto que restaurar/);
    assert.equal(JSON.stringify((await aria(b)).negocio), marca);
  });

  it("se NIEGA si el texto supera los 800 caracteres que admite el prompt, si una variable no tiene valor o si el prompt ya tiene 40 temas", async () => {
    const b = await delacour();
    await hastaHerramientas(b);
    await retirar(b, "envios,venta-al-por-mayor");
    // Texto largo (válido para el CMS, no para el prompt).
    await editar(b, "envios", { texto: "x".repeat(900) });
    await publicar(b, "envios", "Texto largo");
    await assert.rejects(restaurar(b, "envios"), /tiene 900 caracteres y el prompt admite hasta 800/);
    // El mínimo mayorista se quitó de la configuración: la variable ya no tiene valor.
    await b.aplicarSql(`update public.dulabs_agente_runtime_config set negocio = negocio #- '{pedido,minimo_mayorista}'`);
    await assert.rejects(restaurar(b, "venta-al-por-mayor"), /usa \{\{minimo_mayorista\}\} y el mínimo no está configurado/);
    // 40 temas: no cabe uno más.
    const lleno = await delacour({ aria: { conocimiento: Array.from({ length: 39 }, (_, i) => ({ tema: `Tema ${i}`, info: "x" })).concat(CONOCIMIENTO_SINTETICO.filter((k) => k.tema === "Garantías")) } });
    await hastaHerramientas(lleno);
    await retirar(lleno, "garantias");
    await lleno.aplicarSql(`update public.dulabs_agente_runtime_config set negocio = jsonb_set(negocio, '{conocimiento}', negocio->'conocimiento' || '[{"tema":"Otro","info":"x"}]'::jsonb)`);
    await assert.rejects(restaurar(lleno, "garantias"), /ya tiene 40 temas/);
  });
});

// ===========================================================================
// 07 — estado
// ===========================================================================

describe("07_estado_migracion_textos_solo_lectura.sql", () => {
  it("muestra, tema por tema, dónde vive cada texto en cada etapa: prompt → borrador → publicado en ambos → solo en el CMS", async () => {
    const b = await delacour();
    let s = await estadoPorTema(b);
    assert.equal(Object.keys(s).length, 22 + 2 + 1);
    assert.deepEqual([s["Envíos"].en_el_prompt, s["Envíos"].en_el_cms, s["Envíos"].fuente], [true, "no migrado", "prompt"]);
    assert.equal(s["herramientas comerciales"].en_el_cms, "0 de 4 habilitadas");
    assert.deepEqual([s["Despedida"].en_el_cms, s["Datos del pedido"].en_el_cms], ["se queda en el perfil", "se queda en el perfil"]);

    await b.aplicarSql(scriptMigrarTextos());
    s = await estadoPorTema(b);
    assert.deepEqual([s["Envíos"].en_el_cms, s["Envíos"].fuente], ["borrador", "prompt"]);

    await publicarTodos(b);
    await b.aplicarSql(scriptHabilitarHerramientas());
    s = await estadoPorTema(b);
    assert.deepEqual([s["Envíos"].en_el_cms, s["Envíos"].fuente], ["publicada", "prompt+cms"]);
    assert.equal(s["herramientas comerciales"].en_el_cms, "4 de 4 habilitadas");

    await retirar(b, "envios");
    s = await estadoPorTema(b);
    assert.deepEqual([s["Envíos"].en_el_prompt, s["Envíos"].fuente], [false, "cms"]);
    assert.equal(s["Garantías"].fuente, "prompt+cms");
  });

  it("no cambia NADA (solo lectura)", async () => {
    const b = await delacour();
    await hastaHerramientas(b);
    const antes = JSON.stringify([await contenidos(b), await conteos(b), await aria(b)]);
    await b.sql(scriptEstadoMigracion());
    assert.equal(JSON.stringify([await contenidos(b), await conteos(b), await aria(b)]), antes);
  });

  it("los temas críticos de la guarda existen en la tabla de migración", () => {
    const claves = new Set(TEXTOS_MIGRABLES.map((t) => t.clave));
    for (const c of CLAVES_CRITICAS) assert.ok(claves.has(c), c);
  });
});
