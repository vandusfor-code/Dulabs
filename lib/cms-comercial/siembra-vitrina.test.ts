/**
 * CMS comercial — SIEMBRA de la vitrina actual: el contenido equivalente a lo que la tienda muestra hoy y el SQL que lo publica.
 *
 * Los archivos supabase/provisioning/delacour/03_* los GENERA este código; esta prueba los regenera y los compara (para actualizarlos a propósito:
 * ACTUALIZAR_SQL=1 npx tsx --test lib/cms-comercial/siembra-vitrina.test.ts).
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { checksumDe } from "@/lib/cms-comercial/checksum";
import { homeSchema } from "@/lib/cms-comercial/esquemas";
import { ETIQUETA_SIEMBRA, homeDesdeVitrina, sqlReversaSembrarVitrina, sqlSembrarVitrina } from "@/lib/cms-comercial/siembra-vitrina";
import { storefrontConfigFor, type CatalogStorefrontConfig } from "@/lib/catalogo/vitrina";

const ruta = (archivo: string) => path.join(process.cwd(), "supabase", "provisioning", "delacour", archivo);
const delacour = () => storefrontConfigFor("delacour");

describe("homeDesdeVitrina — lo que la tienda de Delacour muestra hoy, como contenido del CMS", () => {
  it("la portada y el banner de hoy, con su misma imagen, textos y botón al catálogo", () => {
    const h = homeDesdeVitrina(delacour());
    assert.ok(h);
    assert.deepEqual(h.portada, {
      visible: true,
      imagen: { origen: "estatico", src: "/catalogo/delacour/pantalla1mujer_principal.png", ancho: 1669, alto: 942, alt: "Mujer luciendo un dije de corazón y un anillo solitario en oro", foco: "72% 50%" },
      etiqueta: "Más que joyas",
      titulo: "Historias que brillan contigo",
      subtitulo: "Diseños únicos para cada momento de tu vida.",
      boton: { texto: "Ver catálogo", destino: { tipo: "catalogo" } },
    });
    assert.deepEqual(h.banner, {
      visible: true,
      imagen: { origen: "estatico", src: "/catalogo/delacour/regalojoyeriapantalla1.png", ancho: 2172, alto: 724, alt: "El regalo perfecto siempre es una joya. Hacé cada momento inolvidable." },
    });
  });

  it("las secciones de hoy visibles y en su orden; ofertas, combos y campaña apagadas; sin destacados ni categorías elegidos (todo automático, como hoy)", () => {
    const h = homeDesdeVitrina(delacour());
    assert.deepEqual(h?.secciones, [
      { tipo: "portada", visible: true },
      { tipo: "categorias", visible: true },
      { tipo: "destacados", visible: true },
      { tipo: "banner", visible: true },
      { tipo: "ofertas", visible: false },
      { tipo: "combos", visible: false },
      { tipo: "campana", visible: false },
    ]);
    assert.deepEqual(h?.categorias_destacadas, []);
    assert.deepEqual(h?.productos_destacados, []);
  });

  it("el contenido sembrado cumple el esquema ESTRICTO del CMS (lo que publica la aplicación)", () => {
    assert.ok(homeSchema.safeParse(homeDesdeVitrina(delacour())).success);
  });

  it("sin portada completa (imagen y título) no hay nada que sembrar", () => {
    assert.equal(homeDesdeVitrina({}), null);
    assert.equal(homeDesdeVitrina(storefrontConfigFor("negocio-sin-configuracion")), null);
    assert.equal(homeDesdeVitrina({ bannerImage: delacour().bannerImage }), null);
  });

  it("sin banner, la sección del banner queda apagada y no se inventa una imagen", () => {
    const sinBanner: CatalogStorefrontConfig = { ...delacour(), bannerImage: undefined };
    const h = homeDesdeVitrina(sinBanner);
    assert.equal(h?.banner, undefined);
    assert.equal(h?.secciones.find((s) => s.tipo === "banner")?.visible, false);
  });

  it("sin botón en la portada (heroCta vacío), no se inventa uno", () => {
    const h = homeDesdeVitrina({ ...delacour(), heroCta: "" });
    assert.equal(h?.portada.boton, undefined);
  });

  it("una imagen con una ruta que el CMS no admite hace fallar la siembra (nunca se genera contenido inválido)", () => {
    const mala: CatalogStorefrontConfig = { ...delacour(), heroImage: { ...delacour().heroImage!, src: "https://externo.example/foto.png" } };
    assert.throws(() => homeDesdeVitrina(mala));
  });
});

describe("sqlSembrarVitrina — el script de siembra", () => {
  const home = homeDesdeVitrina(delacour())!;
  const sql = sqlSembrarVitrina("delacour", home);

  it("el archivo del repositorio es EXACTAMENTE lo que el código genera (no se edita a mano)", () => {
    const archivo = ruta("03_sembrar_vitrina_actual.sql");
    if (process.env.ACTUALIZAR_SQL === "1") writeFileSync(archivo, sql, "utf8");
    assert.equal(readFileSync(archivo, "utf8").replace(/\r\n/g, "\n"), sql);
  });

  it("la reversa del repositorio también es exactamente lo que el código genera", () => {
    const archivo = ruta("03_sembrar_vitrina_actual.reversa.sql");
    const esperado = sqlReversaSembrarVitrina("delacour");
    if (process.env.ACTUALIZAR_SQL === "1") writeFileSync(archivo, esperado, "utf8");
    assert.equal(readFileSync(archivo, "utf8").replace(/\r\n/g, "\n"), esperado);
  });

  it("lleva el checksum del contenido canónico (lo que la aplicación verifica al leer) y la firma de siembra", () => {
    assert.ok(sql.includes(`'${checksumDe(home)}'`));
    assert.ok(sql.includes(`'${ETIQUETA_SIEMBRA}'`));
  });

  it("resuelve el negocio por el slug de la publicación: ningún identificador de negocio escrito a mano", () => {
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sql), "sin UUID en el script");
    assert.ok(sql.includes("from public.dulabs_catalogo_publicacion where slug = 'delacour'"));
  });

  it("trae las guardas: migración aplicada, UNA tienda, módulo habilitado y no pisar una página principal existente", () => {
    for (const trozo of ["falta aplicar la migración", "se esperaba exactamente UNA publicación", "el módulo cms_comercial no está habilitado", "la página principal ya existe en el CMS; no se siembra nada"]) assert.ok(sql.includes(trozo), trozo);
  });

  it("es UNA sola sentencia (un bloque DO atómico) y no toca otras tablas que las del CMS", () => {
    const sentencias = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").split(/;\s*\n/).filter((s) => s.trim() !== "");
    assert.equal((sql.match(/^do \$\$/gm) ?? []).length, 1);
    assert.equal((sql.match(/^end \$\$;/gm) ?? []).length, 1);
    assert.ok(sentencias.length >= 1);
    assert.ok(!/\b(update|delete|truncate|drop|alter)\b/i.test(sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")), "solo crea y publica");
    assert.ok(!sql.includes("dulabs_catalogo_productos") && !sql.includes("dulabs_pedidos"));
  });

  it("rechaza un slug que no sea minúsculas, números y guiones (nunca se interpola texto arbitrario en el SQL)", () => {
    for (const malo of ["", "Delacour", "dela cour", "delacour'; drop table x; --", "delacour\n", "../x"]) assert.throws(() => sqlSembrarVitrina(malo, home), /Slug no válido/, JSON.stringify(malo));
    for (const malo of ["", "Delacour", "x'--"]) assert.throws(() => sqlReversaSembrarVitrina(malo), /Slug no válido/, JSON.stringify(malo));
  });

  it("rechaza contenido que no cumpla el esquema del CMS o que contenga el delimitador del script", () => {
    assert.throws(() => sqlSembrarVitrina("delacour", { ...home, portada: { ...home.portada, titulo: "x" } }));
    assert.throws(() => sqlSembrarVitrina("delacour", { ...home, portada: { ...home.portada, titulo: "Título $cms_json$ raro" } }));
  });

  it("es determinista: el mismo contenido da exactamente el mismo script", () => {
    assert.equal(sqlSembrarVitrina("delacour", home), sqlSembrarVitrina("delacour", structuredClone(home)));
  });
});

describe("sqlReversaSembrarVitrina — deshacer la siembra", () => {
  const sql = sqlReversaSembrarVitrina("delacour");

  it("solo despublica (nada se borra) y se niega si la administradora ya publicó cambios, salvo confirmación explícita", () => {
    const codigo = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    assert.ok(codigo.includes("dulabs_cms_despublicar"));
    assert.ok(!/\b(delete|truncate|drop)\b/i.test(codigo));
    assert.ok(sql.includes("dulabs.confirmar_reversa_siembra"));
  });
});
