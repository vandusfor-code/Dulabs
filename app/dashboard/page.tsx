"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  MessagesSquare,
  Bot,
  Clock,
  Send,
  Phone,
  ArrowUpRight,
} from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { formatearTelefono } from "@/lib/format";
import { PageHeader, StatTile, Pill } from "@/components/dashboard/shell/ui";
import { AreaTrend } from "@/components/dashboard/shell/charts";

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

export default function ResumenPage() {
  const { session, negocios, suscripcion } = useDashboard();
  const [dias, setDias] = useState<{ fecha: string; cantidad: number }[] | null>(null);

  useEffect(() => {
    if (!session) return;
    fetch("/api/dashboard/actividad", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setDias(data.dias ?? []))
      .catch(() => setDias([]));
  }, [session]);

  const nombre = nombreDesdeEmail(session?.user.email);

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
  const restantes = mensajesLimite === null ? null : Math.max(0, mensajesLimite - mensajesUsados);
  const chartData = (dias ?? []).map((d) => ({
    label: new Date(d.fecha + "T00:00:00").toLocaleDateString("es-CO", { weekday: "short" }),
    mensajes: d.cantidad,
  }));

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Command Center · En vivo"
        title={`Hola${nombre ? `, ${nombre}` : ""}`}
        description={`Tienes ${numerosActivos} número${numerosActivos === 1 ? "" : "s"} conectado${numerosActivos === 1 ? "" : "s"} y tu IA ha procesado ${mensajesUsados.toLocaleString("es-CO")} mensajes este mes.`}
      >
        <Link
          href="/dashboard/campanas"
          className="flex items-center gap-2 rounded-lg bg-lime px-3.5 py-2 text-sm font-medium text-lime-fg transition-opacity hover:opacity-90"
        >
          <Send className="size-4" />
          Nueva campaña
        </Link>
      </PageHeader>

      <div className="px-4 pt-6 md:px-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Números activos" value={String(numerosActivos)} icon={Phone} />
          <StatTile label="Mensajes procesados" value={mensajesUsados.toLocaleString("es-CO")} icon={MessagesSquare} />
          <StatTile
            label="Mensajes restantes"
            value={restantes === null ? "Ilimitado" : restantes.toLocaleString("es-CO")}
            icon={Clock}
          />
          <StatTile
            label="Plan actual"
            value={suscripcion?.plan ?? negocios[0]?.plan ?? "Sin plan"}
            icon={Bot}
          />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-edge bg-card p-5 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-fg">Mensajes procesados</h2>
                <p className="text-sm text-mist">Últimos 7 días</p>
              </div>
            </div>
            <div className="mt-4">
              {dias === null ? (
                <div className="flex h-[220px] items-center justify-center text-sm text-mist">Cargando…</div>
              ) : (
                <AreaTrend data={chartData} keys={[{ key: "mensajes", name: "Mensajes", color: "var(--color-lime)" }]} />
              )}
            </div>
          </div>

          <div className="rounded-xl border border-edge bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-fg">Suscripción</h2>
              <Pill tone={suscripcion?.estado === "activa" ? "success" : "neutral"}>
                {suscripcion?.estado === "activa" ? "Activa" : suscripcion ? suscripcion.estado : "Sin plan"}
              </Pill>
            </div>
            {suscripcion ? (
              <>
                <p className="mt-4 text-2xl font-semibold text-fg">{suscripcion.plan}</p>
                <p className="mt-1 text-sm text-mist">${suscripcion.precio_cop.toLocaleString("es-CO")} COP / mes</p>
                <p className="mt-3 text-xs text-mist">
                  Próximo cobro:{" "}
                  {new Date(suscripcion.fecha_proximo_cobro + "T00:00:00").toLocaleDateString("es-CO", {
                    day: "numeric",
                    month: "long",
                  })}
                </p>
                <Link
                  href="/dashboard/cuenta"
                  className="mt-5 block rounded-lg bg-lime px-4 py-2.5 text-center text-sm font-semibold text-lime-fg transition-colors duration-200 hover:bg-lime-hover"
                >
                  Ver cuenta →
                </Link>
              </>
            ) : (
              <>
                <p className="mt-4 text-sm leading-relaxed text-mist">
                  Activa tu plan para desbloquear todo Du IA Business.
                </p>
                <Link
                  href="/checkout"
                  className="mt-5 block rounded-lg bg-lime px-4 py-2.5 text-center text-sm font-semibold text-lime-fg transition-colors duration-200 hover:bg-lime-hover"
                >
                  Activar suscripción →
                </Link>
              </>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-edge bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg">Tus números</h2>
            <Link href="/dashboard/conexion" className="flex items-center gap-1 text-sm text-lime-text hover:underline">
              Administrar <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {negocios.map((n) => (
              <div key={n.phone_number_id} className="rounded-lg border border-edge bg-ink p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Phone className="size-4 text-mist" />
                    <span className="text-sm font-medium text-fg">{formatearTelefono(n.telefono_negocio)}</span>
                  </div>
                  <Pill tone={n.conectado ? "success" : "neutral"}>{n.conectado ? "Activo" : "Pendiente"}</Pill>
                </div>
                <p className="mt-2 font-mono text-[10.5px] uppercase tracking-widest text-mist">{n.nombre_negocio}</p>
                <p className="mt-3 text-xs text-mist">
                  {n.mensajes_usados.toLocaleString("es-CO")} mensajes este mes
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
