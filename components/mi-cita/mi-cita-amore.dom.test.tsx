import "@/lib/test-helpers/jsdom-setup";
// AMORE — «Mi cita» (el enlace personal) en el celular: pruebas de INTERFAZ reales (jsdom + Testing Library) con la red simulada. Lo que se prueba: ver la cita, cambiar su
// fecha/hora y cancelarla con las acciones SIEMPRE a la vista en la barra pegada abajo (nada de bajar hasta el final para poder confirmar), los avisos de error, y que
// el botón «atrás» del celular regrese a la pantalla anterior en vez de salir de la página. El backend decide y vuelve a validar todo.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";
import { MiCitaAmore } from "@/components/mi-cita/MiCitaAmore";

const TOKEN = "t".repeat(43);
const VISTA_BASE = {
  negocio: "AMORE",
  servicio: "Manos Semi + Pies Semi",
  profesional: "Cristal",
  inicio: "2030-01-15T15:00:00.000Z", // 10:00 a. m. en Colombia
  fin: "2030-01-15T17:00:00.000Z",
  duracionMin: 120,
  estado: "confirmada",
  puedeCancelar: true,
  puedeReprogramar: true,
  aviso: null as string | null,
};
type Vista = typeof VISTA_BASE;

interface Red {
  vista: Vista;
  estadoCarga: number;
  horarios: string[] | "error" | "red";
  reprogramar: () => { status: number; cuerpo: unknown };
  cancelar: () => { status: number; cuerpo: unknown };
}
let red: Red;
let llamadas: { url: string; method: string; body?: Record<string, unknown> }[];
let fetchOriginal: typeof fetch;

function instalarRed(parcial: Partial<Red> = {}) {
  red = {
    vista: { ...VISTA_BASE },
    estadoCarga: 200,
    horarios: ["09:00", "10:00", "15:00"],
    reprogramar: () => ({ status: 200, cuerpo: { success: true, data: { inicio: "2030-01-16T20:00:00.000Z", fin: "2030-01-16T22:00:00.000Z", servicio: red.vista.servicio, profesional: "Cristal" } } }),
    cancelar: () => ({ status: 200, cuerpo: { success: true, data: {} } }),
    ...parcial,
  };
  llamadas = [];
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    llamadas.push({ url, method, body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined });
    const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
    if (url.includes("/horarios")) {
      if (red.horarios === "red") throw new Error("sin red");
      if (red.horarios === "error") return json({ success: false, error: "No pudimos consultar los horarios. Intenta de nuevo.", codigo: "calendario_no_disponible" }, 503);
      return json({ success: true, data: { fecha: "x", horarios: red.horarios } });
    }
    if (url.endsWith("/reprogramar")) {
      const r = red.reprogramar();
      return json(r.cuerpo, r.status);
    }
    if (url.endsWith("/cancelar")) {
      const r = red.cancelar();
      return json(r.cuerpo, r.status);
    }
    if (red.estadoCarga !== 200) return json({ success: false, error: "Este enlace no es válido o ya venció.", codigo: "enlace_invalido" }, red.estadoCarga);
    return json({ success: true, data: red.vista });
  }) as typeof fetch;
}

beforeEach(() => {
  window.scrollTo = () => {};
  window.history.replaceState(null, "");
  instalarRed();
});
afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
});

const barra = () => document.querySelector(".sticky.bottom-0") as HTMLElement;
const encabezado = (nombre: string) => screen.findByRole("heading", { name: nombre });
const primerDiaDisponible = () => screen.getAllByRole("button").find((b) => b.hasAttribute("aria-pressed") && !(b as HTMLButtonElement).disabled && / de /.test(b.getAttribute("aria-label") ?? ""))!;
const consultas = (fragmento: string, method = "GET") => llamadas.filter((l) => l.method === method && l.url.includes(fragmento));
async function atras() {
  await act(async () => {
    window.history.back();
    await new Promise((r) => setTimeout(r, 30));
  });
}

async function abrir() {
  render(<MiCitaAmore token={TOKEN} />);
  await encabezado("Tu cita");
}

describe("Mi cita: ver la cita", () => {
  it("muestra el servicio (con varios, «A + B»), la profesional, la fecha, la hora y la duración, y las acciones están en la barra de abajo", async () => {
    await abrir();
    const texto = document.body.textContent ?? "";
    assert.match(texto, /Manos Semi \+ Pies Semi/);
    assert.match(texto, /Cristal/);
    assert.match(texto, /Martes, 15 de enero/);
    assert.match(texto, /10:00 a\. m\./);
    assert.match(texto, /2 h/);
    assert.match(texto, /Confirmada/);
    assert.ok(within(barra()).getByRole("button", { name: "Modificar fecha u hora" }));
    assert.ok(within(barra()).getByRole("button", { name: "Cancelar cita" }));
    assert.equal(consultas(`/api/mi-cita/${TOKEN}`).length, 1, "una sola consulta, con el token del enlace");
  });

  it("una cita que ya no se puede cambiar ni cancelar ofrece reservar una nueva (y muestra el aviso)", async () => {
    cleanup();
    instalarRed({ vista: { ...VISTA_BASE, puedeCancelar: false, puedeReprogramar: false, aviso: "Ya no se puede modificar por internet.", estado: "completada" } });
    await abrir();
    assert.match(document.body.textContent ?? "", /Ya no se puede modificar por internet/);
    assert.ok(within(barra()).getByRole("link", { name: "Reservar una cita nueva" }));
    assert.equal(within(barra()).queryByRole("button", { name: "Cancelar cita" }), null);
  });

  it("un enlace inválido o vencido lo dice y ofrece reservar una cita nueva", async () => {
    cleanup();
    instalarRed({ estadoCarga: 404 });
    render(<MiCitaAmore token={TOKEN} />);
    await encabezado("Enlace no válido");
    assert.match(document.body.textContent ?? "", /Este enlace no es válido o ya venció/);
    assert.ok(within(barra()).getByRole("link", { name: "Reservar una cita nueva" }));
  });
});

