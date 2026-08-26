"use client";

import { useState } from "react";
import { Menu, Bell } from "lucide-react";
import { partesLogo } from "./format";

// Cabecera móvil que reproduce el mockup de Daniela Manco Nails Spa: fondo
// blanco con un tinte rosa casi imperceptible, fila superior (hamburguesa /
// logo / campana) y debajo el saludo a la izquierda con la foto de la mano
// recortada por el borde derecho. Solo se muestra en mobile -- el desktop
// sigue usando <Header>.
//
// La foto real todavía no está disponible -- se referencia en
// /public/mano-hero.png y se oculta sola (onError) mientras ese archivo no
// exista, sin sustituirla por una ilustración genérica.
export function MobileHero({
  nombre,
  negocio,
  onAbrirMenu,
}: {
  nombre: string;
  negocio: string;
  onAbrirMenu: () => void;
}) {
  const [linea1, linea2] = partesLogo(negocio);
  // Hasta que /public/mano-hero.png exista, se oculta en vez de mostrar el
  // ícono de imagen rota -- no se sustituye por una ilustración genérica.
  const [manoDisponible, setManoDisponible] = useState(true);

  return (
    <section
      className="relative overflow-hidden lg:hidden"
      style={{ background: "linear-gradient(180deg, #ffffff 0%, #fff6f8 100%)" }}
    >
      <div className="relative z-10 flex items-center justify-between px-4 pt-4">
        <button
          onClick={onAbrirMenu}
          aria-label="Abrir menú"
          className="flex size-9 items-center justify-center rounded-full bg-lime-soft text-lime-text"
        >
          <Menu className="size-4" />
        </button>

        <div className="text-center leading-tight">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-fg">{linea1}</p>
          {linea2 && <p className="text-[9px] font-medium tracking-[0.18em] text-lime-text">{linea2}</p>}
        </div>

        <button aria-label="Notificaciones" className="flex size-9 items-center justify-center text-mist">
          <Bell className="size-[18px]" />
        </button>
      </div>

      <div className="relative min-h-[21vh] px-4 pb-4 pt-5">
        <div className="w-[56%]">
          <h1 className="text-xl font-semibold leading-snug text-fg">
            Hola, <span className="text-lime-text">{nombre}</span> 👋
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-mist">¡Qué lindo verte por aquí! 💕</p>
          <p className="mt-1.5 text-sm leading-relaxed text-mist">Gestiona tus citas de forma fácil y rápida</p>
        </div>

        {manoDisponible && (
          // eslint-disable-next-line @next/next/no-img-element -- foto de marca, no un asset optimizable por next/image
          <img
            src="/mano-hero.png"
            alt=""
            aria-hidden="true"
            onError={() => setManoDisponible(false)}
            className="pointer-events-none absolute -right-3 bottom-0 top-4 w-[48%] object-contain object-right-bottom [mask-image:linear-gradient(to_right,transparent,black_22%)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_22%)]"
          />
        )}
      </div>
    </section>
  );
}
