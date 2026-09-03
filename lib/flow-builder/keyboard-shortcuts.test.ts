import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isEditableTarget, matchShortcut, resolveShortcut } from "@/lib/flow-builder/keyboard-shortcuts";

function key(k: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) {
  return { key: k, ctrlKey: mods.ctrl ?? false, metaKey: mods.meta ?? false, shiftKey: mods.shift ?? false };
}

function fakeInput(): EventTarget {
  return { tagName: "INPUT", isContentEditable: false } as unknown as EventTarget;
}

function fakeDiv(contentEditable = false): EventTarget {
  return { tagName: "DIV", isContentEditable: contentEditable } as unknown as EventTarget;
}

describe("isEditableTarget", () => {
  it("true para INPUT/TEXTAREA/SELECT", () => {
    assert.equal(isEditableTarget(fakeInput()), true);
  });

  it("true para contenteditable", () => {
    assert.equal(isEditableTarget(fakeDiv(true)), true);
  });

  it("false para un div normal", () => {
    assert.equal(isEditableTarget(fakeDiv(false)), false);
  });

  it("false para null / algo que no es HTMLElement", () => {
    assert.equal(isEditableTarget(null), false);
  });
});

describe("matchShortcut", () => {
  it("Ctrl/Cmd+Z -> undo", () => {
    assert.equal(matchShortcut(key("z", { ctrl: true })), "undo");
    assert.equal(matchShortcut(key("z", { meta: true })), "undo");
  });

  it("Ctrl/Cmd+Shift+Z -> redo", () => {
    assert.equal(matchShortcut(key("z", { ctrl: true, shift: true })), "redo");
  });

  it("Ctrl/Cmd+Y -> redo (atajo alternativo)", () => {
    assert.equal(matchShortcut(key("y", { ctrl: true })), "redo");
  });

  it("Ctrl+C -> copy, Ctrl+V -> paste, Ctrl+D -> duplicate, Ctrl+A -> selectAll", () => {
    assert.equal(matchShortcut(key("c", { ctrl: true })), "copy");
    assert.equal(matchShortcut(key("v", { ctrl: true })), "paste");
    assert.equal(matchShortcut(key("d", { ctrl: true })), "duplicate");
    assert.equal(matchShortcut(key("a", { ctrl: true })), "selectAll");
  });

  it("Escape -> escape, sin necesitar Ctrl/Cmd", () => {
    assert.equal(matchShortcut(key("Escape")), "escape");
  });

  it("F sin modificador -> fitView", () => {
    assert.equal(matchShortcut(key("f")), "fitView");
  });

  it("Ctrl+F -> find (distinto de F solo)", () => {
    assert.equal(matchShortcut(key("f", { ctrl: true })), "find");
  });

  it("una letra sin modificador que no es 'f' no es ningún atajo", () => {
    assert.equal(matchShortcut(key("h")), null);
  });

  it("Ctrl + una tecla no mapeada devuelve null", () => {
    assert.equal(matchShortcut(key("k", { ctrl: true })), null);
  });

  it("es insensible a mayúsculas en la tecla", () => {
    assert.equal(matchShortcut(key("Z", { ctrl: true })), "undo");
  });
});

describe("resolveShortcut — respeta campos editables", () => {
  it("NO intercepta Ctrl+C dentro de un input -- debe copiar el texto seleccionado, no la selección del canvas", () => {
    assert.equal(resolveShortcut(key("c", { ctrl: true }), fakeInput()), null);
  });

  it("NO intercepta Ctrl+V/Ctrl+D/Ctrl+A/Ctrl+Z dentro de un input", () => {
    assert.equal(resolveShortcut(key("v", { ctrl: true }), fakeInput()), null);
    assert.equal(resolveShortcut(key("d", { ctrl: true }), fakeInput()), null);
    assert.equal(resolveShortcut(key("a", { ctrl: true }), fakeInput()), null);
    assert.equal(resolveShortcut(key("z", { ctrl: true }), fakeInput()), null);
  });

  it("NO intercepta dentro de un contenteditable", () => {
    assert.equal(resolveShortcut(key("c", { ctrl: true }), fakeDiv(true)), null);
  });

  it("Escape SÍ funciona incluso dentro de un input (cerrar paneles/menús)", () => {
    assert.equal(resolveShortcut(key("Escape"), fakeInput()), "escape");
  });

  it("fuera de un campo editable, los atajos funcionan con normalidad", () => {
    assert.equal(resolveShortcut(key("c", { ctrl: true }), fakeDiv(false)), "copy");
    assert.equal(resolveShortcut(key("z", { ctrl: true }), null), "undo");
  });
});
