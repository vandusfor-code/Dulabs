/**
 * actualizarCampoPersonalizado — escritura optimista (mejora general del
 * CORE de contactos). Sin concurrencia el resultado es el de siempre (merge);
 * con un escritor concurrente, nunca se pierde lo que el otro guardó.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { actualizarCampoPersonalizado, siguienteMarcaDeTiempo } from "@/lib/clientes-conocidos";

type Fila = { id: number; id_tenant: string; phone_number_id: string; telefono_cliente: string; nombre: string; custom_fields: Record<string, unknown>; updated_at: string };

function tabla(filas: Fila[], hooks: { antesDeActualizar?: () => void } = {}) {
  let seq = filas.length;
  const supabase = {
    from(t: string) {
      assert.equal(t, "dulabs_clientes_conocidos");
      const filtros: Record<string, unknown> = {};
      let cambios: Partial<Fila> | null = null;
      const coinciden = () => filas.filter((f) => Object.entries(filtros).every(([k, v]) => (f as Record<string, unknown>)[k] === v));
      const q = {
        select: () => q,
        eq(col: string, v: unknown) {
          filtros[col] = v;
          return q;
        },
        update(c: Partial<Fila>) {
          cambios = c;
          return q;
        },
        async insert(f: Omit<Fila, "id" | "updated_at">) {
          if (filas.some((x) => x.phone_number_id === f.phone_number_id && x.telefono_cliente === f.telefono_cliente)) return { error: { code: "23505", message: "dup" } };
          filas.push({ ...f, id: ++seq, updated_at: new Date().toISOString() } as Fila);
          return { error: null };
        },
        async maybeSingle() {
          const f = coinciden()[0];
          return { data: f ? structuredClone(f) : null, error: null };
        },
        then(ok: (v: { data: unknown; error: null }) => void) {
          if (cambios) {
            hooks.antesDeActualizar?.();
            const af = coinciden();
            for (const f of af) Object.assign(f, structuredClone(cambios));
            ok({ data: af.map((f) => ({ id: f.id })), error: null });
          } else ok({ data: coinciden(), error: null });
        },
      };
      return q;
    },
  };
  return supabase as unknown as SupabaseClient;
}

const base = (): Fila => ({ id: 1, id_tenant: "t1", phone_number_id: "PN", telefono_cliente: "57300", nombre: "Ana", custom_fields: { a: 1 }, updated_at: "2026-09-24T12:00:00.000Z" });
const params = (customFields: Record<string, unknown>) => ({ idTenant: "t1", phoneNumberId: "PN", telefonoCliente: "57300", customFields });

describe("actualizarCampoPersonalizado — escritura optimista", () => {
  it("sin concurrencia: merge igual que siempre (nunca borra campos previos)", async () => {
    const filas = [base()];
    await actualizarCampoPersonalizado(tabla(filas), params({ b: 2 }));
    assert.deepEqual(filas[0].custom_fields, { a: 1, b: 2 });
    assert.ok(filas[0].updated_at > "2026-09-24T12:00:00.000Z");
  });

  it("si otro escritor (p. ej. el dashboard) guarda en medio, se relee y NO se pierde su dato", async () => {
    const filas = [base()];
    let una = true;
    const sb = tabla(filas, {
      antesDeActualizar() {
        if (!una) return;
        una = false;
        filas[0].custom_fields = { ...filas[0].custom_fields, estado: "atendido" };
        filas[0].updated_at = "2026-09-24T12:00:05.000Z";
      },
    });
    await actualizarCampoPersonalizado(sb, params({ producto: "gorras" }));
    assert.deepEqual(filas[0].custom_fields, { a: 1, estado: "atendido", producto: "gorras" });
  });

  it("contacto inexistente: lo crea con los campos (igual que antes)", async () => {
    const filas: Fila[] = [];
    await actualizarCampoPersonalizado(tabla(filas), params({ x: 1 }));
    assert.equal(filas.length, 1);
    assert.deepEqual(filas[0].custom_fields, { x: 1 });
  });

  it("solo toca SU fila (número + teléfono): otra fila queda intacta", async () => {
    const otra = { ...base(), id: 2, phone_number_id: "OTRO", custom_fields: { z: 9 } };
    const filas = [base(), otra];
    await actualizarCampoPersonalizado(tabla(filas), params({ b: 2 }));
    assert.deepEqual(filas[1].custom_fields, { z: 9 });
  });

  it("vacío: no escribe nada", async () => {
    const filas = [base()];
    await actualizarCampoPersonalizado(tabla(filas), params({}));
    assert.deepEqual(filas[0], base());
  });

  it("siguienteMarcaDeTiempo siempre avanza (dos escrituras en el mismo milisegundo nunca coinciden)", () => {
    const t = "2026-09-24T12:00:00.000Z";
    assert.ok(siguienteMarcaDeTiempo(t, Date.parse(t)) > t);
    assert.ok(siguienteMarcaDeTiempo(t, Date.parse(t) - 5000) > t, "reloj atrasado: igual avanza");
    assert.equal(siguienteMarcaDeTiempo(null, Date.parse(t)), t);
  });
});
