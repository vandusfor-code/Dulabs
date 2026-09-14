"use client";

import { Seccion } from "./AdminClienteUI";

// F15.2 (Operations Center, cierre) -- portado del admin legacy. Solo
// lectura (el envío real vive en /dashboard/campanas) -- acá solo se
// muestra el saldo de créditos de mensajes masivos del cliente.

export type CreditosMasivos = { limite: number; usados: number; disponibles: number } | null;

export function SeccionMensajesMasivos({ creditosMasivos }: { creditosMasivos: CreditosMasivos }) {
  if (!creditosMasivos) {
    return (
      <Seccion titulo="Mensajes masivos">
        <p className="text-sm text-mist">Este cliente todavía no tiene un paquete de mensajes masivos asignado.</p>
      </Seccion>
    );
  }
  const { limite, usados, disponibles } = creditosMasivos;
  return (
    <Seccion titulo="Mensajes masivos">
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs text-mist">Límite</p>
          <p className="font-semibold tabular-nums text-fg">{limite}</p>
        </div>
        <div>
          <p className="text-xs text-mist">Utilizados</p>
          <p className="font-semibold tabular-nums text-fg">{usados}</p>
        </div>
        <div>
          <p className="text-xs text-mist">Disponibles</p>
          <p className={`font-semibold tabular-nums ${disponibles <= 0 ? "text-red-400" : "text-fg"}`}>{disponibles}</p>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink">
        <div
          className={`h-full rounded-full ${disponibles <= 0 ? "bg-red-500" : "bg-lime"}`}
          style={{ width: `${Math.min(100, Math.round((usados / Math.max(1, limite)) * 100))}%` }}
        />
      </div>
    </Seccion>
  );
}
