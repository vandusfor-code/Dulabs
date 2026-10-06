import "@/lib/test-helpers/jsdom-setup";
// AMORE — portal de reservas (/reservar/amore) en el celular: pruebas de INTERFAZ reales (jsdom + Testing Library) de la página completa, con la red simulada.
// Lo que se prueba: la clienta puede elegir VARIOS servicios (incluso de categorías distintas: manos en «Uñas», pies en «Otros»), la selección no se pierde al
// cambiar de categoría ni al volver, el servidor recibe la lista completa (`servicioIds`) en cada consulta y en la reserva, y el botón «Continuar» vive en la barra
// pegada abajo de CADA paso (nunca al final de una lista larga). El backend decide y vuelve a validar todo: aquí solo se ve qué le pide la pantalla.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import PortalReservasAmorePage from "@/app/reservar/amore/page";

const SERVICIOS = [
  { id: "s-manos", nombre: "Manos Semi", categoria: "Uñas", descripcion: null, duracion_min: 60, precio: 45000, imagen_url: null },
  { id: "s-dipping", nombre: "Dipping", categoria: "Uñas", descripcion: "Recubrimiento con polvo acrílico", duracion_min: 120, precio: 60000, imagen_url: null },
  { id: "s-cejas", nombre: "Diseño de cejas", categoria: "Cejas", descripcion: null, duracion_min: 30, precio: 20000, imagen_url: null },
  { id: "s-pies", nombre: "Pies Semi", categoria: null, descripcion: null, duracion_min: 60, precio: 45000, imagen_url: null },
  { id: "s-keratina", nombre: "Keratina", categoria: null, descripcion: null, duracion_min: 180, precio: null, imagen_url: null },
];

type Llamada = { url: string; method: string; body?: Record<string, unknown> };

interface OpcionesRed {
  especialistas?: unknown;
  post?: () => { status: number; cuerpo: unknown };
  maxServiciosPorCita?: number;
}

const EXITO = { success: true, codigo: "A-123456", servicio: "Manos Semi + Pies Semi", profesional: "Cristal", inicio: "2030-01-15T15:00:00.000Z", fin: "2030-01-15T17:00:00.000Z", duracionMin: 120, enlaceGestion: "https://www.dulabs.co/mi-cita/abc" };

let llamadas: Llamada[];
let fetchOriginal: typeof fetch;

function instalarRed(opciones: OpcionesRed = {}) {
  llamadas = [];
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    llamadas.push({ url, method, body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined });
    const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
    if (method === "POST") {
      const r = opciones.post?.() ?? { status: 200, cuerpo: EXITO };
      return json(r.cuerpo, r.status);
    }
    if (url.includes("/especialistas")) return json(opciones.especialistas ?? { especialistas: [{ id: 1, nombre: "Cristal" }, { id: 2, nombre: "Mary" }] });
    if (url.includes("/disponibilidad")) return json({ especialistas: [{ especialistaId: 1, nombre: "Cristal", estado: "ok", horarios: ["09:00", "10:00", "15:00"] }] });
    return json({ disponible: true, negocio: "AMORE", telefonoNegocio: null, servicios: SERVICIOS, maxServiciosPorCita: opciones.maxServiciosPorCita ?? 3 });
  }) as typeof fetch;
}

const consultas = (fragmento: string) => llamadas.filter((l) => l.method === "GET" && l.url.includes(fragmento));
const servicioIdsDe = (llamada: Llamada) => new URL(llamada.url, "http://localhost").searchParams.get("servicioIds");
const barraDeAbajo = () => document.querySelector(".sticky.bottom-0") as HTMLElement;
const continuar = () => within(barraDeAbajo()).getByRole("button", { name: /Continuar/ });

beforeEach(() => {
  instalarRed();
  window.scrollTo = () => {}; // jsdom no implementa el desplazamiento
});

afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
});

async function abrirServicios() {
  render(<PortalReservasAmorePage />);
  fireEvent.click(await screen.findByRole("button", { name: /Comenzar ahora/ }));
  await screen.findByRole("heading", { name: "Elige tus servicios" });
}

/** El primer día seleccionable de la semana que muestra el paso de horario (hoy). */
const primerDiaDisponible = () => screen.getAllByRole("button").find((b) => b.hasAttribute("aria-pressed") && !(b as HTMLButtonElement).disabled && / de /.test(b.getAttribute("aria-label") ?? ""))!;

const marcar = (nombre: RegExp) => fireEvent.click(screen.getByRole("checkbox", { name: nombre }));
const categoria = (nombre: RegExp) => fireEvent.click(screen.getByRole("tab", { name: nombre }));

