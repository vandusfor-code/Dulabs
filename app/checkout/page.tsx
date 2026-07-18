"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useI18n } from "@/lib/i18n";

const PLAN_PENDIENTE_KEY = "du_labs_plan_elegido";
const PRECIO_COP_POR_PLAN: Record<string, number> = {
  "Plan Básico": 59990,
  "Plan Pro": 129990,
  "Plan Enterprise": 299990,
};

const wompiConfigFaltante = !process.env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY;

function wompiBaseUrl(publicKey: string): string {
  return publicKey.includes("_test_")
    ? "https://sandbox.wompi.co/v1"
    : "https://production.wompi.co/v1";
}

type Estado =
  | { fase: "cargando" }
  | { fase: "listo" }
  | { fase: "procesando" }
  | { fase: "exito" }
  | { fase: "error"; mensaje: string };

export default function CheckoutPage() {
  const router = useRouter();
  const { t } = useI18n();
  const publicKey = process.env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY;

  const [session, setSession] = useState<Session | null | "verificando">("verificando");
  const [plan, setPlan] = useState<string>("Plan Pro");
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });

  const [numero, setNumero] = useState("");
  const [mes, setMes] = useState("");
  const [anio, setAnio] = useState("");
  const [cvc, setCvc] = useState("");
  const [titular, setTitular] = useState("");

  useEffect(() => {
    if (wompiConfigFaltante) return;
    const supabase = supabaseBrowser();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setSession(data.session);
      const planGuardado = localStorage.getItem(PLAN_PENDIENTE_KEY);
      if (planGuardado) setPlan(planGuardado);
      setEstado({ fase: "listo" });
    });
  }, [router]);

  const pagar = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!session || session === "verificando" || !publicKey) return;
      setEstado({ fase: "procesando" });

      try {
        const base = wompiBaseUrl(publicKey);

        // 1. Tokens de aceptación de términos y tratamiento de datos, vigentes.
        const merchantRes = await fetch(`${base}/merchants/${publicKey}`);
        const merchantJson = await merchantRes.json();
        const acceptanceToken =
          merchantJson.data?.presigned_acceptance?.acceptance_token;
        const personalAuthToken =
          merchantJson.data?.presigned_personal_data_auth?.acceptance_token;
        if (!acceptanceToken || !personalAuthToken) {
          throw new Error(t("No se pudieron obtener los tokens de aceptación de Wompi.", "Could not obtain Wompi acceptance tokens."));
        }

        // 2. Tokenizar la tarjeta directamente desde el navegador: el número
        //    de tarjeta nunca toca nuestro servidor.
        const tokenRes = await fetch(`${base}/tokens/cards`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${publicKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            number: numero.replace(/\s/g, ""),
            cvc,
            exp_month: mes.padStart(2, "0"),
            exp_year: anio,
            card_holder: titular,
          }),
        });
        const tokenJson = await tokenRes.json();
        if (!tokenRes.ok || !tokenJson.data?.id) {
          const detalle =
            tokenJson.error?.reason ??
            (tokenJson.error?.messages ? JSON.stringify(tokenJson.error.messages) : null) ??
            JSON.stringify(tokenJson);
          throw new Error(`Wompi (tokens/cards) respondió ${tokenRes.status}: ${detalle}`);
        }

        // 3. Nuestro backend crea la fuente de pago recurrente y cobra el
        //    primer mes.
        const res = await fetch("/api/pagos/suscribir", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            token: tokenJson.data.id,
            plan,
            customer_email: session.user.email,
            acceptance_token: acceptanceToken,
            accept_personal_auth: personalAuthToken,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("Error procesando el pago.", "Error processing the payment."));

        localStorage.removeItem(PLAN_PENDIENTE_KEY);
        setEstado({ fase: "exito" });
      } catch (err) {
        setEstado({ fase: "error", mensaje: err instanceof Error ? err.message : String(err) });
      }
    },
    [session, publicKey, plan, numero, mes, anio, cvc, titular, t]
  );

  if (wompiConfigFaltante) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink px-5 text-fg">
        <p className="max-w-md rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-600">
          {t("Falta NEXT_PUBLIC_WOMPI_PUBLIC_KEY en el entorno.", "NEXT_PUBLIC_WOMPI_PUBLIC_KEY is missing from the environment.")}
        </p>
      </main>
    );
  }
  if (session === "verificando") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink px-5 text-fg">
        <p className="text-sm text-mist">{t("Verificando tu sesión…", "Verifying your session…")}</p>
      </main>
    );
  }
  if (!session) return null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-5 py-16 text-fg">
      <div className="w-full max-w-md rounded-2xl border border-edge/60 bg-card p-8 sm:p-10">
        <Link href="/dashboard/conexion" className="text-sm text-lime-text hover:text-fg">
          {t("← Volver al panel", "← Back to dashboard")}
        </Link>
        <h1 className="mt-6 text-2xl font-semibold">{t("Activa tu suscripción", "Activate your subscription")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-mist">
          {plan} — ${PRECIO_COP_POR_PLAN[plan]?.toLocaleString("es-CO") ?? "—"} COP / {t("mes", "month")}.{" "}
          {t("Se te cobrará automáticamente cada mes con esta tarjeta.", "You'll be charged automatically every month with this card.")}
        </p>

        {estado.fase === "exito" ? (
          <div className="mt-8 rounded-xl border border-lime/40 bg-lime/10 p-5 text-sm leading-relaxed">
            {t("✅ Suscripción activada. Ya puedes conectar o seguir usando tu WhatsApp Business.", "✅ Subscription activated. You can now connect or keep using your WhatsApp Business.")}
            <Link href="/dashboard/conexion" className="mt-3 block font-semibold text-lime-text hover:text-fg">
              {t("Ir al panel →", "Go to dashboard →")}
            </Link>
          </div>
        ) : (
          <form onSubmit={pagar} className="mt-8 flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-mist">
                {t("Número de tarjeta", "Card number")}
              </label>
              <input
                required
                inputMode="numeric"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="4242 4242 4242 4242"
                className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">{t("Mes", "Month")}</label>
                <input
                  required
                  inputMode="numeric"
                  maxLength={2}
                  value={mes}
                  onChange={(e) => setMes(e.target.value)}
                  placeholder="MM"
                  className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">{t("Año", "Year")}</label>
                <input
                  required
                  inputMode="numeric"
                  maxLength={2}
                  value={anio}
                  onChange={(e) => setAnio(e.target.value)}
                  placeholder="AA"
                  className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-mist">CVC</label>
                <input
                  required
                  inputMode="numeric"
                  maxLength={4}
                  value={cvc}
                  onChange={(e) => setCvc(e.target.value)}
                  placeholder="123"
                  className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-mist">
                {t("Nombre del titular", "Cardholder name")}
              </label>
              <input
                required
                value={titular}
                onChange={(e) => setTitular(e.target.value)}
                placeholder={t("Como aparece en la tarjeta", "As it appears on the card")}
                className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
              />
            </div>

            {estado.fase === "error" && (
              <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600">
                {estado.mensaje}
              </p>
            )}

            <button
              type="submit"
              disabled={estado.fase === "procesando"}
              className="btn-shine mt-2 rounded-lg bg-lime px-6 py-3 text-sm font-semibold text-lime-fg transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {estado.fase === "procesando" ? t("Procesando…", "Processing…") : t("Confirmar y pagar", "Confirm and pay")}
            </button>
          </form>
        )}

        <p className="mt-6 text-xs leading-relaxed text-mist/70">
          {t(
            "El pago se procesa directamente con Wompi. Du Labs nunca ve ni almacena el número completo de tu tarjeta.",
            "The payment is processed directly with Wompi. Du Labs never sees or stores your full card number."
          )}
        </p>
      </div>
    </main>
  );
}
