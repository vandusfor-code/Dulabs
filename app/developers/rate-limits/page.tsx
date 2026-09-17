// DuLabs Developer V1 -- Fase 14.5. Idempotencia + rate limits (derivado de
// services/gateway/outbound-handler.ts + validation.ts + rate-limit.ts).

export default function RateLimitsPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold text-fg">Idempotencia & rate limits</h1>

      <h2 className="mt-6 text-lg font-semibold text-fg">Idempotencia</h2>
      <p className="mt-3 text-sm text-mist">
        <code className="text-fg">POST /messages</code> exige la cabecera <code className="text-fg">Idempotency-Key</code> (única por operación; hasta 255 caracteres). Reintentar con la <strong>misma clave y el mismo payload</strong> devuelve <code className="text-fg">200</code> con <code className="text-fg">status: &quot;duplicado_identico&quot;</code> y <strong>no</strong> vuelve a enviar. Reusar la misma clave con un payload distinto devuelve <code className="text-fg">409 idempotency_conflict</code>.
      </p>
      <p className="mt-2 text-sm text-mist">Usa un identificador estable por intento (p. ej. un UUID por mensaje) y reintenta con la MISMA clave ante errores de red — nunca duplicarás el envío.</p>

      <h2 className="mt-8 text-lg font-semibold text-fg">Rate limits</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-mist">
        <li><strong>2 mensajes/segundo por número</strong> de WhatsApp.</li>
        <li><strong>1200 mensajes/minuto por workspace.</strong></li>
        <li>Ambos aplican; el más restrictivo gana. Al superarlos: <code className="text-fg">429 rate_limit_exceeded</code> con cabecera <code className="text-fg">Retry-After</code> (segundos).</li>
        <li>Cuota mensual del plan agotada: <code className="text-fg">429 monthly_message_limit_exceeded</code> (los mensajes de WhatsApp los factura Meta a tu WABA; la cuota es un límite comercial del plan).</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold text-fg">Cabeceras</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-mist">
        <li><code className="text-fg">X-Request-Id</code> — en toda respuesta; úsalo para soporte/trazabilidad.</li>
        <li><code className="text-fg">Retry-After</code> — en <code>429</code> de rate limit; segundos hasta reintentar.</li>
      </ul>
    </>
  );
}
