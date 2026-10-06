import "@/lib/test-helpers/jsdom-setup";
// AMORE — el botón «atrás» del celular (o el gesto de volver) regresa al PASO ANTERIOR en vez de sacar a la clienta del portal y hacerle perder lo elegido.
// Se prueba el mecanismo (`useHistorialPasos`) con la API de historial real del navegador (jsdom) y la página completa del portal con la red simulada.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { useState } from "react";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { useHistorialPasos } from "@/components/reservar-amore/useHistorialPasos";
import PortalReservasAmorePage from "@/app/reservar/amore/page";

const marcaActual = () => (window.history.state as { amorePasos?: { paso: string; idx: number } } | null)?.amorePasos ?? null;
/** Retrocede UNA entrada del historial, como el botón «atrás» del celular, y espera a que el navegador avise (popstate). */
async function atras() {
  await act(async () => {
    window.history.back();
    await new Promise((r) => setTimeout(r, 30));
  });
}
async function adelante() {
  await act(async () => {
    window.history.forward();
    await new Promise((r) => setTimeout(r, 30));
  });
}

beforeEach(() => {
  window.scrollTo = () => {};
  window.history.replaceState(null, "");
});
afterEach(() => cleanup());

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// El mecanismo, con una pantalla mínima de pasos a→b→c→fin
// ---------------------------------------------------------------------------------------------------------------------------------------------------
type P = "a" | "b" | "c" | "fin";

function Pantalla({ tieneDatos = true, alReiniciar }: { tieneDatos?: boolean; alReiniciar?: () => void }) {
  const [datos, setDatos] = useState(tieneDatos);
  const { paso, irA, volver } = useHistorialPasos<P>({
    inicial: "a",
    puedeMostrar: (p) => (p === "c" ? datos : true),
    esFinal: (p) => p === "fin",
    alReiniciar,
  });
  return (
    <div>
      <p data-testid="paso">{paso}</p>
      <button onClick={() => irA("b")}>ir a b</button>
      <button onClick={() => irA("c")}>ir a c</button>
      <button onClick={() => irA("fin")}>terminar</button>
      <button onClick={volver}>volver</button>
      <button onClick={() => setDatos(false)}>perder datos</button>
    </div>
  );
}
const pasoMostrado = () => screen.getByTestId("paso").textContent;

