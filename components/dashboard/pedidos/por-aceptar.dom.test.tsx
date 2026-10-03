import "@/lib/test-helpers/jsdom-setup";
// FASE 3B.7 — pruebas de INTERFAZ reales (jsdom + Testing Library) del panel "Por aceptar": lista (vacía, con datos,
// error, paginación) y detalle (pendiente de aceptación humana, ya procesado, acciones, concurrencia). La pantalla
// habla con un cliente simulado que registra cada llamada: lo que el usuario toca es lo que se le pide al backend
// (que es quien decide y vuelve a validar todo). Nunca debe sugerir que un pendiente ya es una venta.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { DetallePorAceptar, ListaPorAceptar, hrefConversacion, hrefDetalle, textoMensajeCliente, type ClientePorAceptar, type Notificar } from "@/components/dashboard/pedidos/PorAceptar";
import type { CatalogResult } from "@/lib/catalogo-client";
import type { AccionDecision, HistorialPorAceptar, MensajeAlCliente, PedidoPorAceptar, ProcesadoPorAceptar } from "@/lib/catalogo/pedidos/por-aceptar";

type Lista = { pedidos: PedidoPorAceptar[]; siguiente: string | null };
type Detalle = { pedido: PedidoPorAceptar | null; procesado: ProcesadoPorAceptar | null; historial: HistorialPorAceptar[] };
type Decision = { pedido: string; estado: string; repetido: boolean; mensaje_cliente?: MensajeAlCliente | null };

const t = (es: string) => es;
const ok = <T,>(data: T): CatalogResult<T> => ({ ok: true, data });
const fallo = <T,>(status: number, message: string, code = "ERROR"): CatalogResult<T> => ({ ok: false, error: { code, message, status } });

const PEDIDO = "DL-ORD-AAAAAA";
const DOC_COMPLETO = "1020345678";

function vista(over: Partial<PedidoPorAceptar> = {}): PedidoPorAceptar {
  return {
    pedido: PEDIDO,
    estado: "por_aceptar",
    creado: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
    actualizado: new Date().toISOString(),
    lineas: [{ referencia: "ASLC-001", nombre: "Licuadora", cantidad: 2, precio_unitario: 50_000, subtotal: 100_000 }],
    unidades: 2,
    total: 100_000,
    sin_precio: 0,
    envio: "Envío GRATIS",
    pago: "contra_entrega",
    entrega: "domicilio",
    cliente: { nombre: "Laura Gómez", telefono: "573001234567", telefono_parcial: "4567", ciudad: "Bogotá", departamento: "Cundinamarca", direccion: "Calle 10 # 20-30", barrio: "Chapinero", referencia_entrega: "Portería azul", oficina: null },
    documento: null,
    aviso_enviado: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    respuesta_cliente: null,
    asignada: "Responsable A",
    responsable: { principal: "Responsable A", respaldo: "Respaldo A", quien_acepta: "solo_responsable" },
    avisa_al_cliente: null,
    conversacion: { numero: "100000000000001", telefono: "573001234567", asignada: "Responsable A", ia_pausada: false, ia_pausada_hasta: null, estado: "open" },
    faltantes: [],
    reserva_minutos: null,
    vence: null,
    puede_decidir: true,
    acciones: ["aceptar", "rechazar", "cancelar"],
    version: { estado: "pending_acceptance" },
    ...over,
  };
}

interface Espia {
  client: ClientePorAceptar;
  listas: Array<{ limite?: number; cursor?: string | null } | undefined>;
  detalles: string[];
  decisiones: Array<{ pedido: string; accion: AccionDecision; motivo?: string }>;
}
function cliente(over: { lista?: (n: number, c?: { limite?: number; cursor?: string | null }) => Promise<CatalogResult<Lista>>; detalle?: (n: number) => Promise<CatalogResult<Detalle>>; decidir?: (n: number) => Promise<CatalogResult<Decision>> } = {}): Espia {
  const e: Espia = { listas: [], detalles: [], decisiones: [], client: null as unknown as ClientePorAceptar };
  e.client = {
    listPorAceptar: async (c) => {
      e.listas.push(c);
      return (over.lista ?? (async () => ok<Lista>({ pedidos: [], siguiente: null })))(e.listas.length, c);
    },
    getPorAceptar: async (pedido) => {
      e.detalles.push(pedido);
      return (over.detalle ?? (async () => ok<Detalle>({ pedido: vista(), procesado: null, historial: [] })))(e.detalles.length);
    },
    decidirPorAceptar: async (pedido, accion, motivo) => {
      e.decisiones.push({ pedido, accion, ...(motivo !== undefined ? { motivo } : {}) });
      return (over.decidir ?? (async () => ok<Decision>({ pedido, estado: "confirmed", repetido: false })))(e.decisiones.length);
    },
  };
  return e;
}
function toasts() {
  const lista: Array<{ mensaje: string; tipo: string }> = [];
  const toast: Notificar = (mensaje, tipo = "success") => void lista.push({ mensaje, tipo });
  return { lista, toast };
}
const texto = () => document.body.textContent ?? "";

afterEach(() => cleanup());

