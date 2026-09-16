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
  console.log(
    `  - ${e.producto}: ${e.ok ? "OK" : "FALTA"} ` +
      `(mecanismo=${e.mecanismo}; acepta: ${e.variablesAceptadas.join(" | ")})`
  );
}

if (r.ok) {
  console.log("[validate-release-config] configuración criptográfica completa. Continúa el build.");
  process.exit(0);
}

if (esProduccion) {
  console.error(
    "\n[validate-release-config] ❌ RELEASE BLOQUEADA -- falta configuración criptográfica obligatoria en PRODUCCIÓN:"
  );
  for (const e of r.faltantes) console.error(`  ✗ ${e.producto}: ${e.faltante}`);
  console.error(
    "\nConfigura la(s) variable(s) en Vercel (Production) y vuelve a desplegar. El build NO continuará."
  );
  process.exit(1);
}

console.warn(
  `\n[validate-release-config] ⚠ ADVERTENCIA (entorno '${entorno}', no productivo): falta configuración; no se bloquea el build:`
);
for (const e of r.faltantes) console.warn(`  ! ${e.producto}: ${e.faltante}`);
process.exit(0);
