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

// Fase 20 (B2): en PRODUCCIÓN el formato canónico de Developer DEBE ser dev2
// (envelope KMS). Un build de producción que escribiría dev1 (clave estática)
// queda BLOQUEADO -- fail-closed, para que el dashboard nunca vuelva a producir
// tokens que el pipeline de Cloud Run no pueda descifrar (raíz de B2).
const dev = r.estados.find((e) => e.producto === "developer");
const developerNoCanonicoEnProd = esProduccion && dev !== undefined && dev.ok && dev.formatoCanonico !== "dev2";

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
      `  ✗ developer: el formato canónico de escritura es "${dev?.formatoCanonico}", pero en producción DEBE ser "dev2" (envelope KMS). ` +
        "Configura DEVELOPER_TOKEN_ENCRYPTION_MODE=kms + KMS_KEY_NAME (+ acceso KMS vía WIF en Vercel). " +
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
