/**
 * Tests de construirComponentesPlantilla -- la lógica pura que arma el
 * payload `components` exacto que exige la API de Meta para crear una
 * plantilla. Sin red: separado a propósito de crearPlantillaMeta (que solo
 * hace fetch con este resultado) para poder probarlo sin mockear fetch.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { construirComponentesPlantilla, contarVariablesPlantilla, normalizarNombrePlantilla } from "@/lib/meta-templates";

describe("construirComponentesPlantilla", () => {
  it("solo BODY cuando no hay footer/header/botones/variables", () => {
    const components = construirComponentesPlantilla({ cuerpo: "Hola, gracias por tu compra." });
    assert.deepEqual(components, [{ type: "BODY", text: "Hola, gracias por tu compra." }]);
  });

  it("orden exacto que exige Meta: HEADER, BODY, FOOTER, BUTTONS", () => {
    const components = construirComponentesPlantilla({
      cuerpo: "Hola {{1}}",
      ejemplosVariables: ["Ana"],
      footer: "Gracias por tu preferencia",
      header: { formato: "TEXT", texto: "Bienvenida" },
      botones: ["Ver más"],
    });
    assert.deepEqual(
      components.map((c) => c.type),
      ["HEADER", "BODY", "FOOTER", "BUTTONS"],
    );
  });

  it("header de texto SIN variable no lleva example", () => {
    const components = construirComponentesPlantilla({ cuerpo: "Hola", header: { formato: "TEXT", texto: "Bienvenida" } });
    assert.deepEqual(components[0], { type: "HEADER", format: "TEXT", text: "Bienvenida" });
  });

  it("header de texto CON variable {{1}} lleva example.header_text", () => {
    const components = construirComponentesPlantilla({
      cuerpo: "Hola",
      header: { formato: "TEXT", texto: "Hola {{1}}", ejemploTexto: "Ana" },
    });
    assert.deepEqual(components[0], {
      type: "HEADER",
      format: "TEXT",
      text: "Hola {{1}}",
      example: { header_text: ["Ana"] },
    });
  });

  it("header de imagen usa example.header_handle (nunca el texto)", () => {
    const components = construirComponentesPlantilla({
      cuerpo: "Hola",
      header: { formato: "IMAGE", ejemploHandle: "handle-abc123" },
    });
    assert.deepEqual(components[0], { type: "HEADER", format: "IMAGE", example: { header_handle: ["handle-abc123"] } });
  });

  it("header de imagen SIN ejemploHandle no agrega el componente (evita mandar un HEADER inválido a Meta)", () => {
    const components = construirComponentesPlantilla({ cuerpo: "Hola", header: { formato: "IMAGE" } });
    assert.deepEqual(components, [{ type: "BODY", text: "Hola" }]);
  });

  it("BODY con variables lleva example.body_text como array de arrays", () => {
    const components = construirComponentesPlantilla({
      cuerpo: "Hola {{1}}, tu pedido {{2}} está listo",
      ejemplosVariables: ["Ana", "#4521"],
    });
    assert.deepEqual(components[0], {
      type: "BODY",
      text: "Hola {{1}}, tu pedido {{2}} está listo",
      example: { body_text: [["Ana", "#4521"]] },
    });
  });

  it("footer vacío o solo espacios no agrega el componente", () => {
    const components = construirComponentesPlantilla({ cuerpo: "Hola", footer: "   " });
    assert.equal(components.some((c) => c.type === "FOOTER"), false);
  });

  it("botones QUICK_REPLY: hasta 3, recortados a 25 caracteres", () => {
    const components = construirComponentesPlantilla({
      cuerpo: "Hola",
      botones: ["Uno", "Dos", "Tres", "Cuatro (no debe aparecer)"],
    });
    const buttons = components.find((c) => c.type === "BUTTONS")!.buttons as { type: string; text: string }[];
    assert.equal(buttons.length, 3);
    assert.deepEqual(buttons, [
      { type: "QUICK_REPLY", text: "Uno" },
      { type: "QUICK_REPLY", text: "Dos" },
      { type: "QUICK_REPLY", text: "Tres" },
    ]);
  });

  it("botones de llamada a la acción: URL y PHONE_NUMBER con su campo correcto", () => {
    const components = construirComponentesPlantilla({
      cuerpo: "Hola",
      botonesCta: [
        { tipo: "URL", texto: "Ver sitio", valor: "https://dulabs.co" },
        { tipo: "PHONE_NUMBER", texto: "Llamar", valor: "+573001234567" },
      ],
    });
    const buttons = components.find((c) => c.type === "BUTTONS")!.buttons as Record<string, string>[];
    assert.deepEqual(buttons, [
      { type: "URL", text: "Ver sitio", url: "https://dulabs.co" },
      { type: "PHONE_NUMBER", text: "Llamar", phone_number: "+573001234567" },
    ]);
  });

  it("mezcla QUICK_REPLY + CTA en el mismo componente BUTTONS, QUICK_REPLY primero", () => {
    const components = construirComponentesPlantilla({
      cuerpo: "Hola",
      botones: ["Sí"],
      botonesCta: [{ tipo: "URL", texto: "Ver más", valor: "https://dulabs.co" }],
    });
    const buttons = components.find((c) => c.type === "BUTTONS")!.buttons as { type: string }[];
    assert.deepEqual(
      buttons.map((b) => b.type),
      ["QUICK_REPLY", "URL"],
    );
  });

  it("sin botones de ningún tipo -> no agrega el componente BUTTONS", () => {
    const components = construirComponentesPlantilla({ cuerpo: "Hola" });
    assert.equal(components.some((c) => c.type === "BUTTONS"), false);
  });
});

describe("contarVariablesPlantilla (reutilizada por la validación de creación)", () => {
  it("cuenta variables únicas {{n}}", () => {
    assert.equal(contarVariablesPlantilla("Hola {{1}}, tu pedido {{2}} de {{1}} está listo"), 2);
  });
  it("0 si no hay ninguna", () => {
    assert.equal(contarVariablesPlantilla("Hola, gracias por tu compra."), 0);
  });
});

describe("normalizarNombrePlantilla", () => {
  it("colapsa espacios/tildes/ñ a guion bajo y pasa a minúsculas", () => {
    assert.equal(normalizarNombrePlantilla("Promoción Año Nuevo"), "promoci_n_a_o_nuevo");
  });
});
