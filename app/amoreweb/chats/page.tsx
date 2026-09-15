"use client";

import { useAdminWeb } from "@/components/admin-web/AdminWebContext";
import { ChatsContenido } from "@/components/admin-web/chats/ChatsContenido";

// Panel web AMORE (autorizado) — Chats: EXCLUSIVO de administrador, tanto
// acá (UX) como en cada API real (requiereAdministrador, ver
// app/api/agenda/[token]/chats/*). Una colaboradora ni siquiera ve el ítem
// en el sidebar (DesktopSidebar.tsx no lo incluye en ITEMS_COLABORADORA),
// pero si escribiera la URL directo, esto la bloquea también.
export default function AdminAmoreChatsPage() {
  const { datos } = useAdminWeb();
  if (datos.sesion?.rol === "colaboradora") {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm text-mist">Esta sección no está disponible para tu cuenta.</p>
      </div>
    );
  }
  return <ChatsContenido />;
}
