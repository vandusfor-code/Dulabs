import "@/lib/test-helpers/jsdom-setup";
/**
 * Inicio «como la referencia» del tema "joyeria": lo que hace el cliente (jsdom). El carrusel de la portada (cambia solo cada 5,1 s, se detiene al pasar el mouse, al enfocar, con el botón de
 * pausa, con «movimiento reducido» y cuando el contenido lo tapa; flechas y puntos a mano), el video (se pide solo cuando hace falta, corre únicamente mientras se ve y en la diapositiva
 * activa, no arranca solo con «movimiento reducido» o ahorro de datos, y si el navegador no lo deja el botón queda en «Reproducir»), los botones flotantes y el cromo que se vuelve claro donde
 * empieza lo claro. Nada de esto toca precios, stock ni pedidos.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { CromoJoyeria } from "@/components/catalogo-publico/tienda/joyeria/CromoJoyeria";
import { FlotantesJoyeria } from "@/components/catalogo-publico/tienda/joyeria/FlotantesJoyeria";
import { INTERVALO_PORTADA_MS, PortadaJoyeria } from "@/components/catalogo-publico/tienda/joyeria/PortadaJoyeria";
import { VideoSeccion } from "@/components/catalogo-publico/tienda/joyeria/VideoJoyeria";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import type { VideoAmbiente } from "@/lib/catalogo/vitrina";

/* eslint-disable @typescript-eslint/no-explicit-any */
// jsdom no trae matchMedia, IntersectionObserver ni reproducción de video: se controlan desde la prueba.
let reducido = false;
let alta = false;
(window as any).matchMedia = (consulta: string) => ({
  matches: /prefers-reduced-motion:\s*reduce/.test(consulta) ? reducido : /max-aspect-ratio:\s*1\/1/.test(consulta) ? alta : false,
  media: consulta,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
});

type Observador = { cb: (entradas: unknown[]) => void; opciones: { rootMargin?: string; threshold?: number }; elementos: Element[] };
let observadores: Observador[] = [];
(globalThis as any).IntersectionObserver = class {
  private o: Observador;
  constructor(cb: Observador["cb"], opciones: Observador["opciones"] = {}) {
    this.o = { cb, opciones, elementos: [] };
    observadores.push(this.o);
  }
  observe(el: Element) {
    this.o.elementos.push(el);
  }
  unobserve() {}
  disconnect() {
    observadores = observadores.filter((x) => x !== this.o);
  }
};
/** Avisa a los observadores que los elementos están (o ya no están) dentro de la pantalla. `soloCerca`: solo al que mira con margen de 300 px (el que decide pedir el archivo). */
function mostrar(dentro: boolean, soloCerca = false) {
  act(() => {
    for (const o of [...observadores]) {
      if (soloCerca && o.opciones.rootMargin !== "300px 0px") continue;
      o.cb(o.elementos.map((target) => ({ isIntersecting: dentro, target })));
    }
  });
}

const llamadas: string[] = [];
let falla = false;
const medios = (window as any).HTMLMediaElement.prototype;
medios.play = function (this: HTMLVideoElement) {
  llamadas.push(`play ${this.getAttribute("src")}`);
  return falla ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve();
};
medios.pause = function (this: HTMLVideoElement) {
  llamadas.push(`pause ${this.getAttribute("src")}`);
};
let oculta = false;
Object.defineProperty(document, "hidden", { get: () => oculta, configurable: true });
Object.defineProperty(document, "readyState", { get: () => "complete", configurable: true });
const desplazamientos: Array<Record<string, unknown>> = [];
(window as any).scrollTo = (opciones: Record<string, unknown>) => desplazamientos.push(opciones);
const ponerScroll = (y: number) => Object.defineProperty(window, "scrollY", { value: y, configurable: true, writable: true });
/* eslint-enable @typescript-eslint/no-explicit-any */

