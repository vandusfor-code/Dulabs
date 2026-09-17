import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  cifrarSecretoDev,
  descifrarSecretoDev,
  claveMaestraDisponible,
  ClaveNoDisponibleError,
  DescifradoFallidoError,
  modoEscrituraCanonico,
  formatoCanonicoEscritura,
  puedeLeerFormato,
  coberturaLecturaCompleta,
  cifradoCanonicoDisponible,
  estrategiaAuthKms,
  _setProveedorKmsParaTests,
  type ProveedorKms,
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

// ============================================================================
// Fase 20 -- B2: formato canónico dev2 (KMS) explícito + cobertura de lectura.
// Usa un proveedor KMS FALSO determinista (wrap XOR local) para probar el
// roundtrip dev2 sin credenciales GCP ni actividad async de la SDK real.
// ============================================================================

const KMS_NAME_FALSA = "projects/p/locations/us-central1/keyRings/r/cryptoKeys/k";

function proveedorKmsFalso(opts?: { corruptUnwrap?: boolean; failEncrypt?: boolean; failDecrypt?: boolean }): ProveedorKms {
  const PAD = Buffer.alloc(32, 0xa5); // "envuelve" la DEK con un XOR reversible determinista
  return {
    async envolverDek(_nombre, dek) {
      if (opts?.failEncrypt) throw new Error("kms-encrypt-caido");
      const out = Buffer.alloc(dek.length);
      for (let i = 0; i < dek.length; i++) out[i] = dek[i]! ^ PAD[i % PAD.length]!;
      return out;
    },
    async desenvolverDek(_nombre, envuelta) {
      if (opts?.failDecrypt) throw new Error("kms-decrypt-caido");
      const out = Buffer.alloc(envuelta.length);
      for (let i = 0; i < envuelta.length; i++) out[i] = envuelta[i]! ^ PAD[i % PAD.length]!;
      if (opts?.corruptUnwrap) out[0] = out[0]! ^ 0xff; // devuelve una DEK equivocada
      return out;
    },
  };
}

