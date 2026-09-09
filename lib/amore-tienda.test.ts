/**
 * Módulo Inventario (autorizado) — link "Comprar" de la tienda pública.
 * Verifica que el mensaje generado sea EXACTAMENTE el que
 * extraerProductoDeLinkTienda (lib/amore-entrada-gemini.ts) reconoce, y que
 * caracteres especiales/acentos/emoji queden correctamente codificados en la
 * URL de wa.me.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { construirLinkComprarWhatsApp, obtenerNumeroWhatsappAmore } from "@/lib/amore-tienda";
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

// Hallazgo real post-deploy (autorizado): dulabs_clientes_config.telefono_negocio
// es un placeholder nunca poblado para AMORE (WhatsApp-QR) -- el número real
// vive en dulabs_whatsapp_qr_sesiones.numero_conectado con sufijo ":N".
describe("obtenerNumeroWhatsappAmore", () => {
  function crearFakeSupabaseSesion(fila: { estado: string; numero_conectado: string | null } | null) {
    const from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: fila, error: null }),
        }),
      }),
    });
    return { from } as unknown as SupabaseClient;
  }

  it("recorta el sufijo ':N' de dispositivo de Baileys y deja solo dígitos", async () => {
    const supabase = crearFakeSupabaseSesion({ estado: "conectado", numero_conectado: "573012276334:1" });
    const numero = await obtenerNumeroWhatsappAmore(supabase, "tenant-1");
    assert.equal(numero, "573012276334");
  });

  it("devuelve null si el estado no es 'conectado' (nunca inventa un número)", async () => {
    const supabase = crearFakeSupabaseSesion({ estado: "desconectado", numero_conectado: "573012276334:1" });
    const numero = await obtenerNumeroWhatsappAmore(supabase, "tenant-1");
    assert.equal(numero, null);
  });

  it("devuelve null si no hay ninguna sesión registrada", async () => {
    const supabase = crearFakeSupabaseSesion(null);
    const numero = await obtenerNumeroWhatsappAmore(supabase, "tenant-1");
    assert.equal(numero, null);
  });
});
