"use client";

import { useState } from "react";

export const THEME_KEY = "du_labs_theme";

function IconoSol() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <circle cx="12" cy="12" r="4" />
      <path
        strokeLinecap="round"
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
      />
    </svg>
  );
}

function IconoLuna() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [oscuro, setOscuro] = useState(() =>
    typeof document === "undefined" ? false : document.documentElement.getAttribute("data-theme") === "dark"
  );

  const alternar = () => {
    const nuevo = !oscuro;
    setOscuro(nuevo);
    if (nuevo) {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem(THEME_KEY, "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem(THEME_KEY, "light");
    }
  };

  return (
    <button
      onClick={alternar}
      aria-label={oscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      title={oscuro ? "Modo claro" : "Modo oscuro"}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-edge text-mist transition-colors duration-200 hover:border-lime/50 hover:text-fg ${className}`}
    >
      {oscuro ? <IconoSol /> : <IconoLuna />}
    </button>
  );
}
