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
import type { Rol } from "@/lib/team";

export type Negocio = {
  nombre_negocio: string;
  telefono_negocio: string;
  phone_number_id: string;
  whatsapp_business_account_id: string;
  conectado: boolean;
  updated_at: string;
  mensajes_usados: number;
  prompt_sistema: string | null;
  base_conocimiento_nombre_archivo: string | null;
  base_conocimiento_actualizado_at: string | null;
  base_conocimiento_caracteres: number;
  calidad: string | null;
  limite_mensajeria: string | null;
  estado_verificacion: string | null;
  estado_nombre_visible: string | null;
  nombre_agente: string | null;
  agente_id: number | null;
  ia_pausada: boolean;
  forward_to_dumo: boolean;
  enviados_30d: number;
  enviados_hoy: number;
};

export type Suscripcion = {
  plan: string;
  precio_cop: number;
  estado: string;
  fecha_proximo_cobro: string;
  /** true = el cliente canceló; conserva el servicio hasta fecha_proximo_cobro. */
  cancelar_al_vencer?: boolean;
} | null;

type DashboardContextValue = {
  session: Session | null;
  negocios: Negocio[] | null;
  errorNegocios: string | null;
  suscripcion: Suscripcion;
  rol: Rol | null;
  /** DuMo es una integración interna del operador, no una función del producto. */
  puedeUsarDumo: boolean;
  cargarNegocios: () => Promise<void>;
  /** phone_number_id elegido en el selector de número del Topbar. */
  numeroActivoId: string | null;
  seleccionarNumero: (phoneNumberId: string) => void;
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

const NUMERO_ACTIVO_KEY = "du_labs_numero_activo";

export const supabaseConfigFaltante =
  !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function DashboardSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | "verificando">("verificando");
  const [negocios, setNegocios] = useState<Negocio[] | null>(null);
  const [errorNegocios, setErrorNegocios] = useState<string | null>(null);
  const [suscripcion, setSuscripcion] = useState<Suscripcion>(null);
  const [rol, setRol] = useState<Rol | null>(null);
  const [puedeUsarDumo, setPuedeUsarDumo] = useState(false);
  // Se hidrata una sola vez desde localStorage (lazy initializer, no efecto)
  // — si el número guardado ya no existe (se eliminó, o nunca hubo uno), los
  // consumidores (ver Topbar) ya caen a `negocios[0]` al resolverlo, así que
  // no hace falta reconciliar/autocorregir este estado contra `negocios`.
  const [numeroActivoId, setNumeroActivoId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(NUMERO_ACTIVO_KEY);
    } catch {
      return null;
    }
  });

  const seleccionarNumero = useCallback((phoneNumberId: string) => {
    setNumeroActivoId(phoneNumberId);
    try {
      window.localStorage.setItem(NUMERO_ACTIVO_KEY, phoneNumberId);
    } catch {
      // localStorage puede fallar en modo privado/incógnito — no es crítico.
    }
  }, []);

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
      setRol(data.rol ?? null);
      setPuedeUsarDumo(Boolean(data.puede_usar_dumo));
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
        <p className="text-sm text-mist">Verificando tu sesión… · Verifying your session…</p>
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
        rol,
        puedeUsarDumo,
        cargarNegocios: () => cargarNegocios(),
        numeroActivoId,
        seleccionarNumero,
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
