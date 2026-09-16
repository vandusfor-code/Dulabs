// Validación de la configuración criptográfica OBLIGATORIA por producto antes
// de una release (autorizado -- protección del incidente de Fase 10, donde
// producción quedó sin la clave de cifrado de Developer y
// /api/developer/whatsapp/connect respondía `encryption_unavailable` en
// silencio).
//
// Distingue explícitamente los dos productos, que usan mecanismos DISTINTOS y
// no intercambiables:
//   - Business  -> TOKEN_ENCRYPTION_KEY            (lib/crypto.ts)
//   - Developer -> DEVELOPER_TOKEN_ENCRYPTION_KEY  (clave estática AES-256)
//                  o KMS_KEY_NAME                   (Google Cloud KMS)
//                  (lib/developer/secure-crypto.ts, FAIL-CLOSED)
//
// Módulo PURO: solo lee `process.env` para saber si la variable ESTÁ
// presente. NUNCA lee, imprime, devuelve ni compara el VALOR de ningún
// secreto -- solo su presencia y el mecanismo resultante.
//
// La disponibilidad de Developer se delega a la ÚNICA fuente de verdad ya
// existente (claveMaestraDisponible en secure-crypto), para que este guard y
// el guard en tiempo de ejecución de la route nunca puedan divergir.
import { claveMaestraDisponible } from "@/lib/developer/secure-crypto";

export type ProductoCripto = "business" | "developer";

export type EstadoCripto = {
  producto: ProductoCripto;
  ok: boolean;
  /** "static" | "kms" | "none" -- el MECANISMO detectado, jamás el valor. */
  mecanismo: "static" | "kms" | "none";
  /** NOMBRES de las variables aceptadas para este producto (nunca valores). */
  variablesAceptadas: string[];
  /** Mensaje accionable si !ok; null si ok. */
  faltante: string | null;
};

/** Business cifra los tokens de Meta de sus tenants con TOKEN_ENCRYPTION_KEY (lib/crypto.ts). */
export function estadoCriptoBusiness(): EstadoCripto {
  const ok = Boolean(process.env.TOKEN_ENCRYPTION_KEY);
  return {
    producto: "business",
    ok,
    mecanismo: ok ? "static" : "none",
    variablesAceptadas: ["TOKEN_ENCRYPTION_KEY"],
    faltante: ok
      ? null
      : "Falta TOKEN_ENCRYPTION_KEY (cifrado de tokens de Business -- lib/crypto.ts).",
  };
}

/**
 * Developer V1 cifra los tokens de Meta con secure-crypto (FAIL-CLOSED): KMS
 * real (KMS_KEY_NAME) en Cloud Run, o clave estática (DEVELOPER_TOKEN_ENCRYPTION_KEY)
 * en el resto de entornos. `ok` reutiliza claveMaestraDisponible() -- la misma
 * comprobación que hace el guard de /api/developer/whatsapp/connect.
 */
export function estadoCriptoDeveloper(): EstadoCripto {
  const kms = Boolean(process.env.KMS_KEY_NAME);
  const estatica = Boolean(process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY);
  const ok = claveMaestraDisponible(); // === kms || estatica (fuente de verdad única)
  return {
    producto: "developer",
    ok,
    mecanismo: kms ? "kms" : estatica ? "static" : "none",
    variablesAceptadas: ["KMS_KEY_NAME", "DEVELOPER_TOKEN_ENCRYPTION_KEY"],
    faltante: ok
      ? null
      : "Falta la clave de cifrado de Developer: configura DEVELOPER_TOKEN_ENCRYPTION_KEY " +
        "(clave estática AES-256 en base64) o KMS_KEY_NAME (Google Cloud KMS). " +
        "secure-crypto.ts es FAIL-CLOSED: sin una de ellas, /api/developer/whatsapp/connect " +
        "responde `encryption_unavailable` y ningún número se conecta.",
  };
}

export type ResultadoValidacionRelease = {
  entorno: string;
  ok: boolean;
  estados: EstadoCripto[];
  /** Solo los productos cuya configuración falta (subconjunto de `estados`). */
  faltantes: EstadoCripto[];
};

/**
 * Valida la configuración criptográfica de los productos indicados (por
 * defecto AMBOS). No decide si se debe BLOQUEAR -- solo reporta el estado; el
 * caller (el guard de build) decide bloquear según el entorno. Nunca toca
 * secretos: solo presencia.
 */
export function validarConfigCriptograficaDeRelease(opts?: {
  entorno?: string;
  productos?: ProductoCripto[];
}): ResultadoValidacionRelease {
  const entorno = opts?.entorno ?? process.env.VERCEL_ENV ?? "desconocido";
  const productos = opts?.productos ?? ["business", "developer"];
  const estados: EstadoCripto[] = [];
  if (productos.includes("business")) estados.push(estadoCriptoBusiness());
  if (productos.includes("developer")) estados.push(estadoCriptoDeveloper());
  const faltantes = estados.filter((e) => !e.ok);
  return { entorno, ok: faltantes.length === 0, estados, faltantes };
}
