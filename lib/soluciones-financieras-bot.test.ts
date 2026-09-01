/**
 * Tests del motor puro del bot comercial de Soluciones Financieras. Cubre
 * los 3 escenarios pedidos (Libre Inversión / Compra de Cartera /
 * Hipotecario) y el aislamiento entre sesiones de distintos clientes.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  crearSesionProducto,
  detectarProductoPorBoton,
  MENSAJE_CHARLOTTE,
  preguntaParaProducto,
  procesarRespuestaProducto,
} from "@/lib/soluciones-financieras-bot";

describe("detectarProductoPorBoton", () => {
  it("reconoce los 3 textos exactos de los botones de la plantilla", () => {
    assert.equal(detectarProductoPorBoton("Info de Libre Inversión"), "libre_inversion");
    assert.equal(detectarProductoPorBoton("Info Compra de Cartera"), "compra_cartera");
    assert.equal(detectarProductoPorBoton("Info Hipotecario"), "hipotecario");
  });

  it("es insensible a mayúsculas/acentos (tap real vs. variante de teclado)", () => {
    assert.equal(detectarProductoPorBoton("info de libre inversion"), "libre_inversion");
    assert.equal(detectarProductoPorBoton("INFO COMPRA DE CARTERA"), "compra_cartera");
    assert.equal(detectarProductoPorBoton("  info hipotecario  "), "hipotecario");
  });

  it("reconoce la versión final de la plantilla (con emoji, sin 'Info')", () => {
    assert.equal(detectarProductoPorBoton("💰 Libre Inversión"), "libre_inversion");
    assert.equal(detectarProductoPorBoton("💳 Compra Cartera"), "compra_cartera");
    assert.equal(detectarProductoPorBoton("🏠 Hipotecario"), "hipotecario");
  });

  it("devuelve null para cualquier otro texto (no interfiere con la IA general)", () => {
    assert.equal(detectarProductoPorBoton("hola"), null);
    assert.equal(detectarProductoPorBoton("Info de Libre"), null);
    assert.equal(detectarProductoPorBoton(""), null);
  });
});

describe("preguntaParaProducto — texto exacto pedido", () => {
  it("libre_inversion", () => {
    assert.equal(preguntaParaProducto("libre_inversion"), "Claro que sí 😊 ¿Me puedes indicar el monto que te gustaría adquirir?");
  });
  it("compra_cartera", () => {
    assert.equal(preguntaParaProducto("compra_cartera"), "Claro 😊 Confírmame, ¿qué obligaciones te gustaría recoger?");
  });
  it("hipotecario", () => {
    assert.equal(
      preguntaParaProducto("hipotecario"),
      "Claro que sí 😊 ¿Me puedes indicar aproximadamente cuánto necesitas para adquirir tu vivienda?",
    );
  });
});

describe("procesarRespuestaProducto", () => {
  it("ESCENARIO 1: libre inversión — respuesta cierra a pendiente_asesor con el mensaje de Charlotte", () => {
    const session = crearSesionProducto("libre_inversion");
    const resultado = procesarRespuestaProducto(session, "$20 millones");
    assert.equal(resultado.accion, "capturado");
    assert.deepEqual(resultado.mensajes, [MENSAJE_CHARLOTTE]);
    assert.equal(resultado.session.estado, "pendiente_asesor");
    assert.equal(resultado.session.respuestaCliente, "$20 millones");
    assert.equal(resultado.session.producto, "libre_inversion");
  });

  it("ESCENARIO 2: compra de cartera — guarda las obligaciones tal cual las escribió el cliente", () => {
    const session = crearSesionProducto("compra_cartera");
    const resultado = procesarRespuestaProducto(session, "Una tarjeta y un crédito de vehículo");
    assert.equal(resultado.accion, "capturado");
    assert.deepEqual(resultado.mensajes, [MENSAJE_CHARLOTTE]);
    assert.equal(resultado.session.respuestaCliente, "Una tarjeta y un crédito de vehículo");
  });

  it("ESCENARIO 3: hipotecario — guarda el monto aproximado", () => {
    const session = crearSesionProducto("hipotecario");
    const resultado = procesarRespuestaProducto(session, "$200 millones");
    assert.equal(resultado.accion, "capturado");
    assert.deepEqual(resultado.mensajes, [MENSAJE_CHARLOTTE]);
    assert.equal(resultado.session.respuestaCliente, "$200 millones");
  });

  it("acepta variantes de formato de monto sin validación exhaustiva (spec explícito)", () => {
    for (const texto of ["20.000.000", "20 millones", "unos 15 millones", "Tengo dos tarjetas", "unos 180 millones"]) {
      const resultado = procesarRespuestaProducto(crearSesionProducto("libre_inversion"), texto);
      assert.equal(resultado.accion, "capturado");
      assert.equal(resultado.session.respuestaCliente, texto);
    }
  });

  it("no repite el handoff ni hace preguntas nuevas si el flujo ya está pendiente_asesor", () => {
    const yaEntregado = procesarRespuestaProducto(crearSesionProducto("hipotecario"), "$200 millones").session;
    const segundoIntento = procesarRespuestaProducto(yaEntregado, "otra pregunta cualquiera");
    assert.equal(segundoIntento.accion, "ya_cerrado");
    assert.deepEqual(segundoIntento.mensajes, []);
    // el estado y la respuesta ya capturada no cambian
    assert.equal(segundoIntento.session.respuestaCliente, "$200 millones");
  });

  it("aislamiento: la sesión de un cliente nunca contamina la de otro (funciones puras, sin estado compartido)", () => {
    const clienteA = crearSesionProducto("libre_inversion");
    const clienteB = crearSesionProducto("hipotecario");

    const resultadoA = procesarRespuestaProducto(clienteA, "$20 millones");
    const resultadoB = procesarRespuestaProducto(clienteB, "$200 millones");

    assert.equal(resultadoA.session.producto, "libre_inversion");
    assert.equal(resultadoA.session.respuestaCliente, "$20 millones");
    assert.equal(resultadoB.session.producto, "hipotecario");
    assert.equal(resultadoB.session.respuestaCliente, "$200 millones");
    // los objetos originales (crearSesionProducto) tampoco se mutaron
    assert.equal(clienteA.respuestaCliente, null);
    assert.equal(clienteB.respuestaCliente, null);
  });
});