describe("Mi cita: modificar fecha u hora", () => {
  async function hastaElegirHora() {
    await abrir();
    fireEvent.click(within(barra()).getByRole("button", { name: "Modificar fecha u hora" }));
    await encabezado("Elige tu nuevo horario");
    fireEvent.click(primerDiaDisponible());
    fireEvent.click(await screen.findByRole("button", { name: "10:00 a. m." }));
  }

  it("elegir día y hora deja «Confirmar» en la barra de abajo con el resumen; al confirmar manda fecha, hora y una clave de intento, y muestra la cita reprogramada", async () => {
    await hastaElegirHora();
    assert.equal(consultas("/horarios").length, 1);
    assert.match(barra().textContent ?? "", /Nuevo horario/);
    assert.match(barra().textContent ?? "", /10:00 a\. m\./);
    fireEvent.click(within(barra()).getByRole("button", { name: /Confirmar/ }));
    await encabezado("¡Cita reprogramada!");
    const [envio] = consultas("/reprogramar", "POST");
    assert.match(String(envio!.body!.fecha), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(envio!.body!.hora, "10:00");
    assert.ok(String(envio!.body!.idempotencyKey).length > 8);
    assert.match(document.body.textContent ?? "", /3:00 p\. m\./, "muestra el horario NUEVO que devolvió el servidor");
    assert.match(document.body.textContent ?? "", /Guarda este enlace/);
  });

  it("«Confirmar» no se activa hasta tener fecha Y hora", async () => {
    await abrir();
    fireEvent.click(within(barra()).getByRole("button", { name: "Modificar fecha u hora" }));
    await encabezado("Elige tu nuevo horario");
    const confirmar = () => within(barra()).getByRole("button", { name: /Confirmar/ }) as HTMLButtonElement;
    assert.equal(confirmar().disabled, true);
    fireEvent.click(primerDiaDisponible());
    await screen.findByRole("button", { name: "10:00 a. m." });
    assert.equal(confirmar().disabled, true, "con solo la fecha no alcanza");
    fireEvent.click(screen.getByRole("button", { name: "10:00 a. m." }));
    assert.equal(confirmar().disabled, false);
  });

  it("si alguien tomó ese horario, el aviso queda en la barra de abajo, se quita la selección y se actualiza la lista (el aviso no se borra)", async () => {
    cleanup();
    instalarRed({ reprogramar: () => ({ status: 409, cuerpo: { success: false, error: "Ese horario acaba de ser tomado. Elige otro.", codigo: "horario_ocupado" } }) });
    await hastaElegirHora();
    fireEvent.click(within(barra()).getByRole("button", { name: /Confirmar/ }));
    const alerta = await screen.findByRole("alert");
    assert.match(alerta.textContent ?? "", /acaba de ser tomado/);
    assert.ok(barra().contains(alerta));
    await waitFor(() => assert.equal(consultas("/horarios").length, 2, "se vuelve a consultar el día"));
    assert.equal((within(barra()).getByRole("button", { name: /Confirmar/ }) as HTMLButtonElement).disabled, true, "ya no hay hora elegida");
    assert.ok(barra().contains(screen.getByRole("alert")), "el aviso sigue a la vista");
  });

  it("si no se pueden consultar las horas lo dice (no «sin horarios») y deja reintentar", async () => {
    cleanup();
    instalarRed({ horarios: "error" });
    await abrir();
    fireEvent.click(within(barra()).getByRole("button", { name: "Modificar fecha u hora" }));
    await encabezado("Elige tu nuevo horario");
    fireEvent.click(primerDiaDisponible());
    await screen.findByText(/No pudimos consultar los horarios/);
    assert.ok(!(document.body.textContent ?? "").includes("No encontramos horarios disponibles"));
    red.horarios = ["10:00"];
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByRole("button", { name: "10:00 a. m." });
    assert.equal(consultas("/horarios").length, 2);
  });

  it("sin conexión al consultar las horas: mensaje y reintentar", async () => {
    cleanup();
    instalarRed({ horarios: "red" });
    await abrir();
    fireEvent.click(within(barra()).getByRole("button", { name: "Modificar fecha u hora" }));
    await encabezado("Elige tu nuevo horario");
    fireEvent.click(primerDiaDisponible());
    await screen.findByText(/Verifica tu conexión/);
    assert.ok(screen.getByRole("button", { name: "Reintentar" }));
  });
});

describe("Mi cita: cancelar", () => {
  it("pide confirmación; «No, conservar mi cita» regresa a «Tu cita» sin cancelar nada", async () => {
    await abrir();
    fireEvent.click(within(barra()).getByRole("button", { name: "Cancelar cita" }));
    await encabezado("¿Cancelar tu cita?");
    fireEvent.click(within(barra()).getByRole("button", { name: "No, conservar mi cita" }));
    await encabezado("Tu cita");
    assert.equal(consultas("/cancelar", "POST").length, 0);
  });

  it("«Sí, cancelar mi cita» cancela una sola vez y ofrece reservar una cita nueva", async () => {
    await abrir();
    fireEvent.click(within(barra()).getByRole("button", { name: "Cancelar cita" }));
    await encabezado("¿Cancelar tu cita?");
    fireEvent.click(within(barra()).getByRole("button", { name: "Sí, cancelar mi cita" }));
    await encabezado("Cita cancelada");
    assert.equal(consultas("/cancelar", "POST").length, 1);
    assert.ok(within(barra()).getByRole("link", { name: "Reservar una cita nueva" }));
  });

  it("si no se pudo cancelar, vuelve a «Tu cita» con el aviso a la vista", async () => {
    cleanup();
    instalarRed({ cancelar: () => ({ status: 409, cuerpo: { success: false, error: "No pudimos cancelar tu cita. Intenta de nuevo.", codigo: "error" } }) });
    await abrir();
    fireEvent.click(within(barra()).getByRole("button", { name: "Cancelar cita" }));
    await encabezado("¿Cancelar tu cita?");
    fireEvent.click(within(barra()).getByRole("button", { name: "Sí, cancelar mi cita" }));
    await encabezado("Tu cita");
    const alerta = await screen.findByRole("alert");
    assert.match(alerta.textContent ?? "", /No pudimos cancelar tu cita/);
    assert.ok(barra().contains(alerta));
  });
});

describe("Mi cita: el botón «atrás» del celular", () => {
  it("de «Elige tu nuevo horario» regresa a «Tu cita»; de «¿Cancelar tu cita?» también; la flecha de la pantalla hace lo mismo", async () => {
    await abrir();
    fireEvent.click(within(barra()).getByRole("button", { name: "Modificar fecha u hora" }));
    await encabezado("Elige tu nuevo horario");
    await atras();
    await encabezado("Tu cita");
    fireEvent.click(within(barra()).getByRole("button", { name: "Cancelar cita" }));
    await encabezado("¿Cancelar tu cita?");
    fireEvent.click(screen.getByRole("button", { name: "Volver" }));
    await encabezado("Tu cita");
  });

  it("tras reprogramar, «atrás» lleva a «Tu cita» ya con el horario nuevo (se consulta de nuevo), no a la pantalla de elegir", async () => {
    await abrir();
    fireEvent.click(within(barra()).getByRole("button", { name: "Modificar fecha u hora" }));
    await encabezado("Elige tu nuevo horario");
    fireEvent.click(primerDiaDisponible());
    fireEvent.click(await screen.findByRole("button", { name: "10:00 a. m." }));
    fireEvent.click(within(barra()).getByRole("button", { name: /Confirmar/ }));
    await encabezado("¡Cita reprogramada!");
    red.vista = { ...VISTA_BASE, inicio: "2030-01-16T20:00:00.000Z", fin: "2030-01-16T22:00:00.000Z" }; // lo que el servidor devuelve ahora
    await atras();
    await encabezado("Tu cita");
    await waitFor(() => assert.match(document.body.textContent ?? "", /Miércoles, 16 de enero/));
    assert.match(document.body.textContent ?? "", /3:00 p\. m\./);
    assert.equal(consultas("/reprogramar", "POST").length, 1, "no se reprograma dos veces");
  });

  it("tras cancelar, «atrás» lleva a «Tu cita» ya cancelada (se consulta de nuevo): sin botones para cancelar otra vez", async () => {
    await abrir();
    fireEvent.click(within(barra()).getByRole("button", { name: "Cancelar cita" }));
    await encabezado("¿Cancelar tu cita?");
    fireEvent.click(within(barra()).getByRole("button", { name: "Sí, cancelar mi cita" }));
    await encabezado("Cita cancelada");
    red.vista = { ...VISTA_BASE, estado: "cancelada", puedeCancelar: false, puedeReprogramar: false };
    await atras();
    await encabezado("Tu cita");
    await waitFor(() => assert.match(document.body.textContent ?? "", /Cancelada/));
    assert.equal(within(barra()).queryByRole("button", { name: "Cancelar cita" }), null);
    assert.ok(within(barra()).getByRole("link", { name: "Reservar una cita nueva" }));
    assert.equal(consultas("/cancelar", "POST").length, 1);
  });
});
