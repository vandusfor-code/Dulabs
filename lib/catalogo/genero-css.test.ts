/**
 * El lado de hombre de Delacour (Vértice) en app/globals.css: el CONTRATO del color. Se lee el CSS real y se comprueba, con sus propios valores:
 *   1. la paleta es la que la clienta pidió (la de su catálogo «Vértice»: grafito frío y plata, no negro puro);
 *   2. todo texto, botón y control se lee con el contraste que pide la accesibilidad (≥ 4,5:1 el texto, ≥ 3:1 los controles);
 *   3. el tema define TODAS las variables de color del tema claro (si mañana alguien agrega una variable al tema claro y olvida el lado de hombre, aquí se avisa: saldría un parche claro en una página oscura);
 *   4. pasar de un lado al otro SOLO cambia colores (ninguna medida, posición ni movimiento: nada se mueve de lugar);
 *   5. el nombre de la señal que enciende el tema es el mismo en el CSS y en el código (TemaGenero), y todas las clases nuevas de los componentes existen en el CSS.
 * Solo lee archivos: no abre navegador ni base de datos.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { ATRIBUTO_TEMA_GENERO } from "@/lib/catalogo/genero";

const RAIZ = process.cwd();
const leer = (...partes: string[]) => readFileSync(path.join(RAIZ, ...partes), "utf8").replace(/\r\n/g, "\n");
const CSS = leer("app", "globals.css");
const SIN_COMENTARIOS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

// ------------------------------------------------------------------------------------------------- un lector mínimo de CSS (este archivo no anida reglas, salvo @media/@supports)
interface Regla {
  selector: string;
  decl: Record<string, string>;
}
function declaraciones(cuerpo: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of cuerpo.split(";")) {
    const i = d.indexOf(":");
    if (i < 0) continue;
    out[d.slice(0, i).trim()] = d.slice(i + 1).trim().replace(/\s+/g, " ");
  }
  return out;
}
/** Todas las reglas "selector { … }", también las de dentro de @media/@supports (el encabezado del @ no se devuelve). */
function reglas(css: string): Regla[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim().replace(/\s+/g, " "), decl: declaraciones(m[2]) }));
}
const REGLAS = reglas(SIN_COMENTARIOS);

const MARCA = `[${ATRIBUTO_TEMA_GENERO}="hombre"]`;
const CLARO = REGLAS.find((r) => r.selector === ".catalogo-tienda.tienda-joyeria" && "--color-ink" in r.decl);
const OSCURO = REGLAS.find((r) => r.selector.includes(`:has(${MARCA})`) && r.selector.includes(".joy-vertice") && "--color-ink" in r.decl);

