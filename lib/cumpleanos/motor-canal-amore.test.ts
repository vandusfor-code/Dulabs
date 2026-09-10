/**
 * Corrección de canal AMORE (Mejora Cumpleaños, autorizado) — pruebas con
 * Supabase FALSO en memoria (nunca real, nunca toca dulabs_cumpleanos_config
 * real de AMORE ni ningún dato real): verifica que un cumpleaños de AMORE
 * usa el canal REAL (WhatsApp-QR/Baileys, enviarMensajeWhatsAppAmore
 * inyectado) y NUNCA el canal de Meta Cloud API (dulabs_clientes_config) --
 * mismo criterio de seguridad ya establecido para
 * app/api/cron/recordatorios-citas/route.test.ts.
 *
 * SEGURIDAD: ningún test de este archivo llama al worker real ni a Meta --
 * `enviarMensajeWhatsAppAmore`/`enviador` SIEMPRE son mocks. El fake de
 * Supabase ni siquiera define una rama para "dulabs_clientes_config" (el
 * canal de Meta) -- si el código bajo prueba llegara a consultarla para
 * AMORE, el fake lanza "tabla inesperada" y la prueba lo detecta como un
 * fallo, probando estructuralmente que ese camino nunca se toma.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { procesarCumpleanosDelTenant } from "./motor";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import type { RespuestaWorker } from "@/lib/whatsapp-worker-client";

type FilaConfig = { id_tenant: string; activo: boolean; mensaje: string; nombre_negocio: string | null; hora_envio: string; zona_horaria: string };
type FilaCliente = { id: number; id_tenant: string; phone_number_id: string; telefono_cliente: string | null; nombre: string; cumple_dia: number; cumple_mes: number };
type FilaProcesado = { id_tenant: string; cliente_id: number; anio: number; telefono_cliente: string; estado: string; mensaje_enviado: string | null; detalle: string | null };

function crearFakeSupabase(opts: { config: FilaConfig; clientes: FilaCliente[] }) {
  const procesados: FilaProcesado[] = [];

  function from(tabla: string) {
    if (tabla === "dulabs_cumpleanos_config") {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        async maybeSingle() {
          return { data: opts.config, error: null };
        },
      };
      return builder;
    }
    if (tabla === "dulabs_clientes_conocidos") {
      const filtros: Array<(f: FilaCliente) => boolean> = [];
      const builder = {
        select() {
          return builder;
        },
        eq(campo: keyof FilaCliente, valor: unknown) {
          filtros.push((f) => f[campo] === valor);
          return builder;
        },
        then(resolve: (r: { data: FilaCliente[]; error: null }) => unknown) {
          return resolve({ data: opts.clientes.filter((f) => filtros.every((fn) => fn(f))), error: null });
        },
      };
      return builder;
    }
    if (tabla === "dulabs_cumpleanos_procesados") {
      const builder = {
        insert(fila: { id_tenant: string; cliente_id: number; anio: number; telefono_cliente: string }) {
          return {
            then(resolve: (r: { error: { code: string; message: string } | null }) => unknown) {
              const yaExiste = procesados.some((p) => p.id_tenant === fila.id_tenant && p.cliente_id === fila.cliente_id && p.anio === fila.anio);
              if (yaExiste) return resolve({ error: { code: "23505", message: "duplicate key" } });
              procesados.push({ ...fila, estado: "registrado", mensaje_enviado: null, detalle: null });
              return resolve({ error: null });
            },
          };
        },
        update(cambios: Partial<FilaProcesado>) {
          const filtros: Array<(f: FilaProcesado) => boolean> = [];
          const updateBuilder = {
            eq(campo: keyof FilaProcesado, valor: unknown) {
              filtros.push((f) => f[campo] === valor);
              return updateBuilder;
            },
            then(resolve: (r: { error: null }) => unknown) {
              for (const p of procesados) if (filtros.every((fn) => fn(p))) Object.assign(p, cambios);
              return resolve({ error: null });
            },
          };
          return updateBuilder;
        },
      };
      return builder;
    }
    throw new Error(`fake de prueba: tabla inesperada "${tabla}" -- AMORE NUNCA debe consultar el canal de Meta`);
  }

  return { supabase: { from } as unknown as SupabaseClient, procesados };
}

const CONFIG_AMORE_ACTIVA: FilaConfig = {
  id_tenant: AMORE_TENANT_ID,
  activo: true,
  mensaje: "🎂 Feliz cumpleaños, {{nombre}}! De parte de {{negocio}}",
  nombre_negocio: "AMORE",
  hora_envio: "09:00",
  zona_horaria: "America/Bogota",
};

const CLIENTE_BASE: FilaCliente = {
  id: 501,
  id_tenant: AMORE_TENANT_ID,
  phone_number_id: "whatsapp-qr:" + AMORE_TENANT_ID,
  telefono_cliente: "573148127388",
  nombre: "Carla Gómez",
  cumple_dia: 15,
  cumple_mes: 3,
};

const AHORA = new Date("2026-03-15T14:00:00.000Z"); // 09:00 Bogotá

function crearFakeEnviarAmore(resultado: RespuestaWorker<{ ok: true }> = { ok: true, data: { ok: true } }) {
  const llamadas: Array<{ tenantId: string; telefono: string; mensaje: string }> = [];
  return {
    llamadas,
    enviarMensajeWhatsAppAmore: async (params: { tenantId: string; telefono: string; mensaje: string }) => {
      llamadas.push(params);
      return resultado;
    },
  };
}

describe("Corrección de canal AMORE -- cumpleaños usa WhatsApp-QR/Baileys, NUNCA Meta", () => {
  it("envía por enviarMensajeWhatsAppAmore (Baileys), nunca consulta dulabs_clientes_config (Meta)", async () => {
    const { supabase, procesados } = crearFakeSupabase({ config: CONFIG_AMORE_ACTIVA, clientes: [CLIENTE_BASE] });
    const { llamadas, enviarMensajeWhatsAppAmore } = crearFakeEnviarAmore();

    const resultado = await procesarCumpleanosDelTenant(supabase, { idTenant: AMORE_TENANT_ID, ahora: AHORA, enviarMensajeWhatsAppAmore });

    assert.equal(resultado.candidatos, 1);
    assert.equal(resultado.procesados[0]?.resultado, "enviado");
    assert.equal(llamadas.length, 1, "el canal Baileys de AMORE debe llamarse exactamente una vez");
    assert.equal(llamadas[0]!.tenantId, AMORE_TENANT_ID);
    assert.equal(llamadas[0]!.telefono, "573148127388");
    assert.match(llamadas[0]!.mensaje, /Feliz cumpleaños, Carla Gómez! De parte de AMORE/);
    assert.equal(procesados.find((p) => p.cliente_id === 501)?.estado, "enviado");
  });

  it("un fallo del worker (worker caído/sesión desconectada) se registra como fallido, nunca lanza sin control ni tumba el lote", async () => {
    const otroCliente: FilaCliente = { ...CLIENTE_BASE, id: 502, telefono_cliente: "573009999999", nombre: "Ana Torres" };
    const { supabase, procesados } = crearFakeSupabase({ config: CONFIG_AMORE_ACTIVA, clientes: [CLIENTE_BASE, otroCliente] });
    let intento = 0;
    const enviarMensajeWhatsAppAmore = async (): Promise<RespuestaWorker<{ ok: true }>> => {
      intento++;
      if (intento === 1) return { ok: false, status: 409, error: "conflict: sesión no conectada" };
      return { ok: true, data: { ok: true } };
    };

    const resultado = await procesarCumpleanosDelTenant(supabase, { idTenant: AMORE_TENANT_ID, ahora: AHORA, enviarMensajeWhatsAppAmore });

    assert.equal(resultado.candidatos, 2);
    const fallido = resultado.procesados.find((p) => p.clienteId === 501);
    const exitoso = resultado.procesados.find((p) => p.clienteId === 502);
    assert.equal(fallido?.resultado, "fallido");
    assert.match((fallido as { detalle: string }).detalle, /conflict: sesión no conectada/);
    assert.equal(exitoso?.resultado, "enviado", "un fallo en un cliente nunca debe tumbar el resto del lote");
    assert.equal(procesados.find((p) => p.cliente_id === 501)?.estado, "fallido");
  });

  it("con `enviador` (dry-run/pruebas) presente, AMORE NUNCA llama al worker real de Baileys", async () => {
    const { supabase } = crearFakeSupabase({ config: CONFIG_AMORE_ACTIVA, clientes: [CLIENTE_BASE] });
    const llamadasDryRun: unknown[] = [];
    const { llamadas: llamadasBaileys, enviarMensajeWhatsAppAmore } = crearFakeEnviarAmore();

    const resultado = await procesarCumpleanosDelTenant(supabase, {
      idTenant: AMORE_TENANT_ID,
      ahora: AHORA,
      enviador: async (p) => {
        llamadasDryRun.push(p);
      },
      enviarMensajeWhatsAppAmore,
    });

    assert.equal(resultado.procesados[0]?.resultado, "simulado");
    assert.equal(llamadasDryRun.length, 1, "el dry-run SÍ debe recibir la llamada");
    assert.equal(llamadasBaileys.length, 0, "el worker real de Baileys NUNCA debe llamarse cuando hay un enviador de prueba");
  });

  it("negocio de AMORE desactivado (activo=false) -- no procesa nada, nunca llama al worker", async () => {
    const { supabase } = crearFakeSupabase({ config: { ...CONFIG_AMORE_ACTIVA, activo: false }, clientes: [CLIENTE_BASE] });
    const { llamadas, enviarMensajeWhatsAppAmore } = crearFakeEnviarAmore();
    const resultado = await procesarCumpleanosDelTenant(supabase, { idTenant: AMORE_TENANT_ID, ahora: AHORA, enviarMensajeWhatsAppAmore });
    assert.equal(resultado.candidatos, 0);
    assert.equal(llamadas.length, 0);
  });
});