describe("Paso 1: elegir VARIOS servicios", () => {
  it("las categorías van de la que más servicios tiene a la que menos, y «Otros» (sin categoría) siempre al final", async () => {
    await abrirServicios();
    assert.deepEqual(screen.getAllByRole("tab").map((t) => t.textContent?.trim()), ["Uñas", "Cejas", "Otros"]);
    assert.equal(screen.getByRole("tab", { name: /Uñas/ }).getAttribute("aria-selected"), "true", "abre en la categoría principal");
  });

  it("con nada elegido «Continuar» está deshabilitado y la barra invita a elegir; la pantalla avisa que se pueden combinar hasta 3", async () => {
    await abrirServicios();
    assert.equal((continuar() as HTMLButtonElement).disabled, true);
    assert.match(barraDeAbajo().textContent ?? "", /Elige uno o más servicios/);
    assert.match(document.body.textContent ?? "", /Puedes combinar hasta 3 en una misma cita/);
  });

  it("se pueden marcar servicios de CATEGORÍAS DISTINTAS (manos en Uñas + pies en Otros): la selección no se pierde al cambiar de categoría y la barra suma duración y precio", async () => {
    await abrirServicios();
    marcar(/Manos Semi/);
    categoria(/Otros/);
    marcar(/Pies Semi/);
    categoria(/Uñas/);
    assert.equal(screen.getByRole("checkbox", { name: /Manos Semi/ }).getAttribute("aria-checked"), "true", "sigue marcado al volver a su categoría");
    const barra = barraDeAbajo();
    assert.match(barra.textContent ?? "", /2 servicios/);
    assert.match(barra.textContent ?? "", /2 h/);
    assert.match(barra.textContent ?? "", /\$90\.000/);
    assert.ok(within(barra).getByRole("button", { name: "Quitar Manos Semi" }));
    assert.ok(within(barra).getByRole("button", { name: "Quitar Pies Semi" }));
    assert.equal((continuar() as HTMLButtonElement).disabled, false);
  });

  it("cada categoría muestra cuántos servicios hay marcados en ella", async () => {
    await abrirServicios();
    marcar(/Manos Semi/);
    marcar(/Dipping/);
    categoria(/Otros/);
    marcar(/Pies Semi/);
    assert.equal(screen.getByRole("tab", { name: /Uñas/ }).textContent?.replace(/\s+/g, ""), "Uñas2");
    assert.equal(screen.getByRole("tab", { name: /Otros/ }).textContent?.replace(/\s+/g, ""), "Otros1");
    assert.equal(screen.getByRole("tab", { name: /Cejas/ }).textContent?.trim(), "Cejas");
  });

  it("tocar otra vez desmarca; también se quita desde la barra de abajo (✕)", async () => {
    await abrirServicios();
    marcar(/Manos Semi/);
    marcar(/Dipping/);
    marcar(/Dipping/);
    assert.equal(screen.getByRole("checkbox", { name: /Dipping/ }).getAttribute("aria-checked"), "false");
    fireEvent.click(within(barraDeAbajo()).getByRole("button", { name: "Quitar Manos Semi" }));
    assert.equal(screen.getByRole("checkbox", { name: /Manos Semi/ }).getAttribute("aria-checked"), "false");
    assert.equal((continuar() as HTMLButtonElement).disabled, true);
  });

  it("con el máximo (3) alcanzado no deja marcar un cuarto, lo avisa, y al quitar uno se puede elegir otro", async () => {
    await abrirServicios();
    marcar(/Manos Semi/);
    marcar(/Dipping/);
    categoria(/Cejas/);
    marcar(/Diseño de cejas/);
    categoria(/Otros/);
    assert.match(document.body.textContent ?? "", /Llegaste al máximo de 3 servicios por cita/);
    marcar(/Pies Semi/);
    assert.equal(screen.getByRole("checkbox", { name: /Pies Semi/ }).getAttribute("aria-checked"), "false", "el cuarto no se marca");
    assert.equal(screen.getByRole("checkbox", { name: /Pies Semi/ }).getAttribute("aria-disabled"), "true");
    fireEvent.click(within(barraDeAbajo()).getByRole("button", { name: "Quitar Dipping" }));
    marcar(/Pies Semi/);
    assert.equal(screen.getByRole("checkbox", { name: /Pies Semi/ }).getAttribute("aria-checked"), "true");
  });

  it("un servicio sin precio no inventa un total: la barra solo muestra la duración", async () => {
    await abrirServicios();
    marcar(/Manos Semi/);
    categoria(/Otros/);
    marcar(/Keratina/);
    const barra = barraDeAbajo().textContent ?? "";
    assert.match(barra, /2 servicios/);
    assert.match(barra, /4 h/);
    assert.ok(!barra.includes("$"), "sin precio fijo en uno de los servicios no se muestra ningún total");
  });

  it("si el servidor dice que solo cabe 1 servicio por cita (otro negocio), no se ofrece combinar: el segundo queda bloqueado", async () => {
    cleanup();
    instalarRed({ maxServiciosPorCita: 1 });
    await abrirServicios();
    assert.ok(!(document.body.textContent ?? "").includes("Puedes combinar"));
    marcar(/Manos Semi/);
    marcar(/Dipping/);
    assert.equal(screen.getByRole("checkbox", { name: /Dipping/ }).getAttribute("aria-checked"), "false");
  });
});

