/**
 * Catálogo — ELIMINAR CATEGORÍAS (servicio contra el repositorio en memoria, que emula la clave foránea compuesta de la base): una categoría sin productos se borra; con
 * productos NO se borra sin decidir a dónde van; los productos se pasan (o quedan sin categoría) con el texto legado sincronizado y la escritura atribuida a quien la hizo;
 * nada cruza de un negocio a otro; y si entra un producto justo antes de borrar, la barrera final lo detiene sin dejar nada a medias.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { CATEGORY_MOVE_NONE, categoryDeleteQuerySchema } from "@/lib/catalogo/domain";
import { CatalogError } from "@/lib/catalogo/errors";
import type { CatalogRepository } from "@/lib/catalogo/repository";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";

const DELACOUR: CatalogActor = { tenantId: "0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4", userId: "11111111-1111-4111-8111-111111111111" };
const OTRO: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-000000000002", userId: "22222222-2222-4222-8222-222222222222" };
/** Otra persona del MISMO negocio: la que creó los productos (quien elimina la categoría es DELACOUR). */
const AYUDANTE: CatalogActor = { tenantId: DELACOUR.tenantId, userId: "33333333-3333-4333-8333-333333333333" };
const ID_INEXISTENTE = "99999999-9999-4999-8999-999999999999";

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let service: ReturnType<typeof createCatalogService>;

beforeEach(() => {
  mem = createInMemoryCatalogRepository();
  service = createCatalogService({ repo: mem.repo });
});

const crear = (actor: CatalogActor, name: string, categoryId: string | null = null) =>
  service.createProduct(actor, { stock: 5, name, retailPrice: 35_000, wholesalePrice: null, categoryId });
const categoria = (actor: CatalogActor, name: string) => service.createCategory(actor, { name });
const nombres = async (actor: CatalogActor) => (await service.listCategories(actor)).map((c) => c.name).sort();
const productos = (tenantId: string) => mem.snapshot(tenantId);
async function rechaza(p: Promise<unknown>, code: CatalogError["code"]) {
  await assert.rejects(p, (err: unknown) => err instanceof CatalogError && err.code === code);
}

describe("categoría sin productos", () => {
  it("se elimina y desaparece de la lista; no mueve nada", async () => {
    const dijes = await categoria(DELACOUR, "Dijes");
    await categoria(DELACOUR, "Aretes");
    const r = await service.deleteCategory(DELACOUR, dijes.id);
    assert.deepEqual(r, { deleted: true, moved: 0, movedTo: null });
    assert.deepEqual(await nombres(DELACOUR), ["Aretes"]);
  });

  it("un destino que sobra no hace nada (no hay productos que mover) y tampoco molesta", async () => {
    const dijes = await categoria(DELACOUR, "Dijes");
    const r = await service.deleteCategory(DELACOUR, dijes.id, { moveTo: CATEGORY_MOVE_NONE });
    assert.deepEqual(r, { deleted: true, moved: 0, movedTo: null });
  });

  it("la categoría vuelve a poder crearse con el mismo nombre", async () => {
    const dijes = await categoria(DELACOUR, "Dijes");
    await service.deleteCategory(DELACOUR, dijes.id);
    const otra = await categoria(DELACOUR, "Dijes");
    assert.notEqual(otra.id, dijes.id, "es una categoría nueva, no la vieja");
  });
});

