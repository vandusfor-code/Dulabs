import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  cifrarSecretoDev,
  descifrarSecretoDev,
  claveMaestraDisponible,
  ClaveNoDisponibleError,
  DescifradoFallidoError,
} from "@/lib/developer/secure-crypto";

// DuLabs Developer V1 -- Fase 1. Prueba la corrección explícita pedida:
// "KMS disponible -> cifra y persiste. KMS no disponible -> FAIL CLOSED."
// Manipula DEVELOPER_TOKEN_ENCRYPTION_KEY directamente (variable de
// entorno propia y separada de TOKEN_ENCRYPTION_KEY de Business -- nunca
// se toca esa) para simular ambos escenarios de forma real, no mockeada.

describe("DuLabs Developer V1 — cifrado estricto fail-closed (Fase 1, sección 17)", () => {
  const claveOriginal = process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
  const claveDePrueba = randomBytes(32).toString("base64");

  before(() => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveDePrueba;
  });

  after(() => {
    if (claveOriginal === undefined) delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    else process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveOriginal;
  });

  it("con la clave disponible: cifra y descifra un roundtrip real correctamente", () => {
    const secreto = "sk-proveedor-ia-del-desarrollador-xyz123";
    const cifrado = cifrarSecretoDev(secreto);
    assert.match(cifrado, /^dev1:/);
    assert.notEqual(cifrado, secreto);
    assert.equal(descifrarSecretoDev(cifrado), secreto);
  });

  it("claveMaestraDisponible() refleja la disponibilidad real, no un valor fijo", () => {
    assert.equal(claveMaestraDisponible(), true);
    delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    assert.equal(claveMaestraDisponible(), false);
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveDePrueba;
  });

  it("FAIL CLOSED en cifrado: sin clave configurada, cifrarSecretoDev lanza (nunca cifra con una clave débil/por defecto)", () => {
    delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    assert.throws(() => cifrarSecretoDev("algo"), ClaveNoDisponibleError);
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveDePrueba;
  });

  it("FAIL CLOSED en descifrado: sin clave configurada, descifrarSecretoDev lanza (nunca devuelve el valor cifrado tal cual)", () => {
    const cifrado = cifrarSecretoDev("secreto-real");
    delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    assert.throws(() => descifrarSecretoDev(cifrado), ClaveNoDisponibleError);
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveDePrueba;
  });

  it("FAIL CLOSED: una clave con longitud inválida (no 32 bytes tras base64) se rechaza, nunca se usa parcialmente", () => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = Buffer.from("demasiado-corta").toString("base64");
    assert.throws(() => cifrarSecretoDev("algo"), ClaveNoDisponibleError);
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveDePrueba;
  });

  it("PROHIBIDO plaintext fallback: un valor mal formado (no cifrado por esta ruta) nunca se devuelve tal cual -- lanza", () => {
    assert.throws(() => descifrarSecretoDev("esto-es-texto-plano-sin-cifrar"), DescifradoFallidoError);
    assert.throws(() => descifrarSecretoDev(""), DescifradoFallidoError);
    // Formato de lib/crypto.ts legado ("v1:...") tampoco se acepta acá --
    // Developer V1 es una ruta completamente separada, sin compatibilidad
    // cruzada con el formato legado de Business.
    assert.throws(() => descifrarSecretoDev("v1:aWFt:YWJj:ZGVm"), DescifradoFallidoError);
  });

  it("PROHIBIDO aceptar dato manipulado: alterar un solo byte del ciphertext hace fallar la autenticación GCM -- lanza, nunca devuelve texto corrupto", () => {
    const cifrado = cifrarSecretoDev("dato-sensible-real");
    const partes = cifrado.split(":");
    // Corrompe el ciphertext (última parte) cambiando un caracter -- GCM
    // debe detectar esto en la verificación del authTag, no producir un
    // resultado "parecido" silenciosamente.
    const cifradoBuf = Buffer.from(partes[3], "base64");
    cifradoBuf[0] = cifradoBuf[0] ^ 0xff;
    partes[3] = cifradoBuf.toString("base64");
    const manipulado = partes.join(":");

    assert.throws(() => descifrarSecretoDev(manipulado), DescifradoFallidoError);
  });

  it("PROHIBIDO clave cero: encriptar con una clave de 32 ceros no está bloqueado por longitud, pero cada operación exige una clave EXPLÍCITA -- no existe ningún default que caiga en cero sin que alguien la haya puesto ahí a propósito", () => {
    // Este test documenta la garantía real: el código nunca ELIGE una
    // clave cero por sí mismo -- si alguien configura una clave de ceros
    // explícitamente, es una decisión operativa suya, no un fallback del
    // código. Lo que el código SÍ garantiza es que sin ninguna
    // configuración, no hay bytes silenciosos de relleno.
    delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    assert.throws(() => cifrarSecretoDev("x"), ClaveNoDisponibleError);
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveDePrueba;
  });

  it("dos cifrados del mismo texto producen IVs distintos (nonce único por operación, requisito de GCM)", () => {
    const a = cifrarSecretoDev("mismo-texto");
    const b = cifrarSecretoDev("mismo-texto");
    assert.notEqual(a, b);
    const ivA = a.split(":")[1];
    const ivB = b.split(":")[1];
    assert.notEqual(ivA, ivB);
  });
});
