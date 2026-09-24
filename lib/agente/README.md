# Agente conversacional (Fase 8)

**Catálogo + backend = fuente de verdad. Gemini = razonamiento y conversación.
Herramientas = interfaz controlada entre ambos.**

## Capas

```
WhatsApp → app/webhook-dulabs/route.ts (firma, dedupe por wamid, tenant por phone_number_id,
           lista negra, ia_pausada, ia_restringida_a, pausa humana, cupo, ráfaga, candado)
        → lib/agente/webhook.ts        ¿el número tiene agente? (config explícita, fail-closed)
        → lib/agente/runtime.ts        bucle de tool calling + guardas + envío + estado + traza
        → lib/ia-proveedores/          contrato AIProvider (neutral)
             └─ gemini.ts              GeminiProvider: REST generateContent + function calling
        → lib/agente/herramientas.ts   13 herramientas (reutilizan lib/catalogo/pedidos)
        → motor de pedidos / catálogo (Fase 6-7)
```

| Archivo | Qué hace |
| --- | --- |
| `lib/ia-proveedores/contrato.ts` | Contrato neutral: un paso del modelo (texto y/o llamadas a herramientas), errores normalizados, estado opaco de continuación. Sin streaming ni fallback. |
| `lib/ia-proveedores/registro.ts` | Proveedores y modelos SOPORTADOS (lista cerrada), credencial por referencia `env:GEMINI_KEY_*`. **Sin default**: config incompleta = fail-closed. |
| `lib/ia-proveedores/gemini.ts` | `functionDeclarations` + `functionCallingConfig` `VALIDATED` con `allowedFunctionNames`; devuelve las partes del modelo con su `thoughtSignature`; `thinkingLevel`; errores HTTP normalizados sin filtrar la key ni el cuerpo. Aislado del `gemini-client.ts` de AMORE/Flow. |
| `lib/ia-proveedores/reintentos.ts` | 1 reintento (máx. 3) solo para errores transitorios, dentro del plazo del turno. Nunca cambia de proveedor. |
| `lib/ia-proveedores/simulado.ts` | Proveedor determinista para TODAS las pruebas. |
| `lib/agente/config.ts` | Fila de `dulabs_agente_runtime_config` → `none` / `disabled` / `invalid` / `ok`. |
| `lib/agente/estado.ts` | Memoria de corto plazo estructurada (`dulabs_agente_conversaciones`, compare-and-set). Nunca precios. |
| `lib/agente/contexto.ts` | Reglas de plataforma + negocio + estado (confiable, en `system`) + historial acotado y mensaje (no confiable). |
| `lib/agente/herramientas.ts` | Herramientas con guardas: procedencia, elección obligatoria, confirmación ligada, 1 escritura por turno, timeout. |
| `lib/agente/anclaje.ts` | La respuesta no se envía si menciona referencias, montos o cantidades que no vinieron del backend. |
| `lib/agente/runtime.ts` | El turno completo, con límites (4 rondas, 8 herramientas, 45 s) y mensajes fijos ante fallos. |
| `lib/agente/seleccion.ts` | Qué señaló el cliente: foto citada, referencia, posición ("el segundo") o nombre inequívoco. Nunca adivina. |
| `lib/agente/medios.ts` | Registro de fotos enviadas (`dulabs_agente_medios_enviados`): wamid de la foto -> producto, solo dentro de la conversación. |
| `lib/catalogo/imagen-whatsapp.ts` | Foto en JPEG para WhatsApp (Meta no acepta WebP como imagen), servida por la ruta pública `…/whatsapp.jpg`. |

## Qué decide la IA y qué el backend

| Gemini | Backend |
| --- | --- |
| Entender la intención y los atributos | Tenant (webhook), canal, conversación |
| Qué herramienta pedir y con qué argumentos permitidos | Productos, referencias, precios del canal, stock, disponibilidad |
| Preguntar cuando hay varias opciones | Totales, pedidos, propuestas, confirmación, estados |
| Redactar con los datos devueltos | Fotos válidas y su envío, pausas, límites, anclaje de la respuesta |

## Herramientas (allowlist por agente)

`search_products`, `resolve_product_by_reference`, `resolve_product_by_attributes`,
`get_product_details`, `get_cart`, `update_cart`, `resolve_order`,
`create_order_request`, `validate_order`, `confirm_order`, `get_customer_context`,
`request_product_images`, `handoff_to_human`, `get_catalog_link`, `more_products`, `similar_products`.

