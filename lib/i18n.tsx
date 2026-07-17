"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "es" | "en";

const STORAGE_KEY = "du_labs_lang";

type I18nValue = {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Devuelve `en` cuando el idioma es inglés; si no, cae a `es` (respaldo). */
  t: (es: string, en: string) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  // Arranca en "es" para que el render del servidor y el primer render del
  // cliente coincidan (evita hydration mismatch). La preferencia guardada se
  // aplica en el efecto de abajo.
  const [lang, setLangState] = useState<Lang>("es");

  useEffect(() => {
    try {
      const guardado = localStorage.getItem(STORAGE_KEY);
      // Aplicar la preferencia guardada al montar. Es un render extra único y
      // deliberado (evita el hydration mismatch de leer localStorage en el
      // initializer de useState).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (guardado === "en" || guardado === "es") setLangState(guardado);
    } catch {
      // localStorage no disponible: se queda en "es"
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignorar
    }
  };

  const t = (es: string, en: string) => (lang === "en" ? en : es);

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Respaldo seguro si algún componente se usa fuera del provider: español.
    return { lang: "es", setLang: () => {}, t: (es: string) => es };
  }
  return ctx;
}
