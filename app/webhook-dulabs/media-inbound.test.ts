/**
 * FASE F8.4 (WhatsApp Media inbound, autorizado) — tests de los 3 bloques
 * puros y exportados del webhook (normalizarMediaEntrante,
 * placeholderMediaEntrante, extraerTextoMensajeCrudo) más guardas
 * ESTRUCTURALES del cascade (mismo criterio EXACTO que
 * migracion-amore-orden.test.ts / blacklist-orden.test.ts: procesarCambio()
 * y atenderMensaje() no están exportadas y están fuertemente acopladas a
 * Supabase/Meta reales, así que en vez de ejecutar el flujo completo se
 * verifica su FORMA -- posición relativa de los marcadores reales en el
 * código fuente).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizarMediaEntrante,
  placeholderMediaEntrante,
  extraerTextoMensajeCrudo,
  TIPOS_MEDIA_ENTRANTE,
  type MetaMessage,
} from "./route";

function mensajeBase(overrides: Partial<MetaMessage>): MetaMessage {
  return { from: "573000000000", id: "wamid.1", type: "text", ...overrides };
}

describe("normalizarMediaEntrante — los 5 tipos reales de Meta", () => {
  it("1. image -> mediaId + mimeType + sha256 + caption", () => {
    const m = mensajeBase({ type: "image", image: { id: "media-1", mime_type: "image/jpeg", sha256: "abc", caption: "mira esto" } });
    assert.deepEqual(normalizarMediaEntrante(m), { type: "image", mediaId: "media-1", mimeType: "image/jpeg", sha256: "abc", caption: "mira esto" });
  });

  it("2. image sin caption -> caption undefined (nunca inventa texto)", () => {
    const m = mensajeBase({ type: "image", image: { id: "media-1" } });
    assert.equal(normalizarMediaEntrante(m)?.caption, undefined);
  });

  it("3. video -> mediaId + caption", () => {
    const m = mensajeBase({ type: "video", video: { id: "media-2", mime_type: "video/mp4", caption: "video" } });
    assert.deepEqual(normalizarMediaEntrante(m), { type: "video", mediaId: "media-2", mimeType: "video/mp4", sha256: undefined, caption: "video" });
  });

  it("4. audio -> nunca tiene caption (Meta no lo entrega para audio)", () => {
    const m = mensajeBase({ type: "audio", audio: { id: "media-3", mime_type: "audio/ogg" } });
    const r = normalizarMediaEntrante(m);
    assert.equal(r?.type, "audio");
    assert.equal("caption" in (r as object), false);
  });

  it("5. document -> incluye filename", () => {
    const m = mensajeBase({ type: "document", document: { id: "media-4", filename: "factura.pdf", caption: "tu factura" } });
    assert.deepEqual(normalizarMediaEntrante(m), {
      type: "document",
      mediaId: "media-4",
      mimeType: undefined,
      sha256: undefined,
      caption: "tu factura",
      filename: "factura.pdf",
    });
  });

  it("6. sticker -> mediaId + metadata, sin caption/filename", () => {
    const m = mensajeBase({ type: "sticker", sticker: { id: "media-5", animated: false } });
    assert.deepEqual(normalizarMediaEntrante(m), { type: "sticker", mediaId: "media-5", mimeType: undefined, sha256: undefined });
  });

  it("7. texto normal -> undefined (nunca se confunde con media)", () => {
    assert.equal(normalizarMediaEntrante(mensajeBase({ type: "text", text: { body: "hola" } })), undefined);
  });

  it("8. type de media sin el objeto correspondiente (payload incompleto) -> undefined, nunca inventa un mediaId", () => {
    assert.equal(normalizarMediaEntrante(mensajeBase({ type: "image" })), undefined);
  });
});

describe("placeholderMediaEntrante — solo para logging/Inbox", () => {
  it("9. image con caption -> el caption, no el placeholder genérico", () => {
    assert.equal(placeholderMediaEntrante(mensajeBase({ type: "image", image: { id: "1", caption: "una foto" } })), "una foto");
  });
  it("10. image sin caption -> '[imagen]'", () => {
    assert.equal(placeholderMediaEntrante(mensajeBase({ type: "image", image: { id: "1" } })), "[imagen]");
  });
  it("11. video sin caption -> '[video]'", () => {
    assert.equal(placeholderMediaEntrante(mensajeBase({ type: "video", video: { id: "1" } })), "[video]");
  });
  it("12. audio -> siempre '[audio]' (Meta nunca entrega caption para audio)", () => {
    assert.equal(placeholderMediaEntrante(mensajeBase({ type: "audio", audio: { id: "1" } })), "[audio]");
  });
  it("13. document con caption -> el caption", () => {
    assert.equal(placeholderMediaEntrante(mensajeBase({ type: "document", document: { id: "1", caption: "revisa esto" } })), "revisa esto");
  });
  it("14. document sin caption -> '[documento]'", () => {
    assert.equal(placeholderMediaEntrante(mensajeBase({ type: "document", document: { id: "1" } })), "[documento]");
  });
  it("15. sticker -> siempre '[sticker]'", () => {
    assert.equal(placeholderMediaEntrante(mensajeBase({ type: "sticker", sticker: { id: "1" } })), "[sticker]");
  });
  it("16. tipo no-media -> null", () => {
    assert.equal(placeholderMediaEntrante(mensajeBase({ type: "text", text: { body: "hola" } })), null);
  });
});

describe("extraerTextoMensajeCrudo — placeholder de media gateado (freno de ráfaga)", () => {
  it("17. media SIN incluirPlaceholderMedia (default) -> null, exactamente el comportamiento pre-F8.4", () => {
    assert.equal(extraerTextoMensajeCrudo(mensajeBase({ type: "image", image: { id: "1" } })), null);
  });
  it("18. media CON incluirPlaceholderMedia=true -> placeholder real", () => {
    assert.equal(extraerTextoMensajeCrudo(mensajeBase({ type: "image", image: { id: "1" } }), true), "[imagen]");
  });
  it("19. texto normal -> idéntico con o sin el flag (nunca afecta texto/botón/interactivo)", () => {
    const m = mensajeBase({ type: "text", text: { body: "hola" } });
    assert.equal(extraerTextoMensajeCrudo(m, false), "hola");
    assert.equal(extraerTextoMensajeCrudo(m, true), "hola");
  });
  it("20. botón de plantilla -> idéntico con o sin el flag", () => {
    const m = mensajeBase({ type: "button", button: { text: "Sí" } });
    assert.equal(extraerTextoMensajeCrudo(m, false), extraerTextoMensajeCrudo(m, true));
  });
});

describe("TIPOS_MEDIA_ENTRANTE — set exacto de los 5 tipos reales", () => {
  it("21. contiene exactamente image/video/audio/document/sticker, nada más", () => {
    assert.deepEqual([...TIPOS_MEDIA_ENTRANTE].sort(), ["audio", "document", "image", "sticker", "video"]);
  });
  it("22. text/button/interactive NUNCA están en el set (evitaría relajar el gate de texto por error)", () => {
    for (const t of ["text", "button", "interactive"]) assert.equal(TIPOS_MEDIA_ENTRANTE.has(t), false);
  });
});

// --- Guardas estructurales (mismo criterio que migracion-amore-orden.test.ts) ---

const RUTA_WEBHOOK = join(__dirname, "route.ts");
const fuente = readFileSync(RUTA_WEBHOOK, "utf8");

function posicion(marcador: string): number {
  const i = fuente.indexOf(marcador);
  assert.notEqual(i, -1, `no se encontró el marcador "${marcador}" en route.ts -- ¿se movió o se renombró?`);
  return i;
}

describe("procesarCambio — gate de media hacia Flow (guarda estructural)", () => {
  it("23. media solo pasa el filtro de tipos cuando debeAtenderConFlow && !debeUsarAsistenteDanielaIA (mismo gate que atenderMensaje)", () => {
    const posGate = posicion("const esMediaHaciaFlow =");
    const bloque = fuente.slice(posGate, posGate + 400);
    assert.match(bloque, /TIPOS_MEDIA_ENTRANTE\.has\(mensaje\.type\)/);
    assert.match(bloque, /debeAtenderConFlow\(cliente, telefonoRemitente\)/);
    assert.match(bloque, /!debeUsarAsistenteDanielaIA\(cliente, telefonoRemitente\)/);
  });

  it("24. el filtro de tipos y el de texto vacío respetan esMediaHaciaFlow además de esSolucionesFinancieras (no rompe el carve-out existente)", () => {
    assert.match(
      fuente,
      /if \(mensaje\.type !== "text" && mensaje\.type !== "button" && mensaje\.type !== "interactive" && !esSolucionesFinancieras && !esMediaHaciaFlow\) continue;/,
    );
    assert.match(fuente, /if \(!mensaje\.text\?\.body && !esSolucionesFinancieras && !esMediaHaciaFlow\) continue;/);
  });
});

describe("registrarMensajesEntrantesSincrono — media no contamina el freno de ráfaga de tenants sin Flow", () => {
  it("25. solo hace el lookup liviano de dulabs_clientes_config si el batch trae media (hayMedia)", () => {
    const posFn = posicion("async function registrarMensajesEntrantesSincrono(");
    const posCierre = fuente.indexOf("\n}", posFn);
    const cuerpo = fuente.slice(posFn, posCierre);
    assert.match(cuerpo, /const hayMedia = \(value\.messages \?\? \[\]\)\.some/);
    assert.match(cuerpo, /const procesaraMediaFlow =/);
    assert.match(cuerpo, /debeAtenderConFlow\(clienteParaGateMedia, telefonoRemitente\)/);
  });
});

describe("atenderMensaje — Flow branch: media sin fallback a LEGACY", () => {
  it("26. si Flow no atiende un mensaje de media, se corta (return) en vez de caer a LEGACY (que no soporta media)", () => {
    const posFlowIf = posicion("if (debeAtenderConFlow(cliente, telefonoRemitente) && !debeUsarAsistenteDanielaIA(cliente, telefonoRemitente)) {");
    const posContexto = posicion("const contexto = await resolverContextoMensaje(cliente, destinoWhatsApp);");
    assert.ok(posFlowIf < posContexto, "el bloque Flow debe evaluarse antes del camino LEGACY");
    const bloque = fuente.slice(posFlowIf, posContexto);
    assert.match(bloque, /const media = normalizarMediaEntrante\(mensaje\);/);
    assert.match(bloque, /media,\s*\n\s*\}\);/, "media debe pasarse a atenderMensajeConFlowConFallback");
    assert.match(bloque, /if \(media\) \{[\s\S]*return;/, "debe cortar (return) si Flow no atendió un mensaje de media");
  });

  it("27. gates preservados: blacklist/migración AMORE/encuestas/campañas/onboarding/ia_pausada/ia_restringida_a siguen evaluándose ANTES que el bloque Flow, sin cambios de orden", () => {
    const posFlowIf = posicion("if (debeAtenderConFlow(cliente, telefonoRemitente) && !debeUsarAsistenteDanielaIA(cliente, telefonoRemitente)) {");
    const marcadoresAnteriores = [
      "esTelefonoBloqueado(cliente.ia_numeros_bloqueados, telefonoRemitente)",
      "await atenderMensajeMigracionAmore(cliente, telefonoRemitente, destinoWhatsApp)",
      "await atenderMensajeEncuesta(cliente, mensaje, telefonoRemitente, destinoWhatsApp)",
      "await atenderMensajeCampaña(cliente, mensaje, telefonoRemitente, destinoWhatsApp)",
      "await atenderMensajeSolucionesFinancieras(cliente, mensaje, telefonoRemitente, destinoWhatsApp)",
      "await atenderMensajeOnboarding(cliente, mensaje, telefonoRemitente, destinoWhatsApp)",
      "if (cliente.ia_pausada) {",
      "if (cliente.ia_restringida_a) {",
    ];
    for (const marcador of marcadoresAnteriores) {
      assert.ok(posicion(marcador) < posFlowIf, `${marcador} debe seguir evaluándose antes del bloque Flow`);
    }
  });
});

describe("atenderMensajeEncuesta — defensa en profundidad contra media (sesión de encuesta activa)", () => {
  it("28. si el texto queda vacío (media sin caption bajo una sesión de encuesta activa), retorna false sin tocar la sesión", () => {
    const posFn = posicion("// --- Bot de encuestas (motor determinístico)");
    const posSiguiente = fuente.indexOf("\nasync function atenderMensajeCampaña", posFn);
    const cuerpo = fuente.slice(posFn, posSiguiente);
    assert.match(cuerpo, /const textoUsuario = mensaje\.text\?\.body \?\? "";/);
    assert.match(cuerpo, /if \(!textoUsuario\) return false;/);
  });
});
