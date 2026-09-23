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
`request_product_images`, `handoff_to_human`.

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
- **Asesora**: si tomó el chat mientras el agente pensaba, no se envía nada.

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
   '{search_products,resolve_product_by_reference,resolve_product_by_attributes,get_product_details,get_cart,update_cart,resolve_order,create_order_request,validate_order,confirm_order,get_customer_context,request_product_images,handoff_to_human}',
   'retail', '{"nombre_agente": "<nombre>", "tono": "<tono breve>"}');
```
