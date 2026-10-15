/**
 * Página propia de la tienda (tema "joyeria"): lo que se dibuja con lo que la administradora publicó. Es HTML del servidor. Lo que más importa: el texto se muestra como TEXTO (nada de lo escrito puede
 * volverse una etiqueta, un enlace ni un script) y la página se lee bien (un solo h1, subtítulos h2, listas reales, textos largos que no desbordan).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PaginaNoDisponible, PaginaTienda } from "@/components/catalogo-publico/tienda/joyeria/PaginaTienda";
import type { BloquePagina } from "@/lib/cms-comercial/esquemas";
import type { PaginaVista } from "@/lib/cms-comercial/pagina";
import { pagina } from "@/lib/cms-comercial/testing/fixtures";

const vista = (over: Partial<PaginaVista> = {}): PaginaVista => ({ clave: "politica-de-privacidad", titulo: pagina().titulo, bloques: pagina().bloques, actualizadaAt: "2026-10-15T15:00:00.000Z", ...over });
const html = (v: PaginaVista = vista(), marca = "Delacour & Orus") => renderToStaticMarkup(<PaginaTienda pagina={v} marca={marca} />);
const cuenta = (h: string, patron: RegExp) => (h.match(patron) ?? []).length;
const visible = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("página propia — qué se dibuja", () => {
  const h = html();

  it("el título es el único h1; el subtítulo, un h2; sin saltos de nivel", () => {
    assert.equal(cuenta(h, /<h1[ >]/g), 1);
    assert.ok(h.includes(">Política de privacidad</h1>"));
    assert.ok(/<h2 [^>]*>1\. Qué datos recogemos<\/h2>/.test(h));
    assert.equal(cuenta(h, /<h[3-6]/g), 0);
  });

  it("la marca, y cuándo se actualizó (en español y en hora de Bogotá)", () => {
    assert.ok(visible(h).includes("Delacour &amp; Orus"));
    assert.ok(visible(h).includes("Última actualización: 15 de octubre de 2026"));
    assert.ok(!visible(html(vista({ actualizadaAt: "no es una fecha" }))).includes("Última actualización"), "sin una fecha válida no se inventa una");
  });

  it("los párrafos conservan sus saltos de línea y las listas son listas de verdad", () => {
    const parrafo = h.match(/<p [^>]*class="[^"]*whitespace-pre-line[^"]*"[^>]*>Solo recogemos[^<]*<\/p>/)?.[0] ?? "";
    assert.ok(parrafo.includes("WhatsApp.\nNunca los compartimos."), parrafo);
    const lista = h.match(/<ul [^>]*>(.*?)<\/ul>/)?.[0] ?? "";
    assert.ok(lista.includes('role="list"') && lista.includes("<li") && cuenta(lista, /<li[ >]/g) === 2, lista);
    assert.ok(lista.includes(">Tu nombre</li>") && lista.includes(">Tu teléfono</li>"));
  });

  it("los bloques salen en el orden en que se escribieron", () => {
    const pos = ["1. Qué datos recogemos", "Solo recogemos", "Tu nombre", "Puedes pedirnos"].map((t) => h.indexOf(t));
    assert.ok(pos.every((p) => p > 0) && [...pos].sort((a, b) => a - b).join() === pos.join(), pos.join());
  });

  it("un texto largo sin espacios no desborda la pantalla (se parte en cualquier punto)", () => {
    const largo: BloquePagina[] = [{ tipo: "subtitulo", texto: "S".repeat(100) }, { tipo: "parrafo", texto: "x".repeat(300) }, { tipo: "lista", items: ["y".repeat(300)] }];
    const l = html(vista({ titulo: "T".repeat(80), bloques: largo }));
    assert.equal(cuenta(l, /\[overflow-wrap:anywhere\]/g), 4, "el título, el subtítulo, el párrafo y el elemento de la lista");
  });
});

describe("página propia — lo que NUNCA llega al navegador", () => {
  const malo: BloquePagina[] = [
    { tipo: "subtitulo", texto: "<img src=x onerror=alert(1)>" },
    { tipo: "parrafo", texto: '<script>alert("hola")</script> & más "comillas" y \'apóstrofos\'' },
    { tipo: "parrafo", texto: "Entra a https://sitio-malo.example/ingresa o escribe javascript:alert(1)" },
    { tipo: "lista", items: ["<b>negrita</b>", '<a href="https://sitio-malo.example">pincha aquí</a>'] },
  ];
  const h = html(vista({ titulo: "<u>Título</u>", bloques: malo }), "<i>Marca</i>");

  it("las etiquetas se muestran como texto, escapadas: ni scripts, ni imágenes, ni enlaces, ni formato", () => {
    assert.ok(h.includes("&lt;script&gt;") && h.includes("&lt;img src=x onerror=alert(1)&gt;") && h.includes("&lt;b&gt;negrita&lt;/b&gt;") && h.includes("&lt;u&gt;Título&lt;/u&gt;") && h.includes("&lt;i&gt;Marca&lt;/i&gt;"));
    assert.ok(h.includes("&amp; más &quot;comillas&quot;"));
    for (const etiqueta of ["<script", "<img", "<b>", "<u>", "<i>", "<iframe", "<style"]) assert.ok(!h.includes(etiqueta), etiqueta);
  });

  it("una dirección escrita en el texto NO se vuelve un enlace (no hay enlaces dentro de una página)", () => {
    assert.equal(cuenta(h, /<a[ >]/g), 0);
    assert.equal(cuenta(h, /<[a-z][^>]*\shref=/gi), 0, "ninguna etiqueta con href (el «href=» que se ve es texto escapado)");
    assert.ok(h.includes("https://sitio-malo.example/ingresa") && h.includes("javascript:alert(1)"), "se ve como texto, tal cual");
  });
});

describe("página no disponible", () => {
  it("dice con claridad que no se pudo cargar y se lee como una pantalla (un h1)", () => {
    const h = renderToStaticMarkup(<PaginaNoDisponible />);
    assert.equal(cuenta(h, /<h1[ >]/g), 1);
    assert.ok(visible(h).includes("Esta página no está disponible en este momento") && visible(h).includes("Vuelve a intentarlo"));
  });
});
