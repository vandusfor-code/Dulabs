/**
 * Administración de tienda — helpers puros del borrador y de la presentación (sin pantalla).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SECCIONES_POR_DEFECTO, aNumero, borradorInicial, leer, mismoContenido, mover, poner } from "@/components/dashboard/tienda/borrador";
import { ACCION_CORTA, ACCION_CORTA_EN, NOMBRES_SECCION, NOMBRES_TIPO, TEXTO_CHIP_EN, chipsDe, fechaHora, objetoDeAuditoria, resumirCambios } from "@/components/dashboard/tienda/formato";
import { ACCIONES_AUDITORIA, SECCIONES_HOME, TIPOS_ENTIDAD } from "@/lib/cms-comercial/contrato";
import { normalizarBorrador } from "@/lib/cms-comercial/esquemas";

describe("leer / poner (sin mutar)", () => {
  const base = { nombre: "Amor", beneficio: { tipo: "porcentaje", valor: 15 }, alcance: { referencias: ["DL-1", "DL-2"] } };

  it("lee rutas con puntos e índices; lo que no existe es undefined", () => {
    assert.equal(leer(base, "beneficio.valor"), 15);
    assert.equal(leer(base, "alcance.referencias.1"), "DL-2");
    assert.equal(leer(base, "alcance.nada.mas"), undefined);
    assert.equal(leer(null, "a"), undefined);
    assert.equal(leer("texto", "a"), undefined);
  });

  it("pone un valor en una copia y deja el original intacto", () => {
    const copia = poner(base, "beneficio.valor", 20);
    assert.equal(leer(copia, "beneficio.valor"), 20);
    assert.equal(base.beneficio.valor, 15);
    assert.notEqual(copia, base);
    assert.notEqual(copia.beneficio, base.beneficio);
    assert.equal(copia.alcance, base.alcance, "lo que no cambió se comparte");
  });

  it("crea los objetos intermedios que falten", () => {
    assert.deepEqual(poner({}, "vigencia.desde", "2026-10-25"), { vigencia: { desde: "2026-10-25" } });
    assert.deepEqual(poner({}, "portada.boton.destino.tipo", "catalogo"), { portada: { boton: { destino: { tipo: "catalogo" } } } });
  });

  it("un valor vacío (undefined, null, «», NaN) QUITA la clave, y los objetos que quedan vacíos también", () => {
    for (const vacio of [undefined, null, "", Number.NaN]) assert.equal("nombre" in poner(base, "nombre", vacio), false, String(vacio));
    assert.deepEqual(poner({ vigencia: { desde: "2026-10-25" }, nombre: "x" }, "vigencia.desde", ""), { nombre: "x" });
    assert.deepEqual(poner(base, "beneficio.valor", undefined).beneficio, { tipo: "porcentaje" });
    assert.equal(poner({ a: 0 }, "a", 0).a, 0, "el cero es un valor, no un vacío");
    assert.equal(poner({ a: true }, "a", false).a, false, "false es un valor");
  });

  it("trabaja con listas: reemplaza, quita por índice y acepta listas enteras (incluso vacías)", () => {
    assert.deepEqual(leer(poner(base, "alcance.referencias.0", "DL-9"), "alcance.referencias"), ["DL-9", "DL-2"]);
    assert.deepEqual(leer(poner(base, "alcance.referencias.0", undefined), "alcance.referencias"), ["DL-2"]);
    assert.deepEqual(leer(poner(base, "alcance.referencias", []), "alcance.referencias"), []);
    assert.deepEqual(base.alcance.referencias, ["DL-1", "DL-2"]);
  });
});

describe("mover y aNumero", () => {
  it("mueve un elemento arriba o abajo sin salirse de la lista ni mutarla", () => {
    const l = ["a", "b", "c"];
    assert.deepEqual(mover(l, 1, -1), ["b", "a", "c"]);
    assert.deepEqual(mover(l, 1, 1), ["a", "c", "b"]);
    assert.deepEqual(mover(l, 0, -1), ["a", "b", "c"]);
    assert.deepEqual(mover(l, 2, 1), ["a", "b", "c"]);
    assert.deepEqual(mover(l, 9, 1), ["a", "b", "c"]);
    assert.deepEqual(l, ["a", "b", "c"]);
  });

  it("convierte lo escrito en un campo de número (con $, puntos de miles y coma decimal)", () => {
    assert.equal(aNumero("15"), 15);
    assert.equal(aNumero(" 15 "), 15);
    assert.equal(aNumero("$ 12.500"), 12500);
    assert.equal(aNumero("750.000"), 750000);
    assert.equal(aNumero("12,5"), 12.5);
    assert.equal(aNumero(""), undefined);
    assert.equal(aNumero("   "), undefined);
    assert.ok(Number.isNaN(aNumero("abc")));
  });
});

describe("borradorInicial y mismoContenido", () => {
  it("cada tipo arranca con lo mínimo y el servidor lo acepta como borrador", () => {
    for (const tipo of TIPOS_ENTIDAD) assert.ok(normalizarBorrador(tipo, borradorInicial(tipo)).ok, tipo);
    assert.deepEqual(SECCIONES_POR_DEFECTO.map((s) => s.tipo), [...SECCIONES_HOME]);
    assert.deepEqual((borradorInicial("home").secciones as Array<{ visible: boolean }>).filter((s) => s.visible).length, 2);
  });

  it("dos borradores son «lo mismo» si el servidor los guardaría igual", () => {
    assert.equal(mismoContenido("oferta", { nombre: "Amor", descripcion: "" }, { nombre: " Amor " }), true);
    assert.equal(mismoContenido("oferta", { a: 1, nombre: "x" }.nombre ? { nombre: "x", prioridad: 1 } : {}, { prioridad: 1, nombre: "x" }), true, "el orden de las claves no importa");
    assert.equal(mismoContenido("oferta", { nombre: "Amor" }, { nombre: "Amor y amistad" }), false);
    assert.equal(mismoContenido("oferta", { alcance: { referencias: ["a", "b"] } }, { alcance: { referencias: ["b", "a"] } }), false, "el orden de una lista sí importa");
  });
});

describe("chipsDe — cómo se describe un elemento", () => {
  const r = (over: Partial<Parameters<typeof chipsDe>[0]> = {}) => chipsDe({ estado: "publicada", estadoVigencia: "vigente", archivada: false, tieneCambios: false, ...over });

  it("borrador, publicada y pausada", () => {
    assert.deepEqual(r({ estado: "borrador", estadoVigencia: null }), [{ texto: "Borrador", tono: "neutral" }]);
    assert.deepEqual(r(), [{ texto: "Publicada", tono: "success" }]);
    assert.deepEqual(r({ estado: "pausada" }), [{ texto: "Pausada", tono: "warning" }]);
  });

  it("avisa de lo vencido y de lo programado SOLO si está en vivo", () => {
    assert.deepEqual(r({ estadoVigencia: "vencida" }), [{ texto: "Publicada", tono: "success" }, { texto: "Vencida", tono: "danger" }]);
    assert.deepEqual(r({ estadoVigencia: "programada" }), [{ texto: "Publicada", tono: "success" }, { texto: "Programada", tono: "info" }]);
    assert.deepEqual(r({ estado: "borrador", estadoVigencia: "vencida" }), [{ texto: "Borrador", tono: "neutral" }], "un borrador no está en vivo: no «venció»");
    assert.deepEqual(r({ estadoVigencia: "sin_limite" }), [{ texto: "Publicada", tono: "success" }]);
  });

  it("los cambios sin publicar solo se marcan si hay algo en vivo; archivada manda sobre todo", () => {
    assert.deepEqual(r({ tieneCambios: true }).map((c) => c.texto), ["Publicada", "Cambios sin publicar"]);
    assert.deepEqual(r({ estado: "borrador", tieneCambios: true, estadoVigencia: null }).map((c) => c.texto), ["Borrador"]);
    assert.deepEqual(r({ archivada: true, tieneCambios: true, estado: "borrador" }), [{ texto: "Archivada", tono: "neutral" }]);
  });
});

describe("etiquetas y fechas", () => {
  it("hay etiqueta (en español y en inglés) para cada acción y nombre para cada tipo", () => {
    for (const a of ACCIONES_AUDITORIA) assert.ok(ACCION_CORTA[a] && ACCION_CORTA_EN[a], a);
    for (const t of TIPOS_ENTIDAD) assert.ok(NOMBRES_TIPO[t].singular && NOMBRES_TIPO[t].nuevo && NOMBRES_TIPO[t].singularEn && NOMBRES_TIPO[t].nuevoEn && NOMBRES_TIPO[t].pluralEn, t);
  });

  it("todo texto de chip que puede salir tiene su versión en inglés", () => {
    const estados = ["borrador", "publicada", "pausada"] as const;
    const vigencias = ["sin_limite", "programada", "vigente", "vencida", null] as const;
    const textos = new Set<string>();
    for (const estado of estados) for (const estadoVigencia of vigencias) for (const archivada of [false, true]) for (const tieneCambios of [false, true]) for (const c of chipsDe({ estado, estadoVigencia, archivada, tieneCambios })) textos.add(c.texto);
    assert.ok(textos.size >= 6, [...textos].join(", "));
    for (const t of textos) assert.ok(TEXTO_CHIP_EN[t], `falta la traducción de «${t}»`);
  });

  it("muestra las fechas en hora de Bogotá", () => {
    const f = fechaHora("2026-10-28T22:30:00.000Z"); // 5:30 p. m. en Bogotá
    assert.match(f, /28/);
    assert.match(f, /2026/);
    assert.match(f, /5:30/);
    assert.equal(fechaHora(null), "—");
    assert.equal(fechaHora("no es fecha"), "—");
  });

  it("la versión corta de cada acción también existe, y cada sección de la página principal tiene nombre en español e inglés", () => {
    for (const a of ACCIONES_AUDITORIA) assert.ok(ACCION_CORTA[a] && !/ de$/.test(ACCION_CORTA[a]), a);
    for (const s of SECCIONES_HOME) assert.ok(NOMBRES_SECCION[s].es && NOMBRES_SECCION[s].en, s);
  });

  it("el historial general dice a qué se refiere cada registro (el nombre sale del contenido; las imágenes y las acciones sin contenido, solo el tipo)", () => {
    assert.equal(objetoDeAuditoria({ entidadTipo: "home", antes: null, despues: null }), "Página principal");
    assert.equal(objetoDeAuditoria({ entidadTipo: "oferta", antes: null, despues: { nombre: " Amor y Amistad " } }), "Oferta: Amor y Amistad");
    assert.equal(objetoDeAuditoria({ entidadTipo: "oferta", antes: { nombre: "Antes" }, despues: { estado: "pausada" } }), "Oferta", "pausar guarda solo el estado: sin nombre");
    assert.equal(objetoDeAuditoria({ entidadTipo: "contenido", antes: null, despues: { titulo: "¿Hacen envíos?" } }), "Contenido: ¿Hacen envíos?");
    assert.equal(objetoDeAuditoria({ entidadTipo: "combo", antes: null, despues: null }), "Combo");
    assert.equal(objetoDeAuditoria({ entidadTipo: "imagen", antes: null, despues: { nombre: "x" } }), "");
  });
});

describe("resumirCambios — el «20% → 25%» del historial", () => {
  it("dice qué campo cambió, de qué a qué, con el formato correcto", () => {
    const antes = { nombre: "Amor", beneficio: { tipo: "porcentaje", valor: 20 }, vigencia: { desde: "2026-10-25", hasta: "2026-10-31" } };
    const despues = { nombre: "Amor", beneficio: { tipo: "porcentaje", valor: 25 }, vigencia: { desde: "2026-10-25", hasta: "2026-11-05" } };
    assert.deepEqual(resumirCambios(antes, despues), [
      { campo: "Porcentaje de descuento", antes: "20%", despues: "25%" },
      { campo: "Fecha de fin", antes: "2026-10-31", despues: "2026-11-05" },
    ]);
  });

  it("formatea pesos y listas; lo agregado o quitado aparece con «—»", () => {
    const r = resumirCambios({ precio: { detal: 90000 }, componentes: [{ referencia: "A", cantidad: 1 }] }, { precio: { detal: 85000, mayorista: 60000 }, componentes: [{ referencia: "A", cantidad: 2 }] });
    assert.ok(r.some((c) => c.campo === "Precio para clientes detal" && c.antes === "$90.000" && c.despues === "$85.000"));
    assert.ok(r.some((c) => c.campo === "Precio para clientes mayoristas" && c.antes === "—" && c.despues === "$60.000"));
    assert.ok(r.some((c) => c.campo === "Productos del combo" && c.antes === "1 × A" && c.despues === "2 × A"), "una cantidad no es un precio: se ve como «2 × A»");
    const listas = resumirCambios({ alcance: { referencias: ["DL-1"] } }, { alcance: { referencias: ["DL-1", "DL-2"] } });
    assert.deepEqual(listas, [{ campo: "Productos", antes: "DL-1", despues: "DL-1, DL-2" }]);
  });

  it("sin cambios no hay nada; con un contenido nuevo (antes vacío) muestra los campos; limita la cantidad; trunca textos largos", () => {
    assert.deepEqual(resumirCambios({ a: 1 }, { a: 1 }), []);
    assert.deepEqual(resumirCambios(null, undefined), []);
    const nuevo = resumirCambios(null, { nombre: "Nueva", prioridad: 3, modalidad: "ambas" });
    assert.deepEqual(nuevo.map((c) => c.antes), ["—", "—", "—"]);
    const muchos = resumirCambios({}, Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`campo${i}`, i + 1])), 4);
    assert.equal(muchos.length, 4);
    const largo = resumirCambios({ texto: "a" }, { texto: "x".repeat(200) });
    assert.ok(largo[0].despues.length <= 90 && largo[0].despues.endsWith("…"));
    assert.deepEqual(resumirCambios({ activo: false }, { activo: true }), [{ campo: "activo", antes: "No", despues: "Sí" }]);
  });
});

describe("resumirCambios — lectura clara para la administradora", () => {
  const CAT_1 = "c0000000-0000-4000-8000-0000000000a1";
  const CAT_2 = "c0000000-0000-4000-8000-0000000000a2";

  it("las secciones de la página principal se resumen por nombre y en orden (solo las que se muestran), no una fila por clave interna", () => {
    const antes = { secciones: [{ tipo: "portada", visible: true }, { tipo: "destacados", visible: true }, { tipo: "banner", visible: false }] };
    const despues = { secciones: [{ tipo: "portada", visible: true }, { tipo: "banner", visible: true }, { tipo: "destacados", visible: true }] };
    assert.deepEqual(resumirCambios(antes, despues), [{ campo: "Secciones que se muestran", antes: "Portada, Productos destacados", despues: "Portada, Banner, Productos destacados" }]);
    assert.deepEqual(resumirCambios(antes, antes), []);
    // ocultar una sección que ya estaba oculta no es un cambio
    assert.deepEqual(resumirCambios({ secciones: [{ tipo: "portada", visible: true }, { tipo: "banner", visible: false }] }, { secciones: [{ tipo: "portada", visible: true }, { tipo: "combos", visible: false }] }), []);
  });

  it("las categorías se muestran por nombre cuando se conocen (y por su código si no)", () => {
    const categorias = [{ id: CAT_1, nombre: "Aretes" }, { id: CAT_2, nombre: "Dijes" }];
    const r = resumirCambios({ categorias_destacadas: [CAT_1] }, { categorias_destacadas: [CAT_1, CAT_2] }, 6, { categorias });
    assert.deepEqual(r, [{ campo: "Categorías destacadas", antes: "Aretes", despues: "Aretes, Dijes" }]);
    const sinNombres = resumirCambios({ categorias_destacadas: [CAT_1] }, { categorias_destacadas: [CAT_1, CAT_2] });
    assert.equal(sinNombres[0].despues, `${CAT_1}, ${CAT_2}`);
  });

  it("una imagen se dice «imagen anterior → imagen nueva» (nunca su código ni sus datos técnicos) y su descripción sí se compara", () => {
    const img = (asset: string, alt: string) => ({ origen: "cms", asset, alt, foco: "50% 50%" });
    const a1 = "11111111-1111-4111-8111-111111111111";
    const a2 = "22222222-2222-4222-8222-222222222222";
    const r = resumirCambios({ portada: { imagen: img(a1, "Collar") } }, { portada: { imagen: img(a2, "Collar dorado") } });
    assert.deepEqual(r, [
      { campo: "Imagen de la portada", antes: "imagen anterior", despues: "imagen nueva" },
      { campo: "Descripción de «Imagen de la portada»", antes: "Collar", despues: "Collar dorado" },
    ]);
    assert.deepEqual(resumirCambios({ banner: { visible: true } }, { banner: { visible: true, imagen: img(a1, "Banner") } }).map((c) => [c.campo, c.antes, c.despues]), [
      ["Imagen del banner", "—", "imagen nueva"],
      ["Descripción de «Imagen del banner»", "—", "Banner"],
    ]);
    // los datos técnicos de una imagen estática no aparecen
    const estatica = (src: string) => ({ origen: "estatico", src, ancho: 800, alto: 400, alt: "Portada" });
    assert.deepEqual(resumirCambios({ portada: { imagen: estatica("/catalogo/tienda/a.webp") } }, { portada: { imagen: estatica("/catalogo/tienda/b.webp") } }), []);
  });

  it("el destino de un botón y los valores de lista se leen en español (modalidad, beneficio, tema, audiencia)", () => {
    const r = resumirCambios(
      { modalidad: "ambas", beneficio: { tipo: "porcentaje" }, portada: { boton: { destino: { tipo: "catalogo" } } }, banner: { destino: { tipo: "busqueda", consulta: "anillos" } }, tema: "faq", audiencia: "todos" },
      { modalidad: "mayorista", beneficio: { tipo: "precio_especial" }, portada: { boton: { destino: { tipo: "whatsapp" } } }, banner: { destino: { tipo: "busqueda", consulta: "dijes" } }, tema: "mayoristas", audiencia: "mayorista" },
      12,
    );
    const mapa = new Map(r.map((c) => [c.campo, `${c.antes} → ${c.despues}`]));
    assert.equal(mapa.get("Modalidad"), "Ambas → Mayorista");
    assert.equal(mapa.get("Tipo de beneficio"), "Porcentaje → Precio especial");
    assert.equal(mapa.get("Destino del botón"), "Todo el catálogo → WhatsApp");
    assert.equal(mapa.get("Destino del banner · búsqueda"), "anillos → dijes");
    assert.equal(mapa.get("Tema"), "Preguntas frecuentes → Mayoristas");
    assert.equal(mapa.get("Audiencia"), "Todos → Solo mayorista");
  });

  it("nunca repite el nombre de un campo en un mismo resumen (la pantalla usa el nombre como clave de la fila)", () => {
    const r = resumirCambios(
      { componentes: [{ referencia: "A", cantidad: 1 }, { referencia: "B", cantidad: 1 }], secciones: [{ tipo: "portada", visible: true }, { tipo: "combos", visible: true }] },
      { componentes: [{ referencia: "A", cantidad: 2 }, { referencia: "B", cantidad: 3 }], secciones: [{ tipo: "combos", visible: true }, { tipo: "portada", visible: true }] },
      12,
    );
    const nombres = r.map((c) => c.campo);
    assert.equal(new Set(nombres).size, nombres.length, nombres.join(" | "));
    assert.equal(r.find((c) => c.campo === "Productos del combo")?.despues, "2 × A, 3 × B");
  });
});
