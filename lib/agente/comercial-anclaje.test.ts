/**
 * BLOQUE 29 · PR 5 — la guarda de anclaje comercial: lo que el modelo diga de ofertas, descuentos, porcentajes, combos, campañas, vigencias y cifras de políticas solo
 * sale si lo devuelto por las herramientas comerciales en ese turno lo respalda. Pruebas por tabla con evidencia REAL (las respuestas de las herramientas, armadas con
 * las mismas funciones de producción): lo respaldado pasa, lo inventado no, y lo que no afirma nada (preguntas, negaciones, condicionales) no cuenta.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addEvidence, checkGrounding, emptyEvidence, type Evidence } from "@/lib/agente/anclaje";
import { checkCommercialClaims, emptyComercialEvidence, registrarHechoComercial } from "@/lib/agente/comercial-anclaje";
import type { HerramientaComercial } from "@/lib/agente/nombres-herramientas";
import { campanasVigentes, combosVigentes, contenidoComercial, ofertaDeProducto, ofertasVigentes, type ContextoConsulta } from "@/lib/cms-comercial/consulta";
import type { ProductoParaCombo } from "@/lib/cms-comercial/evaluacion";
import type { PublicadaCms } from "@/lib/cms-comercial/publicado";
import { AHORA, campana, combo, contenido, instantanea, oferta, publicada } from "@/lib/cms-comercial/testing/fixtures";

// --- Mundo de prueba (los mismos fixtures y funciones que usa la herramienta real) -----------------------------------------------------------------------
const AMOR = publicada("amor", oferta({ nombre: "Amor y Amistad", descripcion: "Temporada de regalos.", alcance: { todos: true, referencias: [], categorias: [] }, condiciones: "Hasta agotar existencias.", prioridad: 5 }));
const ARETES = publicada("aretes", oferta({ nombre: "Aretes especiales", beneficio: { tipo: "precio_especial", detal: 79_000, mayorista: 55_000 }, alcance: { todos: false, referencias: ["DL-000001"], categorias: [] }, prioridad: 9 }));
const REGALO = publicada("regalo", combo({ nombre: "Regalo completo", precio: { detal: 150_000, mayorista: 110_000 }, condiciones: "Venta con asesora." }));
const NAVIDAD = publicada("navidad", campana({ nombre: "Navidad", descripcion: "Regalos de fin de año." }));
const NAVIDAD_OFERTA = publicada("navidad-15", oferta({ nombre: "Navidad 15%", beneficio: { tipo: "porcentaje", valor: 15 }, campana: "navidad", alcance: { todos: true, referencias: [], categorias: [] } }));
const GARANTIA = publicada("garantia", contenido({ tema: "garantias", titulo: "¿Tienen garantía?", texto: "Sí: 30 días contra defectos de fábrica. Para el cambio llévala con su empaque." }));
const MAYOR_INFO = publicada("mayor", contenido({ tema: "mayoristas", titulo: "Compra mayorista", texto: "La compra inicial mayorista parte desde {{minimo_mayorista}}." }));
const ENVIOS = publicada("envios", contenido({ tema: "envios", titulo: "¿Cuánto demora el envío?", texto: "Los envíos tardan de 2 a 3 días hábiles." }));

const PRODUCTOS: ReadonlyMap<string, ProductoParaCombo> = new Map(
  [
    { referencia: "DL-000001", nombre: "Aretes dorados", activo: true, disponibilidad: "available" as const, maxCantidad: 9, precioLista: 80_000 },
    { referencia: "DL-000002", nombre: "Cadena fina", activo: true, disponibilidad: "available" as const, maxCantidad: 9, precioLista: 50_000 },
  ].map((p) => [p.referencia, p]),
);

const ctx = (snap = instantanea(), canal: "retail" | "wholesale" = "retail"): ContextoConsulta => ({ snap, canal, ahora: AHORA, valores: { minimo_mayorista: "$750.000" } });
type Salida = [HerramientaComercial, Record<string, unknown>];

/** Evidencia de un turno: lo que devolvieron las herramientas, recogido por el MISMO camino que usa el runtime. */
function turno(canal: "retail" | "wholesale", ...salidas: Salida[]): Evidence {
  const ev = emptyEvidence();
  ev.comercial = emptyComercialEvidence(canal);
  for (const [tool, data] of salidas) {
    addEvidence(data, ev);
    registrarHechoComercial(ev.comercial, tool, data);
  }
  return ev;
}
const ofertas = (snap = instantanea({ ofertas: [AMOR, ARETES] }), canal: "retail" | "wholesale" = "retail"): Salida => ["consultar_ofertas", ofertasVigentes(ctx(snap, canal)) as unknown as Record<string, unknown>];
const ofertasVacias = (canal: "retail" | "wholesale" = "retail"): Salida => ["consultar_ofertas", ofertasVigentes(ctx(instantanea(), canal)) as unknown as Record<string, unknown>];
const ofertaProducto = (snap = instantanea({ ofertas: [AMOR, ARETES] })): Salida => ["consultar_ofertas", ofertaDeProducto(ctx(snap), { referencia: "DL-000001", nombre: "Aretes dorados", categoriaId: null, precioLista: 100_000 }) as unknown as Record<string, unknown>];
const sinOfertaProducto = (): Salida => ["consultar_ofertas", ofertaDeProducto(ctx(instantanea()), { referencia: "DL-000009", nombre: "Dije", categoriaId: null, precioLista: 40_000 }) as unknown as Record<string, unknown>];
const combos = (snap = instantanea({ combos: [REGALO] }), canal: "retail" | "wholesale" = "retail"): Salida => ["consultar_combos", combosVigentes(ctx(snap, canal), PRODUCTOS) as unknown as Record<string, unknown>];
const combosVacios = (): Salida => ["consultar_combos", combosVigentes(ctx(), PRODUCTOS) as unknown as Record<string, unknown>];
const campanas = (snap = instantanea({ campanas: [NAVIDAD], ofertas: [NAVIDAD_OFERTA] })): Salida => ["consultar_campanas", campanasVigentes(ctx(snap)) as unknown as Record<string, unknown>];
const campanasVacias = (): Salida => ["consultar_campanas", campanasVigentes(ctx()) as unknown as Record<string, unknown>];
const contenidoDe = (tema: Parameters<typeof contenidoComercial>[1], ...c: PublicadaCms<"contenido">[]): Salida => ["consultar_contenido_comercial", contenidoComercial(ctx(instantanea({ contenidos: c })), tema) as unknown as Record<string, unknown>];

