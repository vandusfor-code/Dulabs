/**
 * FASE 3B.9E — el módulo "avisos_decision_pedidos": el mensaje al cliente tras aceptar / rechazar / cancelar un pedido pendiente de aceptación se enciende
 * SIN encender los avisos genéricos de cada etapa del pedido ("notificaciones_pedidos", con plantillas de la plataforma).
 *
 *   - negocio con solo el módulo nuevo: recibe el mensaje de decisión (con SU texto) y NINGÚN aviso genérico de etapa;
 *   - negocio con "notificaciones_pedidos" (como siempre): nada cambia (los avisos genéricos y, si tiene el texto, el de decisión);
 *   - sin ninguno de los dos, o si no se puede consultar la base: no se envía nada (fail-closed); un negocio nunca enciende el de otro.
 *
 * Supabase y WhatsApp FALSOS (en memoria): nada toca una base ni a Meta. Negocios, números y clientes ficticios.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Order } from "@/lib/catalogo/pedidos/contrato";
import { createMemoryNotificacionesStore, notificarTransicion, type EnviadorWhatsapp, type NotificadorDeps } from "@/lib/catalogo/pedidos/notificaciones";
import { MODULOS_AVISOS_DE_DECISION, MODULOS_AVISOS_DE_ESTADO, algunModuloHabilitado, createSupabaseNotificacionesStore } from "@/lib/catalogo/pedidos/notificaciones-produccion";
import { MODULOS, esModuloId, type ModuloId } from "@/lib/tenant-modulos";

const ASLC = "aaaaaaaa-0000-4000-8000-00000000000a";
const DELACOUR = "bbbbbbbb-0000-4000-8000-00000000000b";
const OTRO = "cccccccc-0000-4000-8000-00000000000c";
const PN: Record<string, string> = { [ASLC]: "100000000000001", [DELACOUR]: "100000000000002", [OTRO]: "100000000000003" };
const TEXTO_ASLC = "Tu pedido DL-ORD-ABC234 fue aceptado (texto de prueba del negocio).";

interface FilaModulo {
  id_tenant: string;
  modulo: string;
  habilitado: boolean;
}

/** Un "Supabase" que solo sabe responder la consulta de dulabs_tenant_modulos que hace moduloHabilitado. */
function supabaseFalso(filas: FilaModulo[], opts: { caido?: boolean } = {}) {
  const consultas: Array<{ tenant: string; modulo: string }> = [];
  const client = {
    from(tabla: string) {
      assert.equal(tabla, "dulabs_tenant_modulos");
      const filtro: Record<string, string> = {};
      const q = {
        select: () => q,
        eq: (columna: string, valor: string) => {
          filtro[columna] = valor;
          return q;
        },
        maybeSingle: async () => {
          consultas.push({ tenant: filtro.id_tenant, modulo: filtro.modulo });
          if (opts.caido) return { data: null, error: { message: "la base no responde" } };
          const fila = filas.find((f) => f.id_tenant === filtro.id_tenant && f.modulo === filtro.modulo);
          return { data: fila ? { habilitado: fila.habilitado } : null, error: null };
        },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, consultas };
}

const pedidoDe = (tenant: string): Order =>
  ({
    id: "pedido-interno-1",
    orderId: "DL-ORD-ABC234",
    businessId: tenant,
    status: "confirmed",
    contact: { waId: "573001110001", phoneNumberId: PN[tenant] },
    checkout: { customerName: "Laura Gómez", delivery: "domicilio", stage: "en_preparacion", paymentStatus: "pendiente" },
  }) as unknown as Order;

/** Notificador de prueba: la MISMA lógica de producción para "¿está habilitado?" y la memoria para lo demás. */
function notificadores(filas: FilaModulo[], opts: { caido?: boolean } = {}) {
  const { client } = supabaseFalso(filas, opts);
  const ahora = Date.parse("2026-10-05T15:00:00Z");
  const memoria = createMemoryNotificacionesStore({
    canales: Object.fromEntries(Object.entries(PN).map(([tenant, pn]) => [pn, { tenantId: tenant, phoneNumberId: pn, token: "token-de-prueba", nombreNegocio: "Tienda de prueba" }])),
    now: () => ahora,
  });
  for (const pn of Object.values(PN)) memoria.entrante(pn, "573001110001", new Date(ahora - 5 * 60_000).toISOString());
  const enviados: Array<{ phoneNumberId: string; texto: string }> = [];
  const enviador: EnviadorWhatsapp = {
    async enviar(canal, _telefono, texto) {
      enviados.push({ phoneNumberId: canal.phoneNumberId, texto });
      return { messageId: `wamid.${enviados.length}` };
    },
    async registrar() {},
  };
  const con = (modulos?: readonly ModuloId[]): NotificadorDeps => ({
    store: { ...memoria.store, habilitado: createSupabaseNotificacionesStore(client, modulos ? { modulos } : {}).habilitado },
    enviador,
    now: () => ahora,
    log: () => {},
  });
  return { generico: con(), decision: con(MODULOS_AVISOS_DE_DECISION), enviados, memoria };
}

const activo = (tenant: string, modulo: string, habilitado = true): FilaModulo => ({ id_tenant: tenant, modulo, habilitado });

describe("3B.9E · el módulo avisos_decision_pedidos existe y es genérico", () => {
  it("es un módulo conocido, sin tocar los demás; el id respeta el formato de la tabla", () => {
    assert.ok(esModuloId("avisos_decision_pedidos"));
    assert.ok((MODULOS as readonly string[]).includes("avisos_decision_pedidos"));
    assert.ok((MODULOS as readonly string[]).includes("notificaciones_pedidos"), "el de siempre sigue existiendo");
    assert.match("avisos_decision_pedidos", /^[a-z][a-z0-9_]{1,39}$/, "formato que exige dulabs_tenant_modulos");
    assert.deepEqual([...MODULOS_AVISOS_DE_ESTADO], ["notificaciones_pedidos"], "los avisos de cada etapa siguen dependiendo SOLO del módulo de siempre");
    assert.deepEqual([...MODULOS_AVISOS_DE_DECISION].sort(), ["avisos_decision_pedidos", "notificaciones_pedidos"]);
  });
});

describe("3B.9E · ¿está habilitado?: solo lo decide la base, por negocio, y falla cerrado", () => {
  it("avisos genéricos de etapa (como siempre): solo con notificaciones_pedidos; el módulo nuevo NO los enciende", async () => {
    const { client } = supabaseFalso([activo(ASLC, "avisos_decision_pedidos"), activo(DELACOUR, "notificaciones_pedidos")]);
    const estado = createSupabaseNotificacionesStore(client);
    assert.equal(await estado.habilitado(ASLC), false, "ASLC (solo el módulo nuevo) no recibe avisos genéricos");
    assert.equal(await estado.habilitado(DELACOUR), true, "Delacour sigue igual");
    assert.equal(await estado.habilitado(OTRO), false);
  });

  it("mensajes de decisión: con avisos_decision_pedidos o con notificaciones_pedidos; con ninguno, no; un módulo apagado no cuenta", async () => {
    const { client } = supabaseFalso([activo(ASLC, "avisos_decision_pedidos"), activo(DELACOUR, "notificaciones_pedidos"), activo(OTRO, "avisos_decision_pedidos", false)]);
    const decision = createSupabaseNotificacionesStore(client, { modulos: MODULOS_AVISOS_DE_DECISION });
    assert.equal(await decision.habilitado(ASLC), true);
    assert.equal(await decision.habilitado(DELACOUR), true, "compatibilidad: quien ya tenía notificaciones_pedidos conserva sus mensajes de decisión");
    assert.equal(await decision.habilitado(OTRO), false, "habilitado = false es apagado");
  });

  it("un negocio nunca enciende el de otro: la consulta siempre lleva el negocio y el módulo", async () => {
    const { client, consultas } = supabaseFalso([activo(DELACOUR, "avisos_decision_pedidos"), activo(DELACOUR, "notificaciones_pedidos")]);
    assert.equal(await createSupabaseNotificacionesStore(client, { modulos: MODULOS_AVISOS_DE_DECISION }).habilitado(ASLC), false);
    assert.deepEqual(consultas, [
      { tenant: ASLC, modulo: "avisos_decision_pedidos" },
      { tenant: ASLC, modulo: "notificaciones_pedidos" },
    ]);
  });

  it("si la base no responde: apagado (nunca se envía por no poder verificar)", async () => {
    const { client } = supabaseFalso([activo(ASLC, "avisos_decision_pedidos"), activo(ASLC, "notificaciones_pedidos")], { caido: true });
    assert.equal(await createSupabaseNotificacionesStore(client, { modulos: MODULOS_AVISOS_DE_DECISION }).habilitado(ASLC), false);
    assert.equal(await createSupabaseNotificacionesStore(client).habilitado(ASLC), false);
    assert.equal(await algunModuloHabilitado(client, ASLC, []), false, "sin módulos que mirar, apagado");
  });
});

describe("3B.9E · de punta a punta: ASLC recibe SU mensaje de decisión y NINGÚN aviso genérico de etapa", () => {
  it("ASLC (solo avisos_decision_pedidos): 'aceptado' sale con el texto del negocio; 'en preparación', 'enviado', etc. (plantillas de la plataforma) NO salen", async () => {
    const n = notificadores([activo(ASLC, "avisos_decision_pedidos")]);
    const aceptado = await notificarTransicion(n.decision, { tenantId: ASLC, tipo: "aceptado", antes: null, despues: pedidoDe(ASLC), miembroId: 7, texto: TEXTO_ASLC });
    assert.equal(aceptado.estado, "enviada");
    assert.deepEqual(n.enviados, [{ phoneNumberId: PN[ASLC], texto: TEXTO_ASLC }], "el texto EXACTO del negocio, por el número de ASLC");
    for (const tipo of ["pago_recibido", "en_preparacion", "enviado", "entregado", "completado"] as const) {
      const r = await notificarTransicion(n.generico, { tenantId: ASLC, tipo, antes: pedidoDe(ASLC), despues: pedidoDe(ASLC), miembroId: 7 });
      assert.deepEqual(r, { estado: "desactivada" }, tipo);
    }
    assert.equal(n.enviados.length, 1, "ningún aviso genérico (ni con el tono ni con los emojis de otro negocio)");
  });

  it("idempotente: repetir la decisión no manda otro mensaje", async () => {
    const n = notificadores([activo(ASLC, "avisos_decision_pedidos")]);
    const una = await notificarTransicion(n.decision, { tenantId: ASLC, tipo: "aceptado", antes: null, despues: pedidoDe(ASLC), miembroId: 7, texto: TEXTO_ASLC });
    const dos = await notificarTransicion(n.decision, { tenantId: ASLC, tipo: "aceptado", antes: null, despues: pedidoDe(ASLC), miembroId: 7, texto: TEXTO_ASLC });
    assert.equal(una.estado, "enviada");
    assert.equal("repetida" in dos && dos.repetida, true);
    assert.equal(n.enviados.length, 1);
  });

  it("sin ningún módulo, o con el módulo de OTRO negocio: no se envía nada", async () => {
    const n = notificadores([activo(DELACOUR, "avisos_decision_pedidos"), activo(DELACOUR, "notificaciones_pedidos")]);
    for (const tenant of [ASLC, OTRO]) {
      assert.deepEqual(await notificarTransicion(n.decision, { tenantId: tenant, tipo: "aceptado", antes: null, despues: pedidoDe(tenant), miembroId: 7, texto: TEXTO_ASLC }), { estado: "desactivada" });
    }
    assert.equal(n.enviados.length, 0);
  });

  it("Delacour (notificaciones_pedidos): sigue exactamente igual — recibe los avisos genéricos de siempre", async () => {
    const n = notificadores([activo(DELACOUR, "notificaciones_pedidos")]);
    const r = await notificarTransicion(n.generico, { tenantId: DELACOUR, tipo: "en_preparacion", antes: pedidoDe(DELACOUR), despues: pedidoDe(DELACOUR), miembroId: 3 });
    assert.equal(r.estado, "enviada");
    assert.match(n.enviados[0].texto, /en preparación/);
    assert.match(n.enviados[0].texto, /💖/, "la plantilla de siempre (de Delacour) no cambió");
  });
});

describe("3B.9E · el cableado de producción usa los módulos correctos", () => {
  const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");

  it("el gancho de 'Por aceptar' (decisiones) usa MODULOS_AVISOS_DE_DECISION; las rutas de gestión del panel siguen con el notificador de siempre", () => {
    assert.match(leer("lib/catalogo/pedidos/mensajes-decision.ts"), /productionNotificador\(input\.supabase, \{ modulos: MODULOS_AVISOS_DE_DECISION \}\)/);
    for (const ruta of ["app/api/dashboard/pedidos/[pedido]/route.ts", "app/api/dashboard/pedidos/[pedido]/notificaciones/route.ts"]) {
      const fuente = leer(ruta);
      assert.match(fuente, /productionNotificador\(supabase\)/, ruta);
      assert.doesNotMatch(fuente, /MODULOS_AVISOS_DE_DECISION|avisos_decision_pedidos/, ruta + ": las etapas del pedido no usan el módulo nuevo");
    }
  });
});