Ninguna acepta tenant, negocio, canal, id de producto, precio, subtotal ni
total: un campo de más → `INVALID_INPUT`. Internas (no expuestas al modelo):
`extractReferences`, `resolverReferencias`, el parser de WhatsApp.

## Guardas deterministas

- **Allowlist doble**: solo se declaran las permitidas y el runtime rechaza cualquier otro nombre (`TOOL_NOT_ALLOWED`).
- **Procedencia**: carrito y fotos solo aceptan referencias que el cliente escribió o que una herramienta devolvió en la conversación (`REFERENCE_NOT_ALLOWED`).
- **Elección obligatoria**: opciones múltiples surgidas en el turno no se pueden agregar en ese mismo turno (`CHOICE_REQUIRED`).
- **Confirmación ligada**: `confirm_order` exige la propuesta vigente, mostrada con su total en un turno anterior (`CONFIRMATION_NOT_PRESENTED`); el motor revalida vencimiento, precio y stock.
- **Canal**: el del número (`canal` de la config) o mayorista SOLO si la conversación trae una solicitud firmada del link mayorista.
- **Anclaje**: los montos del cliente nunca respaldan un precio.
- **Fallos**: mensaje fijo; dos fallos seguidos → asesora (pausa del chat). Seguridad del modelo → mensaje fijo.
- **Asesora**: si tomó el chat mientras el agente pensaba, no se envía nada (ni texto ni fotos); si ya lo tiene, ni se llama al modelo. Tras `handoff_to_human` solo sale la despedida.
- **Selección**: con varias opciones ya mostradas, al carrito solo entra la que el cliente señaló (respondió a su foto, dijo la posición, la referencia o un nombre inequívoco). "Quiero este" sin señal => `CHOICE_REQUIRED` y el agente pregunta.
- **Fotos**: por la URL pública del catálogo publicado, en JPEG, sin ids internos; cada una queda registrada con su wamid para poder citarla.
- **Enlaces**: la respuesta solo puede llevar el enlace que devolvió `get_catalog_link` (el backend lo arma con negocio + canal + publicación). Detal nunca recibe el link mayorista.
- **Duplicados**: un wamid ya atendido (reintento de Meta) no genera otra respuesta; el pedido es idempotente por mensaje.

## Topes de costo y abuso (Bloque 14)

Antes de gastar una llamada al modelo, el runtime lee el consumo (`dulabs_agente_consumo`, sobre
las trazas) y lo compara con `limites` de la config (por defecto 8 turnos/min y 300/día por
cliente, 20M tokens/día por negocio):

| Situación | Qué pasa |
| --- | --- |
| ritmo por minuto del cliente | `rate_limited`: ni modelo ni respuesta a ese mensaje |
| turnos del día del cliente / tokens del día del negocio | asesora (mensaje fijo, sin modelo) |
| consumo no medible | sigue normal (no frena ventas); la traza lo muestra (`limits: null`) |

## Diagnóstico: trazas persistentes (Bloque 13)

Cada turno queda en `dulabs_agente_trazas` (`lib/agente/trazas.ts`), sin datos personales:

| Pregunta | Dónde |
| --- | --- |
| ¿Qué recibió? | `input` (wamids, cantidad, largo; nunca el texto), `reply_to` |
| ¿Con qué contexto decidió? | `context` (canal, carrito, opciones abiertas, propuesta, pedido), `stage` |
| ¿Qué pidió Gemini y qué validó el backend? | `tool_calls` (nombre, resultado/código, ms, argumentos resumidos) |
| ¿Qué respondió? | `outcome`, `grounding`, `retries`, `usage`, `error_kind` |
| ¿Qué se envió? ¿Meta lo aceptó? | `delivery` (wamid y error de envío) + estado real en `dulabs_mensajes_log` |

```sql
select * from dulabs_agente_diagnosticar('<id_tenant>', '<teléfono>', 20);
```

El guardado nunca frena un turno y la frontera lo espera antes de terminar (serverless).

## Retención de datos (Bloque 18)

Cron diario `/api/cron/agente-retencion` (04:45 UTC, `vercel.json`; QStash firmado o
`Bearer CRON_SECRET` — sin secreto, nada pasa): trazas 90 días (`dulabs_agente_trazas_purgar`),
buzón 14 días (incluye `wa_id` y el texto de mensajes no procesados), registro de fotos enviadas
90 días. No toca pedidos, memoria de la conversación ni mensajes del Inbox. Ver `retencion.ts`.

## Atención humana en el Inbox y diagnóstico (Bloque 17)

