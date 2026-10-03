"use client";

// Fase 3B.7 — detalle de un pedido pendiente de aceptación humana: datos completos (documento enmascarado),
// responsable, conversación y las tres decisiones. Las valida el backend (ver components/dashboard/pedidos/PorAceptar.tsx).
import { useParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useCatalogAccess, useCatalogToast } from "@/components/dashboard/catalogo/ui";
import { DetallePorAceptar } from "@/components/dashboard/pedidos/PorAceptar";

/** El número viene de la URL: una codificación rota no debe tumbar la página (el backend valida el número igual). */
function decodificar(valor: string | undefined): string {
  try {
    return decodeURIComponent(valor ?? "");
  } catch {
    return "";
  }
}

export default function PorAceptarDetallePage() {
  const { t } = useI18n();
  const { client } = useCatalogAccess();
  const toast = useCatalogToast();
  const { pedido } = useParams<{ pedido: string }>();
  return <DetallePorAceptar client={client} pedido={decodificar(pedido)} t={t} toast={toast} />;
}
