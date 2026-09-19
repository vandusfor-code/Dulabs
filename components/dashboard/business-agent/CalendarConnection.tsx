"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck2, Loader2, Unplug } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useDashboard } from "@/lib/dashboard-session";
import {
  disconnectBusinessAgentCalendar,
  getBusinessAgentCalendarStatus,
  listBusinessAgentCalendars,
  selectBusinessAgentCalendar,
  startBusinessAgentCalendarConnect,
} from "@/lib/business-agent-client";
import type { CalendarStatusResponse } from "@/lib/business-agent-client";
import type { NylasCalendar } from "@/lib/agent-compiler/calendar/types";
import { actionBtn, Field, inputCls, primaryBtn, SectionCard } from "@/components/dashboard/business-agent/ui";
import { Pill } from "@/components/dashboard/shell/ui";

/**
 * Bloque 15C — conexión de calendario self-service (Nylas). El cliente solo
 * ve conceptos de negocio ("conectar agenda", "elegir calendario") -- nunca
 * grant_id/tokens/API keys. El estado real de conexión (conectado/pendiente/
 * error) siempre viene del servidor, nunca se infiere en el navegador.
 */
export function CalendarConnection() {
  const { t } = useI18n();
  const { session } = useDashboard();
  const [status, setStatus] = useState<CalendarStatusResponse | null>(null);
  const [calendars, setCalendars] = useState<NylasCalendar[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callbackNotice, setCallbackNotice] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!session) return;
    const result = await getBusinessAgentCalendarStatus({ accessToken: session.access_token });
    if (result.ok) {
      setStatus(result.data);
      setError(null);
    } else {
      setError(result.error.message);
    }
  }, [session]);

  useEffect(() => {
    // Carga al montar -- intencional (mismo patrón ya usado en el resto del dashboard).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  // Resultado del redirect de OAuth (?calendar=connected|cancelled|error|...) --
  // lectura única de la URL al montar, mismo patrón que lib/i18n.tsx.
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("calendar");
    if (!value) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCallbackNotice(
      value === "connected"
        ? t("¡Calendario conectado! Elige cuál usar abajo.", "Calendar connected! Choose which one to use below.")
        : value === "cancelled"
          ? t("Conexión cancelada.", "Connection cancelled.")
          : t("No se pudo conectar el calendario -- intenta de nuevo.", "Couldn't connect the calendar -- try again."),
    );
    const url = new URL(window.location.href);
    url.searchParams.delete("calendar");
    window.history.replaceState(null, "", url.toString());
  }, [t]);

  useEffect(() => {
    if (status?.connection.status === "connected" && !status.connection.selectedCalendarId && session) {
      // Conectado pero sin calendario elegido -- carga la lista real para el selector.
      void (async () => {
        const result = await listBusinessAgentCalendars({ accessToken: session.access_token });
        if (result.ok) setCalendars(result.data.calendars);
      })();
    }
  }, [status, session]);

  const conectar = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    const result = await startBusinessAgentCalendarConnect({ accessToken: session.access_token });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    window.location.href = result.data.authUrl;
  };

  const elegirCalendario = async (calendarId: string) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    const result = await selectBusinessAgentCalendar({ accessToken: session.access_token, calendarId });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await cargar();
  };

  const desconectar = async () => {
    if (!session) return;
    if (!window.confirm(t("¿Desconectar el calendario? El agente dejará de poder agendar citas reales.", "Disconnect the calendar? The agent will stop being able to book real appointments."))) return;
    setBusy(true);
    setError(null);
    const result = await disconnectBusinessAgentCalendar({ accessToken: session.access_token });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setCalendars(null);
    await cargar();
  };

  if (!status) {
    return (
      <SectionCard title={t("Calendario", "Calendar")}>
        <p className="text-sm text-mist">{t("Cargando…", "Loading…")}</p>
      </SectionCard>
    );
  }

  if (!status.providerAvailable) {
    return (
      <SectionCard title={t("Calendario", "Calendar")}>
        <p className="text-sm text-mist">
          {t(
            "La conexión de calendario todavía no está habilitada para tu cuenta -- contáctanos para activarla.",
            "Calendar connection isn't enabled for your account yet -- contact us to turn it on.",
          )}
        </p>
      </SectionCard>
    );
  }

  const conn = status.connection;

  return (
    <SectionCard
      title={t("Calendario", "Calendar")}
      description={t(
        "Conecta tu calendario real para que el agente pueda revisar disponibilidad y agendar citas -- nunca inventa horarios.",
        "Connect your real calendar so the agent can check availability and book appointments -- it never makes up time slots.",
      )}
    >
      {callbackNotice && <p className="rounded-lg border border-edge bg-ink p-3 text-xs text-mist">{callbackNotice}</p>}
      {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-400">{error}</p>}

      {conn.status === "connected" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CalendarCheck2 className="size-4 text-lime-text" />
            <Pill tone="success">{t("Conectado", "Connected")}</Pill>
            {conn.accountEmail && <span className="text-sm text-fg">{conn.accountEmail}</span>}
          </div>

          {conn.selectedCalendarId ? (
            <p className="text-sm text-mist">
              {t("Calendario en uso: ", "Calendar in use: ")}
              <span className="text-fg">{conn.selectedCalendarName}</span>
            </p>
          ) : (
            <Field label={t("Elige qué calendario usar", "Choose which calendar to use")}>
              {calendars === null ? (
                <p className="text-sm text-mist">{t("Cargando calendarios…", "Loading calendars…")}</p>
              ) : (
                <select className={inputCls} disabled={busy} defaultValue="" onChange={(e) => e.target.value && void elegirCalendario(e.target.value)}>
                  <option value="" disabled>{t("Selecciona…", "Select…")}</option>
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.isPrimary ? ` (${t("principal", "primary")})` : ""}</option>
                  ))}
                </select>
              )}
            </Field>
          )}

          <button type="button" onClick={desconectar} disabled={busy} className={actionBtn}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Unplug className="size-3.5" />}
            {t("Desconectar calendario", "Disconnect calendar")}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {conn.status === "error" && <p className="text-xs text-amber-400">{t("La última conexión falló -- intenta de nuevo.", "The last connection attempt failed -- try again.")}</p>}
          <button type="button" onClick={conectar} disabled={busy} className={primaryBtn}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CalendarCheck2 className="size-4" />}
            {t("Conectar calendario", "Connect calendar")}
          </button>
        </div>
      )}
    </SectionCard>
  );
}
