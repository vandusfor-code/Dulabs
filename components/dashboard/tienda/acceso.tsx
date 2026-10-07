"use client";

/**
 * Administración de tienda — acceso: sesión + módulo + permiso de escritura. Es solo presentación: cada endpoint de /api/dashboard/tienda/* vuelve a
 * autorizar por su cuenta (membresía, rol y módulo habilitado).
 */
import { useMemo, type ReactNode } from "react";
import { Store } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useDashboard } from "@/lib/dashboard-session";
import { CMS_MODULE } from "@/lib/cms-comercial/contrato";
import { createCmsClient, type CmsClient } from "@/lib/cms-comercial-client";

export function useTiendaAcceso(): { client: CmsClient | null; canWrite: boolean; enabled: boolean; ready: boolean } {
  const { session, rol, modulos, negocios } = useDashboard();
  const token = session?.access_token ?? null;
  const client = useMemo(() => (token ? createCmsClient(token) : null), [token]);
  return {
    client,
    // Solo un administrador modifica la tienda (el backend lo exige: CMS_ROLES_ESCRITURA).
    canWrite: rol === "admin",
    enabled: modulos.includes(CMS_MODULE),
    // `negocios` y `modulos` llegan en la misma respuesta de /me.
    ready: negocios !== null,
  };
}

/** La puerta de la sección: mientras no se sepa el módulo, un esqueleto; sin el módulo habilitado, un aviso (la API tampoco responde); con él, la sección. */
export function PuertaTienda({ ready, enabled, children }: { ready: boolean; enabled: boolean; children: ReactNode }) {
  const { t } = useI18n();
  if (!ready) {
    return (
      <div className="space-y-3 px-4 pt-6 md:px-8" aria-hidden data-testid="puerta-cargando">
        <div className="h-8 w-56 animate-pulse rounded-lg bg-ink-2" />
        <div className="h-32 animate-pulse rounded-2xl bg-card" />
        <div className="h-64 animate-pulse rounded-xl bg-card" />
      </div>
    );
  }
  if (!enabled) {
    return (
      <div className="px-4 pt-10 md:px-8">
        <div className="mx-auto max-w-md rounded-2xl border border-edge bg-card p-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-ink-2 text-mist">
            <Store className="size-6" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-fg">{t("Administración de tienda no habilitada", "Store management not enabled")}</h2>
          <p className="mt-1.5 text-sm text-mist">{t("Este módulo todavía no está activo para tu cuenta. Escríbenos si quieres habilitarlo.", "This module is not active for your account yet. Contact us to enable it.")}</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function TiendaGate({ children }: { children: ReactNode }) {
  const { enabled, ready } = useTiendaAcceso();
  return (
    <PuertaTienda ready={ready} enabled={enabled}>
      {children}
    </PuertaTienda>
  );
}
