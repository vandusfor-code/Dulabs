import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  decidirReinicio,
  esNumeroPublibordados,
  esPalabraReinicio,
  permiteFallbackALegacy,
  PUBLIBORDADOS_PHONE_NUMBER_ID,
  reiniciarFlowPublibordadosSiCorresponde,
} from "@/lib/publibordados/reinicio";

const AHORA = Date.parse("2026-09-24T12:00:00Z");
const hace = (horas: number) => new Date(AHORA - horas * 3600_000).toISOString();

describe("esPalabraReinicio — mensaje completo, sin adivinar", () => {
  for (const s of ["reiniciar", "Reiniciar", "REINICIAR!", "menú", "Menu", "MENÚ.", " inicio ", "Inicio 🙏"]) {
    it(`"${s}" → reinicia`, () => assert.equal(esPalabraReinicio(s), true));
  }
  for (const s of ["", "hola", "menú de gorras", "quiero reiniciar el pedido", "inicios", "empresa", "6"]) {
    it(`"${s}" → no reinicia`, () => assert.equal(esPalabraReinicio(s), false));
  }
});

describe("decidirReinicio", () => {
  const activa = (status: string, horas = 0) => ({ status, last_activity_at: hace(horas) }) as never;

  it("sin ejecución activa → nada (el camino normal ya arranca en la bienvenida)", () => {
    assert.equal(decidirReinicio({ texto: "menú", activa: null, ahoraMs: AHORA }), null);
  });
  it("palabra de reinicio con ejecución esperando respuesta → 'palabra'", () => {
    assert.equal(decidirReinicio({ texto: "menú", activa: activa("waiting_input"), ahoraMs: AHORA }), "palabra");
  });
  it("> 24 h sin actividad → 'inactividad' (texto o botón)", () => {
    assert.equal(decidirReinicio({ texto: "Hola", activa: activa("waiting_input", 24.5), ahoraMs: AHORA }), "inactividad");
    assert.equal(decidirReinicio({ texto: "Empresa", buttonId: "empresa", activa: activa("waiting_input", 48), ahoraMs: AHORA }), "inactividad");
  });
  it("≤ 24 h → continúa donde iba", () => {
    assert.equal(decidirReinicio({ texto: "Hola", activa: activa("waiting_input", 23.9), ahoraMs: AHORA }), null);
  });
  it("NUNCA corta una transferencia en curso (waiting_effect), ni con palabra ni por tiempo", () => {
    assert.equal(decidirReinicio({ texto: "menú", activa: activa("waiting_effect", 100), ahoraMs: AHORA }), null);
  });
  it("un botón con el id 'inicio' no cuenta como palabra de reinicio", () => {
    assert.equal(decidirReinicio({ texto: "inicio", buttonId: "inicio", activa: activa("waiting_input"), ahoraMs: AHORA }), null);
  });
});

describe("reiniciarFlowPublibordadosSiCorresponde — exclusivo de Publi Bordados", () => {
  it("solo reconoce el número de Publi Bordados", () => {
    assert.equal(esNumeroPublibordados(PUBLIBORDADOS_PHONE_NUMBER_ID), true);
    assert.equal(esNumeroPublibordados("1321997104321708"), false); // Solo Talento
  });

  it("otro número: no consulta ni modifica nada", async () => {
    let tocado = false;
    const store = {
      getActiveExecution: async () => {
        tocado = true;
        return null;
      },
      saveExecutionState: async () => {
        tocado = true;
        return { stateVersion: 2 } as never;
      },
    };
    const r = await reiniciarFlowPublibordadosSiCorresponde({
      supabase: {} as SupabaseClient,
      store,
      tenantId: "t",
      phoneNumberId: "1321997104321708",
      telefonoCliente: "573000000000",
      texto: "menú",
      wamid: "w1",
    });
    assert.equal(r, null);
    assert.equal(tocado, false);
  });

  it("un error de la base al verificar duplicados NO reinicia (fail-safe)", async () => {
    let guardado = false;
    const supabase = {
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }) }) }) }),
    } as unknown as SupabaseClient;
    const r = await reiniciarFlowPublibordadosSiCorresponde({
      supabase,
      store: {
        getActiveExecution: async () => ({ id: "x", status: "waiting_input", last_activity_at: hace(0), state_version: 1 }) as never,
        saveExecutionState: async () => {
          guardado = true;
          return { stateVersion: 2 } as never;
        },
      },
      tenantId: "t",
      phoneNumberId: PUBLIBORDADOS_PHONE_NUMBER_ID,
      telefonoCliente: "573000000000",
      texto: "menú",
      wamid: "w1",
      ahoraMs: AHORA,
    });
    assert.equal(r, null);
    assert.equal(guardado, false);
  });
});

describe("permiteFallbackALegacy — Publi Bordados nunca cae a IA generativa", () => {
  it("Publi Bordados: no; cualquier otro número: sí (comportamiento de siempre)", () => {
    assert.equal(permiteFallbackALegacy(PUBLIBORDADOS_PHONE_NUMBER_ID), false);
    assert.equal(permiteFallbackALegacy("1321997104321708"), true);
    assert.equal(permiteFallbackALegacy("1282448611609227"), true);
  });
});
