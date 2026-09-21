/**
 * Política de polling de la bandeja de chats: no consultar con la pestaña oculta y ir despacio si nadie la usa (el polling
 * ininterrumpido agotaba el egress de Supabase). Puro + guardas de código para que nadie reintroduzca el bucle ciego.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { INACTIVIDAD_MS, INTERVALO_INACTIVO_MS, intervaloEfectivo } from "@/lib/chats/polling";

const AHORA = 1_800_000_000_000;

describe("intervaloEfectivo", () => {
  it("1. pestaña OCULTA => no se consulta (null), sin importar la actividad", () => {
    assert.equal(intervaloEfectivo(4000, { visible: false, ahora: AHORA, ultimaInteraccion: AHORA }), null);
    assert.equal(intervaloEfectivo(3000, { visible: false, ahora: AHORA, ultimaInteraccion: AHORA - 10 * INACTIVIDAD_MS }), null);
  });

  it("2. visible y en uso => el intervalo base de siempre (mismo 'tiempo real' para quien la usa)", () => {
    assert.equal(intervaloEfectivo(4000, { visible: true, ahora: AHORA, ultimaInteraccion: AHORA - 5_000 }), 4000);
    assert.equal(intervaloEfectivo(3000, { visible: true, ahora: AHORA, ultimaInteraccion: AHORA - INACTIVIDAD_MS }), 3000, "justo en el umbral todavía cuenta como uso");
  });

  it("3. visible pero SIN actividad más allá del umbral => intervalo lento", () => {
    assert.equal(intervaloEfectivo(4000, { visible: true, ahora: AHORA, ultimaInteraccion: AHORA - INACTIVIDAD_MS - 1 }), INTERVALO_INACTIVO_MS);
    assert.equal(intervaloEfectivo(3000, { visible: true, ahora: AHORA, ultimaInteraccion: AHORA - 60 * 60_000 }), INTERVALO_INACTIVO_MS);
  });

  it("4. nunca es MÁS rápido que el base (un base mayor al lento se respeta)", () => {
    assert.equal(intervaloEfectivo(60_000, { visible: true, ahora: AHORA, ultimaInteraccion: AHORA - 10 * INACTIVIDAD_MS }), 60_000);
  });
});

describe("guardas de código: sin bucles ciegos ni listas sin tope", () => {
  const raiz = path.resolve(__dirname, "../..");
  const leer = (rel: string) => readFileSync(path.join(raiz, rel), "utf8");

  it("5. los hooks de la bandeja usan usePollingVisible y NO un setInterval directo", () => {
    for (const rel of ["components/admin-web/chats/useChats.ts", "components/admin-web/chats/useConversacion.ts"]) {
      const src = leer(rel);
      assert.ok(src.includes("usePollingVisible("), `${rel} debe usar usePollingVisible`);
      assert.ok(!/setInterval\(/.test(src), `${rel} no debe usar setInterval directo (egress de Supabase)`);
    }
  });

  it("6. la lista de conversaciones tiene TOPE de filas (nunca la lista completa del tenant cada pocos segundos)", () => {
    const src = leer("app/api/agenda/[token]/chats/route.ts");
    assert.match(src, /\.limit\(LIMITE_CONVERSACIONES\)/);
    assert.match(src, /const LIMITE_CONVERSACIONES = \d+;/);
  });
});
