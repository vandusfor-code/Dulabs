"use client";

import { useEffect, useRef, useState } from "react";

// DuLabs Developer -- motion de la landing. Un solo mecanismo (IntersectionObserver) decide cuándo un bloque está en pantalla:
//   - data-activo: el bloque está visible -> sus animaciones continuas corren (CSS: .dp [data-bloque][data-activo] .dp-anim).
//   - data-visto:  el bloque ya se vio una vez -> las secuencias de una sola vez quedan en su estado final.
// Nada escucha scroll; fuera de pantalla todo queda en pausa.

export function useBloque<T extends HTMLElement>(opciones: { umbral?: number } = {}) {
  const ref = useRef<T>(null);
  const [activo, setActivo] = useState(false);
  const [visto, setVisto] = useState(false);
  const umbral = opciones.umbral ?? 0.25;

  useEffect(() => {
    const nodo = ref.current;
    if (!nodo) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        setActivo(e.isIntersecting);
        if (e.isIntersecting) setVisto(true);
      },
      { threshold: umbral },
    );
    obs.observe(nodo);
    return () => obs.disconnect();
  }, [umbral]);

  const atributos = { "data-bloque": "", ...(activo ? { "data-activo": "" } : {}), ...(visto ? { "data-visto": "" } : {}) };
  return { ref, activo, visto, atributos };
}

/** prefers-reduced-motion en vivo (cambia si el usuario lo cambia con la página abierta). */
export function useMenosMovimiento(): boolean {
  const [menos, setMenos] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const leer = () => setMenos(mq.matches);
    leer();
    mq.addEventListener("change", leer);
    return () => mq.removeEventListener("change", leer);
  }, []);
  return menos;
}

/** Un intervalo que solo corre mientras `activo` sea true (y nunca con movimiento reducido). */
export function useTic(activo: boolean, ms: number, alTic: () => void) {
  const cb = useRef(alTic);
  useEffect(() => {
    cb.current = alTic;
  });
  useEffect(() => {
    if (!activo) return;
    const id = window.setInterval(() => cb.current(), ms);
    return () => window.clearInterval(id);
  }, [activo, ms]);
}
