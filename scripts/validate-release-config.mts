// Guard de release (autorizado -- protección del incidente de Fase 10).
//
// Corre ANTES de `next build` (ver package.json -> "build"). En una release de
// PRODUCCIÓN exige que la configuración criptográfica OBLIGATORIA de cada
// producto exista; si falta, FALLA de forma explícita (exit 1) para que una
// release inválida jamás llegue a producción en silencio.
//
// Incidente que previene: Vercel Production sin DEVELOPER_TOKEN_ENCRYPTION_KEY
// ni KMS_KEY_NAME -> /api/developer/whatsapp/connect respondía
// `encryption_unavailable` y ningún número se conectaba, sin ninguna señal en
// build ni deploy.
//
// Distingue Business (TOKEN_ENCRYPTION_KEY) de Developer
// (DEVELOPER_TOKEN_ENCRYPTION_KEY | KMS_KEY_NAME). Nunca imprime el VALOR de
// ningún secreto -- solo su presencia y el mecanismo detectado.
//
// Solo BLOQUEA en producción (VERCEL_ENV=production). En preview/local informa
// pero no bloquea, para no romper builds de desarrollo/preview.
import { validarConfigCriptograficaDeRelease } from "@/lib/config/release-crypto-config";

const entorno = process.env.VERCEL_ENV ?? "local";
const esProduccion = entorno === "production";

const r = validarConfigCriptograficaDeRelease({ entorno });

console.log(`[validate-release-config] entorno=${entorno}`);
for (const e of r.estados) {
  const extra =
    e.producto === "developer" && e.formatoCanonico
      ? ` [canónico=${e.formatoCanonico}; lee dev1=${e.puedeLeerDev1} dev2=${e.puedeLeerDev2}]`
      : "";
  console.log(
    `  - ${e.producto}: ${e.ok ? "OK" : "FALTA"} ` +
      `(mecanismo=${e.mecanismo}; acepta: ${e.variablesAceptadas.join(" | ")})${extra}`
  );
  for (const w of e.advertencias ?? []) console.warn(`      ⚠ ${e.producto}: ${w}`);
}

// Fase 20 (B2): en PRODUCCIÓN el formato canónico de Developer debe ser dev2
// (envelope KMS) o dev1 (clave estática) -- CUALQUIERA de los dos mecanismos
// SOPORTADOS por completo (nunca un tercer valor inválido ni "sin mecanismo").
// dev2 sigue siendo la opción preferida (ver docs de Fase 20), pero exigirla
// SIEMPRE asume acceso a KMS vía Workload Identity Federation, que Vercel solo
// ofrece en planes Pro/Enterprise -- en Hobby (autorizado, 2026-09-22) dev1
// queda aceptado como mecanismo de producción válido, siempre que la clave
// estática esté sincronizada en Vercel + Secret Manager + el worker que la
// necesite (dulabs-outbound-worker). Esto solo relaja el guard, no la
// fortaleza del cifrado en sí: AES-256-GCM es el mismo algoritmo en ambos
// casos, dev1 y dev2 -- la única diferencia es dónde vive la clave maestra
// (estática vs envuelta por KMS). Si el plan de Vercel sube a Pro/Enterprise,
// se puede volver a exigir solo "dev2" quitando "dev1" del set de abajo.
const dev = r.estados.find((e) => e.producto === "developer");
const FORMATOS_CANONICOS_ACEPTADOS_EN_PROD = new Set(["dev2", "dev1"]);
const developerNoCanonicoEnProd =
  esProduccion && dev !== undefined && dev.ok && !FORMATOS_CANONICOS_ACEPTADOS_EN_PROD.has(dev.formatoCanonico ?? "");

if (r.ok && !developerNoCanonicoEnProd) {
  console.log("[validate-release-config] configuración criptográfica completa. Continúa el build.");
  process.exit(0);
}

if (esProduccion) {
  console.error(
    "\n[validate-release-config] ❌ RELEASE BLOQUEADA -- configuración criptográfica inválida en PRODUCCIÓN:"
  );
  for (const e of r.faltantes) console.error(`  ✗ ${e.producto}: ${e.faltante}`);
  if (developerNoCanonicoEnProd) {
    console.error(
      `  ✗ developer: el formato canónico de escritura es "${dev?.formatoCanonico}", pero en producción debe ser "dev2" (KMS) o "dev1" (clave estática). ` +
        "Configura DEVELOPER_TOKEN_ENCRYPTION_MODE=kms + KMS_KEY_NAME (+ acceso KMS vía WIF en Vercel, requiere plan Pro/Enterprise), " +
        "o DEVELOPER_TOKEN_ENCRYPTION_MODE=static + DEVELOPER_TOKEN_ENCRYPTION_KEY. " +
        "Ver docs/DULABS_DEVELOPER_V1_PHASE_20_REMEDIATION_REPORT.md."
    );
  }
  console.error(
    "\nCorrige la configuración en Vercel (Production) y vuelve a desplegar. El build NO continuará."
  );
  process.exit(1);
}

console.warn(
  `\n[validate-release-config] ⚠ ADVERTENCIA (entorno '${entorno}', no productivo): falta configuración; no se bloquea el build:`
);
for (const e of r.faltantes) console.warn(`  ! ${e.producto}: ${e.faltante}`);
process.exit(0);