describe("useHistorialPasos", () => {
  it("al abrir, la entrada actual del historial es el paso inicial (idx 0)", () => {
    render(<Pantalla />);
    assert.deepEqual(marcaActual(), { paso: "a", idx: 0 });
    assert.equal(pasoMostrado(), "a");
  });

  it("cada paso nuevo agrega una entrada y «atrás» regresa al paso anterior, una por una", async () => {
    render(<Pantalla />);
    fireEvent.click(screen.getByText("ir a b"));
    fireEvent.click(screen.getByText("ir a c"));
    assert.deepEqual(marcaActual(), { paso: "c", idx: 2 });
    assert.equal(pasoMostrado(), "c");
    await atras();
    assert.equal(pasoMostrado(), "b");
    await atras();
    assert.equal(pasoMostrado(), "a");
  });

  it("la flecha de volver de la pantalla hace lo mismo que el botón «atrás»; en el paso inicial no hace nada", async () => {
    render(<Pantalla />);
    fireEvent.click(screen.getByText("volver"));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(pasoMostrado(), "a");
    fireEvent.click(screen.getByText("ir a b"));
    fireEvent.click(screen.getByText("volver"));
    await waitFor(() => assert.equal(pasoMostrado(), "a"));
  });

  it("«adelante» del navegador vuelve a mostrar el paso al que se había llegado", async () => {
    render(<Pantalla />);
    fireEvent.click(screen.getByText("ir a b"));
    await atras();
    assert.equal(pasoMostrado(), "a");
    await adelante();
    assert.equal(pasoMostrado(), "b");
  });

  it("ir a un paso nuevo después de volver reemplaza lo que había «adelante» (como cualquier navegación)", async () => {
    render(<Pantalla />);
    fireEvent.click(screen.getByText("ir a b"));
    await atras();
    fireEvent.click(screen.getByText("ir a c"));
    assert.deepEqual(marcaActual(), { paso: "c", idx: 1 });
    await atras();
    assert.equal(pasoMostrado(), "a");
  });

  it("un paso sin datos se SALTA al ir hacia atrás (nunca se muestra una pantalla vacía)", async () => {
    render(<Pantalla />);
    fireEvent.click(screen.getByText("ir a c")); // a -> c (idx 1)
    fireEvent.click(screen.getByText("ir a b")); // c -> b (idx 2)
    fireEvent.click(screen.getByText("perder datos"));
    await atras(); // la entrada anterior es «c», que ya no tiene datos: se salta hasta «a»
    await waitFor(() => assert.equal(pasoMostrado(), "a"));
  });

  it("a un paso sin datos tampoco se avanza con «adelante»: se queda donde estaba", async () => {
    render(<Pantalla />);
    fireEvent.click(screen.getByText("ir a b"));
    fireEvent.click(screen.getByText("ir a c"));
    await atras(); // en b; «adelante» llevaría a c
    fireEvent.click(screen.getByText("perder datos"));
    await adelante();
    await waitFor(() => assert.equal(pasoMostrado(), "b"));
  });

  it("tras un paso FINAL, «atrás» no regresa a los pasos viejos: retrocede hasta el inicio y reinicia", async () => {
    let reinicios = 0;
    render(<Pantalla alReiniciar={() => reinicios++} />);
    fireEvent.click(screen.getByText("ir a b"));
    fireEvent.click(screen.getByText("ir a c"));
    fireEvent.click(screen.getByText("terminar"));
    assert.equal(pasoMostrado(), "fin");
    await atras();
    // Retrocede solo (c, b) hasta el inicio, sin mostrar esos pasos.
    await waitFor(() => assert.equal(pasoMostrado(), "a"));
    assert.equal(reinicios, 1);
    assert.deepEqual(marcaActual(), { paso: "a", idx: 0 });
  });

  it("si la página se recarga a mitad de camino (la entrada trae un paso viejo), se limpia: la visita empieza en el paso inicial", () => {
    window.history.replaceState({ amorePasos: { paso: "c", idx: 2 } }, "");
    render(<Pantalla />);
    assert.deepEqual(marcaActual(), { paso: "a", idx: 0 });
    assert.equal(pasoMostrado(), "a");
  });

  it("conserva lo que Next.js guarda en cada entrada (`__NA` y el árbol del enrutador): sin eso, al volver a ella Next recargaría la página entera", async () => {
    const arbol = { tree: ["", { children: ["reservar"] }], renderedSearch: "" };
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: arbol }, "");
    const deNext = () => {
      const s = window.history.state as { __NA?: boolean; __PRIVATE_NEXTJS_INTERNALS_TREE?: unknown };
      return { na: s.__NA, arbol: s.__PRIVATE_NEXTJS_INTERNALS_TREE };
    };
    render(<Pantalla />);
    assert.deepEqual(deNext(), { na: true, arbol }, "la entrada inicial, ya marcada");
    fireEvent.click(screen.getByText("ir a b"));
    assert.deepEqual(deNext(), { na: true, arbol }, "la entrada nueva");
    await atras();
    assert.deepEqual(deNext(), { na: true, arbol }, "y al volver a la inicial");
  });

  it("no toca la dirección de la página ni deja el escucha puesto al desmontar", async () => {
    const antes = window.location.href;
    const { unmount } = render(<Pantalla />);
    fireEvent.click(screen.getByText("ir a b"));
    assert.equal(window.location.href, antes, "la URL es la misma: el enlace compartido no cambia");
    unmount();
    await atras(); // sin escucha: no debe fallar ni intentar cambiar nada
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// La página completa del portal
// ---------------------------------------------------------------------------------------------------------------------------------------------------
const SERVICIOS = [
  { id: "s-manos", nombre: "Manos Semi", categoria: "Uñas", descripcion: null, duracion_min: 60, precio: 45000, imagen_url: null },
  { id: "s-pies", nombre: "Pies Semi", categoria: null, descripcion: null, duracion_min: 60, precio: 45000, imagen_url: null },
];
const EXITO = { success: true, codigo: "A-123456", servicio: "Manos Semi + Pies Semi", profesional: "Cristal", inicio: "2030-01-15T15:00:00.000Z", fin: "2030-01-15T17:00:00.000Z", duracionMin: 120, enlaceGestion: "https://www.dulabs.co/mi-cita/abc" };

let fetchOriginal: typeof fetch;
let llamadas: { url: string; method: string }[];

function instalarRed() {
  llamadas = [];
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    llamadas.push({ url, method });
    const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
    if (method === "POST") return json(EXITO);
    if (url.includes("/especialistas")) return json({ especialistas: [{ id: 1, nombre: "Cristal" }] });
    if (url.includes("/disponibilidad")) return json({ especialistas: [{ especialistaId: 1, nombre: "Cristal", estado: "ok", horarios: ["10:00", "15:00"] }] });
    return json({ disponible: true, negocio: "AMORE", telefonoNegocio: null, servicios: SERVICIOS, maxServiciosPorCita: 3 });
  }) as typeof fetch;
}

const encabezado = (nombre: string) => screen.findByRole("heading", { name: nombre });
const primerDiaDisponible = () => screen.getAllByRole("button").find((b) => b.hasAttribute("aria-pressed") && !(b as HTMLButtonElement).disabled && / de /.test(b.getAttribute("aria-label") ?? ""))!;

