import { CalendarPlus, Clock, ShieldCheck, Heart, Sparkles, MessageCircle, ChevronRight, CalendarCheck2 } from "lucide-react";
import { cormorantGaramond, parisienne } from "@/lib/fonts-portal-daniela";

// Fase 8A.7 (autorizado) — landing visual del portal de cliente de Daniela,
// fiel al mockup entregado. Puramente de presentación: "Comenzar ahora"
// solo cambia de paso dentro de la MISMA página (app/reservar/[tenant]/
// page.tsx) -- no toca el motor de reservas, ni crea datos, ni cambia la
// lógica existente. El indicador de 4 pasos siempre muestra "1. Servicio"
// activo acá porque esta pantalla SOLO se ve antes de empezar el flujo real
// (el paso 1 -- selección de servicio -- es, en efecto, el estado real
// siguiente del proceso).

const ROSA = "#C94B78";
const ROSA_SUAVE = "#F8E8ED";
const ROSA_FONDO = "#FDF5F7";
const TEXTO = "#111111";
const TEXTO_SECUNDARIO = "#555555";
const BORDE = "#E8DDE1";

const serif = { fontFamily: "var(--font-cormorant-daniela), 'Cormorant Garamond', serif" };
const script = { fontFamily: "var(--font-parisienne-daniela), 'Parisienne', cursive" };

function LineaFlorReal({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="h-px w-16 sm:w-20" style={{ backgroundColor: ROSA }} />
      <Heart className="size-3.5 shrink-0" style={{ color: ROSA }} strokeWidth={1.5} />
      <span className="h-px w-16 sm:w-20" style={{ backgroundColor: ROSA }} />
    </div>
  );
}

function Hamburguesa() {
  return (
    <button type="button" aria-label="Menú" className="flex flex-col justify-center gap-[9px]" style={{ width: 26 }}>
      <span className="block h-[2px] w-full rounded-full" style={{ backgroundColor: TEXTO }} />
      <span className="block h-[2px] w-full rounded-full" style={{ backgroundColor: TEXTO }} />
      <span className="block h-[2px] w-full rounded-full" style={{ backgroundColor: TEXTO }} />
    </button>
  );
}

function PasoIndicador({ activo, numero, label }: { activo: boolean; numero: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="flex size-9 items-center justify-center rounded-full text-[14px] font-semibold"
        style={
          activo
            ? { backgroundColor: ROSA, color: "#fff" }
            : { backgroundColor: "#fff", color: TEXTO_SECUNDARIO, border: `1px solid ${BORDE}` }
        }
      >
        {numero}
      </div>
      <span className="text-center text-[11px] font-medium leading-tight" style={{ color: activo ? TEXTO : TEXTO_SECUNDARIO }}>
        {label}
      </span>
    </div>
  );
}

function Feature({ icon, texto }: { icon: React.ReactNode; texto: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-2 text-center">
      <div style={{ color: ROSA }}>{icon}</div>
      <p className="whitespace-pre-line text-[12px] font-medium leading-snug" style={{ color: TEXTO_SECUNDARIO }}>
        {texto}
      </p>
    </div>
  );
}

function Beneficio({ icon, titulo, texto }: { icon: React.ReactNode; titulo: string; texto: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-2.5 text-center">
      <div className="flex size-12 items-center justify-center rounded-full" style={{ backgroundColor: ROSA_SUAVE, color: ROSA }}>
        {icon}
      </div>
      <p className="text-[13.5px] font-semibold" style={{ color: TEXTO }}>
        {titulo}
      </p>
      <p className="text-[12px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
        {texto}
      </p>
    </div>
  );
}