const HERO = { image: { src: "/hero.png", width: 1600, height: 900, alt: "Foto de la portada" }, eyebrow: "Más que joyas", title: "Historias que brillan", description: "Diseños únicos", cta: "Ver catálogo", href: undefined } as Parameters<typeof PortadaJoyeria>[0]["hero"];
const VIDEO: VideoAmbiente = {
  horizontal: { src: "/video/h.mp4", poster: "/video/h.webp", width: 1280, height: 720 },
  vertical: { src: "/video/v.mp4", poster: "/video/v.webp", width: 720, height: 1280 },
  etiqueta: "Video de la colección",
};
const BASE = "/catalogo/prueba";
const LISTA = `${BASE}?todo=1`;

const portada = () => render(<PortadaJoyeria hero={HERO} listPath={LISTA} video={VIDEO} marca={{ name: "Tienda de prueba", descriptor: "Joyería" }} />);
const activa = (c: HTMLElement) => [...c.querySelectorAll(".joy-slide")].findIndex((s) => s.getAttribute("data-activa") === "true");
const videos = (c: HTMLElement) => [...c.querySelectorAll("video")];

beforeEach(() => {
  reducido = false;
  alta = false;
  falla = false;
  oculta = false;
  observadores = [];
  llamadas.length = 0;
  desplazamientos.length = 0;
  ponerScroll(0);
  document.body.innerHTML = "";
});
afterEach(() => {
  cleanup();
  mock.timers.reset();
  delete (navigator as unknown as { connection?: unknown }).connection;
});

