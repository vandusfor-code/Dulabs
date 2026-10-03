"use client";

// Fase 3B.7 — lista de los pedidos pendientes de aceptación humana (ver components/dashboard/pedidos/PorAceptar.tsx).
import { useI18n } from "@/lib/i18n";
import { useCatalogAccess } from "@/components/dashboard/catalogo/ui";
import { ListaPorAceptar } from "@/components/dashboard/pedidos/PorAceptar";

export default function PorAceptarPage() {
  const { t } = useI18n();
  const { client } = useCatalogAccess();
  return <ListaPorAceptar client={client} t={t} />;
}
