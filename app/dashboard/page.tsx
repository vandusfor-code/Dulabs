"use client";

import Link from "next/link";
import { useDashboard } from "@/lib/dashboard-session";

function StatCard({
  etiqueta,
  valor,
  detalle,
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
}) {
  return (
    <div className="rounded-2xl border border-edge/60 bg-card p-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-mist">
        {etiqueta}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-white">
        {valor}
      </p>
      {detalle && <p className="mt-1.5 text-xs text-mist">{detalle}</p>}
    </div>
  );
}

export default function ResumenPage() {
  const { negocios, suscripcion } = useDashboard();

  const numerosActivos = negocios?.filter((n) => n.conectado).length ?? 0;
  const mensajesUsados = negocios?.reduce((acc, n) => acc + n.mensajes_usados, 0) ?? 0;
  const algunoIlimitado = negocios?.some((n) => n.mensajes_limite === null) ?? false;
  const mensajesLimite = algunoIlimitado
    ? null
    : (negocios?.reduce((acc, n) => acc + (n.mensajes_limite ?? 0), 0) ?? 0);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold sm:text-3xl">Resumen</h1>
      <p className="mt-2 text-sm text-mist">
        Vista general de tu cuenta de Du IA Business.
      </p>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard etiqueta="Números activos" valor={String(numerosActivos)} />
        <StatCard
          etiqueta="Mensajes procesados"
          valor={mensajesUsados.toLocaleString("es-CO")}
          detalle="Este mes"
        />
        <StatCard
          etiqueta="Mensajes restantes"
          valor={
            mensajesLimite === null
              ? "Ilimitado"
              : Math.max(0, mensajesLimite - mensajesUsados).toLocaleString("es-CO")
          }
        />
        <StatCard
          etiqueta="Plan actual"
          valor={suscripcion?.plan ?? negocios?.[0]?.plan ?? "Sin plan"}
          detalle={
            suscripcion
              ? `$${suscripcion.precio_cop.toLocaleString("es-CO")} COP / mes`
              : undefined
          }
        />
      </div>

      {suscripcion && (
        <div className="mt-6 rounded-2xl border border-edge/60 bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">Suscripción</p>
              <p className="mt-1 text-sm text-mist">
                Estado:{" "}
                <span
                  className={
                    suscripcion.estado === "activa" ? "text-lime" : "text-red-400"
                  }
                >
                  {suscripcion.estado}
                </span>{" "}
                · Próximo cobro:{" "}
                {new Date(suscripcion.fecha_proximo_cobro + "T00:00:00").toLocaleDateString(
                  "es-CO",
                  { day: "numeric", month: "long", year: "numeric" }
                )}
              </p>
            </div>
            <Link
              href="/dashboard/cuenta"
              className="rounded-lg border border-edge px-4 py-2 text-xs text-mist hover:border-mist/40 hover:text-white"
            >
              Ver cuenta →
            </Link>
          </div>
        </div>
      )}

      {!suscripcion && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-lime/40 bg-lime/10 p-6 text-sm">
          <span>Todavía no tienes una suscripción activa.</span>
          <Link
            href="/checkout"
            className="rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-ink hover:bg-lime-hover"
          >
            Activar suscripción →
          </Link>
        </div>
      )}

      <div className="mt-10 grid gap-5 sm:grid-cols-3">
        <Link
          href="/dashboard/conexion"
          className="rounded-2xl border border-edge/60 bg-card p-6 transition-colors duration-200 hover:border-lime/30"
        >
          <p className="text-sm font-semibold text-white">Números</p>
          <p className="mt-2 text-xs leading-relaxed text-mist">
            Conecta un WhatsApp nuevo o entrena la IA de un número existente.
          </p>
        </Link>
        <Link
          href="/dashboard/plantillas"
          className="rounded-2xl border border-edge/60 bg-card p-6 transition-colors duration-200 hover:border-lime/30"
        >
          <p className="text-sm font-semibold text-white">Plantillas y Campañas</p>
          <p className="mt-2 text-xs leading-relaxed text-mist">
            Crea plantillas aprobadas por Meta y manda mensajes masivos.
          </p>
        </Link>
        <Link
          href="/dashboard/mensajes"
          className="rounded-2xl border border-edge/60 bg-card p-6 transition-colors duration-200 hover:border-lime/30"
        >
          <p className="text-sm font-semibold text-white">Mensajes</p>
          <p className="mt-2 text-xs leading-relaxed text-mist">
            Revisa la actividad reciente de tus conversaciones.
          </p>
        </Link>
      </div>
    </div>
  );
}
