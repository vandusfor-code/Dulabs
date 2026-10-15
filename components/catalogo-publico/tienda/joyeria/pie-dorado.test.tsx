/**
 * Pie de la tienda (tema "joyeria") — pruebas DORADAS: el HTML que producía el pie ANTES de que fuera editable desde el CMS queda guardado en `__dorados__/pie-*.html` y NO PUEDE CAMBIAR mientras la
 * tienda no tenga un pie publicado (módulo apagado, sin pie, o un error al leerlo). Así se demuestra que hacer el pie editable no altera lo que ven hoy los clientes.
 * El año del «©» se reemplaza por {AÑO} para que el guardado no caduque cada enero.
 *
 * Para regenerar a propósito (solo si el diseño del pie cambia por una decisión del negocio): ACTUALIZAR_DORADOS=1 npx tsx --test <este archivo>.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BASE, LISTA } from "@/components/catalogo-publico/tienda/inicio-escenarios";
import { PieJoyeria } from "@/components/catalogo-publico/tienda/joyeria/PieJoyeria";

const CARPETA = path.join(process.cwd(), "components", "catalogo-publico", "tienda", "__dorados__");
const CATS = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: `Categoría ${i}` }));
const WHATSAPP = "573000000000";

type Props = Parameters<typeof PieJoyeria>[0];
const BASE_PROPS: Props = { marca: { name: "Delacour & Orus", descriptor: "Joyería" }, basePath: BASE, listPath: LISTA, categorias: CATS, whatsapp: WHATSAPP, descripcion: "Frase del pie.", mayorista: true };

const ESCENARIOS: Array<{ nombre: string; props: Props }> = [
  { nombre: "completo", props: BASE_PROPS },
  { nombre: "con-pagina-de-mayoristas", props: { ...BASE_PROPS, mayoristaHref: `${BASE}/mayoristas` } },
  { nombre: "sin-categorias-ni-mayoristas", props: { ...BASE_PROPS, categorias: [], mayorista: false } },
  { nombre: "sin-whatsapp", props: { ...BASE_PROPS, whatsapp: null } },
  { nombre: "solo-la-marca", props: { marca: { name: "Tienda" }, basePath: BASE, listPath: LISTA, categorias: [], whatsapp: null, mayorista: false } },
];

const html = (props: Props) => renderToStaticMarkup(<PieJoyeria {...props} />).replace(`© ${new Date().getFullYear()} `, "© {AÑO} ");

describe("pie de la tienda — salida de siempre guardada (no puede cambiar sin un pie publicado en el CMS)", () => {
  for (const e of ESCENARIOS) {
    it(`escenario «${e.nombre}»: el HTML es idéntico al guardado`, () => {
      const archivo = path.join(CARPETA, `pie-${e.nombre}.html`);
      const actual = html(e.props);
      if (process.env.ACTUALIZAR_DORADOS === "1") {
        mkdirSync(CARPETA, { recursive: true });
        writeFileSync(archivo, actual, "utf8");
      }
      assert.ok(existsSync(archivo), `falta el dorado ${archivo} (ACTUALIZAR_DORADOS=1 lo genera)`);
      assert.equal(actual, readFileSync(archivo, "utf8"));
    });
  }

  it("es determinista y el año queda como {AÑO}", () => {
    for (const e of ESCENARIOS) {
      assert.equal(html(e.props), html(e.props), e.nombre);
      assert.ok(html(e.props).includes("© {AÑO} "), e.nombre);
    }
  });

  it("los escenarios cubren lo importante: categorías con «Ver todas», mayoristas al bloque y a la página, WhatsApp y el pie sin nada más que la marca", () => {
    const todo = ESCENARIOS.map((e) => html(e.props)).join("\n");
    for (const marca of ["Ver todas", "#mayoristas", "/mayoristas", "wa.me", "Navegar", "Catálogo creado con"]) assert.ok(todo.includes(marca), marca);
  });
});
