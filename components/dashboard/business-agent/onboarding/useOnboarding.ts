"use client";

// Business Agent 2.0, FASE 6 — estado de la configuración guiada en el navegador.
//
//   - AUTOSAVE con debounce: cada cambio se guarda solo (guardar NO publica). Un guardado a la vez; si hubo más cambios
//     mientras tanto, se guarda de nuevo al terminar.
//   - REVISIÓN optimista: si otra pestaña/sesión guardó antes, estado "conflict" (nunca se pisa en silencio).
//   - SIN CONEXIÓN: se reintenta con espera creciente; los cambios siguen en pantalla y en un respaldo local.
//   - RECUPERACIÓN: al volver (recarga, corte), si el respaldo local tiene cambios sin guardar sobre la MISMA revisión,
//     se ofrece recuperarlos.
//   - Validación inmediata con la MISMA función del servidor (assembleDraft), con debounce; la definitiva la hace el
//     servidor al guardar, validar y publicar.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assembleDraft } from "@/lib/agent-compiler/onboarding/assemble";
import type { OnboardingDraft } from "@/lib/agent-compiler/onboarding/draft";
import type { OnboardingIssue } from "@/lib/agent-compiler/onboarding/issues";
import type { OnboardingOverview } from "@/lib/agent-compiler/onboarding/service";
import { getOnboarding, saveOnboardingDraft, type OnboardingAuth, type OnboardingClientError } from "@/lib/business-agent-onboarding-client";

export type SaveState = "idle" | "saving" | "saved" | "offline" | "conflict" | "error";

interface Backup {
  revision: number;
  draft: OnboardingDraft;
  at: string;
}

function readBackup(storage: Storage | null, key: string): Backup | null {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as Backup) : null;
  } catch {
    return null;
  }
}

function writeBackup(storage: Storage | null, key: string, b: Backup | null): void {
  try {
    if (!storage) return;
    if (b) storage.setItem(key, JSON.stringify(b));
    else storage.removeItem(key);
  } catch {
    // almacenamiento no disponible (modo privado): el autosave del servidor sigue funcionando
  }
}

export interface UseOnboardingOptions {
  debounceMs?: number;
  validateDebounceMs?: number;
  storage?: Storage | null;
  storageKey?: string;
}

