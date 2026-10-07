"use client";

import { Cargando } from "@/components/dashboard/tienda/ui";
import { TiendaApp } from "@/components/dashboard/tienda/TiendaApp";
import { useTiendaAcceso } from "@/components/dashboard/tienda/acceso";

export default function TiendaPage() {
  const { client, canWrite } = useTiendaAcceso();
  if (!client) {
    return (
      <div className="px-4 pt-6 md:px-8">
        <Cargando />
      </div>
    );
  }
  return <TiendaApp client={client} canWrite={canWrite} />;
}