describe("Del paso de servicios a la reserva: el servidor recibe la lista COMPLETA", () => {
  async function hastaProfesional() {
    await abrirServicios();
    marcar(/Manos Semi/);
    categoria(/Otros/);
    marcar(/Pies Semi/);
    fireEvent.click(continuar());
    await screen.findByRole("heading", { name: "Elige tu profesional" });
  }

  it("«Continuar» pide las profesionales de TODOS los servicios juntos (servicioIds=a,b) y la franja de arriba resume la cita", async () => {
    await hastaProfesional();
    await screen.findByRole("button", { name: /Cristal/ });
    const [consulta] = consultas("/especialistas");
    assert.equal(servicioIdsDe(consulta!), "s-manos,s-pies");
    assert.match(document.body.textContent ?? "", /Manos Semi \+ Pies Semi/);
    assert.match(document.body.textContent ?? "", /\$90\.000/);
  });

  it("si ninguna profesional hace todos los servicios juntos lo explica y ofrece cambiar la selección", async () => {
    cleanup();
    instalarRed({ especialistas: { especialistas: [], motivo: "combinacion_sin_profesional" } });
    await hastaProfesional();
    await screen.findByText(/Ninguna profesional realiza todos estos servicios en una misma cita/);
    fireEvent.click(screen.getByRole("button", { name: "Cambiar servicios" }));
    await screen.findByRole("heading", { name: "Elige tus servicios" });
    assert.equal(screen.getByRole("checkbox", { name: /Manos Semi/ }).getAttribute("aria-checked"), "true", "la selección se conserva para ajustarla");
  });

  it("volver al paso 1 y avanzar SIN cambiar nada conserva la lista de profesionales (no se vuelve a consultar); si se cambia algo, sí", async () => {
    await hastaProfesional();
    await screen.findByRole("button", { name: /Cristal/ });
    fireEvent.click(screen.getByRole("button", { name: "Volver" }));
    await screen.findByRole("heading", { name: "Elige tus servicios" });
    fireEvent.click(continuar());
    await screen.findByRole("heading", { name: "Elige tu profesional" });
    assert.equal(consultas("/especialistas").length, 1, "misma selección: ninguna consulta nueva");
    fireEvent.click(screen.getByRole("button", { name: "Volver" }));
    await screen.findByRole("heading", { name: "Elige tus servicios" });
    categoria(/Otros/);
    marcar(/Keratina/);
    fireEvent.click(continuar());
    await screen.findByRole("heading", { name: "Elige tu profesional" });
    await waitFor(() => assert.equal(consultas("/especialistas").length, 2));
    assert.equal(servicioIdsDe(consultas("/especialistas")[1]!), "s-manos,s-pies,s-keratina");
  });

  it("recorrido completo: profesional -> horario (consulta con TODOS los servicios) -> datos -> confirmar: la reserva sale con servicioIds y sin servicioId suelto", async () => {
    await hastaProfesional();
    fireEvent.click(await screen.findByRole("button", { name: /Cristal/ }));
    await screen.findByRole("heading", { name: "Elige tu horario" });

    // «Continuar» está en la barra de abajo y no se activa hasta tener fecha y hora.
    assert.equal((continuar() as HTMLButtonElement).disabled, true);
    fireEvent.click(primerDiaDisponible());
    fireEvent.click(await screen.findByRole("button", { name: "10:00 a. m." }));
    const [disponibilidad] = consultas("/disponibilidad");
    assert.equal(servicioIdsDe(disponibilidad!), "s-manos,s-pies");
    assert.match(barraDeAbajo().textContent ?? "", /10:00 a\. m\./);
    fireEvent.click(continuar());

    await screen.findByRole("heading", { name: "Cuéntanos sobre ti" });
    assert.equal((continuar() as HTMLButtonElement).disabled, true);
    fireEvent.change(screen.getByLabelText(/Nombre completo/), { target: { value: "Ana Pérez" } });
    fireEvent.change(screen.getByLabelText(/WhatsApp/), { target: { value: "300 123 4567" } });
    fireEvent.click(continuar());

    await screen.findByRole("heading", { name: "Confirma tu cita" });
    assert.match(document.body.textContent ?? "", /Duración total/);
    assert.match(document.body.textContent ?? "", /\$90\.000/);
    fireEvent.click(within(barraDeAbajo()).getByRole("button", { name: /Confirmar mi cita/ }));

    await screen.findByRole("heading", { name: "¡Cita confirmada!" });
    const reservas = llamadas.filter((l) => l.method === "POST");
    assert.equal(reservas.length, 1);
    assert.deepEqual(reservas[0]!.body!.servicioIds, ["s-manos", "s-pies"]);
    assert.ok(!("servicioId" in reservas[0]!.body!), "la lista completa viaja en servicioIds");
    assert.equal(reservas[0]!.body!.especialistaId, 1);
    // Éxito: lista los dos servicios, la duración total y el botón del enlace queda en la barra de abajo.
    assert.match(document.body.textContent ?? "", /Manos Semi/);
    assert.match(document.body.textContent ?? "", /Pies Semi/);
    assert.ok(within(barraDeAbajo()).getByRole("link", { name: /Ver o modificar mi cita/ }));
  });

  it("si alguien tomó el horario, el aviso queda en la barra de abajo y la acción principal es elegir otro horario (confirmar de nuevo fallaría igual)", async () => {
    cleanup();
    instalarRed({ post: () => ({ status: 409, cuerpo: { error: "Este horario acaba de ser reservado. Por favor selecciona otro." } }) });
    await hastaProfesional();
    fireEvent.click(await screen.findByRole("button", { name: /Cristal/ }));
    await screen.findByRole("heading", { name: "Elige tu horario" });
    fireEvent.click(primerDiaDisponible());
    fireEvent.click(await screen.findByRole("button", { name: "10:00 a. m." }));
    fireEvent.click(continuar());
    await screen.findByRole("heading", { name: "Cuéntanos sobre ti" });
    fireEvent.change(screen.getByLabelText(/Nombre completo/), { target: { value: "Ana Pérez" } });
    fireEvent.change(screen.getByLabelText(/WhatsApp/), { target: { value: "3001234567" } });
    fireEvent.click(continuar());
    await screen.findByRole("heading", { name: "Confirma tu cita" });
    fireEvent.click(within(barraDeAbajo()).getByRole("button", { name: /Confirmar mi cita/ }));

    const alerta = await screen.findByRole("alert");
    assert.match(alerta.textContent ?? "", /acaba de ser reservado/);
    assert.ok(barraDeAbajo().contains(alerta), "el aviso está en la barra de abajo, siempre a la vista");
    assert.equal(within(barraDeAbajo()).queryByRole("button", { name: /Confirmar mi cita/ }), null);
    fireEvent.click(within(barraDeAbajo()).getByRole("button", { name: /Elegir otro horario/ }));
    await screen.findByRole("heading", { name: "Elige tu horario" });
  });

  it("el WhatsApp se valida en el paso de datos (10 a 15 dígitos): un número corto avisa y bloquea «Continuar»", async () => {
    await hastaProfesional();
    fireEvent.click(await screen.findByRole("button", { name: /Cristal/ }));
    await screen.findByRole("heading", { name: "Elige tu horario" });
    fireEvent.click(primerDiaDisponible());
    fireEvent.click(await screen.findByRole("button", { name: "3:00 p. m." }));
    fireEvent.click(continuar());
    await screen.findByRole("heading", { name: "Cuéntanos sobre ti" });
    fireEvent.change(screen.getByLabelText(/Nombre completo/), { target: { value: "Ana Pérez" } });
    const telefono = screen.getByLabelText(/WhatsApp/);
    fireEvent.change(telefono, { target: { value: "300123" } });
    fireEvent.blur(telefono);
    assert.match(document.body.textContent ?? "", /con 10 dígitos/);
    assert.equal((continuar() as HTMLButtonElement).disabled, true);
    fireEvent.change(telefono, { target: { value: "+57 300 123 4567" } });
    assert.equal((continuar() as HTMLButtonElement).disabled, false);
  });
});

describe("Cada paso tiene su botón en la barra pegada abajo (nunca al final de una lista larga)", () => {
  it("la landing y los servicios lo traen en la barra de abajo (en horario, datos y confirmación también: ver el recorrido completo)", async () => {
    render(<PortalReservasAmorePage />);
    const comenzar = await screen.findByRole("button", { name: /Comenzar ahora/ });
    assert.ok(barraDeAbajo().contains(comenzar), "landing: «Comenzar ahora» pegado abajo");
    fireEvent.click(comenzar);
    await screen.findByRole("heading", { name: "Elige tus servicios" });
    assert.ok(barraDeAbajo().contains(continuar()));
  });

  it("el encabezado muestra «paso X de 5» con barra de avance, en vez del indicador de pasos que ocupaba media pantalla", async () => {
    await abrirServicios();
    const avance = screen.getByRole("progressbar");
    assert.equal(avance.getAttribute("aria-valuenow"), "1");
    assert.equal(avance.getAttribute("aria-valuemax"), "5");
    assert.match(document.body.textContent ?? "", /1\/5/);
  });
});