describe("portada con video — el carrusel", () => {
  it(`cambia sola cada ${INTERVALO_PORTADA_MS / 1000} s (la referencia cambia cada 5,1 s) y da la vuelta`, () => {
    assert.equal(INTERVALO_PORTADA_MS, 5100);
    mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const { container } = portada();
    assert.equal(activa(container), 0);
    act(() => mock.timers.tick(INTERVALO_PORTADA_MS - 1));
    assert.equal(activa(container), 0);
    act(() => mock.timers.tick(1));
    assert.equal(activa(container), 1);
    act(() => mock.timers.tick(INTERVALO_PORTADA_MS));
    assert.equal(activa(container), 0);
  });

  it("solo la diapositiva activa se puede usar (la otra es inerte) y el punto activo lo dice con aria-current", () => {
    const { container, getByLabelText } = portada();
    const [primera, segunda] = [...container.querySelectorAll(".joy-slide")];
    assert.equal(primera.hasAttribute("inert"), false);
    assert.equal(segunda.hasAttribute("inert"), true);
    fireEvent.click(getByLabelText("Diapositiva siguiente"));
    assert.equal(primera.hasAttribute("inert"), true);
    assert.equal(segunda.hasAttribute("inert"), false);
    assert.equal(getByLabelText("Ir a la diapositiva 2").getAttribute("aria-current"), "true");
    assert.equal(getByLabelText("Ir a la diapositiva 1").getAttribute("aria-current"), null);
  });

  it("las flechas y los puntos cambian a mano, dan la vuelta, y reinician el temporizador (quien eligió la ve completa)", () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const { container, getByLabelText } = portada();
    act(() => mock.timers.tick(INTERVALO_PORTADA_MS - 100));
    fireEvent.click(getByLabelText("Diapositiva siguiente"));
    assert.equal(activa(container), 1);
    act(() => mock.timers.tick(INTERVALO_PORTADA_MS - 1));
    assert.equal(activa(container), 1, "el temporizador empezó de nuevo con el cambio manual");
    act(() => mock.timers.tick(1));
    assert.equal(activa(container), 0);
    fireEvent.click(getByLabelText("Diapositiva anterior"));
    assert.equal(activa(container), 1, "«anterior» desde la primera da la vuelta");
    fireEvent.click(getByLabelText("Ir a la diapositiva 1"));
    assert.equal(activa(container), 0);
  });

  it("se detiene al pasar el mouse y sigue al salir", () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const { container } = portada();
    const seccion = container.querySelector("section") as HTMLElement;
    fireEvent.mouseEnter(seccion);
    act(() => mock.timers.tick(30_000));
    assert.equal(activa(container), 0);
    fireEvent.mouseLeave(seccion);
    act(() => mock.timers.tick(INTERVALO_PORTADA_MS));
    assert.equal(activa(container), 1);
  });

  it("se detiene mientras un control tiene el foco y sigue cuando el foco sale de la portada (no cuando solo pasa de un control a otro)", () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const { container, getByLabelText } = portada();
    const siguiente = getByLabelText("Diapositiva siguiente");
    const anterior = getByLabelText("Diapositiva anterior");
    fireEvent.focus(siguiente);
    act(() => mock.timers.tick(30_000));
    assert.equal(activa(container), 0);
    fireEvent.blur(siguiente, { relatedTarget: anterior });
    act(() => mock.timers.tick(30_000));
    assert.equal(activa(container), 0, "el foco sigue dentro de la portada");
    fireEvent.blur(anterior, { relatedTarget: document.body });
    act(() => mock.timers.tick(INTERVALO_PORTADA_MS));
    assert.equal(activa(container), 1);
  });

  it("el botón de pausa detiene todo (y anuncia los cambios a quien usa lector de pantalla); «reproducir» lo reanuda", () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const { container, getByLabelText } = portada();
    const vivo = () => container.querySelector("[aria-live]")!.getAttribute("aria-live");
    assert.equal(vivo(), "off");
    fireEvent.click(getByLabelText("Pausar la presentación"));
    assert.equal(vivo(), "polite", "al no rotar sola, cada cambio manual sí se anuncia");
    act(() => mock.timers.tick(30_000));
    assert.equal(activa(container), 0);
    fireEvent.click(getByLabelText("Reproducir la presentación"));
    act(() => mock.timers.tick(INTERVALO_PORTADA_MS));
    assert.equal(activa(container), 1);
  });

  it("con «movimiento reducido» no rota sola y el botón dice «Reproducir»; si el visitante lo pulsa, entonces sí", () => {
    reducido = true;
    mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const { container, getByLabelText } = portada();
    act(() => mock.timers.tick(60_000));
    assert.equal(activa(container), 0);
    fireEvent.click(getByLabelText("Reproducir la presentación"));
    act(() => mock.timers.tick(INTERVALO_PORTADA_MS));
    assert.equal(activa(container), 1);
  });

  it("con «ahorro de datos» tampoco rota sola", () => {
    (navigator as unknown as { connection: unknown }).connection = { saveData: true };
    mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const { container, getByLabelText } = portada();
    act(() => mock.timers.tick(60_000));
    assert.equal(activa(container), 0);
    assert.ok(getByLabelText("Reproducir la presentación"));
  });

  it("deja de moverse cuando el contenido que sube sobre la portada la tapó por completo, y vuelve al subir", async () => {
    const { container } = portada();
    mostrar(true);
    assert.ok(llamadas.includes("play /video/h.mp4"));
    ponerScroll(5000);
    fireEvent.scroll(window);
    await waitFor(() => assert.equal(llamadas.at(-1), "pause /video/h.mp4"));
    ponerScroll(0);
    fireEvent.scroll(window);
    await waitFor(() => assert.equal(llamadas.at(-1), "play /video/h.mp4"));
    assert.equal(activa(container), 0);
  });
});

