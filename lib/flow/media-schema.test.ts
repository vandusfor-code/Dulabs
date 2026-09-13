/**
 * FASE F8.4 (WhatsApp Media, autorizado) — validación Zod de
 * flowMediaRefSchema/flowMessageContentSchema: reglas reales de Meta
 * (exactamente uno de url/mediaId, caption solo en image/video/document,
 * filename solo en document, url exige https://).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flowMediaRefSchema, flowMessageContentSchema, flowNodeSchema } from "./schemas";

describe("flowMediaRefSchema (F8.4)", () => {
  it("1. url sola -> válido", () => {
    const r = flowMediaRefSchema.safeParse({ type: "image", url: "https://x/y.jpg" });
    assert.equal(r.success, true);
  });

  it("2. mediaId solo -> válido", () => {
    const r = flowMediaRefSchema.safeParse({ type: "image", mediaId: "abc" });
    assert.equal(r.success, true);
  });

  it("3. url Y mediaId juntos -> inválido (exactamente uno)", () => {
    const r = flowMediaRefSchema.safeParse({ type: "image", url: "https://x/y.jpg", mediaId: "abc" });
    assert.equal(r.success, false);
  });

  it("4. ni url ni mediaId -> inválido", () => {
    const r = flowMediaRefSchema.safeParse({ type: "image" });
    assert.equal(r.success, false);
  });

  it("5. url http:// (no https) -> inválido", () => {
    const r = flowMediaRefSchema.safeParse({ type: "image", url: "http://x/y.jpg" });
    assert.equal(r.success, false);
  });

  it("6. caption en image -> válido", () => {
    const r = flowMediaRefSchema.safeParse({ type: "image", url: "https://x/y.jpg", caption: "hola" });
    assert.equal(r.success, true);
  });

  it("7. caption en video -> válido", () => {
    const r = flowMediaRefSchema.safeParse({ type: "video", url: "https://x/v.mp4", caption: "hola" });
    assert.equal(r.success, true);
  });

  it("8. caption en document -> válido", () => {
    const r = flowMediaRefSchema.safeParse({ type: "document", url: "https://x/f.pdf", caption: "hola" });
    assert.equal(r.success, true);
  });

  it("9. caption en audio -> inválido (Meta no lo admite)", () => {
    const r = flowMediaRefSchema.safeParse({ type: "audio", url: "https://x/a.ogg", caption: "hola" });
    assert.equal(r.success, false);
  });

  it("10. caption en sticker -> inválido", () => {
    const r = flowMediaRefSchema.safeParse({ type: "sticker", mediaId: "abc", caption: "hola" });
    assert.equal(r.success, false);
  });

  it("11. filename en document -> válido", () => {
    const r = flowMediaRefSchema.safeParse({ type: "document", url: "https://x/f.pdf", filename: "f.pdf" });
    assert.equal(r.success, true);
  });

  it("12. filename en image -> inválido (solo document)", () => {
    const r = flowMediaRefSchema.safeParse({ type: "image", url: "https://x/y.jpg", filename: "f.jpg" });
    assert.equal(r.success, false);
  });

  it("13. type=sticker es un valor válido del enum (antes no existía)", () => {
    const r = flowMediaRefSchema.safeParse({ type: "sticker", url: "https://x/s.webp" });
    assert.equal(r.success, true);
  });

  it("14. type inválido (no reconocido por Meta) -> rechazado por el enum", () => {
    const r = flowMediaRefSchema.safeParse({ type: "gif", url: "https://x/g.gif" });
    assert.equal(r.success, false);
  });
});

describe("flowMessageContentSchema con media (F8.4)", () => {
  it("15. solo media, sin text/parts/template -> válido (media cuenta como contenido)", () => {
    const r = flowMessageContentSchema.safeParse({ media: { type: "image", url: "https://x/y.jpg" } });
    assert.equal(r.success, true);
  });

  it("16. media con url inválida (no https) -> inválido, propaga el error del media anidado", () => {
    const r = flowMessageContentSchema.safeParse({ media: { type: "image", url: "ftp://x/y.jpg" } });
    assert.equal(r.success, false);
  });

  it("17. text + media juntos -> válido (caption/text conviven, ej. buttons+media)", () => {
    const r = flowMessageContentSchema.safeParse({ text: "elige", media: { type: "image", url: "https://x/y.jpg" } });
    assert.equal(r.success, true);
  });
});

describe("nodo buttons + media (F8.4, Paso 11)", () => {
  function nodoButtons(media?: unknown) {
    return {
      id: "n1",
      type: "buttons",
      position: { x: 0, y: 0 },
      config: { text: "elige", buttons: [{ id: "b1", label: "Sí" }], ...(media ? { media } : {}) },
    };
  }

  it("18. buttons sin media -> válido (regresión, sin cambios)", () => {
    const r = flowNodeSchema.safeParse(nodoButtons());
    assert.equal(r.success, true);
  });

  it("19. buttons + media type=image -> válido", () => {
    const r = flowNodeSchema.safeParse(nodoButtons({ type: "image", url: "https://x/y.jpg" }));
    assert.equal(r.success, true);
  });

  it("20. buttons + media type=video -> inválido (Meta solo admite header de imagen)", () => {
    const r = flowNodeSchema.safeParse(nodoButtons({ type: "video", url: "https://x/v.mp4" }));
    assert.equal(r.success, false);
  });

  it("21. buttons + media type=document -> inválido", () => {
    const r = flowNodeSchema.safeParse(nodoButtons({ type: "document", url: "https://x/f.pdf" }));
    assert.equal(r.success, false);
  });

  it("22. buttons + media type=sticker -> inválido", () => {
    const r = flowNodeSchema.safeParse(nodoButtons({ type: "sticker", mediaId: "m1" }));
    assert.equal(r.success, false);
  });

  it("23. buttons + media type=audio -> inválido", () => {
    const r = flowNodeSchema.safeParse(nodoButtons({ type: "audio", url: "https://x/a.ogg" }));
    assert.equal(r.success, false);
  });
});
