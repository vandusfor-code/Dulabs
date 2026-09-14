"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  LayoutDashboard,
  Users,
  AlertTriangle,
  Phone,
  Bot,
  CreditCard,
  Gauge,
  ScrollText,
  FileText,
  DatabaseBackup,
  ArrowLeftRight,
} from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";

// FASE F15 (Operations Center, autorizado) -- shell propio de /admin,
// deliberadamente DISTINTO del Shell de /dashboard (ese es la navegación
// del propio cliente -- números, campañas, flows -- irrelevante para un
// operador de DuLabs viendo TODOS los clientes). Reutiliza el mismo
// sistema de diseño (.dash-scope, tokens de color) para no inventar una
// segunda identidad visual, tal como pide la Fase 27 del pedido.
const SECCIONES = [
  { href: "/admin", label: "Resumen", icon: LayoutDashboard, exact: true },
  { href: "/admin/clientes", label: "Clientes", icon: Users },
  { href: "/admin/alertas", label: "Alertas", icon: AlertTriangle },
  { href: "/admin/whatsapp", label: "WhatsApp", icon: Phone },
  { href: "/admin/bots", label: "Bots & Flows", icon: Bot },
  { href: "/admin/billing", label: "Billing", icon: CreditCard },
  { href: "/admin/consumo", label: "Consumo", icon: Gauge },
  { href: "/admin/auditoria", label: "Auditoría", icon: ScrollText },
  { href: "/admin/logs", label: "Logs", icon: FileText },
  { href: "/admin/backups", label: "Backups", icon: DatabaseBackup },
];

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, rol, esAdminDulabs } = useDashboard();

  useEffect(() => {
    // rol === null puede seguir significando "cargando" -- solo redirige
    // cuando ya sabemos con certeza que no es admin de DuLabs. La
    // autorización REAL vive en verificarAccesoAdminDulabs, en cada
    // endpoint /api/dashboard/admin/* -- esto es solo conveniencia de UI.
    if (rol !== null && !esAdminDulabs) router.replace("/dashboard");
  }, [rol, esAdminDulabs, router]);

  if (!esAdminDulabs) return null;

  return (
    <div className="dash-scope flex min-h-screen bg-ink text-fg">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-edge bg-card md:flex">
        <div className="border-b border-edge px-5 py-5">
          <p className="text-sm font-semibold text-fg">DuLabs</p>
          <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">Centro de Operaciones</p>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          {SECCIONES.map((s) => {
            const activo = s.exact ? pathname === s.href : pathname === s.href || pathname.startsWith(s.href + "/");
            const Icon = s.icon;
            return (
              <Link
                key={s.href}
                href={s.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  activo ? "bg-lime/10 font-medium text-lime-text" : "text-mist hover:bg-ink-2 hover:text-fg"
                }`}
              >
                <Icon className="size-4 shrink-0" />
                {s.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-edge p-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-mist transition-colors hover:bg-ink-2 hover:text-fg"
          >
            <ArrowLeftRight className="size-4 shrink-0" />
            Volver a mi dashboard
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-edge bg-card px-4 py-3 md:hidden">
          <p className="text-sm font-semibold text-fg">DuLabs · Operaciones</p>
        </header>
        <header className="hidden items-center justify-end border-b border-edge bg-card px-6 py-3 md:flex">
          <p className="text-xs text-mist">{session?.user.email}</p>
        </header>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
