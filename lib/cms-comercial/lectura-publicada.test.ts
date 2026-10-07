/**
 * La lectura de lo PUBLICADO que comparte una página: lee el negocio pedido con la función de lectura activa, y FUERA de un render del servidor no memoiza (quien cobra o
 * confirma un pedido siempre lee lo vigente en ese momento). Dentro de un render de Next, `cache` de React la comparte entre la vitrina, los combos y los precios de la
 * misma página (eso se comprueba en la revisión con el servidor real: aquí no existe un render de servidor).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerPublicado } from "@/lib/cms-comercial/lectura-publicada";

const NEGOCIO_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const NEGOCIO_B = "bbbbbbbb-0000-4000-8000-00000000000b";

/** Un cliente de base de datos que solo conoce la función de lectura activa y apunta cada llamada. */
function clienteFalso(respuesta: unknown) {
  const llamadas: Array<{ nombre: string; args: Record<string, unknown> }> = [];
  const supabase = {
    async rpc(nombre: string, args: Record<string, unknown>) {
      llamadas.push({ nombre, args });
      return { data: respuesta, error: null };
    },
  } as unknown as SupabaseClient;
  return { supabase, llamadas };
}

const ENCENDIDO_VACIO = { habilitado: true, entidades: [], assets: [] };
const APAGADO = { habilitado: false, entidades: [], assets: [] };

describe("leerPublicado", () => {
  it("lee el negocio pedido con la función de lectura activa y entrega la instantánea de ese negocio", async () => {
    const { supabase, llamadas } = clienteFalso(ENCENDIDO_VACIO);
    const snap = await leerPublicado(supabase, NEGOCIO_A);
    assert.equal(snap?.tenantId, NEGOCIO_A);
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].nombre, "dulabs_cms_lectura_activa");
    assert.ok(Object.values(llamadas[0].args).includes(NEGOCIO_A), "pregunta por el negocio pedido y por ningún otro");
  });

  it("con el módulo apagado (o sin migración) entrega null: el CMS no existe para ese negocio", async () => {
    const { supabase } = clienteFalso(APAGADO);
    assert.equal(await leerPublicado(supabase, NEGOCIO_A), null);
  });

  it("FUERA de un render del servidor no memoiza: cada llamada lee lo vigente en ese momento", async () => {
    const { supabase, llamadas } = clienteFalso(ENCENDIDO_VACIO);
    await leerPublicado(supabase, NEGOCIO_A);
    await leerPublicado(supabase, NEGOCIO_A);
    assert.equal(llamadas.length, 2);
  });

  it("negocios distintos, lecturas distintas (nunca se entrega la instantánea de otro negocio)", async () => {
    const { supabase, llamadas } = clienteFalso(ENCENDIDO_VACIO);
    const a = await leerPublicado(supabase, NEGOCIO_A);
    const b = await leerPublicado(supabase, NEGOCIO_B);
    assert.deepEqual([a?.tenantId, b?.tenantId], [NEGOCIO_A, NEGOCIO_B]);
    assert.equal(llamadas.length, 2);
  });

  it("un error de la base de datos se propaga: quien cobra decide (el pedido no se prepara con un precio sin verificar)", async () => {
    const supabase = {
      async rpc() {
        return { data: null, error: { code: "XX000", message: "base caída", details: null, hint: null } };
      },
    } as unknown as SupabaseClient;
    await assert.rejects(leerPublicado(supabase, NEGOCIO_A));
  });
});
