/**
 * AMORE -- lector de los últimos mensajes ENVIADOS a una clienta (lib/chats/salientes-recientes.ts), sobre una base en memoria. Lo que importa: devuelve solo lo ENVIADO a ESA
 * clienta de ESE negocio, del más nuevo al más viejo, con quién lo escribió, y que ante cualquier fallo NUNCA lanza (null = «no se pudo leer»).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerSalientesRecientes } from "@/lib/chats/salientes-recientes";
import { crearSupabaseEnMemoria, type TablasEnMemoria } from "@/lib/test-helpers/supabase-en-memoria";

const T = "11111111-1111-4111-8111-111111111111";
const OTRO_T = "22222222-2222-4222-8222-222222222222";
const TEL = "573148127388";
const OTRO_TEL = "573001112233";

function tablas(): TablasEnMemoria {
  return {
    dulabs_chat_conversaciones: [
      { id: 9, id_tenant: T, telefono: TEL },
      { id: 10, id_tenant: T, telefono: OTRO_TEL },
      { id: 11, id_tenant: OTRO_T, telefono: TEL },
    ],
    dulabs_chat_mensajes: [
      { id: 1, conversacion_id: 9, direccion: "saliente", origen: "automatico", texto: "uno", enviado_en: "2026-10-29T10:00:00.000Z" },
      { id: 2, conversacion_id: 9, direccion: "entrante", origen: "humano", texto: "hola (de la clienta)", enviado_en: "2026-10-29T10:01:00.000Z" },
      { id: 3, conversacion_id: 9, direccion: "saliente", origen: "humano", texto: "dos", enviado_en: "2026-10-29T10:02:00.000Z" },
      { id: 4, conversacion_id: 9, direccion: "saliente", origen: "automatico", texto: "tres", enviado_en: "2026-10-29T10:03:00.000Z" },
      { id: 5, conversacion_id: 10, direccion: "saliente", origen: "humano", texto: "de otra clienta", enviado_en: "2026-10-29T10:04:00.000Z" },
      { id: 6, conversacion_id: 11, direccion: "saliente", origen: "humano", texto: "de otro negocio", enviado_en: "2026-10-29T10:05:00.000Z" },
    ],
  };
}

describe("leerSalientesRecientes", () => {
  it("devuelve solo lo ENVIADO a esa clienta de ese negocio, del más nuevo al más viejo, con su origen, texto y hora", async () => {
    const r = await leerSalientesRecientes(crearSupabaseEnMemoria(tablas()), { idTenant: T, telefono: TEL });
    assert.deepEqual(r, [
      { origen: "automatico", texto: "tres", enviadoEn: "2026-10-29T10:03:00.000Z" },
      { origen: "humano", texto: "dos", enviadoEn: "2026-10-29T10:02:00.000Z" },
      { origen: "automatico", texto: "uno", enviadoEn: "2026-10-29T10:00:00.000Z" },
    ]);
  });

  it("nunca mezcla los mensajes de otra clienta ni de otro negocio", async () => {
    const otraClienta = await leerSalientesRecientes(crearSupabaseEnMemoria(tablas()), { idTenant: T, telefono: OTRO_TEL });
    assert.deepEqual(otraClienta?.map((m) => m.texto), ["de otra clienta"]);
    const otroNegocio = await leerSalientesRecientes(crearSupabaseEnMemoria(tablas()), { idTenant: OTRO_T, telefono: TEL });
    assert.deepEqual(otroNegocio?.map((m) => m.texto), ["de otro negocio"]);
  });

  it("respeta el límite (se queda con los más NUEVOS)", async () => {
    const r = await leerSalientesRecientes(crearSupabaseEnMemoria(tablas()), { idTenant: T, telefono: TEL, limite: 2 });
    assert.deepEqual(r?.map((m) => m.texto), ["tres", "dos"]);
  });

  it("sin conversación todavía -> lista vacía (no es un error)", async () => {
    const r = await leerSalientesRecientes(crearSupabaseEnMemoria(tablas()), { idTenant: T, telefono: "573009998877" });
    assert.deepEqual(r, []);
  });

  it("un origen desconocido o una fila sin texto/hora se devuelven como null, sin inventar nada", async () => {
    const t = tablas();
    t.dulabs_chat_mensajes!.push({ id: 7, conversacion_id: 9, direccion: "saliente", origen: "raro", texto: null });
    const r = await leerSalientesRecientes(crearSupabaseEnMemoria(t), { idTenant: T, telefono: TEL, limite: 1 });
    assert.deepEqual(r, [{ origen: null, texto: null, enviadoEn: null }]);
  });

  it("NUNCA lanza: si la base falla devuelve null", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const quebrado = {
        from() {
          throw new Error("la base no responde");
        },
      } as unknown as SupabaseClient;
      assert.equal(await leerSalientesRecientes(quebrado, { idTenant: T, telefono: TEL }), null);
      assert.equal(await leerSalientesRecientes({} as SupabaseClient, { idTenant: T, telefono: TEL }), null);
    } finally {
      console.error = original;
    }
  });

  it("un error devuelto por la base (no lanzado) también da null, no una lista vacía engañosa", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const consulta: Record<string, unknown> = {};
      for (const metodo of ["select", "eq", "order", "limit"]) consulta[metodo] = () => consulta;
      consulta.maybeSingle = async () => ({ data: null, error: { code: "42P01", message: "relation does not exist" } });
      const conError = { from: () => consulta } as unknown as SupabaseClient;
      assert.equal(await leerSalientesRecientes(conError, { idTenant: T, telefono: TEL }), null);
    } finally {
      console.error = original;
    }
  });
});
