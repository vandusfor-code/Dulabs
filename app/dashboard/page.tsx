"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  MessagesSquare,
  Bot,
  Send,
  Phone,
  ArrowUpRight,
  LayoutTemplate,
  Clock,
  User,
  MessageCircle,
} from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { formatearTelefono, CALIDAD_INFO } from "@/lib/format";
import { PageHeader, StatTile, Pill, PlanUsageCard } from "@/components/dashboard/shell/ui";
import { AreaTrend, Donut } from "@/components/dashboard/shell/charts";

type Resumen = {
  conversaciones24h: number;
  tasaAutomatizacion: number;
  plantillasPendientes: number;
  campanasHoy: number;
  porCategoriaMes: { categoria: string; cantidad: number }[];
  tiempoRespuestaSeg: number | null;
  mejorAgente: { nombre: string; tasaAutomatizacion: number } | null;
  autopilot: { resueltoPorIA: number; atendidoManual: number; sinResponder: number };
  actividadReciente: { tipo: string; descripcion: string; created_at: string }[];
  deltaConversacionesPct: number | null;
  deltaAutomatizacionPts: number | null;
  deltaTiempoRespuestaSeg: number | null;
};

type Dia = { fecha: string; cantidad: number; entrante: number; saliente: number };

type CampanaPreview = {
  id: number;
  nombre: string;
  destinatarios_total: number;
  created_at: string;
  estado: "completado" | "fallido";
  funnel: { sent: number; delivered: number; read: number; replied: number };
};

function nombreDesdeEmail(email: string | undefined): string {
  if (!email) return "";
  const prefijo = email.split("@")[0] ?? "";
  return prefijo
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}

function formatearHace(iso: string): string {
  const seg = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seg < 60) return `hace ${seg}s`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `hace ${min}m`;
  const hor = Math.floor(min / 60);
  if (hor < 24) return `hace ${hor}h`;
  return `hace ${Math.floor(hor / 24)}d`;
}

function formatearDuracion(seg: number): string {
  if (seg < 60) return `${Math.round(seg)}s`;
  const min = Math.floor(seg / 60);
  const resto = Math.round(seg % 60);
  return resto > 0 ? `${min}m ${resto}s` : `${min}m`;
}

const VENTAJAS = [
  {
    icon: Bot,
    titulo: "Automatización con IA",
    descripcion: "Tu asistente responde solo en WhatsApp, entrenado con el prompt de tu negocio.",
    href: "/dashboard/agentes",
  },
  {
    icon: Send,
    titulo: "Plantillas y campañas",
    descripcion: "Crea plantillas aprobadas por Meta y envía campañas masivas en segundos.",
    href: "/dashboard/plantillas",
  },
  {
    icon: MessagesSquare,
    titulo: "Mensajes en un solo lugar",
    descripcion: "Revisa cada conversación, pausa la IA y toma el control cuando lo necesites.",
    href: "/dashboard/mensajes",
  },
];

