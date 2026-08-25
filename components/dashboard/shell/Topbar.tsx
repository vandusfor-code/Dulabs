"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Bell, ChevronDown, Phone, Menu, Check } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { formatearTelefono } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { LanguageSelector } from "@/components/LanguageSelector";
import { CommandPalette } from "./CommandPalette";

type Notificacion = {
  id: string;
  tono: "critico" | "aviso" | "info";
  titulo: string;
  detalle: string;
  href: string;
};

export function Topbar({ onMenu }: { onMenu?: () => void }) {
  const { session, negocios, numeroActivoId, seleccionarNumero } = useDashboard();
  const { t } = useI18n();
  const router = useRouter();
  const [numberOpen, setNumberOpen] = useState(false);
  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const [notisAbiertas, setNotisAbiertas] = useState(false);
  const [notificaciones, setNotificaciones] = useState<Notificacion[] | null>(null);

  // ⌘K (macOS) / Ctrl+K (Windows y Linux) abre el buscador global.
  useEffect(() => {
    const alPresionar = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setBuscadorAbierto((v) => !v);
      }
    };
    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelado = false;
    fetch("/api/dashboard/notificaciones", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelado) setNotificaciones(data.notificaciones ?? []);
      })
      .catch(() => {
        if (!cancelado) setNotificaciones([]);
      });
    return () => {
      cancelado = true;
    };
  }, [session]);

  const irA = useCallback(
    (href: string) => {
      setNotisAbiertas(false);
      router.push(href);
    },
    [router]
  );

  const activo = negocios?.find((n) => n.phone_number_id === numeroActivoId) ?? negocios?.[0];
  const pendientes = notificaciones?.length ?? 0;
  const hayCriticas = (notificaciones ?? []).some((n) => n.tono === "critico");

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-edge bg-ink/80 px-4 backdrop-blur-xl md:px-6">
      <button
        onClick={onMenu}
        className="flex size-9 items-center justify-center rounded-lg border border-edge text-mist transition-colors hover:text-fg lg:hidden"
        aria-label={t("Abrir menú", "Open menu")}
      >
        <Menu className="size-4" />
      </button>

      {negocios && negocios.length > 0 ? (
        <div className="relative">
          <button
            onClick={() => setNumberOpen((v) => !v)}
            className="flex items-center gap-2.5 rounded-lg border border-edge bg-card px-3 py-2 text-sm transition-colors hover:bg-ink-2"
          >
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-lime opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-lime" />
            </span>
            <Phone className="size-4 text-mist" />
            <span className="hidden font-medium text-fg sm:inline">
              {activo ? formatearTelefono(activo.telefono_negocio) : t("Sin número", "No number")}
            </span>
            <span className="font-medium text-fg sm:hidden">
              {negocios.length > 1 ? `${negocios.length} ${t("números", "numbers")}` : t("Número", "Number")}
            </span>
            {negocios.length > 1 && <ChevronDown className="size-4 text-mist" />}
          </button>
          {numberOpen && negocios.length > 1 && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setNumberOpen(false)} />
              <div className="absolute left-0 top-full z-20 mt-2 w-72 rounded-xl border border-edge bg-card p-1.5 shadow-2xl">
                <p className="px-2.5 py-2 font-mono text-[10.5px] uppercase tracking-widest text-mist">
                  {t("Números conectados", "Connected numbers")}
                </p>
                {negocios.map((n) => {
                  const seleccionado = n.phone_number_id === activo?.phone_number_id;
                  return (
                    <button
                      key={n.phone_number_id}
                      type="button"
                      onClick={() => {
                        seleccionarNumero(n.phone_number_id);
                        setNumberOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                        seleccionado ? "bg-lime/10" : "hover:bg-ink-2"
                      }`}
                    >
                      <span className={`size-2 shrink-0 rounded-full ${n.conectado ? "bg-lime" : "bg-mist/40"}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm font-medium ${seleccionado ? "text-lime-text" : "text-fg"}`}>
                          {formatearTelefono(n.telefono_negocio)}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[10.5px] uppercase tracking-widest text-mist">
                          {n.nombre_negocio}
                        </p>
                      </div>
                      {seleccionado && <Check className="size-4 shrink-0 text-lime-text" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : (
        <Link
          href="/dashboard/conexion"
          className="flex items-center gap-2 rounded-lg border border-edge bg-card px-3 py-2 text-sm text-mist transition-colors hover:text-fg"
        >
          <Phone className="size-4" />
          {t("Conectar número", "Connect number")}
        </Link>
      )}

      <button
        type="button"
        onClick={() => setBuscadorAbierto(true)}
        className="relative ml-auto hidden max-w-md flex-1 items-center md:flex lg:ml-4 lg:mr-auto"
        aria-label={t("Buscar", "Search")}
      >
        <Search className="pointer-events-none absolute left-3 size-4 text-mist" />
        <span className="flex h-9 w-full items-center rounded-lg border border-edge bg-card pl-9 pr-16 text-left text-sm text-mist transition-colors hover:border-lime/40">
          {t("Buscar una sección o un número…", "Search a section or a number…")}
        </span>
        <kbd className="pointer-events-none absolute right-2.5 rounded border border-edge bg-ink px-1.5 py-1 font-mono text-[10.5px] text-mist">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-2 md:ml-0">
        <LanguageSelector tone="dark" />
        <div className="relative">
          <button
            onClick={() => setNotisAbiertas((v) => !v)}
            className="relative flex size-9 items-center justify-center rounded-lg border border-edge text-mist transition-colors hover:text-fg"
            aria-label={
              pendientes > 0
                ? t(`Notificaciones (${pendientes})`, `Notifications (${pendientes})`)
                : t("Notificaciones", "Notifications")
            }
            aria-expanded={notisAbiertas}
          >
            <Bell className="size-4" />
            {pendientes > 0 && (
              <span
                className={`absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                  hayCriticas ? "bg-red-600 text-white" : "bg-lime text-lime-fg"
                }`}
              >
                {pendientes}
              </span>
            )}
          </button>

          {notisAbiertas && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setNotisAbiertas(false)} />
              <div className="absolute right-0 top-full z-20 mt-2 w-80 overflow-hidden rounded-xl border border-edge bg-card shadow-2xl">
                <p className="border-b border-edge px-4 py-3 text-xs font-semibold uppercase tracking-widest text-mist">
                  {t("Notificaciones", "Notifications")}
                </p>
                {notificaciones === null ? (
                  <p className="px-4 py-6 text-center text-sm text-mist">{t("Cargando…", "Loading…")}</p>
                ) : notificaciones.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-mist">
                    {t("Todo en orden. No hay nada que revisar.", "All good. Nothing to review.")}
                  </p>
                ) : (
                  <ul className="max-h-[60vh] overflow-y-auto">
                    {notificaciones.map((n) => (
                      <li key={n.id} className="border-b border-edge/60 last:border-b-0">
                        <button
                          onClick={() => irA(n.href)}
                          className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-2"
                        >
                          <span
                            className={`mt-1.5 size-2 shrink-0 rounded-full ${
                              n.tono === "critico" ? "bg-red-600" : n.tono === "aviso" ? "bg-amber-500" : "bg-mist"
                            }`}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-fg">{n.titulo}</span>
                            <span className="mt-0.5 block text-xs leading-relaxed text-mist">{n.detalle}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {buscadorAbierto && <CommandPalette onCerrar={() => setBuscadorAbierto(false)} />}
    </header>
  );
}