- **La asesora ve POR QUÉ recibió la conversación** (`atencion-humana.ts`): el Inbox
  (`GET /api/dashboard/conversaciones`) agrega `atencion_humana = {motivo, texto, origen, desde,
  pedido}` con un texto claro de una lista cerrada ("El cliente pidió hablar con una asesora",
  "El cliente tiene un reclamo"…). **Sin tabla nueva**: se deriva de la traza del turno que hizo
  el traspaso. Se muestra si la conversación está pausada o pendiente, no cerrada, y nadie la
  devolvió a la IA después. Nunca: texto libre del modelo, traza, teléfono, hash, ids internos
  (solo el número público del pedido DL-ORD-…). Filtrado por el negocio de la sesión.
- **Tomar** (`/handoff`, "tomar"): también disponible cuando el agente ya pausó el chat; pausa de
  30 días, asignación, evento y la conversación pendiente pasa a abierta (condicional en la BD).
- **La pausa del agente nunca acorta otra** (`extenderPausaChat`): si una asesora tomó el chat
  mientras el agente lo traspasaba, sigue siendo de ella (30 días) y su estado no cambia.
- **Diagnóstico** (migración `20261115000000`): `dulabs_agente_diagnosticar` agrega
  `intencion`, `asesora_motivo`, `asesora_origen` (mismas listas que `INTENCIONES` y
  `MOTIVOS_ASESORA`; una prueba compara el SQL con el código).

## Intención, motivo de la asesora y "quiero hablar con una asesora" (Bloque 16)

- **Pedir una persona lo decide el backend** (`intencion.ts` → `asksForHuman`): "quiero
  hablar con una asesora", "pásame con un asesor", "¿me atiende una persona?", "asesora"…
  pausan el chat y envían el mensaje fijo SIN llamar al modelo (no depende de que Gemini lo
  decida; no gasta tokens). Preguntas sobre la asesora ("¿la asesora me envía fotos?") o
  "no quiero un asesor" no cuentan. Si la pausa falla, el turno sigue normal.
- **Motivo cerrado** en cada traspaso (`trace.handoff = {source, motive}`): el modelo elige
  `motive` en `handoff_to_human` (customer_request, order_issue, payment_or_delivery,
  complaint, out_of_scope, other); el sistema usa customer_request, repeated_failures,
  limit_contact_day, limit_tenant_tokens_day. La razón en texto libre llega a la pausa y al
  pedido, nunca a la traza (puede traer datos del cliente).
- **Intención detectada** (`trace.intent`): derivada de las herramientas que se pidieron
  (lo que el agente HIZO) y del resultado — handoff, confirm_order, order, cart, photos,
  product_detail, similar, more_results, search, catalog_link, conversation; null si el turno
  no llegó al modelo (duplicado, ritmo, asesora atendiendo).

```sql
-- Últimos turnos de una conversación con intención y motivo de asesora (contact_ref = hash).
select created_at, resultado, traza->>'intent' as intencion, traza->'handoff' as asesora
  from dulabs_agente_trazas
 where id_tenant = '<negocio>' and contact_ref = '<contact_ref>' and tipo = 'turn'
 order by created_at desc limit 20;
```

## Etapa de la conversación y confirmación (Bloque 12)

La etapa la **deriva el backend** en cada turno del estado real (`lib/agente/etapa.ts`); no se
guarda ni la escribe el modelo, así que no se desincroniza:

| Etapa | Cuándo |
| --- | --- |
| `inicio` | nada mostrado todavía |
| `explorando` | ya vio productos; nada abierto por elegir |
| `eligiendo` | varias opciones mostradas y no dijo cuál |
| `armando_pedido` | hay productos en la selección |
| `esperando_confirmacion` | ya vio la propuesta (productos + total) del backend |
| `pedido_con_problemas` | el pedido no se puede proponer (precio, stock, producto) |
| `pedido_confirmado` | el pedido quedó en manos del negocio |

El modelo recibe la etapa y qué conviene hacer en ella; lo **permitido** lo imponen las guardas.

- **Confirmar**: además de la propuesta vigente ya mostrada, el mensaje del cliente debe ser un
  **sí explícito** sin condiciones ni cambios (`isExplicitConfirmation`): "sí", "dale", "listo",
  "ok gracias" confirman; "sí pero quita uno", "¿cuánto es el envío?", "espera" no
  (`CONFIRMATION_NOT_EXPLICIT`).
- **Selección ambigua**: "el otro" (dos opciones y una ya elegida => la otra), "quiero 3" (una sola
  opción => esa; varias => aclaración), "el de arriba" / "el anterior" => aclaración.