describe("portada con video — lectores de pantalla y teclado", () => {
  it("el h1 de la página está fuera de las diapositivas: sigue ahí aunque la diapositiva 1 esté oculta", () => {
    const { container, getByLabelText } = portada();
    const h1 = container.querySelector("h1") as HTMLElement;
    assert.equal(h1.textContent, "Historias que brillan");
    assert.equal(Boolean(h1.closest(".joy-slide")), false);
    fireEvent.click(getByLabelText("Diapositiva siguiente"));
    assert.equal(container.querySelector(".joy-slide")?.hasAttribute("inert"), true, "la diapositiva 1 está oculta");
    assert.equal(Boolean(h1.closest("[inert]")), false, "pero el h1 no es inerte");
  });

  it("cuando el contenido que sube sobre la portada la tapa por completo, sus controles dejan de poder enfocarse; al volver a verla, vuelven", async () => {
    const { container } = portada();
    // (se comparan booleanos: si una aserción falla con un elemento de jsdom, node intenta mostrarlo entero y se queda sin memoria)
    const inerte = () => Boolean(container.querySelector(".joy-portada-flecha")?.closest("[inert]"));
    assert.equal(inerte(), false);
    ponerScroll(5000);
    fireEvent.scroll(window);
    await waitFor(() => assert.equal(inerte(), true, "inerte mientras está tapada"));
    assert.equal(Boolean((container.querySelector("h1") as HTMLElement).closest("[inert]")), false, "el título de la página sigue disponible");
    ponerScroll(0);
    fireEvent.scroll(window);
    await waitFor(() => assert.equal(inerte(), false, "vuelve a poder usarse"));
  });
});

describe("portada con video — el video", () => {
  it("la portada pide el archivo cuando la página terminó de cargar (no antes) y solo lo reproduce cuando se ve", () => {
    const { container } = portada();
    assert.deepEqual(videos(container).map((v) => v.getAttribute("src")), ["/video/h.mp4"]);
    assert.ok(!llamadas.some((l) => l.startsWith("play")), "todavía no se ve: no corre");
    mostrar(true);
    assert.equal(llamadas.at(-1), "play /video/h.mp4");
  });

  it("pide el archivo vertical en pantallas más altas que anchas y nunca los dos", () => {
    alta = true;
    const { container } = portada();
    assert.deepEqual(videos(container).map((v) => v.getAttribute("src")), ["/video/v.mp4"]);
  });

  it("solo corre en la diapositiva activa: al pasar a la de la foto se pausa y al volver sigue", () => {
    const { getByLabelText } = portada();
    mostrar(true);
    fireEvent.click(getByLabelText("Diapositiva siguiente"));
    assert.equal(llamadas.at(-1), "pause /video/h.mp4");
    fireEvent.click(getByLabelText("Diapositiva anterior"));
    assert.equal(llamadas.at(-1), "play /video/h.mp4");
  });

  it("se pausa al salir de la pantalla y al cambiar de pestaña", () => {
    portada();
    mostrar(true);
    mostrar(false);
    assert.equal(llamadas.at(-1), "pause /video/h.mp4");
    mostrar(true);
    assert.equal(llamadas.at(-1), "play /video/h.mp4");
    act(() => {
      oculta = true;
      document.dispatchEvent(new window.Event("visibilitychange"));
    });
    assert.equal(llamadas.at(-1), "pause /video/h.mp4");
    act(() => {
      oculta = false;
      document.dispatchEvent(new window.Event("visibilitychange"));
    });
    assert.equal(llamadas.at(-1), "play /video/h.mp4");
  });

  it("con «movimiento reducido» no se pide ni se reproduce nada; el botón de pausa/reproducción empieza el video si el visitante quiere", () => {
    reducido = true;
    const { container, getByLabelText } = portada();
    mostrar(true);
    assert.equal(videos(container).length, 0, "ni siquiera se pide el archivo");
    assert.equal(llamadas.length, 0, "ni se intenta reproducir ni pausar nada");
    fireEvent.click(getByLabelText("Reproducir la presentación"));
    assert.equal(videos(container).length, 1);
    mostrar(true);
    assert.ok(llamadas.includes("play /video/h.mp4"));
  });

  it("si el navegador no deja arrancarlo, el botón queda en «Reproducir» (no finge que corre)", async () => {
    falla = true;
    const { getByLabelText } = portada();
    mostrar(true);
    await waitFor(() => assert.ok(getByLabelText("Reproducir la presentación")));
  });

  it("el video está silenciado, en bucle, en línea y sin controles propios ni foco (es un adorno; el botón de la portada es el control)", () => {
    const { container } = portada();
    const v = videos(container)[0];
    assert.equal(v.muted, true);
    assert.equal(v.loop, true);
    assert.equal(v.hasAttribute("playsinline") || (v as unknown as { playsInline: boolean }).playsInline, true);
    assert.equal(v.hasAttribute("controls"), false);
    assert.equal(v.getAttribute("tabindex"), "-1");
    assert.equal(v.closest(".joy-video")?.getAttribute("aria-hidden"), "true");
  });

  it("la imagen fija se funde con el video solo cuando este ya está corriendo (antes se ve la imagen)", () => {
    const { container } = portada();
    const caja = container.querySelector(".joy-video") as HTMLElement;
    assert.equal(caja.dataset.listo, "false");
    mostrar(true);
    fireEvent(videos(container)[0], new window.Event("playing"));
    assert.equal(caja.dataset.listo, "true");
  });
});