function PantallaBienvenida({ nombre, suscripcionActiva }: { nombre: string; suscripcionActiva: boolean }) {
  const pasos = [
    { etiqueta: "Activa tu plan", hecho: suscripcionActiva, href: "/checkout" },
    { etiqueta: "Conecta tu número de WhatsApp", hecho: false, href: "/dashboard/conexion" },
    { etiqueta: "Entrena tu IA con tu propio prompt", hecho: false, href: "/dashboard/agentes" },
  ];

  return (
    <div className="px-4 py-8 md:px-8">
      <h1 className="text-2xl font-semibold text-fg sm:text-3xl">Hola{nombre ? `, ${nombre}` : ""} 👋</h1>
      <p className="mt-1 text-sm text-mist">Bienvenido a Du IA Business. Vamos a dejar tu WhatsApp funcionando.</p>

      <div className="mt-8 overflow-hidden rounded-2xl border border-lime/20 bg-gradient-to-br from-lime/15 via-card to-card p-8 sm:p-10">
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-lg">
            <p className="text-xs font-semibold uppercase tracking-widest text-lime-text">Primeros pasos</p>
            <h2 className="mt-2 text-xl font-semibold text-fg sm:text-2xl">Conecta tu primer número de WhatsApp</h2>
            <p className="mt-2 text-sm leading-relaxed text-mist">
              En minutos tu negocio va a responder solo, 24/7, con la IA entrenada a tu manera.
            </p>
          </div>
          <Link
            href="/dashboard/conexion"
            className="btn-shine shrink-0 rounded-lg bg-lime px-5 py-3 text-sm font-semibold text-lime-fg transition-colors duration-200 hover:bg-lime-hover"
          >
            Conectar número →
          </Link>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {pasos.map((p, i) => (
          <Link
            key={p.etiqueta}
            href={p.href}
            className={`flex items-center gap-3 rounded-xl border p-4 transition-colors duration-200 ${
              p.hecho ? "border-lime/30 bg-lime/5" : "border-edge bg-card hover:border-lime/25"
            }`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                p.hecho ? "bg-lime text-lime-fg" : "border border-edge text-mist"
              }`}
            >
              {i + 1}
            </span>
            <span className={`text-sm ${p.hecho ? "text-fg" : "text-mist"}`}>{p.etiqueta}</span>
          </Link>
        ))}
      </div>

      <div className="mt-10">
        <p className="text-sm font-semibold text-fg">Todo lo que puedes hacer</p>
        <div className="mt-4 grid gap-5 sm:grid-cols-3">
          {VENTAJAS.map((v) => (
            <Link
              key={v.titulo}
              href={v.href}
              className="group rounded-2xl border border-edge bg-card p-6 transition-colors duration-200 hover:border-lime/25"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime/10 text-lime-text">
                <v.icon className="size-5" />
              </div>
              <p className="mt-4 text-sm font-semibold text-fg">{v.titulo}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-mist">{v.descripcion}</p>
              <span className="mt-3 inline-flex items-center text-xs font-semibold text-lime-text opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                Ir ahora →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  href,
  icon: Icon,
  valor,
  etiqueta,
}: {
  href: string;
  icon: typeof Bot;
  valor: string;
  etiqueta: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-edge bg-card p-5 transition-colors hover:border-lime/30"
    >
      <div className="flex items-center justify-between">
        <div className="flex size-9 items-center justify-center rounded-lg bg-lime/10 text-lime-text">
          <Icon className="size-4" />
        </div>
        <ArrowUpRight className="size-4 text-mist opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <p className="mt-4 text-2xl font-semibold text-fg">{valor}</p>
      <p className="mt-1 font-mono text-[10.5px] uppercase tracking-widest text-mist">{etiqueta}</p>
    </Link>
  );
}

export default function ResumenPage() {
  const { session, negocios, suscripcion, errorNegocios, cargarNegocios } = useDashboard();
  const [dias, setDias] = useState<Dia[] | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [campanas, setCampanas] = useState<CampanaPreview[] | null>(null);

  useEffect(() => {
    if (!session) return;
    fetch("/api/dashboard/actividad", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setDias(data.dias ?? []))
      .catch(() => setDias([]));
    fetch("/api/dashboard/resumen", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setResumen(data))
      .catch(() => setResumen(null));
    fetch("/api/dashboard/campanas", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setCampanas((data.campanas ?? []).slice(0, 3)))
      .catch(() => setCampanas([]));
  }, [session]);

  const nombre = nombreDesdeEmail(session?.user.email);

  if (negocios === null && errorNegocios) {
    return (
      <div className="px-4 py-8 md:px-8">
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">{errorNegocios}</p>
        <button
          onClick={() => cargarNegocios()}
          className="mt-4 rounded-lg border border-edge px-4 py-2 text-sm font-semibold text-fg transition-colors hover:border-lime/40"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (negocios === null) {
    return (
      <div className="px-4 py-8 md:px-8">
        <p className="text-sm text-mist">Cargando tu panel…</p>
      </div>
    );
  }

  if (negocios.length === 0) {
    return <PantallaBienvenida nombre={nombre} suscripcionActiva={!!suscripcion} />;
  }

  const numerosActivos = negocios.filter((n) => n.conectado).length;
  const mensajesUsados = negocios.reduce((acc, n) => acc + n.mensajes_usados, 0);
  const algunoIlimitado = negocios.some((n) => n.mensajes_limite === null);
  const mensajesLimite = algunoIlimitado
    ? null
    : negocios.reduce((acc, n) => acc + (n.mensajes_limite ?? 0), 0);
  const chartData = (dias ?? []).map((d) => ({
    label: new Date(d.fecha + "T00:00:00").toLocaleDateString("es-CO", { weekday: "short" }),
    entrante: d.entrante,
    saliente: d.saliente,
  }));

  const briefingBase =
    resumen === null
      ? `Tienes ${numerosActivos} número${numerosActivos === 1 ? "" : "s"} conectado${numerosActivos === 1 ? "" : "s"} y tu IA ha procesado ${mensajesUsados.toLocaleString("es-CO")} mensajes este mes.`
      : resumen.conversaciones24h === 0
        ? `Tu IA no ha procesado conversaciones en las últimas 24 horas en tus ${numerosActivos} número${numerosActivos === 1 ? "" : "s"} conectado${numerosActivos === 1 ? "" : "s"}.`
        : `Tu IA manejó ${resumen.conversaciones24h.toLocaleString("es-CO")} ${resumen.conversaciones24h === 1 ? "conversación" : "conversaciones"} en tus ${numerosActivos} número${numerosActivos === 1 ? "" : "s"} en las últimas 24 horas — ${Math.round(resumen.tasaAutomatizacion * 100)}% sin intervención humana.`;
  const mejorAgenteTexto =
    resumen?.mejorAgente && resumen.mejorAgente.tasaAutomatizacion > 0
      ? ` Tu mejor número hoy fue ${resumen.mejorAgente.nombre}, con ${Math.round(resumen.mejorAgente.tasaAutomatizacion * 100)}% de automatización.`
      : "";
  const briefing = briefingBase + mejorAgenteTexto;

  const totalAutopilot = resumen
    ? resumen.autopilot.resueltoPorIA + resumen.autopilot.atendidoManual + resumen.autopilot.sinResponder
    : 0;
  const donutData = resumen
    ? [
        { name: "Resuelto por IA", value: resumen.autopilot.resueltoPorIA, color: "var(--color-chart-1)" },
        { name: "Atendido manualmente", value: resumen.autopilot.atendidoManual, color: "var(--color-chart-2)" },
        { name: "Sin responder", value: resumen.autopilot.sinResponder, color: "var(--color-chart-3)" },
      ]
    : [];
  const tasaAutopilot = totalAutopilot > 0 ? resumen!.autopilot.resueltoPorIA / totalAutopilot : 0;

  return (
    <div className="pb-12">
      <PageHeader eyebrow="Command Center · En vivo" title={`Hola${nombre ? `, ${nombre}` : ""}`} description={briefing}>
        <Link
          href="/dashboard/campanas"
          className="flex items-center gap-2 rounded-lg bg-lime px-3.5 py-2 text-sm font-medium text-lime-fg transition-opacity hover:opacity-90"
        >
          <Send className="size-4" />
          Nueva campaña
        </Link>
      </PageHeader>

      <div className="px-4 pt-6 md:px-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MiniStat
            href="/dashboard/agentes"
            icon={Bot}
            valor={(resumen?.autopilot.resueltoPorIA ?? 0).toLocaleString("es-CO")}
            etiqueta="Resueltos por IA (24h)"
          />
          <MiniStat
            href="/dashboard/plantillas"
            icon={LayoutTemplate}
            valor={String(resumen?.plantillasPendientes ?? 0)}
            etiqueta="Esperando aprobación de Meta"
          />
          <MiniStat
            href="/dashboard/campanas"
            icon={Send}
            valor={String(resumen?.campanasHoy ?? 0)}
            etiqueta="Campañas activas hoy"
          />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Mensajes procesados (24h)"
            value={resumen ? resumen.conversaciones24h.toLocaleString("es-CO") : "—"}
            delta={resumen?.deltaConversacionesPct != null ? `${Math.abs(Math.round(resumen.deltaConversacionesPct * 100))}%` : undefined}
            positive={(resumen?.deltaConversacionesPct ?? 0) >= 0}
            icon={MessagesSquare}
            spark={dias ? dias.map((d) => d.saliente) : undefined}
          />
          <StatTile
            label="Automatización (24h)"
            value={resumen ? `${Math.round(resumen.tasaAutomatizacion * 100)}%` : "—"}
            delta={resumen?.deltaAutomatizacionPts != null ? `${Math.abs(Math.round(resumen.deltaAutomatizacionPts * 100))}%` : undefined}
            positive={(resumen?.deltaAutomatizacionPts ?? 0) >= 0}
            icon={Bot}
          />
          <StatTile
            label="Tiempo de respuesta"
            value={resumen?.tiempoRespuestaSeg != null ? formatearDuracion(resumen.tiempoRespuestaSeg) : "—"}
            delta={resumen?.deltaTiempoRespuestaSeg != null ? formatearDuracion(Math.abs(resumen.deltaTiempoRespuestaSeg)) : undefined}
            positive={(resumen?.deltaTiempoRespuestaSeg ?? 0) <= 0}
            icon={Clock}
          />
          <StatTile label="Números activos" value={String(numerosActivos)} icon={Phone} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-edge bg-card p-5 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-fg">Volumen de mensajes</h2>
                <p className="text-sm text-mist">Entrante vs saliente, últimos 7 días</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-2 text-xs text-mist">
                  <span className="size-2.5 rounded-full" style={{ background: "var(--color-chart-2)" }} /> Entrante
                </span>
                <span className="flex items-center gap-2 text-xs text-mist">
                  <span className="size-2.5 rounded-full" style={{ background: "var(--color-lime)" }} /> Saliente
                </span>
              </div>
            </div>
            <div className="mt-4">
              {dias === null ? (
                <div className="flex h-[220px] items-center justify-center text-sm text-mist">Cargando…</div>
              ) : (
                <AreaTrend
                  data={chartData}
                  keys={[
                    { key: "entrante", name: "Entrante", color: "var(--color-chart-2)" },
                    { key: "saliente", name: "Saliente", color: "var(--color-lime)" },
                  ]}
                />
              )}
            </div>
          </div>

          <div className="rounded-xl border border-edge bg-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-fg">Autopilot</h2>
                <p className="text-sm text-mist">Últimas 24 horas</p>
              </div>
              {totalAutopilot > 0 && (
                <Pill tone={tasaAutopilot >= 0.8 ? "success" : tasaAutopilot >= 0.5 ? "warning" : "danger"}>
                  {tasaAutopilot >= 0.8 ? "Óptimo" : tasaAutopilot >= 0.5 ? "Estable" : "Atención"}
                </Pill>
              )}
            </div>
            <div className="mt-4">
              {totalAutopilot > 0 ? (
                <>
                  <Donut data={donutData} height={180} />
                  <div className="mt-4 space-y-2">
                    {donutData.map((d) => (
                      <div key={d.name} className="flex items-center gap-2.5 text-sm">
                        <span className="size-2.5 rounded-full" style={{ background: d.color }} />
                        <span className="truncate text-mist">{d.name}</span>
                        <span className="ml-auto font-medium tabular-nums text-fg">{d.value.toLocaleString("es-CO")}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex h-[180px] items-center justify-center text-sm text-mist">Sin actividad todavía</div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-edge bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-fg">Campañas recientes</h2>
              <Link href="/dashboard/campanas" className="flex items-center gap-1 text-sm text-lime-text hover:underline">
                Ver todas <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {campanas === null ? (
                <p className="text-sm text-mist">Cargando…</p>
              ) : campanas.length === 0 ? (
                <p className="text-sm text-mist">Todavía no has enviado ninguna campaña.</p>
              ) : (
                campanas.map((c) => {
                  const readPct = c.funnel.sent ? Math.round((c.funnel.read / c.funnel.sent) * 100) : 0;
                  return (
                    <div key={c.id} className="rounded-lg border border-edge bg-ink p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-fg">{c.nombre}</span>
                        <Pill tone={c.estado === "completado" ? "success" : "danger"}>
                          {c.estado === "completado" ? "Completada" : "Fallida"}
                        </Pill>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-mist">
                        <span>{c.destinatarios_total} destinatarios</span>
                        <span className="font-medium text-fg">{readPct}% leído</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-xl border border-edge bg-card p-5">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-fg">Actividad reciente</h2>
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-lime opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-lime" />
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {resumen === null ? (
                <p className="text-sm text-mist">Cargando…</p>
              ) : resumen.actividadReciente.length === 0 ? (
                <p className="text-sm text-mist">Sin actividad en las últimas 24 horas.</p>
              ) : (
                resumen.actividadReciente.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink text-mist">
                      {a.tipo === "entrante" ? (
                        <MessageCircle className="size-3.5" />
                      ) : a.tipo === "manual" ? (
                        <User className="size-3.5" />
                      ) : (
                        <Bot className="size-3.5 text-lime-text" />
                      )}
                    </div>
                    <span className="min-w-0 flex-1 truncate text-fg">{a.descripcion}</span>
                    <span className="shrink-0 text-xs text-mist">{formatearHace(a.created_at)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {suscripcion ? (
              <PlanUsageCard
                plan={suscripcion.plan}
                usados={mensajesUsados}
                limite={mensajesLimite}
                renuevaEl={suscripcion.fecha_proximo_cobro}
                porCategoria={resumen?.porCategoriaMes ?? []}
              />
            ) : (
              <div className="rounded-xl border border-edge bg-card p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-fg">Suscripción</h2>
                  <Pill tone="neutral">Sin plan</Pill>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-mist">
                  Activa tu plan para desbloquear todo Du IA Business.
                </p>
                <Link
                  href="/checkout"
                  className="mt-5 block rounded-lg bg-lime px-4 py-2.5 text-center text-sm font-semibold text-lime-fg transition-colors duration-200 hover:bg-lime-hover"
                >
                  Activar suscripción →
                </Link>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-edge bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-fg">Salud del canal</h2>
              <Link href="/dashboard/conexion" className="flex items-center gap-1 text-sm text-lime-text hover:underline">
                Administrar <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
            <div className="mt-4 space-y-2.5">
              {negocios.map((n) => {
                const calidad = n.calidad ? CALIDAD_INFO[n.calidad] : undefined;
                return (
                  <div key={n.phone_number_id} className="flex items-center justify-between rounded-lg border border-edge bg-ink px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{formatearTelefono(n.telefono_negocio)}</p>
                      <p className="mt-0.5 truncate font-mono text-[10.5px] uppercase tracking-widest text-mist">
                        {n.nombre_negocio}
                      </p>
                    </div>
                    <Pill tone={calidad?.tone ?? "neutral"}>{calidad?.label ?? "Sin datos aún"}</Pill>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
