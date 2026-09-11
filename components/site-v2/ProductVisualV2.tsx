import { TrendingUp, Zap } from "lucide-react";
import { AppMockupV2 } from "./AppMockupV2";

/**
 * Composición del hero derecho: el mockup del producto escalado, la planta
 * desenfocada detrás (profundidad), y las dos tarjetas flotantes de la
 * referencia. Las tarjetas NO se escalan con el producto — se mantienen
 * nítidas y forman parte de la composición.
 */
export function ProductVisualV2() {
  return (
    <div className="relative mx-auto w-fit">
      {/* Planta desenfocada, detrás y a la derecha (regla 19): profundidad,
          parcialmente oculta por el producto, nunca protagonista. */}
      <div
        aria-hidden
        className="v2-plant pointer-events-none absolute -right-4 top-1/2 -z-10 h-[360px] w-[240px] -translate-y-1/2 opacity-80 sm:-right-8 md:h-[420px] md:w-[300px]"
      />

      {/* Caption sutil arriba a la derecha */}
      <div className="pointer-events-none absolute -top-8 right-1 hidden text-right md:block">
        <p className="text-[12px] leading-tight text-sitev2-subtle-fg">
          Ideas de hoy.
          <br />
          Resultados de mañana.
        </p>
      </div>

      {/* Producto escalado */}
      <div className="v2-product-box [--s:0.4] min-[420px]:[--s:0.46] sm:[--s:0.58] md:[--s:0.66] lg:[--s:0.7] xl:[--s:0.64] 2xl:[--s:0.72]">
        <div className="v2-product-scaler">
          <AppMockupV2 />
        </div>
      </div>

      {/* Tarjeta flotante: Conversaciones atendidas — flota SOBRE el borde
          superior del laptop (como la referencia), despejada del header. */}
      <div className="v2-shadow-float absolute -left-2 -top-12 flex items-center gap-3 rounded-2xl border border-sitev2-border bg-sitev2-bg px-3.5 py-2.5 sm:-left-6 sm:-top-14">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sitev2-surface-2">
          <TrendingUp className="h-4 w-4 text-sitev2-fg" strokeWidth={2} />
        </span>
        <div className="leading-tight">
          <p className="text-[10.5px] text-sitev2-muted-fg">Conversaciones atendidas</p>
          <p className="flex items-center gap-1.5">
            <span className="font-display text-[18px] font-semibold text-sitev2-fg">248</span>
            <span className="flex items-center gap-0.5 text-[11px] font-medium text-sitev2-primary">
              ▲ +32%
            </span>
          </p>
        </div>
      </div>

      {/* Tarjeta flotante: Automatización activa */}
      <div className="v2-shadow-float absolute -bottom-5 left-2 flex items-center gap-3 rounded-2xl border border-sitev2-border bg-sitev2-bg px-3.5 py-2.5 sm:left-6 md:-bottom-6">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sitev2-primary-soft">
          <Zap className="h-4 w-4 text-sitev2-primary" strokeWidth={2} fill="currentColor" />
        </span>
        <div className="leading-tight">
          <p className="text-[12.5px] font-medium text-sitev2-fg">Automatización activa</p>
          <p className="text-[10.5px] text-sitev2-muted-fg">Seguimiento de leads</p>
        </div>
        {/* Toggle ON */}
        <span className="ml-1 flex h-5 w-9 items-center rounded-full bg-sitev2-primary p-0.5">
          <span className="ml-auto h-4 w-4 rounded-full bg-white shadow-sm" />
        </span>
      </div>
    </div>
  );
}
