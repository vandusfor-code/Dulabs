import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { KeyManagementServiceClient } from "@google-cloud/kms";

// DuLabs Developer V1 -- Fase 1 (autorizado, sección 17 del brief), extendido
// en Fase 3 (sección J) con envelope encryption real contra Google Cloud KMS,
// y consolidado en Fase 20 (remediación B2, autorizado) con formato CANÓNICO
// de escritura EXPLÍCITO. Misma interfaz pública desde Fase 1
// (cifrarSecretoDev/descifrarSecretoDev) -- se extiende, nunca se duplica.
//
// ----------------------------------------------------------------------------
// FASE 20 -- B2: formato canónico de escritura = dev2 (envelope KMS).
// ----------------------------------------------------------------------------
// Raíz del incidente B2 (auditoría Fase 20): el MECANISMO de escritura se
// elegía IMPLÍCITAMENTE por la mera presencia de KMS_KEY_NAME. Como Vercel
// (dashboard, app/api/**) solo tenía DEVELOPER_TOKEN_ENCRYPTION_KEY, escribía
// `dev1:`; Cloud Run (services/**) tenía KMS_KEY_NAME y escribía/leía `dev2:`.
// Ambos formatos existen en producción, y ningún runtime tenía cobertura de
// lectura cruzada -> un token escrito por el dashboard no lo podía descifrar el
// worker de envío. Ver docs/DULABS_DEVELOPER_V1_PHASE_20_REMEDIATION_REPORT.md.
//
// Corrección:
//   ESCRITURA (canónica): controlada por DEVELOPER_TOKEN_ENCRYPTION_MODE, de
//   forma EXPLÍCITA y fail-closed. En producción = "kms" -> SIEMPRE `dev2:`.
//   La presencia de la clave estática NUNCA hace que un runtime configurado
//   para KMS caiga a `dev1:`.
//     - modo "kms"    -> cifrarConKms (dev2). Si KMS_KEY_NAME falta o KMS es
//                        inalcanzable -> FAIL CLOSED (jamás cae a estático).
//     - modo "static" -> AES-256-GCM con clave estática (dev1). EXCLUSIVO de
//                        entornos sin GCP (local/CI) o backward-compat.
//     - sin modo explícito -> se INFIERE para ergonomía de dev/CI (kms si hay
//                        KMS_KEY_NAME; static si hay clave estática). Producción
//                        DEBE fijar el modo explícito (lo exige el release guard).
//
//   LECTURA (compat): dispatch por PREFIJO del ciphertext, nunca por la config
//   actual. `dev2:` -> KMS; `dev1:` -> estático legacy; cualquier otro ->
//   error seguro. Durante la transición, un runtime que lea datos existentes
//   debe tener AMBAS claves para leer ambos formatos (ver puedeLeerFormato /
//   coberturaLecturaCompleta y el release guard).
//
// Nunca: plaintext/token/secret/ciphertext-completo/clave/credencial en logs.
// Contradicción original que este archivo resuelve (sección 8.1 de Fase 1):
// lib/crypto.ts (Business) tiene fallback a texto plano para datos legado;
// prohibido acá. Developer V1 es greenfield: FAIL CLOSED sin excepciones.

const ALGORITMO = "aes-256-gcm";
const PREFIJO_DEV1 = "dev1";
const PREFIJO_DEV2 = "dev2";
const LONGITUD_IV = 12;
const LONGITUD_DEK = 32;

export class ClaveNoDisponibleError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ClaveNoDisponibleError";
  }
}

export class DescifradoFallidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "DescifradoFallidoError";
  }
}

// ----------------------------------------------------------------------------
// Clave estática (dev1) -- solo local/CI o backward-compat de lectura.
// ----------------------------------------------------------------------------

function obtenerClaveMaestraEstatica(): Buffer {
  const clave = process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
  if (!clave) {
    throw new ClaveNoDisponibleError(
      "DEVELOPER_TOKEN_ENCRYPTION_KEY no está configurada. FAIL CLOSED: no existe ningún valor por defecto ni clave cero -- la operación se aborta."
    );
  }
  const buffer = Buffer.from(clave, "base64");
  if (buffer.length !== LONGITUD_DEK) {
    throw new ClaveNoDisponibleError(
      `DEVELOPER_TOKEN_ENCRYPTION_KEY tiene ${buffer.length} bytes tras decodificar base64; se requieren exactamente 32 (AES-256). FAIL CLOSED.`
    );
  }
  return buffer;
}

