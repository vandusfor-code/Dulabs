"use client";

/**
 * Navegación inferior del tema "tecnologia" (solo en el INICIO móvil): cinco destinos — Inicio, Categorías, Favoritos, Notificaciones y Cuenta —,
 * fija abajo, sobre fondo blanco con una sombra superior muy sutil y respetando el área segura de iOS. Inicio y Categorías son reales; Favoritos,
 * Notificaciones y Cuenta todavía NO existen en el sistema: se muestran (UI lista para conectar) y, al tocarlas, avisan con honestidad que llegan pronto.
 * No inventan datos (sin punto rojo de notificaciones ni contadores).
 */
import Link from "next/link";
import { useState } from "react";
import { Bell, Heart, House, LayoutGrid, UserRound, X, type LucideIcon } from "lucide-react";
import { Dialogo } from "@/components/catalogo-publico/tienda/Dialogo";
import { useEnInicio } from "@/components/catalogo-publico/tienda/tecnologia/HeaderTecnologia";

type Pronto = "favoritos" | "notificaciones" | "cuenta";

const PRONTO: Record<Pronto, { titulo: string; texto: string }> = {
  favoritos: { titulo: "Favoritos", texto: "Muy pronto podrás guardar tus productos favoritos para encontrarlos rápido." },
  notificaciones: { titulo: "Notificaciones", texto: "Muy pronto te avisaremos aquí de tus pedidos y de las novedades de la tienda." },
  cuenta: { titulo: "Tu cuenta", texto: "Muy pronto podrás ver tus datos y tus pedidos desde aquí." },
};

const item = "flex h-[68px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-[color,transform] duration-150 active:scale-95";

function Icono({ Icono, activo }: { Icono: LucideIcon; activo?: boolean }) {
  return <Icono className="size-[24px]" strokeWidth={activo ? 2.1 : 1.6} aria-hidden />;
}

export function NavInferiorTecnologia({ basePath, categoriasHref }: { basePath: string; categoriasHref: string }) {
  const enInicio = useEnInicio(basePath);
  const [pronto, setPronto] = useState<Pronto | null>(null);
  if (!enInicio) return null;
  const abierto = pronto ? PRONTO[pronto] : null;

  return (
    <>
      <nav
        aria-label="Navegación de la tienda"
        className="fixed inset-x-0 bottom-0 z-40 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_-12px_rgba(7,20,38,0.28)] md:hidden"
      >
        <div className="mx-auto flex max-w-md px-1">
          <Link href={basePath} className={item + " text-[var(--tech-blue)]"} aria-current="page">
            <Icono Icono={House} activo />
            Inicio
          </Link>
          <Link href={categoriasHref} className={item + " text-[#475569]"}>
            <Icono Icono={LayoutGrid} />
            Categorías
          </Link>
          <button type="button" onClick={() => setPronto("favoritos")} className={item + " text-[#475569]"} aria-haspopup="dialog">
            <Icono Icono={Heart} />
            Favoritos
          </button>
          <button type="button" onClick={() => setPronto("notificaciones")} className={item + " text-[#475569]"} aria-haspopup="dialog">
            <Icono Icono={Bell} />
            Notificaciones
          </button>
          <button type="button" onClick={() => setPronto("cuenta")} className={item + " text-[#475569]"} aria-haspopup="dialog">
            <Icono Icono={UserRound} />
            Cuenta
          </button>
        </div>
      </nav>

      <Dialogo
        open={abierto !== null}
        onClose={() => setPronto(null)}
        labelledBy="tech-pronto-titulo"
        className="tienda-velo m-auto w-[min(88vw,22rem)] rounded-[22px] border border-edge bg-card p-0 text-fg shadow-2xl backdrop:bg-fg/35 backdrop:backdrop-blur-[2px]"
      >
        {abierto && (
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 id="tech-pronto-titulo" className="text-lg font-extrabold tracking-[-0.01em]">
                {abierto.titulo}
              </h2>
              <button type="button" onClick={() => setPronto(null)} className="-mr-2 -mt-2 grid size-11 place-items-center rounded-full text-mist hover:bg-fg/5" aria-label="Cerrar">
                <X className="size-5" strokeWidth={1.8} aria-hidden />
              </button>
            </div>
            <p className="mt-1 text-[14px] leading-snug text-mist">{abierto.texto}</p>
            <button type="button" onClick={() => setPronto(null)} className="mt-4 h-11 w-full rounded-[14px] bg-[var(--tech-blue)] text-[15px] font-bold text-white transition-transform active:scale-[0.98]">
              Entendido
            </button>
          </div>
        )}
      </Dialogo>
    </>
  );
}