/** Códigos comerciales (sin los de montos, referencias y demás: esos son de la guarda general). */
const codigos = (texto: string, ev: Evidence): string[] => checkGrounding(texto, ev).violations.filter((v) => v.kind === "commercial").map((v) => v.value);
const limpio = (texto: string, ev: Evidence) => assert.deepEqual(codigos(texto, ev), [], texto);
const sucio = (texto: string, ev: Evidence, esperado: RegExp) => {
  const c = codigos(texto, ev);
  assert.ok(c.some((x) => esperado.test(x)), `«${texto}» debía dar ${esperado} y dio [${c.join(", ")}]`);
};

describe("la guarda comercial no actúa sin herramientas comerciales", () => {
  it("sin `comercial` en la evidencia (el negocio no usa el CMS), nada de lo que diga el modelo se vigila: queda como siempre", () => {
    const ev = emptyEvidence();
    for (const t of ["Tenemos 30% de descuento en todo.", "No hay promociones.", "El combo Black Friday sale hasta el 30 de noviembre.", "La garantía es de 90 días."]) assert.deepEqual(codigos(t, ev), [], t);
  });

  it("checkCommercialClaims también devuelve [] con evidencia activa pero un texto sin afirmaciones comerciales", () => {
    const ev = turno("retail", ofertas());
    assert.deepEqual(checkCommercialClaims("Hola, con gusto te ayudo. ¿Qué producto buscas? 😊", ev.comercial!), []);
  });
});

