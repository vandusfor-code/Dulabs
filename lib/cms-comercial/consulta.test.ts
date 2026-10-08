/**
 * Lo que ARIA puede saber de lo publicado (consulta.ts): ofertas, combos, campañas y contenido comercial. Contratos: solo lo PUBLICADO + VIGENTE + APLICABLE al canal,
 * `empty` como única base para decir «por ahora no hay», todo calculado y redactado por el backend, sin ids ni versiones ni stock exacto.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProductoParaCombo } from "@/lib/cms-comercial/evaluacion";
import {
  campanasVigentes,
  combosVigentes,
  consultaCampanasSchema,
  consultaCombosSchema,
  consultaContenidoSchema,
  consultaOfertasSchema,
  contenidoComercial,
  ofertaDeProducto,
  ofertasVigentes,
  productoParaCombo,
  referenciasDeCombosVigentes,
  type ContextoConsulta,
} from "@/lib/cms-comercial/consulta";
import { AHORA, CAT_ARETES, CAT_DIJES, TENANT_B, campana, combo, contenido, instantanea, oferta, publicada } from "@/lib/cms-comercial/testing/fixtures";

const ctx = (snap = instantanea(), canal: "retail" | "wholesale" = "retail", ahora = AHORA, valores: ContextoConsulta["valores"] = { minimo_mayorista: "$750.000" }): ContextoConsulta => ({ snap, canal, ahora, valores });
const REF_VISIBLE_NO = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|"version"|publicadaAt|creadaAt/;

const AMOR = publicada("amor", oferta({ nombre: "Amor y Amistad", descripcion: "Temporada de regalos.", alcance: { todos: true, referencias: [], categorias: [] }, condiciones: "Hasta agotar existencias.", prioridad: 5 }));
const ARETES = publicada("aretes", oferta({ nombre: "Aretes especiales", beneficio: { tipo: "precio_especial", detal: 79_000, mayorista: 55_000 }, alcance: { todos: false, referencias: ["DL-000001"], categorias: [] }, prioridad: 9 }));

describe("ofertasVigentes — ofertas publicadas, vigentes y aplicables al canal", () => {
  it("entrega cada oferta con su beneficio, descripción, vigencia en palabras, condiciones y alcance; la de mayor prioridad primero", () => {
    const r = ofertasVigentes(ctx(instantanea({ ofertas: [AMOR, ARETES] })));
    assert.equal(r.empty, false);
    assert.equal(r.channel, "retail");
    assert.equal(r.today, "28 de octubre de 2026");
    assert.deepEqual(
      r.offers.map((o) => [o.name, o.benefit, o.validity, o.conditions, o.applies_to]),
      [
        ["Aretes especiales", "precio especial de $79.000", "del 25 de octubre de 2026 al 31 de octubre de 2026", null, "1 producto seleccionado"],
        ["Amor y Amistad", "20% de descuento", "del 25 de octubre de 2026 al 31 de octubre de 2026", "Hasta agotar existencias.", "toda la tienda"],
      ],
    );
    assert.equal(r.offers[1].description, "Temporada de regalos.");
    assert.match(r.note, /Cita el beneficio/);
  });

  it("sin ofertas vigentes: empty true y una nota que permite decirlo sin inventar", () => {
    const r = ofertasVigentes(ctx());
    assert.deepEqual([r.empty, r.offers], [true, []]);
    assert.match(r.note, /No hay ofertas vigentes/);
  });

  it("CONTRATO DE VIGENCIA: una oferta vencida o programada no existe (el reloj es el del backend, hora de Bogotá, hasta el último minuto del último día)", () => {
    const snap = instantanea({ ofertas: [AMOR] });
    assert.equal(ofertasVigentes(ctx(snap, "retail", Date.parse("2026-10-31T23:59:00-05:00"))).empty, false);
    assert.equal(ofertasVigentes(ctx(snap, "retail", Date.parse("2026-11-01T00:00:00-05:00"))).empty, true, "vencida");
    assert.equal(ofertasVigentes(ctx(snap, "retail", Date.parse("2026-10-24T23:59:00-05:00"))).empty, true, "programada");
  });

  it("CONTRATO DE MODALIDAD: el detal solo recibe ofertas detal o ambas; el mayorista, mayorista o ambas (y con el beneficio de SU canal)", () => {
    const detal = publicada("detal", oferta({ nombre: "Solo detal", modalidad: "detal", alcance: { todos: true, referencias: [], categorias: [] } }));
    const mayor = publicada("mayor", oferta({ nombre: "Solo mayor", modalidad: "mayorista", alcance: { todos: true, referencias: [], categorias: [] } }));
    const snap = instantanea({ ofertas: [detal, mayor, ARETES] });
    assert.deepEqual(ofertasVigentes(ctx(snap, "retail")).offers.map((o) => o.name), ["Aretes especiales", "Solo detal"]);
    const delMayorista = ofertasVigentes(ctx(snap, "wholesale")).offers;
    assert.deepEqual(delMayorista.map((o) => o.name), ["Aretes especiales", "Solo mayor"]);
    assert.equal(delMayorista[0].benefit, "precio especial de $55.000", "el beneficio es el del canal del cliente");
    assert.ok(!JSON.stringify(ofertasVigentes(ctx(snap, "retail"))).includes("Solo mayor"));
  });

  it("CONTRATO DE CAMPAÑA: una oferta de una campaña inactiva, vencida o inexistente no existe; con la campaña activa, sí", () => {
    const deCampana = publicada("navidad-oferta", oferta({ nombre: "Navidad 15%", campana: "navidad", alcance: { todos: true, referencias: [], categorias: [] } }));
    const activa = publicada("navidad", campana({ nombre: "Navidad" }));
    const vencida = publicada("navidad", campana({ nombre: "Navidad", vigencia: { desde: "2026-09-01", hasta: "2026-09-30" } }));
    assert.deepEqual(ofertasVigentes(ctx(instantanea({ ofertas: [deCampana], campanas: [activa] }))).offers.map((o) => o.name), ["Navidad 15%"]);
    assert.equal(ofertasVigentes(ctx(instantanea({ ofertas: [deCampana], campanas: [vencida] }))).empty, true);
    assert.equal(ofertasVigentes(ctx(instantanea({ ofertas: [deCampana] }))).empty, true, "la campaña no existe");
  });

  it("por categoría: solo las que cubren esa categoría completa (o toda la tienda); una categoría que no existe lo dice", () => {
    const deAretes = publicada("cat-aretes", oferta({ nombre: "Aretes 10%", beneficio: { tipo: "porcentaje", valor: 10 }, alcance: { todos: false, referencias: [], categorias: [CAT_ARETES] } }));
    const deDijes = publicada("cat-dijes", oferta({ nombre: "Dijes 5%", beneficio: { tipo: "porcentaje", valor: 5 }, alcance: { todos: false, referencias: [], categorias: [CAT_DIJES] } }));
    const snap = instantanea({ ofertas: [deAretes, deDijes, AMOR] });
    const r = ofertasVigentes(ctx(snap), { categoria: { id: CAT_ARETES, nombre: "Aretes" } });
    assert.deepEqual(r.offers.map((o) => o.name), ["Amor y Amistad", "Aretes 10%"]);
    assert.deepEqual(r.category, { name: "Aretes", found: true });
    const sin = ofertasVigentes(ctx(snap), { categoria: { id: null, nombre: "Relojes" } });
    assert.deepEqual([sin.empty, sin.offers, sin.category], [true, [], { name: "Relojes", found: false }]);
    assert.match(sin.note, /no tiene una categoría/);
  });

  it("el contrato de salida es estricto y no filtra ids, versiones ni fechas internas", () => {
    const r = ofertasVigentes(ctx(instantanea({ ofertas: [AMOR, ARETES] })));
    assert.doesNotThrow(() => consultaOfertasSchema.parse(r));
    assert.throws(() => consultaOfertasSchema.parse({ ...r, tenant_id: "x" }));
    assert.throws(() => consultaOfertasSchema.parse({ ...r, offers: [{ ...r.offers[0], id: "x" }] }));
    assert.ok(!REF_VISIBLE_NO.test(JSON.stringify(r)));
  });
});

describe("ofertaDeProducto — la ÚNICA oferta que aplica a un producto, con su precio", () => {
  const producto = { referencia: "DL-000001", nombre: "Aretes dorados", categoriaId: CAT_ARETES, precioLista: 100_000 };

  it("una sola oferta (las ofertas no se acumulan: gana la de mayor prioridad), con el precio de lista y el que paga hoy", () => {
    const r = ofertaDeProducto(ctx(instantanea({ ofertas: [AMOR, ARETES] })), producto);
    assert.equal(r.empty, false);
    assert.deepEqual(r.product, { reference: "DL-000001", name: "Aretes dorados", price: 79_000, list_price: 100_000 });
    assert.equal(r.offers.length, 1);
    assert.deepEqual([r.offers[0].name, r.offers[0].list_price, r.offers[0].price], ["Aretes especiales", 100_000, 79_000]);
    assert.match(r.note, /ÚNICA oferta/);
  });

  it("sin oferta que le aplique: empty true, su precio de lista y la advertencia de no inventar descuentos", () => {
    const r = ofertaDeProducto(ctx(instantanea({ ofertas: [ARETES] })), { ...producto, referencia: "DL-000009", categoriaId: null });
    assert.deepEqual([r.empty, r.offers, r.product?.price, r.product?.list_price], [true, [], 100_000, 100_000]);
    assert.match(r.note, /no tiene ninguna oferta vigente/);
  });

  it("un producto «a consultar» (sin precio) no recibe oferta ni precio inventados", () => {
    const r = ofertaDeProducto(ctx(instantanea({ ofertas: [AMOR] })), { ...producto, precioLista: null });
    assert.deepEqual([r.empty, r.product?.price, r.product?.list_price], [true, null, null]);
  });

  it("el canal manda: el mayorista paga el precio especial MAYORISTA y una oferta solo detal no le llega", () => {
    const soloDetal = publicada("detal", oferta({ nombre: "Solo detal", modalidad: "detal", beneficio: { tipo: "porcentaje", valor: 50 }, alcance: { todos: true, referencias: [], categorias: [] }, prioridad: 20 }));
    const r = ofertaDeProducto(ctx(instantanea({ ofertas: [soloDetal, ARETES] }), "wholesale"), { ...producto, precioLista: 70_000 });
    assert.deepEqual([r.offers[0].name, r.offers[0].price, r.product?.price], ["Aretes especiales", 55_000, 55_000]);
  });

  it("el contrato de salida es estricto", () => {
    const r = ofertaDeProducto(ctx(instantanea({ ofertas: [ARETES] })), producto);
    assert.doesNotThrow(() => consultaOfertasSchema.parse(r));
    assert.ok(!REF_VISIBLE_NO.test(JSON.stringify(r)));
  });
});

describe("combosVigentes — combos publicados, vigentes y aplicables, con disponibilidad y precios del backend", () => {
  const productos = (over: Record<string, Partial<ProductoParaCombo>> = {}): ReadonlyMap<string, ProductoParaCombo> =>
    new Map(
      [
        { referencia: "DL-000001", nombre: "Aretes dorados", activo: true, disponibilidad: "available" as const, maxCantidad: 7357, precioLista: 80_000 },
        { referencia: "DL-000002", nombre: "Cadena fina", activo: true, disponibilidad: "available" as const, maxCantidad: 7357, precioLista: 50_000 },
      ].map((p) => [p.referencia, { ...p, ...(over[p.referencia] ?? {}) }]),
    );
  const REGALO = publicada("regalo", combo({ nombre: "Regalo completo", descripcion: "Para sorprender.", precio: { detal: 150_000, mayorista: 110_000 }, condiciones: "Con asesora." }));

  it("componentes, cantidades, precio normal (lo que se paga hoy por separado), precio del combo, ahorro y vigencia: todo del backend", () => {
    const r = combosVigentes(ctx(instantanea({ combos: [REGALO] })), productos());
    assert.equal(r.empty, false);
    assert.deepEqual(
      r.combos.map((c) => [c.code, c.name, c.normal_price, c.combo_price, c.savings, c.available, c.unavailable_reason, c.validity, c.conditions]),
      [["regalo", "Regalo completo", 180_000, 150_000, 30_000, true, null, "del 25 de octubre de 2026 al 31 de octubre de 2026", "Con asesora."]],
    );
    assert.deepEqual(r.combos[0].components.map((k) => [k.reference, k.name, k.quantity, k.unit_price, k.available]), [["DL-000001", "Aretes dorados", 1, 80_000, true], ["DL-000002", "Cadena fina", 2, 50_000, true]]);
    assert.match(r.combos[0].how_to_buy, /no se compran desde el carrito/);
  });

  it("si un componente no alcanza o está agotado, el combo NO está disponible y dice por qué en palabras, sin cantidades de inventario", () => {
    const sinStock = combosVigentes(ctx(instantanea({ combos: [REGALO] })), productos({ "DL-000002": { maxCantidad: 1 } }));
    assert.deepEqual([sinStock.combos[0].available, sinStock.combos[0].unavailable_reason], [false, "no hay existencias suficientes de uno de los productos del combo por ahora"]);
    const agotado = combosVigentes(ctx(instantanea({ combos: [REGALO] })), productos({ "DL-000001": { disponibilidad: "sold_out", maxCantidad: 0 } }));
    assert.equal(agotado.combos[0].unavailable_reason, "uno de los productos del combo está agotado por ahora");
    for (const r of [sinStock, agotado, combosVigentes(ctx(instantanea({ combos: [REGALO] })), productos())]) assert.ok(!JSON.stringify(r).includes("7357"), "jamás el stock exacto");
  });

  it("los disponibles van primero y un combo que no está en lo publicado, vencido o de otra modalidad no existe", () => {
    const agotado = publicada("agotado", combo({ nombre: "Combo agotado", componentes: [{ referencia: "DL-000001", cantidad: 1 }, { referencia: "DL-000002", cantidad: 1 }], prioridad: 50 }));
    const vencido = publicada("vencido", combo({ nombre: "Combo vencido", vigencia: { desde: "2026-09-01", hasta: "2026-09-30" } }));
    const soloMayor = publicada("mayor", combo({ nombre: "Combo mayor", modalidad: "mayorista", precio: { mayorista: 90_000 } }));
    const p = productos({ "DL-000001": { disponibilidad: "sold_out" } });
    // `agotado` (prioridad alta) queda sin disponibilidad; REGALO también usa DL-000001, así que se arma otro con solo DL-000002.
    const ok = publicada("ok", combo({ nombre: "Combo ok", componentes: [{ referencia: "DL-000002", cantidad: 2 }] }));
    const r = combosVigentes(ctx(instantanea({ combos: [agotado, ok, vencido, soloMayor] })), p);
    assert.deepEqual(r.combos.map((c) => [c.name, c.available]), [["Combo ok", true], ["Combo agotado", false]]);
    assert.deepEqual(combosVigentes(ctx(instantanea({ combos: [soloMayor] }), "wholesale"), productos()).combos.map((c) => c.name), ["Combo mayor"]);
  });

  it("CONTRATO DE MODALIDAD: el cliente detal nunca recibe un combo mayorista (ni su precio) y viceversa", () => {
    const soloMayor = publicada("mayor", combo({ nombre: "Combo mayor", modalidad: "mayorista", precio: { mayorista: 90_000 } }));
    const soloDetal = publicada("detal", combo({ nombre: "Combo detal", modalidad: "detal", precio: { detal: 120_000 } }));
    const snap = instantanea({ combos: [soloMayor, soloDetal] });
    const detal = combosVigentes(ctx(snap, "retail"), productos());
    assert.deepEqual(detal.combos.map((c) => c.name), ["Combo detal"]);
    assert.ok(!JSON.stringify(detal).includes("90000") && !JSON.stringify(detal).includes("Combo mayor"));
    assert.deepEqual(combosVigentes(ctx(snap, "wholesale"), productos()).combos.map((c) => c.name), ["Combo mayor"]);
  });

  it("por código: solo ese combo; un código que no está vigente da empty true", () => {
    const otro = publicada("otro", combo({ nombre: "Otro combo", componentes: [{ referencia: "DL-000002", cantidad: 2 }] }));
    const snap = instantanea({ combos: [REGALO, otro] });
    assert.deepEqual(combosVigentes(ctx(snap), productos(), { code: "otro" }).combos.map((c) => c.name), ["Otro combo"]);
    const nada = combosVigentes(ctx(snap), productos(), { code: "no-existe" });
    assert.deepEqual([nada.empty, nada.combos], [true, []]);
    assert.deepEqual(referenciasDeCombosVigentes(ctx(snap)), ["DL-000002", "DL-000001"], "en el orden de los combos (prioridad, antigüedad, código) y sin repetir");
    assert.deepEqual(referenciasDeCombosVigentes(ctx(snap), { code: "otro" }), ["DL-000002"]);
  });

  it("sin combos vigentes: empty true; el contrato de salida es estricto y sin ids", () => {
    const vacio = combosVigentes(ctx(), productos());
    assert.deepEqual([vacio.empty, vacio.combos], [true, []]);
    assert.match(vacio.note, /No hay combos vigentes/);
    const r = combosVigentes(ctx(instantanea({ combos: [REGALO] })), productos());
    assert.doesNotThrow(() => consultaCombosSchema.parse(r));
    assert.throws(() => consultaCombosSchema.parse({ ...r, combos: [{ ...r.combos[0], id: "x" }] }));
    assert.ok(!REF_VISIBLE_NO.test(JSON.stringify(r)));
  });

  it("productoParaCombo toma el precio del canal del cliente (detal o mayorista) y la disponibilidad discreta", () => {
    const resuelto = {
      reference: "DL-000001",
      name: "Aretes",
      description: null,
      categoryId: null,
      categoryName: null,
      material: null,
      color: null,
      prices: { retail: 80_000, wholesale: 56_000 },
      stock: { tracked: true, units: 9 },
      status: "ACTIVE" as const,
      available: true,
      availability: "available" as const,
      maxQuantity: 9,
      image: null,
    };
    assert.equal(productoParaCombo(resuelto).precioLista, 80_000);
    assert.equal(productoParaCombo(resuelto, "retail").precioLista, 80_000);
    assert.equal(productoParaCombo(resuelto, "wholesale").precioLista, 56_000);
  });
});

describe("campanasVigentes — campañas activas y lo que incluyen", () => {
  it("solo las vigentes y de la modalidad del cliente, con sus ofertas y combos vigentes (por nombre)", () => {
    const navidad = publicada("navidad", campana({ nombre: "Navidad", descripcion: "Regalos de fin de año." }));
    const mayorista = publicada("mayor", campana({ nombre: "Solo mayoristas", modalidad: "mayorista" }));
    const vencida = publicada("vieja", campana({ nombre: "Black Friday", vigencia: { desde: "2026-09-01", hasta: "2026-09-30" } }));
    const o = publicada("navidad-15", oferta({ nombre: "Navidad 15%", beneficio: { tipo: "porcentaje", valor: 15 }, campana: "navidad", alcance: { todos: true, referencias: [], categorias: [] } }));
    const k = publicada("navidad-combo", combo({ nombre: "Combo Navidad", campana: "navidad" }));
    const snap = instantanea({ campanas: [navidad, mayorista, vencida], ofertas: [o], combos: [k] });
    const r = campanasVigentes(ctx(snap));
    assert.equal(r.empty, false);
    assert.deepEqual(r.campaigns, [{ name: "Navidad", description: "Regalos de fin de año.", validity: "del 25 de octubre de 2026 al 31 de octubre de 2026", offers: ["Navidad 15%: 15% de descuento"], combos: ["Combo Navidad"] }]);
    assert.deepEqual(campanasVigentes(ctx(snap, "wholesale")).campaigns.map((c) => c.name), ["Solo mayoristas", "Navidad"], "el mayorista recibe las suyas (y las de «ambas»)");
    assert.ok(!r.campaigns.some((c) => c.name === "Black Friday" || c.name === "Solo mayoristas"), "ni la vencida ni la de otra modalidad");
  });

  it("cada campaña lista SOLO sus ofertas y combos: lo que no tiene campaña (o es de otra campaña) no se cuelga de ella", () => {
    const todos = { todos: true, referencias: [], categorias: [] };
    const navidad = publicada("navidad", campana({ nombre: "Navidad" }));
    const amor = publicada("amor-camp", campana({ nombre: "Temporada de amor" }));
    const deNavidad = publicada("navidad-15", oferta({ nombre: "Navidad 15%", beneficio: { tipo: "porcentaje", valor: 15 }, campana: "navidad", alcance: todos }));
    const deAmor = publicada("amor-20", oferta({ nombre: "Amor 20%", beneficio: { tipo: "porcentaje", valor: 20 }, campana: "amor-camp", alcance: todos }));
    const suelta = publicada("suelta", oferta({ nombre: "Oferta suelta", alcance: todos }));
    const comboDeNavidad = publicada("combo-n", combo({ nombre: "Combo Navidad", campana: "navidad" }));
    const comboSuelto = publicada("combo-s", combo({ nombre: "Combo suelto" }));
    const r = campanasVigentes(ctx(instantanea({ campanas: [navidad, amor], ofertas: [deNavidad, deAmor, suelta], combos: [comboDeNavidad, comboSuelto] })));
    const por = Object.fromEntries(r.campaigns.map((c) => [c.name, c]));
    assert.deepEqual(por["Navidad"].offers, ["Navidad 15%: 15% de descuento"]);
    assert.deepEqual(por["Navidad"].combos, ["Combo Navidad"]);
    assert.deepEqual(por["Temporada de amor"].offers, ["Amor 20%: 20% de descuento"]);
    assert.deepEqual(por["Temporada de amor"].combos, []);
  });

  it("sin campañas vigentes: empty true y una nota que obliga a no inventar campañas de temporada", () => {
    const r = campanasVigentes(ctx(instantanea({ campanas: [publicada("vieja", campana({ nombre: "Black Friday", vigencia: { desde: "2026-09-01", hasta: "2026-09-30" } }))] })));
    assert.deepEqual([r.empty, r.campaigns], [true, []]);
    assert.match(r.note, /campañas de temporada/);
  });

  it("una campaña pausada o en borrador no existe en lo publicado, y el contrato de salida es estricto y sin ids", () => {
    const r = campanasVigentes(ctx(instantanea({ campanas: [publicada("navidad", campana({ nombre: "Navidad" }))] })));
    assert.doesNotThrow(() => consultaCampanasSchema.parse(r));
    assert.throws(() => consultaCampanasSchema.parse({ ...r, campaigns: [{ ...r.campaigns[0], id: "x" }] }));
    assert.ok(!REF_VISIBLE_NO.test(JSON.stringify(r)));
    assert.equal(campanasVigentes(ctx(instantanea())).empty, true);
  });
});

describe("contenidoComercial — información del negocio por tema, con las variables resueltas", () => {
  const GARANTIA = publicada("garantia", contenido({ tema: "garantias", titulo: "¿Tienen garantía?", texto: "Sí: 30 días contra defectos de fábrica.", orden: 1 }));
  const MAYOR_TODOS = publicada("mayor-info", contenido({ tema: "mayoristas", audiencia: "todos", titulo: "¿Cuál es la compra inicial mayorista?", texto: "La compra inicial mayorista parte desde {{minimo_mayorista}}." }));
  const MAYOR_SOLO = publicada("mayor-solo", contenido({ tema: "mayoristas", audiencia: "mayorista", titulo: "Condiciones para mayoristas", texto: "Precios por volumen." }));

  it("entrega los textos del tema con sus cifras y las variables ya reemplazadas", () => {
    const r = contenidoComercial(ctx(instantanea({ contenidos: [GARANTIA, MAYOR_TODOS] })), "garantias");
    assert.deepEqual([r.topic, r.empty, r.incomplete], ["garantias", false, false]);
    assert.deepEqual(r.items, [{ title: "¿Tienen garantía?", text: "Sí: 30 días contra defectos de fábrica." }]);
    assert.deepEqual(contenidoComercial(ctx(instantanea({ contenidos: [MAYOR_TODOS] })), "mayoristas").items.map((i) => i.text), ["La compra inicial mayorista parte desde $750.000."]);
    assert.match(r.note, /OFICIAL/);
  });

  it("CONTRATO DE MODALIDAD: un texto solo para mayoristas jamás llega a un cliente detal; el informativo (para todos) sí", () => {
    const snap = instantanea({ contenidos: [MAYOR_TODOS, MAYOR_SOLO] });
    assert.deepEqual(contenidoComercial(ctx(snap, "retail"), "mayoristas").items.map((i) => i.title), ["¿Cuál es la compra inicial mayorista?"]);
    assert.deepEqual(contenidoComercial(ctx(snap, "wholesale"), "mayoristas").items.map((i) => i.title).sort(), ["Condiciones para mayoristas", "¿Cuál es la compra inicial mayorista?"].sort());
  });

  it("un tema sin contenido publicado: empty true (se dice con naturalidad y se ofrece una asesora, sin inventar)", () => {
    const r = contenidoComercial(ctx(instantanea({ contenidos: [GARANTIA] })), "devoluciones");
    assert.deepEqual([r.empty, r.items, r.incomplete], [true, [], false]);
    assert.match(r.note, /no tiene información publicada/);
  });

  it("un texto con una variable sin valor NO se entrega (nunca con las llaves ni con un valor inventado) y se avisa que hay más información", () => {
    const sinValor = contenidoComercial(ctx(instantanea({ contenidos: [MAYOR_TODOS] }), "retail", AHORA, {}), "mayoristas");
    assert.deepEqual([sinValor.empty, sinValor.incomplete, sinValor.items], [true, true, []]);
    assert.match(sinValor.note, /no se puede mostrar por ahora/);
    const parcial = contenidoComercial(ctx(instantanea({ contenidos: [MAYOR_TODOS, publicada("otro", contenido({ tema: "mayoristas", titulo: "Otro", texto: "Texto sin variables.", orden: 2 }))] }), "retail", AHORA, {}), "mayoristas");
    assert.deepEqual([parcial.empty, parcial.incomplete, parcial.items.map((i) => i.title)], [false, true, ["Otro"]]);
    assert.ok(!JSON.stringify(sinValor).includes("{{"));
  });

  it("un contenido fuera de su vigencia no se entrega; el orden es el de la administradora", () => {
    const vencido = publicada("vencido", contenido({ tema: "faq", titulo: "Vencido", texto: "No debe salir.", vigencia: { hasta: "2026-10-01" } }));
    const segundo = publicada("segundo", contenido({ tema: "faq", titulo: "Segundo", texto: "B", orden: 2 }));
    const primero = publicada("primero", contenido({ tema: "faq", titulo: "Primero", texto: "A", orden: 1 }));
    assert.deepEqual(contenidoComercial(ctx(instantanea({ contenidos: [segundo, vencido, primero] })), "faq").items.map((i) => i.title), ["Primero", "Segundo"]);
  });

  it("el contrato de salida es estricto y sin ids", () => {
    const r = contenidoComercial(ctx(instantanea({ contenidos: [GARANTIA] })), "garantias");
    assert.doesNotThrow(() => consultaContenidoSchema.parse(r));
    assert.throws(() => consultaContenidoSchema.parse({ ...r, items: [{ ...r.items[0], id: "x" }] }));
    assert.ok(!REF_VISIBLE_NO.test(JSON.stringify(r)));
  });
});

describe("aislamiento: una instantánea es de UN negocio; otro negocio con la suya no recibe nada ajeno", () => {
  it("el negocio B (instantánea vacía) no ve las ofertas, combos, campañas ni textos del A", () => {
    const a = instantanea({ ofertas: [AMOR], combos: [publicada("regalo", combo())], campanas: [publicada("navidad", campana())], contenidos: [publicada("g", contenido({ tema: "garantias" }))] });
    const b = instantanea({ tenantId: TENANT_B });
    assert.equal(ofertasVigentes(ctx(a)).empty, false);
    assert.equal(ofertasVigentes(ctx(b)).empty, true);
    assert.equal(combosVigentes(ctx(b), new Map()).empty, true);
    assert.equal(campanasVigentes(ctx(b)).empty, true);
    assert.equal(contenidoComercial(ctx(b), "garantias").empty, true);
  });
});
