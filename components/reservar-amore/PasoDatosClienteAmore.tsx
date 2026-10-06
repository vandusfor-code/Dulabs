"use client";

import { useState } from "react";
import { Cake, Phone, ShieldCheck, User } from "lucide-react";
import { ContinuarAmore, MarcoPasoAmore } from "./MarcoPasoAmore";
import { AMORE } from "./tema";

// AMORE (portal) — paso 4, «Tus datos». Campos obligatorios: nombre y WhatsApp (los mismos que ya exige app/api/reservar/[tenant]/route.ts). Día/mes de
// nacimiento son OPCIONALES y SOLO se guardan de forma estructurada (dulabs_clientes_conocidos.cumple_dia/cumple_mes) -- ningún automatismo de
// cumpleaños/fidelización se implementa todavía (pedido explícito de esa fase).
//
// Pensado para el celular: letra de 16 px en los campos (con menos, iOS hace zoom al tocarlos), teclado numérico para el WhatsApp, autocompletado del
// navegador y «Continuar» pegado abajo (también con el «Siguiente/Listo» del teclado).

export type DatosClienteAmore = { nombre: string; telefono: string; cumpleDia: string; cumpleMes: string };

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** Mismo criterio que el servidor (telefonoParaReserva): entre 10 y 15 dígitos; así el error no aparece hasta el último paso. */
export function telefonoWhatsappValido(telefono: string): boolean {
  const digitos = telefono.replace(/\D/g, "");
  return digitos.length >= 10 && digitos.length <= 15;
}

function CampoTexto({
  icono,
  label,
  value,
  placeholder,
  type = "text",
  inputMode,
  autoComplete,
  autoCapitalize,
  enterKeyHint,
  ayuda,
  error,
  onChange,
  onBlur,
}: {
  icono: React.ReactNode;
  label: string;
  value: string;
  placeholder: string;
  type?: "text" | "tel";
  inputMode?: "text" | "tel";
  autoComplete?: string;
  autoCapitalize?: "words" | "none";
  enterKeyHint?: "next" | "done";
  ayuda?: string;
  error?: string | null;
  onChange: (v: string) => void;
  onBlur?: () => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-semibold" style={{ color: AMORE.texto }}>
        {label}
      </span>
      <div className="flex items-center gap-2.5 rounded-2xl px-4" style={{ backgroundColor: "#fff", border: `1.5px solid ${error ? AMORE.rojo : AMORE.borde}` }}>
        <span style={{ color: AMORE.burdeos }}>{icono}</span>
        <input
          className="h-12 w-full bg-transparent text-[16px] outline-none"
          style={{ color: AMORE.texto }}
          type={type}
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete={autoComplete}
          autoCapitalize={autoCapitalize}
          enterKeyHint={enterKeyHint}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      </div>
      {error ? (
        <span className="mt-1 block text-[12px]" style={{ color: AMORE.rojo }}>
          {error}
        </span>
      ) : ayuda ? (
        <span className="mt-1 block text-[12px]" style={{ color: AMORE.textoSecundario }}>
          {ayuda}
        </span>
      ) : null}
    </label>
  );
}

const ID_FORMULARIO = "formulario-datos-amore";

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
  const [telefonoTocado, setTelefonoTocado] = useState(false);
  const telefonoOk = telefonoWhatsappValido(datos.telefono);
  const valido = datos.nombre.trim().length >= 2 && telefonoOk;
  const errorTelefono = telefonoTocado && datos.telefono.trim() !== "" && !telefonoOk ? "Escribe tu número de WhatsApp con 10 dígitos (ej. 3001234567)." : null;

  return (
    <MarcoPasoAmore
      negocio={negocio}
      onVolver={onVolver}
      paso={4}
      titulo="Cuéntanos sobre ti"
      subtitulo="Necesitamos algunos datos para confirmar tu cita."
      accion={
        <div className="flex items-center gap-3">
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[11.5px] leading-snug" style={{ color: AMORE.textoSecundario }}>
            <ShieldCheck className="size-4 shrink-0" style={{ color: AMORE.dorado }} strokeWidth={1.5} />
            Tus datos están protegidos
          </p>
          <ContinuarAmore type="submit" form={ID_FORMULARIO} disabled={!valido} />
        </div>
      }
    >
      <form
        id={ID_FORMULARIO}
        className="flex flex-col gap-4 rounded-[28px] p-4"
        style={{ backgroundColor: "#fff", border: `1px solid ${AMORE.borde}` }}
        onSubmit={(e) => {
          e.preventDefault();
          if (valido) onContinuar();
        }}
      >
        <CampoTexto
          icono={<User className="size-[18px]" strokeWidth={1.6} />}
          label="Nombre completo"
          value={datos.nombre}
          placeholder="Ej. Laura Gómez"
          autoComplete="name"
          autoCapitalize="words"
          enterKeyHint="next"
          onChange={(v) => onCambiar({ ...datos, nombre: v })}
        />
        <CampoTexto
          icono={<Phone className="size-[18px]" strokeWidth={1.6} />}
          label="WhatsApp"
          value={datos.telefono}
          placeholder="Ej. 3001234567"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          enterKeyHint="done"
          ayuda="Por aquí te enviamos la confirmación y el enlace de tu cita."
          error={errorTelefono}
          onChange={(v) => onCambiar({ ...datos, telefono: v })}
          onBlur={() => setTelefonoTocado(true)}
        />

        <div>
          <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: AMORE.texto }}>
            <Cake className="size-[15px]" style={{ color: AMORE.burdeos }} strokeWidth={1.6} />
            Cumpleaños (opcional, sin año)
          </span>
          <div className="flex gap-2.5">
            <select
              className="h-12 flex-1 rounded-2xl px-3 text-[16px] outline-none"
              style={{ border: `1.5px solid ${AMORE.borde}`, color: datos.cumpleDia ? AMORE.texto : AMORE.textoSecundario, backgroundColor: "#fff" }}
              value={datos.cumpleDia}
              aria-label="Día de tu cumpleaños"
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
              className="h-12 flex-[1.4] rounded-2xl px-3 text-[16px] outline-none"
              style={{ border: `1.5px solid ${AMORE.borde}`, color: datos.cumpleMes ? AMORE.texto : AMORE.textoSecundario, backgroundColor: "#fff" }}
              value={datos.cumpleMes}
              aria-label="Mes de tu cumpleaños"
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
      </form>
    </MarcoPasoAmore>
  );
}
