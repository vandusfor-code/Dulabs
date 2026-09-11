import { MessageCircle, ArrowRight, Bot, Database, Zap } from "lucide-react";
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
        src="/newversion/plant.svg"
        alt=""
        aria-hidden
        className="v2-plant pointer-events-none absolute -top-28 -right-20 -z-10 h-[320px] w-auto opacity-70 sm:-right-24 sm:h-[380px] md:h-[440px]"
      />

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

      {/* Tarjeta flotante: el flujo Cliente -> Agente IA -> CRM (regla 16 del
          brief), cualitativa a propósito -- SIN ninguna cifra o porcentaje
          inventado (antes decía "248 · +32%", una métrica sin fuente real,
          ver regla de veracidad). Flota SOBRE el borde superior del laptop. */}
      <div className="v2-shadow-float absolute -left-2 -top-12 flex items-center gap-2.5 rounded-2xl border border-sitev2-border bg-sitev2-bg px-3.5 py-2.5 sm:-left-6 sm:-top-14">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sitev2-surface-2">
          <MessageCircle className="h-3.5 w-3.5 text-sitev2-fg" strokeWidth={2} />
        </span>
        <ArrowRight className="h-3 w-3 shrink-0 text-sitev2-subtle-fg" strokeWidth={2} />
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sitev2-primary-soft">
          <Bot className="h-3.5 w-3.5 text-sitev2-primary" strokeWidth={2} />
        </span>
        <ArrowRight className="h-3 w-3 shrink-0 text-sitev2-subtle-fg" strokeWidth={2} />
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sitev2-surface-2">
          <Database className="h-3.5 w-3.5 text-sitev2-fg" strokeWidth={2} />
        </span>
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