## Un turno a la vez por conversación (Bloque 11)

```
mensaje -> dulabs_agente_buzon (único por wamid, con la foto citada)
        -> dulabs_agente_tomar_turno --no--> "en cola": lo atiende el turno en curso
                                     |sí
        [pendientes (la ráfaga completa) -> UN turno del agente -> marcar procesados]*
        -> dulabs_agente_soltar_turno: si llegó algo más, sigue (atómico); si no, suelta
```

- Nunca dos turnos del agente en paralelo en la misma conversación (antes: el candado del
  chat esperaba 20 s y un turno podía tardar 45 s; el segundo pisaba el carrito del primero).
- El mensaje que el freno de ráfaga del webhook deja pasar entra al buzón: el turno del más
  nuevo atiende ambos (sus referencias cuentan como escritas por el cliente).
- Turno caído: vence solo; el siguiente mensaje atiende lo pendiente. Pendientes de más de
  15 min (p. ej. mientras una asesora tenía el chat) se cierran sin responder.
- Presupuesto: no se empieza otro turno pasados 45 s (caben en los 120 s de la función).

## Búsqueda con miles de referencias (Bloque 10)

El catálogo nunca viaja al modelo: cada búsqueda devuelve **una página de 5** con el total.

```
search_products(query, filtros) -> dulabs_catalogo_buscar (texto completo en español en la BD:
    sin tildes, plural/singular, prefijos; nombre > color/material/categoría > descripción;
    filtros y precio DEL CANAL en SQL; solo activos del negocio) -> referencias
  -> resolución existente (precio del canal, stock discreto, foto) -> 5 candidatos + total + has_more
  -> cursor en el estado (lastSearch)
more_products()             -> página siguiente de ESA búsqueda (el modelo no puede cambiarla)
similar_products(referencia) -> misma categoría primero, sin el producto base
```

Sin coincidencia con todas las palabras, se relaja a "alguna" y se marca `relaxed`
(los filtros nunca se relajan). Sin la migración, se usa la búsqueda anterior.

## Flujo de fotos y respuesta a una foto

```
"quiero ver aretes" -> search_products (candidatos del backend, en su orden)
                    -> request_product_images (el backend valida: conversación, negocio, activo, foto)
texto -> fotos JPEG  (…/productos/{ref}/whatsapp.jpg, leyenda: nombre · referencia · precio del canal)
      -> cada foto: wamid -> dulabs_agente_medios_enviados (negocio, número, cliente, referencia, producto, canal)
cliente responde a una foto: "quiero este" (context.id = wamid de la foto)
      -> registro (misma conversación) -> producto consultado de nuevo (activo / agotado / ya no disponible)
      -> selección "image_reply" -> update_cart permitido solo para esa referencia
reenviado, foto desconocida o de otro negocio -> sin selección -> el agente pregunta
```

## Activación segura de un número (orden obligatorio)

1. Aplicar `supabase/migrations/20261109000000_dulabs_agente_runtime.sql`.
2. Configurar la variable de entorno del negocio (p. ej. `GEMINI_KEY_DELACOUR`) en Vercel y redesplegar.
3. Insertar la fila en `dulabs_agente_runtime_config` (`proveedor='gemini'`, `modelo='gemini-3.6-flash'`, `credencial_ref='env:GEMINI_KEY_DELACOUR'`, herramientas, `habilitado=true`).
4. `ia_restringida_a` = números de prueba.
5. Solo entonces `ia_pausada=false`.

Con fila (aunque esté apagada o inválida) el número **nunca** cae a Business Agent, Flow ni a la IA legacy (Claude).

### Plantilla de configuración (reemplazar los valores entre <>)

```sql
insert into public.dulabs_agente_runtime_config
  (id_tenant, phone_number_id, tipo, habilitado, proveedor, modelo, credencial_ref, nivel_razonamiento, herramientas, canal, negocio)
values
  ('<id_tenant>', '<phone_number_id>', 'catalog_sales', true, 'gemini', 'gemini-3.6-flash', 'env:GEMINI_KEY_<NEGOCIO>', 'low',
   '{search_products,resolve_product_by_reference,resolve_product_by_attributes,get_product_details,get_cart,update_cart,resolve_order,create_order_request,validate_order,confirm_order,get_customer_context,request_product_images,handoff_to_human,get_catalog_link,more_products,similar_products}',
   'retail', '{"nombre_agente": "<nombre>", "tono": "<tono breve>"}');
```