// ----------------------------------------------------------------------------
// Capa KMS -- proveedor INYECTABLE (envelope encryption).
// ----------------------------------------------------------------------------
// Solo la operación de envolver/desenvolver la DEK toca KMS; el cifrado del
// dato en sí es AES-256-GCM local con una DEK aleatoria por operación. El
// proveedor es inyectable EXCLUSIVAMENTE para tests deterministas (roundtrip
// dev2: sin credenciales GCP). En producción se usa el proveedor real (SDK).

/** Envuelve/desenvuelve la DEK contra KMS. La única superficie que habla con GCP. */
export type ProveedorKms = {
  envolverDek(nombreClave: string, dek: Buffer): Promise<Buffer>;
  desenvolverDek(nombreClave: string, dekEnvuelta: Buffer): Promise<Buffer>;
};

let proveedorKmsOverride: ProveedorKms | null = null;
/** SOLO tests: inyecta un proveedor KMS falso (wrap local determinista). Nunca en producción. `null` restaura el real. */
export function _setProveedorKmsParaTests(p: ProveedorKms | null): void {
  proveedorKmsOverride = p;
  if (p) clienteKms = null; // fuerza recrear el cliente real si luego se restaura
}

function nombreClaveKms(): string {
  const nombre = process.env.KMS_KEY_NAME;
  if (!nombre) {
    throw new ClaveNoDisponibleError(
      "KMS_KEY_NAME no está configurada. FAIL CLOSED: sin ruta a KMS, la operación se aborta -- nunca se cae a una clave estática en producción."
    );
  }
  return nombre;
}

