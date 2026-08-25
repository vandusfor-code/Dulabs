"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Download, FileUp, X } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { useI18n } from "@/lib/i18n";
import { AgenteIcono } from "@/components/dashboard/marketplace/AgenteIcono";
import type { MarketplaceEstado, AgenteVista, NumeroVista } from "@/components/dashboard/marketplace/tipos";

const PASOS = [
  { es: "Activa el agente", en: "Activate the agent", descEs: "Elige el plan que mejor se adapte.", descEn: "Pick the plan that fits best." },
  { es: "Selecciona el número", en: "Select the number", descEs: "El número de WhatsApp donde quieres activarlo.", descEn: "The WhatsApp number to activate it on." },
  { es: "Configura tu negocio", en: "Configure your business", descEs: "Escribe tus servicios, precios y horarios.", descEn: "Write your services, prices and hours." },
  { es: "Listo", en: "Done", descEs: "Tu agente queda funcionando 24/7 en minutos.", descEn: "Your agent is up and running 24/7 in minutes." },
];

function fmtFecha(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });
}

export default function MarketplaceDetallePage() {
  const { session } = useDashboard();
  const { t } = useI18n();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [estado, setEstado] = useState<MarketplaceEstado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [tipoPlan, setTipoPlan] = useState<"recurrente" | "mes">("recurrente");

  const cargar = useCallback(() => {
    if (!session) return;
    fetch("/api/dashboard/marketplace", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? t("Error cargando el agente", "Error loading the agent"));
        setEstado(json as MarketplaceEstado);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session, t]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const agente = estado?.agentes.find((a) => a.slug === slug) ?? null;
  const numerosDisponibles = useMemo(
    () => (estado?.numeros ?? []).filter((n) => !n.marketplaceSlug),
    [estado]
  );

  if (error) {
    return (
      <div className="px-4 pt-8 md:px-8">
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">{error}</p>
      </div>
    );
  }
  if (!estado || !agente) {
    return <div className="px-4 pt-8 text-sm text-mist md:px-8">{t("Cargando…", "Loading…")}</div>;
  }

  const activo = agente.activacion;

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-mist">
        <Link href="/dashboard/marketplace" className="hover:text-fg">Marketplace</Link>
        <ChevronRight className="size-3.5" />
        <span className="text-fg">{agente.nombre}</span>
      </nav>

      {/* Header */}
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <AgenteIcono icono={agente.icono} />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-fg">{agente.nombre}</h1>
            <p className="mt-0.5 text-sm text-mist">{agente.categoria}</p>
          </div>
        </div>
        {!activo && (
          <button
            onClick={() => setModalAbierto(true)}
            className="rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-lime-fg transition-opacity hover:opacity-90"
          >
            {t("Activar agente", "Activate agent")}
          </button>
        )}
      </div>

      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-mist">{agente.descripcion}</p>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Columna izquierda */}
        <div className="space-y-6">
          {/* Qué incluye */}
          <section className="rounded-2xl border border-edge bg-card p-6">
            <h2 className="text-lg font-semibold text-fg">{t("Qué incluye", "What's included")}</h2>
            <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {agente.queIncluye.map((item) => (
                <div key={item} className="flex items-start gap-2.5 text-sm text-fg/90">
                  <Check className="mt-0.5 size-4 shrink-0 text-lime-text" />
                  {item}
                </div>
              ))}
            </div>
          </section>

          {/* Vista previa de conversación */}
          <section className="rounded-2xl border border-edge bg-card p-6">
            <h2 className="text-lg font-semibold text-fg">{t("Vista previa de conversación", "Conversation preview")}</h2>
            <div className="mt-4 space-y-2">
              <ChatMsg lado="in">{t("Hola, ¿tienen disponibilidad para mañana en la tarde?", "Hi, do you have availability tomorrow afternoon?")}</ChatMsg>
              <ChatMsg lado="out">{t("¡Hola! Sí, tenemos espacio a las 3:00 p.m. y 4:30 p.m. ¿Cuál prefieres?", "Hi! Yes, we have 3:00 p.m. and 4:30 p.m. available. Which do you prefer?")}</ChatMsg>
              <ChatMsg lado="in">{t("A las 3:00 está perfecto.", "3:00 works perfectly.")}</ChatMsg>
              <ChatMsg lado="out">{t("Listo, te esperamos mañana a las 3:00 p.m. ¡Gracias!", "Done, we'll see you tomorrow at 3:00 p.m. Thanks!")}</ChatMsg>
            </div>
            <p className="mt-3 text-xs text-mist">{t("* Ejemplo de conversación con clientes.", "* Example conversation with customers.")}</p>
          </section>

          {/* FAQ */}
          <FaqMarketplace t={t} />
        </div>

        {/* Columna derecha */}
        <div className="space-y-6">
          {/* Cómo funciona */}
          <section className="rounded-2xl border border-edge bg-card p-6">
            <h2 className="text-lg font-semibold text-fg">{t("Cómo funciona", "How it works")}</h2>
            <ol className="mt-4 space-y-4">
              {PASOS.map((p, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-edge font-mono text-xs text-fg">
                    {i + 1}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-fg">{t(p.es, p.en)}</div>
                    <div className="text-xs text-mist">{t(p.descEs, p.descEn)}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* Plan selector o Administrar */}
          {activo ? (
            <AdministrarAgente agente={agente} onCambio={cargar} t={t} />
          ) : (
            <section className="rounded-2xl border border-edge bg-card p-6">
              <h2 className="text-lg font-semibold text-fg">{t("Plan de pago", "Payment plan")}</h2>
              <div className="mt-4 space-y-3">
                <button
                  type="button"
                  onClick={() => setTipoPlan("recurrente")}
                  className={`w-full rounded-xl border p-4 text-left transition-colors ${
                    tipoPlan === "recurrente" ? "border-lime/60 bg-lime/5" : "border-edge hover:border-lime/30"
                  }`}
                >
                  <div className="text-xs font-medium text-lime-text">
                    {t(`Recomendado — ahorras $${(agente.precioMes - agente.precioRecurrente).toLocaleString("es-CO")}/mes`, `Recommended — save $${(agente.precioMes - agente.precioRecurrente).toLocaleString("es-CO")}/mo`)}
                  </div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-2xl font-semibold text-fg">${agente.precioRecurrente.toLocaleString("es-CO")}</span>
                    <span className="text-sm text-mist">{t("/ mes", "/ mo")}</span>
                  </div>
                  <p className="mt-1 text-xs text-mist">{t("Cobro automático cada mes. Cancela cuando quieras.", "Automatic monthly billing. Cancel anytime.")}</p>
                </button>
                <button
                  type="button"
                  onClick={() => setTipoPlan("mes")}
                  className={`w-full rounded-xl border p-4 text-left transition-colors ${
                    tipoPlan === "mes" ? "border-lime/60 bg-lime/5" : "border-edge hover:border-lime/30"
                  }`}
                >
                  <div className="text-sm font-medium text-fg">{t("Un solo mes", "One month only")}</div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-2xl font-semibold text-fg">${agente.precioMes.toLocaleString("es-CO")}</span>
                    <span className="text-sm text-mist">{t("/ 1 mes", "/ 1 month")}</span>
                  </div>
                  <p className="mt-1 text-xs text-mist">{t("Pago único por 1 mes. Sin permanencia.", "Single payment for 1 month. No commitment.")}</p>
                </button>
              </div>
              <button
                onClick={() => setModalAbierto(true)}
                className="mt-4 w-full rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-lime-fg transition-opacity hover:opacity-90"
              >
                {t("Activar agente", "Activate agent")}
              </button>
            </section>
          )}
        </div>
      </div>

      {modalAbierto && (
        <ModalActivar
          agente={agente}
          tipoPlan={tipoPlan}
          numeros={numerosDisponibles}
          accessToken={session?.access_token}
          onClose={() => setModalAbierto(false)}
          onFinalizado={() => {
            setModalAbierto(false);
            cargar();
          }}
          t={t}
        />
      )}
    </div>
  );
}

function ChatMsg({ lado, children }: { lado: "in" | "out"; children: React.ReactNode }) {
  return (
    <div
      className={`max-w-[80%] rounded-xl px-3 py-2 text-[13px] ${
        lado === "in" ? "rounded-tl-sm bg-ink text-fg/90" : "ml-auto rounded-tr-sm bg-card text-fg ring-1 ring-edge"
      }`}
    >
      {children}
    </div>
  );
}

function FaqMarketplace({ t }: { t: (es: string, en: string) => string }) {
  const faqs = [
    {
      q: t("¿Puedo cambiar el número donde tengo activo el agente?", "Can I change the number the agent is active on?"),
      a: t(
        "Sí. Puedes desactivarlo de un número (vuelve a tu agente propio, sin perder tu configuración) y activarlo en otro cuando quieras.",
        "Yes. You can deactivate it from a number (it returns to your own agent, without losing your setup) and activate it on another whenever you want."
      ),
    },
    {
      q: t("¿Qué pasa si cancelo mi plan?", "What happens if I cancel?"),
      a: t(
        "El agente se desactiva y el número vuelve automáticamente a tu propio agente, con la configuración que ya tenías guardada.",
        "The agent is deactivated and the number automatically returns to your own agent, with the setup you already had saved."
      ),
    },
    {
      q: t("¿Necesito conocimientos técnicos para configurarlo?", "Do I need technical knowledge to set it up?"),
      a: t(
        "No. Escribes en un cuadro de texto los datos de tu negocio (dirección, horario, servicios y precios) y listo. Nada de código. Si prefieres, también puedes subir una plantilla de Excel.",
        "No. You type your business info (address, hours, services and prices) into a text box and you're done. No code. If you prefer, you can also upload an Excel template."
      ),
    },
    {
      q: t("¿El agente funciona fuera del horario de atención?", "Does the agent work outside business hours?"),
      a: t(
        "Sí. Responde 24/7 con la información de tu negocio. Si un cliente escribe de madrugada, el agente atiende igual.",
        "Yes. It replies 24/7 with your business info. If a customer writes at night, the agent still responds."
      ),
    },
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="rounded-2xl border border-edge bg-card p-6">
      <h2 className="text-lg font-semibold text-fg">{t("Preguntas frecuentes", "Frequently asked questions")}</h2>
      <div className="mt-2">
        {faqs.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={i} className="border-t border-edge first:border-t-0">
              <button onClick={() => setOpen(isOpen ? null : i)} className="flex w-full items-center justify-between gap-4 py-4 text-left">
                <span className="text-sm font-medium text-fg">{f.q}</span>
                <ChevronRight className={`size-4 shrink-0 text-mist transition-transform ${isOpen ? "rotate-90" : ""}`} />
              </button>
              {isOpen && <p className="pb-4 text-sm leading-relaxed text-mist">{f.a}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AdministrarAgente({ agente, onCambio, t }: { agente: AgenteVista; onCambio: () => void; t: (es: string, en: string) => string }) {
  const { session } = useDashboard();
  const act = agente.activacion!;
  const [desactivando, setDesactivando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editarConfig = async (archivo: File | null) => {
    if (!session || !archivo) return;
    setEditando(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("phone_number_id", act.phone_number_id);
      form.append("config", archivo);
      const res = await fetch("/api/dashboard/marketplace/config", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("Error actualizando la configuración", "Error updating configuration"));
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditando(false);
    }
  };

  const desactivar = async () => {
    if (!session) return;
    if (!window.confirm(t("¿Desactivar el agente y volver a tu agente propio en este número?", "Deactivate the agent and return to your own agent on this number?"))) return;
    setDesactivando(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/marketplace/desactivar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ phone_number_id: act.phone_number_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("Error desactivando", "Error deactivating"));
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDesactivando(false);
    }
  };

  return (
    <section className="rounded-2xl border border-lime/40 bg-card p-6">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-lime" />
        <span className="text-sm font-semibold text-lime-text">{t("Agente activo", "Agent active")}</span>
      </div>
      <dl className="mt-4 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-mist">{t("Número", "Number")}</dt>
          <dd className="font-medium text-fg">{act.nombre_negocio}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-mist">{t("Plan", "Plan")}</dt>
          <dd className="font-medium text-fg">{act.tipo_plan === "recurrente" ? t("Mensual recurrente", "Monthly recurring") : t("Un solo mes", "One month")}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-mist">{act.tipo_plan === "recurrente" ? t("Próximo cobro", "Next charge") : t("Vence", "Expires")}</dt>
          <dd className="font-medium text-fg">{fmtFecha(act.tipo_plan === "recurrente" ? act.fecha_proximo_cobro : act.vence_at)}</dd>
        </div>
        {act.numero_admin && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-mist">{t("Número admin", "Admin number")}</dt>
            <dd className="font-medium text-fg">{act.nombre_admin ? `${act.nombre_admin} · ` : ""}{act.numero_admin}</dd>
          </div>
        )}
      </dl>

      {/* Próximas citas — solo agentes con agenda (Barbería, Clínica, Gimnasio,
          Inmobiliaria, Abogado). Cancelar/reagendar se hace por WhatsApp; esto
          es solo un vistazo, no duplica esa gestión aquí. */}
      {act.citasProximas && (
        <div className="mt-4 border-t border-edge pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-mist">{t("Próximas citas", "Upcoming appointments")}</p>
          {act.citasProximas.total === 0 ? (
            <p className="mt-2 text-sm text-mist">{t("Sin citas próximas agendadas.", "No upcoming appointments.")}</p>
          ) : (
            <>
              <ul className="mt-2 space-y-1.5 text-sm">
                {act.citasProximas.proximas.map((c, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="text-fg/90">{c.cliente}</span>
                    <span className="text-mist">{fmtFecha(c.fecha)} · {c.hora}</span>
                  </li>
                ))}
              </ul>
              {act.citasProximas.total > act.citasProximas.proximas.length && (
                <p className="mt-1.5 text-xs text-mist">
                  {t(`+ ${act.citasProximas.total - act.citasProximas.proximas.length} más`, `+ ${act.citasProximas.total - act.citasProximas.proximas.length} more`)}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      <div className="mt-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-xs font-medium text-fg hover:border-lime/40">
            <FileUp className="size-3.5" /> {editando ? t("Actualizando…", "Updating…") : t("Editar configuración", "Edit configuration")}
            <input
              type="file"
              accept=".xlsx"
              className="hidden"
              disabled={editando}
              onChange={(e) => editarConfig(e.target.files?.[0] ?? null)}
            />
          </label>
          <a
            href="/plantillas/agente-config-plantilla.xlsx"
            download
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-xs font-medium text-fg hover:border-lime/40"
          >
            <Download className="size-3.5" /> {t("Plantilla", "Template")}
          </a>
        </div>
        <button
          onClick={desactivar}
          disabled={desactivando}
          className="self-start text-sm text-mist underline-offset-4 hover:text-fg hover:underline disabled:opacity-50"
        >
          {desactivando ? t("Desactivando…", "Deactivating…") : t("Desactivar y volver a mi agente", "Deactivate and return to my agent")}
        </button>
      </div>
    </section>
  );
}

type PasoModal = "numero" | "config" | "confirmacion";

function ModalActivar({
  agente,
  tipoPlan,
  numeros,
  accessToken,
  onClose,
  onFinalizado,
  t,
}: {
  agente: AgenteVista;
  tipoPlan: "recurrente" | "mes";
  numeros: NumeroVista[];
  accessToken?: string;
  onClose: () => void;
  onFinalizado: () => void;
  t: (es: string, en: string) => string;
}) {
  const [paso, setPaso] = useState<PasoModal>("numero");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  // La configuración se escribe aquí mismo. El Excel quedó como atajo
  // opcional: exigirlo antes de poder comprar costaba ventas de quien no
  // lograba llenarlo.
  const [textoNegocio, setTextoNegocio] = useState("");
  const [nombreAdmin, setNombreAdmin] = useState("");
  const [numeroAdmin, setNumeroAdmin] = useState("");
  const [recursos, setRecursos] = useState("1");
  const [duracion, setDuracion] = useState("30");
  const [activando, setActivando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ fecha_proximo_cobro: string | null; vence_at: string | null; tipo_plan: "recurrente" | "mes" } | null>(null);

  const precio = tipoPlan === "recurrente" ? agente.precioRecurrente : agente.precioMes;
  const numeroElegido = numeros.find((n) => n.phone_number_id === phoneNumberId) ?? null;

  const activar = async () => {
    if (!accessToken) return;
    if (!archivo && textoNegocio.trim().length === 0) {
      return setError(
        t(
          "Cuéntanos sobre tu negocio para que el agente sepa qué responder.",
          "Tell us about your business so the agent knows what to answer."
        )
      );
    }
    setActivando(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("slug", agente.slug);
      form.append("phone_number_id", phoneNumberId);
      form.append("tipo_plan", tipoPlan);
      if (archivo) {
        form.append("config", archivo);
      } else {
        form.append("texto_negocio", textoNegocio.trim());
        form.append("nombre_admin", nombreAdmin.trim());
        form.append("numero_admin", numeroAdmin.trim());
        form.append("recursos_disponibles", recursos);
        form.append("duracion_estandar_min", duracion);
      }
      const res = await fetch("/api/dashboard/marketplace/activar", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("No se pudo activar el agente", "Could not activate the agent"));
      setResultado(data.activacion);
      setPaso("confirmacion");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActivando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={paso === "confirmacion" ? undefined : onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-edge bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {paso !== "confirmacion" && (
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-fg">{t("Activar", "Activate")} {agente.nombre}</h3>
            <button onClick={onClose} aria-label={t("Cerrar", "Close")} className="text-mist hover:text-fg"><X className="size-5" /></button>
          </div>
        )}

        {paso === "numero" && (
          <>
            {numeros.length === 0 ? (
              <p className="mt-4 rounded-lg border border-edge bg-ink p-4 text-sm text-mist">
                {t(
                  "No tienes números de WhatsApp disponibles (todos tienen ya un agente del marketplace activo, o aún no has conectado ninguno).",
                  "You have no available WhatsApp numbers (they all already have a marketplace agent active, or you haven't connected any yet)."
                )}
              </p>
            ) : (
              <>
                <p className="mt-4 text-xs font-medium uppercase tracking-wide text-mist">
                  {t("¿A qué número deseas activar este agente?", "Which number do you want to activate this agent on?")}
                </p>
                <div className="mt-2 space-y-2">
                  {numeros.map((n) => (
                    <label
                      key={n.phone_number_id}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-colors ${
                        phoneNumberId === n.phone_number_id ? "border-lime/60 bg-lime/5" : "border-edge hover:border-lime/30"
                      }`}
                    >
                      <input
                        type="radio"
                        name="numero"
                        value={n.phone_number_id}
                        checked={phoneNumberId === n.phone_number_id}
                        onChange={() => setPhoneNumberId(n.phone_number_id)}
                        className="size-4 accent-lime"
                      />
                      <span className="text-sm font-medium text-fg">{n.nombre_negocio}</span>
                    </label>
                  ))}
                </div>

                <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
                  <p className="text-xs leading-relaxed text-mist">
                    {t(
                      "Al activarlo en ese número, se desactiva temporalmente tu agente propio (o base de conocimiento) de ese número. No se borra: puedes volver a él cuando quieras desde \"Desactivar y volver a mi agente\".",
                      "Activating it on that number temporarily disables your own agent (or knowledge base) for that number. It isn't deleted: you can go back to it anytime from \"Deactivate and return to my agent\"."
                    )}
                  </p>
                </div>

                {error && <p className="mt-4 text-xs text-red-400">{error}</p>}

                <button
                  onClick={() => {
                    setError(null);
                    setPaso("config");
                  }}
                  disabled={!phoneNumberId}
                  className="mt-5 w-full rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t("Continuar", "Continue")}
                </button>
              </>
            )}
          </>
        )}

        {paso === "config" && (
          <>
            <div className="mt-5">
              <label htmlFor="texto-negocio" className="text-xs font-medium uppercase tracking-wide text-mist">
                {t("Información de tu negocio", "Your business information")}
              </label>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist">
                {t(
                  "Esto es lo único que tu agente va a poder responder. Entre más detalle escribas, mejor atiende — y nunca se inventará nada que no esté aquí.",
                  "This is the only thing your agent will be able to answer. The more detail you write, the better it performs — and it will never make up anything that isn't here."
                )}
              </p>
              <textarea
                id="texto-negocio"
                value={textoNegocio}
                onChange={(e) => setTextoNegocio(e.target.value)}
                rows={9}
                disabled={!!archivo}
                placeholder={t(
                  `Ejemplo:\n\nDirección: Cra 8 #22-15, Montería\nHorario: lunes a sábado 8am-7pm\n\nServicios y precios:\n- Corte de cabello $25.000\n- Corte + barba $35.000\n- Tinte desde $60.000\n\nFormas de pago: efectivo, Nequi, Daviplata\n\nOtros datos: parqueadero disponible, se atiende sin cita si hay silla libre.`,
                  `Example:\n\nAddress: 123 Main St\nHours: Mon-Sat 8am-7pm\n\nServices and prices:\n- Haircut $25\n- Haircut + beard $35\n\nPayment methods: cash, card`
                )}
                className="mt-2 w-full rounded-lg border border-edge bg-ink px-3 py-2.5 text-sm text-fg outline-none transition-colors placeholder:text-mist/60 focus:border-lime/50 disabled:opacity-40"
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="nombre-admin" className="text-xs font-medium uppercase tracking-wide text-mist">
                  {t("Tu nombre", "Your name")}
                </label>
                <input
                  id="nombre-admin"
                  value={nombreAdmin}
                  onChange={(e) => setNombreAdmin(e.target.value)}
                  disabled={!!archivo}
                  placeholder={t("Opcional", "Optional")}
                  className="mt-1.5 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-lime/50 disabled:opacity-40"
                />
              </div>
              <div>
                <label htmlFor="numero-admin" className="text-xs font-medium uppercase tracking-wide text-mist">
                  {t("Tu WhatsApp", "Your WhatsApp")}
                </label>
                <input
                  id="numero-admin"
                  value={numeroAdmin}
                  onChange={(e) => setNumeroAdmin(e.target.value)}
                  disabled={!!archivo}
                  placeholder="3001234567"
                  className="mt-1.5 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-lime/50 disabled:opacity-40"
                />
                <p className="mt-1 text-[11px] leading-relaxed text-mist">
                  {t("Para que el agente te reconozca a ti y no te trate como cliente.", "So the agent recognizes you and doesn't treat you as a customer.")}
                </p>
              </div>
            </div>

            {agente.usaAgenda && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="recursos" className="text-xs font-medium uppercase tracking-wide text-mist">
                    {t("Citas a la vez", "Simultaneous appointments")}
                  </label>
                  <input
                    id="recursos"
                    type="number"
                    min={1}
                    value={recursos}
                    onChange={(e) => setRecursos(e.target.value)}
                    disabled={!!archivo}
                    className="mt-1.5 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-lime/50 disabled:opacity-40"
                  />
                  <p className="mt-1 text-[11px] leading-relaxed text-mist">
                    {t("Cuántas personas puedes atender al mismo tiempo (sillas, consultorios, canchas).", "How many people you can serve at once.")}
                  </p>
                </div>
                <div>
                  <label htmlFor="duracion" className="text-xs font-medium uppercase tracking-wide text-mist">
                    {t("Duración de cada cita", "Length of each appointment")}
                  </label>
                  <input
                    id="duracion"
                    type="number"
                    min={5}
                    step={5}
                    value={duracion}
                    onChange={(e) => setDuracion(e.target.value)}
                    disabled={!!archivo}
                    className="mt-1.5 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-lime/50 disabled:opacity-40"
                  />
                  <p className="mt-1 text-[11px] leading-relaxed text-mist">{t("En minutos.", "In minutes.")}</p>
                </div>
              </div>
            )}

            <details className="mt-4 rounded-lg border border-edge/70 px-3 py-2">
              <summary className="cursor-pointer text-[11.5px] text-mist">
                {t("¿Prefieres subir la plantilla de Excel?", "Prefer to upload the Excel template?")}
              </summary>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <a
                  href="/plantillas/agente-config-plantilla.xlsx"
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-xs font-medium text-fg hover:border-lime/40"
                >
                  <Download className="size-3.5" /> {t("Descargar plantilla", "Download template")}
                </a>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-xs font-medium text-fg hover:border-lime/40">
                  <FileUp className="size-3.5" /> {archivo ? archivo.name : t("Subir plantilla llena", "Upload filled template")}
                  <input
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
                  />
                </label>
                {archivo && (
                  <button
                    type="button"
                    onClick={() => setArchivo(null)}
                    className="text-xs text-mist underline hover:text-fg"
                  >
                    {t("Quitar archivo", "Remove file")}
                  </button>
                )}
              </div>
              {archivo && (
                <p className="mt-2 text-[11px] leading-relaxed text-mist">
                  {t(
                    "Se usará la plantilla; los campos de arriba quedan desactivados.",
                    "The template will be used; the fields above are disabled."
                  )}
                </p>
              )}
            </details>

            {error && <p className="mt-4 text-xs text-red-400">{error}</p>}

            <div className="mt-6 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setPaso("numero");
                }}
                className="rounded-lg border border-edge px-4 py-2.5 text-sm font-medium text-fg hover:border-lime/40"
              >
                {t("Atrás", "Back")}
              </button>
              <button
                onClick={activar}
                disabled={activando}
                className="flex-1 rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {activando
                  ? t("Activando…", "Activating…")
                  : t(`Activar y pagar $${precio.toLocaleString("es-CO")}`, `Activate and pay $${precio.toLocaleString("es-CO")}`)}
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-mist">
              {t("Se cobra al método de pago de tu plan.", "Charged to your plan's payment method.")}
            </p>
          </>
        )}

        {paso === "confirmacion" && resultado && (
          <div className="py-4 text-center">
            <CheckCircle2 className="mx-auto size-12 text-lime-text" strokeWidth={1.5} />
            <h3 className="mt-4 text-lg font-semibold text-fg">{t("Tu agente está activo", "Your agent is active")}</h3>
            <p className="mt-1.5 text-sm text-mist">
              {agente.nombre} · {numeroElegido?.nombre_negocio}
            </p>
            <p className="mt-3 text-sm text-fg">
              {resultado.tipo_plan === "recurrente"
                ? t(`Próximo cobro: ${fmtFecha(resultado.fecha_proximo_cobro)}`, `Next charge: ${fmtFecha(resultado.fecha_proximo_cobro)}`)
                : t(`Vence: ${fmtFecha(resultado.vence_at)}`, `Expires: ${fmtFecha(resultado.vence_at)}`)}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <button
                onClick={onFinalizado}
                className="w-full rounded-lg bg-lime px-5 py-2.5 text-sm font-semibold text-lime-fg transition-opacity hover:opacity-90"
              >
                {t("Ir a Administrar", "Go to Manage")}
              </button>
              <Link
                href="/dashboard/marketplace"
                className="w-full rounded-lg border border-edge px-5 py-2.5 text-sm font-medium text-fg hover:border-lime/40"
              >
                {t("Volver al listado", "Back to listing")}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