// ===========================================================================
describe("3B.7 · lista de Por aceptar (interfaz)", () => {
  it("cargando muestra un esqueleto y sin sesión (cliente nulo) no pide nada", async () => {
    const e = cliente();
    render(<ListaPorAceptar client={null} t={t} />);
    assert.ok(screen.getByRole("status", { name: /Cargando pedidos por aceptar/ }));
    assert.equal(e.listas.length, 0);
  });

  it("A) sin pedidos: estado vacío claro (no es un error) y sin botón de cargar más", async () => {
    const e = cliente();
    render(<ListaPorAceptar client={e.client} t={t} />);
    assert.ok(await screen.findByText("No hay pedidos por aceptar."));
    assert.equal(screen.queryByRole("alert"), null);
    assert.equal(screen.queryByRole("button", { name: /Cargar más/ }), null);
    assert.equal(screen.queryByRole("status"), null, "el esqueleto desaparece");
  });

  it("B) con pendientes: pedido, estado, cliente, producto, valor, ciudad, aviso, responsable y fecha; enlaza al detalle", async () => {
    const e = cliente({ lista: async () => ok<Lista>({ pedidos: [vista()], siguiente: null }) });
    render(<ListaPorAceptar client={e.client} t={t} />);
    const fila = await screen.findByRole("article", { name: /Pedido DL-ORD-AAAAAA por aceptar/ });
    const f = within(fila);
    assert.equal(f.getByRole("link", { name: PEDIDO }).getAttribute("href"), hrefDetalle(PEDIDO));
    assert.equal(f.getByRole("link", { name: /Revisar pedido/ }).getAttribute("href"), "/dashboard/pedidos/por-aceptar/DL-ORD-AAAAAA");
    assert.ok(f.getByText("Pendiente de aceptación"));
    assert.ok(f.getByText("Laura Gómez"));
    assert.ok(f.getByText("2 × Licuadora"));
    assert.ok(f.getByText(/100\.000/));
    assert.ok(f.getByText(/Contra entrega/));
    assert.ok(f.getByText("Bogotá, Cundinamarca"));
    assert.ok(f.getByText("Responsable A"));
    assert.ok(f.getByText(/Creado Hace 3 h/));
    assert.ok(f.getByText("Tú puedes aceptarlo o rechazarlo."));
    assert.ok(screen.getByText("Los más recientes primero."));
  });

  it("nunca sugiere que un pendiente ya es venta: ni 'confirmado' ni 'venta confirmada'; sin aviso dice 'Sin registrar'", async () => {
    const e = cliente({ lista: async () => ok<Lista>({ pedidos: [vista({ aviso_enviado: null })], siguiente: null }) });
    render(<ListaPorAceptar client={e.client} t={t} />);
    await screen.findByRole("article");
    assert.ok(!/confirmado|venta confirmada/i.test(within(screen.getByRole("article")).getByText("Pendiente de aceptación").parentElement?.textContent ?? ""));
    assert.ok(screen.getByText("Sin registrar"));
    assert.ok(!/(^|\s)(Confirmado|Aceptado)(\s|$)/.test(texto().replace(/NO son ventas[^.]*\./, "")), "ningún estado de venta en filas pendientes");
  });

  it("marca el cliente que respondió 'sí' (informativo) y los datos que faltan", async () => {
    const e = cliente({ lista: async () => ok<Lista>({ pedidos: [vista({ respuesta_cliente: new Date().toISOString(), faltantes: ["telefono", "barrio"] })], siguiente: null }) });
    render(<ListaPorAceptar client={e.client} t={t} />);
    await screen.findByRole("article");
    assert.ok(screen.getByText("El cliente respondió que sí"));
    assert.ok(screen.getByText("Faltan datos"));
  });

  it("quien no puede decidir lo ve, con el aviso de que decide la responsable (y sin ofrecer acciones)", async () => {
    const e = cliente({ lista: async () => ok<Lista>({ pedidos: [vista({ puede_decidir: false, acciones: [] })], siguiente: null }) });
    render(<ListaPorAceptar client={e.client} t={t} />);
    await screen.findByRole("article");
    assert.ok(screen.getByText("Solo la persona responsable puede decidir."));
    assert.equal(screen.queryByRole("button", { name: /Aceptar/ }), null, "la lista no acepta nada: eso se hace en el detalle");
  });

  it("sin asignada, el responsable es la persona configurada; sin ninguna, 'No registrado' (nunca un valor inventado)", async () => {
    const e = cliente({ lista: async () => ok<Lista>({ pedidos: [vista({ asignada: null }), vista({ pedido: "DL-ORD-BBBBBB", asignada: null, responsable: null })], siguiente: null }) });
    render(<ListaPorAceptar client={e.client} t={t} />);
    const filas = await screen.findAllByRole("article");
    assert.ok(within(filas[0]).getByText("Responsable A"));
    const lineaResp = within(filas[1]).getByText("Responsable").parentElement as HTMLElement;
    assert.ok(within(lineaResp).getByText("No registrado"));
  });

  it("error de carga: aviso claro con 'Reintentar', que vuelve a pedir y muestra los datos", async () => {
    const e = cliente({ lista: async (n) => (n === 1 ? fallo<Lista>(500, "No se pudo completar la operación.") : ok<Lista>({ pedidos: [vista()], siguiente: null })) });
    render(<ListaPorAceptar client={e.client} t={t} />);
    const alerta = await screen.findByRole("alert");
    assert.match(alerta.textContent ?? "", /No se pudo completar la operación/);
    assert.equal(screen.queryByText("No hay pedidos por aceptar."), null, "un error no se disfraza de lista vacía");
    fireEvent.click(within(alerta).getByRole("button", { name: "Reintentar" }));
    await screen.findByRole("article");
    assert.equal(screen.queryByRole("alert"), null);
    assert.equal(e.listas.length, 2);
  });

  it("'Actualizar' vuelve a leer del backend", async () => {
    const e = cliente({ lista: async (n) => ok<Lista>({ pedidos: n === 1 ? [] : [vista()], siguiente: null }) });
    render(<ListaPorAceptar client={e.client} t={t} />);
    await screen.findByText("No hay pedidos por aceptar.");
    fireEvent.click(screen.getByRole("button", { name: /Actualizar/ }));
    await screen.findByRole("article");
    assert.equal(e.listas.length, 2);
  });

  it("paginación: 'Cargar más' pide la página siguiente con el cursor, agrega sin repetir y desaparece al final", async () => {
    const e = cliente({
      lista: async (_n, c) =>
        !c?.cursor
          ? ok<Lista>({ pedidos: [vista({ pedido: "DL-ORD-AAAAAA" }), vista({ pedido: "DL-ORD-BBBBBB" })], siguiente: "cursor-1" })
          : ok<Lista>({ pedidos: [vista({ pedido: "DL-ORD-BBBBBB" }), vista({ pedido: "DL-ORD-CCCCCC" })], siguiente: null }),
    });
    render(<ListaPorAceptar client={e.client} t={t} />);
    await screen.findAllByRole("article");
    assert.equal(screen.getAllByRole("article").length, 2);
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await waitFor(() => assert.equal(screen.getAllByRole("article").length, 3));
    assert.deepEqual(e.listas[1], { cursor: "cursor-1" });
    assert.equal(screen.getAllByRole("link", { name: "DL-ORD-BBBBBB" }).length, 1, "un pedido no aparece dos veces");
    assert.equal(screen.queryByRole("button", { name: /Cargar más/ }), null);
  });

  it("si falla 'Cargar más': se avisa, se conservan las filas ya cargadas y se puede reintentar", async () => {
    let intentos = 0;
    const e = cliente({
      lista: async (_n, c) => {
        if (!c?.cursor) return ok<Lista>({ pedidos: [vista()], siguiente: "cursor-1" });
        intentos++;
        return intentos === 1 ? fallo<Lista>(503, "Los pedidos no están activados.") : ok<Lista>({ pedidos: [vista({ pedido: "DL-ORD-CCCCCC" })], siguiente: null });
      },
    });
    render(<ListaPorAceptar client={e.client} t={t} />);
    await screen.findByRole("article");
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    const alerta = await screen.findByRole("alert");
    assert.match(alerta.textContent ?? "", /no están activados/);
    assert.equal(screen.getAllByRole("article").length, 1);
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await waitFor(() => assert.equal(screen.getAllByRole("article").length, 2));
  });

  it("no pinta el documento: ni completo ni enmascarado (en la lista no hace falta)", async () => {
    const e = cliente({ lista: async () => ok<Lista>({ pedidos: [vista({ documento: { tipo: "no_especificado", enmascarado: "•••• 5678" } })], siguiente: null }) });
    render(<ListaPorAceptar client={e.client} t={t} />);
    await screen.findByRole("article");
    assert.ok(!texto().includes("5678") && !texto().includes(DOC_COMPLETO));
  });
});

