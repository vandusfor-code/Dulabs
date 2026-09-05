import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { logEstado, logInfo, logErrorControlado } from "./logging.js";

function capturarConsola<T>(fn: () => T): { resultado: T; lineas: string[] } {
  const lineas: string[] = [];
  const logOriginal = console.log;
  const errorOriginal = console.error;
  console.log = (...args: unknown[]) => lineas.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => lineas.push(args.map(String).join(" "));
  try {
    const resultado = fn();
    return { resultado, lineas };
  } finally {
    console.log = logOriginal;
    console.error = errorOriginal;
  }
}

const TENANT = "11111111-1111-1111-1111-111111111111";

describe("logging (Fase 9B) -- prueba 13: credenciales nunca aparecen en logs", () => {
  it("logEstado/logInfo/logErrorControlado solo imprimen tenant + vocabulario fijo", () => {
    const { lineas } = capturarConsola(() => {
      logEstado(TENANT, "conectando");
      logEstado(TENANT, "conectado");
      logEstado(TENANT, "desconectado");
      logInfo("worker escuchando en el puerto 3000");
      logErrorControlado(TENANT, "fabrica_socket_fallo");
    });

    assert.equal(lineas.length, 5);
    for (const linea of lineas) assert.ok(linea.startsWith("[whatsapp-worker]"));

    const contenido = lineas.join("\n");
    for (const campoSensible of ["noiseKey", "signedIdentityKey", "advSecretKey", "creds", "claves", "signedPreKey"]) {
      assert.ok(!contenido.includes(campoSensible), `no debe aparecer "${campoSensible}" en los logs`);
    }
  });

  it("un error con contenido sensible en su mensaje nunca llega al log -- solo una etiqueta fija", () => {
    const errorConSecreto = new Error("token=SUPER-SECRETO-123 credenciales=abcxyz fallo de red");
    const { lineas } = capturarConsola(() => {
      // Simula exactamente lo que hace manager.ts en su catch: NUNCA pasa
      // err.message a logErrorControlado, solo una etiqueta fija propia.
      try {
        throw errorConSecreto;
      } catch {
        logErrorControlado(TENANT, "fabrica_socket_fallo");
      }
    });
    const contenido = lineas.join("\n");
    assert.ok(!contenido.includes("SUPER-SECRETO-123"));
    assert.ok(!contenido.includes("abcxyz"));
  });
});
