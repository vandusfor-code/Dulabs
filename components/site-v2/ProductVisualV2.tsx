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
      {/* Glow ambiental muy suave detrás del producto: funde los bordes con
          el fondo para que el mockup NO parezca pegado (se integra a la
          escena). Blanco cálido, sin color. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-16 -z-20 rounded-[80px] bg-[radial-gradient(60%_55%_at_55%_45%,rgba(255,255,255,0.9)_0%,rgba(255,255,255,0)_70%)]"
      />

      {/* Follaje real (asset SVG propio) DETRÁS y arriba-derecha del laptop,
          como en el mockup (regla 9/19): desenfocado, baja opacidad, ambiental,
          nunca protagonista ni compitiendo con el texto. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/v2/plant.svg"
        alt=""
        aria-hidden
        className="v2-plant pointer-events-none absolute -top-28 -right-20 -z-10 h-[320px] w-auto opacity-70 sm:-right-24 sm:h-[380px] md:h-[440px]"
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
      <div className="v2-product-box [--s:0.4] min-[420px]:[--s:0.46] sm:[--s:0.58] md:[--s:0.66] lg:[--s:0.7] xl:[--s:0.68] 2xl:[--s:0.74]">
        {/* Sombra de contacto: apoya el producto en la escena (peso físico) */}
        <div
          aria-hidden
          className="v2-contact-shadow pointer-events-none absolute inset-x-[8%] -bottom-5 -z-10 h-10"
        />
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
