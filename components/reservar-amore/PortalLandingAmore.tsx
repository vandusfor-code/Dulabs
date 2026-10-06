import { CalendarPlus, Clock, ShieldCheck, Sparkles, MessageCircle, ChevronRight, Gem } from "lucide-react";
import { BarraAccionAmore, ContinuarAmore } from "./MarcoPasoAmore";
import { AMORE, serifAmore } from "./tema";

// AMORE (Fase 3 del portal, autorizado) — landing propia del portal de
// AMORE, identidad visual distinta a la de Daniela (paleta burdeos/dorado
// sobre crema, un solo serif elegante, sin imagen de fondo importada de
// otro tenant). Puramente de presentación: "Comenzar ahora" solo cambia de
// paso dentro de la MISMA página (app/reservar/amore/page.tsx) -- no toca
// el motor de reservas, ni crea datos.
//
// Pensada para el celular: más compacta que antes y con «Comenzar ahora»
// pegado abajo (siempre a la vista, sin bajar hasta el final de la página).

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
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="flex size-8 items-center justify-center rounded-full text-[13px] font-semibold"
        style={
          activo
            ? { backgroundColor: AMORE.burdeos, color: "#fff" }
            : { backgroundColor: "#fff", color: AMORE.textoSecundario, border: `1px solid ${AMORE.borde}` }
        }
      >
        {numero}
      </div>
      <span className="text-center text-[10.5px] font-medium leading-tight" style={{ color: activo ? AMORE.texto : AMORE.textoSecundario }}>
        {label}
      </span>
    </div>
  );
}

function Beneficio({ icon, titulo, texto }: { icon: React.ReactNode; titulo: string; texto: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-2 text-center">
      <div className="flex size-11 items-center justify-center rounded-full" style={{ backgroundColor: AMORE.doradoSuave, color: AMORE.dorado }}>
        {icon}
      </div>
      <p className="text-[13px] font-semibold" style={{ color: AMORE.texto }}>
        {titulo}
      </p>
      <p className="text-[11.5px] leading-relaxed" style={{ color: AMORE.textoSecundario }}>
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
    <div className="relative min-h-dvh w-full" style={{ backgroundColor: AMORE.fondo }}>
      <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col">
        <div className="flex-1 px-5 pb-6 pt-[max(20px,env(safe-area-inset-top))]">
          {/* Monograma + nombre real del negocio (nunca hardcodeado) */}
          <header className="flex flex-col items-center gap-2.5">
            <div
              className="flex size-12 items-center justify-center rounded-full text-[20px] font-semibold"
              style={{ backgroundColor: AMORE.burdeos, color: "#fff", ...serifAmore }}
            >
              A
            </div>
            <p className="max-w-[260px] truncate text-[13.5px] font-semibold uppercase tracking-[0.25em]" style={{ color: AMORE.texto }}>
              {negocio}
            </p>
          </header>

          {/* Hero */}
          <section className="mt-6 text-center">
            <h1 className="text-[32px] font-semibold leading-[1.1]" style={{ ...serifAmore, color: AMORE.texto }}>
              Un momento
              <br />
              solo para ti
            </h1>

            <div className="mt-4">
              <LineaSepararadora />
            </div>

            <p className="mx-auto mt-4 max-w-[300px] text-[14px] leading-relaxed" style={{ color: AMORE.textoSecundario }}>
              Reserva tu cita en {negocio} en unos segundos. Elige uno o varios servicios, tu profesional favorita y el horario que mejor te convenga.
            </p>
          </section>

          {/* Tarjeta principal */}
          <section className="mt-6">
            <div
              className="flex flex-col items-center px-5 py-6 text-center"
              style={{ backgroundColor: "#fff", borderRadius: 28, border: `1px solid ${AMORE.borde}`, boxShadow: "0 24px 60px -30px rgba(107,39,55,0.25)" }}
            >
              <div className="flex size-14 items-center justify-center rounded-full" style={{ backgroundColor: AMORE.burdeosSuave }}>
                <CalendarPlus className="size-7" style={{ color: AMORE.burdeos }} strokeWidth={1.5} />
              </div>

              <h2 className="mt-3 text-[24px] font-semibold" style={{ ...serifAmore, color: AMORE.texto }}>
                Agenda tu cita
              </h2>
              <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: AMORE.dorado }}>
                En pocos pasos
              </p>

              <div className="mt-5 flex w-full items-start justify-between px-1">
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

              <div className="mt-4 flex items-center gap-1.5">
                <ShieldCheck className="size-3.5" style={{ color: AMORE.dorado }} strokeWidth={1.5} />
                <span className="text-[11.5px]" style={{ color: AMORE.textoSecundario }}>
                  Tus datos están protegidos
                </span>
              </div>
            </div>
          </section>

          {/* Beneficios */}
          <section className="mt-6 flex gap-3">
            <Beneficio icon={<Clock className="size-5" strokeWidth={1.5} />} titulo="Ahorra tiempo" texto="Reserva en segundos desde tu celular." />
            <div className="w-px self-stretch" style={{ backgroundColor: AMORE.borde }} />
            <Beneficio icon={<Sparkles className="size-5" strokeWidth={1.5} />} titulo="Disponibilidad real" texto="Horarios actualizados al instante." />
            <div className="w-px self-stretch" style={{ backgroundColor: AMORE.borde }} />
            <Beneficio icon={<Gem className="size-5" strokeWidth={1.5} />} titulo="Trato premium" texto="Una experiencia pensada para ti." />
          </section>

          {/* WhatsApp CTA */}
          {whatsappHref && (
            <section className="mt-6">
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

          <footer className="mt-8 flex flex-col items-center gap-3">
            <LineaSepararadora />
            <p className="text-[10px] font-medium uppercase tracking-[0.3em]" style={{ color: AMORE.textoSecundario }}>
              AMORE · Salón de belleza
            </p>
          </footer>
        </div>

        <BarraAccionAmore>
          <ContinuarAmore onClick={onComenzar} etiqueta="Comenzar ahora" llena />
        </BarraAccionAmore>
      </div>
    </div>
  );
}
