"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import { navSections } from "./nav";
import { useDashboard } from "@/lib/dashboard-session";
import { formatearTelefono } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Rol } from "@/lib/team";

type Comando = {
  id: string;
  etiqueta: string;
  contexto: string;
  href: string;
};

// Buscador global del panel. Antes la barra del Topbar era decorativa:
// prometía ⌘K y un placeholder de "Buscar conversaciones, plantillas…" pero
// no tenía onChange ni listener de teclado. Ahora navega de verdad sobre las
// secciones que el rol del usuario puede ver, más sus números conectados.
// El Topbar lo monta solo mientras está abierto: así la consulta y la
// selección arrancan limpias en cada apertura sin necesidad de efectos que
// reseteen estado (que provocan renders en cascada).
export function CommandPalette({ onCerrar }: { onCerrar: () => void }) {
  const router = useRouter();
  const { negocios, rol, seleccionarNumero } = useDashboard();
  const { t, lang } = useI18n();
  const [consulta, setConsulta] = useState("");
  const [indice, setIndice] = useState(0);

  const comandos: Comando[] = useMemo(() => {
    const puedeVer = (roles?: Rol[]) => !roles || (rol !== null && roles.includes(rol));
    const paginas: Comando[] = navSections.flatMap((seccion) =>
      seccion.items.filter((i) => puedeVer(i.rolesPermitidos)).map((i) => ({
        id: `nav:${i.href}`,
        etiqueta: lang === "en" ? i.labelEn : i.label,
        contexto: lang === "en" ? seccion.titleEn : seccion.title,
        href: i.href,
      }))
    );
    const numeros: Comando[] = (negocios ?? []).map((n) => ({
      id: `num:${n.phone_number_id}`,
      etiqueta: `${n.nombre_negocio} · ${formatearTelefono(n.telefono_negocio)}`,
      contexto: t("Número", "Number"),
      href: "/dashboard/conexion",
    }));
    return [...paginas, ...numeros];
  }, [negocios, rol, lang, t]);

  const resultados = useMemo(() => {
    const q = consulta.trim().toLowerCase();
    if (!q) return comandos;
    return comandos.filter(
      (c) => c.etiqueta.toLowerCase().includes(q) || c.contexto.toLowerCase().includes(q)
    );
  }, [comandos, consulta]);

  // La selección vuelve al primer resultado con cada tecleo; se hace en el
  // propio manejador y no en un efecto sobre `consulta`.
  const escribir = useCallback((valor: string) => {
    setConsulta(valor);
    setIndice(0);
  }, []);

  const ejecutar = useCallback(
    (cmd: Comando) => {
      if (cmd.id.startsWith("num:")) seleccionarNumero(cmd.id.slice(4));
      router.push(cmd.href);
      onCerrar();
    },
    [router, onCerrar, seleccionarNumero]
  );

  const alTeclear = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndice((i) => (resultados.length === 0 ? 0 : (i + 1) % resultados.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndice((i) => (resultados.length === 0 ? 0 : (i - 1 + resultados.length) % resultados.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const elegido = resultados[indice];
      if (elegido) ejecutar(elegido);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCerrar();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCerrar} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("Buscador", "Search")}
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-edge bg-card shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-edge px-4">
          <Search className="size-4 shrink-0 text-mist" />
          <input
            autoFocus
            value={consulta}
            onChange={(e) => escribir(e.target.value)}
            onKeyDown={alTeclear}
            placeholder={t("Buscar una sección o un número…", "Search a section or a number…")}
            className="h-12 w-full bg-transparent text-sm text-fg outline-none placeholder:text-mist"
          />
          <kbd className="shrink-0 rounded border border-edge bg-ink px-1.5 py-1 font-mono text-[10.5px] text-mist">
            esc
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {resultados.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-mist">
              {t("Sin resultados para", "No results for")} “{consulta}”
            </p>
          ) : (
            resultados.map((c, i) => (
              <button
                key={c.id}
                onClick={() => ejecutar(c)}
                onMouseEnter={() => setIndice(i)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                  i === indice ? "bg-ink-2 text-fg" : "text-mist hover:bg-ink-2/60"
                }`}
              >
                <span className="truncate">{c.etiqueta}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[11px] text-mist/70">{c.contexto}</span>
                  {i === indice && <CornerDownLeft className="size-3.5 text-mist/70" />}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
