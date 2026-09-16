// DuLabs Developer V1 -- Fase 9 (autorizado, D6). Setup de entorno DOM
// (jsdom) para los tests de UI con Testing Library, AISLADO: solo lo importan
// los *.dom.test.tsx del Dashboard. node:test corre cada archivo en su propio
// proceso, así que estos globals nunca contaminan la suite de backend.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const w = dom.window as any;

function definir(clave: string, valor: unknown) {
  try {
    g[clave] = valor;
  } catch {
    try {
      Object.defineProperty(g, clave, { value: valor, configurable: true, writable: true });
    } catch {
      /* algunos globals son de solo lectura -- se ignora */
    }
  }
}

definir("window", w);
definir("document", w.document);
definir("navigator", w.navigator);
definir("HTMLElement", w.HTMLElement);
definir("Node", w.Node);
definir("getComputedStyle", w.getComputedStyle.bind(w));
definir("Event", w.Event);
definir("CustomEvent", w.CustomEvent);
definir("KeyboardEvent", w.KeyboardEvent);
definir("MouseEvent", w.MouseEvent);
definir("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
definir("cancelAnimationFrame", (id: number) => clearTimeout(id));

// Copia el resto de propiedades del window que aún no existan en globalThis.
for (const key of Object.getOwnPropertyNames(w)) {
  if (!(key in g)) definir(key, w[key]);
}

// React 19 exige marcar el entorno de act() para tests.
g.IS_REACT_ACT_ENVIRONMENT = true;
/* eslint-enable @typescript-eslint/no-explicit-any */
