/**
 * La página «Mayoristas» de la tienda (pagina-mayoristas.ts): qué entradas del CMS la forman y, sobre todo, lo que NUNCA llega a ella. Es la misma regla que usa ARIA (contenidosPara): solo lo PUBLICADO,
 * vigente, aplicable al público de la tienda al detal y con todas sus variables resueltas. Lo escrito para mayoristas jamás se ve aquí, ni siquiera por su código.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paginaMayoristas, parrafosDe, TEMA_PAGINA_MAYORISTAS, type OpcionesPaginaMayoristas } from "@/lib/cms-comercial/pagina-mayoristas";
import type { VariablesNegocio } from "@/lib/cms-comercial/puertos";
import { AHORA, contenido, instantanea, publicada, VIGENCIA } from "@/lib/cms-comercial/testing/fixtures";

const NEGOCIO: VariablesNegocio = { variables: { minimo_mayorista: "$750.000" }, minimoMayorista: 750_000 };
const SIN_MINIMO: VariablesNegocio = { variables: {}, minimoMayorista: null };

const OPCIONES: OpcionesPaginaMayoristas = {
  intro: "venta-al-por-mayor",
  omitir: ["emprendimiento"],
  tambien: ["envios", "medios-de-pago", "garantias"],
};

const INTRO = publicada("venta-al-por-mayor", contenido({ tema: "mayoristas", titulo: "Venta al por mayor", texto: "Manejamos venta al por mayor. La compra inicial parte de {{minimo_mayorista}}, sujeta a condiciones vigentes.", orden: 0 }));
const EMPRENDIMIENTO = publicada("emprendimiento", contenido({ tema: "mayoristas", titulo: "Emprendimiento", texto: "Oriéntalo sobre las cuatro líneas y pregúntale su presupuesto.", orden: 5 }));
const COMO = publicada("como-compro", contenido({ tema: "mayoristas", titulo: "¿Cómo compro al por mayor?", texto: "Escríbenos por WhatsApp y elige «Compra por mayor».", orden: 10 }));
const MINIMO = publicada("compra-minima", contenido({ tema: "mayoristas", titulo: "¿Cuál es la compra mínima?", texto: "Parte de {{minimo_mayorista}}.", orden: 20 }));
const ENVIOS = publicada("envios", contenido({ tema: "envios", titulo: "Envíos", texto: "Sí hacemos envíos.", orden: 0 }));
const PAGOS = publicada("medios-de-pago", contenido({ tema: "pagos", titulo: "Medios de pago", texto: "Tarjeta y transferencia.", orden: 0 }));
const GARANTIAS = publicada("garantias", contenido({ tema: "garantias", titulo: "Garantías", texto: "Las confirma una asesora.", orden: 0 }));
const HORARIO = publicada("horario", contenido({ tema: "horarios", titulo: "Horario", texto: "De lunes a sábado.", orden: 0 }));
const SOLO_MAYORISTA = publicada("precios-mayoristas", contenido({ tema: "mayoristas", audiencia: "mayorista", titulo: "Lista de precios", texto: "Aquí van los precios mayoristas.", orden: 1 }));

const TODAS = [COMO, MINIMO, INTRO, EMPRENDIMIENTO, ENVIOS, PAGOS, GARANTIAS, HORARIO, SOLO_MAYORISTA];
const pagina = (contenidos = TODAS, negocio = NEGOCIO, opciones = OPCIONES, ahora = AHORA) => paginaMayoristas(instantanea({ contenidos }), negocio, ahora, opciones);
const titulos = (p: ReturnType<typeof pagina>) => p.preguntas.map((x) => x.titulo);

describe("página de mayoristas — qué la forma", () => {
  it("la introducción es la entrada que indica la tienda, con su variable resuelta, y no se repite entre las preguntas", () => {
    const p = pagina();
    assert.deepEqual(p.intro, { titulo: "Venta al por mayor", texto: "Manejamos venta al por mayor. La compra inicial parte de $750.000, sujeta a condiciones vigentes." });
    assert.ok(!p.preguntas.some((x) => x.clave === "venta-al-por-mayor"));
  });

  it("las preguntas son lo publicado con tema «Mayoristas», en el orden del CMS (por `orden`), con la variable ya resuelta", () => {
    const p = pagina();
    assert.deepEqual(p.preguntas.slice(0, 2).map((x) => [x.clave, x.titulo, x.texto]), [
      ["como-compro", "¿Cómo compro al por mayor?", "Escríbenos por WhatsApp y elige «Compra por mayor»."],
      ["compra-minima", "¿Cuál es la compra mínima?", "Parte de $750.000."],
    ]);
  });

  it("detrás van, en el orden que dice la tienda, las entradas de otros temas que enlaza (envíos, pagos, garantías); las demás no entran", () => {
    const p = pagina();
    assert.deepEqual(titulos(p), ["¿Cómo compro al por mayor?", "¿Cuál es la compra mínima?", "Envíos", "Medios de pago", "Garantías"]);
    assert.ok(!titulos(p).includes("Horario"), "un tema que la tienda no enlaza no aparece");
    assert.deepEqual(titulos(pagina(TODAS, NEGOCIO, { ...OPCIONES, tambien: ["garantias", "envios"] })).slice(2), ["Garantías", "Envíos"]);
  });

  it("lo que la tienda manda omitir no se muestra (un texto escrito como instrucción para ARIA no es para clientes), pero sigue en el CMS", () => {
    assert.ok(!pagina().preguntas.some((x) => x.clave === "emprendimiento"));
    assert.ok(pagina(TODAS, NEGOCIO, { ...OPCIONES, omitir: [] }).preguntas.some((x) => x.clave === "emprendimiento"), "sin la orden de omitir, entra como cualquier otra");
    assert.ok(!pagina(TODAS, NEGOCIO, { ...OPCIONES, omitir: ["emprendimiento", "garantias"] }).preguntas.some((x) => x.clave === "garantias"), "omitir también vale para las enlazadas");
  });

  it("una entrada enlazada que no está publicada, no existe o ya sale como pregunta no se duplica ni deja huecos", () => {
    const p = pagina([COMO, INTRO], NEGOCIO, { ...OPCIONES, tambien: ["envios", "no-existe", "como-compro", "venta-al-por-mayor"] });
    assert.deepEqual(p.preguntas.map((x) => x.clave), ["como-compro"]);
  });

  it("sin nada publicado la página no inventa nada: sin introducción ni preguntas", () => {
    assert.deepEqual(pagina([], NEGOCIO), { intro: null, preguntas: [] });
    assert.deepEqual(pagina([], SIN_MINIMO), { intro: null, preguntas: [] });
  });

  it("sin introducción indicada (o indicada pero no publicada) la introducción es null y la entrada, si existe, sigue siendo una pregunta del tema", () => {
    assert.equal(pagina(TODAS, NEGOCIO, { omitir: ["emprendimiento"] }).intro, null);
    assert.ok(pagina(TODAS, NEGOCIO, { omitir: ["emprendimiento"] }).preguntas.some((x) => x.clave === "venta-al-por-mayor"));
    assert.equal(pagina([COMO], NEGOCIO).intro, null);
  });
});

describe("página de mayoristas — lo que NUNCA llega", () => {
  it("CONTRATO DE AUDIENCIA: lo escrito para mayoristas no se muestra, ni como pregunta, ni enlazado, ni como introducción", () => {
    const sola = [COMO, SOLO_MAYORISTA];
    assert.ok(!titulos(pagina(sola)).includes("Lista de precios"));
    assert.ok(!titulos(pagina(sola, NEGOCIO, { ...OPCIONES, tambien: ["precios-mayoristas"] })).includes("Lista de precios"));
    assert.equal(pagina(sola, NEGOCIO, { intro: "precios-mayoristas" }).intro, null);
    assert.ok(!JSON.stringify(pagina()).includes("precios mayoristas"));
  });

  it("una entrada «detal» sí es para este público; una «todos» también", () => {
    const detal = publicada("solo-detal", contenido({ tema: "mayoristas", audiencia: "detal", titulo: "Para quien aún compra al detal", texto: "Te contamos cómo pasar a mayorista.", orden: 30 }));
    assert.ok(titulos(pagina([COMO, detal])).includes("Para quien aún compra al detal"));
  });

  it("CONTRATO DE VIGENCIA: una entrada vencida o programada no se muestra (hora de Bogotá, hasta el último minuto del último día)", () => {
    const con = (vigencia: { desde?: string; hasta?: string }) => [publicada("con-vigencia", contenido({ tema: "mayoristas", titulo: "Con vigencia", texto: "Texto.", vigencia }))];
    assert.equal(pagina(con(VIGENCIA), NEGOCIO, {}, Date.parse("2026-10-31T23:59:00-05:00")).preguntas.length, 1);
    assert.equal(pagina(con(VIGENCIA), NEGOCIO, {}, Date.parse("2026-11-01T00:00:00-05:00")).preguntas.length, 0, "vencida");
    assert.equal(pagina(con(VIGENCIA), NEGOCIO, {}, Date.parse("2026-10-24T23:59:00-05:00")).preguntas.length, 0, "programada");
  });

  it("un texto cuya variable no se puede resolver no se muestra (nunca a medias, nunca con «{{…}}» a la vista); lo demás sí", () => {
    const p = pagina(TODAS, SIN_MINIMO);
    assert.equal(p.intro, null, "la introducción usa el mínimo y no está configurado");
    assert.ok(!titulos(p).includes("¿Cuál es la compra mínima?"));
    assert.ok(titulos(p).includes("¿Cómo compro al por mayor?"));
    assert.ok(!JSON.stringify(p).includes("{{"));
  });

  it("solo existe el tema «Mayoristas» como fuente de las preguntas propias de la página", () => {
    assert.equal(TEMA_PAGINA_MAYORISTAS, "mayoristas");
    const otraTema = publicada("faq-general", contenido({ tema: "faq", titulo: "¿Hacen envíos?", texto: "Sí." }));
    assert.ok(!titulos(pagina([COMO, otraTema])).includes("¿Hacen envíos?"));
  });

  it("no altera lo que recibe y es determinista (mismas entradas, mismo resultado, en cualquier orden de llegada)", () => {
    const snap = instantanea({ contenidos: TODAS });
    const antes = JSON.stringify([...snap.contenidos]);
    const a = paginaMayoristas(snap, NEGOCIO, AHORA, OPCIONES);
    assert.equal(JSON.stringify([...snap.contenidos]), antes);
    assert.deepEqual(paginaMayoristas(instantanea({ contenidos: [...TODAS].reverse() }), NEGOCIO, AHORA, OPCIONES), a);
  });
});

describe("parrafosDe — un texto del CMS en párrafos", () => {
  it("separa por saltos de línea (con o sin línea en blanco), recorta y no deja párrafos vacíos", () => {
    assert.deepEqual(parrafosDe("Uno.\n\nDos.\r\n  Tres.  \n\n\n"), ["Uno.", "Dos.", "Tres."]);
    assert.deepEqual(parrafosDe("Solo uno."), ["Solo uno."]);
    assert.deepEqual(parrafosDe("  \n \n"), []);
  });
});