/** Estrategia de autenticación del cliente KMS, resuelta por entorno (pura -- no toca GCP). */
export type EstrategiaAuthKms = "adc" | "vercel-wif";
export function estrategiaAuthKms(): EstrategiaAuthKms {
  // Workload Identity Federation desde Vercel: intercambia el OIDC token de
  // Vercel por credenciales cortas de una SA dedicada, SIN service-account key
  // estática. Requiere los tres: audiencia del provider WIF, SA a impersonar,
  // y el propio OIDC token de Vercel (inyectado por la plataforma en runtime).
  if (
    process.env.GCP_WORKLOAD_IDENTITY_AUDIENCE &&
    process.env.GCP_WORKLOAD_IDENTITY_SA_EMAIL &&
    process.env.VERCEL_OIDC_TOKEN
  ) {
    return "vercel-wif";
  }
  // Application Default Credentials: la SA adjunta del servicio (Cloud Run) o
  // GOOGLE_APPLICATION_CREDENTIALS estándar.
  return "adc";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function crearAuthClientKms(): Promise<any | undefined> {
  if (estrategiaAuthKms() !== "vercel-wif") return undefined; // ADC
  const { IdentityPoolClient } = await import("google-auth-library");
  const saEmail = process.env.GCP_WORKLOAD_IDENTITY_SA_EMAIL as string;
  return new IdentityPoolClient({
    audience: process.env.GCP_WORKLOAD_IDENTITY_AUDIENCE as string,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${saEmail}:generateAccessToken`,
    subjectTokenSupplier: {
      getSubjectToken: async () => {
        const token = process.env.VERCEL_OIDC_TOKEN;
        if (!token) throw new ClaveNoDisponibleError("VERCEL_OIDC_TOKEN ausente para WIF. FAIL CLOSED.");
        return token;
      },
    },
  });
}

let clienteKms: KeyManagementServiceClient | null = null;
async function obtenerClienteKms(): Promise<KeyManagementServiceClient> {
  if (!clienteKms) {
    const { KeyManagementServiceClient } = await import("@google-cloud/kms");
    const authClient = await crearAuthClientKms();
    clienteKms = authClient
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new KeyManagementServiceClient({ authClient } as any)
      : new KeyManagementServiceClient();
  }
  return clienteKms;
}

const proveedorKmsReal: ProveedorKms = {
  async envolverDek(nombreClave, dek) {
    const cliente = await obtenerClienteKms();
    const [respuesta] = await cliente.encrypt({ name: nombreClave, plaintext: dek });
    if (!respuesta.ciphertext) throw new Error("KMS no devolvió el ciphertext de la DEK envuelta");
    return Buffer.from(respuesta.ciphertext as Uint8Array);
  },
  async desenvolverDek(nombreClave, dekEnvuelta) {
    const cliente = await obtenerClienteKms();
    const [respuesta] = await cliente.decrypt({ name: nombreClave, ciphertext: dekEnvuelta });
    if (!respuesta.plaintext) throw new Error("KMS no devolvió el plaintext de la DEK");
    return Buffer.from(respuesta.plaintext as Uint8Array);
  },
};

function proveedorKms(): ProveedorKms {
  return proveedorKmsOverride ?? proveedorKmsReal;
}

async function cifrarConKms(texto: string): Promise<string> {
  const nombreClave = nombreClaveKms();
  const dek = randomBytes(LONGITUD_DEK);
  const iv = randomBytes(LONGITUD_IV);
  const cipher = createCipheriv(ALGORITMO, dek, iv);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  let dekEnvuelta: Buffer;
  try {
    dekEnvuelta = await proveedorKms().envolverDek(nombreClave, dek);
  } catch (err) {
    // FAIL CLOSED: si KMS no responde o falla, nunca se cae a una clave
    // estática ni se persiste nada -- se propaga el error (sin secretos).
    throw new ClaveNoDisponibleError(`No se pudo envolver la DEK vía KMS. FAIL CLOSED: ${err instanceof Error ? err.message : String(err)}`);
  }

  return `${PREFIJO_DEV2}:${dekEnvuelta.toString("base64")}:${iv.toString("base64")}:${authTag.toString("base64")}:${cifrado.toString("base64")}`;
}

async function descifrarConKms(partes: string[]): Promise<string> {
  const [, dekEnvueltaB64, ivB64, authTagB64, cifradoB64] = partes;
  const nombreClave = nombreClaveKms();

  let dek: Buffer;
  try {
    dek = await proveedorKms().desenvolverDek(nombreClave, Buffer.from(dekEnvueltaB64, "base64"));
  } catch (err) {
    throw new ClaveNoDisponibleError(`No se pudo desenvolver la DEK vía KMS. FAIL CLOSED: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const decipher = createDecipheriv(ALGORITMO, dek, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
    const descifrado = Buffer.concat([decipher.update(Buffer.from(cifradoB64, "base64")), decipher.final()]);
    return descifrado.toString("utf8");
  } catch (err) {
    throw new DescifradoFallidoError(
      `No se pudo descifrar el valor (posible manipulación, corrupción, o DEK incorrecta). FAIL CLOSED: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function cifrarConClaveEstatica(texto: string): string {
  const iv = randomBytes(LONGITUD_IV);
  const cipher = createCipheriv(ALGORITMO, obtenerClaveMaestraEstatica(), iv);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIJO_DEV1}:${iv.toString("base64")}:${authTag.toString("base64")}:${cifrado.toString("base64")}`;
}

// ----------------------------------------------------------------------------
// Formato canónico de escritura (EXPLÍCITO, fail-closed).
// ----------------------------------------------------------------------------

export type ModoEscrituraCrypto = "kms" | "static";

/**
 * Resuelve el formato CANÓNICO de ESCRITURA de forma explícita:
 *   - DEVELOPER_TOKEN_ENCRYPTION_MODE ("kms"|"static") lo fija (preferido en prod).
 *     Un valor distinto de esos dos -> ClaveNoDisponibleError (fail-closed).
 *   - Sin modo explícito -> se INFIERE para ergonomía de dev/CI: kms si hay
 *     KMS_KEY_NAME; static si hay clave estática; null si no hay ninguna.
 * NUNCA cae a static por el mero hecho de existir la clave estática cuando el
 * modo pedido es kms -- eso es exactamente lo que causó B2.
 */
export function modoEscrituraCanonico(): ModoEscrituraCrypto | null {
  const explicito = (process.env.DEVELOPER_TOKEN_ENCRYPTION_MODE ?? "").toLowerCase().trim();
  if (explicito === "kms") return "kms";
  if (explicito === "static") return "static";
  if (explicito) {
    throw new ClaveNoDisponibleError(
      `DEVELOPER_TOKEN_ENCRYPTION_MODE inválido ("${explicito}"): se esperaba "kms" o "static". FAIL CLOSED.`
    );
  }
  if (process.env.KMS_KEY_NAME) return "kms";
  if (process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY) return "static";
  return null;
}

/**
 * Cifra un secreto de Developer V1 en el FORMATO CANÓNICO de escritura del
 * entorno (dev2/KMS en producción). Fail-closed: sin un mecanismo válido y su
 * clave, rechaza -- nunca cifra con una clave débil/por defecto ni cae a
 * texto plano. El formato de salida (`dev1:`/`dev2:`) es auto-describible para
 * que cualquier lector con la clave correcta lo descifre después.
 */
export async function cifrarSecretoDev(texto: string): Promise<string> {
  const modo = modoEscrituraCanonico();
  if (modo === "kms") return cifrarConKms(texto); // fail-closed si KMS_KEY_NAME falta / KMS inaccesible
  if (modo === "static") return cifrarConClaveEstatica(texto);
  throw new ClaveNoDisponibleError(
    "No hay mecanismo de cifrado configurado: define DEVELOPER_TOKEN_ENCRYPTION_MODE=kms (+ KMS_KEY_NAME) en producción, o DEVELOPER_TOKEN_ENCRYPTION_KEY en local/CI. FAIL CLOSED."
  );
}

/**
 * Descifra un valor cifrado con cifrarSecretoDev() -- reconoce el formato por
 * el PREFIJO (`dev1:` estático, `dev2:` KMS), no por la config actual, para que
 * un valor legacy siga siendo descifrable durante la transición si el runtime
 * tiene la clave correspondiente. Nunca devuelve el valor de entrada tal cual
 * ante un formato inesperado (a diferencia de lib/crypto.ts::descifrarSecreto).
 */
export async function descifrarSecretoDev(valor: string): Promise<string> {
  const partes = valor.split(":");
  const prefijo = partes[0];

  if (prefijo === PREFIJO_DEV2 && partes.length === 5) {
    return descifrarConKms(partes);
  }

  if (prefijo === PREFIJO_DEV1 && partes.length === 4) {
    const [, ivB64, authTagB64, cifradoB64] = partes;
    const clave = obtenerClaveMaestraEstatica(); // lanza ClaveNoDisponibleError si falta -- se propaga.
    try {
      const decipher = createDecipheriv(ALGORITMO, clave, Buffer.from(ivB64, "base64"));
      decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
      const descifrado = Buffer.concat([decipher.update(Buffer.from(cifradoB64, "base64")), decipher.final()]);
      return descifrado.toString("utf8");
    } catch (err) {
      throw new DescifradoFallidoError(
        `No se pudo descifrar el valor (posible manipulación, corrupción, o clave incorrecta). FAIL CLOSED: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  throw new DescifradoFallidoError(
    "Valor con formato inválido para Developer V1 (ni dev1: ni dev2:). FAIL CLOSED: nunca se asume texto plano legado -- Developer V1 no tiene datos legados que tolerar."
  );
}

// ----------------------------------------------------------------------------
// Introspección de configuración (para el diagnóstico y el release guard).
// Todo por PRESENCIA de config -- nunca lee/imprime el valor de ninguna clave,
// ni verifica reachability real de KMS (eso lo hace el smoke de infraestructura).
// ----------------------------------------------------------------------------

/** true si HAY algún mecanismo de cifrado disponible (KMS_KEY_NAME o clave estática). Mantiene la firma de Fase 1. */
export function claveMaestraDisponible(): boolean {
  return Boolean(process.env.KMS_KEY_NAME) || Boolean(process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY);
}

/** ¿Está configurado (por presencia) para DESCIFRAR el formato dado? dev2 requiere KMS_KEY_NAME; dev1 requiere la clave estática. */
export function puedeLeerFormato(prefijo: "dev1" | "dev2"): boolean {
  if (prefijo === "dev2") return Boolean(process.env.KMS_KEY_NAME);
  if (prefijo === "dev1") return Boolean(process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY);
  return false;
}

/** Cobertura completa de lectura durante la transición: puede leer AMBOS formatos (dev1 legacy + dev2 canónico). */
export function coberturaLecturaCompleta(): boolean {
  return puedeLeerFormato("dev1") && puedeLeerFormato("dev2");
}

/** ¿Puede ESCRIBIR el formato canónico configurado? (presencia de la clave del mecanismo canónico). */
export function cifradoCanonicoDisponible(): boolean {
  let modo: ModoEscrituraCrypto | null;
  try {
    modo = modoEscrituraCanonico();
  } catch {
    return false; // modo explícito inválido
  }
  if (modo === "kms") return Boolean(process.env.KMS_KEY_NAME);
  if (modo === "static") return Boolean(process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY);
  return false;
}

/** Formato que producirían las nuevas escrituras, como prefijo ("dev2"|"dev1"|"none"). */
export function formatoCanonicoEscritura(): "dev2" | "dev1" | "none" {
  let modo: ModoEscrituraCrypto | null;
  try {
    modo = modoEscrituraCanonico();
  } catch {
    return "none";
  }
  if (modo === "kms") return "dev2";
  if (modo === "static") return "dev1";
  return "none";
}
