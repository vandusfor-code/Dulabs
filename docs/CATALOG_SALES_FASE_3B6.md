# catalog_sales · Fase 3B.6 — Motor de envíos, cobertura y tiempos de entrega

Estado: implementada y verificada (sin commit, sin push, sin activar). Sin migraciones ni SQL.

## Principio

La IA no calcula tiempos, no decide cobertura, no inventa ciudades y no interpreta "2–3 días". El backend decide y la IA
solo usa una respuesta estructurada. La autoridad está en código y en la configuración del negocio, no en el prompt (el prompt
no cambió).

## Piezas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Motor puro | `lib/agente/envios.ts` | `resolverEnvio(reglas, {ciudad, departamento}, ahora)` → `ShippingDecision`. Sin modelo, determinista, hora de Colombia del reloj del backend. |
| Herramienta | `consultar_envio` (`herramientas.ts`) | Solo `{city, department?}` (estricto). Las reglas y el reloj salen del contexto del turno (la configuración de ESE número), nunca de los argumentos. |
| Guardián | `lib/agente/envios-anclaje.ts` + `anclaje.ts` | Todo lo que el modelo diga de envíos (tiempos, cobertura, costo, transportadora, garantías) debe estar respaldado por `consultar_envio` en el mismo turno. Solo actúa si el negocio tiene reglas de envío. |
| Derivación | `runtime.ts` | `human_handoff_required` ⇒ el backend pasa a una persona por la ruta existente (`requestHandoff`) con el mensaje fijo y el motivo `payment_or_delivery` (ya conocido por el diagnóstico SQL; el detalle queda en `trace.shipping`); el modelo no redacta. Una afirmación sin respaldo que persiste tras corregir ⇒ lo mismo. |
| Checkout | `runtime.ts` (`cityCoverage`, `texto_resumen`) | `ciudad_desconocida_en_checkout = handoff` consulta el motor; la línea del resumen sale de `envios.texto_resumen`. El checkout (3B.4) no se tocó. |
| Configuración | `perfil-negocio.ts` | Campos NUEVOS, todos opcionales: `tiempos[].dias_habiles {min,max}`, `tiempos[].transportadora`, `envios.envio_gratis`, `envios.transportadora_habitual`. Compuerta `envios` ahora `true`. |

## Resultado estructurado (`ShippingDecision`)

`status`: `covered` · `not_covered` · `coverage_unverified` · `unknown_city` · `inconsistent_location` · `insufficient_info` ·
`rules_unavailable`. Más: `covered`, `free_shipping` (true solo si el negocio lo configuró; null = no se dice nada del costo),
`carrier` (solo si la regla de la ciudad lo fija), `usual_carrier` (habitual, no una promesa), `eta_type`
(`same_day_possible` · `business_days` · `text_only` · `unknown`), `same_day_possible`, `guaranteed` (SIEMPRE false),
`min/max_business_days`, `customer_text` (texto EXACTO del negocio), `ask`, `human_handoff_required`, `reason`, `holidays`,
`evaluated_at`.

Reglas: ciudad confirmada con tiempo ⇒ responde; cualquier incertidumbre (ciudad desconocida, cobertura sin verificar,
departamento que no cuadra, sin tiempo verificable, sin reglas) ⇒ persona; sin ciudad ⇒ se le pregunta al cliente.

## Bogotá y días hábiles

"Antes de las 11:30 pueden tener entrega el mismo día" ⇒ `same_day_possible` (posibilidad condicional), nunca "llega hoy". La
frontera es estricta (11:29 sí, 11:30 no). Fin de semana o festivo escrito por el negocio ⇒ no hay "mismo día". No hay fuente
confiable de festivos colombianos en el sistema (brecha documentada en agenda-v2) y no se improvisó: los días hábiles NO se
convierten en fechas; solo se devuelve el rango que el negocio declaró y su texto. Con `festivos: ignorar` queda
`holidays: "not_checked"`.

## Forma de la configuración del negocio (valores del negocio, no por defecto)

```jsonc
"envios": {
  "cobertura": { "tipo": "todo_el_pais_salvo", "excluidas": [] },          // o lista_blanca
  "tiempos": [
    { "ciudades": ["bogota"], "texto": "<texto del negocio>",
      "corte": { "hora_limite": "11:30", "zona_horaria": "America/Bogota", "dias": ["lun","mar","mie","jue","vie"],
                 "festivos": { "tipo": "no_aplica_en", "fechas": ["AAAA-MM-DD"] },   // o { "tipo": "ignorar" }
                 "texto_antes": "<texto del negocio>", "texto_despues": "<texto del negocio>" } },
    { "ciudades": "resto_con_cobertura", "texto": "<texto del negocio>", "dias_habiles": { "min": 2, "max": 3 } }
  ],
  "sin_certeza": "handoff", "ciudad_desconocida_en_checkout": "handoff",
  "envio_gratis": true, "transportadora_habitual": "<nombre>", "texto_resumen": "<texto del negocio>"
}
```

## Pendiente (no es de 3B.6)

- **3B.7**: panel "Por aceptar" en el menú (hoy solo por URL) y lo que dependa de él.
- **3B.8**: textos finales (mensaje al derivar un envío, "no hay cobertura", etc.). Hoy se usa el mensaje fijo existente.
- **3B.9**: cargar las reglas reales de ASLC (ciudades, textos, hora, días, festivos explícitos, transportadora), poner
  `consultar_envio` en su lista de herramientas, y la activación.
