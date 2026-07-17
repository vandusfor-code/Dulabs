"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Sparkles } from "lucide-react";
import { navSections } from "./nav";
import { useDashboard } from "@/lib/dashboard-session";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useI18n } from "@/lib/i18n";

function cn(...cls: Array<string | false | undefined>) {
  return cls.filter(Boolean).join(" ");
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, negocios, suscripcion } = useDashboard();
  const { t } = useI18n();

  const cerrarSesion = async () => {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
  };

  const mensajesUsados = negocios?.reduce((acc, n) => acc + n.mensajes_usados, 0) ?? 0;
  const algunoIlimitado = negocios?.some((n) => n.mensajes_limite === null) ?? false;
  const limite = algunoIlimitado
    ? null
    : (negocios?.reduce((acc, n) => acc + (n.mensajes_limite ?? 0), 0) ?? 0);
  const porcentaje = limite ? Math.min(100, Math.round((mensajesUsados / limite) * 100)) : 0;

  const email = session?.user.email ?? "";
  const iniciales = email.slice(0, 2).toUpperCase();

  return (
    <div className="flex h-full flex-col bg-ink-2">
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 px-5">
        <Image src="/logo.png" alt="Du Labs" width={32} height={32} className="rounded-lg" priority />
        <div className="flex flex-col leading-none">
          <span className="text-sm font-semibold tracking-tight text-fg">Du Labs</span>
          <span className="mt-1 font-mono text-[10.5px] uppercase tracking-widest text-mist">
            Business OS
          </span>
        </div>
      </div>

      {/* Plan */}
      <div className="px-3">
        <Link
          href="/dashboard/cuenta"
          className="group flex w-full items-center gap-3 rounded-lg border border-edge bg-card px-3 py-2.5 text-left transition-colors hover:bg-ink-2"
        >
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-lime/30 to-lime/5 text-[11px] font-semibold text-lime-text">
            {(suscripcion?.plan ?? negocios?.[0]?.plan ?? "DU").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">
              {suscripcion?.plan ?? negocios?.[0]?.plan ?? t("Sin plan", "No plan")}
            </p>
            <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-widest text-mist">
              {negocios?.length ?? 0}{" "}
              {negocios?.length === 1 ? t("número", "number") : t("números", "numbers")}
            </p>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <nav className="mt-5 flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {navSections.map((section) => (
          <div key={section.title}>
            <p className="px-3 pb-2 font-mono text-[10.5px] uppercase tracking-widest text-mist/70">
              {t(section.title, section.titleEn)}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                        active ? "bg-lime/10 font-medium text-fg" : "text-mist hover:bg-ink-2 hover:text-fg"
                      )}
                    >
                      <item.icon
                        className={cn(
                          "size-[18px] shrink-0 transition-colors",
                          active ? "text-lime-text" : "text-mist group-hover:text-fg"
                        )}
                      />
                      <span className="flex-1 truncate">{t(item.label, item.labelEn)}</span>
                      {active && <span className="size-1.5 rounded-full bg-lime" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Uso del plan */}
      {negocios && negocios.length > 0 && (
        <div className="p-3">
          <div className="relative overflow-hidden rounded-xl border border-lime/20 bg-gradient-to-br from-lime/10 to-transparent p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-lime-text" />
              <span className="text-sm font-medium text-fg">{t("Tu IA este mes", "Your AI this month")}</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-mist">
              {mensajesUsados.toLocaleString("es-CO")} {t("mensajes procesados", "messages processed")}
              {limite !== null ? ` ${t("de", "of")} ${limite.toLocaleString("es-CO")}` : ` · ${t("ilimitado", "unlimited")}`}.
            </p>
            {limite !== null && (
              <div className="mt-3 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink">
                  <div className="h-full rounded-full bg-lime" style={{ width: `${porcentaje}%` }} />
                </div>
                <span className="font-mono text-[10.5px] text-lime-text">{porcentaje}%</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* User */}
      <div className="flex items-center gap-1.5 border-t border-edge px-3 py-3">
        <Link
          href="/dashboard/cuenta"
          onClick={onNavigate}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-ink",
            pathname === "/dashboard/cuenta" && "bg-lime/10"
          )}
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-xs font-medium text-fg">
            {iniciales || "DU"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">{email || t("Tu cuenta", "Your account")}</p>
            <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-widest text-mist">{t("Ver perfil", "View profile")}</p>
          </div>
        </Link>
        <button
          onClick={cerrarSesion}
          aria-label={t("Cerrar sesión", "Log out")}
          title={t("Cerrar sesión", "Log out")}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-mist transition-colors hover:bg-ink hover:text-fg"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}
