/**
 * Módulo Inventario (autorizado) — link "Comprar" de la tienda pública.
 * Verifica que el mensaje generado sea EXACTAMENTE el que
 * extraerProductoDeLinkTienda (lib/amore-entrada-gemini.ts) reconoce, y que
 * caracteres especiales/acentos/emoji queden correctamente codificados en la
 * URL de wa.me.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { construirLinkComprarWhatsApp } from "@/lib/amore-tienda";
import { extraerProductoDeLinkTienda } from "@/lib/amore-entrada-gemini";

describe("construirLinkComprarWhatsApp", () => {
  it("genera un link wa.me con el número y el mensaje correctos", () => {
    const link = construirLinkComprarWhatsApp("573001234567", "Kit de Cuidado Capilar");
    assert.match(link, /^https:\/\/wa\.me\/573001234567\?text=/);
  });

  it("el texto decodificado es EXACTAMENTE 'Hola, estoy interesada en este producto: <nombre>'", () => {
    const link = construirLinkComprarWhatsApp("573001234567", "Kit de Cuidado Capilar");
    const texto = decodeURIComponent(link.split("?text=")[1]!);
    assert.equal(texto, "Hola, estoy interesada en este producto: Kit de Cuidado Capilar");
  });

  it("codifica correctamente acentos, ñ y símbolos en el nombre del producto", () => {
    const link = construirLinkComprarWhatsApp("573001234567", "Peiné & Diseño Ñoño 100%");
    const texto = decodeURIComponent(link.split("?text=")[1]!);
    assert.equal(texto, "Hola, estoy interesada en este producto: Peiné & Diseño Ñoño 100%");
  });

  it("el link generado es reconocido por el bot y el nombre se extrae EXACTO (round-trip)", () => {
    const nombre = "Crema Hidratante Facial 50ml";
    const link = construirLinkComprarWhatsApp("573001234567", nombre);
    const textoDecodificado = decodeURIComponent(link.split("?text=")[1]!);
    const extraido = extraerProductoDeLinkTienda(textoDecodificado);
    assert.equal(extraido, nombre);
  });
});
