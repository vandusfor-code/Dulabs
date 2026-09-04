import { CalendarPlus, Clock, ShieldCheck, Sparkles, MessageCircle, ChevronRight, Gem } from "lucide-react";
import { playfairDisplay } from "@/lib/fonts-portal-amore";
import { AMORE, serifAmore } from "./tema";

// AMORE (Fase 3 del portal, autorizado) — landing propia del portal de
// AMORE, identidad visual distinta a la de Daniela (paleta burdeos/dorado
// sobre crema, un solo serif elegante, sin imagen de fondo importada de
// otro tenant). Puramente de presentación: "Comenzar ahora" solo cambia de
// paso dentro de la MISMA página (app/reservar/amore/page.tsx) -- no toca
// el motor de reservas, ni crea datos.

function LineaSepararadora() {
  return (
    <div className="flex items-center justify-center gap-2">
      <span className="h-px w-14" style={{ backgroundColor: AMORE.dorado }} />
      <Gem className="size-3.5 shrink-0" style={{ color: AMORE.dorado }} strokeWidth={1.5} />
      <span className="h-px w-14" style={{ backgroundColor: AMORE.dorado }} />
    </div>
  );
}

function PasoIndicador({ activo, numero, label }: { activo: boolean; numero: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="flex size-9 items-center justify-center rounded-full text-[14px] font-semibold"
        style={
          activo
            ? { backgroundColor: AMORE.burdeos, color: "#fff" }
            : { backgroundColor: "#fff", color: AMORE.textoSecundario, border: `1px solid ${AMORE.borde}` }
        }
      >
        {numero}
      </div>
      <span className="text-center text-[11px] font-medium leading-tight" style={{ color: activo ? AMORE.texto : AMORE.textoSecundario }}>
        {label}
      </span>
    </div>
  );
}

function Beneficio({ icon, titulo, texto }: { icon: React.ReactNode; titulo: string; texto: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-2.5 text-center">
      <div className="flex size-12 items-center justify-center rounded-full" style={{ backgroundColor: AMORE.doradoSuave, color: AMORE.dorado }}>
        {icon}
      </div>
      <p className="text-[13.5px] font-semibold" style={{ color: AMORE.texto }}>
        {titulo}
      </p>
      <p className="text-[12px] leading-relaxed" style={{ color: AMORE.textoSecundario }}>
        {texto}
      </p>
    </div>
  );
}

