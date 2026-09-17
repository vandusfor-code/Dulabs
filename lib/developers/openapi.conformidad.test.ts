/**
 * DuLabs Developer V1 -- Fase 14. Test de CONFORMIDAD del OpenAPI contra el
 * gateway real: el spec no debe documentar rutas inexistentes, ni superficie
 * interna (/api/v1/dev/*, callback de Meta), y su catálogo de errores debe
 * coincidir con services/gateway/errors.ts. El comportamiento real es el
 * gateway; este test evita el drift spec<->código.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { OPENAPI_DEVELOPER_V1, RUTAS_PUBLICAS, OPENAPI_BASE_URL } from "@/lib/developers/openapi";

const raiz = process.cwd();
const serverSrc = readFileSync(path.join(raiz, "services/gateway/server.ts"), "utf8");
const errorsSrc = readFileSync(path.join(raiz, "services/gateway/errors.ts"), "utf8");

describe("Fase 14 -- conformidad OpenAPI <-> gateway", () => {
  it("cada ruta pública del spec existe en el ruteo real del gateway", () => {
    const pathsSpec = Object.keys(OPENAPI_DEVELOPER_V1.paths);
    // Las rutas declaradas (RUTAS_PUBLICAS) coinciden exactamente con las del spec.
    assert.deepEqual(pathsSpec.slice().sort(), [...RUTAS_PUBLICAS].sort());
    for (const ruta of pathsSpec) {
      if (ruta.includes("{")) {
        const prefijo = ruta.split("/{")[0];
        assert.ok(serverSrc.includes(`"/api/v1${prefijo}/"`), `gateway debe rutear /api/v1${prefijo}/ (spec: ${ruta})`);
      } else {
        assert.ok(serverSrc.includes(`"/api/v1${ruta}"`), `gateway debe rutear /api/v1${ruta} (spec: ${ruta})`);
      }
    }
  });

  it("NO documenta superficie interna (/dev/*, callback de Meta)", () => {
    const todas = JSON.stringify(OPENAPI_DEVELOPER_V1);
    assert.ok(!todas.includes("/dev/"), "el spec no debe incluir /api/v1/dev/*");
    assert.ok(!todas.includes("webhooks/meta"), "el spec no debe incluir la callback de Meta");
    for (const r of RUTAS_PUBLICAS) {
      assert.ok(!r.includes("/dev/") && !r.includes("meta"), `ruta interna filtrada: ${r}`);
    }
  });

  it("el catálogo de códigos de error del spec coincide con errors.ts", () => {
    // Extrae los strings entre comillas del bloque `type CodigoErrorApi = ...;`
    const bloque = errorsSrc.slice(errorsSrc.indexOf("CodigoErrorApi"), errorsSrc.indexOf(";", errorsSrc.indexOf("CodigoErrorApi")));
    const codigosReales = new Set([...bloque.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
    const codigosSpec = new Set<string>(OPENAPI_DEVELOPER_V1.components.schemas.Error.properties.error.properties.code.enum as readonly string[]);
    assert.deepEqual([...codigosSpec].sort(), [...codigosReales].sort());
  });

  it("base URL y seguridad por API key declaradas", () => {
    assert.equal(OPENAPI_DEVELOPER_V1.servers[0].url, OPENAPI_BASE_URL);
    assert.equal(OPENAPI_DEVELOPER_V1.components.securitySchemes.apiKey.scheme, "bearer");
  });
});
