"use client";

/**
 * Administración de tienda — las PÁGINAS propias del negocio (política de privacidad, términos…) tal como las necesita el resto del panel: el pie las ofrece como destino de un enlace y su vista
 * previa dice cómo se llama cada una. Se piden al abrir quien las usa (no al abrir el panel), así una página recién creada ya aparece al volver al pie.
 */
import { useEffect, useState } from "react";
import type { EntidadResumen } from "@/lib/cms-comercial-client";
import { useTienda } from "@/components/dashboard/tienda/contexto";

/** Las páginas no archivadas del negocio (borradores, publicadas y pausadas), o null mientras se leen o si no se pudieron leer. */
export function usePaginas(): EntidadResumen[] | null {
  const { client } = useTienda();
  const [paginas, setPaginas] = useState<EntidadResumen[] | null>(null);
  useEffect(() => {
    let vivo = true;
    void client.listar({ tipo: "pagina" }).then((r) => {
      if (vivo && r.ok) setPaginas(r.data.items);
    });
    return () => {
      vivo = false;
    };
  }, [client]);
  return paginas;
}
