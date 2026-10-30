"use client";

import { useEffect, useState } from "react";
import type { CatalogClient } from "@/lib/catalogo-client";
import { lineasDeLaTienda } from "@/lib/catalogo/joyeria";
import type { LineaConfig } from "@/lib/catalogo/lineas";

const SIN_LINEAS: readonly LineaConfig[] = [];

/**
 * Las líneas de la tienda de este negocio (Plata, Rodio…) para clasificar sus productos desde el panel. Salen de la configuración de SU tienda pública (la misma que arma el menú y los filtros
 * de la tienda), así que un negocio sin líneas recibe una lista vacía y el panel se ve exactamente como siempre. Mientras se consultan, o si la consulta falla, también es vacía: la
 * clasificación es un extra y nunca debe romper la pantalla.
 */
export function useLineasDelNegocio(client: CatalogClient | null): readonly LineaConfig[] {
  const [lineas, setLineas] = useState<readonly LineaConfig[]>(SIN_LINEAS);
  useEffect(() => {
    if (!client) return;
    let vivo = true;
    void client
      .getPublication()
      .then((r) => {
        if (!vivo || !r.ok || !r.data.publication) return;
        const propias = lineasDeLaTienda(r.data.publication.slug);
        if (propias.length > 0) setLineas(propias);
      })
      .catch(() => {
        // Sin red o sin respuesta: el panel sigue sin la clasificación.
      });
    return () => {
      vivo = false;
    };
  }, [client]);
  return lineas;
}