describe("categoría con productos", () => {
  it("sin decidir a dónde van NO se borra: 409 con el número de productos y nada cambia", async () => {
    const aretes = await categoria(DELACOUR, "Aretes");
    await crear(DELACOUR, "Aretes brillo", aretes.id);
    await crear(DELACOUR, "Aretes luna", aretes.id);
    const antes = productos(DELACOUR.tenantId);

    await assert.rejects(service.deleteCategory(DELACOUR, aretes.id), (err: unknown) => err instanceof CatalogError && err.code === "CONFLICT" && /2 productos/.test(err.message));

    assert.deepEqual(await nombres(DELACOUR), ["Aretes"], "la categoría sigue");
    assert.deepEqual(productos(DELACOUR.tenantId), antes, "los productos siguen intactos");
  });

  it("el mensaje usa el singular con un solo producto", async () => {
    const aretes = await categoria(DELACOUR, "Aretes");
    await crear(DELACOUR, "Aretes brillo", aretes.id);
    await assert.rejects(service.deleteCategory(DELACOUR, aretes.id), (err: unknown) => err instanceof CatalogError && /1 producto\./.test(err.message));
  });

  it("pasarlos a otra categoría: los productos cambian de categoría (id y texto legado), el resto no se toca y quedan atribuidos a quien lo hizo", async () => {
    const aretes = await categoria(DELACOUR, "Aretes");
    const dijes = await categoria(DELACOUR, "Dijes");
    const anillos = await categoria(DELACOUR, "Anillos");
    const a1 = await crear(AYUDANTE, "Aretes brillo", aretes.id);
    const a2 = await crear(AYUDANTE, "Aretes luna", aretes.id);
    const d1 = await crear(AYUDANTE, "Dije corazón", dijes.id);
    const sueltoSin = await crear(AYUDANTE, "Anillo sin categoría");
    const ajeno = await crear(OTRO, "Producto de otro negocio", (await categoria(OTRO, "Aretes")).id);
    const antesDeLosOtros = productos(DELACOUR.tenantId).filter((p) => ![a1.id, a2.id].includes(p.id));
    const antesDeMoverlos = productos(DELACOUR.tenantId).filter((p) => [a1.id, a2.id].includes(p.id));
    for (const p of antesDeMoverlos) assert.equal(p.updatedBy, AYUDANTE.userId, "punto de partida: los creó otra persona");

    const r = await service.deleteCategory(DELACOUR, aretes.id, { moveTo: anillos.id });

    assert.deepEqual(r, { deleted: true, moved: 2, movedTo: { id: anillos.id, name: "Anillos" } });
    assert.deepEqual(await nombres(DELACOUR), ["Anillos", "Dijes"]);
    for (const id of [a1.id, a2.id]) {
      const p = productos(DELACOUR.tenantId).find((x) => x.id === id)!;
      assert.equal(p.categoryId, anillos.id);
      assert.equal(p.categoryName, "Anillos", "el texto legado `categoria` viaja con el id");
      assert.equal(p.updatedBy, DELACOUR.userId, "la escritura queda atribuida a quien eliminó la categoría, no a quien creó el producto");
      assert.ok(p.updatedAt > antesDeMoverlos.find((x) => x.id === id)!.updatedAt, "y la fecha de modificación avanza");
    }
    assert.deepEqual(productos(DELACOUR.tenantId).filter((p) => ![a1.id, a2.id].includes(p.id)), antesDeLosOtros, "los productos de las otras categorías (y sin categoría) no se tocaron");
    assert.equal((await service.getProduct(OTRO, ajeno.id)).categoryName, "Aretes", "el otro negocio ni se entera");
    assert.equal(d1.categoryId, dijes.id);
    assert.equal(sueltoSin.categoryId, null);
  });

  it("dejarlos sin categoría: id y texto legado quedan en null", async () => {
    const aretes = await categoria(DELACOUR, "Aretes");
    const p = await crear(DELACOUR, "Aretes brillo", aretes.id);
    const r = await service.deleteCategory(DELACOUR, aretes.id, { moveTo: CATEGORY_MOVE_NONE });
    assert.deepEqual(r, { deleted: true, moved: 1, movedTo: null });
    const despues = (await service.getProduct(DELACOUR, p.id)) as Awaited<ReturnType<typeof service.getProduct>>;
    assert.equal(despues.categoryId, null);
    assert.equal(despues.categoryName, null);
    assert.deepEqual(await nombres(DELACOUR), []);
  });

  it("los productos INACTIVOS también cuentan y también se mueven (no se quedan apuntando a una categoría que ya no existe)", async () => {
    const aretes = await categoria(DELACOUR, "Aretes");
    const dijes = await categoria(DELACOUR, "Dijes");
    const activo = await crear(DELACOUR, "Aretes activo", aretes.id);
    const inactivo = await crear(DELACOUR, "Aretes inactivo", aretes.id);
    await service.updateProduct(DELACOUR, inactivo.id, { status: "INACTIVE" });

    const conteo = await service.listCategoriesWithCounts(DELACOUR);
    assert.equal(conteo.find((c) => c.id === aretes.id)?.productCount, 2, "el conteo incluye al inactivo");

    await service.deleteCategory(DELACOUR, aretes.id, { moveTo: dijes.id });
    for (const id of [activo.id, inactivo.id]) assert.equal((await service.getProduct(DELACOUR, id)).categoryId, dijes.id);
  });
});