export function PortalLandingAmore({
  negocio,
  telefonoNegocio,
  onComenzar,
}: {
  negocio: string;
  telefonoNegocio: string | null;
  onComenzar: () => void;
}) {
  const whatsappHref = telefonoNegocio
    ? `https://wa.me/${telefonoNegocio}?text=${encodeURIComponent("Hola, tengo una duda sobre mi cita")}`
    : null;

  return (
    <div className={`relative min-h-screen w-full ${playfairDisplay.variable}`} style={{ backgroundColor: AMORE.fondo }}>
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-7 pb-9 pt-9">
        {/* Monograma + nombre real del negocio (nunca hardcodeado) */}
        <header className="flex flex-col items-center gap-3">
          <div
            className="flex size-14 items-center justify-center rounded-full text-[22px] font-semibold"
            style={{ backgroundColor: AMORE.burdeos, color: "#fff", ...serifAmore }}
          >
            A
          </div>
          <p className="max-w-[260px] truncate text-[14px] font-semibold uppercase tracking-[0.25em]" style={{ color: AMORE.texto }}>
            {negocio}
          </p>
        </header>

        {/* Hero */}
        <section className="mt-9 text-center">
          <h1 className="text-[36px] font-semibold leading-[1.1]" style={{ ...serifAmore, color: AMORE.texto }}>
            Un momento
            <br />
            solo para ti
          </h1>

          <div className="mt-5">
            <LineaSepararadora />
          </div>

          <p className="mx-auto mt-5 max-w-[280px] text-[14px] leading-relaxed" style={{ color: AMORE.textoSecundario }}>
            Reserva tu cita en {negocio} en unos segundos. Elige tu servicio, tu profesional favorita y el horario que mejor te convenga.
          </p>
        </section>

        {/* Tarjeta principal */}
        <section className="mt-8">
          <div
            className="flex flex-col items-center px-6 py-8 text-center"
            style={{ backgroundColor: "#fff", borderRadius: 28, border: `1px solid ${AMORE.borde}`, boxShadow: "0 24px 60px -30px rgba(107,39,55,0.25)" }}
          >
            <div className="flex size-[68px] items-center justify-center rounded-full" style={{ backgroundColor: AMORE.burdeosSuave }}>
              <CalendarPlus className="size-8" style={{ color: AMORE.burdeos }} strokeWidth={1.5} />
            </div>

            <h2 className="mt-5 text-[28px] font-semibold" style={{ ...serifAmore, color: AMORE.texto }}>
              Agenda tu cita
            </h2>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: AMORE.dorado }}>
              En pocos pasos
            </p>

            <div className="mt-6 flex w-full items-start justify-between px-1">
              <PasoIndicador activo numero={1} label="Servicio" />
              <div className="mt-4 h-px flex-1" style={{ backgroundColor: AMORE.borde }} />
              <PasoIndicador activo={false} numero={2} label="Profesional" />
              <div className="mt-4 h-px flex-1" style={{ backgroundColor: AMORE.borde }} />
              <PasoIndicador activo={false} numero={3} label="Horario" />
              <div className="mt-4 h-px flex-1" style={{ backgroundColor: AMORE.borde }} />
              <PasoIndicador activo={false} numero={4} label="Datos" />
              <div className="mt-4 h-px flex-1" style={{ backgroundColor: AMORE.borde }} />
              <PasoIndicador activo={false} numero={5} label="Listo" />
            </div>

            <button
              type="button"
              onClick={onComenzar}
              className="mt-7 flex w-full items-center justify-center gap-2 py-4 text-[15.5px] font-semibold text-white transition-transform active:scale-[0.98]"
              style={{ backgroundColor: AMORE.burdeos, borderRadius: 999 }}
            >
              Comenzar ahora
              <ChevronRight className="size-5" strokeWidth={2} />
            </button>

            <div className="mt-4 flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" style={{ color: AMORE.dorado }} strokeWidth={1.5} />
              <span className="text-[11.5px]" style={{ color: AMORE.textoSecundario }}>
                Tus datos están protegidos
              </span>
            </div>
          </div>
        </section>

        {/* Beneficios */}
        <section className="mt-8 flex gap-3">
          <Beneficio icon={<Clock className="size-5" strokeWidth={1.5} />} titulo="Ahorra tiempo" texto="Reserva en segundos desde tu celular." />
          <div className="w-px self-stretch" style={{ backgroundColor: AMORE.borde }} />
          <Beneficio icon={<Sparkles className="size-5" strokeWidth={1.5} />} titulo="Disponibilidad real" texto="Horarios actualizados al instante." />
          <div className="w-px self-stretch" style={{ backgroundColor: AMORE.borde }} />
          <Beneficio icon={<Gem className="size-5" strokeWidth={1.5} />} titulo="Trato premium" texto="Una experiencia pensada para ti." />
        </section>

        {/* WhatsApp CTA */}
        {whatsappHref && (
          <section className="mt-8">
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-5 py-4"
              style={{ backgroundColor: AMORE.burdeosSuave, borderRadius: 20 }}
            >
              <MessageCircle className="size-6 shrink-0" style={{ color: AMORE.burdeos }} strokeWidth={1.5} />
              <span className="flex-1">
                <span className="block text-[13.5px] font-semibold" style={{ color: AMORE.texto }}>
                  ¿Dudas? Escríbenos por WhatsApp
                </span>
                <span className="block text-[12px]" style={{ color: AMORE.textoSecundario }}>
                  Estamos para ayudarte.
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0" style={{ color: AMORE.burdeos }} />
            </a>
          </section>
        )}

        <footer className="mt-9 flex flex-col items-center gap-3 pb-2">
          <LineaSepararadora />
          <p className="text-[10px] font-medium uppercase tracking-[0.3em]" style={{ color: AMORE.textoSecundario }}>
            AMORE · Salón de belleza
          </p>
        </footer>
      </div>
    </div>
  );
}
