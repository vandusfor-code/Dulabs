/**
 * CMS comercial — el PIE DE PÁGINA sobre la base SQL REAL (Postgres embebido): el mismo ciclo borrador → revisar → publicar → versión activa que los demás tipos, uno por negocio, solo un
 * administrador lo cambia, el lector lo entrega a la tienda y nada se ve hasta publicarlo. Nada toca Supabase.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Rol } from "@/lib/team";
import type { ActorCms } from "@/lib/cms-comercial/contrato";
import { isCmsError } from "@/lib/cms-comercial/errores";
import { crearLector } from "@/lib/cms-comercial/lector";
import { cargarPiePublico } from "@/lib/cms-comercial/pie-publico";
import { pieDesdeCms, pieDeRespaldo, pieInicial, type ContextoPie } from "@/lib/cms-comercial/pie";
import type { PuertoCatalogo, PuertoVariables } from "@/lib/cms-comercial/puertos";
import { crearRepositorioSupabaseCms } from "@/lib/cms-comercial/repositorio-supabase";
import { crearServicioCms } from "@/lib/cms-comercial/servicio";
import { AHORA, CAT_ARETES } from "@/lib/cms-comercial/testing/fixtures";
import { crearBaseCms, type BaseCms } from "@/lib/cms-comercial/testing/pglite";

let base: BaseCms;
let serie = 0;

const catalogo: PuertoCatalogo = {
  async productosPorReferencia() {
    return [];
  },
  async buscarProductos() {
    return [];
  },
  async categoriasPorId(_t, ids) {
    return ids.filter((i) => i === CAT_ARETES).map((id) => ({ id, nombre: "Aretes" }));
  },
  async listarCategorias() {
    return [{ id: CAT_ARETES, nombre: "Aretes" }];
  },
};
const variablesPuerto: PuertoVariables = { async valores() { return { variables: { minimo_mayorista: "$750.000" }, minimoMayorista: 750000 }; } };

let repo: ReturnType<typeof crearRepositorioSupabaseCms>;
let servicio: ReturnType<typeof crearServicioCms>;
let lector: ReturnType<typeof crearLector>;

before(async () => {
  base = await crearBaseCms();
  repo = crearRepositorioSupabaseCms(base.supabase);
  servicio = crearServicioCms({ repo, catalogo, variables: variablesPuerto, reloj: () => AHORA });
  lector = crearLector(repo, { alDescartar: () => {} });
});
after(async () => {
  await base.cerrar();
});

async function negocio() {
  serie += 1;
  const tenantId = `a0000000-0000-4000-8000-${String(serie).padStart(12, "0")}`;
  await base.habilitarModulo(tenantId);
  return tenantId;
}
const actor = (tenantId: string, rol: Rol = "admin", n = 1): ActorCms => ({ tenantId, userId: `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`, miembroId: n, rol, etiqueta: `Persona ${n}` });
const SEMILLA = pieInicial({ mayoristas: true, descripcion: "Joyas para cada momento." });
const CTX: ContextoPie = { basePath: "/catalogo/demo", listPath: "/catalogo/demo?todo=1", categorias: [{ id: CAT_ARETES, name: "Aretes" }], whatsappHref: "https://wa.me/573001112233", mayoristaHref: "/catalogo/demo/mayoristas", descripcion: "Frase de siempre." };
const fallo = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (isCmsError(e)) return e;
    throw e;
  }
  return assert.fail("debía fallar");
};

describe("PIE: crear (uno por negocio)", () => {
  it("nace en borrador con su código fijo «pie», su nombre y sin vigencia", async () => {
    const t = await negocio();
    const e = await servicio.crear(actor(t), { tipo: "pie", borrador: SEMILLA });
    assert.equal(e.tipo, "pie");
    assert.equal(e.clave, "pie");
    assert.equal(e.nombre, "Pie de página");
    assert.equal(e.estado, "borrador");
    assert.equal(e.estadoVigencia, null);
    assert.equal(e.versionActiva, null);
    assert.deepEqual(e.borrador, SEMILLA);
  });

  it("un segundo pie en el mismo negocio se rechaza con un mensaje claro; otro negocio tiene el suyo", async () => {
    const t = await negocio();
    await servicio.crear(actor(t), { tipo: "pie", borrador: SEMILLA });
    const e = await fallo(servicio.crear(actor(t), { tipo: "pie", borrador: SEMILLA }));
    assert.equal(e.code, "VALIDATION_ERROR");
    assert.equal(e.message, "El pie de página ya existe.");
    const otro = await negocio();
    assert.equal((await servicio.crear(actor(otro), { tipo: "pie", borrador: SEMILLA })).clave, "pie");
  });

  it("un archivado cuenta: no se puede crear otro pie hasta desarchivar el que hay (el límite incluye archivados)", async () => {
    const t = await negocio();
    const a = actor(t);
    const e = await servicio.crear(a, { tipo: "pie", borrador: SEMILLA });
    await servicio.archivar(a, e.id);
    assert.equal((await fallo(servicio.crear(a, { tipo: "pie", borrador: SEMILLA }))).message, "El pie de página ya existe.");
    const vuelto = await servicio.desarchivar(a, e.id);
    assert.equal(vuelto.archivada, false);
  });

  it("solo un administrador lo crea, lo edita o lo publica; los demás roles solo lo consultan", async () => {
    const t = await negocio();
    const admin = actor(t);
    const e = await servicio.crear(admin, { tipo: "pie", borrador: SEMILLA });
    for (const rol of ["agente", "lectura"] as const) {
      const otro = actor(t, rol, 2);
      assert.equal((await fallo(servicio.guardarBorrador(otro, e.id, { borrador: SEMILLA, rev: e.rev }))).code, "FORBIDDEN");
      assert.equal((await fallo(servicio.publicar(otro, e.id, { rev: e.rev }))).code, "FORBIDDEN");
      assert.equal((await servicio.listar(otro, { tipo: "pie" })).length, 1, "pero lo puede ver");
    }
  });

  it("un borrador con campos que no son de un pie se rechaza al guardar (la estructura es la del pie)", async () => {
    const t = await negocio();
    const e = await fallo(servicio.crear(actor(t), { tipo: "pie", borrador: { ...SEMILLA, portada: { visible: true } } }));
    assert.equal(e.code, "VALIDATION_ERROR");
    assert.match(e.message, /Campo no permitido: portada/);
  });
});

describe("PIE: revisar y publicar", () => {
  it("el pie de siempre pasa la revisión y se publica; entonces el lector se lo entrega a la tienda", async () => {
    const t = await negocio();
    const a = actor(t);
    const e = await servicio.crear(a, { tipo: "pie", borrador: SEMILLA });
    const v = await servicio.validar(a, e.id);
    assert.equal(v.ok, true);
    assert.equal((await lector.cargar(t))?.pie, null, "en borrador la tienda no lo ve");
    const p = await servicio.publicar(a, e.id, { rev: e.rev, nota: "Primer pie" });
    assert.equal(p.version, 1);
    assert.equal(p.entidad.estado, "publicada");
    const snap = await lector.cargar(t);
    assert.deepEqual(snap?.pie?.contenido, SEMILLA);
    assert.equal(snap?.pie?.clave, "pie");
  });

  it("publicado tal cual, la tienda se ve IGUAL que con el pie de siempre", async () => {
    const t = await negocio();
    const a = actor(t);
    const e = await servicio.crear(a, { tipo: "pie", borrador: pieInicial({ mayoristas: true, descripcion: CTX.descripcion }) });
    await servicio.publicar(a, e.id, { rev: e.rev });
    const publicado = (await lector.cargar(t))?.pie?.contenido ?? null;
    assert.ok(publicado);
    assert.deepEqual(pieDesdeCms(publicado, CTX), pieDeRespaldo(CTX));
  });

  it("un enlace al catálogo mayorista bloquea la publicación y dice en qué campo (lo verían todos los clientes)", async () => {
    const t = await negocio();
    const a = actor(t);
    const malo = { ...SEMILLA, columnas: [{ titulo: "Legal", enlaces: [{ texto: "Mayor", destino: { tipo: "externo", url: "https://delacour.co/catalogo/demo/mayor/0123456789abcdef0123456789abcdef" } }] }] };
    const e = await servicio.crear(a, { tipo: "pie", borrador: malo });
    const err = await fallo(servicio.publicar(a, e.id, { rev: e.rev }));
    assert.equal(err.code, "NOT_PUBLISHABLE");
    assert.ok(err.problemas?.some((p) => p.codigo === "enlace_mayorista" && p.campo === "columnas.0.enlaces.0.destino.url"));
    assert.equal((await lector.cargar(t))?.pie, null, "no salió nada");
  });

  it("una red con el dominio equivocado, una categoría que no existe y una dirección http bloquean la publicación", async () => {
    const t = await negocio();
    const a = actor(t);
    const CAT_FALTA = "c0000000-0000-4000-8000-0000000000ff";
    const e = await servicio.crear(a, {
      tipo: "pie",
      borrador: {
        ...SEMILLA,
        columnas: [{ titulo: "Navegar", enlaces: [{ texto: "Una", destino: { tipo: "categoria", categoria_id: CAT_FALTA } }, { texto: "Otra", destino: { tipo: "externo", url: "http://delacour.co" } }] }],
        redes: [{ red: "instagram", url: "https://sitio-malo.com/delacour" }],
      },
    });
    const v = await servicio.validar(a, e.id);
    assert.equal(v.ok, false);
    const codigos = v.errores.map((x) => `${x.codigo}@${x.campo}`);
    assert.ok(codigos.includes("categoria_inexistente@columnas.0.enlaces.0.destino.categoria_id"), codigos.join(", "));
    assert.ok(codigos.includes("esquema@columnas.0.enlaces.1.destino.url"), codigos.join(", "));
    assert.ok(codigos.includes("esquema@redes.0.url"), codigos.join(", "));
    assert.equal((await fallo(servicio.publicar(a, e.id, { rev: e.rev }))).code, "NOT_PUBLISHABLE");
  });

  it("editar después de publicar NO cambia lo que ve la tienda hasta volver a publicar; pausar y despublicar la devuelven al pie de siempre", async () => {
    const t = await negocio();
    const a = actor(t);
    const e = await servicio.crear(a, { tipo: "pie", borrador: SEMILLA });
    await servicio.publicar(a, e.id, { rev: e.rev });
    const editado = await servicio.guardarBorrador(a, e.id, { borrador: { ...SEMILLA, descripcion: "Nueva frase." }, rev: (await servicio.obtener(a, e.id)).rev });
    assert.equal(editado.tieneCambios, true);
    assert.equal((await lector.cargar(t))?.pie?.contenido.descripcion, "Joyas para cada momento.", "la tienda sigue con lo publicado");
    await servicio.publicar(a, e.id, { rev: editado.rev });
    assert.equal((await lector.cargar(t))?.pie?.contenido.descripcion, "Nueva frase.");
    await servicio.pausar(a, e.id);
    assert.equal((await lector.cargar(t))?.pie, null, "pausado: la tienda vuelve al pie de siempre");
    await servicio.reanudar(a, e.id);
    assert.ok((await lector.cargar(t))?.pie);
    await servicio.despublicar(a, e.id);
    assert.equal((await lector.cargar(t))?.pie, null, "despublicado: vuelve al borrador y la tienda al pie de siempre");
  });

  it("restaurar una versión anterior del pie la deja en vivo; el historial registra cada paso con el tipo «pie»", async () => {
    const t = await negocio();
    const a = actor(t);
    const e = await servicio.crear(a, { tipo: "pie", borrador: SEMILLA });
    await servicio.publicar(a, e.id, { rev: e.rev });
    const g = await servicio.guardarBorrador(a, e.id, { borrador: { ...SEMILLA, descripcion: "Segunda." }, rev: (await servicio.obtener(a, e.id)).rev });
    await servicio.publicar(a, e.id, { rev: g.rev });
    await servicio.restaurar(a, e.id, { version: 1, nota: "Volver al primero" });
    assert.equal((await lector.cargar(t))?.pie?.contenido.descripcion, "Joyas para cada momento.");
    const historial = await servicio.auditoria(a, { entidadId: e.id });
    assert.ok(historial.length >= 5);
    assert.ok(historial.every((h) => h.entidadTipo === "pie"));
    assert.deepEqual([...new Set(historial.map((h) => h.accion))].sort(), ["crear", "editar_borrador", "publicar", "restaurar"]);
  });

  it("de punta a punta: lo publicado llega a la tienda por el cargador (con el negocio de la tienda) y un negocio no ve el pie de otro", async () => {
    const t = await negocio();
    const otro = await negocio();
    const a = actor(t);
    const e = await servicio.crear(a, { tipo: "pie", borrador: { ...SEMILLA, redes: [{ red: "instagram", url: "https://www.instagram.com/delacour.joyeria" }] } });
    await servicio.publicar(a, e.id, { rev: e.rev });
    const deps = { tenantDe: async (slug: string) => (slug === "tienda-a" ? t : slug === "tienda-b" ? otro : null), cargar: (id: string) => lector.cargar(id) };
    const pieA = await cargarPiePublico(deps, "tienda-a");
    assert.equal(pieA.pie?.redes[0].url, "https://www.instagram.com/delacour.joyeria");
    assert.deepEqual(await cargarPiePublico(deps, "tienda-b"), { pie: null, paginas: [], menu: [] }, "el otro negocio no tiene pie publicado");
    assert.equal(pieDesdeCms(pieA.pie, CTX).redes[0].usuario, "@delacour.joyeria");
  });
});

describe("PIE: antes de aplicar la migración del pie", () => {
  it("crear el pie avisa con claridad que todavía no está disponible (no «el contenido no es válido»), y lo demás sigue funcionando", async () => {
    const vieja = await crearBaseCms({ conPie: false });
    try {
      const r = crearRepositorioSupabaseCms(vieja.supabase);
      const s = crearServicioCms({ repo: r, catalogo, variables: variablesPuerto, reloj: () => AHORA });
      const t = "a0000000-0000-4000-8000-0000000000f1";
      await vieja.habilitarModulo(t);
      const e = await fallo(s.crear(actor(t), { tipo: "pie", borrador: SEMILLA }));
      assert.equal(e.code, "FEATURE_UNAVAILABLE");
      assert.equal(e.status, 503);
      assert.equal(e.message, "El pie de página todavía no está disponible para tu tienda. Avísale al equipo de DuLabs para que lo active.");
      assert.equal((await s.crear(actor(t), { tipo: "contenido", borrador: { tema: "faq", audiencia: "todos", titulo: "¿Hacen envíos?", palabras_clave: [], orden: 0 } })).tipo, "contenido");
      assert.deepEqual(await s.listar(actor(t), { tipo: "pie" }), []);
    } finally {
      await vieja.cerrar();
    }
  });
});
