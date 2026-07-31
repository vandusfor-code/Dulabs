"use client";

import { useCallback, useState } from "react";
import { Users, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const inputCls =
  "w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-mist focus:border-lime/50";

export function InvitarPanel({
  phoneNumberId,
  accessToken,
  prefill,
}: {
  phoneNumberId: string;
  accessToken: string;
  /**
   * Contenido inicial del textarea (ej. contactos importados de un Excel).
   * Para forzar que se recargue con un valor nuevo, monta este componente
   * con una `key` distinta (ej. `key={prefill}`) — es lo que hace el Builder.
   */
  prefill?: string;
}) {
  const { t } = useI18n();
  const [destinatarios, setDestinatarios] = useState(prefill ?? "");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ enviados: number; fallidos: { destinatario: string; error: string }[] } | string | null>(null);

  // Una línea por destinatario ("teléfono" o "teléfono, Nombre") — la coma
  // dentro de una línea separa teléfono/nombre, no dos destinatarios.
  const conteo = destinatarios.split("\n").map((d) => d.trim()).filter(Boolean).length;

  const enviar = useCallback(async () => {
    const lista = destinatarios.split("\n").map((d) => d.trim()).filter(Boolean);
    if (lista.length === 0) return;
    setEnviando(true);
    setResultado(null);
    try {
      const res = await fetch("/api/dashboard/surveys/invitar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ phone_number_id: phoneNumberId, destinatarios: lista }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("Error enviando invitaciones", "Error sending invitations"));
      setResultado(data);
      if (data.enviados > 0) setDestinatarios("");
    } catch (err) {
      setResultado(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }, [destinatarios, phoneNumberId, accessToken, t]);

  return (
    <div className="rounded-lg border border-edge bg-ink p-3">
      <div className="flex items-center gap-2">
        <Users className="size-3.5 text-lime-text" />
        <p className="text-sm font-medium text-fg">{t("Enviar invitaciones", "Send invitations")}</p>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-mist">
        {t(
          "Uno por línea: teléfono con indicativo de país, opcionalmente seguido de \", Nombre\" (para personalizar {{nombre_cliente}} en la plantilla). Si el contacto escribió en las últimas 24h se le envía el saludo directo; si no, se usa la plantilla de invitación aprobada.",
          "One per line: phone with country code, optionally followed by \", Name\" (to fill {{nombre_cliente}} in the template). If the contact wrote in the last 24h they get the direct greeting; otherwise the approved invite template is used."
        )}
      </p>
      <textarea
        rows={3}
        value={destinatarios}
        onChange={(e) => setDestinatarios(e.target.value)}
        placeholder={"573001234567, Juan Pérez\n573007654321"}
        className={`${inputCls} mt-2 resize-none bg-card`}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-mist">{conteo} {conteo === 1 ? t("destinatario", "recipient") : t("destinatarios", "recipients")}</span>
        <button
          onClick={enviar}
          disabled={enviando || conteo === 0}
          className="flex items-center gap-2 rounded-lg bg-lime px-3.5 py-1.5 text-xs font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="size-3.5" /> {enviando ? t("Enviando…", "Sending…") : t("Enviar", "Send")}
        </button>
      </div>
      {resultado && (
        <p className="mt-2 rounded-lg bg-card p-2.5 text-xs leading-relaxed text-mist">
          {typeof resultado === "string"
            ? resultado
            : t(
                `Enviados: ${resultado.enviados}${resultado.fallidos.length ? ` · Fallidos: ${resultado.fallidos.length} (${resultado.fallidos[0].error})` : ""}`,
                `Sent: ${resultado.enviados}${resultado.fallidos.length ? ` · Failed: ${resultado.fallidos.length} (${resultado.fallidos[0].error})` : ""}`
              )}
        </p>
      )}
    </div>
  );
}