describe("lo RESPALDADO por las herramientas sale sin observaciones", () => {
  it("ofertas: el beneficio, el nombre, la vigencia, las condiciones y los precios que devolvió el backend", () => {
    const ev = turno("retail", ofertas());
    limpio("¡Sí! Tenemos la oferta Amor y Amistad: 20% de descuento, del 25 de octubre de 2026 al 31 de octubre de 2026. Aplica hasta agotar existencias 😊", ev);
    limpio("Además hay una promoción especial: Aretes especiales con precio especial de $79.000.", ev);
    limpio("Tenemos 2 ofertas vigentes: Amor y Amistad (20%) y Aretes especiales.", ev);
    limpio("Es válida hasta el 31 de octubre.", ev);
  });

  it("un producto con oferta: el precio de lista, el que paga hoy y el nombre de la oferta", () => {
    const ev = turno("retail", ofertaProducto());
    limpio("Los aretes dorados están con la oferta Aretes especiales: antes $100.000 y ahora $79.000.", ev);
    limpio("Sí, ese producto tiene descuento: precio especial de $79.000.", ev);
  });

  it("combos: nombre, productos, precio y ahorro del backend", () => {
    const ev = turno("retail", combos());
    limpio("Tenemos el combo Regalo completo: cuesta $150.000 y te ahorras $30.000 frente a comprar todo por separado ($180.000).", ev);
    limpio("Los combos los cierra una asesora; ¿quieres que te comunique con una?", ev);
  });

  it("campañas: el nombre y lo que incluyen", () => {
    const ev = turno("retail", campanas());
    limpio("Estamos en la campaña Navidad: la oferta Navidad 15% tiene 15% de descuento.", ev);
    limpio("Para Navidad tenemos una promoción con 15% de descuento.", ev);
  });

  it("contenido oficial: plazos y cifras que trae el texto, incluidas las variables ya resueltas", () => {
    limpio("Sí, tienen garantía de 30 días contra defectos de fábrica.", turno("retail", contenidoDe("garantias", GARANTIA)));
    limpio("Los envíos tardan de 2 a 3 días hábiles.", turno("retail", contenidoDe("envios", ENVIOS)));
    limpio("La compra inicial mayorista parte desde $750.000.", turno("retail", contenidoDe("mayoristas", MAYOR_INFO)));
  });

  it("la ausencia se afirma solo con una lectura REAL que devolvió `empty: true`", () => {
    limpio("Por ahora no tenemos promociones vigentes.", turno("retail", ofertasVacias()));
    limpio("En este momento no hay descuentos.", turno("retail", ofertasVacias()));
    limpio("Por ahora no tenemos combos disponibles.", turno("retail", combosVacios()));
    limpio("No tenemos campañas activas ahora.", turno("retail", campanasVacias()));
    limpio("Ese producto no tiene descuento por ahora.", turno("retail", sinOfertaProducto()));
  });

  it("un producto con oferta en la vista del catálogo (search_products / get_product) respalda «tiene descuento» aunque no se llamara consultar_ofertas", () => {
    const ev = turno("retail");
    addEvidence({ status: "found", product: { reference: "DL-000001", name: "Aretes", unit_price: 80_000, list_price: 100_000, offer: { name: "Amor y Amistad", benefit: "20% de descuento", valid_until: "hasta el 31 de octubre de 2026", conditions: null } } }, ev);
    limpio("Ese producto tiene descuento: la oferta Amor y Amistad, 20% de descuento.", ev);
  });

  it("no se bloquea lo que no es afirmar: preguntas, saludos y mención de «promoción» al ofrecer ver más", () => {
    const ev = turno("retail", ofertas());
    limpio("¿Te interesa alguna de las promociones?", ev);
    limpio("Si quieres, te cuento más sobre la oferta Amor y Amistad.", ev);
  });
});

