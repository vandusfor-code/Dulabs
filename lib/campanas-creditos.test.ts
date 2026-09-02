/**
 * Tests de las funciones puras de créditos de mensajes masivos. Cubre los
 * 8 escenarios pedidos (los que dependen de Supabase real -- reserva
 * atómica, condición de carrera -- se verifican en producción con datos
 * reales, ver reporte; acá se prueba la lógica que sí es pura).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alcanzaSaldo, mensajeSaldoInsuficiente } from "@/lib/campanas-creditos";

describe("alcanzaSaldo", () => {
  it("TEST 1: 500 disponibles, campaña de 100 -> alcanza", () => {
    assert.equal(alcanzaSaldo(500, 100), true);
  });

  it("TEST 2: 400 disponibles, campaña de 250 -> alcanza", () => {
    assert.equal(alcanzaSaldo(400, 250), true);
  });

  it("TEST 3: 150 disponibles, campaña de 150 -> alcanza justo (límite exacto)", () => {
    assert.equal(alcanzaSaldo(150, 150), true);
  });

  it("TEST 4: 0 disponibles, campaña de 1 -> NO alcanza", () => {
    assert.equal(alcanzaSaldo(0, 1), false);
  });

  it("TEST 5: 80 disponibles, campaña de 100 -> NO alcanza (se bloquea completa, no se envían 80)", () => {
    assert.equal(alcanzaSaldo(80, 100), false);
  });
});

describe("mensajeSaldoInsuficiente", () => {
  it("usa exactamente el texto pedido, con los números reales", () => {
    assert.equal(
      mensajeSaldoInsuficiente(80, 100),
      "Has alcanzado el límite de mensajes disponibles para tu cuenta. Actualmente tienes 80 mensajes de cortesía disponibles, pero esta campaña requiere 100. Reduce la cantidad de destinatarios o adquiere un nuevo paquete de mensajes.",
    );
  });

  it("funciona igual con saldo en 0", () => {
    assert.equal(
      mensajeSaldoInsuficiente(0, 1),
      "Has alcanzado el límite de mensajes disponibles para tu cuenta. Actualmente tienes 0 mensajes de cortesía disponibles, pero esta campaña requiere 1. Reduce la cantidad de destinatarios o adquiere un nuevo paquete de mensajes.",
    );
  });
});
