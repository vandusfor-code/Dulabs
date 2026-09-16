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

// DuLabs Developer V1 -- Fase 1, extendido en Fase 3 con KMS real. Prueba
// la corrección explícita pedida: "KMS disponible -> cifra y persiste. KMS
// no disponible -> FAIL CLOSED." Manipula DEVELOPER_TOKEN_ENCRYPTION_KEY y
// KMS_KEY_NAME directamente (nunca TOKEN_ENCRYPTION_KEY de Business) para
// simular ambos escenarios de forma real, no mockeada. El roundtrip
// completo contra KMS REAL (no solo el fail-closed cuando es inalcanzable)
// se verifica en la suite de infraestructura de Fase 3, contra la key real
// desplegada -- acá no hay credenciales de GCP disponibles.

describe("DuLabs Developer V1 — cifrado estricto fail-closed (Fase 1/3, sección 17 / sección J)", () => {
  const claveOriginal = process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
  const kmsKeyOriginal = process.env.KMS_KEY_NAME;
  const claveDePrueba = randomBytes(32).toString("base64");

  before(() => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveDePrueba;
    delete process.env.KMS_KEY_NAME;
  });

  after(() => {
    if (claveOriginal === undefined) delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    else process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveOriginal;
    if (kmsKeyOriginal === undefined) delete process.env.KMS_KEY_NAME;
    else process.env.KMS_KEY_NAME = kmsKeyOriginal;
  });

  it("con la clave estática disponible (KMS_KEY_NAME ausente -- entorno local/CI): cifra en formato dev1: y descifra un roundtrip real correctamente", async () => {
    const secreto = "sk-proveedor-ia-del-desarrollador-xyz123";
    const cifrado = await cifrarSecretoDev(secreto);
    assert.match(cifrado, /^dev1:/);
    assert.notEqual(cifrado, secreto);
    assert.equal(await descifrarSecretoDev(cifrado), secreto);
  });

  it("claveMaestraDisponible() refleja la disponibilidad real (estática o KMS), no un valor fijo", () => {
    assert.equal(claveMaestraDisponible(), true);
    delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    assert.equal(claveMaestraDisponible(), false);
    process.env.KMS_KEY_NAME = "projects/x/locations/us-central1/keyRings/y/cryptoKeys/z";
    assert.equal(claveMaestraDisponible(), true, "con KMS_KEY_NAME configurada también cuenta como disponible, aunque no haya clave estática");
    delete process.env.KMS_KEY_NAME;
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveDePrueba;
  });

  it("FAIL CLOSED en cifrado: sin clave estática NI KMS_KEY_NAME configuradas, cifrarSecretoDev rechaza (nunca cifra con una clave débil/por defecto)", async () => {
    delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    await assert.rejects(() => cifrarSecretoDev("algo"), ClaveNoDisponibleError);
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveDePrueba;
  });

  it("FAIL CLOSED en descifrado (ruta dev1:): sin clave estática configurada, descifrarSecretoDev rechaza (nunca devuelve el valor cifrado tal cual)", async () => {
    const cifrado = await cifrarSecretoDev("secreto-real");
    delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    await assert.rejects(() => descifrarSecretoDev(cifrado), ClaveNoDisponibleError);
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveDePrueba;
  });

  it("FAIL CLOSED: una clave estática con longitud inválida (no 32 bytes tras base64) se rechaza, nunca se usa parcialmente", async () => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = Buffer.from("demasiado-corta").toString("base64");
    await assert.rejects(() => cifrarSecretoDev("algo"), ClaveNoDisponibleError);
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveDePrueba;
  });

  it("PROHIBIDO plaintext fallback: un valor mal formado (no cifrado por esta ruta) nunca se devuelve tal cual -- rechaza", async () => {
    await assert.rejects(() => descifrarSecretoDev("esto-es-texto-plano-sin-cifrar"), DescifradoFallidoError);
    await assert.rejects(() => descifrarSecretoDev(""), DescifradoFallidoError);
    // Formato de lib/crypto.ts legado ("v1:...") tampoco se acepta acá --
    // Developer V1 es una ruta completamente separada, sin compatibilidad
    // cruzada con el formato legado de Business.
    await assert.rejects(() => descifrarSecretoDev("v1:aWFt:YWJj:ZGVm"), DescifradoFallidoError);
  });

  it("PROHIBIDO aceptar dato manipulado (ruta dev1:): alterar un solo byte del ciphertext hace fallar la autenticación GCM -- rechaza, nunca devuelve texto corrupto", async () => {
    const cifrado = await cifrarSecretoDev("dato-sensible-real");
    const partes = cifrado.split(":");
    const cifradoBuf = Buffer.from(partes[3], "base64");
    cifradoBuf[0] = cifradoBuf[0] ^ 0xff;
    partes[3] = cifradoBuf.toString("base64");
    const manipulado = partes.join(":");

    await assert.rejects(() => descifrarSecretoDev(manipulado), DescifradoFallidoError);
  });

  it("PROHIBIDO clave cero: sin ninguna configuración, no hay bytes silenciosos de relleno", async () => {
    delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    await assert.rejects(() => cifrarSecretoDev("x"), ClaveNoDisponibleError);
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveDePrueba;
  });

  it("dos cifrados del mismo texto (ruta dev1:) producen IVs distintos (nonce único por operación, requisito de GCM)", async () => {
    const a = await cifrarSecretoDev("mismo-texto");
    const b = await cifrarSecretoDev("mismo-texto");
    assert.notEqual(a, b);
    const ivA = a.split(":")[1];
    const ivB = b.split(":")[1];
    assert.notEqual(ivA, ivB);
  });

  // NOTA: el escenario "KMS_KEY_NAME configurada pero KMS realmente
  // inalcanzable" (fail-closed real, nunca cae a la clave estática) no se
  // prueba acá con la SDK real de @google-cloud/kms -- sin Application
  // Default Credentials en este entorno, la SDK dispara internamente
  // actividad asíncrona de búsqueda de credenciales que sigue corriendo
  // después de que el test termina (no es determinístico de cancelar desde
  // afuera). Ese escenario se verifica con evidencia real contra la key
  // real desplegada en la suite de infraestructura de Fase 3 (KMS real:
  // roundtrip + fail-closed). Lo que SÍ se prueba acá, de forma
  // determinística: si KMS_KEY_NAME NO está configurada, nunca se llega a
  // tocar la SDK de KMS en absoluto (ver el siguiente test).

  it("descifrarSecretoDev despacha por el PREFIJO del valor (dev1:/dev2:), no por la configuración actual del entorno -- un valor dev1: sigue siendo descifrable aunque KMS_KEY_NAME esté también configurada", async () => {
    const cifradoDev1 = await cifrarSecretoDev("secreto-cifrado-en-modo-local");
    assert.match(cifradoDev1, /^dev1:/);
    process.env.KMS_KEY_NAME = "projects/x/locations/us-central1/keyRings/y/cryptoKeys/z";
    try {
      assert.equal(await descifrarSecretoDev(cifradoDev1), "secreto-cifrado-en-modo-local");
    } finally {
      delete process.env.KMS_KEY_NAME;
    }
  });

  it("un valor con prefijo dev2: pero KMS inalcanzable rechaza con ClaveNoDisponibleError (fail-closed también al descifrar)", async () => {
    const valorDev2Falso = "dev2:AAAA:BBBB:CCCC:DDDD";
    delete process.env.KMS_KEY_NAME;
    // Sin KMS_KEY_NAME, ni siquiera se intenta -- nombreClaveKms() lanza
    // ClaveNoDisponibleError directamente antes de llamar a la API.
    await assert.rejects(() => descifrarSecretoDev(valorDev2Falso), ClaveNoDisponibleError);
  });
});
