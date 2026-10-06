"use client";

import type { ReactNode } from "react";
import { ArrowLeft, ChevronRight, Loader2 } from "lucide-react";
import { AMORE, serifAmore } from "./tema";

// AMORE (portal) — MARCO COMÚN de todas las pantallas de la reserva, pensado primero para el celular:
//   · encabezado compacto y pegado arriba (atrás + negocio + «paso X de 5» con barra de avance), en vez del encabezado y el indicador de pasos de antes, que
//     se comían ~150 px de una pantalla de 640;
//   · barra de acción pegada ABAJO (`accion`): el botón «Continuar» siempre está a la vista y al alcance del pulgar, sin tener que bajar hasta el final de una
//     lista larga;
//   · alto real de la pantalla (`dvh`, descuenta la barra del navegador) y zonas seguras de iPhone (muesca y barra de inicio).
// Solo es presentación: ninguna pantalla decide nada aquí.

export const TOTAL_PASOS = 5;

function EncabezadoPaso({ negocio, paso, onVolver }: { negocio: string; paso?: number; onVolver?: () => void }) {
  return (
    <>
      <header className="flex items-center justify-between">
        {onVolver ? (
          <button
            type="button"
            onClick={onVolver}
            aria-label="Volver"
            className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full active:bg-black/5"
            style={{ color: AMORE.texto }}
          >
            <ArrowLeft className="size-5" strokeWidth={1.75} />
          </button>
        ) : (
          <span className="size-11 shrink-0" />
        )}
        <p className="min-w-0 truncate text-[14px] font-semibold uppercase tracking-[0.18em]" style={{ ...serifAmore, color: AMORE.texto }}>
          {negocio}
        </p>
        {paso !== undefined ? (
          <span className="w-11 shrink-0 text-right text-[12px] font-medium tabular-nums" style={{ color: AMORE.textoSecundario }}>
            <span className="sr-only">Paso </span>
            {paso}/{TOTAL_PASOS}
          </span>
        ) : (
          <span className="size-11 shrink-0" />
        )}
      </header>
      {paso !== undefined && (
        <div className="mt-0.5 flex gap-1.5" role="progressbar" aria-label="Avance de la reserva" aria-valuemin={1} aria-valuemax={TOTAL_PASOS} aria-valuenow={paso}>
          {Array.from({ length: TOTAL_PASOS }, (_, i) => (
            <span key={i} className="h-1 flex-1 rounded-full" style={{ backgroundColor: i < paso ? AMORE.burdeos : AMORE.borde }} />
          ))}
        </div>
      )}
    </>
  );
}

/** Barra pegada al borde de abajo: queda siempre a la vista mientras se desplaza el contenido y, al final de la página, se asienta en su lugar. */
export function BarraAccionAmore({ children }: { children: ReactNode }) {
  return (
    <div
      className="sticky bottom-0 z-30 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3"
      style={{ backgroundColor: AMORE.fondo, borderTop: `1px solid ${AMORE.borde}`, boxShadow: "0 -10px 24px -16px rgba(31,27,26,0.22)" }}
    >
      {children}
    </div>
  );
}

/** Botón principal (burdeos, de 48 px de alto: cómodo para el pulgar). Con `href` es un enlace con el mismo aspecto. */
export function BotonPrincipalAmore({
  children,
  onClick,
  disabled,
  cargando,
  href,
  type = "button",
  form,
  llena = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  cargando?: boolean;
  href?: string;
  type?: "button" | "submit";
  form?: string;
  /** Ocupa todo el ancho (confirmaciones); si no, solo lo que necesita su texto (queda al lado de un resumen). */
  llena?: boolean;
}) {
  const clases = `flex h-12 items-center justify-center gap-2 px-6 text-[15.5px] font-semibold text-white transition-transform active:scale-[0.98] ${llena ? "w-full" : "shrink-0"}`;
  const estilo = { backgroundColor: AMORE.burdeos, borderRadius: 999 };
  if (href) {
    return (
      <a href={href} className={clases} style={estilo}>
        {children}
      </a>
    );
  }
  return (
    <button
      type={type}
      form={form}
      onClick={onClick}
      disabled={disabled || cargando}
      className={`${clases} disabled:opacity-40 disabled:active:scale-100`}
      style={estilo}
    >
      {cargando ? <Loader2 className="size-5 animate-spin" /> : null}
      {children}
    </button>
  );
}

/** Botón secundario (con borde, de 44 px): la acción menos importante de una barra con dos botones. `peligro` es para cancelar o borrar. */
export function BotonSecundarioAmore({ children, onClick, disabled, peligro = false }: { children: ReactNode; onClick?: () => void; disabled?: boolean; peligro?: boolean }) {
  const color = peligro ? AMORE.rojo : AMORE.burdeos;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 w-full items-center justify-center gap-2 px-6 text-[14.5px] font-semibold transition-transform active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100"
      style={{ backgroundColor: "#fff", color, border: `1.5px solid ${color}`, borderRadius: 999 }}
    >
      {children}
    </button>
  );
}

/** El «Continuar →» de siempre. */
export function ContinuarAmore({
  onClick,
  disabled,
  type,
  form,
  etiqueta = "Continuar",
  llena,
}: {
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  form?: string;
  etiqueta?: string;
  llena?: boolean;
}) {
  return (
    <BotonPrincipalAmore onClick={onClick} disabled={disabled} type={type} form={form} llena={llena}>
      {etiqueta}
      <ChevronRight className="size-5" strokeWidth={2} />
    </BotonPrincipalAmore>
  );
}

export function MarcoPasoAmore({
  negocio,
  onVolver,
  paso,
  titulo,
  subtitulo,
  superior,
  accion,
  children,
}: {
  negocio: string;
  onVolver?: () => void;
  /** 1 a 5 (Servicio, Profesional, Horario, Datos, Confirmar). Sin él (pantalla de éxito) no hay barra de avance. */
  paso?: number;
  titulo?: string;
  subtitulo?: ReactNode;
  /** Se queda pegado bajo el encabezado al desplazarse (ej. las categorías de servicios). */
  superior?: ReactNode;
  /** Contenido de la barra de acción pegada abajo (el botón «Continuar» y, si hace falta, un resumen). */
  accion?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh w-full" style={{ backgroundColor: AMORE.fondo }}>
      <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col">
        <div className="sticky top-0 z-30 px-4 pb-2 pt-[max(8px,env(safe-area-inset-top))]" style={{ backgroundColor: AMORE.fondo }}>
          <EncabezadoPaso negocio={negocio} paso={paso} onVolver={onVolver} />
          {superior}
        </div>

        <main className="flex-1 px-4 pb-6 pt-1">
          {titulo ? (
            <h1 className="text-center text-[24px] font-semibold leading-[1.15]" style={{ ...serifAmore, color: AMORE.texto }}>
              {titulo}
            </h1>
          ) : null}
          {subtitulo ? (
            <p className="mt-1.5 text-center text-[13px] leading-snug" style={{ color: AMORE.textoSecundario }}>
              {subtitulo}
            </p>
          ) : null}
          <div className={titulo || subtitulo ? "mt-4" : ""}>{children}</div>
        </main>

        {accion ? <BarraAccionAmore>{accion}</BarraAccionAmore> : null}
      </div>
    </div>
  );
}
