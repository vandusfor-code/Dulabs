"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useDashboard } from "@/lib/dashboard-session";
import { formatearTelefono } from "@/lib/format";

const ICONOS = {
  telefono: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 5a2 2 0 012-2h2.28a1 1 0 01.98.804l.94 4.7a1 1 0 01-.502 1.06L7.06 10.5a11.04 11.04 0 006.44 6.44l.936-1.638a1 1 0 011.06-.502l4.7.94a1 1 0 01.804.98V19a2 2 0 01-2 2h-1C9.163 21 3 14.837 3 7V6z"
    />
  ),
  mensaje: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8 10h.01M12 10h.01M16 10h.01M21 12a9 9 0 11-9-9 9 9 0 019 9z"
    />
  ),
  bolt: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 2L3 14h7l-1 8 11-14h-7l1-6z" />
  ),
  tarjeta: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7zM2 10h20"
    />
  ),
};

function Icono({ nombre }: { nombre: keyof typeof ICONOS }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      {ICONOS[nombre]}
    </svg>
  );
}

const COLORES = {
  lime: "bg-lime/10 text-lime",
  sky: "bg-sky-400/10 text-sky-400",
  violet: "bg-violet-400/10 text-violet-400",
  amber: "bg-amber-400/10 text-amber-400",
};

