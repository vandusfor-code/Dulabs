/**
 * Vitrina de TECNOLOGÍA de Aquí Sí Lo Compras (Home móvil): lo puro. Qué negocio usa qué tema, el lockup de la marca, el icono de cada categoría REAL,
 * el enlace de los banners y la etiqueta de disponibilidad de las tarjetas. Delacour (y cualquier negocio sin configurar) conserva la vitrina clásica.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARTES_BANNER,
  ICONOS_BENEFICIO,
  ICONOS_CATEGORIA,
  enlaceDeConsulta,
  iconoDeCategoria,
  partirMarca,
  storefrontConfigFor,
  tecnologiaOf,
  temaDe,
  type CatalogStorefrontConfig,
} from "@/lib/catalogo/vitrina";
import { etiquetaDeProducto } from "@/components/catalogo-publico/tienda/tecnologia/TarjetaTecnologia";

const CONTENIDO: NonNullable<CatalogStorefrontConfig["tecnologia"]> = {
  buscador: "Busca…",
  hero: { etiqueta: "Tecnología para", lineas: ["Un mundo", "sin límites"], descripcion: "d", cta: "Comprar" },
  beneficios: [],
  banners: [],
};

describe("tema de la vitrina: solo Aquí Sí Lo Compras usa el de tecnología", () => {
  it("el clásico es el valor por defecto; 'tecnologia' solo con el tema pedido Y su contenido (nunca una vitrina a medias)", () => {
    assert.equal(temaDe({}), "clasico");
    assert.equal(temaDe({ tema: "clasico", tecnologia: CONTENIDO }), "clasico");
    assert.equal(temaDe({ tema: "tecnologia" }), "clasico", "sin contenido no hay vitrina de tecnología");
    assert.equal(temaDe({ tema: "tecnologia", tecnologia: CONTENIDO }), "tecnologia");
    assert.equal(tecnologiaOf({ tema: "tecnologia", tecnologia: CONTENIDO }), CONTENIDO);
    assert.equal(tecnologiaOf({ tecnologia: CONTENIDO }), null, "con el tema clásico el contenido de tecnología no se usa");
  });

  it("por publicación: ASLC usa tecnología; Delacour y los negocios sin configurar, la vitrina clásica de siempre", () => {
    assert.equal(temaDe(storefrontConfigFor("aqui-si-lo-compras")), "tecnologia");
    assert.equal(temaDe(storefrontConfigFor("delacour")), "clasico");
    assert.equal(temaDe(storefrontConfigFor("otro-negocio-cualquiera")), "clasico");
    assert.deepEqual(storefrontConfigFor("otro-negocio-cualquiera"), {});
    assert.equal(storefrontConfigFor("delacour").tema, undefined, "Delacour no declara tema: sigue exactamente como estaba");
    assert.equal(storefrontConfigFor("delacour").tecnologia, undefined);
  });

  it("el contenido de ASLC es consistente: iconos y artes del conjunto cerrado, banners con una búsqueda real y sin datos comerciales inventados", () => {
    const t = tecnologiaOf(storefrontConfigFor("aqui-si-lo-compras"));
    assert.ok(t);
    assert.equal(t.hero.lineas.length, 2);
    assert.ok(t.beneficios.length >= 1);
    for (const b of t.beneficios) assert.ok((ICONOS_BENEFICIO as readonly string[]).includes(b.icono), b.icono);
    assert.ok(t.banners.length >= 1);
    for (const b of t.banners) {
      assert.ok((ARTES_BANNER as readonly string[]).includes(b.arte), b.arte);
      assert.ok(b.consulta.trim().length > 0 && b.consulta === b.consulta.trim(), "cada banner lleva a una búsqueda del catálogo");
      assert.ok(enlaceDeConsulta("/catalogo/aqui-si-lo-compras", b.consulta).startsWith("/catalogo/aqui-si-lo-compras?q="));
    }
    const todo = JSON.stringify(t);
    assert.doesNotMatch(todo, /\$\s?\d|\d+\s?%|\b\d+\s?(d[ií]as|horas)\b/i, "ni precios, ni descuentos, ni plazos inventados en el contenido editorial");
  });
});

describe("lockup de la marca (header)", () => {
  it("parte el nombre en dos líneas en mayúsculas", () => {
    assert.deepEqual(partirMarca("Aquí Sí Lo Compras"), ["AQUÍ SÍ", "LO COMPRAS"]);
    assert.deepEqual(partirMarca("Tienda Uno Dos"), ["TIENDA UNO", "DOS"]);
    assert.deepEqual(partirMarca("  Mucho   espacio  aquí  "), ["MUCHO ESPACIO", "AQUÍ"]);
  });

  it("una palabra o vacío: nunca revienta ni inventa texto", () => {
    assert.deepEqual(partirMarca("Tecno"), ["TECNO", ""]);
    assert.deepEqual(partirMarca(""), ["", ""]);
    assert.deepEqual(partirMarca("   "), ["", ""]);
  });
});

describe("icono de cada categoría REAL (por su nombre)", () => {
  it("reconoce las líneas de tecnología con y sin tildes, en singular y plural", () => {
    const casos: Array<[string, (typeof ICONOS_CATEGORIA)[number]]> = [
      ["Tablet", "tablet"],
      ["Tablets infantiles", "tablet"],
      ["Relojes inteligentes", "smartwatch"],
      ["Smartwatch 4G", "smartwatch"],
      ["Celulares", "celular"],
      ["Teléfonos móviles", "celular"],
      ["Computadores", "computador"],
      ["Portátiles", "computador"],
      ["Audífonos", "audio"],
      ["Consolas y juegos", "gaming"],
      ["Freidoras de aire", "cocina"],
    ];
    for (const [nombre, icono] of casos) assert.equal(iconoDeCategoria(nombre), icono, nombre);
  });

  it("sin coincidencia, el icono general; y todo icono devuelto pertenece al conjunto cerrado", () => {
    for (const nombre of ["Accesorios", "", "Varios", "Ofertas"]) {
      assert.equal(iconoDeCategoria(nombre), "general", JSON.stringify(nombre));
      assert.ok((ICONOS_CATEGORIA as readonly string[]).includes(iconoDeCategoria(nombre)));
    }
  });
});

describe("enlace de un banner", () => {
  it("lleva a la búsqueda del listado público, bien codificada y sin espacios sobrantes", () => {
    assert.equal(enlaceDeConsulta("/catalogo/x", "tablet"), "/catalogo/x?q=tablet");
    assert.equal(enlaceDeConsulta("/catalogo/x", "  reloj niños  "), "/catalogo/x?q=reloj%20ni%C3%B1os");
    assert.equal(enlaceDeConsulta("/catalogo/x", "a&b=c"), "/catalogo/x?q=a%26b%3Dc", "no se puede inyectar otro parámetro");
  });
});

describe("etiqueta de la tarjeta: solo con disponibilidad REAL", () => {
  it("'Agotado' si no hay unidades, 'Últimas unidades' si quedan pocas y nada si hay stock normal (ni 'Nuevo' ni 'Oferta' inventados)", () => {
    assert.deepEqual(etiquetaDeProducto({ available: false, availability: "sold_out" }), { texto: "Agotado", tono: "agotado" });
    assert.deepEqual(etiquetaDeProducto({ available: false, availability: "available" }), { texto: "Agotado", tono: "agotado" }, "no disponible nunca se muestra como disponible");
    assert.deepEqual(etiquetaDeProducto({ available: true, availability: "sold_out" }), { texto: "Agotado", tono: "agotado" });
    assert.deepEqual(etiquetaDeProducto({ available: true, availability: "low" }), { texto: "Últimas unidades", tono: "aviso" });
    assert.equal(etiquetaDeProducto({ available: true, availability: "available" }), null);
  });
});
