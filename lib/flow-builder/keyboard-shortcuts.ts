/**
 * Professional Flow Editor UX (autorizado) — capa CENTRALIZADA de atajos de
 * teclado del editor. Un único listener (useFlowKeyboardShortcuts), en vez
 * de listeners independientes repartidos por componentes.
 *
 * `matchShortcut` e `isEditableTarget` son puras (testeables sin React); el
 * hook es la única parte que toca el DOM/React, y es deliberadamente un
 * envoltorio delgado sobre esas dos funciones.
 *
 * Requisito explícito: nunca interceptar un atajo mientras el usuario
 * escribe en un input/textarea/select/contenteditable (ej. Ctrl+C dentro de
 * un campo de texto del FlowInfoPanel debe copiar el TEXTO seleccionado, no
 * la selección de nodos del canvas) -- excepto Escape, que es inofensivo
 * dentro de un campo de texto y útil para cerrar paneles/menús.
 */

export type FlowShortcutAction =
  | "undo"
  | "redo"
  | "copy"
  | "paste"
  | "duplicate"
  | "selectAll"
  | "escape"
  | "find"
  | "fitView";

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * true si el foco actual está en un campo editable -- ahí nunca se
 * interceptan atajos (salvo Escape, ver matchShortcut). Duck-typed a
 * propósito (en vez de `instanceof HTMLElement`) para ser testeable sin DOM
 * real, y funciona igual con un EventTarget de navegador de verdad.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  return typeof el.tagName === "string" && EDITABLE_TAGS.has(el.tagName);
}

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * Resuelve un evento de teclado a una acción del editor, o `null` si no
 * corresponde a ningún atajo conocido (el caller debe entonces dejar que el
 * navegador/el DOM manejen la tecla con normalidad, nunca hacer
 * preventDefault). Ctrl y Cmd se tratan como equivalentes a propósito
 * (mismo criterio que el resto del pedido: "Ctrl/Cmd").
 */
export function matchShortcut(event: KeyLike): FlowShortcutAction | null {
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();

  if (key === "escape") return "escape";

  if (!mod) {
    if (key === "f") return "fitView";
    return null;
  }

  if (key === "z" && event.shiftKey) return "redo";
  if (key === "z") return "undo";
  if (key === "y") return "redo";
  if (key === "c") return "copy";
  if (key === "v") return "paste";
  if (key === "d") return "duplicate";
  if (key === "a") return "selectAll";
  if (key === "f") return "find";

  return null;
}

/** Acciones que tienen sentido incluso con el foco en un campo editable (nunca interfieren con escribir). */
const ALWAYS_ALLOWED: ReadonlySet<FlowShortcutAction> = new Set(["escape"]);

export function resolveShortcut(event: KeyLike, target: EventTarget | null): FlowShortcutAction | null {
  const action = matchShortcut(event);
  if (!action) return null;
  if (isEditableTarget(target) && !ALWAYS_ALLOWED.has(action)) return null;
  return action;
}

// ---------------------------------------------------------------------------
// Hook — única parte de este archivo que toca React/el DOM. Deliberadamente
// delgado: solo despacha a `resolveShortcut` y llama el handler correspondiente
// (vía un ref, para no tener que reinstalar el listener en cada render).
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";

export type FlowShortcutHandlers = Partial<Record<FlowShortcutAction, () => void>>;

export function useFlowKeyboardShortcuts(handlers: FlowShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const action = resolveShortcut(event, event.target);
      if (!action) return;
      const handler = handlersRef.current[action];
      if (!handler) return;
      event.preventDefault();
      handler();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
