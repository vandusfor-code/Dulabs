/** Formato de WhatsApp para el texto del modelo: sin asteriscos a la vista, contenido intacto. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatoWhatsApp } from "@/lib/agente/formato-whatsapp";

describe("formatoWhatsApp", () => {
  it("**negrita** (Markdown) -> *negrita* (WhatsApp): la negrita queda y los asteriscos no se ven", () => {
    assert.equal(formatoWhatsApp("1. **Dije Hoja en Plata** - $11.000 (Ref: DL-000015)"), "1. *Dije Hoja en Plata* - $11.000 (Ref: DL-000015)");
    assert.equal(formatoWhatsApp("__Aretes__ y ~~$50.000~~ $45.000"), "*Aretes* y ~$50.000~ $45.000");
  });

  it("lo que ya está en formato WhatsApp no cambia", () => {
    for (const t of ["*Dije Hoja* - $11.000", "_cursiva_ y ~tachado~", "Precio: $45.000 x 2 = $90.000", "Hola 😊\n\n1. Uno\n2. Dos"]) assert.equal(formatoWhatsApp(t), t);
  });

  it("títulos, viñetas y enlaces de Markdown", () => {
    assert.equal(formatoWhatsApp("### Opciones disponibles"), "*Opciones disponibles*");
    assert.equal(formatoWhatsApp("* Aretes\n* Collar"), "• Aretes\n• Collar");
    assert.equal(formatoWhatsApp("Mira el [catálogo](https://dulabs.co/catalogo/x)"), "Mira el catálogo: https://dulabs.co/catalogo/x");
    assert.equal(formatoWhatsApp("[https://dulabs.co/c](https://dulabs.co/c)"), "https://dulabs.co/c");
  });
});
