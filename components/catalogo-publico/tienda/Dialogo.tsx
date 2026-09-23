"use client";

/**
 * Diálogo modal NATIVO (<dialog> + showModal): el navegador aporta el foco
 * atrapado, Esc para cerrar, el fondo inerte para lectores de pantalla y la
 * capa superior (sin z-index ni librerías). Tocar fuera del panel lo cierra.
 */
import { useEffect, useRef, type ReactNode } from "react";

export function Dialogo({
  open,
  onClose,
  className,
  labelledBy,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className?: string;
  labelledBy?: string;
  label?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // El scroll del fondo se bloquea mientras está abierto (iOS no lo hace solo).
  useEffect(() => {
    if (!open) return;
    const previo = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previo;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      aria-label={label}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Clic en el velo => cerrar. Solo cuenta si el destino es el propio
        // <dialog> y cae fuera del panel (un "click" de teclado sobre un botón
        // interno llega con coordenadas 0,0 y NO debe cerrar).
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
      }}
      className={className}
    >
      {open && children}
    </dialog>
  );
}
