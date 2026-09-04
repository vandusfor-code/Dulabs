// AMORE (Fase 4, base de clientes, autorizado) — filtro puro, sin Supabase.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filtrarClientes } from "./filtrar-clientes";

const clientes = [
  { nombre: "María José Pérez", telefono: "573001112233" },
  { nombre: "Andrés Gómez", telefono: "+57 300 444 5566" },
  { nombre: "Valentina Ruiz", telefono: "573007778899" },
];

describe("filtrarClientes (AMORE, Fase 4)", () => {
  it("texto vacío devuelve todos los clientes", () => {
    assert.equal(filtrarClientes(clientes, "").length, 3);
    assert.equal(filtrarClientes(clientes, "   ").length, 3);
  });

  it("busca por nombre sin distinguir mayúsculas ni tildes", () => {
    const resultado = filtrarClientes(clientes, "maria jose");
    assert.equal(resultado.length, 1);
    assert.equal(resultado[0]!.nombre, "María José Pérez");
  });

  it("busca por WhatsApp ignorando espacios y símbolos", () => {
    const resultado = filtrarClientes(clientes, "3004445566");
    assert.equal(resultado.length, 1);
    assert.equal(resultado[0]!.nombre, "Andrés Gómez");
  });

  it("sin coincidencias devuelve lista vacía", () => {
    assert.deepEqual(filtrarClientes(clientes, "no existe nadie así"), []);
  });
});
