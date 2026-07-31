"use client";

import { useCallback, useState } from "react";
import { Users, Send, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const inputCls =
  "w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-mist focus:border-lime/50";

export interface ContactoSugerido {
  telefono: string;
  nombre: string | null;
}

export function InvitarPanel({
  phoneNumberId,
  accessToken,
  contactosSugeridos = [],
}: {
  phoneNumberId: string;
  accessToken: string;
  /**
   * Contactos ya identificados (ej. de un Excel importado) — se muestran
   * como una lista real con casilla, no mezclados en el textarea de texto
   * libre. Para reemplazar la lista por una nueva (ej. tras importar otro
   * archivo), monta este componente con una `key` distinta.
   */
  contactosSugeridos?: ContactoSugerido[];
}) {
  const { t } = useI18n();
  const [seleccionados, setSeleccionados] = useState<boolean[]>(() => contactosSugeridos.map(() => true));
  const [manual, setManual] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ enviados: number; fallidos: { destinatario: string; error: string }[] } | string | null>(null);

  const destinatariosManual = manual.split("\n").map((d) => d.trim()).filter(Boolean);
  const destinatariosSugeridos = contactosSugeridos
    .filter((_, i) => seleccionados[i])
    .map((c) => (c.nombre ? `${c.telefono}, ${c.nombre}` : c.telefono));
  const listaFinal = [...destinatariosSugeridos, ...destinatariosManual];
  const conteo = listaFinal.length;

  const alternar = (i: number) => setSeleccionados((prev) => prev.map((v, idx) => (idx === i ? !v : v)));

  const enviar = useCallback(async () => {
    if (listaFinal.length === 0) return;
    setEnviando(true);
    setResultado(null);
    try {
      const res = await fetch("/api/dashboard/surveys/invitar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ phone_number_id: phoneNumberId, destinatarios: listaFinal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("Error enviando invitaciones", "Error sending invitations"));
      setResultado(data);
      if (data.enviados > 0) {
        setManual("");
        setSeleccionados((prev) => prev.map(() => false));
      }
    } catch (err) {
      setResultado(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }, [listaFinal, phoneNumberId, accessToken, t]);

  return (
    <div className="rounded-lg border border-edge bg-ink p-3">
      <div className="flex items-center gap-2">
        <Users className="size-3.5 text-lime-text" />
        <p className="text-sm font-medium text-fg">{t("Enviar invitaciones", "Send invitations")}</p>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-mist">
        {t(
          "Si el contacto ya te escribió en las últimas 24h se le envía el mensaje de bienvenida directo; si no, se usa la plantilla de invitación aprobada en Meta. Nunca se envían los dos.",
          "If the contact already wrote to you in the last 24h, they get the direct welcome message; otherwise the Meta-approved invite template is used. Never both."
        )}
      </p>

      {contactosSugeridos.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-fg">
            {t(`Contactos del archivo importado (${contactosSugeridos.length})`, `Contacts from the imported file (${contactosSugeridos.length})`)}
          </p>
          <div className="mt-1.5 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-edge bg-card p-2">
            {contactosSugeridos.map((c, i) => (
              <label key={`${c.telefono}-${i}`} className="flex items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-ink">
                <input type="checkbox" checked={seleccionados[i] ?? false} onChange={() => alternar(i)} className="size-3.5 accent-lime" />
                <span className="min-w-0 flex-1 truncate text-xs text-fg">
                  {c.nombre ? <span className="font-medium">{c.nombre}</span> : null} <span className="text-mist">{c.telefono}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs font-medium text-fg">{t("Agregar más manualmente (opcional)", "Add more manually (optional)")}</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-mist">
        {t("Uno por línea: teléfono con indicativo de país, opcionalmente seguido de \", Nombre\".", "One per line: phone with country code, optionally followed by \", Name\".")}
      </p>
      <textarea
        rows={2}
        value={manual}
        onChange={(e) => setManual(e.target.value)}
        placeholder={"573009998877, Nombre opcional"}
        className={`${inputCls} mt-1.5 resize-none bg-card`}
      />

      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-mist">{conteo} {conteo === 1 ? t("destinatario", "recipient") : t("destinatarios", "recipients")}</span>
        <button
          onClick={enviar}
          disabled={enviando || conteo === 0}
          className="flex items-center gap-2 rounded-lg bg-lime px-3.5 py-1.5 text-xs font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enviando ? <Send className="size-3.5" /> : <Check className="size-3.5" />} {enviando ? t("Enviando…", "Sending…") : t(`Enviar a ${conteo}`, `Send to ${conteo}`)}
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
