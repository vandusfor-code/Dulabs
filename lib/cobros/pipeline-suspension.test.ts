/**
 * Cobros manuales — el pipeline de WhatsApp-QR (AMORE) respeta la suspensión por pago: es la PRIMERA capa, y si el negocio no está suspendido todo sigue exactamente igual.
 * Las capas siguientes se reemplazan por «trampas» que fallan si se las toca: así se prueba que el bot no hace NADA (ni siquiera el saludo) estando suspendido.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { atenderMensajeWhatsAppQR, type DepsPipelineWhatsAppQR } from "@/lib/whatsapp-qr-pipeline";

const trampa = (nombre: string) => new Proxy({}, { get: () => { throw new Error(`no debía tocarse: ${nombre}`); } }) as never;
const params = { supabase: {} as SupabaseClient, idTenant: "T-AMORE", telefono: "573001112233", texto: "hola", wamid: "wamid.1" };
const capasTrampa = (): DepsPipelineWhatsAppQR => ({
  atencionHumana: trampa("atencionHumana"),
  registroCliente: trampa("registroCliente"),
  compraProducto: trampa("compraProducto"),
  saludoInicial: trampa("saludoInicial"),
  agendaV2: trampa("agendaV2"),
  entradaAmore: trampa("entradaAmore"),
  ejecutarBot: async () => {
    throw new Error("no debía tocarse: ejecutarBot");
  },
});

describe("pipeline WhatsApp-QR — suspensión por pago", () => {
  it("con el negocio suspendido NO responde: ninguna capa (ni humana, ni registro, ni saludo, ni agenda, ni IA, ni Flow) corre", async () => {
    const consultas: string[] = [];
    const r = await atenderMensajeWhatsAppQR(params, {
      ...capasTrampa(),
      suspendidoPorPago: async (_s, id) => {
        consultas.push(id);
        return true;
      },
    });
    assert.deepEqual(r, { ok: true, manejadoPor: "suspendido_por_pago" });
    assert.deepEqual(consultas, ["T-AMORE"], "pregunta por el negocio de ESTE mensaje");
  });

  it("devuelve ok (no un error): la ruta responde 200 al worker y el mensaje no se reintenta", async () => {
    const r = await atenderMensajeWhatsAppQR(params, { ...capasTrampa(), suspendidoPorPago: async () => true });
    assert.equal(r.ok, true);
  });

  it("sin suspensión, el mensaje sigue su camino de siempre: entra a las capas de atención (las trampas se disparan)", async () => {
    // Las capas de AMORE ignoran a los demás negocios sin tocar sus dependencias; la primera que las toca es Agenda V2. Lo que importa: NO se devolvió «suspendido_por_pago».
    await assert.rejects(atenderMensajeWhatsAppQR(params, { ...capasTrampa(), suspendidoPorPago: async () => false }), /no debía tocarse/);
  });

  it("si la consulta de suspensión falla, NO corta el servicio: el mensaje sigue su camino (falla abierto)", async () => {
    // El `supabase` de esta prueba no sabe consultar nada: la consulta real falla y el bot debe seguir. Sin inyectar `suspendidoPorPago`, se usa la real.
    await assert.rejects(atenderMensajeWhatsAppQR({ ...params, idTenant: "T-SIN-CONSULTA" }, capasTrampa()), /no debía tocarse/);
  });
});