export function PortalLandingDaniela({
  negocio,
  telefonoNegocio,
  onComenzar,
}: {
  negocio: string;
  telefonoNegocio: string | null;
  onComenzar: () => void;
}) {
  const whatsappHref = telefonoNegocio
    ? `https://wa.me/${telefonoNegocio}?text=${encodeURIComponent("Hola, tengo una duda sobre agendar mi cita")}`
    : null;

  return (
    <div
      className={`relative min-h-screen w-full bg-cover bg-no-repeat ${cormorantGaramond.variable} ${parisienne.variable}`}
      style={{ backgroundColor: ROSA_FONDO, backgroundImage: "url(/portal-background-828x1792.png)", backgroundPosition: "center top" }}
    >
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col">
        {/* Header */}
        <header className="flex items-start justify-between px-7 pt-9">
          <Hamburguesa />
          <div className="flex flex-col items-center gap-1">
            <Sparkles className="size-3.5" style={{ color: ROSA }} strokeWidth={1.5} />
            <p className="text-[19px] font-semibold uppercase tracking-tight" style={{ ...serif, color: TEXTO }}>
              Daniela Manco
            </p>
            <p className="text-[10px] font-medium uppercase tracking-[0.25em]" style={{ color: TEXTO_SECUNDARIO }}>
              Nails Spa
            </p>
          </div>
          <span className="w-[26px]" />
        </header>

        {/* Hero */}
        <section className="px-7 pt-9">
          <h1 className="text-[38px] font-semibold uppercase leading-[1.05]" style={{ ...serif, color: TEXTO }}>
            Tu belleza,
            <br />
            nuestra
          </h1>
          <p className="-mt-1 text-[46px] leading-none" style={{ ...script, color: ROSA }}>
            pasión
          </p>

          <LineaFlorReal className="mt-5" />

          <p className="mt-5 max-w-[280px] text-[14.5px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
            Agenda tu cita de manera rápida, fácil y segura. Elige tu servicio favorito y déjanos consentirte.
          </p>

          <div className="mt-7 flex gap-3">
            <Feature icon={<Sparkles className="size-5" strokeWidth={1.5} />} texto={"Uñas que\ninspiran"} />
            <Feature icon={<Heart className="size-5" strokeWidth={1.5} />} texto={"Cuidado\nen cada detalle"} />
            <Feature icon={<Sparkles className="size-5" strokeWidth={1.5} />} texto={"Más que un salón,\nuna experiencia"} />
          </div>
        </section>

        {/* Tarjeta principal */}
        <section className="mt-7 px-6">
          <div
            className="flex flex-col items-center px-6 py-8 text-center"
            style={{ backgroundColor: "rgba(255,255,255,0.94)", borderRadius: 36, boxShadow: "0 20px 60px -20px rgba(201,75,120,0.25)" }}
          >
            <div className="flex size-[72px] items-center justify-center rounded-full" style={{ backgroundColor: ROSA_SUAVE }}>
              <CalendarPlus className="size-8" style={{ color: ROSA }} strokeWidth={1.5} />
            </div>

            <h2 className="mt-5 text-[36px] font-semibold" style={{ ...serif, color: TEXTO }}>
              Agenda tu cita
            </h2>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: ROSA }}>
              En 4 sencillos pasos
            </p>

            <div className="mt-6 flex w-full items-start justify-between px-2">
              <PasoIndicador activo numero={1} label="Servicio" />
              <div className="mt-4 h-px flex-1" style={{ backgroundColor: BORDE }} />
              <PasoIndicador activo={false} numero={2} label="Horario" />
              <div className="mt-4 h-px flex-1" style={{ backgroundColor: BORDE }} />
              <PasoIndicador activo={false} numero={3} label="Tus datos" />
              <div className="mt-4 h-px flex-1" style={{ backgroundColor: BORDE }} />
              <PasoIndicador activo={false} numero={4} label="Confirmación" />
            </div>

            <button
              type="button"
              onClick={onComenzar}
              className="mt-7 flex w-full items-center justify-center gap-2 py-4 text-[16px] font-semibold text-white transition-transform active:scale-[0.98]"
              style={{ backgroundColor: ROSA, borderRadius: 32 }}
            >
              Comenzar ahora
              <ChevronRight className="size-5" strokeWidth={2} />
            </button>

            <div className="mt-4 flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" style={{ color: ROSA }} strokeWidth={1.5} />
              <span className="text-[11.5px]" style={{ color: TEXTO_SECUNDARIO }}>
                Tus datos están protegidos
              </span>
            </div>
          </div>
        </section>

        {/* Beneficios */}
        <section className="mt-8 flex gap-3 px-7">
          <Beneficio icon={<Clock className="size-5" strokeWidth={1.5} />} titulo="Ahorra tiempo" texto="Agenda en segundos desde donde estés." />
          <div className="w-px self-stretch" style={{ backgroundColor: BORDE, opacity: 0.6 }} />
          <Beneficio icon={<CalendarCheck2 className="size-5" strokeWidth={1.5} />} titulo="Disponibilidad real" texto="Consulta horarios actualizados al instante." />
          <div className="w-px self-stretch" style={{ backgroundColor: BORDE, opacity: 0.6 }} />
          <Beneficio icon={<Heart className="size-5" strokeWidth={1.5} />} titulo="Experiencia única" texto="Un momento especial solo para ti." />
        </section>

        {/* WhatsApp CTA */}
        <section className="mt-8 px-7">
          {whatsappHref ? (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-5 py-4"
              style={{ backgroundColor: ROSA_SUAVE, borderRadius: 22 }}
            >
              <MessageCircle className="size-6 shrink-0" style={{ color: ROSA }} strokeWidth={1.5} />
              <span className="flex-1">
                <span className="block text-[13.5px] font-semibold" style={{ color: TEXTO }}>
                  ¿Dudas? Escríbenos por WhatsApp
                </span>
                <span className="block text-[12px]" style={{ color: TEXTO_SECUNDARIO }}>
                  Estamos para ayudarte.
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0" style={{ color: ROSA }} />
            </a>
          ) : null}
        </section>

        {/* Footer */}
        <footer className="mt-9 flex flex-col items-center gap-3 px-7 pb-9">
          <LineaFlorReal />
          <p className="text-[10.5px] font-medium uppercase tracking-[0.3em]" style={{ color: TEXTO_SECUNDARIO }}>
            Belleza en buenas manos
          </p>
        </footer>
      </div>
      <span className="sr-only">{negocio}</span>
    </div>
  );
}
