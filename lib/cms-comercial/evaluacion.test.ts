/**
 * CMS comercial — EVALUACIÓN DETERMINISTA: los contratos de modalidad, vigencia, campaña, no-acumulación de ofertas, precio efectivo, combos y contenido.
 * Cada caso fija una regla del negocio; ninguno depende del orden en que lleguen los datos ni del reloj real.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Canal } from "@/lib/cms-comercial/contrato";
import {
  campanasActivas,
  combosActivos,
  contenidosPara,
  ofertasActivas,
  precioConBeneficio,
  precioEfectivo,
  preciosEfectivos,
  textoBeneficio,
  vistaCombo,
  vistaOferta,
  type ContextoEvaluacion,
  type ProductoParaCombo,
  type ProductoParaPrecio,
} from "@/lib/cms-comercial/evaluacion";
import type { Beneficio } from "@/lib/cms-comercial/esquemas";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";
import { AHORA, CAT_ARETES, CAT_DIJES, campana, combo, contenido, instantanea, oferta, publicada } from "@/lib/cms-comercial/testing/fixtures";

const ctx = (snap: InstantaneaCms, canal: Canal = "retail", ahora = AHORA): ContextoEvaluacion => ({ snap, canal, ahora });
const claves = (xs: readonly { clave: string }[]) => xs.map((x) => x.clave);
const producto = (over: Partial<ProductoParaPrecio> = {}): ProductoParaPrecio => ({ referencia: "DL-000001", categoriaId: CAT_ARETES, precioLista: 100000, ...over });

/** Baraja con una semilla fija: el resultado no puede depender del orden de llegada. */
function barajar<T>(xs: readonly T[], semilla: number): T[] {
  const a = [...xs];
  let s = semilla;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe("precioConBeneficio — porcentaje con redondeo al peso más cercano (mitades hacia arriba)", () => {
  const pct = (valor: number): Beneficio => ({ tipo: "porcentaje", valor });
  it("calcula y redondea sin errores de coma flotante", () => {
    assert.equal(precioConBeneficio(100000, pct(15), "retail"), 85000);
    assert.equal(precioConBeneficio(12345, pct(15), "retail"), 10493); // 10493,25
    assert.equal(precioConBeneficio(50, pct(15), "retail"), 43); // 42,5 → 43 (mitad hacia arriba)
    assert.equal(precioConBeneficio(3, pct(50), "retail"), 2); // 1,5 → 2
    assert.equal(precioConBeneficio(1000, pct(1), "retail"), 990);
    assert.equal(precioConBeneficio(1000, pct(90), "retail"), 100);
    assert.equal(precioConBeneficio(100, pct(1), "retail"), 99); // 99,5 → 99 (floor((9900+50)/100))
    assert.equal(precioConBeneficio(999999999, pct(33), "retail"), 669999999);
  });

  it("si el descuento no baja el precio (por el redondeo), la oferta no aplica", () => {
    assert.equal(precioConBeneficio(50, pct(1), "retail"), null); // 49,5 → 50
    assert.equal(precioConBeneficio(1, pct(50), "retail"), null);
  });

  it("usa el mismo porcentaje en detal y en mayorista", () => {
    assert.equal(precioConBeneficio(70000, pct(10), "wholesale"), 63000);
  });
});

describe("precioConBeneficio — monto fijo y precio especial por canal", () => {
  it("monto fijo: resta el valor del canal y exige que quede un precio positivo y menor", () => {
    const b: Beneficio = { tipo: "monto_fijo", detal: 5000, mayorista: 3000 };
    assert.equal(precioConBeneficio(100000, b, "retail"), 95000);
    assert.equal(precioConBeneficio(100000, b, "wholesale"), 97000);
    assert.equal(precioConBeneficio(5000, b, "retail"), null); // quedaría en 0
    assert.equal(precioConBeneficio(4000, b, "retail"), null); // quedaría negativo
    assert.equal(precioConBeneficio(5001, b, "retail"), 1);
  });

  it("monto fijo y precio especial sin el valor del canal NO aplican (nunca se usa el del otro canal)", () => {
    assert.equal(precioConBeneficio(100000, { tipo: "monto_fijo", detal: 5000 }, "wholesale"), null);
    assert.equal(precioConBeneficio(100000, { tipo: "precio_especial", mayorista: 50000 }, "retail"), null);
  });

  it("precio especial: debe ser MENOR que el de lista (si no, no es una oferta)", () => {
    const b: Beneficio = { tipo: "precio_especial", detal: 60000, mayorista: 45000 };
    assert.equal(precioConBeneficio(100000, b, "retail"), 60000);
    assert.equal(precioConBeneficio(70000, b, "wholesale"), 45000);
    assert.equal(precioConBeneficio(60000, b, "retail"), null); // igual
    assert.equal(precioConBeneficio(50000, b, "retail"), null); // sube el precio
  });

  it("un precio de lista inválido nunca produce un precio", () => {
    for (const lista of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(precioConBeneficio(lista, { tipo: "porcentaje", valor: 10 }, "retail"), null, String(lista));
  });

  it("textoBeneficio lo redacta el backend", () => {
    assert.equal(textoBeneficio({ tipo: "porcentaje", valor: 15 }, "retail"), "15% de descuento");
    assert.equal(textoBeneficio({ tipo: "monto_fijo", detal: 5000, mayorista: 3000 }, "wholesale"), "$3.000 de descuento");
    assert.equal(textoBeneficio({ tipo: "precio_especial", detal: 60000 }, "retail"), "precio especial de $60.000");
    assert.equal(textoBeneficio({ tipo: "precio_especial", detal: 60000 }, "wholesale"), "");
  });
});

describe("ofertasActivas — MODALIDAD (detal nunca recibe lo mayorista y viceversa)", () => {
  const snap = instantanea({
    ofertas: [publicada("para-detal", oferta({ modalidad: "detal" })), publicada("para-mayor", oferta({ modalidad: "mayorista" })), publicada("para-ambas", oferta({ modalidad: "ambas" }))],
  });

  it("cliente detal: detal y ambas; cliente mayorista: mayorista y ambas", () => {
    assert.deepEqual(claves(ofertasActivas(ctx(snap, "retail"))).sort(), ["para-ambas", "para-detal"]);
    assert.deepEqual(claves(ofertasActivas(ctx(snap, "wholesale"))).sort(), ["para-ambas", "para-mayor"]);
  });

  it("lo mismo vale para combos y campañas", () => {
    const s = instantanea({
      combos: [publicada("c-detal", combo({ modalidad: "detal", precio: { detal: 1000 } })), publicada("c-mayor", combo({ modalidad: "mayorista", precio: { mayorista: 800 } }))],
      campanas: [publicada("k-detal", campana({ modalidad: "detal" })), publicada("k-mayor", campana({ modalidad: "mayorista" }))],
    });
    assert.deepEqual(claves(combosActivos(ctx(s, "retail"))), ["c-detal"]);
    assert.deepEqual(claves(combosActivos(ctx(s, "wholesale"))), ["c-mayor"]);
    assert.deepEqual(claves(campanasActivas(ctx(s, "retail"))), ["k-detal"]);
    assert.deepEqual(claves(campanasActivas(ctx(s, "wholesale"))), ["k-mayor"]);
  });
});

describe("ofertasActivas — VIGENCIA (hora de Bogotá, inicio inclusivo, fin exclusivo)", () => {
  const snap = instantanea({ ofertas: [publicada("o", oferta())] });
  const en = (iso: string) => claves(ofertasActivas(ctx(snap, "retail", Date.parse(iso))));

  it("antes de empezar no vale; al instante de empezar vale", () => {
    assert.deepEqual(en("2026-10-25T04:59:59.999Z"), []);
    assert.deepEqual(en("2026-10-25T05:00:00.000Z"), ["o"]);
  });

  it("vale durante todo el último día y deja de valer en el instante exacto del fin", () => {
    assert.deepEqual(en("2026-11-01T04:59:59.999Z"), ["o"]);
    assert.deepEqual(en("2026-11-01T05:00:00.000Z"), []);
    assert.deepEqual(en("2027-03-01T00:00:00.000Z"), []);
  });

  it("una oferta con vigencia ilegible o invertida jamás vale", () => {
    const rota = instantanea({
      ofertas: [publicada("mala-fecha", oferta({ vigencia: { desde: "2026-02-30", hasta: "2026-10-31" } })), publicada("invertida", oferta({ vigencia: { desde: "2026-10-31", hasta: "2026-10-25" } }))],
    });
    assert.deepEqual(ofertasActivas(ctx(rota)), []);
  });
});

describe("CAMPAÑA — un elemento de una campaña inactiva no influye", () => {
  const conCampana = (campanas: InstantaneaCms["campanas"]) => instantanea({ campanas, ofertas: [publicada("o", oferta({ campana: "navidad" }))], combos: [publicada("c", combo({ campana: "navidad" }))] });
  const activos = (s: InstantaneaCms, canal: Canal = "retail") => [...claves(ofertasActivas(ctx(s, canal))), ...claves(combosActivos(ctx(s, canal)))].sort();

  it("campaña activa: sus ofertas y combos valen", () => assert.deepEqual(activos(conCampana([publicada("navidad", campana())])), ["c", "o"]));
  it("campaña inexistente (nunca publicada, pausada o archivada): no valen", () => assert.deepEqual(activos(conCampana([])), []));
  it("campaña vencida: no valen", () => assert.deepEqual(activos(conCampana([publicada("navidad", campana({ vigencia: { desde: "2026-09-01", hasta: "2026-09-30" } }))])), []));
  it("campaña programada (aún no empieza): no valen", () => assert.deepEqual(activos(conCampana([publicada("navidad", campana({ vigencia: { desde: "2026-11-15", hasta: "2026-11-30" } }))])), []));

  it("campaña de otra modalidad: no valen para ese canal, sí para el suyo", () => {
    const s = conCampana([publicada("navidad", campana({ modalidad: "mayorista" }))]);
    assert.deepEqual(activos(s, "retail"), []);
    assert.deepEqual(activos(s, "wholesale"), ["c", "o"]);
  });

  it("una oferta detal dentro de una campaña mayorista no vale en ningún canal", () => {
    const s = instantanea({ campanas: [publicada("navidad", campana({ modalidad: "mayorista" }))], ofertas: [publicada("o", oferta({ modalidad: "detal", campana: "navidad" }))] });
    assert.deepEqual(ofertasActivas(ctx(s, "retail")), []);
    assert.deepEqual(ofertasActivas(ctx(s, "wholesale")), []);
  });

  it("una oferta sin campaña vale por sí sola aunque haya campañas vencidas", () => {
    const s = instantanea({ campanas: [publicada("vieja", campana({ vigencia: { desde: "2026-01-01", hasta: "2026-01-31" } }))], ofertas: [publicada("suelta", oferta())] });
    assert.deepEqual(claves(ofertasActivas(ctx(s))), ["suelta"]);
  });

  it("las campañas activas salen por prioridad", () => {
    const s = instantanea({ campanas: [publicada("baja", campana({ prioridad: 1 })), publicada("alta", campana({ prioridad: 9 })), publicada("media", campana({ prioridad: 5 }))] });
    assert.deepEqual(claves(campanasActivas(ctx(s))), ["alta", "media", "baja"]);
  });
});

describe("precioEfectivo — sin oferta es EXACTAMENTE el precio de lista", () => {
  it("sin ofertas publicadas", () => {
    const r = precioEfectivo(ctx(instantanea()), producto());
    assert.deepEqual(r, { precioLista: 100000, precioFinal: 100000, oferta: null });
  });

  it("producto sin precio («a consultar»): ninguna oferta inventa uno", () => {
    const s = instantanea({ ofertas: [publicada("o", oferta({ alcance: { todos: true, referencias: [], categorias: [] } }))] });
    assert.deepEqual(precioEfectivo(ctx(s), producto({ precioLista: null })), { precioLista: null, precioFinal: null, oferta: null });
  });

  it("una oferta que no alcanza al producto lo deja a precio de lista", () => {
    const s = instantanea({ ofertas: [publicada("o", oferta({ alcance: { todos: false, referencias: ["DL-000999"], categorias: [CAT_DIJES] } }))] });
    assert.equal(precioEfectivo(ctx(s), producto()).oferta, null);
    assert.equal(precioEfectivo(ctx(s), producto({ categoriaId: null })).oferta, null);
  });
});

describe("precioEfectivo — alcance, aplicación y datos de la oferta aplicada", () => {
  const una = (alcance: { todos: boolean; referencias: string[]; categorias: string[] }) => instantanea({ ofertas: [publicada("o", oferta({ alcance, nombre: "Amor y amistad", condiciones: "No acumulable.", beneficio: { tipo: "porcentaje", valor: 20 } }))] });

  it("aplica por referencia, por categoría o a toda la tienda", () => {
    for (const alcance of [{ todos: false, referencias: ["DL-000001"], categorias: [] }, { todos: false, referencias: [], categorias: [CAT_ARETES] }, { todos: true, referencias: [], categorias: [] }]) {
      const r = precioEfectivo(ctx(una(alcance)), producto());
      assert.equal(r.precioFinal, 80000, JSON.stringify(alcance));
      assert.equal(r.precioLista, 100000);
    }
  });

  it("devuelve todo lo que hace falta para explicar el cobro", () => {
    const r = precioEfectivo(ctx(una({ todos: true, referencias: [], categorias: [] })), producto());
    assert.ok(r.oferta);
    assert.equal(r.oferta.clave, "o");
    assert.equal(r.oferta.nombre, "Amor y amistad");
    assert.equal(r.oferta.precioLista, 100000);
    assert.equal(r.oferta.precioFinal, 80000);
    assert.equal(r.oferta.ahorro, 20000);
    assert.equal(r.oferta.textoBeneficio, "20% de descuento");
    assert.equal(r.oferta.textoVigencia, "del 25 de octubre de 2026 al 31 de octubre de 2026");
    assert.equal(r.oferta.condiciones, "No acumulable.");
    assert.equal(r.oferta.version, 1);
  });

  it("al terminar la vigencia el precio vuelve al de lista en el instante exacto", () => {
    const s = una({ todos: true, referencias: [], categorias: [] });
    assert.equal(precioEfectivo(ctx(s, "retail", Date.parse("2026-11-01T04:59:59.999Z")), producto()).precioFinal, 80000);
    assert.equal(precioEfectivo(ctx(s, "retail", Date.parse("2026-11-01T05:00:00.000Z")), producto()).precioFinal, 100000);
  });
});

describe("precioEfectivo — las ofertas NO se acumulan: gana UNA", () => {
  const productoUno = producto();
  const dos = (a: Partial<ReturnType<typeof oferta>>, b: Partial<ReturnType<typeof oferta>>, extraA = {}, extraB = {}) =>
    instantanea({ ofertas: [publicada("a", oferta({ alcance: { todos: true, referencias: [], categorias: [] }, ...a }), extraA), publicada("b", oferta({ alcance: { todos: true, referencias: [], categorias: [] }, ...b }), extraB)] });

  it("10% + 20% sobre el mismo producto = 20% (80.000), nunca 28% (72.000)", () => {
    const r = precioEfectivo(ctx(dos({ beneficio: { tipo: "porcentaje", valor: 10 } }, { beneficio: { tipo: "porcentaje", valor: 20 } })), productoUno);
    assert.equal(r.precioFinal, 80000);
    assert.equal(r.oferta?.clave, "b");
  });

  it("la de MAYOR PRIORIDAD gana aunque el precio sea peor para el cliente", () => {
    const r = precioEfectivo(ctx(dos({ prioridad: 10, beneficio: { tipo: "porcentaje", valor: 5 } }, { prioridad: 1, beneficio: { tipo: "porcentaje", valor: 50 } })), productoUno);
    assert.equal(r.oferta?.clave, "a");
    assert.equal(r.precioFinal, 95000);
  });

  it("en empate de prioridad gana la que deja el MEJOR PRECIO al cliente", () => {
    const r = precioEfectivo(ctx(dos({ prioridad: 5, beneficio: { tipo: "porcentaje", valor: 10 } }, { prioridad: 5, beneficio: { tipo: "porcentaje", valor: 20 } })), productoUno);
    assert.equal(r.oferta?.clave, "b");
  });

  it("en empate de prioridad y de precio gana la MÁS ANTIGUA, aunque su código sea alfabéticamente posterior", () => {
    const s = instantanea({
      ofertas: [
        publicada("alfa", oferta({ prioridad: 5, alcance: { todos: true, referencias: [], categorias: [] } }), { creadaAt: "2026-10-05T00:00:00.000Z" }),
        publicada("zeta", oferta({ prioridad: 5, alcance: { todos: true, referencias: [], categorias: [] } }), { creadaAt: "2026-10-02T00:00:00.000Z" }),
      ],
    });
    assert.equal(precioEfectivo(ctx(s), productoUno).oferta?.clave, "zeta");
  });

  it("si todo empata, el código en orden alfabético decide (resultado total y estable)", () => {
    const s = instantanea({ ofertas: [publicada("beta", oferta({ alcance: { todos: true, referencias: [], categorias: [] } })), publicada("alfa", oferta({ alcance: { todos: true, referencias: [], categorias: [] } }))] });
    assert.equal(precioEfectivo(ctx(s), productoUno).oferta?.clave, "alfa");
  });

  it("el resultado NO depende del orden en que lleguen las ofertas", () => {
    const todas = [
      publicada("o1", oferta({ prioridad: 3, beneficio: { tipo: "porcentaje", valor: 10 }, alcance: { todos: true, referencias: [], categorias: [] } })),
      publicada("o2", oferta({ prioridad: 3, beneficio: { tipo: "porcentaje", valor: 25 }, alcance: { todos: true, referencias: [], categorias: [] } })),
      publicada("o3", oferta({ prioridad: 1, beneficio: { tipo: "porcentaje", valor: 60 }, alcance: { todos: true, referencias: [], categorias: [] } })),
      publicada("o4", oferta({ prioridad: 3, beneficio: { tipo: "porcentaje", valor: 25 }, alcance: { todos: true, referencias: [], categorias: [] } }), { creadaAt: "2026-09-01T00:00:00.000Z" }),
    ];
    const esperado = precioEfectivo(ctx(instantanea({ ofertas: todas })), productoUno).oferta?.clave;
    assert.equal(esperado, "o4");
    for (let semilla = 1; semilla <= 12; semilla++) assert.equal(precioEfectivo(ctx(instantanea({ ofertas: barajar(todas, semilla) })), productoUno).oferta?.clave, esperado, `semilla ${semilla}`);
  });

  it("una oferta que no mejora el precio se ignora y gana la siguiente que sí lo mejora", () => {
    const s = instantanea({
      ofertas: [
        publicada("inutil", oferta({ prioridad: 9, beneficio: { tipo: "precio_especial", detal: 120000, mayorista: 120000 }, alcance: { todos: true, referencias: [], categorias: [] } })),
        publicada("buena", oferta({ prioridad: 1, beneficio: { tipo: "porcentaje", valor: 10 }, alcance: { todos: true, referencias: [], categorias: [] } })),
      ],
    });
    const r = precioEfectivo(ctx(s), productoUno);
    assert.equal(r.oferta?.clave, "buena");
    assert.equal(r.precioFinal, 90000);
  });
});

describe("precioEfectivo — AISLAMIENTO detal / mayorista", () => {
  const snap = instantanea({
    ofertas: [
      publicada("solo-detal", oferta({ modalidad: "detal", beneficio: { tipo: "porcentaje", valor: 20 }, alcance: { todos: true, referencias: [], categorias: [] } })),
      publicada("solo-mayor", oferta({ modalidad: "mayorista", beneficio: { tipo: "porcentaje", valor: 30 }, alcance: { todos: true, referencias: [], categorias: [] } })),
    ],
  });
  const detal = producto({ precioLista: 100000 });
  const mayor = producto({ precioLista: 70000 });

  it("el cliente detal paga el precio detal con SU oferta; la mayorista no existe para él", () => {
    const r = precioEfectivo(ctx(snap, "retail"), detal);
    assert.equal(r.precioFinal, 80000);
    assert.equal(r.oferta?.clave, "solo-detal");
  });

  it("el cliente mayorista paga el precio mayorista con SU oferta; la detal no existe para él", () => {
    const r = precioEfectivo(ctx(snap, "wholesale"), mayor);
    assert.equal(r.precioFinal, 49000);
    assert.equal(r.oferta?.clave, "solo-mayor");
  });

  it("con SOLO la oferta de otro canal, el cliente queda a su precio de lista", () => {
    const soloDetal = instantanea({ ofertas: [snap.ofertas[0]] });
    const soloMayor = instantanea({ ofertas: [snap.ofertas[1]] });
    assert.equal(precioEfectivo(ctx(soloDetal, "wholesale"), mayor).precioFinal, 70000);
    assert.equal(precioEfectivo(ctx(soloMayor, "retail"), detal).precioFinal, 100000);
  });

  it("una oferta «ambas» con valores por canal usa el de cada uno", () => {
    const s = instantanea({ ofertas: [publicada("ambas", oferta({ modalidad: "ambas", beneficio: { tipo: "precio_especial", detal: 60000, mayorista: 45000 }, alcance: { todos: true, referencias: [], categorias: [] } }))] });
    assert.equal(precioEfectivo(ctx(s, "retail"), detal).precioFinal, 60000);
    assert.equal(precioEfectivo(ctx(s, "wholesale"), mayor).precioFinal, 45000);
  });
});

describe("preciosEfectivos (lote)", () => {
  it("da el mismo resultado que evaluar uno por uno", () => {
    const s = instantanea({ ofertas: [publicada("o", oferta({ alcance: { todos: false, referencias: ["DL-000002"], categorias: [] } }))] });
    const productos = [producto({ referencia: "DL-000001" }), producto({ referencia: "DL-000002", precioLista: 50000 }), producto({ referencia: "DL-000003", precioLista: null })];
    const lote = preciosEfectivos(ctx(s), productos);
    for (const p of productos) assert.deepEqual(lote.get(p.referencia), precioEfectivo(ctx(s), p));
    assert.equal(lote.get("DL-000002")?.precioFinal, 40000);
    assert.equal(lote.get("DL-000001")?.precioFinal, 100000);
  });
});

describe("vistaOferta", () => {
  it("resume la oferta sin ids internos", () => {
    const o = publicada("amor", oferta({ nombre: "Amor", descripcion: "Para regalar", condiciones: "Hasta agotar.", alcance: { todos: false, referencias: ["DL-000001", "DL-000002"], categorias: [CAT_ARETES] }, prioridad: 4 }));
    const v = vistaOferta(ctx(instantanea()), o);
    assert.deepEqual(v, {
      clave: "amor",
      nombre: "Amor",
      descripcion: "Para regalar",
      textoBeneficio: "20% de descuento",
      vigencia: { desde: "2026-10-25", hasta: "2026-10-31" },
      textoVigencia: "del 25 de octubre de 2026 al 31 de octubre de 2026",
      condiciones: "Hasta agotar.",
      alcance: { todos: false, productos: 2, categorias: 1 },
      prioridad: 4,
      version: 1,
    });
    assert.equal(JSON.stringify(v).includes(o.id), false);
  });
});

describe("vistaCombo — precio y disponibilidad los calcula el backend", () => {
  const catalogo = (over: Record<string, Partial<ProductoParaCombo>> = {}): Map<string, ProductoParaCombo> =>
    new Map(
      (
        [
          ["DL-000001", { referencia: "DL-000001", nombre: "Aretes", activo: true, disponibilidad: "available", maxCantidad: 10, precioLista: 40000 }],
          ["DL-000002", { referencia: "DL-000002", nombre: "Cadena", activo: true, disponibilidad: "available", maxCantidad: 10, precioLista: 50000 }],
        ] as Array<[string, ProductoParaCombo]>
      ).map(([k, v]) => [k, { ...v, ...(over[k] ?? {}) }]),
    );
  const unCombo = (c = combo()) => {
    const pub = publicada("regalo", c);
    return { pub, snap: instantanea({ combos: [pub] }) };
  };

  it("precio normal = suma de componentes × cantidad; ahorro = normal − combo", () => {
    const { pub, snap } = unCombo(); // 1×40.000 + 2×50.000 = 140.000; combo detal 100.000
    const v = vistaCombo(ctx(snap, "retail"), pub, catalogo());
    assert.ok(v);
    assert.equal(v.precioNormal, 140000);
    assert.equal(v.precioCombo, 100000);
    assert.equal(v.ahorro, 40000);
    assert.equal(v.disponible, true);
    assert.equal(v.motivoNoDisponible, null);
    assert.deepEqual(v.componentes.map((c) => [c.referencia, c.nombre, c.cantidad, c.precioUnitario, c.disponible]), [
      ["DL-000001", "Aretes", 1, 40000, true],
      ["DL-000002", "Cadena", 2, 50000, true],
    ]);
    assert.equal(v.textoVigencia, "del 25 de octubre de 2026 al 31 de octubre de 2026");
  });

  it("el cliente mayorista ve el precio de combo mayorista; uno solo-detal NO existe para él", () => {
    const { pub, snap } = unCombo();
    assert.equal(vistaCombo(ctx(snap, "wholesale"), pub, catalogo())?.precioCombo, 70000);
    const soloDetal = unCombo(combo({ modalidad: "detal", precio: { detal: 100000 } }));
    assert.equal(vistaCombo(ctx(soloDetal.snap, "wholesale"), soloDetal.pub, catalogo()), null);
    const soloMayor = unCombo(combo({ modalidad: "mayorista", precio: { mayorista: 70000 } }));
    assert.equal(vistaCombo(ctx(soloMayor.snap, "retail"), soloMayor.pub, catalogo()), null);
  });

  it("sin ahorro real (combo igual o más caro que por separado) no se anuncia ahorro", () => {
    const igual = unCombo(combo({ precio: { detal: 140000, mayorista: 70000 } }));
    assert.equal(vistaCombo(ctx(igual.snap), igual.pub, catalogo())?.ahorro, null);
    const caro = unCombo(combo({ precio: { detal: 150000, mayorista: 70000 } }));
    assert.equal(vistaCombo(ctx(caro.snap), caro.pub, catalogo())?.ahorro, null);
  });

  it("si un componente no tiene precio, el precio normal y el ahorro no se inventan", () => {
    const { pub, snap } = unCombo();
    const v = vistaCombo(ctx(snap), pub, catalogo({ "DL-000002": { precioLista: null } }));
    assert.equal(v?.precioNormal, null);
    assert.equal(v?.ahorro, null);
    assert.equal(v?.precioCombo, 100000);
  });

  it("disponible solo si CADA componente está activo, existe, no está agotado y alcanza para su cantidad", () => {
    const { pub, snap } = unCombo();
    const caso = (over: Record<string, Partial<ProductoParaCombo>>, quitar?: string) => {
      const c = catalogo(over);
      if (quitar) c.delete(quitar);
      return vistaCombo(ctx(snap), pub, c);
    };
    assert.equal(caso({ "DL-000001": { activo: false } })?.motivoNoDisponible, "componente_inactivo");
    assert.equal(caso({ "DL-000002": { disponibilidad: "sold_out", maxCantidad: 0 } })?.motivoNoDisponible, "componente_agotado");
    assert.equal(caso({ "DL-000002": { maxCantidad: 1 } })?.motivoNoDisponible, "stock_insuficiente"); // pide 2, hay 1
    assert.equal(caso({}, "DL-000001")?.motivoNoDisponible, "componente_inexistente");
    for (const v of [caso({ "DL-000001": { activo: false } }), caso({ "DL-000002": { maxCantidad: 1 } }), caso({}, "DL-000001")]) {
      assert.equal(v?.disponible, false);
      assert.equal(v?.unidadesDisponibles, 0);
    }
    assert.equal(caso({ "DL-000002": { disponibilidad: "low", maxCantidad: 2 } })?.disponible, true); // poco stock sigue disponible
  });

  it("unidades disponibles = el mínimo de combos que alcanza cada componente; null si el inventario no se controla", () => {
    const { pub, snap } = unCombo();
    assert.equal(vistaCombo(ctx(snap), pub, catalogo({ "DL-000001": { maxCantidad: 7 }, "DL-000002": { maxCantidad: 9 } }))?.unidadesDisponibles, 4); // min(7/1, floor(9/2))
    assert.equal(vistaCombo(ctx(snap), pub, catalogo({ "DL-000001": { maxCantidad: null }, "DL-000002": { maxCantidad: null } }))?.unidadesDisponibles, null);
    assert.equal(vistaCombo(ctx(snap), pub, catalogo({ "DL-000001": { maxCantidad: null }, "DL-000002": { maxCantidad: 5 } }))?.unidadesDisponibles, 2);
  });

  it("un combo vencido, programado o de una campaña inactiva no tiene vista", () => {
    const vencido = unCombo(combo({ vigencia: { desde: "2026-09-01", hasta: "2026-09-30" } }));
    assert.equal(vistaCombo(ctx(vencido.snap), vencido.pub, catalogo()), null);
    const programado = unCombo(combo({ vigencia: { desde: "2026-11-15", hasta: "2026-11-30" } }));
    assert.equal(vistaCombo(ctx(programado.snap), programado.pub, catalogo()), null);
    const huerfano = unCombo(combo({ campana: "no-existe" }));
    assert.equal(vistaCombo(ctx(huerfano.snap), huerfano.pub, catalogo()), null);
  });

  it("un combo que NO está en la instantánea (despublicado o pausado) no tiene vista aunque se lo pasen", () => {
    const { pub } = unCombo();
    assert.equal(vistaCombo(ctx(instantanea()), pub, catalogo()), null);
  });
});

describe("contenidosPara — audiencia, vigencia, tema y variables", () => {
  const valores = { minimo_mayorista: "$750.000" };
  const snap = instantanea({
    contenidos: [
      publicada("envios", contenido({ tema: "envios", titulo: "Envíos", texto: "Enviamos a todo el país.", orden: 2 })),
      publicada("para-detal", contenido({ tema: "general", audiencia: "detal", titulo: "Solo detal", texto: "Texto detal.", orden: 3 })),
      publicada("para-mayor", contenido({ tema: "mayoristas", audiencia: "mayorista", titulo: "Solo mayoristas", texto: "Texto mayorista.", orden: 1 })),
      publicada("inversion", contenido({ tema: "mayoristas", audiencia: "todos", titulo: "¿Cuál es la inversión inicial?", texto: "Parte desde {{minimo_mayorista}}.", orden: 1 })),
    ],
  });

  it("un contenido «mayorista» JAMÁS llega a un cliente detal (y el «detal» no llega al mayorista)", () => {
    assert.deepEqual(claves(contenidosPara(ctx(snap, "retail"), valores).items), ["inversion", "envios", "para-detal"]);
    assert.deepEqual(claves(contenidosPara(ctx(snap, "wholesale"), valores).items), ["inversion", "para-mayor", "envios"]);
  });

  it("filtra por tema y ordena por `orden` y título", () => {
    assert.deepEqual(claves(contenidosPara(ctx(snap, "wholesale"), valores, { tema: "mayoristas" }).items), ["inversion", "para-mayor"]);
    assert.deepEqual(contenidosPara(ctx(snap, "retail"), valores, { tema: "faq" }).items, []);
  });

  it("reemplaza las variables con los valores del negocio", () => {
    const r = contenidosPara(ctx(snap, "retail"), valores, { tema: "mayoristas" });
    assert.equal(r.items[0].texto, "Parte desde $750.000.");
    assert.equal(r.items[0].tema, "mayoristas");
  });

  it("si una variable no se puede resolver, el texto NO se entrega (ni con llaves ni inventado) y se informa", () => {
    const sinValor = contenidosPara(ctx(snap, "retail"), {}, { tema: "mayoristas" });
    assert.deepEqual(sinValor.items, []);
    assert.deepEqual(sinValor.descartados, [{ clave: "inversion", motivo: "variable_sin_valor", variables: ["minimo_mayorista"] }]);
    const rara = instantanea({ contenidos: [publicada("x", contenido({ texto: "Oro a {{precio_oro}}" })), publicada("y", contenido({ titulo: "Otro", texto: "Hola", orden: 5 }))] });
    const r = contenidosPara(ctx(rara), valores);
    assert.deepEqual(claves(r.items), ["y"]);
    assert.deepEqual(r.descartados, [{ clave: "x", motivo: "variable_desconocida", variables: ["precio_oro"] }]);
    assert.equal(JSON.stringify(r.items).includes("{{"), false);
  });

  it("respeta la vigencia del contenido (sin fechas = siempre)", () => {
    const s = instantanea({
      contenidos: [
        publicada("siempre", contenido({ titulo: "Siempre" })),
        publicada("vencido", contenido({ titulo: "Vencido", vigencia: { hasta: "2026-10-01" } })),
        publicada("futuro", contenido({ titulo: "Futuro", vigencia: { desde: "2026-12-01" } })),
        publicada("ahora", contenido({ titulo: "Ahora", vigencia: { desde: "2026-10-01", hasta: "2026-12-31" } })),
      ],
    });
    assert.deepEqual(claves(contenidosPara(ctx(s), valores).items).sort(), ["ahora", "siempre"]);
  });
});
