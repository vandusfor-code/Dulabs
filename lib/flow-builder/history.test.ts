import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canRedo, canUndo, createHistory, pushHistory, redo, resetHistory, undo } from "@/lib/flow-builder/history";

describe("history — createHistory/pushHistory", () => {
  it("createHistory arranca sin pasado ni futuro", () => {
    const h = createHistory("a");
    assert.equal(h.present, "a");
    assert.equal(canUndo(h), false);
    assert.equal(canRedo(h), false);
  });

  it("pushHistory mueve el presente anterior al pasado", () => {
    const h1 = createHistory("a");
    const h2 = pushHistory(h1, "b");
    assert.equal(h2.present, "b");
    assert.deepEqual(h2.past, ["a"]);
    assert.equal(canUndo(h2), true);
  });

  it("pushHistory con next === present no hace nada (no-op nunca ensucia el historial)", () => {
    const h1 = createHistory("a");
    const h2 = pushHistory(h1, "a");
    assert.equal(h2, h1);
  });

  it("pushHistory limpia el futuro -- una edición nueva descarta cualquier redo pendiente", () => {
    let h = createHistory("a");
    h = pushHistory(h, "b");
    h = pushHistory(h, "c");
    h = undo(h);
    assert.equal(canRedo(h), true);
    h = pushHistory(h, "d");
    assert.equal(canRedo(h), false);
    assert.equal(h.present, "d");
  });

  it("respeta maxEntries -- descarta el paso más antiguo, nunca crece sin límite (flows grandes)", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 5; i++) h = pushHistory(h, i, null, 3);
    assert.equal(h.past.length, 3);
    assert.deepEqual(h.past, [2, 3, 4]);
    assert.equal(h.present, 5);
  });
});

describe("history — undo/redo", () => {
  it("undo/redo son simétricos", () => {
    let h = createHistory("a");
    h = pushHistory(h, "b");
    h = pushHistory(h, "c");
    h = undo(h);
    assert.equal(h.present, "b");
    h = undo(h);
    assert.equal(h.present, "a");
    h = redo(h);
    assert.equal(h.present, "b");
    h = redo(h);
    assert.equal(h.present, "c");
  });

  it("undo sin pasado no lanza y devuelve el mismo historial", () => {
    const h = createHistory("a");
    const h2 = undo(h);
    assert.equal(h2, h);
  });

  it("redo sin futuro no lanza y devuelve el mismo historial", () => {
    const h = createHistory("a");
    const h2 = redo(h);
    assert.equal(h2, h);
  });

  it("deshacer hasta el principio vuelve exactamente a la referencia original (permite detectar 'sin cambios')", () => {
    const original = { v: 0 };
    let h = createHistory(original);
    h = pushHistory(h, { v: 1 });
    h = undo(h);
    assert.equal(h.present, original);
  });
});

describe("history — coalescing por group (edición continua de un campo)", () => {
  it("pushes consecutivos con el MISMO group se fusionan en un solo paso de undo", () => {
    let h = createHistory("");
    h = pushHistory(h, "H", "node:n1");
    h = pushHistory(h, "Ho", "node:n1");
    h = pushHistory(h, "Hol", "node:n1");
    h = pushHistory(h, "Hola", "node:n1");
    assert.equal(h.present, "Hola");
    assert.equal(h.past.length, 1, "las 4 pulsaciones son UN solo paso de undo");
    h = undo(h);
    assert.equal(h.present, "", "un solo undo vuelve al estado previo a TODA la sesión de escritura");
  });

  it("cambiar de group (ej. seleccionar otro nodo) rompe la fusión -- nuevo paso de undo", () => {
    let h = createHistory("");
    h = pushHistory(h, "Hola", "node:n1");
    h = pushHistory(h, "Mundo", "node:n2");
    assert.equal(h.past.length, 2);
    h = undo(h);
    assert.equal(h.present, "Hola");
  });

  it("group=null NUNCA se fusiona, ni con otro null seguido -- cada op discreta es su propio paso", () => {
    let h = createHistory("a");
    h = pushHistory(h, "b", null);
    h = pushHistory(h, "c", null);
    assert.equal(h.past.length, 2, "agregar nodo + eliminar nodo son 2 pasos de undo, no 1");
  });

  it("un push sin group (discreto) interrumpe una sesión de coalescing en curso", () => {
    let h = createHistory("");
    h = pushHistory(h, "Hola", "node:n1");
    h = pushHistory(h, "Hola!", "node:n1");
    h = pushHistory(h, "estructura-nueva", null); // ej. agregar un nodo
    h = pushHistory(h, "Hola! más", "node:n1"); // seguir editando texto
    assert.equal(h.past.length, 3, "escritura + operación discreta + escritura = 3 pasos, sin fusionar entre sí");
  });

  it("tras un undo/redo, lastGroup se resetea -- seguir escribiendo no se fusiona con lo ya deshecho", () => {
    let h = createHistory("");
    h = pushHistory(h, "Hola", "node:n1");
    h = undo(h);
    h = pushHistory(h, "Chao", "node:n1");
    assert.equal(h.past.length, 1);
    assert.equal(canRedo(h), false, "escribir de nuevo descarta el redo, no lo reemplaza silenciosamente");
  });
});

describe("history — resetHistory", () => {
  it("reinicia sin pasado ni futuro al valor dado -- usado al cargar un flow distinto", () => {
    let h = createHistory("a");
    h = pushHistory(h, "b");
    h = resetHistory("z");
    assert.equal(h.present, "z");
    assert.equal(canUndo(h), false);
    assert.equal(canRedo(h), false);
  });
});
