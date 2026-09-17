"use client";

import { useState, type FormEvent } from "react";
import type { DevClient } from "@/lib/dev-dashboard/dev-client";
import { DevApiError } from "@/lib/dev-dashboard/dev-client";

// DuLabs Developer V1 -- Fase 12 (Billing, Wompi). Modal de checkout: tokeniza
// la tarjeta EN EL NAVEGADOR con la public key de Developer (la tarjeta nunca
// toca nuestro servidor) y llama al backend, que resuelve precio/FX/cuenta y
// cobra. El precio/monto/cuenta NUNCA los decide el frontend. Namespace propio
// de Developer (NEXT_PUBLIC_DEVELOPER_WOMPI_PUBLIC_KEY), aislado de Business.

const DEV_WOMPI_PUBLIC_KEY = process.env.NEXT_PUBLIC_DEVELOPER_WOMPI_PUBLIC_KEY;

function wompiBaseUrl(pk: string): string {
  return pk.includes("_test_") ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1";
}

type Fase = "form" | "procesando" | "aprobado" | "pendiente" | "rechazado" | "error";

export function BillingCheckout(props: {
  client: DevClient;
  plan: string;
  planLabel: string;
  intervalo: "month" | "year";
  precioLabel: string;
  email: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { client, plan, planLabel, intervalo, precioLabel, email, onClose, onSuccess } = props;
  const [numero, setNumero] = useState("");
  const [mes, setMes] = useState("");
  const [anio, setAnio] = useState("");
  const [cvc, setCvc] = useState("");
  const [titular, setTitular] = useState("");
  const [fase, setFase] = useState<Fase>("form");
  const [mensaje, setMensaje] = useState<string | null>(null);

  const configFaltante = !DEV_WOMPI_PUBLIC_KEY;

  async function pagar(e: FormEvent) {
    e.preventDefault();
    if (fase === "procesando") return;
    if (!DEV_WOMPI_PUBLIC_KEY) {
      setMensaje("Falta NEXT_PUBLIC_DEVELOPER_WOMPI_PUBLIC_KEY en el entorno.");
      setFase("error");
      return;
    }
    if (!email) {
      setMensaje("No se pudo determinar el correo de la cuenta.");
      setFase("error");
      return;
    }
    setFase("procesando");
    setMensaje(null);
    try {
      const base = wompiBaseUrl(DEV_WOMPI_PUBLIC_KEY);
      // 1. Tokens de aceptación de términos y tratamiento de datos.
      const merchant = await (await fetch(`${base}/merchants/${DEV_WOMPI_PUBLIC_KEY}`)).json();
      const acceptanceToken: string | undefined = merchant?.data?.presigned_acceptance?.acceptance_token;
      const personalAuth: string | undefined = merchant?.data?.presigned_personal_data_auth?.acceptance_token;
      if (!acceptanceToken || !personalAuth) throw new Error("No se pudieron obtener los tokens de aceptación de Wompi.");

      // 2. Tokenizar la tarjeta (el número nunca toca nuestro servidor).
      const tokenRes = await fetch(`${base}/tokens/cards`, {
        method: "POST",
        headers: { Authorization: `Bearer ${DEV_WOMPI_PUBLIC_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ number: numero.replace(/\s/g, ""), cvc, exp_month: mes.padStart(2, "0"), exp_year: anio, card_holder: titular }),
      });
      const tokenJson = await tokenRes.json();
      if (!tokenRes.ok || !tokenJson?.data?.id) throw new Error("La tarjeta no pudo ser validada por Wompi. Revisa los datos e intenta de nuevo.");

      // 3. Backend: crea la fuente de pago recurrente y cobra (precio/FX/cuenta server-side).
      const resp = await client.billing.checkout({
        plan,
        intervalo,
        token: tokenJson.data.id as string,
        acceptance_token: acceptanceToken,
        accept_personal_auth: personalAuth,
        customer_email: email,
      });

      if (resp.estado === "APPROVED" || resp.activada) {
        setFase("aprobado");
        onSuccess();
      } else if (resp.estado === "PENDING") {
        setFase("pendiente"); // 3DS: se confirmará por webhook
      } else {
        setFase("rechazado");
        setMensaje(`El pago quedó en estado ${resp.estado}.`);
      }
    } catch (err) {
      const msg =
        err instanceof DevApiError
          ? err.code === "checkout_in_progress"
            ? "Ya hay un pago en proceso. Espera un momento e intenta de nuevo."
            : err.detalle ?? err.code ?? "No se pudo procesar el pago."
          : err instanceof Error
            ? err.message
            : String(err);
      setMensaje(msg);
      setFase("error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-edge bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-fg">Suscribirte a {planLabel}</h2>
            <p className="text-sm text-mist">{precioLabel} · cobro en COP (equivalente en pesos)</p>
          </div>
          <button onClick={onClose} className="text-mist hover:text-fg" aria-label="Cerrar">✕</button>
        </div>

        {configFaltante ? (
          <p className="rounded-lg border border-danger-text/30 bg-danger p-3 text-sm text-danger-text">
            El checkout no está configurado: falta <code>NEXT_PUBLIC_DEVELOPER_WOMPI_PUBLIC_KEY</code>.
          </p>
        ) : fase === "aprobado" ? (
          <div className="space-y-3">
            <p className="rounded-lg border border-success-text/30 bg-success p-3 text-sm text-success-text">✓ Pago aprobado. Tu plan {planLabel} ya está activo.</p>
            <button onClick={onClose} className="w-full rounded-md bg-dev-accent px-3 py-2 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover">Listo</button>
          </div>
        ) : fase === "pendiente" ? (
          <div className="space-y-3">
            <p className="rounded-lg border border-edge bg-card p-3 text-sm text-mist">Tu banco está confirmando el pago (3DS). En cuanto se confirme, tu plan se activará automáticamente. Puedes cerrar esta ventana.</p>
            <button onClick={onClose} className="w-full rounded-md border border-edge px-3 py-2 text-sm text-fg hover:bg-white/5">Cerrar</button>
          </div>
        ) : (
          <form onSubmit={pagar} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-mist">Nombre en la tarjeta</label>
              <input required value={titular} onChange={(e) => setTitular(e.target.value)} className="w-full rounded-md border border-edge bg-transparent px-3 py-2 text-sm text-fg outline-none focus:border-dev-accent" placeholder="Nombre Apellido" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-mist">Número de tarjeta</label>
              <input required inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} className="w-full rounded-md border border-edge bg-transparent px-3 py-2 text-sm text-fg outline-none focus:border-dev-accent" placeholder="4242 4242 4242 4242" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-mist">Mes</label>
                <input required inputMode="numeric" maxLength={2} value={mes} onChange={(e) => setMes(e.target.value)} className="w-full rounded-md border border-edge bg-transparent px-3 py-2 text-sm text-fg outline-none focus:border-dev-accent" placeholder="MM" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-mist">Año</label>
                <input required inputMode="numeric" maxLength={2} value={anio} onChange={(e) => setAnio(e.target.value)} className="w-full rounded-md border border-edge bg-transparent px-3 py-2 text-sm text-fg outline-none focus:border-dev-accent" placeholder="YY" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-mist">CVC</label>
                <input required inputMode="numeric" maxLength={4} value={cvc} onChange={(e) => setCvc(e.target.value)} className="w-full rounded-md border border-edge bg-transparent px-3 py-2 text-sm text-fg outline-none focus:border-dev-accent" placeholder="123" />
              </div>
            </div>

            {mensaje ? <p className="rounded-lg border border-danger-text/30 bg-danger p-3 text-sm text-danger-text">{mensaje}</p> : null}

            <button type="submit" disabled={fase === "procesando"} className="w-full rounded-md bg-dev-accent px-3 py-2 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover disabled:opacity-50">
              {fase === "procesando" ? "Procesando…" : `Pagar ${precioLabel}`}
            </button>
            <p className="text-center text-[11px] text-mist">Pago seguro con Wompi. La tarjeta se tokeniza en tu navegador; nunca la almacenamos.</p>
          </form>
        )}
      </div>
    </div>
  );
}
