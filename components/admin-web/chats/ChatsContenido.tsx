"use client";

import { useEffect, useState } from "react";
import { useAdminWeb } from "@/components/admin-web/AdminWebContext";
import { NewAppointmentModal } from "@/components/spa-panel/modals/NewAppointmentModal";
import { useChats } from "./useChats";
import { useConversacion } from "./useConversacion";
import { useClienteChat } from "./useClienteChat";
import { ConversationList } from "./ConversationList";
import { ChatWindow } from "./ChatWindow";
import { ClientPanel, type TabCliente } from "./ClientPanel";

// Chats AMORE (autorizado) — orquestador de las 3 columnas del mockup.
// "Agendar cita" reutiliza EXACTAMENTE el mismo NewAppointmentModal/crearCita
// que ya usa el resto del panel (Fase 6A/panel web) -- se abre localmente
// acá (no por el modal global de DesktopShell) solo para poder precargar
// nombre/teléfono desde la conversación, ver
// components/spa-panel/modals/NewAppointmentModal.tsx.
export function ChatsContenido() {
  const { token, crearCita } = useAdminWeb();
  const { tab, setTab, q, setQ, conversaciones, whatsapp, seleccionId, setSeleccionId } = useChats(token);
  const { conversacion, mensajes, enviando, error, enviarTexto, enviarAudio, cambiarEstado, enviarCatalogo } = useConversacion(
    token,
    seleccionId
  );
  const { cliente, historial, cargando: cargandoCliente, crearCliente } = useClienteChat(token, seleccionId);
  const [tabCliente, setTabCliente] = useState<TabCliente>("informacion");
  const [mostrarAgendar, setMostrarAgendar] = useState(false);

  // Al abrir una conversación sin leer, marcarla como leída automáticamente
  // -- mismo criterio que cualquier bandeja real (WhatsApp Web, Gmail...).
  useEffect(() => {
    if (!seleccionId) return;
    const actual = (conversaciones ?? []).find((c) => c.id === seleccionId);
    if (actual && actual.noLeidos > 0) cambiarEstado("marcar_leido").catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionId]);

  return (
    <div className="-m-8 flex h-[calc(100vh-89px)]">
      <ConversationList
        conversaciones={conversaciones}
        tab={tab}
        onTab={(t) => {
          setTab(t);
          setSeleccionId(null);
        }}
        q={q}
        onQ={setQ}
        seleccionId={seleccionId}
        onSeleccionar={(id) => {
          setSeleccionId(id);
          setTabCliente("informacion");
        }}
        whatsappConectado={whatsapp.conectado}
      />

      {conversacion ? (
        <>
          <ChatWindow
            conversacion={conversacion}
            mensajes={mensajes}
            enviando={enviando}
            error={error}
            onEnviarTexto={enviarTexto}
            onEnviarAudio={enviarAudio}
            onCambiarEstado={cambiarEstado}
            onEnviarCatalogo={enviarCatalogo}
            onAgendarCita={() => setMostrarAgendar(true)}
            onVerCitas={() => setTabCliente("citas")}
          />
          <ClientPanel
            telefono={conversacion.telefono}
            cliente={cliente}
            historial={historial}
            cargando={cargandoCliente}
            tab={tabCliente}
            onTab={setTabCliente}
            onCrearCliente={crearCliente}
          />
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center bg-ink">
          <p className="text-sm text-mist">Selecciona una conversación para verla aquí.</p>
        </div>
      )}

      {mostrarAgendar && (
        <NewAppointmentModal
          token={token}
          nombreClienteInicial={cliente?.nombre ?? conversacion?.nombreVisible}
          telefonoClienteInicial={conversacion?.telefono}
          onClose={() => setMostrarAgendar(false)}
          onCrear={crearCita}
        />
      )}
    </div>
  );
}