// ===========================================================================
describe("3B.7 · detalle de Por aceptar (interfaz)", () => {
  const montar = (e: Espia, toast: Notificar = () => {}) => render(<DetallePorAceptar client={e.client} pedido={PEDIDO} t={t} toast={toast} />);

  it("C) pendiente: dice 'Pendiente de aceptación humana' y que NO es una venta; separa producto, cliente/envío y seguimiento", async () => {
    const e = cliente();
    montar(e);
    assert.ok(await screen.findByText("Pendiente de aceptación humana"));
    assert.match(texto(), /NO está confirmado: no es una venta hasta que una persona autorizada lo acepte/);
    assert.match(texto(), /Mientras espera, no hay stock apartado/);
    for (const titulo of ["Producto y valor", "Cliente y envío", "Seguimiento", "Decisión"]) assert.ok(screen.getByRole("heading", { name: titulo }), titulo);
    assert.ok(!/venta confirmada|Aceptado:/.test(texto()), "no sugiere que ya fue aceptado");
    assert.deepEqual(e.detalles, [PEDIDO]);
  });

  it("muestra producto, referencia, cantidad, valor y la nota de que el pago es contra entrega (sin pago registrado)", async () => {
    montar(cliente());
    await screen.findByText("Pendiente de aceptación humana");
    assert.ok(screen.getByText("Licuadora"));
    assert.ok(screen.getByText("ASLC-001"));
    assert.ok(screen.getByText(/2 × .*50\.000/));
    assert.ok(screen.getAllByText(/100\.000/).length >= 1);
    assert.ok(screen.getByText(/Contra entrega: se paga al recibir; no hay pago registrado/));
    assert.ok(screen.getByText("Envío GRATIS"));
  });

  it("muestra los datos del cliente y del envío: nombre, teléfono, ciudad, departamento, dirección, barrio, referencia, modalidad", async () => {
    montar(cliente());
    await screen.findByText("Pendiente de aceptación humana");
    for (const dato of ["Laura Gómez", "573001234567", "Bogotá", "Cundinamarca", "Calle 10 # 20-30", "Chapinero", "Portería azul", "Domicilio"]) assert.ok(screen.getByText(dato), dato);
  });

  it("con oficina: muestra la oficina de la transportadora y el documento SOLO enmascarado (nunca el número)", async () => {
    const e = cliente({
      detalle: async () =>
        ok<Detalle>({
          pedido: vista({ entrega: "oficina_transportadora", cliente: { ...vista().cliente, direccion: null, barrio: null, oficina: "Oficina Centro" }, documento: { tipo: "no_especificado", enmascarado: "•••• 5678" } }),
          procesado: null,
          historial: [],
        }),
    });
    montar(e);
    await screen.findByText("Pendiente de aceptación humana");
    assert.ok(screen.getByText("Oficina Centro"));
    assert.ok(screen.getByText("no_especificado •••• 5678"));
    assert.ok(!texto().includes(DOC_COMPLETO) && !texto().includes("1.020.345.678"));
    assert.ok(!document.body.innerHTML.includes(DOC_COMPLETO), "ni en el HTML (atributos, títulos)");
  });

  it("seguimiento: aviso enviado, respuesta del cliente, responsable, respaldo, quién puede aceptar y la conversación", async () => {
    const e = cliente({ detalle: async () => ok<Detalle>({ pedido: vista({ respuesta_cliente: new Date().toISOString() }), procesado: null, historial: [] }) });
    montar(e);
    await screen.findByText("Pendiente de aceptación humana");
    const seg = screen.getByRole("heading", { name: "Seguimiento" }).closest("section") as HTMLElement;
    const s = within(seg);
    assert.ok(s.getByText("Aviso enviado"));
    assert.equal(s.queryByText("Todavía no"), null, "el cliente sí respondió");
    assert.ok(s.getByText("Responsable A", { selector: "dd" }));
    assert.ok(s.getByText("Respaldo A"));
    assert.ok(s.getByText("Solo la responsable y su respaldo"));
    assert.ok(s.getByText("Asignada a Responsable A · IA activa · Abierta en el Inbox"));
    assert.match(seg.textContent ?? "", /no aceptan el pedido: solo lo hace una persona desde aquí/);
  });

  it("conversación: enlace al Inbox que ya existe (phone_number_id + telefono_cliente), sin documento ni otros datos en la URL", async () => {
    const e = cliente({ detalle: async () => ok<Detalle>({ pedido: vista({ documento: { tipo: "no_especificado", enmascarado: "•••• 5678" } }), procesado: null, historial: [] }) });
    montar(e);
    const enlace = await screen.findByRole("link", { name: /Abrir la conversación en el Inbox/ });
    const url = new URL(enlace.getAttribute("href") as string, "http://x");
    assert.equal(url.pathname, "/dashboard/mensajes");
    assert.deepEqual([...url.searchParams.keys()].sort(), ["phone_number_id", "telefono_cliente"]);
    assert.equal(url.searchParams.get("phone_number_id"), "100000000000001");
    assert.equal(url.searchParams.get("telefono_cliente"), "573001234567");
    assert.ok(!(enlace.getAttribute("href") ?? "").includes("5678") || (enlace.getAttribute("href") ?? "").includes("573001234567"));
  });

  it("hrefConversacion: sin teléfono (rol sin permiso) o sin conversación no hay enlace", () => {
    assert.equal(hrefConversacion(null), null);
    assert.equal(hrefConversacion({ ...vista().conversacion!, telefono: null }), null);
    assert.match(hrefConversacion(vista().conversacion)!, /^\/dashboard\/mensajes\?phone_number_id=100000000000001&telefono_cliente=573001234567$/);
  });

  it("IA pausada y conversación pendiente se dicen con claridad", async () => {
    const hasta = new Date(Date.now() + 3_600_000).toISOString();
    const e = cliente({ detalle: async () => ok<Detalle>({ pedido: vista({ conversacion: { ...vista().conversacion!, ia_pausada: true, ia_pausada_hasta: hasta, estado: "pending", asignada: null } }), procesado: null, historial: [] }) });
    montar(e);
    await screen.findByText("Pendiente de aceptación humana");
    assert.match(texto(), /Sin asignar · IA pausada hasta .* · Pendiente en el Inbox/);
  });

  it("datos incompletos: aviso rojo con lo que falta y 'No registrado' en cada dato vacío; igual se puede decidir", async () => {
    const e = cliente({ detalle: async () => ok<Detalle>({ pedido: vista({ faltantes: ["telefono", "barrio"], cliente: { ...vista().cliente, telefono: null, telefono_parcial: null, barrio: null, referencia_entrega: null } }), procesado: null, historial: [] }) });
    montar(e);
    const alerta = await screen.findByRole("alert");
    assert.match(alerta.textContent ?? "", /Faltan datos del cliente: teléfono, barrio\. Confírmalos con el cliente antes de aceptar\./);
    assert.ok(screen.getAllByText("No registrado").length >= 3);
    assert.ok(screen.getByRole("button", { name: /Aceptar pedido/ }));
  });

  it("reserva y vencimiento: dice cuánto stock se aparta mientras espera y cuándo vence", async () => {
    const e = cliente({ detalle: async () => ok<Detalle>({ pedido: vista({ reserva_minutos: 45, vence: new Date(Date.now() + 86_400_000).toISOString() }), procesado: null, historial: [] }) });
    montar(e);
    await screen.findByText("Pendiente de aceptación humana");
    assert.match(texto(), /el stock queda apartado 45 min/);
    assert.match(texto(), /Vence /);
  });

  it("G) aceptar: pide confirmación (no acepta con un clic), llama UNA vez con 'aceptar', avisa y recarga mostrando el estado nuevo", async () => {
    const { lista, toast } = toasts();
    const e = cliente({
      detalle: async (n) => ok<Detalle>(n === 1 ? { pedido: vista(), procesado: null, historial: [] } : { pedido: null, procesado: { pedido: PEDIDO, estado: "confirmed", fecha: new Date().toISOString(), por: "Responsable A", motivo: null }, historial: [] }),
    });
    montar(e, toast);
    fireEvent.click(await screen.findByRole("button", { name: "Aceptar pedido" }));
    assert.equal(e.decisiones.length, 0, "un clic no acepta");
    assert.match(texto(), /¿Aceptar el pedido DL-ORD-AAAAAA\? Pasa a ser una venta confirmada/);
    fireEvent.click(screen.getByRole("button", { name: "Sí, aceptar pedido" }));
    await screen.findByText("Este pedido ya fue procesado");
    assert.deepEqual(e.decisiones, [{ pedido: PEDIDO, accion: "aceptar" }]);
    assert.equal(e.detalles.length, 2, "recarga el estado real");
    assert.deepEqual(lista, [{ mensaje: `✓ Pedido ${PEDIDO} aceptado: ahora es una venta confirmada.`, tipo: "success" }]);
    assert.ok(screen.getByText("Aceptado: ya es una venta confirmada"));
    assert.ok(screen.getByRole("link", { name: "Gestiónalo en Pedidos" }));
    assert.equal(screen.queryByRole("button", { name: /Aceptar|Rechazar|Cancelar/ }), null, "ya no hay acciones");
  });

  it("'Volver' en la confirmación no llama a nada", async () => {
    const e = cliente();
    montar(e);
    fireEvent.click(await screen.findByRole("button", { name: "Aceptar pedido" }));
    fireEvent.click(screen.getByRole("button", { name: "Volver" }));
    assert.ok(screen.getByRole("button", { name: "Aceptar pedido" }));
    assert.equal(e.decisiones.length, 0);
  });

  it("doble clic en 'Sí, aceptar': UNA sola petición (el segundo clic no repite)", async () => {
    let soltar: (r: CatalogResult<Decision>) => void = () => {};
    const e = cliente({ decidir: () => new Promise((res) => (soltar = res)) });
    montar(e);
    fireEvent.click(await screen.findByRole("button", { name: "Aceptar pedido" }));
    const si = screen.getByRole("button", { name: "Sí, aceptar pedido" });
    fireEvent.click(si);
    fireEvent.click(si);
    fireEvent.click(si);
    assert.equal(e.decisiones.length, 1);
    soltar(ok<Decision>({ pedido: PEDIDO, estado: "confirmed", repetido: false }));
    await waitFor(() => assert.equal(e.detalles.length, 2));
    assert.equal(e.decisiones.length, 1);
  });

  it("J) rechazar: el motivo es obligatorio (mínimo 3 letras); se envía recortado y se avisa", async () => {
    const { lista, toast } = toasts();
    const e = cliente({ decidir: async () => ok<Decision>({ pedido: PEDIDO, estado: "rejected", repetido: false }) });
    montar(e, toast);
    fireEvent.click(await screen.findByRole("button", { name: "Rechazar" }));
    const confirmar = screen.getByRole("button", { name: "Confirmar rechazo" }) as HTMLButtonElement;
    assert.equal(confirmar.disabled, true, "sin motivo no se puede");
    fireEvent.change(screen.getByLabelText(/Motivo del rechazo \(obligatorio\)/), { target: { value: "  ab " } });
    assert.equal(confirmar.disabled, true, "menos de 3 letras");
    fireEvent.change(screen.getByLabelText(/Motivo del rechazo/), { target: { value: "  Producto no disponible  " } });
    assert.equal(confirmar.disabled, false);
    fireEvent.click(confirmar);
    await waitFor(() => assert.equal(e.decisiones.length, 1));
    assert.deepEqual(e.decisiones[0], { pedido: PEDIDO, accion: "rechazar", motivo: "Producto no disponible" });
    await waitFor(() => assert.equal(lista.length, 1));
    assert.equal(lista[0].mensaje, `Pedido ${PEDIDO} rechazado.`);
    assert.match(texto(), /Rechazar y cancelar no crean venta ni apartan stock/);
  });

  it("K) cancelar: igual que rechazar, con su propio texto", async () => {
    const { lista, toast } = toasts();
    const e = cliente({ decidir: async () => ok<Decision>({ pedido: PEDIDO, estado: "cancelled", repetido: false }) });
    montar(e, toast);
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar pedido" }));
    fireEvent.change(screen.getByLabelText(/Motivo de la cancelación \(obligatorio\)/), { target: { value: "El cliente ya no lo quiere" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    await waitFor(() => assert.equal(e.decisiones.length, 1));
    assert.deepEqual(e.decisiones[0], { pedido: PEDIDO, accion: "cancelar", motivo: "El cliente ya no lo quiere" });
    await waitFor(() => assert.equal(lista.length, 1));
    assert.equal(lista[0].mensaje, `Pedido ${PEDIDO} cancelado.`);
  });

  it("D/E) sin permiso para decidir: no hay botones de aceptar, rechazar ni cancelar y se dice quién sí puede", async () => {
    const e = cliente({ detalle: async () => ok<Detalle>({ pedido: vista({ puede_decidir: false, acciones: [] }), procesado: null, historial: [] }) });
    montar(e);
    await screen.findByText("Pendiente de aceptación humana");
    assert.equal(screen.queryByRole("button", { name: /Aceptar pedido|Rechazar|Cancelar pedido/ }), null);
    assert.match(texto(), /Solo Responsable A \(o quien el negocio haya autorizado\) puede aceptar o rechazar este pedido/);
  });

  it("concurrencia: otra persona decidió primero (409) => se avisa con el mensaje del backend y se recarga el estado ACTUAL, sin acciones", async () => {
    const { lista, toast } = toasts();
    const e = cliente({
      detalle: async (n) => ok<Detalle>(n === 1 ? { pedido: vista(), procesado: null, historial: [] } : { pedido: null, procesado: { pedido: PEDIDO, estado: "rejected", fecha: new Date().toISOString(), por: "Respaldo A", motivo: "Sin stock real" }, historial: [] }),
      decidir: async () => fallo<Decision>(409, "El pedido cambió mientras lo revisabas. Actualiza y vuelve a intentarlo.", "CONFLICT"),
    });
    montar(e, toast);
    fireEvent.click(await screen.findByRole("button", { name: "Aceptar pedido" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, aceptar pedido" }));
    await screen.findByText("Este pedido ya fue procesado");
    assert.deepEqual(lista, [{ mensaje: "El pedido cambió mientras lo revisabas. Actualiza y vuelve a intentarlo.", tipo: "error" }]);
    assert.ok(screen.getByText("Rechazado: no es una venta"));
    assert.match(texto(), /Por Respaldo A/);
    assert.match(texto(), /Motivo: Sin stock real/);
    assert.equal(screen.queryByRole("link", { name: "Gestiónalo en Pedidos" }), null, "un rechazado no es una venta");
    assert.equal(screen.queryByRole("button", { name: /Aceptar pedido/ }), null);
  });

  it("sin stock al aceptar (409): el aviso lo dice y el pedido SIGUE pendiente en pantalla", async () => {
    const { lista, toast } = toasts();
    const e = cliente({ decidir: async () => fallo<Decision>(409, "Ya no hay unidades suficientes para aceptar el pedido.", "OUT_OF_STOCK") });
    montar(e, toast);
    fireEvent.click(await screen.findByRole("button", { name: "Aceptar pedido" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, aceptar pedido" }));
    await waitFor(() => assert.equal(lista.length, 1));
    assert.equal(lista[0].tipo, "error");
    assert.match(lista[0].mensaje, /Ya no hay unidades suficientes/);
    await screen.findByText("Pendiente de aceptación humana");
    assert.ok(screen.getByRole("button", { name: "Aceptar pedido" }), "puede reintentar o rechazar");
  });

  it("403 al decidir: se avisa y NO se recarga ni se cambia nada en pantalla", async () => {
    const { lista, toast } = toasts();
    const e = cliente({ decidir: async () => fallo<Decision>(403, "No tienes permiso para aceptar o rechazar este pedido.", "FORBIDDEN") });
    montar(e, toast);
    fireEvent.click(await screen.findByRole("button", { name: "Aceptar pedido" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, aceptar pedido" }));
    await waitFor(() => assert.equal(lista.length, 1));
    assert.equal(lista[0].tipo, "error");
    assert.equal(e.detalles.length, 1);
  });

  it("H) la acción ya estaba aplicada (repetido): aviso informativo, nunca 'aceptado por ti'", async () => {
    const { lista, toast } = toasts();
    const e = cliente({ decidir: async () => ok<Decision>({ pedido: PEDIDO, estado: "confirmed", repetido: true }) });
    montar(e, toast);
    fireEvent.click(await screen.findByRole("button", { name: "Aceptar pedido" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, aceptar pedido" }));
    await waitFor(() => assert.equal(lista.length, 1));
    assert.equal(lista[0].tipo, "success");
    assert.match(lista[0].mensaje, /ya estaba procesado: no se repitió nada/);
    assert.ok(!/aceptado/.test(lista[0].mensaje));
  });

  it("pedido ya procesado: rechazado/vencido/cancelado explican qué pasó, quién y cuándo; vencido dice 'Por el sistema'; nada de venta", async () => {
    const casos: Array<[ProcesadoPorAceptar["estado"], string, string | null]> = [
      ["rejected", "Rechazado: no es una venta", "Responsable A"],
      ["cancelled", "Cancelado: no es una venta", "Respaldo A"],
      ["expired", "Vencido: nadie lo aceptó a tiempo, no es una venta", null],
    ];
    for (const [estado, frase, por] of casos) {
      const e = cliente({ detalle: async () => ok<Detalle>({ pedido: null, procesado: { pedido: PEDIDO, estado, fecha: new Date().toISOString(), por, motivo: null }, historial: [] }) });
      montar(e);
      await screen.findByText("Este pedido ya fue procesado");
      assert.ok(screen.getByText(frase), frase);
      assert.match(texto(), por ? new RegExp(`Por ${por}`) : /Por el sistema/);
      assert.equal(screen.queryByRole("link", { name: "Gestiónalo en Pedidos" }), null);
      assert.ok(!/Laura|Calle 10|573001234567/.test(texto()), "un procesado no trae datos del cliente");
      cleanup();
    }
  });

  it("pedido que no existe en este negocio: 404 claro y sin 'Reintentar'; un error de servidor sí ofrece reintentar", async () => {
    const e404 = cliente({ detalle: async () => fallo<Detalle>(404, "No encontramos ese pedido.", "NOT_FOUND") });
    montar(e404);
    const alerta = await screen.findByRole("alert");
    assert.match(alerta.textContent ?? "", /No encontramos ese pedido entre los pendientes de tu negocio/);
    assert.equal(within(alerta).queryByRole("button", { name: "Reintentar" }), null);
    assert.ok(screen.getByRole("link", { name: /Volver a Por aceptar/ }));
    cleanup();

    const e500 = cliente({ detalle: async (n) => (n === 1 ? fallo<Detalle>(500, "No se pudo completar la operación.") : ok<Detalle>({ pedido: vista(), procesado: null, historial: [] })) });
    montar(e500);
    const alerta2 = await screen.findByRole("alert");
    fireEvent.click(within(alerta2).getByRole("button", { name: "Reintentar" }));
    await screen.findByText("Pendiente de aceptación humana");
  });

  it("historial: quién y cuándo hizo cada cambio, sin ids internos", async () => {
    const e = cliente({
      detalle: async () =>
        ok<Detalle>({
          pedido: vista(),
          procesado: null,
          historial: [{ tipo: "order.status_changed", desde: "pending_confirmation", hacia: "pending_acceptance", actor: "agent", miembro: null, motivo: null, fecha: new Date().toISOString() }],
        }),
    });
    montar(e);
    await screen.findByText("Pendiente de aceptación humana");
    const hist = screen.getByRole("region", { name: "Historial" });
    assert.match(hist.textContent ?? "", /Cambio de estado · pending_confirmation → pending_acceptance · agent/);
  });

  it("un número de pedido mal formado en la URL no se pide al servidor: aviso claro y sin llamadas", async () => {
    for (const malo of ["", "x", "DL-ORD-12", "DL-ORD-AAAAAA%00", "<script>alert(1)</script>", "../../etc/passwd"]) {
      const e = cliente();
      render(<DetallePorAceptar client={e.client} pedido={malo} t={t} toast={() => {}} />);
      const alerta = await screen.findByRole("alert");
      assert.match(alerta.textContent ?? "", /Ese número de pedido no es válido/);
      assert.ok(screen.getByRole("heading", { name: "Pedido no válido" }), malo);
      assert.equal(e.detalles.length, 0, `no pidió nada: ${malo}`);
      assert.equal(e.decisiones.length, 0);
      assert.equal(screen.queryByRole("button", { name: /Aceptar|Rechazar|Cancelar pedido/ }), null);
      assert.ok(!document.body.innerHTML.includes("<script>alert"), "nada de la URL se inyecta como HTML");
      cleanup();
    }
  });

  it("volver a la lista: enlace a /dashboard/pedidos/por-aceptar", async () => {
    montar(cliente());
    const volver = await screen.findByRole("link", { name: /Volver a Por aceptar/ });
    assert.equal(volver.getAttribute("href"), "/dashboard/pedidos/por-aceptar");
  });
});

// ===========================================================================
describe("3B.8 · avisos al cliente en el panel (qué se le dice a la persona, antes y después de decidir)", () => {
  const montar = (e: Espia, toast: Notificar = () => {}) => render(<DetallePorAceptar client={e.client} pedido={PEDIDO} t={t} toast={toast} />);
  const AVISOS = { aceptar: true, rechazar: true, cancelar: true, motivo_al_cliente: { rechazar: true, cancelar: true } };
  const conAvisos = (avisos: PedidoPorAceptar["avisa_al_cliente"]) => cliente({ detalle: async () => ok<Detalle>({ pedido: vista({ avisa_al_cliente: avisos }), procesado: null, historial: [] }) });
  const aceptarYConfirmar = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Aceptar pedido" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, aceptar pedido" }));
  };

  it("antes de aceptar: avisa que se le enviará al cliente el mensaje CONFIGURADO por el negocio (sin mostrar el texto); sin mensaje configurado, no dice nada", async () => {
    montar(conAvisos(AVISOS));
    fireEvent.click(await screen.findByRole("button", { name: "Aceptar pedido" }));
    assert.match(texto(), /Al aceptar, se le enviará al cliente el mensaje de aceptación que configuró el negocio/);
    cleanup();
    montar(conAvisos(null));
    fireEvent.click(await screen.findByRole("button", { name: "Aceptar pedido" }));
    assert.ok(!/Al aceptar, se le enviará/.test(texto()));
  });

  it("al rechazar o cancelar: si la plantilla incluye el motivo, avisa en ROJO que lo leerá el cliente; si no lo incluye (o no hay mensaje), no lo dice", async () => {
    for (const [boton, motivoCliente] of [["Rechazar", "rechazar"], ["Cancelar pedido", "cancelar"]] as const) {
      montar(conAvisos(AVISOS));
      fireEvent.click(await screen.findByRole("button", { name: boton }));
      const nota = screen.getByRole("note");
      assert.match(nota.textContent ?? "", /El motivo que escribas lo leerá el cliente/);
      assert.match(texto(), /Se le enviará al cliente el mensaje que configuró el negocio/);
      assert.ok(motivoCliente);
      cleanup();
    }
    montar(conAvisos({ aceptar: false, rechazar: true, cancelar: false, motivo_al_cliente: { rechazar: false, cancelar: false } }));
    fireEvent.click(await screen.findByRole("button", { name: "Rechazar" }));
    assert.equal(screen.queryByRole("note"), null, "la plantilla no usa el motivo: es solo para el equipo");
    assert.match(texto(), /Se le enviará al cliente el mensaje que configuró el negocio/);
    cleanup();
    montar(conAvisos(null));
    fireEvent.click(await screen.findByRole("button", { name: "Rechazar" }));
    assert.equal(screen.queryByRole("note"), null);
    assert.ok(!/Se le enviará al cliente/.test(texto()));
  });

  it("la nota del pie solo dice 'No se le escribe nada al cliente desde aquí' cuando el negocio NO configuró ningún mensaje", async () => {
    montar(conAvisos(null));
    await screen.findByRole("heading", { name: "Decisión" });
    assert.match(texto(), /No se le escribe nada al cliente desde aquí/);
    cleanup();
    montar(conAvisos(AVISOS));
    await screen.findByRole("heading", { name: "Decisión" });
    assert.ok(!/No se le escribe nada al cliente desde aquí/.test(texto()));
    assert.match(texto(), /Rechazar y cancelar no crean venta ni apartan stock\./);
  });

  it("tras decidir: si el mensaje salió, la persona lo sabe; si no salió por la ventana de 24 h, el motivo sensible o un fallo, también (nunca dice que llegó si no se sabe)", async () => {
    const casos: Array<[MensajeAlCliente, RegExp | null, "success" | "error" | null]> = [
      [{ estado: "enviada", motivo: null, repetida: false }, /Se le envió al cliente el mensaje del negocio/, "success"],
      [{ estado: "ventana_vencida", motivo: "ventana_vencida", repetida: false }, /ventana de 24 h de WhatsApp está cerrada/, "error"],
      [{ estado: "no_aplica", motivo: "motivo_sensible", repetida: false }, /número largo/, "error"],
      [{ estado: "no_aplica", motivo: "sin_motivo", repetida: false }, /faltaba el motivo/, "error"],
      [{ estado: "fallida", motivo: null, repetida: false }, /No se pudo confirmar el envío/, "error"],
      [{ estado: "desconocido", motivo: null, repetida: false }, /No se pudo confirmar el envío/, "error"],
      [{ estado: "no_disponible", motivo: null, repetida: false }, /No se pudo confirmar el envío/, "error"],
      [{ estado: "no_aplica", motivo: "sin_texto", repetida: false }, null, null],
      [{ estado: "no_aplica", motivo: "sin_configuracion", repetida: false }, null, null],
      [{ estado: "desactivada", motivo: null, repetida: false }, null, null],
      [{ estado: "enviada", motivo: null, repetida: true }, null, null],
    ];
    for (const [mensaje, patron, tipo] of casos) {
      const { lista, toast } = toasts();
      const e = cliente({ decidir: async () => ok<Decision>({ pedido: PEDIDO, estado: "confirmed", repetido: false, mensaje_cliente: mensaje }) });
      montar(e, toast);
      await aceptarYConfirmar();
      await waitFor(() => assert.ok(lista.length >= 1), { timeout: 2000 });
      const extra = lista.slice(1);
      if (patron === null) assert.equal(extra.length, 0, JSON.stringify(mensaje));
      else {
        assert.equal(extra.length, 1, JSON.stringify(mensaje));
        assert.match(extra[0].mensaje, patron);
        assert.equal(extra[0].tipo, tipo);
      }
      cleanup();
    }
  });

  it("una decisión REPETIDA no vuelve a hablar del mensaje al cliente (no se repitió nada)", async () => {
    const { lista, toast } = toasts();
    const e = cliente({ decidir: async () => ok<Decision>({ pedido: PEDIDO, estado: "confirmed", repetido: true, mensaje_cliente: { estado: "enviada", motivo: null, repetida: false } }) });
    montar(e, toast);
    await aceptarYConfirmar();
    await waitFor(() => assert.equal(lista.length, 1));
    assert.match(lista[0].mensaje, /ya estaba procesado/);
  });

  it("textoMensajeCliente: sin información no dice nada; nunca afirma una entrega que no sabe", () => {
    assert.equal(textoMensajeCliente(null, t), null);
    assert.equal(textoMensajeCliente(undefined, t), null);
    assert.equal(textoMensajeCliente({ estado: "enviando", motivo: null, repetida: false }, t)?.tipo, "error", "'enviando' no es 'enviado'");
    assert.ok(!/se envió al cliente/i.test(textoMensajeCliente({ estado: "fallida", motivo: null, repetida: false }, t)?.texto ?? ""));
  });
});
