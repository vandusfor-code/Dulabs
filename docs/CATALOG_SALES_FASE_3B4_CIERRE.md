# catalog_sales · Fase 3B.4 — Cierre y congelamiento

> **Estado vigente:** este documento describe el cierre de ESA fase; frases como «sin commit», «sin aplicar» o `cierre_aceptacion_humana = false` eran ciertas entonces.
> Qué está aplicado hoy en producción y cómo se activa ASLC: [`CATALOG_SALES_FASE_3B9D.md`](CATALOG_SALES_FASE_3B9D.md).

Checkout con aceptación del negocio (perfil tipo "Aquí Sí Lo Compras"), de punta a punta en memoria.
Estado: **congelada y lista para revisión** (sin push, sin merge, sin activación).

## Qué hace

Productos → nombre completo → teléfono → ciudad → departamento → tipo de entrega
(domicilio: dirección y barrio · oficina de la transportadora, solo si el cliente la pide: oficina y documento)
→ pago contra entrega → resumen → "Datos correctos" → **aviso obligatorio** → `submitForAcceptance`
→ `pending_acceptance` (nunca una venta).

## Lo que NO incluye (fases posteriores)

3B.5 (responsable, asignación, notificación, puerta del webhook tras el aviso, aceptación humana),
3B.6 (envíos), 3B.7 (panel "Por aceptar"), 3B.8 (textos finales), 3B.9 (aprovisionamiento) y la activación.
Mientras tanto, en producción el cierre con aceptación sigue **bloqueado**
(`FUNCIONES_3B_IMPLEMENTADAS.cierre_aceptacion_humana = false`): cualquier configuración de ese tipo es
`invalid: checkout_feature_unavailable`. Solo las pruebas lo encienden.

## Aviso obligatorio

El texto vive en la configuración del negocio (`cierre.textos.aviso`), se valida sin recortarlo ni
normalizarlo y se envía tal cual, como texto (sin botones), sin pasar por el modelo. La versión oficial termina:

> …confirme su compra únicamente si está 100% seguro de **recibir el pedido**. 🙏
>
> ¿Me confirmas por favor que estás 100% seguro de recibirlo?

Control: `lib/agente/agente-checkout-aceptacion.test.ts` (grupo "aviso obligatorio") compara párrafo por
párrafo, byte a byte (747 bytes UTF-8), emojis por punto de código, saltos de línea, espacios y mayúsculas,
y fija el SHA-256 `c0bf58e071859d51d86f2de4f703faa8f95ea866e644386d40eb9d6d1a75179a`.

## `pending_acceptance` no es una venta

Verificado (domicilio y oficina): no se llama a `confirmOrder`; `confirmed_at = null`; sin etapa ni estado
de pago; sin reserva de stock; stock intacto; `hasPurchase = false`; ningún evento con pedido confirmado ni
transición a `confirmed`/`completed`; el historial del pedido no tiene `confirmed`; el motor solo registra
`submit_for_acceptance` (nunca `confirm_order`, `accept_order`, `advance_stage`, `payment_received`).
En la BD lo refuerzan los disparadores y la restricción `dulabs_catalogo_pedidos_aceptacion_no_es_venta`
(migración 20261207000000, probada en pglite local).

## Documento de identidad

- Se **cifra al instante** (AES-256-GCM, formato `v1:`) en el turno en que llega; el estado de la conversación
  solo guarda `{type, cipherText, last4}`.
- Al motor llega **solo lo sellado** (`sealed`), nunca el número; la BD solo recibe el cifrado y los últimos 4.
- Nunca entra a prompts/Gemini (el mensaje se reemplaza por `[documento de identidad]` y los dígitos de una
  pregunta en ese paso se tapan), ni a trazas, registros, consola, eventos ni historial del pedido.
- Se muestra enmascarado (`•••• 1234`). Si el cliente se niega, pasa a una persona y no se sigue.
- Tipo guardado: `no_especificado` mientras la configuración use `tipos: "sin_especificar"` (decisión D4 pendiente).

### Riesgo conocido (NO se modificó el Inbox en esta fase)

El mensaje original del cliente con su documento **puede seguir visible en el historial del Inbox**
(`dulabs_mensajes_log`), como cualquier otro mensaje entrante: el webhook lo registra antes de que el agente
lo procese. El agente y el motor no lo reutilizan, pero el Inbox y el buzón lo siguen mostrando en claro.
Mitigación pendiente (fase aparte): ocultar/enmascarar ese mensaje en el Inbox o no registrar su texto.

## Aislamiento

Un negocio con aceptación no puede usar catálogo, producto, precio, stock, configuración, credencial ni
pedidos de otro negocio (pruebas: referencia que solo existe en B no entra al carrito de A; la referencia
compartida resuelve al producto y precio de A; configuración y credencial de A no sirven para el número de B;
la compra confirmada del mismo cliente en B no cuenta en A; B no ve el pedido pendiente de A). El código de
3B.4 no contiene ningún dato de un negocio concreto. Delacour sigue con su checkout de siempre
(`confirmOrder` una sola vez, venta confirmada) y las evaluaciones de lenguaje son idénticas a 7207d79.

## Deuda técnica separada (NO se arregla aquí): B30

- **Test:** `B30 · botones sin freno de ráfaga` →
  `webhook: 'escribiendo…' antes del freno solo con agente; sin agente, el typing de siempre tras el freno`
  (`lib/agente/agente-rafaga-fotos.test.ts:222`).
- **Qué prueba:** lee el código fuente de `app/webhook-dulabs/route.ts` y comprueba el orden
  (typing → freno de ráfaga → "más reciente") y con una expresión regular que contiene `\n`
  (`/if \(tokenMeta && !agenteListo\) \{\n\s+await marcarLeidoConTyping/`).
- **Por qué es preexistente:** en Windows `core.autocrlf=true` deja ese archivo con `\r\n` y la expresión
  regular (que espera `\n`) no coincide. No es un fallo de comportamiento.
- **Evidencia:** falla igual en una copia limpia de `7207d79` (base); con ese mismo archivo convertido a LF
  en la copia desechable, los 13 tests del archivo pasan. 3B.4 no toca `app/webhook-dulabs/route.ts`
  (diff contra la base: 0 líneas). En Linux/CI (LF) no falla.
- **Arreglo sugerido (otra fase):** que la prueba normalice `\r\n` a `\n` antes de comparar.
