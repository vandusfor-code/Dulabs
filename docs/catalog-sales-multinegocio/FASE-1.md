# catalog_sales multi-negocio — Fase 1

Objetivo: que el motor `catalog_sales` (agente conversacional + checkout del sistema) sirva a más de un
negocio sin cambiar el comportamiento de Delacour. Fase 1 **no** habilita a ningún negocio nuevo.

## Perfil por número (`dulabs_agente_runtime_config`)

| Columna | Tipo | `null` | Validación |
|---|---|---|---|
| `vocabulario` | jsonb | vocabulario **neutral** ("producto", sin ejemplos) | `vocabularioSchema` (estricto) |
| `checkout_opciones` | jsonb | sin configurar: con `checkout_conversacional = true` la config es **inválida** (el agente no responde) | `checkoutOpcionesSchema` (estricto) + CHECK en BD |
| `meta_token_plataforma` | boolean, `false` | — | sin token propio, solo con `true` se usa `META_ACCESS_TOKEN` |

Si la fila se lee **sin** estas columnas (migración pendiente) el número conserva el comportamiento
anterior (`PERFIL_LEGADO`, token de plataforma permitido) y queda un `console.warn` `legacy_profile`.

### `vocabulario`

```json
{
  "producto": "producto",
  "boton_buscar": "🔎 Buscar producto",
  "ejemplos": [],
  "pistas_busqueda": "tipo de producto, características, presupuesto",
  "palabras_producto": [],
  "no_es_nombre": [],
  "nombre_comercial": []
}
```

- `boton_buscar` ≤ 20 caracteres (límite de Meta). Su título también se reconoce escrito (el buzón guarda el texto).
- `ejemplos`: solo ejemplos REALES del catálogo del negocio. El texto corto usa los dos primeros.
- Palabras normalizadas (minúsculas, sin tildes). `no_es_nombre` y `nombre_comercial`: una palabra cada una.
- `palabras_producto_direccion` (opcional): lista corta para el paso de la dirección; sin ella se usan `palabras_producto`.

### `checkout_opciones`

```json
{
  "entregas": ["domicilio"],
  "pagos": [{ "metodo": "contra_entrega" }, { "metodo": "transferencia", "solo_con": ["domicilio"] }],
  "mensajes": { "pago_no_disponible": "…" }
}
```

- Catálogo **cerrado** de la plataforma: entregas `tienda | domicilio`; pagos `pago_en_tienda | transferencia | contra_entrega | link_pago`.
- El orden del arreglo es el orden de los botones. `contra_entrega` siempre es solo con domicilio.
- Una sola opción ⇒ no se pregunta (se llena sola y sale en el resumen). Más de 3 ⇒ lista de WhatsApp.
- Antes de confirmar, el backend vuelve a verificar que entrega y pago estén entre los ofrecidos.
- `mensajes` (opcionales): `duda`, `pago_no_disponible`, `recordatorio_entrega`, `recordatorio_pago`. Sin ellos se arman con los nombres de los métodos ofrecidos.

## Delacour

La migración `20261205000000_dulabs_agente_perfil_negocio.sql` escribe en su fila (tenant `0d3ae22d…`,
número `1428584886997210`) su perfil de hoy, explícito: vocabulario de joyería, tienda o domicilio,
pago en tienda o transferencia (sin contra entrega) y sus textos. Si hoy no tiene token de Meta propio,
también `meta_token_plataforma = true` (lo que usa hoy). La prueba de paridad
(`lib/agente/agente-perfil-negocio.test.ts`) verifica que ese JSON sea idéntico a `PERFIL_LEGADO` y que la
misma conversación produzca la misma transcripción con el perfil explícito y sin las columnas.

**Orden de despliegue:** indiferente (ver encabezado de la migración). Los avisos `NOTICE` de la migración
listan cualquier otra fila que cambie de comportamiento.

## Credenciales de Meta (números con agente)

`resolverTokenMetaAgente(cliente, permitePlataforma)`: el token del negocio; el de la plataforma solo con
`meta_token_plataforma = true`; si no hay ninguno, la frontera responde `invalid_config /
meta_credential_missing` sin llamar al modelo ni enviar nada. Aplica al agente (texto, fotos, botones,
listas, lectura de fotos del cliente), al "escribiendo…" del webhook y a las notificaciones de pedidos de
números con agente. El resto de la plataforma (`resolverTokenMeta`) no cambia.

## Audio (diseño, no implementado)

Hoy una nota de voz recibe un texto fijo (`entrada.ts`, política `ask_text`). Diseño para cuando se habilite:

1. **Webhook** (`app/webhook-dulabs/route.ts`): pasar `mediaId` también para `audio` (hoy solo imagen).
2. **Frontera** (`lib/agente/webhook.ts`, `atender`): si el número lo habilita (columna futura, apagada por
   defecto) y `nonText.kind === "audio"`:
   - descargar el audio de Meta con `resolverTokenMetaAgente` (nunca otra credencial);
   - transcribir con el proveedor y la credencial **del negocio** (`credencial_ref`), con tope de duración y
     de costo (`limites`); sin transcripción ⇒ el texto fijo de hoy;
   - la transcripción entra al **buzón como texto del cliente** (misma ráfaga, mismo turno, mismo pipeline).
3. **Autoridad:** la transcripción vale exactamente lo mismo que un texto escrito: pasa por el mismo
   intérprete determinista y las mismas guardas; nunca confirma un pedido (confirmar es solo el botón) y nunca
   es un botón.
4. **Inbox y trazas:** `[nota de voz] <transcripción>` en el historial; la traza marca el origen `audio`.

## Pendiente para Fase 2 (Aquí Sí Lo Compras)

- Fila de agente de ASLC con SU vocabulario y SUS opciones de checkout (datos que confirme el negocio).
- `negocio.saludo` propio (sin él se usa `DEFAULT_WELCOME`, que tiene 💍).
- Token de Meta propio de ASLC (sin autorización de la plataforma).
- Catálogo, publicación y credencial de IA (`env:GEMINI_KEY_…`) del negocio.
- Pruebas con números autorizados antes de quitar `ia_pausada`.