describe("el destino se verifica en el servidor", () => {
  it("no puede ser la misma categoría que se elimina (y no se toca nada)", async () => {
    const aretes = await categoria(DELACOUR, "Aretes");
    await crear(DELACOUR, "Aretes brillo", aretes.id);
    await rechaza(service.deleteCategory(DELACOUR, aretes.id, { moveTo: aretes.id }), "VALIDATION_ERROR");
    assert.deepEqual(await nombres(DELACOUR), ["Aretes"]);
    assert.equal(productos(DELACOUR.tenantId)[0].categoryId, aretes.id);
  });

  it("una categoría inexistente como destino se rechaza SIN mover ni borrar nada", async () => {
    const aretes = await categoria(DELACOUR, "Aretes");
    await crear(DELACOUR, "Aretes brillo", aretes.id);
    await rechaza(service.deleteCategory(DELACOUR, aretes.id, { moveTo: ID_INEXISTENTE }), "VALIDATION_ERROR");
    assert.deepEqual(await nombres(DELACOUR), ["Aretes"]);
    assert.equal(productos(DELACOUR.tenantId)[0].categoryId, aretes.id);
  });

  it("una categoría de OTRO negocio como destino se rechaza: los productos no se fugan al catálogo ajeno", async () => {
    const aretes = await categoria(DELACOUR, "Aretes");
    const ajena = await categoria(OTRO, "Ajena");
    await crear(DELACOUR, "Aretes brillo", aretes.id);
    await rechaza(service.deleteCategory(DELACOUR, aretes.id, { moveTo: ajena.id }), "VALIDATION_ERROR");
    assert.equal(productos(DELACOUR.tenantId)[0].categoryId, aretes.id);
    assert.deepEqual(await nombres(OTRO), ["Ajena"], "y la del otro negocio sigue donde estaba");
  });
});

describe("aislamiento y existencia", () => {
  it("una categoría de otro negocio responde «no existe» y NO se borra", async () => {
    const ajena = await categoria(OTRO, "Ajena");
    await rechaza(service.deleteCategory(DELACOUR, ajena.id), "NOT_FOUND");
    assert.deepEqual(await nombres(OTRO), ["Ajena"]);
  });

  it("una categoría que no existe responde 404, y borrarla dos veces también", async () => {
    await rechaza(service.deleteCategory(DELACOUR, ID_INEXISTENTE), "NOT_FOUND");
    const dijes = await categoria(DELACOUR, "Dijes");
    await service.deleteCategory(DELACOUR, dijes.id);
    await rechaza(service.deleteCategory(DELACOUR, dijes.id), "NOT_FOUND");
  });
});

