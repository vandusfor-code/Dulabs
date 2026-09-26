// DuLabs Business — Business Agent 2.0, FASE 2 — fusión de slots entre turnos.
//
// Regla J: "no mencionado" NO es "borrado". Un slot conocido que el mensaje actual no menciona se conserva tal cual.
// Solo una corrección EXPLÍCITA reemplaza un valor conocido; un valor distinto sin corrección (conflict) tampoco lo
// reemplaza: queda como ambigüedad para que el backend pregunte (FASE 3). Función pura: no persiste nada.

import type { StructuredUnderstanding } from "@/lib/agent-compiler/understanding/contract";
import { slotDisplayValue } from "@/lib/agent-compiler/understanding/validate";

export interface SlotMergeResult {
  slots: Record<string, string>;
  added: string[];
  corrected: string[];
  /** Conocidos que el mensaje no mencionó (se conservan). */
  untouched: string[];
  /** Mencionados que NO se aplicaron (conflicto o valor no resuelto). */
  notApplied: Array<{ name: string; reason: "conflict" | "not_resolved" }>;
}

export function mergeUnderstoodSlots(known: Readonly<Record<string, string>>, understanding: Pick<StructuredUnderstanding, "slots">): SlotMergeResult {
  const slots: Record<string, string> = { ...known };
  const added: string[] = [];
  const corrected: string[] = [];
  const notApplied: SlotMergeResult["notApplied"] = [];

  for (const slot of Object.values(understanding.slots)) {
    if (slot.status !== "resolved" || !slot.value) {
      notApplied.push({ name: slot.name, reason: "not_resolved" });
      continue;
    }
    if (slot.change === "conflict") {
      notApplied.push({ name: slot.name, reason: "conflict" });
      continue;
    }
    const display = slotDisplayValue(slot.value);
    if (slot.change === "new") {
      slots[slot.name] = display;
      added.push(slot.name);
    } else if (slot.change === "corrected") {
      slots[slot.name] = display;
      corrected.push(slot.name);
    }
    // "restated": el valor conocido se conserva.
  }

  const mentioned = new Set(Object.keys(understanding.slots));
  return { slots, added, corrected, untouched: Object.keys(known).filter((k) => !mentioned.has(k)), notApplied };
}
