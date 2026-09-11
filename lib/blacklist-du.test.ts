/**
 * Lista negra de DuLabs (autorizado) -- pruebas puras de lib/blacklist-du.ts.
 * Ninguna prueba de este archivo toca Supabase/Gemini/WhatsApp reales: solo
 * ejercita funciones deterministas (mismo input, mismo output), sin red.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarCampoTelefonos,
  parsearListaNegra,
  esTelefonoBloqueado,
  unirListaNegra,
} from "./blacklist-du";

describe("normalizarCampoTelefonos", () => {
  it("TEST 6: reconoce el mismo número en formatos distintos como equivalente", () => {
    const formatos = ["+57 318 123 4567", "573181234567", "3181234567", "57-318-123-4567"];
    for (const f of formatos) {
      const { validos, invalidos } = normalizarCampoTelefonos(f);
      assert.deepEqual(invalidos, [], `"${f}" no debería marcarse inválido`);
      assert.deepEqual(validos, ["573181234567"], `"${f}" debería normalizar a 573181234567`);
    }
  });

  it("separa un campo con varios teléfonos (formato real de export de contactos)", () => {
    const { validos, invalidos } = normalizarCampoTelefonos("314-506-5410 ::: 301-418-8306");
    assert.deepEqual(validos.sort(), ["573014188306", "573145065410"]);
    assert.deepEqual(invalidos, []);
  });

  it("también separa por ';' y '/'", () => {
    assert.deepEqual(normalizarCampoTelefonos("3181234567;3201234567").validos.sort(), [
      "573181234567",
      "573201234567",
    ]);
    assert.deepEqual(normalizarCampoTelefonos("3181234567/3201234567").validos.sort(), [
      "573181234567",
      "573201234567",
    ]);
  });

  it("marca inválido un fragmento demasiado corto sin adivinar el indicativo", () => {
    const { validos, invalidos } = normalizarCampoTelefonos("611");
    assert.deepEqual(validos, []);
    assert.deepEqual(invalidos, ["611"]);
  });

  it("marca inválido un número demasiado largo (probable corrupción)", () => {
    const { validos, invalidos } = normalizarCampoTelefonos("62859106863164");
    assert.deepEqual(validos, []);
    assert.deepEqual(invalidos, ["62859106863164"]);
  });

  it("marca inválido un dígito repetido (placeholder, no un teléfono real)", () => {
    const { validos, invalidos } = normalizarCampoTelefonos("1111111111");
    assert.deepEqual(validos, []);
    assert.deepEqual(invalidos, ["1111111111"]);
  });

  it("acepta un número internacional ya con indicativo (no lo fuerza a Colombia)", () => {
    const { validos, invalidos } = normalizarCampoTelefonos("+54 380 464 8174");
    assert.deepEqual(validos, ["543804648174"]);
    assert.deepEqual(invalidos, []);
  });

  it("campo vacío no produce ni válidos ni inválidos", () => {
    assert.deepEqual(normalizarCampoTelefonos(""), { validos: [], invalidos: [] });
    assert.deepEqual(normalizarCampoTelefonos("   "), { validos: [], invalidos: [] });
  });
});

describe("esTelefonoBloqueado", () => {
  const LISTA = "573181234567,573001112233,573145065410";

  it("TEST: número en la lista negra -> bloqueado", () => {
    assert.equal(esTelefonoBloqueado(LISTA, "573181234567"), true);
  });

  it("TEST 7: número parecido pero diferente -> NO se bloquea", () => {
    // mismo prefijo, último dígito distinto
    assert.equal(esTelefonoBloqueado(LISTA, "573181234568"), false);
    // un dígito de más
    assert.equal(esTelefonoBloqueado(LISTA, "5731812345670"), false);
    // un dígito de menos
    assert.equal(esTelefonoBloqueado(LISTA, "57318123456"), false);
  });

  it("TEST 5: número que NO está en la lista negra -> no bloqueado (Du sigue funcionando normal)", () => {
    assert.equal(esTelefonoBloqueado(LISTA, "573009998888"), false);
  });

  it("lista vacía o null nunca bloquea nada", () => {
    assert.equal(esTelefonoBloqueado(null, "573181234567"), false);
    assert.equal(esTelefonoBloqueado(undefined, "573181234567"), false);
    assert.equal(esTelefonoBloqueado("", "573181234567"), false);
  });

  it("teléfono vacío nunca se considera bloqueado (nunca compara contra vacío)", () => {
    assert.equal(esTelefonoBloqueado(LISTA, ""), false);
  });

  it("TEST 8 (parcial, ver también app/webhook-dulabs/blacklist-orden.test.ts): la función es pura -- solo usa el string que recibe, nunca consulta otro tenant/phone_number_id", () => {
    // Lista negra de OTRO tenant (hipotética) no afecta esta comparación:
    // esTelefonoBloqueado no sabe ni le importa de qué cliente viene la
    // lista -- el aislamiento por phone_number_id lo garantiza quien LLAMA
    // a esta función (el webhook, que resuelve `cliente` por phone_number_id
    // antes de leer cliente.ia_numeros_bloqueados).
    const listaOtroTenant = "573009998888";
    assert.equal(esTelefonoBloqueado(listaOtroTenant, "573181234567"), false);
  });
});

describe("parsearListaNegra", () => {
  it("ignora espacios y entradas vacías", () => {
    const set = parsearListaNegra(" 573181234567 ,, 573001112233 ,");
    assert.deepEqual([...set].sort(), ["573001112233", "573181234567"]);
  });
});

describe("unirListaNegra", () => {
  it("agrega números nuevos sin duplicar los existentes", () => {
    const { resultado, agregados, yaExistian } = unirListaNegra("573181234567,573001112233", [
      "573001112233", // ya existía
      "573009998888", // nuevo
    ]);
    const setFinal = new Set(resultado.split(","));
    assert.equal(agregados, 1);
    assert.equal(yaExistian, 1);
    assert.equal(setFinal.size, 3);
    assert.ok(setFinal.has("573181234567"), "no debe eliminar lo que ya existía");
    assert.ok(setFinal.has("573001112233"));
    assert.ok(setFinal.has("573009998888"));
  });

  it("nunca elimina números existentes aunque `nuevos` esté vacío", () => {
    const { resultado, agregados } = unirListaNegra("573181234567,573001112233", []);
    assert.equal(agregados, 0);
    assert.deepEqual(resultado.split(",").sort(), ["573001112233", "573181234567"]);
  });

  it("parte de lista vacía/null construye la lista desde cero sin fallar", () => {
    const { resultado, agregados } = unirListaNegra(null, ["573181234567"]);
    assert.equal(agregados, 1);
    assert.equal(resultado, "573181234567");
  });
});
