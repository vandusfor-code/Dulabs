/**
 * Páginas propias de la tienda (pagina.ts): el texto que escribe la administradora ↔ los bloques que guarda el CMS, la dirección de la página, lo que dibuja la tienda a partir de lo publicado, los
 * problemas que se le muestran mientras escribe y el resumen de lo que cambió entre dos versiones.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_ELEMENTO_LISTA_PAGINA, MAX_ELEMENTOS_LISTA_PAGINA, MAX_PARRAFO_PAGINA, MAX_SUBTITULO_PAGINA, MENSAJE_PAGINA_CON_MUCHOS_BLOQUES, MENSAJE_PAGINA_LARGA, type BloquePagina } from "@/lib/cms-comercial/esquemas";
import {
  bloquesDeBorrador,
  bloquesDeTexto,
  clavesDePaginas,
  esClavePagina,
  fechaDePagina,
  inicioDeBloque,
  mismosBloques,
  paginaDesdeCms,
  problemasDeBloques,
  resumenDeCambiosDeBloques,
  rutaPagina,
  SEGMENTO_PAGINAS,
  textoDeBloques,
} from "@/lib/cms-comercial/pagina";
import { instantanea, pagina, publicada } from "@/lib/cms-comercial/testing/fixtures";

const p = (texto: string): BloquePagina => ({ tipo: "parrafo", texto });
const s = (texto: string): BloquePagina => ({ tipo: "subtitulo", texto });
const l = (...items: string[]): BloquePagina => ({ tipo: "lista", items });

describe("del texto que escribe la administradora a los bloques", () => {
  it("un texto vacío o solo de espacios y saltos de línea no tiene bloques", () => {
    assert.deepEqual(bloquesDeTexto(""), []);
    assert.deepEqual(bloquesDeTexto("   \n\n \t \n"), []);
  });

  it("un párrafo; varias líneas seguidas son UN párrafo y conservan su salto de línea", () => {
    assert.deepEqual(bloquesDeTexto("Hola, bienvenida."), [p("Hola, bienvenida.")]);
    assert.deepEqual(bloquesDeTexto("1. Primero\n2. Segundo\n3. Tercero"), [p("1. Primero\n2. Segundo\n3. Tercero")]);
  });

  it("una línea en blanco (o varias) separa los párrafos", () => {
    assert.deepEqual(bloquesDeTexto("Uno.\n\nDos.\n\n\n\nTres."), [p("Uno."), p("Dos."), p("Tres.")]);
    assert.deepEqual(bloquesDeTexto("Uno.\n   \t\nDos."), [p("Uno."), p("Dos.")], "una línea con solo espacios también separa");
  });

  it("«## » al principio de una línea hace un subtítulo (también # y ###, pero no ####, ni sin espacio)", () => {
    assert.deepEqual(bloquesDeTexto("## Datos que recogemos"), [s("Datos que recogemos")]);
    assert.deepEqual(bloquesDeTexto("# Uno\n### Dos"), [s("Uno"), s("Dos")]);
    assert.deepEqual(bloquesDeTexto("#### Cuatro"), [p("#### Cuatro")]);
    assert.deepEqual(bloquesDeTexto("##sin espacio"), [p("##sin espacio")]);
    assert.deepEqual(bloquesDeTexto("##"), [p("##")], "una marca sin texto no es un subtítulo");
  });

  it("un subtítulo conserva todo su texto, incluso un guion o un # dentro", () => {
    assert.deepEqual(bloquesDeTexto("## Garantía - 30 días # importante"), [s("Garantía - 30 días # importante")]);
  });

  it("«- », «• » o «* » al principio de una línea es un elemento de lista; los seguidos forman UNA lista", () => {
    assert.deepEqual(bloquesDeTexto("- Uno\n- Dos\n• Tres\n* Cuatro"), [l("Uno", "Dos", "Tres", "Cuatro")]);
    assert.deepEqual(bloquesDeTexto("  - Con sangría\n\t- Con tabulador"), [l("Con sangría", "Con tabulador")]);
  });

  it("una línea en blanco corta la lista: dos listas", () => {
    assert.deepEqual(bloquesDeTexto("- A\n- B\n\n- C"), [l("A", "B"), l("C")]);
  });

  it("un guion sin texto, o pegado a la palabra, no es una lista", () => {
    assert.deepEqual(bloquesDeTexto("-"), [p("-")]);
    assert.deepEqual(bloquesDeTexto("- "), [p("-")]);
    assert.deepEqual(bloquesDeTexto("-pegado"), [p("-pegado")]);
    assert.deepEqual(bloquesDeTexto("*negrita*"), [p("*negrita*")]);
  });

  it("un párrafo, un subtítulo y una lista pegados (sin línea en blanco) se separan solos, en orden", () => {
    assert.deepEqual(bloquesDeTexto("Antes.\n## Título\nDespués.\n- Uno\n- Dos\nFin."), [p("Antes."), s("Título"), p("Después."), l("Uno", "Dos"), p("Fin.")]);
  });

  it("acepta cualquier fin de línea (Windows, Mac antiguo) y recorta los espacios de cada línea", () => {
    assert.deepEqual(bloquesDeTexto("Uno.  \r\n\r\nDos.\r- Tres"), [p("Uno."), p("Dos."), l("Tres")]);
    assert.deepEqual(bloquesDeTexto("   sangrado   \n   otra  "), [p("sangrado\notra")]);
  });

  it("el HTML no tiene ningún trato especial: es texto (el esquema lo rechaza al guardar y la tienda lo mostraría escapado)", () => {
    assert.deepEqual(bloquesDeTexto("<b>hola</b>"), [p("<b>hola</b>")]);
    assert.deepEqual(problemasDeBloques(bloquesDeTexto("<b>hola</b>")), ["«<b>hola</b>»: El párrafo no puede contener etiquetas HTML: escribe texto plano."]);
  });

  it("volver a convertir el texto de unos bloques da los mismos bloques (la página no cambia sola al abrirla)", () => {
    assert.deepEqual(bloquesDeTexto(textoDeBloques(pagina().bloques)), pagina().bloques);
    for (const texto of ["## A\nB\nC\n\n- D\n- E\n\nF", "- solo\n\n## fin", "Uno\n\n\n\nDos\n- tres", "  raro  \n## tít\n-\n• x"]) {
      const bloques = bloquesDeTexto(texto);
      assert.deepEqual(bloquesDeTexto(textoDeBloques(bloques)), bloques, texto);
    }
  });

  it("no altera lo que recibe", () => {
    const entrada = "  ## A  \r\n- b";
    const copia = String(entrada);
    bloquesDeTexto(entrada);
    assert.equal(entrada, copia);
  });
});

describe("de los bloques al texto con el que se edita", () => {
  it("un subtítulo con «## », los párrafos tal cual, las listas con «- », y una línea en blanco entre bloque y bloque", () => {
    assert.equal(textoDeBloques([s("Uno"), p("Dos\ntres"), l("a", "b"), p("Fin")]), "## Uno\n\nDos\ntres\n\n- a\n- b\n\nFin");
  });

  it("sin bloques, texto vacío", () => {
    assert.equal(textoDeBloques([]), "");
  });
});

describe("la dirección de una página", () => {
  it("vive bajo /p/ dentro de la tienda", () => {
    assert.equal(SEGMENTO_PAGINAS, "p");
    assert.equal(rutaPagina("/catalogo/delacour", "politica-de-privacidad"), "/catalogo/delacour/p/politica-de-privacidad");
    assert.equal(rutaPagina("", "terminos"), "/p/terminos");
  });

  it("un código válido: minúsculas, números y guiones, de 1 a 80 caracteres, sin empezar por guion", () => {
    for (const ok of ["politica-de-privacidad", "a", "0abc", "terminos-y-condiciones-2", "a".repeat(80)]) assert.equal(esClavePagina(ok), true, ok);
    for (const mal of ["", "-x", "A", "Política", "a b", "a/b", "../x", "a..b", "ñ", "%2e%2e", "a".repeat(81), "a\nb", " a"]) assert.equal(esClavePagina(mal), false, JSON.stringify(mal));
  });
});

describe("lo publicado que dibuja la tienda", () => {
  const snap = instantanea({ paginas: [publicada("politica-de-privacidad", pagina(), { publicadaAt: "2026-10-15T15:00:00.000Z" }), publicada("terminos", pagina({ titulo: "Términos y condiciones" }))] });

  it("la página publicada con ese código: título, bloques y cuándo se publicó", () => {
    assert.deepEqual(paginaDesdeCms(snap, "politica-de-privacidad"), { clave: "politica-de-privacidad", titulo: "Política de privacidad", bloques: pagina().bloques, actualizadaAt: "2026-10-15T15:00:00.000Z" });
    assert.equal(paginaDesdeCms(snap, "terminos")?.titulo, "Términos y condiciones");
  });

  it("un código que no está publicado (o sin lectura del CMS) no existe", () => {
    assert.equal(paginaDesdeCms(snap, "cambios"), null);
    assert.equal(paginaDesdeCms(instantanea(), "terminos"), null);
    assert.equal(paginaDesdeCms(null, "terminos"), null);
  });

  it("los códigos de las páginas publicadas, para que el pie decida a cuáles enlaza", () => {
    assert.deepEqual(clavesDePaginas(snap), ["politica-de-privacidad", "terminos"]);
    assert.deepEqual(clavesDePaginas(instantanea()), []);
    assert.deepEqual(clavesDePaginas(null), []);
  });

  it("la fecha se dice en español y en hora de Bogotá", () => {
    assert.equal(fechaDePagina("2026-10-15T15:00:00.000Z"), "15 de octubre de 2026");
    assert.equal(fechaDePagina("2026-10-16T03:00:00.000Z"), "15 de octubre de 2026", "las 10 p. m. del 15 en Bogotá siguen siendo el 15");
    assert.equal(fechaDePagina("2026-01-01T04:59:00.000Z"), "31 de diciembre de 2025");
    assert.equal(fechaDePagina("no es una fecha"), "");
  });
});

describe("los problemas del texto mientras se escribe", () => {
  it("un texto correcto no tiene problemas", () => {
    assert.deepEqual(problemasDeBloques(pagina().bloques), []);
    assert.deepEqual(problemasDeBloques([]), []);
  });

  it("dice qué bloque es por su comienzo (no por un número) y por qué", () => {
    const largo = `Cuando tu pedido llega a casa y lo abres por primera vez ${"x".repeat(MAX_PARRAFO_PAGINA)}`;
    assert.deepEqual(problemasDeBloques([p("Bien."), p(largo)]), [`«Cuando tu pedido llega a casa y lo abres…»: El párrafo no puede superar ${MAX_PARRAFO_PAGINA} caracteres.`]);
    assert.deepEqual(problemasDeBloques([s("s".repeat(MAX_SUBTITULO_PAGINA + 1))]), [`«${"s".repeat(40)}…»: El subtítulo no puede superar ${MAX_SUBTITULO_PAGINA} caracteres.`]);
    assert.deepEqual(problemasDeBloques([l("ok", "i".repeat(MAX_ELEMENTO_LISTA_PAGINA + 1))]), [`«ok»: El elemento de la lista no puede superar ${MAX_ELEMENTO_LISTA_PAGINA} caracteres.`]);
    assert.deepEqual(problemasDeBloques([l(...Array.from({ length: MAX_ELEMENTOS_LISTA_PAGINA + 1 }, (_, i) => `e${i}`))]), [`«e0»: Una lista admite máximo ${MAX_ELEMENTOS_LISTA_PAGINA} elementos.`]);
  });

  it("los topes de toda la página: demasiados bloques y demasiado texto", () => {
    assert.deepEqual(problemasDeBloques(Array.from({ length: 201 }, (_, i) => p(`Párrafo ${i}`))), [MENSAJE_PAGINA_CON_MUCHOS_BLOQUES]);
    assert.deepEqual(problemasDeBloques(Array.from({ length: 26 }, () => p("y".repeat(MAX_PARRAFO_PAGINA)))), [MENSAJE_PAGINA_LARGA]);
    assert.deepEqual(problemasDeBloques(Array.from({ length: 200 }, (_, i) => p(`Párrafo ${i}`))), [], "200 bloques es el máximo permitido");
  });
});

describe("el comienzo de un bloque", () => {
  it("se recorta a 40 caracteres, une las líneas y, en una lista, es su primer elemento", () => {
    assert.equal(inicioDeBloque(p("Corto")), "Corto");
    assert.equal(inicioDeBloque(p("a".repeat(60))), `${"a".repeat(40)}…`);
    assert.equal(inicioDeBloque(p("Una\n  línea\ncon saltos")), "Una línea con saltos");
    assert.equal(inicioDeBloque(l("Primero", "Segundo")), "Primero");
    assert.equal(inicioDeBloque(s("Subtítulo")), "Subtítulo");
  });
});

describe("los bloques de un borrador (tolerantes con lo que no lo es)", () => {
  it("lo que no es una lista de bloques es una lista vacía", () => {
    for (const raro of [undefined, null, 5, "texto", {}, { tipo: "parrafo", texto: "x" }]) assert.deepEqual(bloquesDeBorrador(raro), []);
  });

  it("deja fuera lo que no tenga la forma de un bloque y copia solo los campos propios de cada tipo", () => {
    const sucio = [null, 5, "x", { tipo: "parrafo" }, { tipo: "parrafo", texto: 3 }, { tipo: "otro", texto: "x" }, { tipo: "lista", items: [1, 2] }, { tipo: "lista" }, { tipo: "parrafo", texto: "Bien.", extra: "no" }, { tipo: "lista", items: ["a"], extra: 1 }, { tipo: "subtitulo", texto: "S" }];
    assert.deepEqual(bloquesDeBorrador(sucio), [p("Bien."), l("a"), s("S")]);
  });

  it("dos listas de bloques son iguales si dicen lo mismo, sin importar el orden de las claves", () => {
    assert.equal(mismosBloques([p("a"), l("b", "c")], [{ texto: "a", tipo: "parrafo" }, { items: ["b", "c"], tipo: "lista" }]), true);
    assert.equal(mismosBloques([p("a")], [s("a")]), false, "el mismo texto como subtítulo es otra cosa");
    assert.equal(mismosBloques([p("a")], [p("a"), p("b")]), false);
    assert.equal(mismosBloques([l("a", "b")], [l("a b")]), false);
    assert.equal(mismosBloques([], []), true);
  });
});

describe("qué cambió entre dos versiones del texto", () => {
  const base = [s("Uno"), p("Dos"), l("a", "b"), p("Fin")];

  it("el mismo texto no cambió (aunque falte una de las dos listas)", () => {
    assert.equal(resumenDeCambiosDeBloques(base, [...base]), null);
    assert.equal(resumenDeCambiosDeBloques([], undefined), null);
    assert.equal(resumenDeCambiosDeBloques(null, []), null);
  });

  it("una página nueva: de nada a N bloques", () => {
    assert.deepEqual(resumenDeCambiosDeBloques(undefined, base), { antes: "—", despues: "4 bloques, 4 con cambios" });
    assert.deepEqual(resumenDeCambiosDeBloques([], [p("x")]), { antes: "—", despues: "1 bloque, 1 con cambios" });
  });

  it("un párrafo corregido cuenta como un bloque con cambios", () => {
    assert.deepEqual(resumenDeCambiosDeBloques(base, [s("Uno"), p("Dos corregido"), l("a", "b"), p("Fin")]), { antes: "4 bloques", despues: "4 bloques, 1 con cambios" });
  });

  it("agregar o quitar un bloque, aunque sea al principio, no hace parecer que todo cambió", () => {
    assert.deepEqual(resumenDeCambiosDeBloques(base, [p("Nuevo"), ...base]), { antes: "4 bloques", despues: "5 bloques, 1 con cambios" });
    assert.deepEqual(resumenDeCambiosDeBloques(base, base.slice(1)), { antes: "4 bloques", despues: "3 bloques, 1 con cambios" });
  });

  it("varios cambios a la vez: dos corregidos y uno agregado", () => {
    assert.deepEqual(resumenDeCambiosDeBloques(base, [s("Uno!"), p("Dos"), l("a", "c"), p("Fin"), p("Extra")]), { antes: "4 bloques", despues: "5 bloques, 3 con cambios" });
  });

  it("quitar todo el texto", () => {
    assert.deepEqual(resumenDeCambiosDeBloques(base, []), { antes: "4 bloques", despues: "—, 4 con cambios" });
  });
});
