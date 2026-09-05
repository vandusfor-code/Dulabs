-- AMORE / DuLabs (Fase 9A, WhatsApp por QR, autorizado) —
-- infraestructura de conexión GENÉRICA por tenant (no exclusiva de AMORE).
-- Una fila = el estado de la sesión WhatsApp-QR de un tenant, aislado por
-- id_tenant. creds/claves son las credenciales reales de la sesión
-- (equivalente a lo que useMultiFileAuthState de Baileys guardaría en
-- archivos) -- NUNCA se exponen a ninguna ruta que responda al navegador,
-- solo las lee/escribe el manager server-side (ver lib/whatsapp-qr/).

create table if not exists public.dulabs_whatsapp_qr_sesiones (
  id_tenant uuid primary key,
  estado text not null default 'desconectado' check (estado in ('desconectado', 'conectando', 'conectado')),
  numero_conectado text,
  conectado_en timestamptz,
  qr_actual text,
  qr_generado_en timestamptz,
  ultimo_error text,
  creds jsonb,
  claves jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dulabs_whatsapp_qr_sesiones enable row level security;

comment on table public.dulabs_whatsapp_qr_sesiones is
  'Sesión de WhatsApp por QR (Fase 9A), una fila por tenant. Genérica -- cualquier tenant puede tener la suya, aislada por id_tenant. AMORE es el primer tenant en usarla.';
comment on column public.dulabs_whatsapp_qr_sesiones.creds is
  'Credenciales de la sesión (equivalente a useMultiFileAuthState de Baileys). Sensible -- nunca seleccionar desde una ruta que responda al navegador.';
comment on column public.dulabs_whatsapp_qr_sesiones.claves is
  'Almacén de claves de Signal (pre-keys, sesiones, etc.). Mismo criterio de sensibilidad que creds.';
comment on column public.dulabs_whatsapp_qr_sesiones.qr_actual is
  'Imagen QR vigente como data URL, o null si no aplica. No es sensible -- es lo mismo que se mostraría en pantalla para escanear.';
