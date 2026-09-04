"use client";

import { ChevronRight, ShieldCheck, User, Phone, Mail } from "lucide-react";
import { cormorantGaramond, parisienne } from "@/lib/fonts-portal-daniela";
import { PortalHeader } from "@/components/reservar/PortalHeader";

// Fase 8A.10 (autorizado) — SOLO esta pantalla ("Tus datos"). Los campos son
// EXACTAMENTE los que ya exige app/api/reservar/[tenant]/route.ts
// (nombreCliente, telefonoCliente obligatorios; correoCliente opcional) --
// no se agregó ni se quitó ningún campo. `onCambiar`/`onContinuar` son los
// MISMOS handlers que ya existían en page.tsx (setDatos/irAConfirmar); esta
// pantalla nunca crea la cita, solo recolecta los datos.

type DatosCliente = { nombre: string; telefono: string; correo: string };

const ROSA = "#C94B78";
const ROSA_FONDO = "#FDF5F7";
const TEXTO = "#111111";
const TEXTO_SECUNDARIO = "#555555";
const BORDE = "#E8DDE1";

const serif = { fontFamily: "var(--font-cormorant-daniela), 'Cormorant Garamond', serif" };

function PasoIndicador({ estado, numero, label }: { estado: "completado" | "activo" | "pendiente"; numero: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="flex size-9 items-center justify-center rounded-full text-[14px] font-semibold"
        style={
          estado !== "pendiente"
            ? { backgroundColor: ROSA, color: "#fff" }
            : { backgroundColor: "#fff", color: TEXTO_SECUNDARIO, border: `1px solid ${BORDE}` }
        }
      >
        {numero}
      </div>
      <span className="text-center text-[11px] font-medium leading-tight" style={{ color: estado !== "pendiente" ? TEXTO : TEXTO_SECUNDARIO }}>
        {label}
      </span>
    </div>
  );
}

function CampoTexto({
  icono,
  label,
  value,
  placeholder,
  inputMode,
  onChange,
}: {
  icono: React.ReactNode;
  label: string;
  value: string;
  placeholder: string;
  inputMode?: "text" | "tel" | "email";
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-semibold" style={{ color: TEXTO }}>
        {label}
      </span>
      <div className="flex items-center gap-2.5 rounded-2xl px-4 py-3" style={{ backgroundColor: "#fff", border: `1.5px solid ${BORDE}` }}>
        <span style={{ color: ROSA }}>{icono}</span>
        <input
          className="w-full bg-transparent text-[14.5px] outline-none"
          style={{ color: TEXTO }}
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </label>
  );
}

export function PasoDatosCliente({
  negocio,
  datos,
  onCambiar,
  onContinuar,
  onVolver,
}: {
  negocio: string;
  datos: DatosCliente;
  onCambiar: (d: DatosCliente) => void;
  onContinuar: () => void;
  onVolver: () => void;
}) {
  const valido = Boolean(datos.nombre.trim() && datos.telefono.trim());

  return (
    <div className={`relative min-h-screen w-full ${cormorantGaramond.variable} ${parisienne.variable}`} style={{ backgroundColor: ROSA_FONDO }}>
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-6 pb-9 pt-9">
        <PortalHeader negocio={negocio} onVolver={onVolver} />

        <div className="mt-7 flex w-full items-start justify-between">
          <PasoIndicador estado="completado" numero={1} label="Servicio" />
          <div className="mt-4 h-px flex-1" style={{ backgroundColor: ROSA }} />
          <PasoIndicador estado="completado" numero={2} label="Horario" />
          <div className="mt-4 h-px flex-1" style={{ backgroundColor: ROSA }} />
          <PasoIndicador estado="activo" numero={3} label="Tus datos" />
          <div className="mt-4 h-px flex-1" style={{ backgroundColor: BORDE }} />
          <PasoIndicador estado="pendiente" numero={4} label="Confirmación" />
        </div>

        <h1 className="mt-8 text-center text-[32px] font-semibold" style={{ ...serif, color: TEXTO }}>
          Cuéntanos sobre ti
        </h1>
        <p className="mt-1 text-center text-[13.5px]" style={{ color: TEXTO_SECUNDARIO }}>
          Necesitamos algunos datos para confirmar tu cita.
        </p>

        <div className="mt-7 flex flex-col gap-4 rounded-[32px] p-5" style={{ backgroundColor: "rgba(255,255,255,0.94)", boxShadow: "0 20px 60px -30px rgba(201,75,120,0.25)" }}>
          <CampoTexto
            icono={<User className="size-[18px]" strokeWidth={1.6} />}
            label="Nombre completo"
            value={datos.nombre}
            placeholder="Ej. Laura Gómez"
            onChange={(v) => onCambiar({ ...datos, nombre: v })}
          />
          <CampoTexto
            icono={<Phone className="size-[18px]" strokeWidth={1.6} />}
            label="WhatsApp"
            value={datos.telefono}
            placeholder="Ej. 3001234567"
            inputMode="tel"
            onChange={(v) => onCambiar({ ...datos, telefono: v })}
          />
          <CampoTexto
            icono={<Mail className="size-[18px]" strokeWidth={1.6} />}
            label="Correo (opcional)"
            value={datos.correo}
            placeholder="tucorreo@ejemplo.com"
            inputMode="email"
            onChange={(v) => onCambiar({ ...datos, correo: v })}
          />
        </div>

        <button
          type="button"
          disabled={!valido}
          onClick={onContinuar}
          className="mt-6 flex w-full items-center justify-center gap-2 py-4 text-[16px] font-semibold text-white disabled:opacity-40"
          style={{ backgroundColor: ROSA, borderRadius: 32 }}
        >
          Continuar
          <ChevronRight className="size-5" strokeWidth={2} />
        </button>

        <div className="mt-4 flex items-center justify-center gap-1.5">
          <ShieldCheck className="size-3.5" style={{ color: ROSA }} strokeWidth={1.5} />
          <span className="text-[11.5px]" style={{ color: TEXTO_SECUNDARIO }}>
            Tus datos están protegidos
          </span>
        </div>
      </div>
    </div>
  );
}
