"use client";

import { useEffect, useState } from "react";
import type { CatalogClient } from "@/lib/catalogo-client";

/**
 * ¿La tienda de este negocio separa Mujer y Hombre (y la migración ya está aplicada)? Lo dice el servidor en cada listado del catálogo (`ProductPage.genero`): aquí se pide una sola página de una pieza
 * para saberlo en pantallas que aún no tienen ninguna pieza cargada (crear una pieza nueva). Mientras se consulta, o si la consulta falla, es false: «Para» es un extra y nunca debe romper la pantalla,
 * así que un negocio sin separación ve el formulario exactamente como siempre.
 */
export function useSeparaGenero(client: CatalogClient | null): boolean {
  const [separa, setSepara] = useState(false);
  useEffect(() => {
    if (!client) return;
    let vivo = true;
    void client
      .listProducts({ pageSize: 1 })
      .then((r) => {
        if (vivo && r.ok) setSepara(Boolean(r.data.genero));
      })
      .catch(() => {
        // Sin red o sin respuesta: el formulario sigue sin «Para».
      });
    return () => {
      vivo = false;
    };
  }, [client]);
  return separa;
}
