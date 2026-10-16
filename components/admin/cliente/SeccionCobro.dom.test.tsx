import "@/lib/test-helpers/jsdom-setup";
// Panel de Operaciones — la tarjeta «Cobro manual» de un cliente (jsdom + Testing Library). El servidor se simula con un fetch en memoria: se afirma lo que la persona VE y lo que se manda.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SeccionCobro } from "./SeccionCobro";

type Llamada = { url: string; metodo: string; auth: string | null; cuerpo: Record<string, unknown> | null };
let llamadas: Llamada[];
let respuestaGet: { status: number; json: unknown };
let respuestaPost: { status: number; json: unknown };
const fetchOriginal = globalThis.fetch;
const confirmOriginal = (globalThis as { confirm?: unknown }).confirm;

const CICLO_ENVIADO = { fechaCobro: "2026-10-30", montoCop: 39990, estado: "enviado", intentos: 1, suspendidoAt: "2026-10-30T14:05:00.000Z", recordatorioEnviadoAt: "2026-10-30T14:05:01.000Z", ultimoError: null, pagadoAt: null, registradoPor: null, nota: null };
const CICLO_PAGADO = { fechaCobro: "2026-09-30", montoCop: 39990, estado: "pagado", intentos: 0, suspendidoAt: null, recordatorioEnviadoAt: null, ultimoError: null, pagadoAt: "2026-09-29T15:00:00.000Z", registradoPor: "duvan@dulabs.co", nota: "transferencia" };
const suscripcion = (extra: Record<string, unknown> = {}) => ({
  plan: "start", precioCop: 39990, fechaProximoCobro: "2026-10-30", diaCobro: 30, telefonoCobro: "573001234567", nombreCobro: "AMORE", suspendidaPorPagoAt: null, ...extra,
});
const datos = (extra: Record<string, unknown> = {}, sus: Record<string, unknown> = {}) => ({
  modo: "activo", aplica: true, motivoNoAplica: null, suscripcion: suscripcion(sus), ciclos: [], ...extra,
});

function montar(props: { hoy?: string; onCambio?: () => void } = {}) {
  return render(<SeccionCobro idTenant="T-AMORE" accessToken="token-de-prueba" hoy={props.hoy ?? "2026-10-16"} onCambio={props.onCambio} />);
}
const botones = () => screen.getAllByRole("button").map((b) => b.textContent);

