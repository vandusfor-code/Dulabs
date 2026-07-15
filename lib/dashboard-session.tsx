"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase-browser";

export type Negocio = {
  nombre_negocio: string;
  telefono_negocio: string;
  phone_number_id: string;
  whatsapp_business_account_id: string;
  conectado: boolean;
  updated_at: string;
  plan: string;
  mensajes_usados: number;
  mensajes_limite: number | null;
  prompt_sistema: string | null;
  base_conocimiento_nombre_archivo: string | null;
  base_conocimiento_actualizado_at: string | null;
  base_conocimiento_caracteres: number;
};

export type Suscripcion = {
  plan: string;
  precio_cop: number;
  estado: string;
  fecha_proximo_cobro: string;
} | null;

type DashboardContextValue = {
  session: Session | null;
  negocios: Negocio[] | null;
  errorNegocios: string | null;
  suscripcion: Suscripcion;
  cargarNegocios: () => Promise<void>;
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

export const supabaseConfigFaltante =
  !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function DashboardSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | "verificando">("verificando");
  const [negocios, setNegocios] = useState<Negocio[] | null>(null);
  const [errorNegocios, setErrorNegocios] = useState<string | null>(null);
  const [suscripcion, setSuscripcion] = useState<Suscripcion>(null);

  const cargarNegocios = useCallback(async (accessToken?: string) => {
    const token = accessToken ?? (session !== "verificando" && session?.access_token);
    if (!token) return;
    try {
      const res = await fetch("/api/dashboard/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error cargando tu panel");
      setNegocios(data.negocios ?? []);
      setSuscripcion(data.suscripcion ?? null);
    } catch (err) {
      setErrorNegocios(err instanceof Error ? err.message : String(err));
    }
  }, [session]);

  useEffect(() => {
    if (supabaseConfigFaltante) return;
    const supabase = supabaseBrowser();

    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setSession(data.session);
      cargarNegocios(data.session.access_token);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!s) {
        router.replace("/login");
        return;
      }
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (supabaseConfigFaltante) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink px-5 text-fg">
        <p className="max-w-md rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-600">
          Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en el entorno.
        </p>
      </main>
    );
  }
  if (session === "verificando") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink px-5 text-fg">
        <p className="text-sm text-mist">Verificando tu sesión…</p>
      </main>
    );
  }
  if (!session) return null;

  return (
    <DashboardContext.Provider
      value={{
        session,
        negocios,
        errorNegocios,
        suscripcion,
        cargarNegocios: () => cargarNegocios(),
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard debe usarse dentro de DashboardSessionProvider");
  return ctx;
}