describe("lo INVENTADO no sale (cada código, con su caso)", () => {
  it("percent_unbacked: un porcentaje que ninguna herramienta devolvió (también escrito en palabras o con espacio)", () => {
    const ev = turno("retail", ofertas());
    sucio("Tenemos 30% de descuento en todo.", ev, /^percent_unbacked:30$/);
    sucio("Hay un 50 % de rebaja.", ev, /^percent_unbacked:50$/);
    sucio("Es un veinticinco por ciento menos.", ev, /^percent_unbacked:25$/);
    sucio("La promoción era del 50%", ev, /^percent_unbacked:50$/);
    sucio("Con la oferta Amor y Amistad tienes 25% de descuento.", ev, /^percent_unbacked:25$/);
  });

  it("percent_unbacked: el porcentaje que escribió el CLIENTE no lo respalda (nunca)", () => {
    const ev = turno("retail", ofertas());
    addEvidence({ nota: "ya está" }, ev);
    sucio("Claro, el 50% que me dices.", ev, /^percent_unbacked:50$/);
  });

  it("discount_unbacked: «tenemos descuentos / promociones / ofertas» sin ninguna oferta, combo o campaña respaldada", () => {
    for (const ev of [turno("retail"), turno("retail", ofertasVacias())]) {
      sucio("Sí, tenemos descuentos en toda la tienda.", ev, /^discount_unbacked$/);
      sucio("Hay promociones esta semana.", ev, /^discount_unbacked$/);
      sucio("Ese producto está en oferta.", ev, /^discount_unbacked$/);
      sucio("Estamos en liquidación.", ev, /^discount_unbacked$/);
    }
  });

  it("offer_unbacked: una oferta con un nombre que ninguna herramienta devolvió, o una promoción «2x1» sin respaldo", () => {
    const ev = turno("retail", ofertas());
    sucio("Tenemos la oferta Black Friday con precios increíbles.", ev, /^offer_unbacked:black friday$/);
    sucio("Aprovecha la promoción Día de la Madre.", ev, /^offer_unbacked:dia de la madre$/);
    sucio("Tenemos 2x1 en aretes.", ev, /^offer_unbacked:2x1$/);
    limpio("Aprovecha la oferta Amor y Amistad.", ev);
  });

  it("combo_unbacked: «tenemos combos» sin un combo respaldado, o con un nombre que no se devolvió", () => {
    sucio("Sí, tenemos combos de aretes y cadenas.", turno("retail"), /^combo_unbacked$/);
    sucio("Sí, tenemos combos.", turno("retail", combosVacios()), /^combo_unbacked$/);
    sucio("Te recomiendo el combo Regalo de Cumpleaños.", turno("retail", combos()), /^combo_unbacked:regalo de cumpleanos$/);
    limpio("Te recomiendo el combo Regalo completo.", turno("retail", combos()));
  });

  it("campaign_unbacked: una campaña o temporada que ninguna herramienta devolvió", () => {
    sucio("Estamos en campaña de Navidad.", turno("retail"), /^campaign_unbacked/);
    sucio("Tenemos promociones por Navidad.", turno("retail", ofertas()), /^campaign_unbacked:navidad$/);
    sucio("Para San Valentín hay descuentos especiales.", turno("retail", ofertas()), /^campaign_unbacked:san valentin$/);
    sucio("Hay una campaña vigente de Amor y Amistad.", turno("retail", campanasVacias()), /^campaign_unbacked/);
  });

  it("absence_unbacked: «no tenemos…» sin que la herramienta de ese tema haya devuelto `empty: true` en el turno", () => {
    sucio("Por ahora no tenemos promociones.", turno("retail"), /^absence_unbacked:offers$/);
    sucio("No hay descuentos disponibles.", turno("retail", ofertas()), /^absence_unbacked:offers$/);
    sucio("No tenemos combos.", turno("retail", ofertasVacias()), /^absence_unbacked:combos$/);
    sucio("Ahora no hay campañas.", turno("retail", combosVacios()), /^absence_unbacked:campaigns$/);
    // Ese producto no tiene descuento: respaldado solo con la lectura de ESE producto, no con una lista que sí trae ofertas.
    sucio("Ese producto no tiene descuento.", turno("retail", ofertas()), /^absence_unbacked:offers$/);
  });

  it("validity_unbacked: fechas, días y urgencias de una promoción que no están en lo devuelto", () => {
    const ev = turno("retail", ofertas());
    sucio("La oferta Amor y Amistad es válida hasta el 15 de noviembre.", ev, /^validity_unbacked:15 de noviembre$/);
    sucio("La promoción está hasta el 20.", ev, /^validity_unbacked:hasta el 20$/);
    sucio("Es una oferta solo por hoy.", ev, /^validity_unbacked:solo_por_hoy$/);
    sucio("El descuento vence mañana.", ev, /^validity_unbacked:vence_manana$/);
    sucio("Aprovecha, es por tiempo limitado, en estas promociones.", ev, /^validity_unbacked:por_tiempo_limitado$/);
    limpio("La oferta Amor y Amistad vence el 31 de octubre.", ev);
  });

  it("validity_unbacked: una fecha de «hasta» o de rango afirma una vigencia AUNQUE la oración no diga «promoción» (hallazgo de la evaluación con modelo adversario)", () => {
    const ev = turno("retail", ofertas());
    sucio("Vale hasta el 20 de noviembre.", ev, /^validity_unbacked:20 de noviembre$/);
    sucio("Dura hasta el 5 de diciembre de 2026.", ev, /^validity_unbacked:5 de diciembre$/);
    sucio("Estará del 1 de noviembre al 15 de noviembre.", ev, /^validity_unbacked:1 de noviembre$/);
    // La fecha VIEJA que el modelo recuerda de un turno anterior (la administradora ya la cambió) tampoco sale.
    const cambiada = publicada("amor", oferta({ nombre: "Amor y Amistad", alcance: { todos: true, referencias: [], categorias: [] }, vigencia: { desde: "2026-10-25", hasta: "2026-11-15" } }));
    const nueva = turno("retail", ofertas(instantanea({ ofertas: [cambiada] })));
    sucio("Vale hasta el 31 de octubre.", nueva, /^validity_unbacked:31 de octubre$/);
    limpio("Vale hasta el 15 de noviembre de 2026.", nueva);
    // Respaldada por la herramienta: sale.
    limpio("Vale hasta el 31 de octubre de 2026.", ev);
    limpio("Es del 25 de octubre de 2026 al 31 de octubre de 2026.", ev);
  });

  it("wholesale_leak: a un cliente DETAL, precio, descuento, combo o catálogo mayorista con cifra (la compra inicial sí se informa)", () => {
    const ev = turno("retail", contenidoDe("mayoristas", MAYOR_INFO));
    sucio("El precio mayorista de esos aretes es $60.000.", ev, /^wholesale_leak$/);
    sucio("Para mayoristas hay un descuento del 15% en el catálogo.", ev, /^(wholesale_leak|percent_unbacked)/);
    sucio("El combo mayorista cuesta $110.000.", ev, /^wholesale_leak$/);
    limpio("La compra inicial mayorista parte desde $750.000.", ev);
    limpio("Para ver precios mayoristas te comunico con una asesora.", ev);
  });

  it("policy_figure_unbacked: un plazo o duración de política que ningún texto devuelto contiene", () => {
    const ev = turno("retail", contenidoDe("garantias", GARANTIA));
    sucio("La garantía es de 90 días.", ev, /^policy_figure_unbacked:90_dia$/);
    sucio("Tienes 8 días para el cambio.", ev, /^policy_figure_unbacked:8_dia$/);
    sucio("Las devoluciones se aceptan hasta 15 días después.", ev, /^policy_figure_unbacked:15_dia$/);
    sucio("Separamos la mercancía por 3 días.", ev, /^policy_figure_unbacked:3_dia$/);
    sucio("El envío llega en 2 a 3 días hábiles.", turno("retail"), /^policy_figure_unbacked/);
    limpio("Tienes 30 días de garantía.", ev);
  });

  it("policy_figure_unbacked: con el motor de envíos activo, los tiempos de envío son de SU guarda (no se duplica)", () => {
    const ev = turno("retail");
    assert.ok(checkCommercialClaims("El envío llega en 3 días.", ev.comercial!).some((c) => c.startsWith("policy_figure_unbacked")));
    assert.deepEqual(checkCommercialClaims("El envío llega en 3 días.", ev.comercial!, { shippingGuardActive: true }), []);
  });
});

