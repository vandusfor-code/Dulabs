"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, ShieldBan, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useDashboard } from "@/lib/dashboard-session";
import { addBlockedNumber, getBlockedNumbers, removeBlockedNumber } from "@/lib/business-agent-client";
import { actionBtn, Field, inputCls, primaryBtn, SectionCard } from "@/components/dashboard/business-agent/ui";

/**
 * Bloque E — gestión de números excluidos. Usa el mecanismo EXISTENTE
 * (dulabs_clientes_config.ia_numeros_bloqueados + esTelefonoBloqueado(),
 * ver lib/blacklist-du.ts) vía /api/business-agent/blocked-numbers.
 * Tenant-scoped: el backend nunca deja leer/escribir un número de otro
 * tenant (.eq("id_tenant", ...) en cada query).
 */
export function BlockedNumbers({ phoneNumberId, businessLabel }: { phoneNumberId: string; businessLabel: string }) {
  const { t } = useI18n();
  const { session } = useDashboard();
  const [numbers, setNumbers] = useState<string[] | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!session) return;
    const result = await getBlockedNumbers({ accessToken: session.access_token, phoneNumberId });
    if (result.ok) {
      setNumbers(result.data.blockedNumbers);
      setError(null);
    } else {
      setError(result.error.message);
    }
  }, [session, phoneNumberId]);

  useEffect(() => {
    // Carga al montar -- intencional (mismo patrón que FlowsListPage/lib/i18n.tsx).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  const agregar = async () => {
    const value = input.trim();
    if (!value || !session) return;
    setBusy(true);
    setError(null);
    const result = await addBlockedNumber({ accessToken: session.access_token, phoneNumberId, numero: value });
    setBusy(false);
    if (result.ok) {
      setNumbers(result.data.blockedNumbers);
      setInput("");
    } else {
      setError(result.error.message);
    }
  };

  const quitar = async (numero: string) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    const result = await removeBlockedNumber({ accessToken: session.access_token, phoneNumberId, numero });
    setBusy(false);
    if (result.ok) setNumbers(result.data.blockedNumbers);
    else setError(result.error.message);
  };

  return (
    <SectionCard
      title={t("Números excluidos", "Blocked numbers")}
      description={t(
        `El bot nunca responderá a estos números en ${businessLabel} mientras permanezcan en esta lista -- ni IA, ni herramientas, ni mensaje.`,
        `The bot will never reply to these numbers on ${businessLabel} while they stay on this list -- no AI, no tools, no message.`,
      )}
    >
      <div className="flex items-center gap-2">
        <ShieldBan className="size-4 shrink-0 text-mist" />
        <Field label="">
          <input className={inputCls} placeholder={t("Número (ej. 3001112233)", "Number (e.g. 3001112233)")} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} />
        </Field>
        <button type="button" onClick={agregar} disabled={busy || !input.trim()} className={`${primaryBtn} mt-5 shrink-0`}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {t("Bloquear", "Block")}
        </button>
      </div>

      {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">{error}</p>}

      {numbers === null ? (
        <p className="text-sm text-mist">{t("Cargando…", "Loading…")}</p>
      ) : numbers.length === 0 ? (
        <p className="text-sm text-mist">{t("Ningún número bloqueado todavía.", "No blocked numbers yet.")}</p>
      ) : (
        <ul className="space-y-1.5">
          {numbers.map((n) => (
            <li key={n} className="flex items-center justify-between rounded-lg border border-edge bg-ink px-3 py-2 text-sm">
              <span className="font-mono text-fg">{n}</span>
              <button type="button" onClick={() => quitar(n)} disabled={busy} className={actionBtn}>
                <Trash2 className="size-3.5" /> {t("Quitar", "Remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
