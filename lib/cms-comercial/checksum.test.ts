/**
 * CMS comercial — checksum canónico: el mismo contenido da siempre el mismo valor, sin importar el orden de las claves ni cómo lo reordene jsonb.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checksumDe, jsonCanonico } from "@/lib/cms-comercial/checksum";

describe("jsonCanonico", () => {
  it("ordena las claves en todos los niveles y no deja espacios", () => {
    assert.equal(jsonCanonico({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } }), '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it("conserva el orden de las listas (importa: el orden de los destacados es contenido)", () => {
    assert.notEqual(jsonCanonico({ l: ["DL-000002", "DL-000001"] }), jsonCanonico({ l: ["DL-000001", "DL-000002"] }));
  });

  it("ignora claves undefined y trata los escalares como JSON", () => {
    assert.equal(jsonCanonico({ a: 1, b: undefined }), '{"a":1}');
    assert.equal(jsonCanonico(null), "null");
    assert.equal(jsonCanonico("é\"\n"), JSON.stringify("é\"\n"));
    assert.equal(jsonCanonico(true), "true");
  });
});

describe("checksumDe", () => {
  it("es un SHA-256 en hexadecimal (64 caracteres)", () => {
    assert.match(checksumDe({ a: 1 }), /^[a-f0-9]{64}$/);
  });

  it("no depende del orden de las claves y sí de cualquier cambio de contenido", () => {
    assert.equal(checksumDe({ a: 1, b: { c: 2, d: 3 } }), checksumDe({ b: { d: 3, c: 2 }, a: 1 }));
    assert.notEqual(checksumDe({ a: 1 }), checksumDe({ a: 2 }));
    assert.notEqual(checksumDe({ a: "x" }), checksumDe({ a: "x " }));
    assert.notEqual(checksumDe({ a: [1, 2] }), checksumDe({ a: [2, 1] }));
  });

  it("sobrevive a un viaje por jsonb (que reordena claves)", () => {
    const original = { nombre: "Amor", beneficio: { valor: 15, tipo: "porcentaje" }, alcance: { referencias: ["DL-000002", "DL-000001"] } };
    const reordenado = JSON.parse('{"alcance":{"referencias":["DL-000002","DL-000001"]},"beneficio":{"tipo":"porcentaje","valor":15},"nombre":"Amor"}');
    assert.equal(checksumDe(reordenado), checksumDe(original));
  });
});
