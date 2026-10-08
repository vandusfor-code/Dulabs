/**
 * CMS comercial — la MIGRACIÓN de los textos de ARIA al CMS (scripts 04–07 de supabase/provisioning/delacour): la tabla de correspondencia es válida y completa,
 * el código genera EXACTAMENTE los archivos del repositorio, y los scripts no llevan datos de ningún negocio (ni identificadores ni textos reales). El comportamiento
 * ejecutado de verdad en Postgres está en migracion-textos.pglite.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AUDIENCIAS, TEMAS_CONTENIDO } from "@/lib/cms-comercial/contrato";
import { businessConfigSchema } from "@/lib/agente/config";
import { contenidoSchema } from "@/lib/cms-comercial/esquemas";
import {
  CLAVES_CRITICAS,
  MAX_PILOTOS,
  REGEX_PILOTO,
  TEMAS_QUE_SE_QUEDAN_EN_EL_PERFIL,
  TEXTOS_MIGRABLES,
  archivosMigracionTextos,
  normalizarTema,
  sqlAbrirHerramientasATodos,
  sqlEstadoMigracion,
  sqlHabilitarHerramientas,
  sqlMigrarTextos,
  sqlRetirarDelPrompt,
  sqlReversaHabilitarHerramientas,
  sqlReversaMigrarTextos,
  sqlReversaRetirarDelPrompt,
} from "@/lib/cms-comercial/migracion-textos";
import { HERRAMIENTAS_COMERCIALES } from "@/lib/agente/nombres-herramientas";

const ruta = (archivo: string) => `supabase/provisioning/delacour/${archivo}`;
const sinComentarios = (sql: string) => sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

describe("la tabla de correspondencia", () => {
  it("son 22 temas más los 2 que se quedan en el perfil: los 24 del prompt de ARIA, sin repetir", () => {
    assert.equal(TEXTOS_MIGRABLES.length, 22);
    assert.deepEqual([...TEMAS_QUE_SE_QUEDAN_EN_EL_PERFIL], ["Despedida", "Datos del pedido"]);
    const todos = [...TEXTOS_MIGRABLES.map((t) => t.legado), ...TEMAS_QUE_SE_QUEDAN_EN_EL_PERFIL].map(normalizarTema);
    assert.equal(todos.length, 24);
    assert.equal(new Set(todos).size, 24);
  });

  it("cada fila es un contenido válido del CMS: clave, tema, audiencia y orden (el título y el texto los pone el prompt)", () => {
    const claves = new Set<string>();
    const ordenes = new Set<number>();
    for (const t of TEXTOS_MIGRABLES) {
      assert.match(t.clave, /^[a-z0-9][a-z0-9-]{0,79}$/, t.clave);
      assert.ok((TEMAS_CONTENIDO as readonly string[]).includes(t.tema), t.clave);
      assert.ok((AUDIENCIAS as readonly string[]).includes(t.audiencia), t.clave);
      assert.ok(!claves.has(t.clave) && !ordenes.has(t.orden), `repetido: ${t.clave}`);
      claves.add(t.clave);
      ordenes.add(t.orden);
      const r = contenidoSchema.safeParse({ tema: t.tema, audiencia: t.audiencia, titulo: t.legado, texto: "x", palabras_clave: [], orden: t.orden });
      assert.ok(r.success, `${t.clave}: ${JSON.stringify(r.error?.issues)}`);
    }
  });

  it("lo mayorista nace con audiencia «mayorista» (nunca se le muestra a un cliente detal por un descuido) y «Venta al detal» solo al detal", () => {
    const aud = Object.fromEntries(TEXTOS_MIGRABLES.map((t) => [t.clave, t.audiencia]));
    assert.equal(aud["venta-al-por-mayor"], "mayorista");
    assert.equal(aud["emprendimiento"], "mayorista");
    assert.equal(aud["venta-al-detal"], "detal");
    assert.equal(TEXTOS_MIGRABLES.filter((t) => t.tema === "mayoristas").every((t) => t.audiencia === "mayorista"), true);
  });

  it("los temas críticos existen en la tabla", () => {
    const claves = new Set(TEXTOS_MIGRABLES.map((t) => t.clave));
    for (const c of CLAVES_CRITICAS) assert.ok(claves.has(c), c);
  });

  it("normalizarTema ignora mayúsculas, tildes, eñes y espacios de más (igual que el SQL)", () => {
    assert.equal(normalizarTema("  Garantías  "), "garantias");
    assert.equal(normalizarTema("ENVÍOS"), "envios");
    assert.equal(normalizarTema("Medios   de\tpago"), "medios de pago");
    assert.equal(normalizarTema("Diseño"), "diseno");
    assert.equal(normalizarTema("Colección Vida Eterna"), "coleccion vida eterna");
  });
});

describe("los scripts generados", () => {
  const archivos = archivosMigracionTextos("delacour");

  it("hay ocho, con los nombres que dice el README", () => {
    assert.deepEqual(Object.keys(archivos), [
      "04_migrar_textos_a_borradores.sql",
      "04_migrar_textos_a_borradores.reversa.sql",
      "05_habilitar_herramientas_comerciales.sql",
      "05_habilitar_herramientas_comerciales.reversa.sql",
      "05b_abrir_herramientas_comerciales_a_todos.sql",
      "06_retirar_textos_del_prompt.sql",
      "06_retirar_textos_del_prompt.reversa.sql",
      "07_estado_migracion_textos_solo_lectura.sql",
    ]);
  });

  for (const [nombre, sql] of Object.entries(archivosMigracionTextos("delacour"))) {
    it(`${nombre}: el archivo del repositorio es EXACTAMENTE lo que el código genera (no se edita a mano)`, () => {
      if (process.env.ACTUALIZAR_SQL === "1") writeFileSync(ruta(nombre), sql, "utf8");
      assert.equal(readFileSync(ruta(nombre), "utf8").replace(/\r\n/g, "\n"), sql);
    });

    it(`${nombre}: ningún identificador de negocio ni dato real; el negocio sale del slug de la publicación`, () => {
      assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sql), "sin UUID");
      assert.ok(!/\b57\d{10}\b/.test(sql), "sin teléfonos");
      assert.ok(sql.includes("where slug = 'delacour'"));
      assert.ok(!/(AIza|sk_live|bearer )/i.test(sql));
    });

    it(`${nombre}: no toca productos, precios, pedidos, clientes ni la tienda`, () => {
      const codigo = sinComentarios(sql);
      for (const prohibido of ["dulabs_catalogo_productos", "dulabs_catalogo_pedidos", "dulabs_catalogo_clientes", "dulabs_catalogo_inventario", "dulabs_pedidos"]) assert.ok(!codigo.includes(prohibido), prohibido);
      assert.ok(!/\b(delete|truncate|drop|alter)\b/i.test(codigo), "ni borra ni altera estructuras");
    });
  }

  it("04, 05, 05b y 06 son UNA sola sentencia atómica (un bloque DO); el 07 es solo lectura (un select)", () => {
    for (const [nombre, sql] of Object.entries(archivos)) {
      if (nombre.startsWith("07_")) {
        const codigo = sinComentarios(sql);
        assert.ok(!/\b(insert|update|delete|create|alter|drop|set)\b/i.test(codigo.replace(/\bset_\w+/g, "")), "solo lectura");
        assert.equal((codigo.match(/;/g) ?? []).length, 1);
      } else {
        assert.equal((sql.match(/^do \$\$/gm) ?? []).length, 1, nombre);
        assert.equal((sql.match(/^end \$\$;/gm) ?? []).length, 1, nombre);
      }
    }
  });

  it("el 04 solo CREA borradores: nunca publica ni modifica la configuración de ARIA", () => {
    const codigo = sinComentarios(sqlMigrarTextos("delacour"));
    assert.ok(codigo.includes("dulabs_cms_crear"));
    assert.ok(!codigo.includes("dulabs_cms_publicar") && !/\bupdate\b/i.test(codigo) && !/\binsert\b/i.test(codigo));
  });

  it("el 05 solo toca la lista de herramientas y el piloto; el 05b solo quita el piloto; el 06 solo el conocimiento del prompt; ninguno publica contenido", () => {
    const c05 = sinComentarios(sqlHabilitarHerramientas("delacour"));
    assert.ok(/set herramientas = /.test(c05) && c05.includes("jsonb_set(negocio, '{comercial_piloto}'") && !c05.includes("'{conocimiento}'") && !c05.includes("dulabs_cms_publicar"));
    const c05b = sinComentarios(sqlAbrirHerramientasATodos("delacour"));
    assert.ok(c05b.includes("negocio = negocio - 'comercial_piloto'") && !/set herramientas/.test(c05b) && !c05b.includes("'{conocimiento}'") && !c05b.includes("dulabs_cms_publicar"));
    const c06 = sinComentarios(sqlRetirarDelPrompt("delacour"));
    assert.ok(/set negocio = jsonb_set\(negocio, '\{conocimiento\}'/.test(c06) && !/set herramientas/.test(c06) && !c06.includes("dulabs_cms_publicar"));
    const c06r = sinComentarios(sqlReversaRetirarDelPrompt("delacour"));
    assert.ok(/set negocio = jsonb_set\(negocio, '\{conocimiento\}'/.test(c06r) && !/set herramientas/.test(c06r));
    const c05r = sinComentarios(sqlReversaHabilitarHerramientas("delacour"));
    assert.ok(/set herramientas = /.test(c05r) && c05r.includes("negocio = negocio - 'comercial_piloto'") && !c05r.includes("'{conocimiento}'"));
  });

  it("las guardas están: migración aplicada, UNA tienda, módulo habilitado, UNA configuración de ARIA y el orden de los pasos", () => {
    for (const sql of [sqlMigrarTextos("delacour"), sqlHabilitarHerramientas("delacour"), sqlAbrirHerramientasATodos("delacour"), sqlRetirarDelPrompt("delacour")]) {
      for (const trozo of ["falta aplicar la migración", "se esperaba exactamente UNA publicación", "el módulo cms_comercial no está habilitado", "se esperaba exactamente UNA configuración de ARIA"]) assert.ok(sql.includes(trozo), trozo);
    }
    assert.ok(sqlHabilitarHerramientas("delacour").includes("todavía no hay ningún texto comercial publicado"));
    assert.ok(sqlHabilitarHerramientas("delacour").includes("dulabs.permitir_temas_sin_publicar"));
    assert.ok(sqlRetirarDelPrompt("delacour").includes("las herramientas comerciales de ARIA no están habilitadas"));
    assert.ok(sqlRetirarDelPrompt("delacour").includes("no está publicado en el CMS"));
    assert.ok(sqlReversaHabilitarHerramientas("delacour").includes("dulabs.confirmar_reversa_herramientas"));
  });

  it("el piloto: el 05 se niega sin números y nunca abre al público; el 05b es el único que quita el piloto; el 06 se niega mientras haya piloto", () => {
    const c05 = sqlHabilitarHerramientas("delacour");
    for (const trozo of ["indica el número (o los números) de piloto", "dulabs.piloto_comercial", "SIN el indicativo del país", "no es un número válido", "el piloto admite hasta 20 números", "SOLO para el piloto", "ya están ABIERTAS a todos los clientes", "05_habilitar_herramientas_comerciales.reversa.sql"]) assert.ok(c05.includes(trozo), trozo);
    assert.ok(!sinComentarios(c05).includes("todos'"), "el 05 no acepta «todos»: abrir al público es SOLO del 05b");
    const c05b = sqlAbrirHerramientasATodos("delacour");
    for (const trozo of ["no están habilitadas", "ya están abiertas a todos los clientes", "no hay ningún texto comercial publicado", "siguen sin publicar"]) assert.ok(c05b.includes(trozo), trozo);
    assert.ok(sqlRetirarDelPrompt("delacour").includes("están en PILOTO"));
    assert.ok(sqlEstadoMigracion("delacour").includes("piloto de las herramientas"));
  });

  it("la expresión de los números de piloto del SQL es la MISMA que valida el esquema de la configuración (si no, una configuración válida para el script dejaría a ARIA fuera de servicio)", () => {
    const re = new RegExp(REGEX_PILOTO);
    for (const n of ["573009998877", "573001112233", "12345678", "123456789012345", "5730099988770"]) {
      assert.equal(re.test(n), true, n);
      assert.equal(businessConfigSchema.safeParse({ comercial_piloto: [n] }).success, n.length <= 15, n);
    }
    for (const n of ["0573009998877", "1234567", "1234567890123456", "+573009998877", "57 314 812 7388", "abc", ""]) {
      assert.equal(re.test(n), false, n);
      assert.equal(businessConfigSchema.safeParse({ comercial_piloto: [n] }).success, false, n);
    }
    assert.equal(businessConfigSchema.safeParse({ comercial_piloto: [] }).success, false, "vacío no (el piloto sin números abriría al público)");
    assert.equal(businessConfigSchema.safeParse({ comercial_piloto: Array.from({ length: MAX_PILOTOS + 1 }, (_, i) => `57300000${String(1000 + i)}`) }).success, false);
    assert.equal(businessConfigSchema.safeParse({ comercial_piloto: ["573009998877"] }).success, true);
  });

  it("el 05 agrega EXACTAMENTE las cuatro herramientas comerciales del código (una sola fuente de nombres)", () => {
    const sql = sqlHabilitarHerramientas("delacour");
    for (const n of HERRAMIENTAS_COMERCIALES) assert.ok(sql.includes(`'${n}'`), n);
    assert.equal(HERRAMIENTAS_COMERCIALES.length, 4);
  });

  it("un slug mal formado no genera nada (el slug va dentro del SQL)", () => {
    for (const malo of ["", "Delacour", "de la cour", "x'; drop table y; --", "a_b"]) {
      assert.throws(() => sqlMigrarTextos(malo), /Slug no válido/, malo);
      assert.throws(() => sqlEstadoMigracion(malo), /Slug no válido/, malo);
      assert.throws(() => sqlReversaMigrarTextos(malo), /Slug no válido/, malo);
    }
  });
});
