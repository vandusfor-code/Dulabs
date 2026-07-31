"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Bell, ChevronDown, Phone, Menu, Check } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { formatearTelefono } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { LanguageSelector } from "@/components/LanguageSelector";

export function Topbar({ onMenu }: { onMenu?: () => void }) {
  const { negocios, numeroActivoId, seleccionarNumero } = useDashboard();
  const { t } = useI18n();
  const [numberOpen, setNumberOpen] = useState(false);

  const activo = negocios?.find((n) => n.phone_number_id === numeroActivoId) ?? negocios?.[0];

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

      <div className="relative ml-auto hidden max-w-md flex-1 items-center md:flex lg:ml-4 lg:mr-auto">
        <Search className="pointer-events-none absolute left-3 size-4 text-mist" />
        <input
          type="text"
          placeholder={t("Buscar conversaciones, plantillas…", "Search conversations, templates…")}
          className="h-9 w-full rounded-lg border border-edge bg-card pl-9 pr-16 text-sm text-fg outline-none transition-colors placeholder:text-mist focus:border-lime/50"
        />
        <kbd className="pointer-events-none absolute right-2.5 rounded border border-edge bg-ink px-1.5 py-1 font-mono text-[10.5px] text-mist">
          ⌘K
        </kbd>
      </div>

      <div className="ml-auto flex items-center gap-2 md:ml-0">
        <LanguageSelector tone="dark" />
        <button
          className="relative flex size-9 items-center justify-center rounded-lg border border-edge text-mist transition-colors hover:text-fg"
          aria-label={t("Notificaciones", "Notifications")}
        >
          <Bell className="size-4" />
        </button>
      </div>
    </header>
  );
}
