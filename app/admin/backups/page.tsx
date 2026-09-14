"use client";

import { PageHeader } from "@/components/dashboard/shell/ui";

// FASE F15 (Operations Center, autorizado) -- Fase 22 del pedido: página
// puramente informativa. Auditado esta fase: esta app usa el cliente de
// datos de Supabase (service_role), que NO tiene acceso a la Management
// API de Supabase (backups/PITR se administran a nivel de proyecto, con
// credenciales distintas que este código nunca tiene). No existe ninguna
// integración directa de backup en el repo -- no se inventa un botón que
// simule restaurar algo. Los backups reales de DuLabs dependen del plan de
// Supabase del proyecto (Free: sin backups automáticos; Pro+: backups
// diarios automáticos, algunos planes con Point-in-Time Recovery) -- eso
// se configura y se restaura ÚNICAMENTE desde el dashboard real de
// Supabase, con las credenciales de cuenta del proyecto, nunca desde acá.
export default function AdminBackupsPage() {
  return (
    <div>
      <PageHeader eyebrow="Centro de Operaciones" title="Backups" description="Estado real -- sin simulaciones." />
      <div className="px-4 py-6 md:max-w-2xl md:px-8">
        <div className="rounded-xl border border-edge bg-card p-6">
          <p className="text-sm leading-relaxed text-fg">
            Esta aplicación se conecta a Supabase con la clave de datos (<code className="rounded bg-ink px-1.5 py-0.5 text-xs">service_role</code>), que
            <strong> no tiene acceso</strong> a la Management API de Supabase -- ahí es donde viven los backups y Point-in-Time Recovery (PITR). No existe
            hoy ninguna integración directa de backups en este código, y esta página no la simula.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-mist">
            Lo real: Supabase administra backups automáticos a nivel de proyecto según el plan contratado (Free: sin backups automáticos · Pro y superior:
            backups diarios automáticos, algunos planes con PITR). Verificar el estado real y restaurar un backup solo puede hacerse desde el dashboard de
            Supabase, con las credenciales de cuenta del proyecto -- nunca desde este panel.
          </p>
          <a
            href="https://supabase.com/dashboard/project/_/database/backups/scheduled"
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-block rounded-lg border border-edge px-4 py-2 text-sm font-medium text-fg hover:bg-ink"
          >
            Abrir Backups en el dashboard de Supabase ↗
          </a>
        </div>
      </div>
    </div>
  );
}