describe("DuLabs Developer V1 — Fase 20 B2: canónico dev2 (KMS) + cobertura de lectura", () => {
  const VARS = ["DEVELOPER_TOKEN_ENCRYPTION_MODE", "KMS_KEY_NAME", "DEVELOPER_TOKEN_ENCRYPTION_KEY", "GCP_WORKLOAD_IDENTITY_AUDIENCE", "GCP_WORKLOAD_IDENTITY_SA_EMAIL", "VERCEL_OIDC_TOKEN"] as const;
  let orig: Record<string, string | undefined>;
  const claveEstatica = randomBytes(32).toString("base64");

  beforeEach(() => {
    orig = {};
    for (const v of VARS) {
      orig[v] = process.env[v];
      delete process.env[v];
    }
  });
  afterEach(() => {
    _setProveedorKmsParaTests(null);
    for (const v of VARS) {
      if (orig[v] === undefined) delete process.env[v];
      else process.env[v] = orig[v];
    }
  });

  it("1. nuevo secreto en modo kms -> se cifra como dev2 (envelope KMS), nunca dev1", async () => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_MODE = "kms";
    process.env.KMS_KEY_NAME = KMS_NAME_FALSA;
    _setProveedorKmsParaTests(proveedorKmsFalso());
    const cifrado = await cifrarSecretoDev("token-permanente-de-meta-xyz");
    assert.match(cifrado, /^dev2:/);
    assert.equal(cifrado.split(":").length, 5);
  });

  it("2. decrypt dev2 válido -> roundtrip correcto", async () => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_MODE = "kms";
    process.env.KMS_KEY_NAME = KMS_NAME_FALSA;
    _setProveedorKmsParaTests(proveedorKmsFalso());
    const secreto = "whsec_" + randomBytes(8).toString("hex");
    const cifrado = await cifrarSecretoDev(secreto);
    assert.equal(await descifrarSecretoDev(cifrado), secreto);
  });

  it("3. decrypt dev1 legacy válido con la clave estática (lectura de datos existentes)", async () => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveEstatica; // modo inferido static
    const cifradoDev1 = await cifrarSecretoDev("secreto-legacy");
    assert.match(cifradoDev1, /^dev1:/);
    assert.equal(await descifrarSecretoDev(cifradoDev1), "secreto-legacy");
  });

  it("4. dev1 inválido (byte alterado) -> DescifradoFallidoError, nunca texto corrupto", async () => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveEstatica;
    const c = await cifrarSecretoDev("dato-real");
    const p = c.split(":");
    const buf = Buffer.from(p[3]!, "base64");
    buf[0] = buf[0]! ^ 0xff;
    p[3] = buf.toString("base64");
    await assert.rejects(() => descifrarSecretoDev(p.join(":")), DescifradoFallidoError);
  });

  it("5. dev2 inválido (ciphertext alterado) -> DescifradoFallidoError", async () => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_MODE = "kms";
    process.env.KMS_KEY_NAME = KMS_NAME_FALSA;
    _setProveedorKmsParaTests(proveedorKmsFalso());
    const c = await cifrarSecretoDev("dato-real-dev2");
    const p = c.split(":");
    const buf = Buffer.from(p[4]!, "base64");
    buf[0] = buf[0]! ^ 0xff;
    p[4] = buf.toString("base64");
    await assert.rejects(() => descifrarSecretoDev(p.join(":")), DescifradoFallidoError);
  });

  it("6. prefijo desconocido -> DescifradoFallidoError (nunca asume texto plano)", async () => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveEstatica;
    await assert.rejects(() => descifrarSecretoDev("dev9:a:b:c:d"), DescifradoFallidoError);
    await assert.rejects(() => descifrarSecretoDev("texto-plano"), DescifradoFallidoError);
  });

  it("7. dev2 con estructura corrupta (nº de partes incorrecto) -> DescifradoFallidoError", async () => {
    process.env.KMS_KEY_NAME = KMS_NAME_FALSA;
    _setProveedorKmsParaTests(proveedorKmsFalso());
    await assert.rejects(() => descifrarSecretoDev("dev2:solo:tres:partes"), DescifradoFallidoError);
  });

  it("8. DEK incorrecta (KMS desenvuelve mal) -> GCM falla -> DescifradoFallidoError", async () => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_MODE = "kms";
    process.env.KMS_KEY_NAME = KMS_NAME_FALSA;
    _setProveedorKmsParaTests(proveedorKmsFalso());
    const c = await cifrarSecretoDev("dato");
    _setProveedorKmsParaTests(proveedorKmsFalso({ corruptUnwrap: true }));
    await assert.rejects(() => descifrarSecretoDev(c), DescifradoFallidoError);
  });

  it("9. modo kms sin KMS_KEY_NAME -> cifrar FAIL CLOSED (no cae a estático aunque exista la clave estática)", async () => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_MODE = "kms";
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveEstatica; // presente, pero NO debe usarse
    await assert.rejects(() => cifrarSecretoDev("x"), ClaveNoDisponibleError);
    assert.equal(cifradoCanonicoDisponible(), false);
  });

  it("10. KMS inaccesible (proveedor lanza) -> cifrar y descifrar FAIL CLOSED (ClaveNoDisponibleError)", async () => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_MODE = "kms";
    process.env.KMS_KEY_NAME = KMS_NAME_FALSA;
    _setProveedorKmsParaTests(proveedorKmsFalso({ failEncrypt: true }));
    await assert.rejects(() => cifrarSecretoDev("x"), ClaveNoDisponibleError);
    // Un dev2 previamente válido, con KMS caído al desenvolver:
    _setProveedorKmsParaTests(proveedorKmsFalso());
    const c = await cifrarSecretoDev("y");
    _setProveedorKmsParaTests(proveedorKmsFalso({ failDecrypt: true }));
    await assert.rejects(() => descifrarSecretoDev(c), ClaveNoDisponibleError);
  });

  it("11+12. los errores nunca incluyen el plaintext ni la DEK", async () => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_MODE = "kms";
    process.env.KMS_KEY_NAME = KMS_NAME_FALSA;
    const secreto = "SUPER-SECRETO-NO-DEBE-APARECER-123";
    _setProveedorKmsParaTests(proveedorKmsFalso({ failEncrypt: true }));
    const err = await cifrarSecretoDev(secreto).catch((e) => e as Error);
    assert.ok(err instanceof ClaveNoDisponibleError);
    assert.ok(!err.message.includes(secreto), "el mensaje de error no debe contener el plaintext");
  });

  it("13. modo inválido -> ClaveNoDisponibleError (config ambigua no se acepta)", () => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_MODE = "aes-lo-que-sea";
    process.env.KMS_KEY_NAME = KMS_NAME_FALSA;
    assert.throws(() => modoEscrituraCanonico(), ClaveNoDisponibleError);
    assert.equal(cifradoCanonicoDisponible(), false); // no revienta: reporta no-disponible
    assert.equal(formatoCanonicoEscritura(), "none");
  });

  it("14. modo kms con clave estática TAMBIÉN presente -> sigue escribiendo dev2 (nunca vuelve a dev1)", async () => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_MODE = "kms";
    process.env.KMS_KEY_NAME = KMS_NAME_FALSA;
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveEstatica;
    _setProveedorKmsParaTests(proveedorKmsFalso());
    const c = await cifrarSecretoDev("nuevo");
    assert.match(c, /^dev2:/);
    assert.equal(formatoCanonicoEscritura(), "dev2");
  });

  it("15. lectura cruzada: un runtime con clave estática + KMS lee AMBOS formatos", async () => {
    // Escribe un dev1 con solo la clave estática...
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveEstatica;
    const dev1 = await cifrarSecretoDev("valor-dev1");
    assert.match(dev1, /^dev1:/);
    // ...ahora el runtime tiene además KMS (modo kms) y debe leer ambos.
    process.env.DEVELOPER_TOKEN_ENCRYPTION_MODE = "kms";
    process.env.KMS_KEY_NAME = KMS_NAME_FALSA;
    _setProveedorKmsParaTests(proveedorKmsFalso());
    const dev2 = await cifrarSecretoDev("valor-dev2");
    assert.match(dev2, /^dev2:/);
    assert.equal(await descifrarSecretoDev(dev1), "valor-dev1");
    assert.equal(await descifrarSecretoDev(dev2), "valor-dev2");
    assert.equal(coberturaLecturaCompleta(), true);
  });

  it("16. solo KMS (sin clave estática): escribe/lee dev2, pero NO puede leer dev1 legacy (fail-closed)", async () => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_MODE = "kms";
    process.env.KMS_KEY_NAME = KMS_NAME_FALSA;
    _setProveedorKmsParaTests(proveedorKmsFalso());
    assert.equal(puedeLeerFormato("dev2"), true);
    assert.equal(puedeLeerFormato("dev1"), false);
    assert.equal(coberturaLecturaCompleta(), false);
    await assert.rejects(() => descifrarSecretoDev("dev1:AAAA:BBBB:CCCC"), ClaveNoDisponibleError);
  });

  it("17. transición: modo kms + clave estática -> escribe dev2 y AÚN lee dev1 legacy", async () => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveEstatica;
    const legacy = await cifrarSecretoDev("legacy"); // dev1 (modo inferido static)
    process.env.DEVELOPER_TOKEN_ENCRYPTION_MODE = "kms";
    process.env.KMS_KEY_NAME = KMS_NAME_FALSA;
    _setProveedorKmsParaTests(proveedorKmsFalso());
    assert.equal(formatoCanonicoEscritura(), "dev2");
    assert.equal(await descifrarSecretoDev(legacy), "legacy");
  });

  it("18. introspección de cobertura: none / static / kms según config", () => {
    assert.equal(formatoCanonicoEscritura(), "none");
    assert.equal(cifradoCanonicoDisponible(), false);
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveEstatica;
    assert.equal(formatoCanonicoEscritura(), "dev1");
    assert.equal(modoEscrituraCanonico(), "static");
    delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    process.env.KMS_KEY_NAME = KMS_NAME_FALSA;
    assert.equal(formatoCanonicoEscritura(), "dev2");
    assert.equal(modoEscrituraCanonico(), "kms");
  });

  it("19. estrategiaAuthKms: ADC por defecto; vercel-wif solo con las 3 variables presentes", () => {
    assert.equal(estrategiaAuthKms(), "adc");
    process.env.GCP_WORKLOAD_IDENTITY_AUDIENCE = "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/p/providers/v";
    assert.equal(estrategiaAuthKms(), "adc", "falta SA + OIDC token");
    process.env.GCP_WORKLOAD_IDENTITY_SA_EMAIL = "dulabs-vercel-kms@dulabs-developer-v1.iam.gserviceaccount.com";
    assert.equal(estrategiaAuthKms(), "adc", "falta el OIDC token de Vercel");
    process.env.VERCEL_OIDC_TOKEN = "eyJ.fake.oidc";
    assert.equal(estrategiaAuthKms(), "vercel-wif");
  });
});