function StatCard({
  etiqueta,
  valor,
  detalle,
  icono,
  color,
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
  icono: keyof typeof ICONOS;
  color: keyof typeof COLORES;
}) {
  return (
    <div className="rounded-2xl border border-edge/60 bg-card p-6 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-edge">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${COLORES[color]}`}>
        <Icono nombre={icono} />
      </div>
      <p className="mt-4 text-xs font-medium text-mist">{etiqueta}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-white">{valor}</p>
      {detalle && <p className="mt-1.5 text-xs text-mist/80">{detalle}</p>}
    </div>
  );
}

function GraficaActividad() {
  const { session } = useDashboard();
  const [dias, setDias] = useState<{ fecha: string; cantidad: number }[] | null>(null);

  useEffect(() => {
    if (!session) return;
    fetch("/api/dashboard/actividad", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((res) => res.json())
      .then((data) => setDias(data.dias ?? []))
      .catch(() => setDias([]));
  }, [session]);

  const max = Math.max(1, ...(dias?.map((d) => d.cantidad) ?? [1]));

  return (
    <div className="rounded-2xl border border-edge/60 bg-card p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Mensajes procesados</p>
          <p className="text-xs text-mist">Últimos 7 días</p>
        </div>
      </div>
      <div className="mt-8 flex h-40 items-end gap-3">
        {dias === null &&
          Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex-1 animate-pulse rounded-t-lg bg-ink-2" style={{ height: "40%" }} />
          ))}
        {dias?.map((d) => (
          <div key={d.fecha} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex h-32 w-full items-end">
              <div
                className="w-full rounded-t-lg bg-gradient-to-t from-lime/40 to-lime transition-[height] duration-500"
                style={{ height: `${Math.max(4, (d.cantidad / max) * 100)}%` }}
                title={`${d.cantidad} mensajes`}
              />
            </div>
            <span className="text-[10px] text-mist">
              {new Date(d.fecha + "T00:00:00").toLocaleDateString("es-CO", { weekday: "short" })}
            </span>
          </div>
        ))}
      </div>
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
    <div className="mx-auto w-full max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Resumen</h1>
          <p className="mt-1 text-sm text-mist">
            {new Date().toLocaleDateString("es-CO", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          etiqueta="Números activos"
          valor={String(numerosActivos)}
          icono="telefono"
          color="lime"
        />
        <StatCard
          etiqueta="Mensajes procesados"
          valor={mensajesUsados.toLocaleString("es-CO")}
          detalle="Este mes"
          icono="mensaje"
          color="sky"
        />
        <StatCard
          etiqueta="Mensajes restantes"
          valor={
            mensajesLimite === null
              ? "Ilimitado"
              : Math.max(0, mensajesLimite - mensajesUsados).toLocaleString("es-CO")
          }
          icono="bolt"
          color="violet"
        />
        <StatCard
          etiqueta="Plan actual"
          valor={suscripcion?.plan ?? negocios?.[0]?.plan ?? "Sin plan"}
          detalle={
            suscripcion ? `$${suscripcion.precio_cop.toLocaleString("es-CO")} COP / mes` : undefined
          }
          icono="tarjeta"
          color="amber"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <GraficaActividad />

        {suscripcion ? (
          <div className="flex flex-col justify-between rounded-2xl bg-gradient-to-br from-lime/20 via-lime/5 to-transparent p-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-lime">
                Suscripción
              </p>
              <p className="mt-3 text-2xl font-semibold text-white">{suscripcion.plan}</p>
              <p className="mt-1 text-sm text-mist">
                ${suscripcion.precio_cop.toLocaleString("es-CO")} COP / mes
              </p>
              <div className="mt-5 flex items-center gap-2 text-sm">
                <span
                  className={`h-2 w-2 rounded-full ${
                    suscripcion.estado === "activa" ? "bg-lime" : "bg-red-400"
                  }`}
                />
                <span className={suscripcion.estado === "activa" ? "text-lime" : "text-red-400"}>
                  {suscripcion.estado === "activa" ? "Activa" : suscripcion.estado}
                </span>
              </div>
              <p className="mt-1 text-xs text-mist">
                Próximo cobro:{" "}
                {new Date(suscripcion.fecha_proximo_cobro + "T00:00:00").toLocaleDateString(
                  "es-CO",
                  { day: "numeric", month: "long" }
                )}
              </p>
            </div>
            <Link
              href="/dashboard/cuenta"
              className="mt-6 rounded-lg bg-lime px-4 py-2.5 text-center text-sm font-semibold text-ink transition-colors duration-200 hover:bg-lime-hover"
            >
              Ver cuenta →
            </Link>
          </div>
        ) : (
          <div className="flex flex-col justify-between rounded-2xl bg-gradient-to-br from-lime/20 via-lime/5 to-transparent p-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-lime">
                Sin suscripción
              </p>
              <p className="mt-3 text-lg font-semibold leading-snug text-white">
                Activa tu plan para desbloquear todo Du IA Business.
              </p>
            </div>
            <Link
              href="/checkout"
              className="mt-6 rounded-lg bg-lime px-4 py-2.5 text-center text-sm font-semibold text-ink transition-colors duration-200 hover:bg-lime-hover"
            >
              Activar suscripción →
            </Link>
          </div>
        )}
      </div>

      {/* --- Tabla de números --- */}
      <div className="mt-6 rounded-2xl border border-edge/60 bg-card">
        <div className="flex items-center justify-between border-b border-edge/60 p-6">
          <p className="text-sm font-semibold text-white">Tus números</p>
          <Link href="/dashboard/conexion" className="text-xs font-semibold text-lime hover:text-white">
            Ver todos →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-mist">
                <th className="px-6 py-3 font-medium">Negocio</th>
                <th className="px-6 py-3 font-medium">Teléfono</th>
                <th className="px-6 py-3 font-medium">Estado</th>
                <th className="px-6 py-3 font-medium">Mensajes</th>
              </tr>
            </thead>
            <tbody>
              {negocios?.map((n) => (
                <tr key={n.phone_number_id} className="border-t border-edge/40">
                  <td className="px-6 py-3.5 font-medium text-white">{n.nombre_negocio}</td>
                  <td className="px-6 py-3.5 text-mist">{formatearTelefono(n.telefono_negocio)}</td>
                  <td className="px-6 py-3.5">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                        n.conectado ? "bg-lime/10 text-lime" : "bg-white/10 text-white"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${n.conectado ? "bg-lime" : "bg-mist/60"}`} />
                      {n.conectado ? "Activo" : "Pendiente"}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-mist">{n.mensajes_usados.toLocaleString("es-CO")}</td>
                </tr>
              ))}
              {negocios?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-6 text-center text-xs text-mist">
                    Todavía no tienes ningún número conectado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
