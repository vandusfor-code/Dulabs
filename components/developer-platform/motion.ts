"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

/** true desde `min-width: 1024px` (en vivo). */
export function useEscritorio(): boolean {
  const [si, setSi] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const leer = () => setSi(mq.matches);
    leer();
    mq.addEventListener("change", leer);
    return () => mq.removeEventListener("change", leer);
  }, []);
  return si;
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

/** Duraciones del sistema de motion (espejo de los tokens CSS de .dp, para las secuencias en JS). */
export const MOTION = {
  rapido: 160,
  estandar: 280,
  sistema: 640,
} as const;

/**
 * Secuencia de producto: avanza por `pasos` (duración en ms de cada paso) mientras `activo` sea true y se detiene fuera de pantalla
 * (conserva el paso en el que iba). Al terminar vuelve a `bucleDesde` y suma una `vuelta` (para rotar escenarios o IDs de ejemplo).
 * Con prefers-reduced-motion no corre ningún temporizador: devuelve `pasoEstatico` (el estado final, comprensible sin movimiento).
 * `pasos` debe ser estable (constante de módulo).
 */
export function useSecuencia(pasos: readonly number[], opciones: { activo: boolean; bucle?: boolean; bucleDesde?: number; pasoEstatico?: number }) {
  const { activo, bucle = true, bucleDesde = 0 } = opciones;
  const menos = useMenosMovimiento();
  const [estado, setEstado] = useState({ paso: 0, vuelta: 0 });
  const ultimo = pasos.length - 1;

  useEffect(() => {
    if (!activo || menos) return;
    if (!bucle && estado.paso >= ultimo) return;
    const id = window.setTimeout(() => {
      setEstado((s) => (s.paso >= ultimo ? { paso: bucleDesde, vuelta: s.vuelta + 1 } : { paso: s.paso + 1, vuelta: s.vuelta }));
    }, pasos[estado.paso] ?? 0);
    return () => window.clearTimeout(id);
  }, [activo, menos, bucle, bucleDesde, ultimo, pasos, estado]);

  /** Reinicia la secuencia desde `desde` (p. ej. el botón «Ejecutar» de la consola). */
  const reiniciar = useCallback((desde = 0) => setEstado((s) => ({ paso: desde, vuelta: s.vuelta + 1 })), []);

  return { paso: menos ? (opciones.pasoEstatico ?? ultimo) : estado.paso, vuelta: estado.vuelta, estatico: menos, reiniciar };
}

/** Estado de un nodo i dado el nodo en el que está el evento (`actual`): lo anterior queda confirmado, lo siguiente pendiente. */
export function estadoNodo(i: number, actual: number): "pendiente" | "activo" | "hecho" {
  return i < actual ? "hecho" : i === actual ? "activo" : "pendiente";
}

/** Hex determinista (IDs de ejemplo que cambian por vuelta sin Math.random: el render es estable entre servidor y cliente). */
export function hexDe(semilla: number, largo: number): string {
  let x = Math.imul(semilla + 1, 2654435761) >>> 0;
  let out = "";
  while (out.length < largo) {
    x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
    out += x.toString(16).padStart(8, "0");
  }
  return out.slice(0, largo);
}