describe("lo que NO afirma nada no cuenta (preguntas, negaciones, condicionales)", () => {
  const ev = turno("retail");
  it("preguntas", () => {
    for (const t of ["¿Quieres ver las promociones?", "¿Buscas algún combo?", "¿Te interesa un descuento del 20%?", "¿Cuántos días tarda la garantía?"]) limpio(t, ev);
  });
  it("condicionales y deseos: «si hay promociones te aviso»", () => {
    for (const t of ["Si hay promociones, te aviso por aquí.", "Cuando tengamos combos nuevos te cuento.", "Ojalá haya descuentos pronto, te aviso."]) limpio(t, ev);
  });
  it("no saber no es afirmar que no existe: «no tengo información de promociones»", () => {
    limpio("No tengo información de promociones en este momento, ¿te comunico con una asesora?", ev);
    limpio("No tengo datos de combos ahora mismo; una asesora te los confirma.", ev);
  });
  it("una fecha SIN «hasta», rango ni vigencia no es una afirmación comercial: el regalo del cliente, su cumpleaños o la entrega de su pedido no se bloquean", () => {
    for (const t of ["¡Qué lindo! Para el 14 de febrero te recomiendo estos aretes.", "Tu cumpleaños es el 20 de noviembre, anotado.", "El pedido llega hasta el 20 de noviembre.", "Te lo entregamos el 3 de diciembre."]) limpio(t, ev);
  });
  it("hablar sin cifras ni nombres de lo que hace el negocio no se bloquea (sin cue comercial)", () => {
    for (const t of ["Con gusto te ayudo a elegir.", "Te muestro opciones de aretes dorados.", "El producto es de baño de oro."]) limpio(t, ev);
  });
});

