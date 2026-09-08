/**
 * Fase 1 AMORE (atención humana, autorizado) — obtenerHistorialRecienteChat
 * contra Supabase real, con un tenant/conversación descartables (randomUUID),
 * nunca AMORE real. Se limpia todo lo creado al final de cada test.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { obtenerHistorialRecienteChat } from "./historial-reciente";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("obtenerHistorialRecienteChat -- integración real (descartable)", { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" }, () => {
  const supabase = HAS_SUPABASE ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) : (null as never);
  const conversacionesCreadas: number[] = [];

  after(async () => {
    if (!HAS_SUPABASE) return;
    for (const id of conversacionesCreadas) {
      await supabase.from("dulabs_chat_mensajes").delete().eq("conversacion_id", id);
      await supabase.from("dulabs_chat_conversaciones").delete().eq("id", id);
    }
  });

  async function crearConversacionConMensajes(idTenant: string, telefono: string, mensajes: { direccion: "entrante" | "saliente"; tipo: "texto" | "audio"; texto: string | null; wamid: string }[]) {
    const { data: conv } = await supabase
      .from("dulabs_chat_conversaciones")
      .insert({ id_tenant: idTenant, telefono, nombre_visible: telefono, estado: "automatico" })
      .select("id")
      .single();
    const conversacionId = conv!.id as number;
    conversacionesCreadas.push(conversacionId);
    for (const m of mensajes) {
      await supabase.from("dulabs_chat_mensajes").insert({
        id_tenant: idTenant,
        conversacion_id: conversacionId,
        direccion: m.direccion,
        tipo: m.tipo,
        texto: m.texto,
        whatsapp_message_id: m.wamid,
        origen: m.direccion === "entrante" ? "humano" : "automatico",
      });
    }
    return conversacionId;
  }

  it("sin conversación previa -- historial vacío, nunca lanza", async () => {
    const historial = await obtenerHistorialRecienteChat(supabase, { idTenant: randomUUID(), telefono: "573000000000", wamidActual: randomUUID() });
    assert.deepEqual(historial, []);
  });

  it("arma el historial en orden cronológico, mapeando entrante->user / saliente->model", async () => {
    const idTenant = randomUUID();
    const telefono = "573000000001";
    await crearConversacionConMensajes(idTenant, telefono, [
      { direccion: "entrante", tipo: "texto", texto: "Hola, quiero maquillaje y peinado", wamid: randomUUID() },
      { direccion: "saliente", tipo: "texto", texto: "¿Tienes alguna fecha en mente?", wamid: randomUUID() },
      { direccion: "entrante", tipo: "texto", texto: "El 20 de septiembre", wamid: randomUUID() },
    ]);
    const historial = await obtenerHistorialRecienteChat(supabase, { idTenant, telefono, wamidActual: randomUUID() });
    assert.deepEqual(historial, [
      { role: "user", text: "Hola, quiero maquillaje y peinado" },
      { role: "model", text: "¿Tienes alguna fecha en mente?" },
      { role: "user", text: "El 20 de septiembre" },
    ]);
  });

  it("excluye el mensaje cuyo whatsapp_message_id sea el wamid actual -- nunca duplicado", async () => {
    const idTenant = randomUUID();
    const telefono = "573000000002";
    const wamidActual = randomUUID();
    await crearConversacionConMensajes(idTenant, telefono, [
      { direccion: "saliente", tipo: "texto", texto: "¿Te gustaría conocer nuestras opciones?", wamid: randomUUID() },
      { direccion: "entrante", tipo: "texto", texto: "Si porfa", wamid: wamidActual },
    ]);
    const historial = await obtenerHistorialRecienteChat(supabase, { idTenant, telefono, wamidActual });
    assert.deepEqual(historial, [{ role: "model", text: "¿Te gustaría conocer nuestras opciones?" }]);
  });

  it("descarta mensajes de audio -- nunca inventa texto para ellos", async () => {
    const idTenant = randomUUID();
    const telefono = "573000000003";
    await crearConversacionConMensajes(idTenant, telefono, [
      { direccion: "entrante", tipo: "texto", texto: "Hola", wamid: randomUUID() },
      { direccion: "entrante", tipo: "audio", texto: null, wamid: randomUUID() },
      { direccion: "saliente", tipo: "texto", texto: "¡Hola! ¿En qué te ayudo?", wamid: randomUUID() },
    ]);
    const historial = await obtenerHistorialRecienteChat(supabase, { idTenant, telefono, wamidActual: randomUUID() });
    assert.deepEqual(historial, [
      { role: "user", text: "Hola" },
      { role: "model", text: "¡Hola! ¿En qué te ayudo?" },
    ]);
  });

  it("recorta al máximo de turnos pedido", async () => {
    const idTenant = randomUUID();
    const telefono = "573000000004";
    const mensajes = Array.from({ length: 10 }, (_, i) => ({
      direccion: (i % 2 === 0 ? "entrante" : "saliente") as "entrante" | "saliente",
      tipo: "texto" as const,
      texto: `mensaje ${i}`,
      wamid: randomUUID(),
    }));
    await crearConversacionConMensajes(idTenant, telefono, mensajes);
    const historial = await obtenerHistorialRecienteChat(supabase, { idTenant, telefono, wamidActual: randomUUID(), maxTurnos: 3 });
    assert.equal(historial.length, 3);
    assert.deepEqual(
      historial.map((h) => h.text),
      ["mensaje 7", "mensaje 8", "mensaje 9"],
    );
  });
});
