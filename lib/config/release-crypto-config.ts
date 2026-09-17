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
import {
  cifradoCanonicoDisponible,
  formatoCanonicoEscritura,
  puedeLeerFormato,
  coberturaLecturaCompleta,
} from "@/lib/developer/secure-crypto";

export type ProductoCripto = "business" | "developer";

export type EstadoCripto = {
  producto: ProductoCripto;
  ok: boolean;
  /** "static" | "kms" | "none" -- el MECANISMO CANÓNICO de ESCRITURA, jamás el valor. */
  mecanismo: "static" | "kms" | "none";
  /** NOMBRES de las variables aceptadas para este producto (nunca valores). */
  variablesAceptadas: string[];
  /** Mensaje accionable si !ok; null si ok. */
  faltante: string | null;
  // --- Fase 20 (B2) -- solo Developer: cobertura real de cifrado ---
  /** Formato canónico de las NUEVAS escrituras ("dev2"|"dev1"|"none"). */
  formatoCanonico?: "dev2" | "dev1" | "none";
  /** ¿Configurado (por presencia) para descifrar dev1 legacy? */
  puedeLeerDev1?: boolean;
  /** ¿Configurado (por presencia) para descifrar dev2 canónico? */
  puedeLeerDev2?: boolean;
  /** ¿Puede leer AMBOS formatos (cobertura de transición)? */
  coberturaLectura?: boolean;
  /** Advertencias no bloqueantes (p.ej. cobertura de lectura incompleta). */
  advertencias?: string[];
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
 * Developer V1 cifra los secretos de Meta con secure-crypto (FAIL-CLOSED).
 * Fase 20 (B2): el formato CANÓNICO de escritura es EXPLÍCITO
 * (DEVELOPER_TOKEN_ENCRYPTION_MODE) -- en producción "kms" -> dev2. `ok` ya NO
 * es "hay alguna clave", sino "puede cifrar en el formato canónico configurado"
 * (cifradoCanonicoDisponible): así, un runtime configurado para KMS sin
 * KMS_KEY_NAME NO se considera válido aunque exista la clave estática -- ese
 * fue exactamente el hueco de B2. Además reporta la cobertura de LECTURA de
 * ambos formatos (dev1 legacy + dev2 canónico) para la transición.
 */
export function estadoCriptoDeveloper(): EstadoCripto {
  const ok = cifradoCanonicoDisponible();
  const formatoCanonico = formatoCanonicoEscritura(); // "dev2" | "dev1" | "none"
  const puedeLeerDev1 = puedeLeerFormato("dev1");
  const puedeLeerDev2 = puedeLeerFormato("dev2");
  const coberturaLectura = coberturaLecturaCompleta();
  const mecanismo: "static" | "kms" | "none" =
    formatoCanonico === "dev2" ? "kms" : formatoCanonico === "dev1" ? "static" : "none";

  const advertencias: string[] = [];
  // Cobertura de lectura incompleta: puede escribir el canónico pero no puede
  // leer el OTRO formato que producción puede contener durante la transición.
  if (ok && !coberturaLectura) {
    if (!puedeLeerDev1) {
      advertencias.push(
        "Cobertura de lectura incompleta: no puede descifrar dev1 legacy (falta DEVELOPER_TOKEN_ENCRYPTION_KEY). " +
          "Durante la transición, añade la clave estática para poder leer tokens/secretos legacy existentes."
      );
    }
    if (!puedeLeerDev2) {
      advertencias.push(
        "Cobertura de lectura incompleta: no puede descifrar dev2 canónico (falta KMS_KEY_NAME/acceso KMS). " +
          "Este runtime no podrá leer secretos escritos en el formato canónico."
      );
    }
  }

  return {
    producto: "developer",
    ok,
    mecanismo,
    variablesAceptadas: ["DEVELOPER_TOKEN_ENCRYPTION_MODE", "KMS_KEY_NAME", "DEVELOPER_TOKEN_ENCRYPTION_KEY"],
    faltante: ok
      ? null
      : "Cifrado canónico de Developer no disponible. Configura DEVELOPER_TOKEN_ENCRYPTION_MODE=kms + KMS_KEY_NAME " +
        "(producción, envelope KMS -> dev2), o DEVELOPER_TOKEN_ENCRYPTION_KEY con modo static (local/CI -> dev1). " +
        "secure-crypto.ts es FAIL-CLOSED: sin el mecanismo canónico, /api/developer/whatsapp/connect responde " +
        "`encryption_unavailable` y ningún número se conecta. La sola presencia de la clave estática NO valida un runtime configurado para KMS.",
    formatoCanonico,
    puedeLeerDev1,
    puedeLeerDev2,
    coberturaLectura,
    advertencias,
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
