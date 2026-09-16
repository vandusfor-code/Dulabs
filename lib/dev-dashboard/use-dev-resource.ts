"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { esSesionExpirada } from "@/lib/dev-dashboard/dev-errors";

// DuLabs Developer V1 -- Fase 9. Hook estándar de carga de datos del
// Dashboard: {data, loading, error, reload}. Se re-ejecuta cuando cambia
// `clave` (típicamente el workspace seleccionado). Cancela respuestas
// obsoletas (nunca pinta datos de un workspace anterior) y, ante 401,
// redirige a /login. Escribe estado SOLO dentro de callbacks de promesa
// (nunca sincrónicamente en el cuerpo del efecto), igual que el resto del
// repo -- compatible con las reglas de React 19.

export function useDevResource<T>(clave: string | null, fetcher: () => Promise<T>): { data: T | null; loading: boolean; error: unknown; reload: () => void } {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  // El fetcher se actualiza en cada render; se guarda en un ref DENTRO de un
  // efecto (nunca durante el render) para que el efecto de carga dependa solo
  // de `clave`/`tick` y no se dispare por la identidad cambiante del fetcher.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    let vivo = true;
    Promise.resolve()
      .then(() => {
        if (vivo) {
          setLoading(true);
          setError(null);
        }
        return fetcherRef.current();
      })
      .then(
        (res) => {
          if (vivo) {
            setData(res);
            setLoading(false);
          }
        },
        (err) => {
          if (!vivo) return;
          if (esSesionExpirada(err)) {
            router.replace("/login?next=/developer");
            return;
          }
          setError(err);
          setLoading(false);
        }
      );
    return () => {
      vivo = false;
    };
  }, [clave, tick, router]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}
