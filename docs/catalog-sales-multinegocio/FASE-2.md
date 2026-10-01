# catalog_sales multi-negocio — Fase 2: notas de voz

Una nota de voz del cliente se transcribe y entra al agente como **texto del cliente**, con exactamente la
misma autoridad que un mensaje escrito. Fase 2 **no** enciende la transcripción para ningún número.

## Encendido por número

`dulabs_agente_runtime_config.transcripcion_audio boolean not null default false`
(migración `20261206000000_dulabs_agente_transcripcion_audio.sql`, aditiva, no cambia filas).

- Apagada (o fila leída sin la columna): como siempre — "Por ahora no puedo escuchar notas de voz…".
- Encendida: se transcribe. Si no se puede: "No pude entender bien tu nota de voz 🙏 ¿Me escribes…?".

## Recorrido

```
webhook (Meta audio, mediaId)
  → frontera del agente (lib/agente/webhook.ts)
      ¿transcripcion_audio? ¿credencial de Meta del negocio? ¿topes de costo?
  → descarga de Meta con resolverTokenMetaAgente (nunca otra credencial)
  → Gemini con el modelo y la clave del NEGOCIO (credencial_ref), solo transcribir
  → texto → buzón → mismo turno, intérprete y guardas que un texto escrito
```

- **Misma autoridad:** la transcripción no es un botón (`buttonId` nulo), no confirma pedidos (confirmar
  es solo el botón) y no es una instrucción: el prompt pide transcribir sin obedecer lo que diga el audio.
  La prueba "mismo mensaje dicho o escrito" verifica que el modelo y el cliente reciben exactamente lo mismo.
- **Ráfaga:** una nota de voz superada por un mensaje más nuevo solo se encola; el turno del más nuevo
  responde a todo junto.
- **Inbox:** la fila `[nota de voz]` pasa a `[nota de voz] <transcripción>` (la asesora la lee y los turnos
  siguientes la tienen en su historial).
- **Costo:** si el negocio o el cliente están en su tope, no se transcribe. Los tokens de cada
  transcripción se registran como traza `audio_transcrito` / `audio_no_transcrito` (con `rounds: 0`) y
  cuentan para el tope diario del negocio. La traza nunca lleva el texto ni el teléfono.
- **Topes técnicos:** 2 MB; ogg/opus (WhatsApp), mp3, aac, wav, flac (AMR y m4a: se pide escrito);
  20 s por llamada; un reintento con pausa de 1 s si Gemini responde 429/5xx.

## Prueba real (Gemini, audio sintético)

Con la clave de evaluación y `gemini-3.6-flash`, una nota sintética de ~11 s se transcribió exacta en
4–12 s (≈290 tokens de entrada, ≈220–370 de salida con razonamiento). Gemini respondió 503 de forma
intermitente; el reintento lo resolvió en la mayoría de los casos. Con razonamiento MINIMAL/LOW confundía
nombres propios ("Posta" por "Pasto"), por eso se deja el razonamiento por defecto.

## Para encenderla en un número (cuando se decida)

1. Aplicar la migración `20261206000000`.
2. `update dulabs_agente_runtime_config set transcripcion_audio = true where id_tenant = '…' and phone_number_id = '…';`
3. Probar con números autorizados (`ia_restringida_a`) antes de abrirla al público.