describe("barrera final: la base impide borrar una categoría con productos", () => {
  it("si entra un producto entre pasar los demás y borrar, el borrado se detiene con 409 y los ya pasados quedan donde están", async () => {
    const aretes = await categoria(DELACOUR, "Aretes");
    const dijes = await categoria(DELACOUR, "Dijes");
    const antiguo = await crear(DELACOUR, "Aretes antiguo", aretes.id);
    let colado = false;
    const repoConCarrera: CatalogRepository = {
      ...mem.repo,
      async reassignCategory(...args) {
        await mem.repo.reassignCategory(...args);
        if (!colado) {
          colado = true;
          await crear(DELACOUR, "Aretes que llegó tarde", aretes.id); // otra persona lo creó justo ahora
        }
      },
    };
    const conCarrera = createCatalogService({ repo: repoConCarrera });

    await rechaza(conCarrera.deleteCategory(DELACOUR, aretes.id, { moveTo: dijes.id }), "CONFLICT");

    assert.deepEqual(await nombres(DELACOUR), ["Aretes", "Dijes"], "la categoría NO se borró");
    assert.equal((await service.getProduct(DELACOUR, antiguo.id)).categoryId, dijes.id, "el que sí se había pasado ya está en su destino");

    // Reintentar es seguro: ahora pasa el que llegó tarde y la categoría se elimina.
    const r = await conCarrera.deleteCategory(DELACOUR, aretes.id, { moveTo: dijes.id });
    assert.equal(r.moved, 1);
    assert.deepEqual(await nombres(DELACOUR), ["Dijes"]);
  });

  it("el repositorio, a secas, se niega a borrar una categoría que todavía tiene productos", async () => {
    const aretes = await categoria(DELACOUR, "Aretes");
    await crear(DELACOUR, "Aretes brillo", aretes.id);
    await rechaza(mem.repo.deleteCategory(DELACOUR.tenantId, aretes.id), "CONFLICT");
    assert.equal(await mem.repo.deleteCategory(DELACOUR.tenantId, ID_INEXISTENTE), false);
  });
});

describe("categorías con su conteo", () => {
  it("cuenta por categoría (0 las vacías), ordena como el listado normal y no mezcla negocios", async () => {
    const aretes = await categoria(DELACOUR, "Aretes");
    const dijes = await categoria(DELACOUR, "Dijes");
    await crear(DELACOUR, "A1", aretes.id);
    await crear(DELACOUR, "A2", aretes.id);
    await crear(DELACOUR, "A3", aretes.id);
    const ajena = await categoria(OTRO, "Aretes");
    await crear(OTRO, "Del otro", ajena.id);

    const conteo = await service.listCategoriesWithCounts(DELACOUR);
    assert.deepEqual(
      conteo.map((c) => [c.name, c.productCount]).sort(),
      [["Aretes", 3], ["Dijes", 0]],
    );
    assert.deepEqual(
      conteo.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      [aretes, dijes].sort((a, b) => a.name.localeCompare(b.name)),
      "mismas categorías que el listado simple",
    );
  });

  it("sin categorías devuelve una lista vacía", async () => {
    assert.deepEqual(await service.listCategoriesWithCounts(DELACOUR), []);
  });
});

describe("esquema de la consulta de borrado", () => {
  it("acepta sin destino, «none» o un id; rechaza cualquier otra cosa y parámetros desconocidos", () => {
    assert.deepEqual(categoryDeleteQuerySchema.parse({}), {});
    assert.deepEqual(categoryDeleteQuerySchema.parse({ moveTo: "none" }), { moveTo: "none" });
    assert.deepEqual(categoryDeleteQuerySchema.parse({ moveTo: ID_INEXISTENTE }), { moveTo: ID_INEXISTENTE });
    for (const malo of ["", "ninguna", "todas", "123", "null"]) assert.equal(categoryDeleteQuerySchema.safeParse({ moveTo: malo }).success, false, `«${malo}» no es un destino válido`);
    assert.equal(categoryDeleteQuerySchema.safeParse({ moveTo: "none", otro: 1 }).success, false);
  });
});
