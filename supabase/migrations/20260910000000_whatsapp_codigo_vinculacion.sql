-- WhatsApp "Vincular con número de teléfono" (autorizado) — alternativa
-- real al QR (misma API que ya expone Baileys: sock.requestPairingCode).
-- Columnas aditivas, mismo patrón que qr_actual/qr_generado_en -- ningún
-- tenant existente ni conexión ya activa se ve afectada por esto.

alter table public.dulabs_whatsapp_qr_sesiones
  add column if not exists codigo_vinculacion text,
  add column if not exists codigo_generado_en timestamptz;

comment on column public.dulabs_whatsapp_qr_sesiones.codigo_vinculacion is
  'Código de 8 caracteres para "Vincular con número de teléfono" (alternativa al QR). Mutuamente excluyente con qr_actual -- una conexión en curso usa un mecanismo a la vez, nunca ambos.';