export function useOnboarding(auth: OnboardingAuth | null, opts: UseOnboardingOptions = {}) {
  const debounceMs = opts.debounceMs ?? 1200;
  const storage = opts.storage === undefined ? (typeof window !== "undefined" ? window.localStorage : null) : opts.storage;
  const storageKey = opts.storageKey ?? "dulabs.business-agent.onboarding";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<OnboardingClientError | null>(null);
  const [overview, setOverview] = useState<OnboardingOverview | null>(null);
  const [draft, setDraftState] = useState<OnboardingDraft | null>(null);
  const [revision, setRevision] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<OnboardingClientError | null>(null);
  const [serverIssues, setServerIssues] = useState<OnboardingIssue[]>([]);
  const [recovery, setRecovery] = useState<Backup | null>(null);
  const [validatedDraft, setValidatedDraft] = useState<OnboardingDraft | null>(null);

  const draftRef = useRef<OnboardingDraft | null>(null);
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; delay: number }>({ timer: null, delay: 2000 });
  const conflictRef = useRef(false);
  const authRef = useRef(auth);
  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  const load = useCallback(async () => {
    const a = authRef.current;
    if (!a) return;
    setLoading(true);
    const r = await getOnboarding(a);
    if (!r.ok) {
      setLoadError(r.error);
      setLoading(false);
      return;
    }
    setOverview(r.data);
    setLoadError(null);
    draftRef.current = r.data.draft;
    revisionRef.current = r.data.revision;
    dirtyRef.current = false;
    conflictRef.current = false;
    setDraftState(r.data.draft);
    setValidatedDraft(r.data.draft);
    setRevision(r.data.revision);
    setServerIssues(r.data.issues);
    setSaveState(r.data.savedAt ? "saved" : "idle");
    setSaveError(null);
    const backup = readBackup(storage, storageKey);
    // Cambios locales sin guardar sobre la MISMA revisión que el servidor => se ofrecen para recuperar.
    if (backup && backup.revision === r.data.revision && JSON.stringify(backup.draft) !== JSON.stringify(r.data.draft)) setRecovery(backup);
    else writeBackup(storage, storageKey, null);
    setLoading(false);
  }, [storage, storageKey]);

  useEffect(() => {
    void load();
  }, [load, auth?.accessToken]);

  // El guardado se reprograma a sí mismo (cambios durante un guardado, reintentos): se invoca por referencia.
  const saveRef = useRef<() => Promise<void>>(async () => {});

  const doSave = useCallback(async (): Promise<void> => {
    const a = authRef.current;
    if (!a || !draftRef.current || conflictRef.current) return;
    if (inFlightRef.current) {
      await inFlightRef.current;
      if (dirtyRef.current) return saveRef.current();
      return;
    }
    const snapshot = draftRef.current;
    dirtyRef.current = false;
    setSaveState("saving");
    const run = (async () => {
      const r = await saveOnboardingDraft(a, { expectedRevision: revisionRef.current, draft: snapshot });
      if (r.ok) {
        revisionRef.current = r.data.revision;
        setRevision(r.data.revision);
        setServerIssues(r.data.issues);
        setSaveError(null);
        retryRef.current.delay = 2000;
        writeBackup(storage, storageKey, dirtyRef.current ? { revision: r.data.revision, draft: draftRef.current!, at: new Date().toISOString() } : null);
        setSaveState(dirtyRef.current ? "saving" : "saved");
        return;
      }
      dirtyRef.current = true;
      setSaveError(r.error);
      if (r.error.status === 409) {
        conflictRef.current = true;
        setSaveState("conflict");
      } else if (r.error.status === 0 || r.error.status >= 500 || r.error.status === 429) {
        setSaveState("offline");
        const delay = retryRef.current.delay;
        retryRef.current.delay = Math.min(30_000, delay * 2);
        if (retryRef.current.timer) clearTimeout(retryRef.current.timer);
        retryRef.current.timer = setTimeout(() => {
          retryRef.current.timer = null;
          void saveRef.current();
        }, delay);
      } else {
        setSaveState("error");
      }
    })();
    inFlightRef.current = run;
    await run;
    inFlightRef.current = null;
    // Cambios hechos mientras se guardaba: se guardan ahora (salvo conflicto o reintento ya programado).
    if (dirtyRef.current && !conflictRef.current && !retryRef.current.timer) await saveRef.current();
  }, [storage, storageKey]);
  useEffect(() => {
    saveRef.current = doSave;
  }, [doSave]);

  const setDraft = useCallback(
    (update: OnboardingDraft | ((d: OnboardingDraft) => OnboardingDraft)) => {
      const current = draftRef.current;
      if (!current) return;
      const next = typeof update === "function" ? update(current) : update;
      draftRef.current = next;
      dirtyRef.current = true;
      setDraftState(next);
      writeBackup(storage, storageKey, { revision: revisionRef.current, draft: next, at: new Date().toISOString() });
      if (conflictRef.current) return;
      // Honesto: con cambios pendientes nunca se muestra "Guardado" (sin conexión sigue diciendo que reintenta).
      setSaveState((st) => (st === "offline" ? st : "saving"));
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void doSave(), debounceMs);
    },
    [debounceMs, doSave, storage, storageKey],
  );

  /** Guarda YA lo pendiente (antes de publicar, probar o salir). true = todo guardado. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (retryRef.current.timer) {
      clearTimeout(retryRef.current.timer);
      retryRef.current.timer = null;
    }
    if (dirtyRef.current || inFlightRef.current) await doSave();
    return !dirtyRef.current && !conflictRef.current;
  }, [doSave]);

  // Validación inmediata con debounce (no en cada tecla).
  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(() => setValidatedDraft(draft), opts.validateDebounceMs ?? 250);
    return () => clearTimeout(t);
  }, [draft, opts.validateDebounceMs]);
  const localIssues = useMemo(() => (validatedDraft ? assembleDraft(validatedDraft).issues : []), [validatedDraft]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (retryRef.current.timer) clearTimeout(retryRef.current.timer);
    },
    [],
  );

  const applyRecovery = useCallback(() => {
    if (!recovery) return;
    setRecovery(null);
    setDraft(recovery.draft);
  }, [recovery, setDraft]);

  const discardRecovery = useCallback(() => {
    setRecovery(null);
    writeBackup(storage, storageKey, null);
  }, [storage, storageKey]);

  const refreshOverview = useCallback(async () => {
    const a = authRef.current;
    if (!a) return;
    const r = await getOnboarding(a);
    if (r.ok) {
      setOverview(r.data);
      setServerIssues(r.data.issues);
    }
  }, []);

  return {
    loading,
    loadError,
    overview,
    draft,
    setDraft,
    revision,
    saveState,
    saveError,
    /** Problemas: los del navegador (inmediatos) + los que solo el servidor conoce (datos reales). */
    issues: mergeIssues(localIssues, serverIssues),
    recovery,
    applyRecovery,
    discardRecovery,
    flush,
    reload: load,
    refreshOverview,
  };
}

/** Los problemas de estructura se toman del cálculo local (más reciente); los de datos reales, del servidor. */
function mergeIssues(local: OnboardingIssue[], server: OnboardingIssue[]): OnboardingIssue[] {
  const serverOnly = server.filter((i) => i.code.startsWith("BA-RDY") || i.code === "BA-VAL-017");
  return [...local, ...serverOnly];
}
