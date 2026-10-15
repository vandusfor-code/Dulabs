/**
 * Lo que dibuja el pie (pie.ts): el pie de siempre cuando no hay nada publicado, y el publicado resuelto contra lo que la tienda tiene HOY. Lo que importa: la tienda no cambia hasta que se publique
 * un pie propio; nunca un enlace que no lleve a ningún lado; el contacto por WhatsApp sale del número de la tienda; y lo externo solo sale si pasó la revisión de enlaces.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pieSchema, type Pie } from "@/lib/cms-comercial/esquemas";
import { CATEGORIAS_EN_PIE, pieDeRespaldo, pieDesdeCms, pieInicial, textoDerechos, TITULO_CATEGORIAS, TITULO_CONTACTO, TITULO_NAVEGAR, type ContextoPie } from "@/lib/cms-comercial/pie";
import { pie as pieFixture } from "@/lib/cms-comercial/testing/fixtures";

const BASE = "/catalogo/demo";
const WA = "https://wa.me/573001112233?text=Hola";
const categorias = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c0000000-0000-4000-8000-0000000000${String(i + 10).padStart(2, "0")}`, name: `Categoría ${i + 1}` }));
const ctx = (over: Partial<ContextoPie> = {}): ContextoPie => ({ basePath: BASE, listPath: `${BASE}?todo=1`, categorias: categorias(3), whatsappHref: WA, mayoristaHref: `${BASE}/mayoristas`, descripcion: "Diseños únicos para cada momento de tu vida.", ...over });

describe("pieDeRespaldo — el pie de siempre", () => {
  it("«Navegar» con inicio, catálogo y mayoristas; las categorías; el contacto por WhatsApp; sin redes ni derechos propios", () => {
    const v = pieDeRespaldo(ctx());
    assert.equal(v.descripcion, "Diseños únicos para cada momento de tu vida.");
    assert.deepEqual(v.columnas.map((c) => c.titulo), [TITULO_NAVEGAR]);
    assert.deepEqual(v.columnas[0].enlaces, [
      { texto: "Inicio", href: BASE, externo: false },
      { texto: "Todo el catálogo", href: `${BASE}?todo=1`, externo: false },
      { texto: "Mayoristas", href: `${BASE}/mayoristas`, externo: false },
    ]);
    assert.equal(v.categorias?.titulo, TITULO_CATEGORIAS);
    assert.deepEqual(v.categorias?.enlaces.map((e) => e.texto), ["Categoría 1", "Categoría 2", "Categoría 3"]);
    assert.deepEqual(v.contacto, { titulo: TITULO_CONTACTO, whatsapp: WA, email: null, telefono: null, direccion: [], horario: null });
    assert.deepEqual([v.redes, v.derechos], [[], null]);
  });

  it("solo lo que la tienda tiene: sin mayoristas no hay enlace, sin categorías no hay columna, sin WhatsApp no hay contacto, sin frase no hay descripción", () => {
    const v = pieDeRespaldo(ctx({ mayoristaHref: null, categorias: [], whatsappHref: null, descripcion: undefined }));
    assert.deepEqual(v.columnas[0].enlaces.map((e) => e.texto), ["Inicio", "Todo el catálogo"]);
    assert.deepEqual([v.categorias, v.contacto, v.descripcion], [null, null, null]);
  });

  it("con más de 6 categorías lista 6 y suma «Ver todas» (al bloque de categorías del inicio)", () => {
    const v = pieDeRespaldo(ctx({ categorias: categorias(8) }));
    assert.equal(v.categorias?.enlaces.length, CATEGORIAS_EN_PIE + 1);
    assert.deepEqual(v.categorias?.enlaces.at(-1), { texto: "Ver todas", href: `${BASE}#categorias`, externo: false });
    assert.equal(pieDeRespaldo(ctx({ categorias: categorias(6) })).categorias?.enlaces.length, 6, "con exactamente 6 no hace falta «Ver todas»");
  });

  it("los enlaces de categoría llevan su identificador codificado", () => {
    const v = pieDeRespaldo(ctx({ categorias: [{ id: "a b&c", name: "Rara" }] }));
    assert.equal(v.categorias?.enlaces[0].href, `${BASE}?categoria=a%20b%26c`);
  });
});

describe("pieInicial — el borrador con el que arranca la administradora", () => {
  const CASOS: Array<Partial<ContextoPie>> = [
    {},
    { mayoristaHref: null },
    { categorias: [] },
    { categorias: categorias(9) },
    { whatsappHref: null },
    { descripcion: undefined },
    { mayoristaHref: null, categorias: [], whatsappHref: null, descripcion: undefined },
  ];

  it("es un pie válido para el esquema", () => {
    assert.equal(pieSchema.safeParse(pieInicial({ mayoristas: true, descripcion: "Frase" })).success, true);
    assert.equal(pieSchema.safeParse(pieInicial({ mayoristas: false })).success, true);
    assert.deepEqual(pieInicial({ mayoristas: false }).columnas[0].enlaces.map((e) => e.texto), ["Inicio", "Todo el catálogo"]);
    assert.deepEqual(pieInicial({ mayoristas: true }).columnas[0].enlaces.map((e) => e.texto), ["Inicio", "Todo el catálogo", "Mayoristas"]);
  });

  it("publicado tal cual se ve IGUAL que el pie de siempre, en cualquier tienda (la tienda no cambia hasta que ella lo edite)", () => {
    for (const caso of CASOS) {
      const c = ctx(caso);
      const semilla = pieInicial({ mayoristas: c.mayoristaHref !== null, descripcion: c.descripcion });
      assert.deepEqual(pieDesdeCms(pieSchema.parse(semilla), c), pieDeRespaldo(c), JSON.stringify(caso));
    }
  });
});

describe("pieDesdeCms — lo publicado contra lo que la tienda tiene hoy", () => {
  const completo: Pie = {
    descripcion: "Joyas para ti.",
    columnas: [
      {
        titulo: "Navegar",
        enlaces: [
          { texto: "Inicio", destino: { tipo: "inicio" } },
          { texto: "Catálogo", destino: { tipo: "catalogo" } },
          { texto: "Mayoristas", destino: { tipo: "mayoristas" } },
          { texto: "Escríbenos", destino: { tipo: "whatsapp" } },
          { texto: "Categoría 2", destino: { tipo: "categoria", categoria_id: categorias(3)[1].id } },
          { texto: "Privacidad", destino: { tipo: "externo", url: "https://delacour.co/privacidad" } },
        ],
      },
    ],
    mostrar_categorias: false,
    contacto: { whatsapp: true, email: "ventas@delacour.co", telefono: "+57 300 123 4567", direccion: "Carrera 26 # 18-71\nPasto, Nariño", horario: "Lunes a sábado" },
    redes: [{ red: "instagram", url: "https://www.instagram.com/delacour.joyeria" }],
    derechos: "Delacour S.A.S.",
  };

  it("sin nada publicado: el pie de siempre", () => {
    assert.deepEqual(pieDesdeCms(null, ctx()), pieDeRespaldo(ctx()));
  });

  it("cada destino se resuelve a la ruta de la tienda; WhatsApp y lo externo salen en pestaña nueva", () => {
    const v = pieDesdeCms(completo, ctx());
    assert.deepEqual(v.columnas[0].enlaces, [
      { texto: "Inicio", href: BASE, externo: false },
      { texto: "Catálogo", href: `${BASE}?todo=1`, externo: false },
      { texto: "Mayoristas", href: `${BASE}/mayoristas`, externo: false },
      { texto: "Escríbenos", href: WA, externo: true },
      { texto: "Categoría 2", href: `${BASE}?categoria=${categorias(3)[1].id}`, externo: false },
      { texto: "Privacidad", href: "https://delacour.co/privacidad", externo: true },
    ]);
  });

  it("un destino que hoy no existe se omite (mayoristas sin mayoristas, categoría borrada, WhatsApp sin número) y una columna sin enlaces disponibles también", () => {
    const v = pieDesdeCms(completo, ctx({ mayoristaHref: null, whatsappHref: null, categorias: [] }));
    assert.deepEqual(v.columnas[0].enlaces.map((e) => e.texto), ["Inicio", "Catálogo", "Privacidad"]);
    const soloFaltantes: Pie = { ...completo, columnas: [{ titulo: "Nada", enlaces: [{ texto: "Mayoristas", destino: { tipo: "mayoristas" } }] }, completo.columnas[0]] };
    assert.deepEqual(pieDesdeCms(soloFaltantes, ctx({ mayoristaHref: null })).columnas.map((c) => c.titulo), ["Navegar"], "la columna que se queda sin enlaces no sale vacía");
  });

  describe("enlaces a las páginas propias de la tienda", () => {
    const conPagina = (clave: string): Pie => ({ ...pieFixture(), columnas: [{ titulo: "Legal", enlaces: [{ texto: "Privacidad", destino: { tipo: "pagina", clave } }, { texto: "Inicio", destino: { tipo: "inicio" } }] }] });

    it("una página publicada hoy lleva a su dirección dentro de la tienda, en la misma pestaña", () => {
      const v = pieDesdeCms(conPagina("politica-de-privacidad"), ctx({ paginas: ["terminos", "politica-de-privacidad"] }));
      assert.deepEqual(v.columnas[0].enlaces[0], { texto: "Privacidad", href: `${BASE}/p/politica-de-privacidad`, externo: false });
    });

    it("una página que hoy no está publicada (despublicada, pausada, archivada, o ninguna) NO sale: nunca un enlace que lleve a un 404", () => {
      for (const paginas of [[], ["terminos"], undefined]) {
        const v = pieDesdeCms(conPagina("politica-de-privacidad"), ctx({ paginas }));
        assert.deepEqual(v.columnas[0].enlaces.map((e) => e.texto), ["Inicio"], JSON.stringify(paginas));
      }
      const soloPagina: Pie = { ...pieFixture(), columnas: [{ titulo: "Legal", enlaces: [{ texto: "Privacidad", destino: { tipo: "pagina", clave: "politica-de-privacidad" } }] }] };
      assert.deepEqual(pieDesdeCms(soloPagina, ctx({ paginas: [] })).columnas, [], "una columna que se queda sin enlaces no sale vacía");
    });

    it("el código se compara entero: «terminos» no abre «terminos-y-condiciones», ni al revés", () => {
      assert.equal(pieDesdeCms(conPagina("terminos"), ctx({ paginas: ["terminos-y-condiciones"] })).columnas[0].enlaces.length, 1);
      assert.equal(pieDesdeCms(conPagina("terminos-y-condiciones"), ctx({ paginas: ["terminos"] })).columnas[0].enlaces.length, 1);
    });

    it("un pie sin páginas se ve IGUAL con o sin la lista de páginas publicadas (nada cambia hasta que se enlace una)", () => {
      assert.deepEqual(pieDesdeCms(completo, ctx({ paginas: ["terminos"] })), pieDesdeCms(completo, ctx()));
      assert.deepEqual(pieDeRespaldo(ctx({ paginas: ["terminos"] })), pieDeRespaldo(ctx()));
    });
  });

  it("las categorías salen solo si se pide y la tienda las tiene", () => {
    assert.equal(pieDesdeCms(completo, ctx()).categorias, null);
    assert.equal(pieDesdeCms({ ...completo, mostrar_categorias: true }, ctx()).categorias?.enlaces.length, 3);
    assert.equal(pieDesdeCms({ ...completo, mostrar_categorias: true }, ctx({ categorias: [] })).categorias, null);
  });

  it("el contacto: WhatsApp del número de la tienda, correo, teléfono, dirección en líneas y horario", () => {
    const c = pieDesdeCms(completo, ctx()).contacto;
    assert.deepEqual(c, {
      titulo: "Contacto",
      whatsapp: WA,
      email: { texto: "ventas@delacour.co", href: "mailto:ventas@delacour.co" },
      telefono: { texto: "+57 300 123 4567", href: "tel:+573001234567" },
      direccion: ["Carrera 26 # 18-71", "Pasto, Nariño"],
      horario: "Lunes a sábado",
    });
    assert.equal(pieDesdeCms(completo, ctx({ whatsappHref: null })).contacto?.whatsapp, null, "sin número de WhatsApp en la tienda no hay enlace aunque el pie lo pida");
    assert.equal(pieDesdeCms({ ...completo, contacto: { ...completo.contacto!, titulo: "Escríbenos" } }, ctx()).contacto?.titulo, "Escríbenos");
  });

  it("un contacto sin nada que mostrar no sale (por ejemplo, solo «WhatsApp» y la tienda no tiene número)", () => {
    assert.equal(pieDesdeCms({ ...completo, contacto: { whatsapp: true } }, ctx({ whatsappHref: null })).contacto, null);
    assert.equal(pieDesdeCms({ ...completo, contacto: { whatsapp: false } }, ctx()).contacto, null);
    assert.equal(pieDesdeCms({ ...completo, contacto: undefined }, ctx()).contacto, null);
  });

  it("las redes salen con su etiqueta y el usuario deducido de la dirección", () => {
    assert.deepEqual(pieDesdeCms(completo, ctx()).redes, [{ red: "instagram", etiqueta: "Instagram", href: "https://www.instagram.com/delacour.joyeria", usuario: "@delacour.joyeria" }]);
    const facebook = pieDesdeCms({ ...completo, redes: [{ red: "facebook", url: "https://facebook.com/delacour" }] }, ctx()).redes;
    assert.deepEqual(facebook, [{ red: "facebook", etiqueta: "Facebook", href: "https://facebook.com/delacour", usuario: null }]);
  });

  it("cinturón doble: una red o un enlace externo que NO pasa la revisión no sale, aunque llegue hasta aquí (un contenido manipulado a mano)", () => {
    const manipulado = {
      ...completo,
      columnas: [{ titulo: "Legal", enlaces: [{ texto: "Malo", destino: { tipo: "externo", url: "javascript:alert(1)" } }, { texto: "Bueno", destino: { tipo: "externo", url: "https://delacour.co" } }] }],
      redes: [
        { red: "instagram", url: "https://sitio-malo.com/delacour" },
        { red: "tiktok", url: "http://www.tiktok.com/@delacour" },
        { red: "x", url: "https://x.com/delacour" },
      ],
    } as unknown as Pie;
    const v = pieDesdeCms(manipulado, ctx());
    assert.deepEqual(v.columnas[0].enlaces.map((e) => e.texto), ["Bueno"]);
    assert.deepEqual(v.redes.map((r) => r.red), ["x"]);
    for (const e of v.columnas.flatMap((c) => c.enlaces)) assert.ok(e.href.startsWith("/") || e.href.startsWith("https://"), e.href);
  });

  it("un pie mínimo (sin nada) solo trae lo que pidió: nada inventado", () => {
    const v = pieDesdeCms(pieFixture({ mostrar_categorias: false }), ctx());
    assert.deepEqual(v, { descripcion: null, columnas: [], categorias: null, contacto: null, redes: [], derechos: null });
  });

  it("no altera el pie que recibe", () => {
    const copia = structuredClone(completo);
    pieDesdeCms(completo, ctx());
    assert.deepEqual(completo, copia);
  });
});

describe("textoDerechos", () => {
  it("«© año» + lo que escribió la administradora, o «{marca}. Todos los derechos reservados.»", () => {
    assert.equal(textoDerechos("Delacour & Orus", null, 2026), "© 2026 Delacour & Orus. Todos los derechos reservados.");
    assert.equal(textoDerechos("Delacour & Orus", "Delacour S.A.S. NIT 900.123.456-7", 2027), "© 2027 Delacour S.A.S. NIT 900.123.456-7");
  });
});