// ------------------------------------------------------------------------------------------------- colores
type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => {
  const h = /^#([0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  assert.ok(h, `no es un color #rrggbb: «${hex}»`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const aHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
const luminancia = (c: Rgb) => {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
/** Contraste WCAG entre dos colores #rrggbb. */
const contraste = (a: string, b: string) => {
  const la = luminancia(rgb(a));
  const lb = luminancia(rgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
/** color-mix(in srgb, A pct%, B): mezcla en sRGB tal cual (como el navegador). */
const mezcla = (a: string, pct: number, b: string): string => {
  const ca = rgb(a);
  const cb = rgb(b);
  return aHex([0, 1, 2].map((i) => (ca[i] * pct + cb[i] * (100 - pct)) / 100) as Rgb);
};

const token = (nombre: string): string => {
  const v = OSCURO?.decl[nombre];
  assert.ok(v, `el lado de hombre no define ${nombre}`);
  return v;
};
const T = {
  ink: () => token("--color-ink"),
  ink2: () => token("--color-ink-2"),
  card: () => token("--color-card"),
  edge: () => token("--color-edge"),
  fg: () => token("--color-fg"),
  mist: () => token("--color-mist"),
  oro: () => token("--tienda-oro"),
  oroHover: () => token("--tienda-oro-hover"),
  oroSuave: () => token("--tienda-oro-suave"),
  joyOro: () => token("--joy-oro"),
  joyOroClaro: () => token("--joy-oro-claro"),
};
/** El centro más claro del degradado de la portada del lado de hombre (el mismo del catálogo de Vértice). */
const DEGRADADO_CLARO = "#303b40";

describe("la paleta del lado de hombre es la que pidió la clienta (la de su catálogo «Vértice»)", () => {
  it("el bloque de colores existe, y sirve a toda la tienda (cuando la página dice «hombre») y a la franja «Para él» del inicio", () => {
    assert.ok(OSCURO, "no hay bloque de variables del lado de hombre");
    assert.match(OSCURO!.selector, /^\.catalogo-tienda\.tienda-joyeria:has\(/);
    assert.ok(OSCURO!.selector.includes(".catalogo-tienda.tienda-joyeria .joy-vertice"));
    assert.equal(OSCURO!.decl["color-scheme"], "dark");
  });

  it("fondo grafito #111416, paneles #1b2023, líneas #394147, plata #c2c9cc, gris #9ba5aa, blanco #f4f5f5 y acero #a7b7bd: los de Vértice, no negro puro", () => {
    assert.equal(T.ink(), "#111416");
    assert.equal(T.card(), "#1b2023");
    assert.equal(T.edge(), "#394147");
    assert.equal(T.oro(), "#c2c9cc");
    assert.equal(T.mist(), "#9ba5aa");
    assert.equal(T.fg(), "#f4f5f5");
    assert.equal(T.joyOro(), "#a7b7bd");
    assert.notEqual(T.ink().toLowerCase(), "#000000", "la clienta pidió el grafito de Vértice, no negro puro");
  });

  it("es oscuro de verdad: el fondo es mucho más oscuro que el texto, y los paneles un poco más claros que el fondo (hay jerarquía de superficies)", () => {
    const l = (c: string) => luminancia(rgb(c));
    assert.ok(l(T.ink()) < 0.02 && l(T.fg()) > 0.8);
    assert.ok(l(T.ink()) < l(T.ink2()) && l(T.ink2()) < l(T.card()), "fondo < segundo fondo < panel");
  });

  it("el degradado de la portada es el de Vértice (#303b40 hacia el fondo), en la franja del inicio y en la portada del listado", () => {
    assert.ok(CSS.includes("radial-gradient(ellipse at 78% 18%, #303b40 0%, transparent 62%)"), "franja «Para él»");
    assert.ok(CSS.includes("radial-gradient(ellipse at 72% 20%, #303b40 0%, transparent 68%)"), "portada del listado");
  });

  it("detrás de la tienda (al rebotar la página, con las barras a la vista) también es grafito: no queda una franja blanca", () => {
    const r = REGLAS.find((x) => x.selector === `html:has(${MARCA})`);
    assert.ok(r, "falta la regla del fondo de la página");
    assert.equal(r!.decl["background-color"], T.ink());
    assert.equal(r!.decl["color-scheme"], "dark");
  });
});

describe("contraste (WCAG): el texto se lee y los controles se ven en el lado de hombre", () => {
  const MIN_TEXTO = 4.5;
  const MIN_CONTROL = 3;
  const AL = (a: string, b: string) => Math.round(contraste(a, b) * 100) / 100;

  it("el texto principal (blanco) sobre el fondo, el segundo fondo y los paneles", () => {
    for (const fondo of [T.ink(), T.ink2(), T.card()]) assert.ok(contraste(T.fg(), fondo) >= MIN_TEXTO, `${T.fg()} sobre ${fondo} = ${AL(T.fg(), fondo)}`);
  });

  it("el texto de apoyo (gris) sobre el fondo, el segundo fondo y los paneles — y sobre lo más claro del degradado de la portada", () => {
    for (const fondo of [T.ink(), T.ink2(), T.card(), DEGRADADO_CLARO]) assert.ok(contraste(T.mist(), fondo) >= MIN_TEXTO, `${T.mist()} sobre ${fondo} = ${AL(T.mist(), fondo)}`);
  });

  it("la plata como color de texto (enlaces, antetítulo, lema, precio de oferta) sobre el fondo, los paneles, el degradado y el chip suave", () => {
    for (const fondo of [T.ink(), T.ink2(), T.card(), DEGRADADO_CLARO, T.oroSuave()]) {
      assert.ok(contraste(T.oro(), fondo) >= MIN_TEXTO, `${T.oro()} sobre ${fondo} = ${AL(T.oro(), fondo)}`);
      assert.ok(contraste(T.oroHover(), fondo) >= MIN_TEXTO, `${T.oroHover()} sobre ${fondo} = ${AL(T.oroHover(), fondo)}`);
    }
  });

  it("el texto sobre el chip suave («Disponible», «Últimas unidades») y el blanco sobre él", () => {
    assert.ok(contraste(T.fg(), T.oroSuave()) >= MIN_TEXTO, `${AL(T.fg(), T.oroSuave())}`);
    assert.ok(contraste(T.mist(), T.oroSuave()) >= MIN_TEXTO, `${AL(T.mist(), T.oroSuave())}`);
  });

  it("los botones y etiquetas LLENOS de plata llevan texto oscuro (el blanco de siempre NO se lee sobre la plata) y así se declara", () => {
    assert.ok(contraste("#ffffff", T.oro()) < MIN_TEXTO, "el blanco sobre plata no pasa: por eso la regla de texto oscuro existe");
    for (const fondo of [T.oro(), T.oroHover()]) assert.ok(contraste(T.ink(), fondo) >= MIN_TEXTO, `${T.ink()} sobre ${fondo} = ${AL(T.ink(), fondo)}`);
    const regla = REGLAS.find((r) => r.selector.includes(`:has(${MARCA}) [class*="bg-[var(--tienda-oro)]"]`));
    assert.ok(regla, "falta la regla del texto oscuro sobre lo lleno de plata");
    assert.equal(regla!.decl.color, "var(--color-ink)");
    for (const clase of [".joy-chip-activo", ".joy-filtro-contador"]) assert.ok(regla!.selector.includes(clase), `la regla cubre ${clase}`);
    assert.ok(regla!.selector.includes(".joy-vertice [class*=\"bg-[var(--tienda-oro)]\"]"), "y dentro de la franja «Para él»");
  });

  it("el lado elegido del selector Mujer | Hombre (relleno blanco con texto oscuro) y el botón de la franja al pasar el cursor (relleno plata con texto oscuro)", () => {
    assert.ok(contraste(T.ink(), T.fg()) >= MIN_TEXTO, `${AL(T.ink(), T.fg())}`);
    const lado = REGLAS.find((r) => r.selector === '.tienda-joyeria .joy-genero-lado[aria-current="true"]');
    assert.equal(lado?.decl["background-color"], "var(--color-fg)");
    assert.equal(lado?.decl.color, "var(--color-ink)");
    const boton = REGLAS.find((r) => r.selector === ".tienda-joyeria a.joy-vertice-boton:hover");
    assert.equal(boton?.decl["background-color"], "var(--tienda-oro)");
    assert.equal(boton?.decl.color, "var(--color-ink)");
  });

  it("los controles de los filtros (casilla, perilla) y el acero decorativo se ven (≥ 3:1) sobre el fondo y los paneles", () => {
    const control = mezcla(T.mist(), 75, T.card());
    const controlOro = mezcla(T.joyOro(), 50, T.oro());
    assert.equal(OSCURO!.decl["--joy-control"], "color-mix(in srgb, var(--color-mist) 75%, var(--color-card))", "la fórmula que este test replica");
    assert.equal(OSCURO!.decl["--joy-control-oro"], "color-mix(in srgb, var(--joy-oro) 50%, var(--tienda-oro))", "la fórmula que este test replica");
    for (const fondo of [T.ink(), T.ink2(), T.card()]) {
      assert.ok(contraste(control, fondo) >= MIN_CONTROL, `control ${control} sobre ${fondo} = ${AL(control, fondo)}`);
      assert.ok(contraste(controlOro, fondo) >= MIN_CONTROL, `control marcado ${controlOro} sobre ${fondo} = ${AL(controlOro, fondo)}`);
      assert.ok(contraste(T.joyOro(), fondo) >= MIN_CONTROL, `acero ${T.joyOro()} sobre ${fondo} = ${AL(T.joyOro(), fondo)}`);
    }
  });

  it("el espresso del lado de hombre (fondo de los videos y velos) es más oscuro que el fondo: el texto blanco encima se lee", () => {
    assert.ok(contraste("#ffffff", token("--joy-espresso")) >= 15);
  });
});

describe("el lado de hombre define TODAS las variables de color del tema claro", () => {
  it("cada variable del tema claro (menos las medidas de la cabecera) está en el lado de hombre: si se agrega una al claro, hay que decidir su valor oscuro", () => {
    assert.ok(CLARO, "no se encontró el bloque del tema claro");
    const delClaro = Object.keys(CLARO!.decl).filter((k) => k.startsWith("--") && !k.startsWith("--joy-alto-"));
    assert.ok(delClaro.length >= 10, `se esperaban al menos 10 variables de color, hay ${delClaro.length}`);
    const faltan = delClaro.filter((k) => !(k in OSCURO!.decl));
    assert.deepEqual(faltan, [], `faltan en el lado de hombre: ${faltan.join(", ")}`);
  });

  it("y NO toca las medidas de la cabecera (cambiar de lado no debe mover nada de lugar)", () => {
    for (const k of Object.keys(OSCURO!.decl)) assert.ok(!k.startsWith("--joy-alto-"), `el lado de hombre redefine una medida: ${k}`);
  });

  it("los valores de los colores del lado de hombre son #rrggbb (o mezclas con var) y ninguno repite un color del tema claro", () => {
    for (const [k, v] of Object.entries(OSCURO!.decl)) {
      if (!k.startsWith("--")) continue;
      assert.ok(/^#[0-9a-f]{6}$/i.test(v) || /^color-mix\(in srgb, var\(--[a-z-]+\) \d+%, var\(--[a-z-]+\)\)$/.test(v), `${k}: ${v}`);
      if (/^#/.test(v)) assert.notEqual(v.toLowerCase(), CLARO!.decl[k]?.toLowerCase(), `${k} quedó igual que en el tema claro`);
    }
  });
});

describe("pasar de un lado al otro SOLO cambia colores", () => {
  /** Lo que una regla del lado de hombre puede cambiar: variables, color, fondo, borde (color) y sombra. Nada de medidas, posiciones, tipografía ni movimiento. */
  const SOLO_COLOR = /^(--[a-z0-9-]+|color|color-scheme|background|background-color|background-image|border-color|box-shadow|outline-color|fill|stroke)$/;
  const delLado = REGLAS.filter((r) => r.selector.split(",").some((s) => s.trim().startsWith(".catalogo-tienda.tienda-joyeria:has(") || s.trim().startsWith("html:has(")) && r.selector.includes(MARCA));

  it("hay reglas del lado de hombre (el bloque de variables, la cabecera de vidrio, el texto oscuro sobre plata…)", () => {
    assert.ok(delLado.length >= 8, `se encontraron ${delLado.length}`);
    assert.ok(delLado.some((r) => r === OSCURO));
  });

  it("ninguna de ellas declara una medida, una posición, una tipografía o un movimiento", () => {
    const malas = delLado.flatMap((r) => Object.keys(r.decl).filter((p) => !SOLO_COLOR.test(p)).map((p) => `${r.selector} { ${p} }`));
    assert.deepEqual(malas, [], `estas reglas mueven o redimensionan algo al cambiar de lado: ${malas.join(" | ")}`);
  });

  it("la cabecera de vidrio del lado de hombre sigue siendo de vidrio (translúcida) y tiene respaldo sin transparencia", () => {
    const cab = REGLAS.filter((r) => r.selector === `.catalogo-tienda.tienda-joyeria:has(${MARCA}) .joy-cab`);
    assert.ok(cab.length >= 3, "la regla base y los dos respaldos (sin backdrop-filter y con transparencia reducida)");
    assert.match(cab[0].decl["background-color"], /^rgb\(23 28 31 \/ 0\.\d+\)$/, "vidrio del color del segundo fondo");
    for (const r of cab.slice(1)) assert.equal(r.decl["background-color"], "var(--color-ink)");
    assert.ok(SIN_COMENTARIOS.includes("@supports not ((backdrop-filter: blur(1px))"));
    assert.ok(SIN_COMENTARIOS.includes("@media (prefers-reduced-transparency: reduce)"));
  });

  it("la cabecera en lado de hombre hace juego con la paleta: rgb(23 28 31) es el segundo fondo #171c1f", () => {
    assert.deepEqual(rgb(T.ink2()), [23, 28, 31]);
    assert.deepEqual(rgb(T.edge()), [57, 65, 71], "y rgb(57 65 71) de la sombra de la cabecera es la línea #394147");
  });
});

describe("la señal que enciende el tema y las clases nuevas", () => {
  it("el CSS usa el mismo nombre de señal que el código (data-tema-genero=\"hombre\"): si uno cambia sin el otro, la tienda dejaría de cambiar de color", () => {
    assert.equal(ATRIBUTO_TEMA_GENERO, "data-tema-genero");
    assert.ok(CSS.includes(`:has(${MARCA})`));
    const fuente = leer("components", "catalogo-publico", "tienda", "joyeria", "TemaGenero.tsx");
    assert.ok(fuente.includes("ATRIBUTO_TEMA_GENERO"), "TemaGenero toma el nombre de la constante");
    assert.ok(!/data-tema-genero/.test(fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "y no lo escribe a mano");
    // ninguna otra señal parecida en el CSS
    const otras = [...SIN_COMENTARIOS.matchAll(/\[data-(?:tema|genero)[a-z-]*(?:=[^\]]*)?\]/g)].map((m) => m[0]).filter((s) => s !== MARCA);
    assert.deepEqual(otras, [], `señales distintas en el CSS: ${otras.join(", ")}`);
  });

  it("toda clase joy-vertice*, joy-genero* y joy-hv* que usan los componentes existe en el CSS (una errata dejaría un trozo sin estilo)", () => {
    const archivos = ["SelectorGenero.tsx", "BloquesJoyeria.tsx", "ListadoJoyeria.tsx", "FichaProductoJoyeria.tsx", "CromoJoyeria.tsx", "TiendaInicioJoyeria.tsx", "FiltrosJoyeria.tsx", "HeroVertice.tsx", "TiendaInicioHombre.tsx"].map((f) =>
      leer("components", "catalogo-publico", "tienda", "joyeria", f)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, ""),
    );
    const usadas = new Set(archivos.flatMap((src) => [...src.matchAll(/\bjoy-(?:genero|vertice)[a-z-]*/g)].map((m) => m[0])).filter((c) => !c.endsWith("-")));
    assert.ok(usadas.size >= 12, `se esperaban muchas clases, hay ${usadas.size}: ${[...usadas].join(", ")}`);
    const definidas = new Set([...SIN_COMENTARIOS.matchAll(/\.(joy-(?:genero|vertice|hv)[a-z-]*)/g)].map((m) => m[1]));
    const sinEstilo = [...usadas].filter((c) => !definidas.has(c));
    assert.deepEqual(sinEstilo, [], `clases sin estilo: ${sinEstilo.join(", ")}`);
    // las variantes del selector se arman con una plantilla (`joy-genero-${variante}`): también deben existir
    for (const c of ["joy-genero-menu", "joy-genero-listado"]) assert.ok(definidas.has(c), c);
  });

  it("el selector del listado (pensado para el celular y la tableta) se esconde desde 1280 px, donde la cabecera ya trae el suyo", () => {
    const r = reglas(SIN_COMENTARIOS).find((x) => x.selector === ".tienda-joyeria .joy-genero-listado" && x.decl.display === "none");
    assert.ok(r, "falta la regla que lo esconde");
    assert.ok(SIN_COMENTARIOS.includes("@media (min-width: 1280px)"));
  });

  it("el lado de hombre no toca los demás temas: toda regla del bloque cuelga de .tienda-joyeria", () => {
    // El bloque empieza en el comentario que lo titula (su «/*» está antes del texto del título).
    const inicio = CSS.lastIndexOf("/*", CSS.indexOf("LADO DE HOMBRE — Delacour · Vértice"));
    assert.ok(inicio > 0, "no se encontró el bloque");
    const bloque = reglas(CSS.slice(inicio).replace(/\/\*[\s\S]*?\*\//g, ""));
    assert.ok(bloque.length > 20);
    const sueltas = bloque.filter((r) => r.selector.split(",").some((s) => !/^(\.catalogo-tienda)?\.tienda-joyeria\b|^\.catalogo-tienda\.tienda-joyeria\b|^html:has\(\[data-tema-genero="hombre"\]\)$/.test(s.trim()) && !s.trim().startsWith(".tienda-joyeria ") && !s.trim().startsWith(".tienda-joyeria.")));
    assert.deepEqual(sueltas.map((r) => r.selector), [], "reglas del lado de hombre que no cuelgan de .tienda-joyeria");
  });
});

describe("el inicio de hombre es un solo lienzo: sin franjas ni cortes planos (el CSS)", () => {
  const conSelector = (selector: string) => REGLAS.filter((r) => r.selector.split(",").map((s) => s.trim()).includes(selector));
  const declaraConGrafito = (r: { decl: Record<string, string> }) => `${r.decl["background-image"] ?? ""} ${r.decl["background-color"] ?? ""}`.includes("var(--color-ink)");

  it("el inicio pinta el fondo de la página (--color-ink) y el pie del lado de hombre toma el MISMO grafito: ninguna banda de otro color antes del final", () => {
    const lienzo = conSelector(".tienda-joyeria .joy-inicio-hombre");
    assert.ok(lienzo.some((r) => r.decl["background-color"] === "var(--color-ink)"), "el inicio de hombre no pinta el fondo de la página");
    const pie = conSelector(`.catalogo-tienda.tienda-joyeria:has(${MARCA}) .joy-pie`);
    assert.ok(pie.some((r) => r.decl["background-color"] === "var(--color-ink)"), "el pie del lado de hombre no toma el fondo de la página");
  });

  it("la portada se funde hacia abajo con la página (degradado a --color-ink) y arriba lleva una sombra que deja leer el menú", () => {
    const abajo = conSelector(".tienda-joyeria .joy-hv::after");
    assert.ok(abajo.some(declaraConGrafito), "falta el degradado de abajo de la portada");
    assert.ok(abajo.some((r) => /to bottom, transparent, var\(--color-ink\)/.test(r.decl["background-image"] ?? "")), "debe ir de transparente a --color-ink");
    assert.ok(conSelector(".tienda-joyeria .joy-hv::before").length > 0, "falta la sombra de arriba");
  });

  it("los videos que entran y salen de la página (colección y mayoristas) se funden con ella por arriba y por abajo", () => {
    const arriba = conSelector(".tienda-joyeria .joy-suave::before");
    const abajo = conSelector(".tienda-joyeria .joy-suave::after");
    assert.ok(arriba.some((r) => /to bottom, var\(--color-ink\), transparent/.test(r.decl["background-image"] ?? "")), "falta el degradado de arriba");
    assert.ok(abajo.some((r) => /to top, var\(--color-ink\), transparent/.test(r.decl["background-image"] ?? "")), "falta el degradado de abajo");
  });

  it("los velos y resplandores de los videos del lado de hombre son grafito, no los cafés y dorados de siempre", () => {
    const velos = [".joy-coleccion-velo", ".joy-mayoristas-velo", ".joy-mayoristas-fondo"].flatMap((c) => conSelector(`.catalogo-tienda.tienda-joyeria:has(${MARCA}) ${c}`));
    assert.ok(velos.length >= 4, `se esperaban los velos de la colección (celular y escritorio) y los de los mayoristas: ${velos.length}`);
    for (const r of velos) assert.ok(!/(24 16 10|34 22 14|181 141 74)/.test(JSON.stringify(r.decl)), `${r.selector} conserva un color café o dorado`);
  });

  it("toda clase joy-hm-* y joy-suave que usan los componentes del inicio de hombre existe en el CSS (una errata dejaría un bloque sin estilo)", () => {
    const archivos = ["TiendaInicioHombre.tsx", "CategoriasHombre.tsx", "BloquesJoyeria.tsx", "TiendaInicioJoyeria.tsx"].map((f) =>
      leer("components", "catalogo-publico", "tienda", "joyeria", f)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, ""),
    );
    const usadas = new Set(archivos.flatMap((src) => [...src.matchAll(/\bjoy-(?:hm|suave|inicio-hombre)[a-z-]*/g)].map((m) => m[0])).filter((c) => !c.endsWith("-")));
    assert.ok(usadas.size >= 12, `se esperaban muchas clases, hay ${usadas.size}: ${[...usadas].join(", ")}`);
    const definidas = new Set([...SIN_COMENTARIOS.matchAll(/\.(joy-(?:hm|suave|inicio-hombre)[a-z-]*)/g)].map((m) => m[1]));
    const sinEstilo = [...usadas].filter((c) => !definidas.has(c));
    assert.deepEqual(sinEstilo, [], `clases sin estilo: ${sinEstilo.join(", ")}`);
  });

  it("la tarjeta de una sola categoría y los mosaicos usan los colores del tema (variables), no un color escrito a mano que no cambie de lado", () => {
    const delBloque = REGLAS.filter((r) => /joy-hm-(destacada|mosaico|eyebrow|trazo|inicial)/.test(r.selector));
    assert.ok(delBloque.length >= 10);
    const colores = delBloque.flatMap((r) => ["color", "border-color"].map((p) => r.decl[p]).filter(Boolean));
    for (const c of colores) assert.match(c, /^(var\(--[a-z-]+\)|#fff|white)$/, `color escrito a mano: ${c}`);
  });
});