describe("video de un bloque (colección, marca y mayoristas)", () => {
  const bloque = () =>
    render(
      <section className="relative">
        <VideoSeccion video={VIDEO} control="pildora" />
      </section>,
    );

  it("no pide el archivo hasta acercarse a la pantalla, y solo corre mientras se ve", () => {
    const { container } = bloque();
    assert.equal(videos(container).length, 0);
    mostrar(true, true);
    assert.deepEqual(videos(container).map((v) => v.getAttribute("src")), ["/video/h.mp4"]);
    assert.ok(!llamadas.some((l) => l.startsWith("play")), "cerca pero todavía no se ve");
    mostrar(true);
    assert.equal(llamadas.at(-1), "play /video/h.mp4");
    mostrar(false);
    assert.equal(llamadas.at(-1), "pause /video/h.mp4");
  });

  it("el botón pausa y reanuda, y su nombre dice qué video es", () => {
    const { container, getByLabelText } = bloque();
    mostrar(true);
    fireEvent.click(getByLabelText("Pausar video de la colección"));
    assert.equal(llamadas.at(-1), "pause /video/h.mp4");
    assert.ok(container.querySelector('[aria-label="Reproducir video de la colección"]'));
    fireEvent.click(getByLabelText("Reproducir video de la colección"));
    assert.equal(llamadas.at(-1), "play /video/h.mp4");
  });

  it("con «movimiento reducido» o «ahorro de datos» queda la imagen fija; el botón lo inicia", () => {
    for (const preparar of [() => (reducido = true), () => ((navigator as unknown as { connection: unknown }).connection = { saveData: true })]) {
      cleanup();
      reducido = false;
      delete (navigator as unknown as { connection?: unknown }).connection;
      llamadas.length = 0;
      preparar();
      const { container, getByLabelText } = bloque();
      mostrar(true);
      assert.equal(videos(container).length, 0);
      fireEvent.click(getByLabelText("Reproducir video de la colección"));
      assert.equal(videos(container).length, 1);
      assert.ok(llamadas.includes("play /video/h.mp4"));
    }
  });

  it("si el navegador no deja arrancarlo (por ejemplo, ahorro de batería), el botón queda en «Reproducir»", async () => {
    falla = true;
    const { getByLabelText } = bloque();
    mostrar(true);
    await waitFor(() => assert.ok(getByLabelText("Reproducir video de la colección")));
  });
});

