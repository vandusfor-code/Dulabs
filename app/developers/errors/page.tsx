// DuLabs Developer V1 -- Fase 14.5. Catálogo de errores (derivado de
// services/gateway/errors.ts). Envelope uniforme + códigos estables + HTTP.

const ERRORES: { code: string; http: string; cuando: string }[] = [
  { code: "missing_api_key", http: "401", cuando: "Falta la cabecera Authorization: Bearer." },
  { code: "invalid_api_key", http: "401", cuando: "API key inexistente o revocada." },
  { code: "invalid_request", http: "400", cuando: "Cuerpo/cabecera inválidos (JSON, Idempotency-Key, campos)." },
  { code: "invalid_whatsapp_number", http: "400", cuando: "whatsappNumberId no existe en tu workspace." },
  { code: "forbidden", http: "403", cuando: "La API key no tiene permiso para la operación." },
  { code: "not_found", http: "404", cuando: "El recurso (mensaje/número) no existe en tu workspace." },
  { code: "idempotency_conflict", http: "409", cuando: "Misma Idempotency-Key con un payload distinto." },
  { code: "rate_limit_exceeded", http: "429", cuando: "Superaste el límite de tasa. Reintenta según Retry-After." },
  { code: "monthly_message_limit_exceeded", http: "429", cuando: "Cuota mensual de mensajes del plan agotada." },
  { code: "internal_error", http: "500", cuando: "Error interno. Reporta el request_id si persiste." },
];

export default function ErroresPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold text-fg">Errores</h1>
      <p className="mt-3 text-sm text-mist">
        Todas las respuestas de error usan el mismo envelope. El <code className="text-fg">request_id</code> también viaja en la cabecera <code className="text-fg">X-Request-Id</code> — inclúyelo al reportar un problema.
      </p>
      <pre className="my-4 overflow-x-auto rounded-lg border border-edge bg-ink p-4 text-[12px] text-fg"><code>{`{
  "error": {
    "code": "invalid_request",
    "message": "text.body no puede estar vacío",
    "request_id": "dev_..."
  }
}`}</code></pre>

      <h2 className="mt-8 text-lg font-semibold text-fg">Códigos</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-edge text-xs uppercase tracking-wide text-mist">
              <th className="py-2 pr-4">Código</th>
              <th className="py-2 pr-4">HTTP</th>
              <th className="py-2">Cuándo</th>
            </tr>
          </thead>
          <tbody>
            {ERRORES.map((e) => (
              <tr key={e.code} className="border-b border-edge/60">
                <td className="py-2 pr-4 font-mono text-xs text-fg">{e.code}</td>
                <td className="py-2 pr-4 text-mist">{e.http}</td>
                <td className="py-2 text-mist">{e.cuando}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-6 text-xs text-mist">Los mensajes (<code>message</code>) son legibles pero pueden cambiar; programa contra <code>code</code> y el status HTTP, nunca contra el texto.</p>
    </>
  );
}
