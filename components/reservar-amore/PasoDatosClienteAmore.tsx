"use client";

import { ChevronRight, ShieldCheck, User, Phone, Cake } from "lucide-react";
import { playfairDisplay } from "@/lib/fonts-portal-amore";
import { PortalHeaderAmore } from "./PortalHeaderAmore";
import { AMORE, serifAmore } from "./tema";

// AMORE (Fase 3 del portal, autorizado) — SOLO esta pantalla ("Tus datos").
// Campos obligatorios: nombre y WhatsApp (los mismos que ya exige
// app/api/reservar/[tenant]/route.ts). Día/mes de nacimiento son
// OPCIONALES y SOLO se guardan de forma estructurada (dulabs_clientes_conocidos.
// cumple_dia/cumple_mes) -- ningún automatismo de cumpleaños/fidelización
// se implementa todavía (pedido explícito de esta fase).

export type DatosClienteAmore = { nombre: string; telefono: string; cumpleDia: string; cumpleMes: string };

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function PasoIndicador({ estado, numero, label }: { estado: "completado" | "activo" | "pendiente"; numero: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="flex size-8 items-center justify-center rounded-full text-[13px] font-semibold"
        style={
          estado !== "pendiente"
            ? { backgroundColor: AMORE.burdeos, color: "#fff" }
            : { backgroundColor: "#fff", color: AMORE.textoSecundario, border: `1px solid ${AMORE.borde}` }
        }
      >
        {numero}
      </div>
      <span className="text-center text-[10px] font-medium leading-tight" style={{ color: estado !== "pendiente" ? AMORE.texto : AMORE.textoSecundario }}>
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
  inputMode?: "text" | "tel";
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold" style={{ color: AMORE.texto }}>
        {label}
      </span>
      <div className="flex items-center gap-2.5 rounded-2xl px-4 py-3" style={{ backgroundColor: "#fff", border: `1.5px solid ${AMORE.borde}` }}>
        <span style={{ color: AMORE.burdeos }}>{icono}</span>
        <input
          className="w-full bg-transparent text-[14px] outline-none"
          style={{ color: AMORE.texto }}
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </label>
  );
}

export function PasoDatosClienteAmore({
  negocio,
  datos,
  onCambiar,
  onContinuar,
  onVolver,
}: {
  negocio: string;
  datos: DatosClienteAmore;
  onCambiar: (d: DatosClienteAmore) => void;
  onContinuar: () => void;
  onVolver: () => void;
}) {
  const valido = Boolean(datos.nombre.trim() && datos.telefono.trim());

  return (
    <div className={`relative min-h-screen w-full ${playfairDisplay.variable}`} style={{ backgroundColor: AMORE.fondo }}>
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-6 pb-9 pt-8">
        <PortalHeaderAmore negocio={negocio} onVolver={onVolver} />

        <div className="mt-6 flex w-full items-start justify-between">
          <PasoIndicador estado="completado" numero={1} label="Servicio" />
          <div className="mt-3.5 h-px flex-1" style={{ backgroundColor: AMORE.burdeos }} />
          <PasoIndicador estado="completado" numero={2} label="Profesional" />
          <div className="mt-3.5 h-px flex-1" style={{ backgroundColor: AMORE.burdeos }} />
          <PasoIndicador estado="completado" numero={3} label="Horario" />
          <div className="mt-3.5 h-px flex-1" style={{ backgroundColor: AMORE.burdeos }} />
          <PasoIndicador estado="activo" numero={4} label="Datos" />
          <div className="mt-3.5 h-px flex-1" style={{ backgroundColor: AMORE.borde }} />
          <PasoIndicador estado="pendiente" numero={5} label="Listo" />
        </div>

        <h1 className="mt-7 text-center text-[27px] font-semibold" style={{ ...serifAmore, color: AMORE.texto }}>
          Cuéntanos sobre ti
        </h1>
        <p className="mt-1 text-center text-[13px]" style={{ color: AMORE.textoSecundario }}>
          Necesitamos algunos datos para confirmar tu cita.
        </p>

        <div className="mt-6 flex flex-col gap-4 rounded-[28px] p-5" style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}>
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

          <div>
            <span className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: AMORE.texto }}>
              <Cake className="size-[15px]" style={{ color: AMORE.burdeos }} strokeWidth={1.6} />
              Cumpleaños (opcional, sin año)
            </span>
            <div className="flex gap-2.5">
              <select
                className="flex-1 rounded-2xl bg-transparent px-3 py-3 text-[13.5px] outline-none"
                style={{ border: `1.5px solid ${AMORE.borde}`, color: datos.cumpleDia ? AMORE.texto : AMORE.textoSecundario, backgroundColor: "#fff" }}
                value={datos.cumpleDia}
                onChange={(e) => onCambiar({ ...datos, cumpleDia: e.target.value })}
              >
                <option value="">Día</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <select
                className="flex-[1.4] rounded-2xl bg-transparent px-3 py-3 text-[13.5px] outline-none"
                style={{ border: `1.5px solid ${AMORE.borde}`, color: datos.cumpleMes ? AMORE.texto : AMORE.textoSecundario, backgroundColor: "#fff" }}
                value={datos.cumpleMes}
                onChange={(e) => onCambiar({ ...datos, cumpleMes: e.target.value })}
              >
                <option value="">Mes</option>
                {MESES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={!valido}
          onClick={onContinuar}
          className="mt-6 flex w-full items-center justify-center gap-2 py-4 text-[15.5px] font-semibold text-white disabled:opacity-40"
          style={{ backgroundColor: AMORE.burdeos, borderRadius: 999 }}
        >
          Continuar
          <ChevronRight className="size-5" strokeWidth={2} />
        </button>

        <div className="mt-4 flex items-center justify-center gap-1.5">
          <ShieldCheck className="size-3.5" style={{ color: AMORE.dorado }} strokeWidth={1.5} />
          <span className="text-[11px]" style={{ color: AMORE.textoSecundario }}>
            Tus datos están protegidos
          </span>
        </div>
      </div>
    </div>
  );
}