beforeEach(() => {
  llamadas = [];
  respuestaGet = { status: 200, json: datos() };
  respuestaPost = { status: 200, json: { success: true, proximoCobro: "2026-11-30", reactivado: true } };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    llamadas.push({ url: String(input), metodo, auth: new Headers(init?.headers).get("authorization"), cuerpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
    const r = metodo === "GET" ? respuestaGet : respuestaPost;
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  (globalThis as { confirm?: unknown }).confirm = () => true;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
  (globalThis as { confirm?: unknown }).confirm = confirmOriginal;
});

describe("SeccionCobro — qué se ve", () => {
  it("pide el cobro del cliente con la sesión del operador y, mientras llega, dice «Cargando…»", async () => {
    montar();
    assert.ok(screen.getByText("Cargando…"));
    await screen.findByText("Al día hasta el 30/10/2026");
    assert.deepEqual([llamadas[0]!.url, llamadas[0]!.metodo, llamadas[0]!.auth], ["/api/dashboard/admin/clientes/T-AMORE/cobro", "GET", "Bearer token-de-prueba"]);
  });

  it("un cliente suspendido por falta de pago: lo dice en rojo, con sus datos de cobro, el historial y el botón para levantar la suspensión", async () => {
    respuestaGet = { status: 200, json: datos({ ciclos: [CICLO_ENVIADO, CICLO_PAGADO] }, { suspendidaPorPagoAt: "2026-10-30T14:05:00.000Z" }) };
    montar({ hoy: "2026-10-31" });
    await screen.findByText("Bot suspendido por falta de pago");
    assert.ok(screen.getByText("Hola, AMORE"));
    assert.ok(screen.getByText("+57 300 123 4567"));
    assert.ok(screen.getByText("$39.990"));
    assert.ok(screen.getByText("Día 30 de cada mes"));
    assert.ok(screen.getByText("Recordatorio enviado"));
    assert.ok(screen.getByText("Pagado"));
    assert.ok(screen.getByText(/duvan@dulabs\.co · transferencia/));
    assert.deepEqual(botones(), ["Registrar pago", "Editar datos de cobro", "Levantar suspensión"]);
  });

  it("un cliente al día: pastilla verde con su fecha y SIN botón de levantar suspensión", async () => {
    montar();
    await screen.findByText("Al día hasta el 30/10/2026");
    assert.deepEqual(botones(), ["Registrar pago", "Editar datos de cobro"]);
  });

  it("un cobro que ya llegó y todavía no se suspendió (el cron no ha corrido o está en simulación) se ve como «Venció el…»", async () => {
    respuestaGet = { status: 200, json: datos({}, { fechaProximoCobro: "2026-10-11" }) };
    montar();
    await screen.findByText("Venció el 11/10/2026");
  });

  it("avisa cuando los recordatorios están en SIMULACIÓN (no se manda nada ni se suspende a nadie) y no lo dice cuando están activos", async () => {
    respuestaGet = { status: 200, json: datos({ modo: "simulacion" }) };
    montar();
    await screen.findByText(/están en SIMULACIÓN/);
    cleanup();
    respuestaGet = { status: 200, json: datos({ modo: "activo" }) };
    montar();
    await screen.findByText("Al día hasta el 30/10/2026");
    assert.equal(screen.queryByText(/SIMULACIÓN/), null);
  });

  it("sin teléfono de cobro lo advierte en rojo: sin él no se avisa ni se suspende", async () => {
    respuestaGet = { status: 200, json: datos({}, { telefonoCobro: null, nombreCobro: null, diaCobro: null }) };
    montar();
    await screen.findByText(/Falta: sin teléfono no se avisa ni se suspende/);
    assert.ok(screen.getByText("El nombre del negocio"));
    assert.ok(screen.getByText("El de la fecha"));
  });

  it("si el cobro no aplica explica por qué y no ofrece ninguna acción (cortesía, Wompi, sin suscripción, inactiva)", async () => {
    const casos: [string, RegExp][] = [["cortesia", /en cortesía/], ["wompi", /tarjeta por Wompi/], ["sin_suscripcion", /no tiene suscripción/], ["no_activa", /no está activa/]];
    for (const [motivo, texto] of casos) {
      respuestaGet = { status: 200, json: { modo: "activo", aplica: false, motivoNoAplica: motivo, suscripcion: null, ciclos: [] } };
      montar();
      await screen.findByText(texto);
      assert.equal(screen.queryAllByRole("button").length, 0, motivo);
      cleanup();
    }
  });

  it("sin la migración lo explica con el nombre del archivo a correr", async () => {
    respuestaGet = { status: 200, json: { migracionPendiente: true, modo: "simulacion" } };
    montar();
    await screen.findByText(/20261213000000_dulabs_cobros_manuales\.sql/);
  });

  it("si no se puede cargar, muestra el error en vez de quedarse cargando", async () => {
    respuestaGet = { status: 403, json: { error: "No autorizado" } };
    montar();
    await screen.findByText("No autorizado");
  });
});

describe("SeccionCobro — registrar un pago", () => {
  it("abre el formulario con el monto del plan, manda el ciclo que se ve en pantalla (y la nota), muestra la nueva fecha y recarga", async () => {
    respuestaGet = { status: 200, json: datos({}, { suspendidaPorPagoAt: "2026-10-30T14:05:00.000Z" }) };
    let cambios = 0;
    montar({ hoy: "2026-10-31", onCambio: () => cambios++ });
    fireEvent.click(await screen.findByRole("button", { name: "Registrar pago" }));
    const monto = screen.getByLabelText(/Monto recibido/) as HTMLInputElement;
    assert.equal(monto.value, "39990");
    fireEvent.change(screen.getByLabelText(/Nota/), { target: { value: "transferencia Bancolombia" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));
    await screen.findByText("Pago registrado. Próximo cobro: 30/11/2026. El bot vuelve a responder.");
    const post = llamadas.find((l) => l.metodo === "POST")!;
    assert.deepEqual(post.cuerpo, { accion: "registrar_pago", fecha_cobro: "2026-10-30", nota: "transferencia Bancolombia" }, "el monto igual al del plan no se manda: lo resuelve el servidor");
    assert.equal(post.auth, "Bearer token-de-prueba");
    assert.equal(llamadas.filter((l) => l.metodo === "GET").length, 2, "después del pago recarga el estado");
    assert.equal(cambios, 1, "avisa a la página para que recargue lo demás (suscripción)");
    assert.equal(screen.queryByLabelText(/Monto recibido/), null, "el formulario se cierra");
  });

  it("si lo recibido es distinto al plan, manda ese monto", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar pago" }));
    fireEvent.change(screen.getByLabelText(/Monto recibido/), { target: { value: "30000" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));
    await waitFor(() => assert.ok(llamadas.some((l) => l.metodo === "POST")));
    assert.deepEqual(llamadas.find((l) => l.metodo === "POST")!.cuerpo, { accion: "registrar_pago", fecha_cobro: "2026-10-30", monto_cop: 30000, nota: null });
  });

  it("no deja confirmar un monto vacío, cero o que no es número; cancelar no manda nada", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar pago" }));
    const confirmar = screen.getByRole("button", { name: "Confirmar pago" }) as HTMLButtonElement;
    for (const valor of ["", "0", "abc", "-5"]) {
      fireEvent.change(screen.getByLabelText(/Monto recibido/), { target: { value: valor } });
      assert.equal(confirmar.disabled, true, `«${valor}» no debe dejar confirmar`);
    }
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    assert.equal(llamadas.filter((l) => l.metodo === "POST").length, 0);
  });

  it("si el servidor rechaza el pago muestra su mensaje y deja el formulario para corregir", async () => {
    respuestaPost = { status: 409, json: { error: "La fecha de cobro cambió mientras tenías la pantalla abierta (¿ya se registró este pago?). Recarga la página." } };
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar pago" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));
    await screen.findByText(/Recarga la página/);
    assert.ok(screen.getByLabelText(/Monto recibido/), "el formulario sigue abierto");
  });
});

describe("SeccionCobro — editar los datos de cobro", () => {
  it("prellena con lo guardado y manda SOLO lo que cambió", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Editar datos de cobro" }));
    assert.equal((screen.getByLabelText(/WhatsApp de quien paga/) as HTMLInputElement).value, "573001234567");
    assert.equal((screen.getByLabelText(/Nombre en el saludo/) as HTMLInputElement).value, "AMORE");
    assert.equal((screen.getByLabelText(/Día de cobro/) as HTMLInputElement).value, "30");
    assert.equal((screen.getByLabelText(/Próxima fecha de cobro/) as HTMLInputElement).value, "2026-10-30");
    fireEvent.change(screen.getByLabelText(/WhatsApp de quien paga/), { target: { value: "3001112233" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Datos de cobro guardados.");
    assert.deepEqual(llamadas.find((l) => l.metodo === "POST")!.cuerpo, { accion: "configurar", telefono_cobro: "3001112233" });
  });

  it("vaciar un campo lo borra (null) y cambiar la fecha o el día se manda como número/fecha", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Editar datos de cobro" }));
    fireEvent.change(screen.getByLabelText(/Nombre en el saludo/), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/Día de cobro/), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText(/Próxima fecha de cobro/), { target: { value: "2026-11-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => assert.ok(llamadas.some((l) => l.metodo === "POST")));
    assert.deepEqual(llamadas.find((l) => l.metodo === "POST")!.cuerpo, { accion: "configurar", nombre_cobro: null, dia_cobro: 15, fecha_proximo_cobro: "2026-11-15" });
  });

  it("muestra el error del servidor (p. ej. un teléfono inválido) sin cerrar el formulario", async () => {
    respuestaPost = { status: 400, json: { error: "El teléfono de cobro debe tener entre 10 y 15 dígitos con indicativo (ej. 573001234567)." } };
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Editar datos de cobro" }));
    fireEvent.change(screen.getByLabelText(/WhatsApp de quien paga/), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText(/entre 10 y 15 dígitos/);
    assert.ok(screen.getByLabelText(/WhatsApp de quien paga/));
  });
});

describe("SeccionCobro — levantar la suspensión", () => {
  it("pide confirmación; si se acepta manda la acción y avisa que el bot vuelve a responder; si se rechaza no manda nada", async () => {
    respuestaGet = { status: 200, json: datos({}, { suspendidaPorPagoAt: "2026-10-30T14:05:00.000Z" }) };
    montar({ hoy: "2026-10-31" });
    (globalThis as { confirm?: unknown }).confirm = () => false;
    fireEvent.click(await screen.findByRole("button", { name: "Levantar suspensión" }));
    assert.equal(llamadas.filter((l) => l.metodo === "POST").length, 0);
    (globalThis as { confirm?: unknown }).confirm = () => true;
    fireEvent.click(screen.getByRole("button", { name: "Levantar suspensión" }));
    await screen.findByText("Suspensión levantada: el bot vuelve a responder.");
    assert.deepEqual(llamadas.find((l) => l.metodo === "POST")!.cuerpo, { accion: "levantar_suspension" });
  });
});
