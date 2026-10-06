"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// AMORE (portal de reservas y «Mi cita») — el botón «atrás» del celular (o el gesto de volver) regresa al PASO ANTERIOR de la pantalla en vez de sacar a la
// clienta de la página y hacerle perder todo lo que eligió.
//
// Cómo: cada paso nuevo agrega UNA entrada al historial del navegador (`history.pushState`, sin cambiar la dirección: el enlace sigue siendo el mismo) con una
// marca {paso, idx}. Al volver (o avanzar) con los botones del navegador, el evento `popstate` trae esa marca y se muestra el paso correspondiente. Next.js
// documenta este uso de la API nativa del historial (ver «Native History API» en la guía de navegación): sus llamadas se integran con el enrutador y no recargan.
//
// Reglas:
//   · Un paso al que ya no se puede entrar (se perdió lo elegido, o la página se recargó a mitad de camino) se SALTA al ir hacia atrás y NO se avanza al ir hacia
//     adelante: nunca se muestra una pantalla sin sus datos.
//   · Tras un paso FINAL (reserva hecha, cita cancelada…) volver no regresa a los pasos viejos —ya no tienen sentido, y confirmar otra vez sería confuso—: se
//     retrocede hasta el inicio y se empieza limpio (`alReiniciar`).
//   · La entrada con la que se abre la página es el paso inicial; si venía marcada con un paso viejo (recarga a mitad de camino) se limpia.

const MARCA = "amorePasos";

type Marca<P extends string> = { paso: P; idx: number };

function leerMarca<P extends string>(estado: unknown): Marca<P> | null {
  const marca = (estado as Record<string, unknown> | null)?.[MARCA] as Partial<Marca<P>> | undefined;
  if (!marca || typeof marca.paso !== "string" || typeof marca.idx !== "number" || !Number.isInteger(marca.idx) || marca.idx < 0) return null;
  return { paso: marca.paso, idx: marca.idx };
}

/**
 * Estado de la entrada del historial con nuestra marca, CONSERVANDO lo que Next.js guarda en ella (`__NA` y el árbol del enrutador): si una entrada pierde esa
 * señal, al volver a ella Next recarga la página entera y se pierde todo. (Al abrir la página, nuestro efecto corre antes de que Next parche `history`, así que no
 * se puede confiar en que él copie esos datos: se copian aquí.)
 */
function estadoConMarca<P extends string>(marca: Marca<P>): Record<string, unknown> {
  const actual = window.history.state as unknown;
  return { ...(actual && typeof actual === "object" ? (actual as Record<string, unknown>) : {}), [MARCA]: marca };
}

export interface OpcionesHistorialPasos<P extends string> {
  /** Paso con el que se abre la página (entrada 0 del historial). Siempre se puede mostrar. */
  inicial: P;
  /** ¿Se puede mostrar este paso con lo que hay elegido ahora? Se consulta al volver o avanzar con los botones del navegador. */
  puedeMostrar: (paso: P) => boolean;
  /** Pasos finales: después de uno, volver lleva al inicio y se empieza limpio. */
  esFinal: (paso: P) => boolean;
  /** Se regresó al inicio después de un paso final: hay que dejar todo como nuevo. */
  alReiniciar?: () => void;
}

export function useHistorialPasos<P extends string>(opciones: OpcionesHistorialPasos<P>) {
  const [paso, setPaso] = useState<P>(opciones.inicial);
  // Lo último que se renderizó, para que el escucha de `popstate` (que se registra una sola vez) nunca use datos viejos.
  const opcionesRef = useRef(opciones);
  const pasoRef = useRef<P>(opciones.inicial);
  const idxRef = useRef(0);

  useEffect(() => {
    opcionesRef.current = opciones;
  });

  const fijarPaso = useCallback((nuevo: P, idx: number) => {
    pasoRef.current = nuevo;
    idxRef.current = idx;
    setPaso(nuevo);
  }, []);

  useEffect(() => {
    window.history.replaceState(estadoConMarca<P>({ paso: opcionesRef.current.inicial, idx: 0 }), "");
    idxRef.current = 0;

    const alCambiarElHistorial = (evento: PopStateEvent) => {
      const o = opcionesRef.current;
      const marca = leerMarca<P>(evento.state);
      const idxDestino = marca?.idx ?? 0;
      const pasoDestino = marca ? marca.paso : o.inicial;

      if (o.esFinal(pasoRef.current) && !o.esFinal(pasoDestino)) {
        if (idxDestino > 0) {
          window.history.back();
          return;
        }
        o.alReiniciar?.();
        fijarPaso(o.inicial, 0);
        return;
      }

      if (idxDestino === idxRef.current) return;

      if (!o.puedeMostrar(pasoDestino)) {
        if (idxDestino > idxRef.current || idxDestino > 0) {
          window.history.back();
          return;
        }
      }

      fijarPaso(pasoDestino, idxDestino);
    };

    window.addEventListener("popstate", alCambiarElHistorial);
    return () => window.removeEventListener("popstate", alCambiarElHistorial);
  }, [fijarPaso]);

  /** Avanza a un paso nuevo: agrega una entrada al historial, así «atrás» regresa al paso actual. */
  const irA = useCallback(
    (nuevo: P) => {
      if (nuevo === pasoRef.current) return;
      const idx = idxRef.current + 1;
      window.history.pushState(estadoConMarca<P>({ paso: nuevo, idx }), "");
      fijarPaso(nuevo, idx);
    },
    [fijarPaso],
  );

  /** La flecha de «volver» de la pantalla: igual que el botón «atrás» del celular. */
  const volver = useCallback(() => {
    if (idxRef.current > 0) window.history.back();
  }, []);

  return { paso, irA, volver };
}
