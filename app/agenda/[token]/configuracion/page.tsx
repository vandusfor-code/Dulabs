"use client";

import { Store, Clock3, UserRound, Bell, Cake, Heart, MessageCircle, UserCog } from "lucide-react";
import { AmoreOnlyScreen } from "@/components/spa-panel/amore/AmoreOnlyScreen";
import { AmoreScreenTitle, AmoreChevronRow } from "@/components/spa-panel/amore/ui";
import { useAmoreUi } from "@/components/spa-panel/amore/AmoreUiContext";

const OPCIONES = [
  { icono: Store, titulo: "Negocio", descripcion: "Nombre, dirección y datos de AMORE" },
  { icono: Clock3, titulo: "Horarios", descripcion: "Horario de atención del salón" },
  { icono: UserRound, titulo: "Profesionales", descripcion: "Mary, Cristal, Nata y Jessica" },
  { icono: Bell, titulo: "Notificaciones", descripcion: "Alertas del panel administrativo" },
  { icono: Cake, titulo: "Cumpleaños", descripcion: "Mensajes automáticos de cumpleaños" },
  { icono: Heart, titulo: "Fidelización", descripcion: "Reglas de reactivación de clientas" },
  { icono: MessageCircle, titulo: "WhatsApp", descripcion: "Conexión y uso del número" },
  { icono: UserCog, titulo: "Cuenta", descripcion: "Acceso y datos de tu cuenta" },
] as const;

// AMORE (Fase 5, diseño visual completo, autorizado) — SOLO UI, sin lógica.
export default function ConfiguracionPage() {
  return (
    <AmoreOnlyScreen>
      <ConfiguracionContenido />
    </AmoreOnlyScreen>
  );
}

function ConfiguracionContenido() {
  const { avisarProximamente } = useAmoreUi();

  return (
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle title="Configuración" subtitle="Ajustes del panel de AMORE" />
      <div className="flex flex-col gap-2.5">
        {OPCIONES.map((o) => (
          <AmoreChevronRow
            key={o.titulo}
            icono={<o.icono className="size-5" />}
            titulo={o.titulo}
            descripcion={o.descripcion}
            onClick={avisarProximamente}
          />
        ))}
      </div>
    </div>
  );
}