describe("botones flotantes", () => {
  it("«Volver arriba» aparece al pasar la primera pantalla y media, sube con suavidad (sin animación con «movimiento reducido») y solo entonces se puede enfocar", async () => {
    const { getByLabelText } = render(<FlotantesJoyeria whatsapp="573001112233" />);
    const arriba = getByLabelText("Volver arriba");
    assert.equal(arriba.getAttribute("data-visible"), "false");
    assert.equal(arriba.getAttribute("tabindex"), "-1");
    ponerScroll(window.innerHeight * 1.6);
    fireEvent.scroll(window);
    await waitFor(() => assert.equal(arriba.getAttribute("data-visible"), "true"));
    assert.equal(arriba.getAttribute("tabindex"), "0");
    fireEvent.click(arriba);
    assert.deepEqual(desplazamientos.at(-1), { top: 0, behavior: "smooth" });
    reducido = true;
    cleanup();
    const otra = render(<FlotantesJoyeria whatsapp="573001112233" />);
    fireEvent.click(otra.getByLabelText("Volver arriba"));
    assert.deepEqual(desplazamientos.at(-1), { top: 0, behavior: "auto" });
  });

  it("WhatsApp lleva al número del negocio en pestaña nueva y sin enviar el origen; sin un número válido no hay botón", () => {
    const con = render(<FlotantesJoyeria whatsapp="+57 300 111 2233" />);
    const enlace = con.getByLabelText("Escríbenos por WhatsApp") as HTMLAnchorElement;
    assert.equal(enlace.getAttribute("href"), "https://wa.me/573001112233");
    assert.equal(enlace.getAttribute("target"), "_blank");
    assert.equal(enlace.getAttribute("rel"), "noopener noreferrer");
    con.unmount();
    const sin = render(<FlotantesJoyeria whatsapp="123" />);
    assert.equal(sin.queryByLabelText("Escríbenos por WhatsApp"), null);
    assert.ok(sin.getByLabelText("Volver arriba"));
  });
});

describe("cromo joyería — dónde empieza lo claro", () => {
  const routerFalso = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as never;
  const cromo = () =>
    render(
      <AppRouterContext.Provider value={routerFalso}>
        <PathnameContext.Provider value={BASE}>
          <SearchParamsContext.Provider value={new URLSearchParams("") as never}>
            <TiendaProvider slug="joy-claro" context="retail" basePath={BASE} whatsapp="573001112233">
              <CromoJoyeria marca={{ name: "Tienda de prueba", descriptor: "Joyería" }} basePath={BASE} listPath={LISTA} categorias={[]} categoriasHref={`${BASE}#categorias`} anuncios={[]} mayorista />
            </TiendaProvider>
          </SearchParamsContext.Provider>
        </PathnameContext.Provider>
      </AppRouterContext.Provider>,
    );
  /** Pone (o quita) un marcador a `top` px del borde de la pantalla (jsdom no calcula posiciones). */
  function marcador(atributo: "data-joy-cortina" | "data-joy-claro", top: number | null) {
    document.querySelectorAll(`[${atributo}]`).forEach((e) => e.remove());
    if (top === null) return;
    const el = document.createElement("div");
    el.setAttribute(atributo, "");
    el.getBoundingClientRect = () => ({ top, bottom: top + 100, left: 0, right: 0, width: 0, height: 100, x: 0, y: top, toJSON() {} }) as DOMRect;
    document.body.appendChild(el);
  }

  it("con el video de la colección, el cromo sigue transparente mientras la cortina sube y solo se vuelve vidrio cuando llega lo claro", async () => {
    marcador("data-joy-cortina", 0); // la cortina (donde empieza el video de la colección) ya está arriba…
    marcador("data-joy-claro", 900); // …pero lo claro todavía queda lejos
    const { container } = cromo();
    const raiz = () => container.querySelector(".joy-cromo") as HTMLElement;
    await waitFor(() => assert.equal(raiz().dataset.estado, "hero"));
    marcador("data-joy-claro", 0);
    fireEvent.scroll(window);
    await waitFor(() => assert.equal(raiz().dataset.estado, "vidrio"));
    marcador("data-joy-claro", 900);
    fireEvent.scroll(window);
    await waitFor(() => assert.equal(raiz().dataset.estado, "hero"));
  });

  it("sin marcador de lo claro manda la cortina, como siempre", async () => {
    marcador("data-joy-claro", null);
    marcador("data-joy-cortina", 900);
    const { container } = cromo();
    const raiz = () => container.querySelector(".joy-cromo") as HTMLElement;
    await waitFor(() => assert.equal(raiz().dataset.estado, "hero"));
    marcador("data-joy-cortina", 0);
    fireEvent.scroll(window);
    await waitFor(() => assert.equal(raiz().dataset.estado, "vidrio"));
  });
});
