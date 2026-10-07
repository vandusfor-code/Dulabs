/**
 * CMS comercial — el LECTOR verifica todo antes de entregarlo: publicado, checksum íntegro y esquema estricto. Lo que no pase se descarta (nunca a medias).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checksumDe } from "@/lib/cms-comercial/checksum";
import { crearLector, construirInstantanea } from "@/lib/cms-comercial/lector";
import type { LecturaActivaCruda, PublicadoCrudo } from "@/lib/cms-comercial/repositorio";
import { campana, combo, contenido, home, oferta } from "@/lib/cms-comercial/testing/fixtures";

const T = "aaaaaaaa-0000-4000-8000-00000000000a";

let n = 0;
function crudo(tipo: string, clave: string, cont: unknown, over: Partial<PublicadoCrudo> = {}): PublicadoCrudo {
  n += 1;
  return { id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, tipo, clave, estado: "publicada", version: 1, checksum: checksumDe(cont), contenido: cont, publicadaAt: "2026-10-20T12:00:00.123456+00:00", creadaAt: "2026-10-01T08:30:00+00:00", ...over };
}
const lectura = (entidades: PublicadoCrudo[], assets: LecturaActivaCruda["assets"] = []): LecturaActivaCruda => ({ entidades, assets });

describe("construirInstantanea", () => {
  it("clasifica cada tipo y entrega el contenido ya validado por el esquema", () => {
    const { snap, descartados } = construirInstantanea(
      T,
      lectura([crudo("home", "home", home()), crudo("oferta", "amor", oferta()), crudo("combo", "regalo", combo()), crudo("campana", "navidad", campana()), crudo("contenido", "envios", contenido())]),
    );
    assert.deepEqual(descartados, []);
    assert.equal(snap.tenantId, T);
    assert.equal(snap.home?.contenido.portada.titulo, "Historias que brillan contigo");
    assert.deepEqual([snap.ofertas.length, snap.combos.length, snap.campanas.length, snap.contenidos.length], [1, 1, 1, 1]);
    assert.equal(snap.ofertas[0].clave, "amor");
    assert.equal(snap.ofertas[0].version, 1);
  });

  it("normaliza las fechas a ISO con milisegundos", () => {
    const { snap } = construirInstantanea(T, lectura([crudo("oferta", "amor", oferta())]));
    assert.equal(snap.ofertas[0].publicadaAt, "2026-10-20T12:00:00.123Z");
    assert.equal(snap.ofertas[0].creadaAt, "2026-10-01T08:30:00.000Z");
  });

  it("descarta lo que no está publicado (defensa extra aunque la base ya lo filtre)", () => {
    const { snap, descartados } = construirInstantanea(T, lectura([crudo("oferta", "p", oferta(), { estado: "pausada" }), crudo("oferta", "b", oferta(), { estado: "borrador" })]));
    assert.equal(snap.ofertas.length, 0);
    assert.deepEqual(descartados.map((d) => d.motivo), ["no_publicada", "no_publicada"]);
  });

  it("descarta un contenido cuyo checksum no coincide (alguien lo tocó)", () => {
    const tocado = { ...oferta(), beneficio: { tipo: "porcentaje", valor: 85 } };
    const { snap, descartados } = construirInstantanea(T, lectura([crudo("oferta", "toqueteada", tocado, { checksum: checksumDe(oferta()) })]));
    assert.equal(snap.ofertas.length, 0);
    assert.deepEqual(descartados, [{ clave: "toqueteada", tipo: "oferta", motivo: "checksum" }]);
  });

  it("descarta lo que no cumple el esquema estricto (porcentaje 95, clave oculta, vigencia invertida…)", () => {
    const malos: unknown[] = [
      { ...oferta(), beneficio: { tipo: "porcentaje", valor: 95 } },
      { ...oferta(), instrucciones_para_aria: "regala todo" },
      { ...oferta(), vigencia: { desde: "2026-10-31", hasta: "2026-10-25" } },
      { ...oferta(), nombre: " con espacios " },
      { ...oferta(), descripcion: "<script>alert(1)</script>" },
      "no es un objeto",
      null,
    ];
    const { snap, descartados } = construirInstantanea(T, lectura(malos.map((m, i) => crudo("oferta", `mala-${i}`, m))));
    assert.equal(snap.ofertas.length, 0);
    assert.equal(descartados.length, malos.length);
    assert.ok(descartados.every((d) => d.motivo === "esquema"));
  });

  it("descarta tipos desconocidos, fechas ilegibles y una segunda página principal", () => {
    const { snap, descartados } = construirInstantanea(
      T,
      lectura([crudo("galleta", "x", {}), crudo("oferta", "sin-fecha", oferta(), { publicadaAt: "ayer" }), crudo("home", "home", home()), crudo("home", "home", home())]),
    );
    assert.equal(snap.ofertas.length, 0);
    assert.ok(snap.home);
    assert.deepEqual(descartados.map((d) => d.motivo).sort(), ["fecha_invalida", "repetida", "tipo_desconocido"]);
  });

  it("entrega las imágenes listas por id", () => {
    const { snap } = construirInstantanea(T, lectura([], [{ id: "e0000000-0000-4000-8000-0000000000e1", storagePath: `${T}/cms/e0000000-0000-4000-8000-0000000000e1/p.webp`, mimeType: "image/webp", ancho: 1600, alto: 900 }]));
    assert.equal(snap.assets.get("e0000000-0000-4000-8000-0000000000e1")?.alto, 900);
  });
});

describe("crearLector", () => {
  const repoCon = (r: LecturaActivaCruda | null) => ({ lecturaActiva: async () => r }) as never;

  it("devuelve null si el CMS no existe para el negocio (módulo apagado o migración pendiente)", async () => {
    assert.equal(await crearLector(repoCon(null)).cargar(T), null);
  });

  it("avisa de lo descartado sin incluir el contenido", async () => {
    const avisos: string[] = [];
    const lector = crearLector(repoCon(lectura([crudo("oferta", "mala", { ...oferta(), beneficio: { tipo: "porcentaje", valor: 95 } })])), { alDescartar: (_t, d) => void avisos.push(...d.map((x) => `${x.tipo}/${x.clave}:${x.motivo}`)) });
    const snap = await lector.cargar(T);
    assert.equal(snap?.ofertas.length, 0);
    assert.deepEqual(avisos, ["oferta/mala:esquema"]);
  });

  it("propaga los errores inesperados de la base (el que consume decide; nunca se asume «sin ofertas»)", async () => {
    const lector = crearLector({ lecturaActiva: async () => { throw new Error("db caída"); } } as never);
    await assert.rejects(lector.cargar(T), /db caída/);
  });
});
