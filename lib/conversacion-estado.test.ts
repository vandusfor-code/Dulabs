/**
 * FASE 9 (Human Inbox, autorizado) — tests puros de
 * lib/conversacion-estado.ts. Fake de Supabase en memoria (mismo patrón que
 * lib/amore-inventario.test.ts) para el caso feliz, y un fake que simula la
 * tabla inexistente (Postgres 42P01) para probar la tolerancia a la
 * migración 20260929000000 todavía no aplicada -- mismo criterio que Fase
 * 8.5 (escribirToleranteAColumnaFaltante).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  leerEstadosConversacion,
  actualizarEstadoConversacion,
  marcarConversacionLeida,
  estadoEfectivo,
  type FilaEstadoConversacion,
} from "@/lib/conversacion-estado";

function crearFakeSupabase(seed: FilaEstadoConversacion[], opts: { tablaExiste: boolean }) {
  const filas = [...seed];
  function from(tabla: string) {
    if (tabla !== "dulabs_conversacion_estado") throw new Error(`fake de prueba: tabla inesperada "${tabla}"`);
    if (!opts.tablaExiste) {
      const error = { code: "42P01", message: 'relation "dulabs_conversacion_estado" does not exist' };
      return {
        select() { return this; },
        in() { return Promise.resolve({ data: null, error }); },
        upsert() { return Promise.resolve({ error }); },
        update() { return this; },
        eq() { return this; },
        maybeSingle() { return Promise.resolve({ data: null, error }); },
        insert() { return Promise.resolve({ error }); },
      };
    }
    const filtros: [string, unknown][] = [];
    const builder = {
      select() { return builder; },
      in(campo: string, valores: unknown[]) {
        filtros.push([campo, valores]);
        return {
          then(resolve: (r: { data: FilaEstadoConversacion[]; error: null }) => unknown) {
            const [campoIn, valoresIn] = filtros[filtros.length - 1] as [string, unknown[]];
            const data = filas.filter((f) => (valoresIn as string[]).includes((f as unknown as Record<string, unknown>)[campoIn] as string));
            return resolve({ data, error: null });
          },
        };
      },
      eq(campo: string, valor: unknown) {
        filtros.push([campo, valor]);
        return builder;
      },
      update(datos: Partial<FilaEstadoConversacion>) {
        const updater = {
          eq(campo: string, valor: unknown) {
            filtros.push([campo, valor]);
            return updater;
          },
          select() { return updater; },
          maybeSingle() {
            const fila = filas.find((f) => filtros.every(([c, v]) => (f as unknown as Record<string, unknown>)[c] === v));
            if (fila) Object.assign(fila, datos);
            return Promise.resolve({ data: fila ? { id: 1 } : null, error: null });
          },
        };
        return updater;
      },
      insert(datos: FilaEstadoConversacion) {
        filas.push(datos);
        return Promise.resolve({ error: null });
      },
      upsert(datos: FilaEstadoConversacion) {
        const existente = filas.find((f) => f.phone_number_id === datos.phone_number_id && f.telefono_cliente === datos.telefono_cliente);
        if (existente) Object.assign(existente, datos);
        else filas.push(datos);
        return Promise.resolve({ error: null });
      },
    };
    return builder;
  }
  return { supabase: { from } as unknown as SupabaseClient, filas };
}

function fila(overrides: Partial<FilaEstadoConversacion> = {}): FilaEstadoConversacion {
  return {
    phone_number_id: "phone-a",
    telefono_cliente: "573000000001",
    estado: "open",
    cerrado_en: null,
    leido_hasta: "1970-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("leerEstadosConversacion", () => {
  it("1. devuelve un mapa por clave phone_number_id:telefono_cliente", async () => {
    const { supabase } = crearFakeSupabase([fila(), fila({ telefono_cliente: "573000000002", estado: "pending" })], { tablaExiste: true });
    const mapa = await leerEstadosConversacion(supabase, ["phone-a"]);
    assert.equal(mapa.size, 2);
    assert.equal(mapa.get("phone-a:573000000002")?.estado, "pending");
  });

  it("2. lista vacía de phone_number_id -> mapa vacío sin consultar Supabase", async () => {
    const { supabase } = crearFakeSupabase([fila()], { tablaExiste: true });
    const mapa = await leerEstadosConversacion(supabase, []);
    assert.equal(mapa.size, 0);
  });

  it("3. tabla inexistente (migración no aplicada) -> mapa vacío, nunca lanza", async () => {
    const { supabase } = crearFakeSupabase([], { tablaExiste: false });
    const mapa = await leerEstadosConversacion(supabase, ["phone-a"]);
    assert.equal(mapa.size, 0);
  });
});

describe("actualizarEstadoConversacion", () => {
  it("4. cerrar una conversación guarda cerrado_en", async () => {
    const { supabase, filas } = crearFakeSupabase([], { tablaExiste: true });
    const r = await actualizarEstadoConversacion(supabase, { phoneNumberId: "phone-a", telefonoCliente: "573000000001", estado: "closed" });
    assert.deepEqual(r, { ok: true });
    assert.equal(filas[0].estado, "closed");
    assert.ok(filas[0].cerrado_en);
  });

  it("5. reabrir (estado 'open') limpia cerrado_en", async () => {
    const { supabase, filas } = crearFakeSupabase([fila({ estado: "closed", cerrado_en: new Date().toISOString() })], { tablaExiste: true });
    await actualizarEstadoConversacion(supabase, { phoneNumberId: "phone-a", telefonoCliente: "573000000001", estado: "open" });
    assert.equal(filas[0].estado, "open");
    assert.equal(filas[0].cerrado_en, null);
  });

  it("6. tabla inexistente -> motivo migracion_pendiente, nunca lanza", async () => {
    const { supabase } = crearFakeSupabase([], { tablaExiste: false });
    const r = await actualizarEstadoConversacion(supabase, { phoneNumberId: "phone-a", telefonoCliente: "573000000001", estado: "pending" });
    assert.deepEqual(r, { ok: false, motivo: "migracion_pendiente" });
  });
});

describe("marcarConversacionLeida", () => {
  it("7. fila ya existente -> UPDATE puntual, preserva 'estado'", async () => {
    const { supabase, filas } = crearFakeSupabase([fila({ estado: "pending" })], { tablaExiste: true });
    const r = await marcarConversacionLeida(supabase, { phoneNumberId: "phone-a", telefonoCliente: "573000000001" });
    assert.deepEqual(r, { ok: true });
    assert.equal(filas[0].estado, "pending", "marcar como leída nunca debe cambiar el estado open/pending/closed");
    assert.notEqual(filas[0].leido_hasta, "1970-01-01T00:00:00.000Z");
  });

  it("8. sin fila previa -> INSERT con default 'open'", async () => {
    const { supabase, filas } = crearFakeSupabase([], { tablaExiste: true });
    const r = await marcarConversacionLeida(supabase, { phoneNumberId: "phone-a", telefonoCliente: "573000000001" });
    assert.deepEqual(r, { ok: true });
    assert.equal(filas.length, 1);
    assert.equal(filas[0].phone_number_id, "phone-a");
  });

  it("9. tabla inexistente -> motivo migracion_pendiente, nunca lanza", async () => {
    const { supabase } = crearFakeSupabase([], { tablaExiste: false });
    const r = await marcarConversacionLeida(supabase, { phoneNumberId: "phone-a", telefonoCliente: "573000000001" });
    assert.deepEqual(r, { ok: false, motivo: "migracion_pendiente" });
  });
});

describe("estadoEfectivo — reopen automático sin escritura del webhook", () => {
  it("10. sin fila -> 'open' (default seguro)", () => {
    assert.equal(estadoEfectivo(undefined, "2026-01-01T00:00:00.000Z"), "open");
  });

  it("11. 'closed' sin mensajes posteriores -> sigue 'closed'", () => {
    const f = fila({ estado: "closed", cerrado_en: "2026-01-02T00:00:00.000Z" });
    assert.equal(estadoEfectivo(f, "2026-01-01T00:00:00.000Z"), "closed");
  });

  it("12. 'closed' con un mensaje entrante DESPUÉS de cerrado_en -> reabre a 'open'", () => {
    const f = fila({ estado: "closed", cerrado_en: "2026-01-01T00:00:00.000Z" });
    assert.equal(estadoEfectivo(f, "2026-01-02T00:00:00.000Z"), "open");
  });

  it("13. 'pending' nunca se toca por esta lógica (solo aplica a 'closed')", () => {
    const f = fila({ estado: "pending" });
    assert.equal(estadoEfectivo(f, "2026-01-02T00:00:00.000Z"), "pending");
  });
});
