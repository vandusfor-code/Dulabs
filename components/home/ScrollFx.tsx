"use client";

import { useEffect } from "react";

// Motor de microinteracciones de la home: UN IntersectionObserver para toda la página, sin estado de React ni listeners de scroll.
//   [data-fx]            -> recibe data-visto al entrar en pantalla (una sola vez). El CSS decide qué se anima.
//   [data-fx-grupo]      -> flujo por pasos: sus [data-fx-disparador] visibles (los ocultos con display:none no cuentan) marcan el paso
//                           activo cuando cruzan la línea del 55 % del viewport; cada [data-fx-i="n"] del grupo recibe
//                           data-estado = pasado | activo | futuro, y el grupo --fx-progreso (0..1) para las líneas de progreso.
//   [data-fx-selector]   -> ver abajo: la opción con cursor/foco queda seleccionada (data-sel).
// Sin JS todo queda visible: el CSS solo oculta lo pendiente cuando <html> tiene .fx-listo, que se agrega aquí.
const LINEA = 0.55;

export function ScrollFx() {
  useEffect(() => {
    const raiz = document.documentElement;
    const alto = () => window.innerHeight;

    const revelables = [...document.querySelectorAll<HTMLElement>("[data-fx]")];
    // Lo que ya está en pantalla se marca antes de activar .fx-listo: así nunca parpadea.
    for (const el of revelables) {
      const r = el.getBoundingClientRect();
      if (r.top < alto() && r.bottom > 0) el.dataset.visto = "1";
    }
    raiz.classList.add("fx-listo");

    const vistos = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.visto = "1";
          vistos.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    for (const el of revelables) if (!el.dataset.visto) vistos.observe(el);

    const grupos = [...document.querySelectorAll<HTMLElement>("[data-fx-grupo]")];
    const actualizar = (grupo: HTMLElement) => {
      const disparadores = [...grupo.querySelectorAll<HTMLElement>("[data-fx-disparador]")].filter((d) => d.getClientRects().length > 0);
      let activo = -1;
      disparadores.forEach((d, i) => {
        if (d.getBoundingClientRect().top < alto() * LINEA) activo = i;
      });
      if (grupo.dataset.activo === String(activo)) return;
      grupo.dataset.activo = String(activo);
      const total = Math.max(1, disparadores.length - 1);
      grupo.style.setProperty("--fx-progreso", String(activo < 0 ? 0 : activo / total));
      for (const el of grupo.querySelectorAll<HTMLElement>("[data-fx-i]")) {
        const i = Number(el.dataset.fxI);
        el.dataset.estado = i < activo ? "pasado" : i === activo ? "activo" : "futuro";
      }
    };

    const cruces = new IntersectionObserver(
      (entradas) => {
        const tocados = new Set<HTMLElement>();
        for (const e of entradas) {
          const grupo = (e.target as HTMLElement).closest<HTMLElement>("[data-fx-grupo]");
          if (grupo) tocados.add(grupo);
        }
        tocados.forEach(actualizar);
      },
      { rootMargin: `0px 0px -${Math.round((1 - LINEA) * 100)}% 0px` },
    );
    for (const g of grupos) {
      for (const d of g.querySelectorAll("[data-fx-disparador]")) cruces.observe(d);
      actualizar(g);
    }

    // Al cambiar de breakpoint cambian los disparadores visibles (p. ej. la pista sticky de desktop vs. la lista de mobile).
    const alRedimensionar = () => grupos.forEach(actualizar);
    window.addEventListener("resize", alRedimensionar, { passive: true });

    // [data-fx-selector] + [data-fx-opcion="clave"]: la opción que recibe el cursor o el foco queda seleccionada (data-sel) hasta que se
    // elige otra. Un solo listener delegado para toda la página.
    const alSeleccionar = (e: Event) => {
      const opcion = (e.target as Element | null)?.closest?.<HTMLElement>("[data-fx-opcion]");
      const selector = opcion?.closest<HTMLElement>("[data-fx-selector]");
      if (opcion && selector && selector.dataset.sel !== opcion.dataset.fxOpcion) selector.dataset.sel = opcion.dataset.fxOpcion;
    };
    document.addEventListener("pointerover", alSeleccionar, { passive: true });
    document.addEventListener("focusin", alSeleccionar);

    return () => {
      vistos.disconnect();
      cruces.disconnect();
      window.removeEventListener("resize", alRedimensionar);
      document.removeEventListener("pointerover", alSeleccionar);
      document.removeEventListener("focusin", alSeleccionar);
      raiz.classList.remove("fx-listo");
    };
  }, []);

  return null;
}
