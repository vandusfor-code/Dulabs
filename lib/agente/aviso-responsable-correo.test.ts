/**
 * FASE 3B.9E — canal "correo" del aviso a la persona responsable de un pedido pendiente de aceptación. Proveedor de correo FALSO (nada sale a Resend).
 *
 *   - el correo es un aviso INTERNO: solo el número público del pedido y el enlace al panel; nunca datos del cliente;
 *   - sin correo utilizable o sin número de pedido válido, no se manda nada; si el proveedor falla o lanza, "error" (nunca una excepción);
 *   - solo corre si el negocio lo configuró; el panel sigue siendo siempre el aviso base y un canal roto no impide los demás.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { canalPanel, notificarResponsablePedido } from "@/lib/agente/aceptacion-humana";
import { RUTA_POR_ACEPTAR, correoDeAvisoResponsable, crearCanalCorreo } from "@/lib/agente/aviso-responsable-correo";
import type { MiembroEquipo } from "@/lib/agente/responsable";
import { enviarNotificacionEmail, type NotificacionEmail, type ResultadoEnvioEmail } from "@/lib/dunning/email-provider";

const TENANT = "aaaaaaaa-0000-4000-8000-00000000000a";
const PEDIDO = "DL-ORD-ABC234";
const PANEL = "https://tienda.ejemplo.test/dashboard/pedidos/por-aceptar";
const RESPONSABLE: MiembroEquipo = { id: 41, tenantId: TENANT, estado: "activo", rol: "agente", email: "responsable@ejemplo.test" };
const aviso = (over: Partial<{ pedido: string; responsable: MiembroEquipo }> = {}) => ({ tenantId: TENANT, pedido: PEDIDO, responsable: RESPONSABLE, clave: "clave-1", ...over });

function proveedor(resultado: ResultadoEnvioEmail | Error = { enviado: true, proveedor: "resend" }) {
  const enviados: NotificacionEmail[] = [];
  return {
    enviados,
    enviar: async (c: NotificacionEmail): Promise<ResultadoEnvioEmail> => {
      enviados.push(c);
      if (resultado instanceof Error) throw resultado;
      return resultado;
    },
  };
}

describe("3B.9E · correo a la persona responsable", () => {
  it("manda UN correo a la persona responsable con el número de pedido y el enlace al panel", async () => {
    const p = proveedor();
    const canal = crearCanalCorreo({ enviar: p.enviar, urlPanel: () => PANEL });
    assert.deepEqual(await canal.enviar(aviso()), { estado: "entregada" });
    assert.equal(p.enviados.length, 1);
    const c = p.enviados[0];
    assert.equal(c.destinatario, "responsable@ejemplo.test");
    assert.equal(c.asunto, `Pedido por aceptar ${PEDIDO}`);
    assert.ok(c.textoPlano.includes(PEDIDO) && c.textoPlano.includes(PANEL));
    assert.ok(c.html.includes(PEDIDO) && c.html.includes(`href="${PANEL}"`));
    assert.equal(RUTA_POR_ACEPTAR, "/dashboard/pedidos/por-aceptar");
  });

  it("es un aviso interno: no lleva nada del cliente (ni nombre, teléfono, dirección, documento, productos ni montos)", async () => {
    const c = correoDeAvisoResponsable({ pedido: PEDIDO, urlPanel: PANEL, destinatario: "responsable@ejemplo.test" });
    const todo = `${c.asunto}\n${c.textoPlano}\n${c.html}`;
    assert.doesNotMatch(todo, /\d{7,}/, "ninguna cifra larga (teléfono, documento, cuenta)");
    assert.doesNotMatch(todo, /\$\s?\d|cop\b|calle|carrera|barrio|c[eé]dula|documento|whatsapp/i);
    assert.ok(!/remitente/i.test(JSON.stringify(Object.keys(c))), "sin remitente propio no se fija uno: rige el del proveedor");
  });

  it("el remitente propio (si existe) viaja al proveedor; el enlace y el pedido se escapan en el HTML", async () => {
    const p = proveedor();
    const canal = crearCanalCorreo({ enviar: p.enviar, urlPanel: () => 'https://x.test/p?a=1&b="2"', remitente: () => "Pedidos <pedidos@ejemplo.test>" });
    await canal.enviar(aviso());
    assert.equal(p.enviados[0].remitente, "Pedidos <pedidos@ejemplo.test>");
    assert.ok(p.enviados[0].html.includes("a=1&amp;b=&quot;2&quot;"));
  });

  it("sin correo utilizable o sin número de pedido público válido: no se manda nada (nunca un destino inventado)", async () => {
    const p = proveedor();
    const canal = crearCanalCorreo({ enviar: p.enviar, urlPanel: () => PANEL });
    for (const email of [null, "", "   ", "sin-arroba", "a b@c.test", "x@y", "dos@a.test,tres@b.test", "<x@y.test>"]) {
      assert.deepEqual(await canal.enviar(aviso({ responsable: { ...RESPONSABLE, email } })), { estado: "error" }, String(email));
    }
    for (const pedido of ["", "DL-ORD-ABC23", "dl-ord-abc234", "ORD-1", "DL-ORD-ABC234 <script>"]) {
      assert.deepEqual(await canal.enviar(aviso({ pedido })), { estado: "error" }, pedido);
    }
    assert.equal(p.enviados.length, 0);
  });

  it("si el proveedor falla o lanza (sin clave, caído): 'error', nunca una excepción", async () => {
    for (const r of [{ enviado: false, motivo: "RESEND_API_KEY no está configurado" } as const, new Error("red caída")]) {
      const p = proveedor(r);
      const canal = crearCanalCorreo({ enviar: p.enviar, urlPanel: () => PANEL });
      assert.deepEqual(await canal.enviar(aviso()), { estado: "error" });
    }
  });

  it("solo se avisa por correo si el negocio lo configuró; un canal roto no impide el panel ni deshace nada", async () => {
    const p = proveedor();
    const correo = crearCanalCorreo({ enviar: p.enviar, urlPanel: () => PANEL });
    const orden = { id: "pedido-interno-1", orderId: PEDIDO };
    // Configuración de siempre (solo panel): no sale ningún correo aunque el adaptador exista.
    const soloPanel = await notificarResponsablePedido({ canales: { panel: canalPanel, correo } }, { tenantId: TENANT, order: orden, responsable: RESPONSABLE, canales: ["panel"] });
    assert.deepEqual(soloPanel, [{ canal: "panel", estado: "entregada" }]);
    assert.equal(p.enviados.length, 0);
    // Panel + correo: los dos.
    const ambos = await notificarResponsablePedido({ canales: { panel: canalPanel, correo } }, { tenantId: TENANT, order: orden, responsable: RESPONSABLE, canales: ["panel", "correo"] });
    assert.deepEqual(ambos, [{ canal: "panel", estado: "entregada" }, { canal: "correo", estado: "entregada" }]);
    assert.equal(p.enviados.length, 1);
    // Correo caído: el panel igual queda entregado y el resultado dice "error" (el pedido nunca se deshace).
    const caido = proveedor(new Error("caído"));
    const roto = await notificarResponsablePedido({ canales: { panel: canalPanel, correo: crearCanalCorreo({ enviar: caido.enviar, urlPanel: () => PANEL }) } }, { tenantId: TENANT, order: orden, responsable: RESPONSABLE, canales: ["correo", "panel"] });
    assert.deepEqual(roto, [{ canal: "correo", estado: "error" }, { canal: "panel", estado: "entregada" }]);
  });
});

describe("3B.9E · el correo sale por el proveedor de siempre (Resend) y está cableado solo como canal opcional", () => {
  const original = { fetch: globalThis.fetch, key: process.env.RESEND_API_KEY, from: process.env.DUNNING_EMAIL_FROM };
  afterEach(() => {
    globalThis.fetch = original.fetch;
    if (original.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = original.key;
    if (original.from === undefined) delete process.env.DUNNING_EMAIL_FROM;
    else process.env.DUNNING_EMAIL_FROM = original.from;
  });

  const correo = (over: Partial<NotificacionEmail> = {}): NotificacionEmail => ({ destinatario: "responsable@ejemplo.test", asunto: "Asunto", textoPlano: "texto", html: "<p>texto</p>", ...over });
  function falsoResend() {
    const cuerpos: Array<{ from: string; to: string[]; subject: string }> = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      cuerpos.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    return cuerpos;
  }

  it("el remitente propio del correo (PEDIDOS_EMAIL_FROM) llega a Resend; sin él rige el de siempre", async () => {
    process.env.RESEND_API_KEY = "clave-de-prueba";
    process.env.DUNNING_EMAIL_FROM = "DuLabs <cobros@ejemplo.test>";
    const cuerpos = falsoResend();
    assert.deepEqual(await enviarNotificacionEmail(correo({ remitente: "Pedidos <pedidos@ejemplo.test>" })), { enviado: true, proveedor: "resend" });
    assert.deepEqual(await enviarNotificacionEmail(correo()), { enviado: true, proveedor: "resend" });
    assert.equal(cuerpos[0].from, "Pedidos <pedidos@ejemplo.test>");
    assert.equal(cuerpos[1].from, "DuLabs <cobros@ejemplo.test>", "los demás correos (cobros, bienvenida) siguen con su remitente");
    assert.deepEqual(cuerpos[0].to, ["responsable@ejemplo.test"]);
  });

  it("sin RESEND_API_KEY no sale nada y no lanza", async () => {
    delete process.env.RESEND_API_KEY;
    const cuerpos = falsoResend();
    const r = await enviarNotificacionEmail(correo());
    assert.equal(r.enviado, false);
    assert.equal(cuerpos.length, 0);
  });

  it("producción: el canal 'correo' está registrado junto al panel (solo se usa si el negocio lo configuró)", () => {
    const fuente = readFileSync(join(process.cwd(), "lib/catalogo/pedidos/produccion.ts"), "utf8").replace(/\r\n/g, "\n");
    assert.match(fuente, /notificador: \{ canales: \{ panel: canalPanel, correo: crearCanalCorreo\(\) \} \}/);
  });
});