async function hastaHorario() {
  render(<PortalReservasAmorePage />);
  fireEvent.click(await screen.findByRole("button", { name: /Comenzar ahora/ }));
  await encabezado("Elige tus servicios");
  fireEvent.click(screen.getByRole("checkbox", { name: /Manos Semi/ }));
  fireEvent.click(screen.getByRole("tab", { name: /Otros/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Pies Semi/ }));
  fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Cristal/ }));
  await encabezado("Elige tu horario");
}

async function hastaConfirmar() {
  await hastaHorario();
  fireEvent.click(primerDiaDisponible());
  fireEvent.click(await screen.findByRole("button", { name: "10:00 a. m." }));
  fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
  await encabezado("Cuéntanos sobre ti");
  fireEvent.change(screen.getByLabelText(/Nombre completo/), { target: { value: "Ana Pérez" } });
  fireEvent.change(screen.getByLabelText(/WhatsApp/), { target: { value: "3001234567" } });
  fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
  await encabezado("Confirma tu cita");
}

describe("Portal de reservas: el botón «atrás» del celular", () => {
  beforeEach(() => instalarRed());
  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
  });

  it("«atrás» regresa de paso en paso hasta el inicio, y la selección sigue ahí", async () => {
    await hastaHorario();
    await atras();
    await encabezado("Elige tu profesional");
    await atras();
    await encabezado("Elige tus servicios");
    assert.equal(screen.getByRole("checkbox", { name: /Manos Semi/ }).getAttribute("aria-checked"), "true", "lo elegido no se pierde al volver");
    await atras();
    await screen.findByRole("button", { name: /Comenzar ahora/ });
  });

  it("al volver al horario con «atrás» y avanzar de nuevo con «adelante» (o con los botones), todo sigue en su lugar", async () => {
    await hastaConfirmar();
    await atras();
    await encabezado("Cuéntanos sobre ti");
    assert.equal((screen.getByLabelText(/Nombre completo/) as HTMLInputElement).value, "Ana Pérez", "los datos escritos se conservan");
    await adelante();
    await encabezado("Confirma tu cita");
  });

  it("la flecha de la pantalla hace lo mismo que el botón «atrás» del celular", async () => {
    await hastaHorario();
    fireEvent.click(screen.getByRole("button", { name: "Volver" }));
    await encabezado("Elige tu profesional");
  });

  it("cambiar los servicios invalida lo que dependía de ellos: «adelante» NO muestra la profesional ni el horario de la combinación anterior", async () => {
    await hastaHorario();
    await atras();
    await atras();
    await encabezado("Elige tus servicios");
    fireEvent.click(screen.getByRole("checkbox", { name: /Manos Semi/ })); // quita uno: otra combinación
    await adelante();
    await new Promise((r) => setTimeout(r, 50));
    await encabezado("Elige tus servicios"); // se queda: la lista de profesionales era de la combinación anterior
  });

  it("después de reservar, «atrás» no vuelve a «Confirmar» (no se confirma dos veces): lleva al inicio con todo limpio", async () => {
    await hastaConfirmar();
    fireEvent.click(screen.getByRole("button", { name: /Confirmar mi cita/ }));
    await encabezado("¡Cita confirmada!");
    await atras();
    await screen.findByRole("button", { name: /Comenzar ahora/ });
    assert.equal(llamadas.filter((l) => l.method === "POST").length, 1, "solo una reserva");
    fireEvent.click(screen.getByRole("button", { name: /Comenzar ahora/ }));
    await encabezado("Elige tus servicios");
    assert.equal(screen.getByRole("checkbox", { name: /Manos Semi/ }).getAttribute("aria-checked"), "false", "una reserva nueva empieza sin lo de la anterior");
    assert.match(document.querySelector(".sticky.bottom-0")?.textContent ?? "", /Elige uno o más servicios/);
  });

  it("si la clienta elige otro horario porque el suyo se ocupó, «atrás» no la deja en una pantalla sin datos", async () => {
    await hastaConfirmar();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if ((init?.method ?? "GET") === "POST") return new Response(JSON.stringify({ error: "Este horario acaba de ser reservado. Por favor selecciona otro." }), { status: 409, headers: { "content-type": "application/json" } });
      return fetchOriginal(url, init);
    }) as typeof fetch;
    fireEvent.click(screen.getByRole("button", { name: /Confirmar mi cita/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Elegir otro horario/ }));
    await encabezado("Elige tu horario");
    await atras(); // las entradas anteriores (Confirmar y Datos) ya no tienen horario: se saltan hasta el paso «Horario» de antes
    await waitFor(() => assert.equal(marcaActual()?.idx, 3, "se retrocedió hasta la entrada del horario, sin pasar por pantallas vacías"));
    await encabezado("Elige tu horario");
  });
});
