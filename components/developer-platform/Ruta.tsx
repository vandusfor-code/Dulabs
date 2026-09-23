"use client";

import type { ReactNode } from "react";
import { estadoNodo } from "./motion";

// DuLabs Developer -- primitiva de ruta vertical: nodos unidos por un rail, un paquete que viaja entre ellos y el tramo recorrido que
// queda confirmado. Es el mismo lenguaje del hero (pulso de llegada, micro-estado por nodo) y lo usan las visualizaciones de
// capacidades. Solo transform/opacity; el estado lo decide quien la usa (`actual`).
//   actual = i            -> el paquete está en el nodo i (activo); los anteriores, confirmados
//   actual >= nodos.length -> todo confirmado, sin paquete (reposo / reduced motion)
//   actual = -1           -> reinicio (sin transiciones, todo pendiente)

export type Tono = "ok" | "warn" | "danger";
export type NodoRuta = { k: ReactNode; sub?: ReactNode; chip?: ReactNode; tono?: Tono; etiqueta?: string };

export function Ruta({ nodos, actual, alto = 44, compacta = false }: { nodos: NodoRuta[]; actual: number; alto?: number; compacta?: boolean }) {
  const n = nodos.length;
  const reinicio = actual < 0;
  const pos = reinicio ? 0 : Math.min(actual, n - 1);
  const visible = actual >= 0 && actual < n;
  const progreso = reinicio ? 0 : Math.min(actual, n - 1) / (n - 1);
  return (
    <div data-viaje="" {...(reinicio ? { "data-reinicio": "" } : {})} className="dp-flujo relative">
      <div aria-hidden className="absolute left-[4px] z-10 w-px bg-dp-border" style={{ top: alto / 2, height: (n - 1) * alto }}>
        <div className="dp-recorrido-y absolute inset-0 bg-dp-text-2" style={{ transform: `scaleY(${progreso})` }} />
        <div className="dp-paquete-y" style={{ transform: `translateY(${(pos / (n - 1)) * 100}%)`, opacity: visible ? 1 : 0 }}>
          <span className="dp-paquete-punto absolute left-0 top-0 block h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-dp-signal" />
        </div>
      </div>
      <ol>
        {nodos.map((nodo, i) => {
          const estado = estadoNodo(i, actual);
          return (
            <li
              key={i}
              data-estado={estado}
              {...(nodo.tono && estado !== "pendiente" ? { "data-tono": nodo.tono } : {})}
              className="relative flex items-center gap-3"
              style={{ height: alto }}
            >
              <span className="dp-nodo-punto z-20 flex-none" />
              {nodo.etiqueta ? (
                <span className={`flex-none font-mono text-[9.5px] uppercase tracking-[0.14em] text-dp-muted ${compacta ? "w-16" : "w-[84px]"}`}>{nodo.etiqueta}</span>
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="dp-nodo-nombre block truncate font-mono text-[12.5px]">{nodo.k}</span>
                {nodo.sub ? <span className="block truncate font-mono text-[10.5px] text-dp-muted">{nodo.sub}</span> : null}
              </span>
              {nodo.chip ? <span className="dp-chip flex-none font-mono text-[10px] uppercase tracking-[0.1em]">{nodo.chip}</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
