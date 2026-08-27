"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useI18n } from "@/lib/i18n";
import { PLANES, PLAN_POR_DEFECTO, resolverPlanId, type PlanId } from "@/lib/planes";

const PLAN_PENDIENTE_KEY = "du_labs_plan_elegido";

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
  return (
    <Suspense fallback={null}>
      <CheckoutPageInterna />
    </Suspense>
  );
}

function CheckoutPageInterna() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const publicKey = process.env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY;

  const [session, setSession] = useState<Session | null | "verificando">("verificando");
  const [plan, setPlan] = useState<PlanId>(PLAN_POR_DEFECTO);
  const [precioNegociadoCop, setPrecioNegociadoCop] = useState<number | null>(null);
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });

  const [telefono, setTelefono] = useState("");
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
      // Un link directo con ?plan=growth manda sobre lo que haya guardado en
      // localStorage -- así se puede enviar a un cliente puntual (ej. por
      // WhatsApp) un link que abra exactamente el plan correcto, sin
      // depender de que haya pasado antes por /precios en ese mismo navegador.
      const planPorUrl = searchParams.get("plan");
      const planGuardado = localStorage.getItem(PLAN_PENDIENTE_KEY);
      const planElegido = planPorUrl ?? planGuardado;
      if (planElegido) setPlan(resolverPlanId(planElegido));

      // "listo" (lo que revela el precio en pantalla) solo se marca DESPUÉS
      // de que esta consulta termine -- éxito o error. Antes se marcaba
      // "listo" de una vez y el precio negociado llegaba después por su
      // cuenta: quien mirara la pantalla apenas cargaba (lo normal) veía el
      // precio de LISTA por esa fracción de segundo, no el negociado.
      fetch("/api/dashboard/suscripcion", { headers: { Authorization: `Bearer ${data.session.access_token}` } })
        .then((res) => res.json())
        .then((json) => setPrecioNegociadoCop(json.precio_negociado_cop ?? null))
        .catch((err) => {
          console.error("[checkout] no se pudo consultar el precio negociado:", err);
          setPrecioNegociadoCop(null);
        })
        .finally(() => setEstado({ fase: "listo" }));
    });
  }, [router, searchParams]);

  const precioAMostrar = precioNegociadoCop ?? PLANES[plan].precioCop;

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
            telefono,
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
    [session, publicKey, plan, telefono, numero, mes, anio, cvc, titular, t]
  );

  if (wompiConfigFaltante) {
    return (
      <main className="dash-scope flex min-h-screen items-center justify-center bg-ink px-5 text-fg">
        <p className="max-w-md rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-600">
          {t("Falta NEXT_PUBLIC_WOMPI_PUBLIC_KEY en el entorno.", "NEXT_PUBLIC_WOMPI_PUBLIC_KEY is missing from the environment.")}
        </p>
      </main>
    );
  }
  if (session === "verificando" || estado.fase === "cargando") {
    return (
      <main className="dash-scope flex min-h-screen items-center justify-center bg-ink px-5 text-fg">
        <p className="text-sm text-mist">{t("Verificando tu sesión…", "Verifying your session…")}</p>
      </main>
    );
  }
  if (!session) return null;

  return (
    <main className="dash-scope flex min-h-screen items-center justify-center bg-ink px-5 py-16 text-fg">
      <div className="w-full max-w-md rounded-2xl border border-edge/60 bg-card p-8 sm:p-10">
        <Link href="/dashboard/conexion" className="text-sm text-lime-text hover:text-fg">
          {t("← Volver al panel", "← Back to dashboard")}
        </Link>
        <h1 className="mt-6 text-2xl font-semibold">{t("Activa tu suscripción", "Activate your subscription")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-mist">
          {PLANES[plan].nombre} — ${precioAMostrar?.toLocaleString("es-CO") ?? "—"} COP / {t("mes", "month")}.{" "}
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
                {t("WhatsApp de contacto", "Contact WhatsApp")}
              </label>
              <input
                required
                type="tel"
                inputMode="tel"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="300 123 4567"
                className="w-full rounded-lg border border-edge bg-ink-2 px-4 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
              />
              <p className="mt-1.5 text-xs text-mist/70">
                {t("Te escribimos por aquí para empezar la configuración.", "We'll message you here to start setup.")}
              </p>
            </div>
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