describe("ajustes que salieron de la evaluación con Gemini real (falsos positivos y huecos con el modelo de verdad)", () => {
  it("un número que escribió el CLIENTE y que la frase NIEGA no se bloquea («no es del 50%»); afirmarlo, o esconderlo tras un «no» ajeno, sí", () => {
    const ev = turno("retail", ofertas());
    ev.customerNumbers.add(50);
    limpio("La oferta vigente es del 20%, no es del 50%.", ev);
    limpio("Lo siento, no puedo aplicar el 50% de descuento.", ev);
    limpio("Hoy no hay un 50% de descuento; la oferta vigente es de 20%.", ev);
    sucio("Sí, es del 50%.", ev, /^percent_unbacked:50$/);
    sucio("No te preocupes, tenemos 50% de descuento.", ev, /^percent_unbacked:50$/);
    sucio("No, tenemos 50% de descuento en todo.", ev, /^percent_unbacked:50$/);
    // Una cifra que el cliente NO escribió sigue sin salir aunque venga negada.
    sucio("No es del 40%, es del 25%.", ev, /^percent_unbacked:(40|25)$/);
  });

  it("«no tengo el historial / registro / antecedentes de promociones» es no saber, no afirmar que no existen", () => {
    for (const t of ["No tengo el historial de promociones de días anteriores.", "No tengo registro de ofertas de ayer.", "No tengo antecedentes de descuentos pasados."]) limpio(t, turno("retail", ofertas()));
  });

  it("negar un descuento CALIFICADO («adicional», «otros», «por pago de contado») no es afirmar que no existe ninguno, pero solo si la herramienta SE CONSULTÓ", () => {
    const con = turno("retail", ofertas());
    limpio("Por pago de contado no manejamos un descuento adicional.", con);
    limpio("No tenemos otros descuentos por ahora.", con);
    limpio("No hay descuentos extra para esa compra.", con);
    limpio("Por compras de volumen no hay descuento por cantidad.", con);
    const sin = turno("retail");
    sucio("No manejamos un descuento adicional.", sin, /^absence_unbacked:offers$/);
    sucio("No tenemos otros descuentos por ahora.", sin, /^absence_unbacked:offers$/);
    // «No hay descuentos» a secas sigue necesitando una lectura vacía, aunque haya ofertas.
    sucio("No hay descuentos.", con, /^absence_unbacked:offers$/);
  });

  it("«la campaña de Amor y Amistad» cuando una herramienta devolvió una oferta con ese nombre describe lo respaldado; una campaña con otro nombre (o sin nombre) sigue sin salir", () => {
    const ev = turno("retail", ofertas());
    limpio("Está vigente la oferta de la campaña Amor y Amistad: 20% de descuento.", ev);
    sucio("Estamos en la campaña Navidad con 20% de descuento.", ev, /^campaign_unbacked/);
    sucio("Tenemos una campaña especial.", ev, /^campaign_unbacked$/);
  });

  it("un condicional con porcentaje («si hay 30% de descuento te aviso») no afirma nada", () => {
    limpio("Si hay 30% de descuento te aviso por aquí.", turno("retail"));
    limpio("Cuando haya 15% de rebaja te escribo.", turno("retail"));
  });

  it("una palabra común con mayúscula tras «oferta» («las ofertas Vigentes») no es el nombre de una oferta", () => {
    limpio("Estas son las ofertas Vigentes de hoy.", turno("retail", ofertas()));
  });

  it("«sigue vigente» sin ninguna promoción, combo o campaña respaldada afirma que algo continúa, aunque no diga «promoción»", () => {
    sucio("Sí, todavía está vigente.", turno("retail"), /^discount_unbacked$/);
    sucio("Sigue vigente hasta fin de mes.", turno("retail"), /^discount_unbacked$/);
    limpio("Sí, todavía está vigente.", turno("retail", ofertas()));
  });

  it("la compra inicial / el mínimo mayorista SÍ se informa a un cliente detal aunque la frase hable de «valor» o «precio»; el precio mayorista de un producto, no", () => {
    const ev = turno("retail", contenidoDe("mayoristas", MAYOR_INFO));
    limpio("El valor de la compra inicial mayorista es $750.000.", ev);
    sucio("El valor mayorista de los aretes es $60.000.", ev, /^wholesale_leak$/);
  });
});

describe("el canal manda: el cliente MAYORISTA no recibe vigilancia de fuga y sus respaldos son los suyos", () => {
  it("a un mayorista se le puede informar de su propio precio mayorista (los respaldos del turno son los suyos)", () => {
    const ev = turno("wholesale", ofertas(instantanea({ ofertas: [ARETES] }), "wholesale"));
    limpio("Los aretes especiales están a precio especial de $55.000 para mayoristas.", ev);
    assert.ok(!checkCommercialClaims("El precio mayorista es $55.000.", ev.comercial!).includes("wholesale_leak"));
  });
});
