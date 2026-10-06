# AMORE — evaluación del chat con Gemini real

Archivo de la prueba: `lib/amore-conversacion-gemini-real.e2e.ts` · comando: `npm run test:amore-gemini` · negocio: AMORE (`ed6ae77f-8a0c-483e-a5d9-8ede68eca50f`).

## 1. Para qué existe

`lib/amore-conversacion-matriz.test.ts` prueba todo el chat de AMORE pero con un **clasificador de mentira**: por eso nunca podía medir lo que de verdad hace el modelo (cómo
clasifica una frase rara, cómo redacta, si inventa, si le contesta el proveedor). Esta prueba corre **el mismo pipeline de producción** (`lib/whatsapp-qr-pipeline.ts`: atención
humana → registro → compra → Agenda V2 → entrada AMORE) con **Gemini real**, y simula solo lo que vive fuera del código:

| Pieza | En esta prueba |
|---|---|
| Código del bot (router, Agenda V2, gestión de citas, enlaces, textos) | **el real** |
| IA | **Gemini real** (la clave de evaluación) |
| Base de datos | en memoria, con las reglas de Postgres que importan (solape de citas 23P01, únicos 23505) |
| Google Calendar (Nylas) | simulado a nivel HTTP |
| WhatsApp | se captura; **nunca se envía nada** |

Seguridad: solo se carga la clave de Gemini (`GEMINI_EVAL_KEY`, y si no existe `GEMINI_KEY`, del entorno o de `.env.local`); **no** se cargan las credenciales de Supabase, Meta ni
Nylas, y cualquier salida a la red que no sea Gemini (o Nylas simulado) hace fallar la prueba. No toca producción. Cuesta unos pocos centavos de cuota y tarda 3–10 min según el
estado del proveedor.

```bash
npm run test:amore-gemini
# con informe completo de conversaciones (transcripciones, observaciones y tabla de llamadas a Google):
AMORE_GEMINI_INFORME=informe.md npm run test:amore-gemini
```

No está en el manifiesto de `test:flow` a propósito (llama a una API de pago y depende de un tercero).

## 2. Qué cubre (75 conversaciones)

| Bloque | Casos | Qué se exige |
|---|---|---|
| 0 · La IA responde | 1 | clave válida, salida bien formada |
| 1 · Bienvenida y menú | 6 | menú 1/2/3 sin gastar IA; «1» entrega el enlace; «3» avisa a Jessica y el bot calla; opción inválida no entra en bucle |
| 2 · Citas nuevas | 17 | **12 formas de pedir cita** (incl. «agéndame porfa», «una sita pa mañana», en inglés, «para mi mamá y para mí») + clienta nueva + sesión vieja abierta → **siempre el enlace**; ni sesión, ni cita, ni consulta al calendario |
| 3 · Consultas | 13 | precios/duración/quién hace qué/horarios **del catálogo real**; un servicio que no existe no se inventa; dirección, medios de pago, promociones y descuentos **no se inventan**; límite médico («¿me cura los hongos?»); aceptar «comunícame con alguien» avisa de verdad a Jessica |
| 4 · Gestión de citas por chat | 13 | cancelar (solo tras confirmar y borrando el evento de Google), arrepentirse, cambiar de punta a punta (misma profesional), frases naturales («me salió una vuelta»), cita ajena intocable, dos citas → pregunta cuál, enlace personal en cada mensaje |
| 5 · Atención humana | 10 | 3 frases fijas + 4 frases naturales que la IA debe entender + pedirla en medio de una reprogramación (frase fija y frase natural) + queja fuerte |
| 6 · Seguridad | 10 | pedir el prompt, cambiar de rol, datos de otras clientas, JSON inyectado, «soy el administrador», fuera de tema, insultos, mensajes raros/larguísimos, mismo mensaje reenviado, inglés |
| 7 · Fallos técnicos | 3 | clave rechazada por Google → mensaje honesto y al 2.º seguido pasa a una persona; Google Calendar caído |
| 8 · Recorridos completos | 2 | clienta nueva de punta a punta; clienta con cita (consulta → precio → cambio completo → despedida) |

Las verificaciones **duras** fallan la prueba; las **observaciones** (estilo: largo, emojis, saludo repetido, afirmar que «no hay descuentos») solo quedan en el informe.

## 3. Lo que encontró (y quedó corregido)

Primera corrida con el código que estaba en producción: en las primeras 29 conversaciones hubo **32 respuestas 503 de Google y 20 salidas inválidas de la IA** (cada una era un «tuve un problema técnico» para la clienta), y cuando la IA sí respondía tardaba 12–14 s.

| # | Hallazgo (causa raíz) | Medición | Corrección |
|---|---|---|---|
| 1 | **El JSON de la IA salía cortado.** El tope era 500 tokens y `gemini-3.x` gasta tokens «pensando» del mismo presupuesto (`finishReason=MAX_TOKENS`: 478 de 500 se iban en pensar, quedaban 6 para la respuesta) → «salida fuera del schema» → la clienta recibía «tuve un problema entendiendo tu mensaje». | 20 salidas inválidas en 29 conversaciones; con el arreglo, **0 de 149 llamadas** | tope 2048 (mismo valor que ya validó Du, `lib/lead-solicitud-ia.ts`) |
| 2 | **Lentitud innecesaria.** Clasificar una intención y redactar dos líneas no necesita razonar. | 12–14 s por mensaje | `thinkingLevel: "minimal"` → **1,2–1,8 s**, misma clasificación |
| 3 | **Un 503 de Google era un error para la clienta** (y dos seguidos la pasaban a una persona). El modelo principal (`gemini-3.6-flash`, «preview») respondió 503 «high demand» en 6 de 8 llamadas; en la misma hora el de respaldo también falló o tardó 10–25 s. | 32 × 503 en las primeras 29 conversaciones | plan de **4 intentos con modelos distintos** (principal → `gemini-2.5-flash` → `gemini-3.1-flash-lite` → principal), tiempo máximo por intento y **refuerzo en paralelo** (a los 5 s sin respuesta se lanza el siguiente; gana la primera salida válida y el resto se cancela). Una clave inválida (401/403) no se reintenta. |
| 4 | **Promesa sin acción.** Ante «necesito hablar con un asesor humano» la IA contestaba «una persona se pondrá en contacto contigo»… y **no se avisaba a nadie**. Lo mismo si la IA ofrecía «¿te comunico con alguien?» y la clienta decía «sí». | caso 5.3 | nueva salida `ATENCION_HUMANA` (usa el **mismo** mecanismo de la opción «3»: avisa a Jessica y pausa el bot); el prompt prohíbe prometer contacto; 12 frases nuevas en el detector fijo |
| 5 | **Afirmaba lo que no sabe** («no contamos con descuentos»). | caso 3.12 | el prompt exige «no lo tengo registrado» y ofrecer a una persona |
| 6 | Saludaba «¡Hola!» en cada respuesta (el saludo ya lo da la bienvenida). | observación | regla en el prompt (quedan 3 casos sueltos de ~100 respuestas) |

Observabilidad: ahora el log dice **por qué** falló cada intento (`gemini_server_error`, `gemini_timeout`, `finishReason=MAX_TOKENS`…) en vez de un genérico «fuera del schema».

## 4. Estado final medido

Última corrida completa (2026-10-06, con el proveedor aún inestable: 9 respuestas 503 de Google y varias llamadas lentas canceladas por el refuerzo o el tiempo máximo):
**75 de 75 conversaciones correctas**, ninguna tuvo que repetirse, **0 respuestas cortadas**, `gemini-3.6-flash` con **0 tokens de pensamiento** y mediana de **1,3 s**
(la corrida anterior, con el proveedor peor, tuvo que repetir 2 conversaciones porque Google no respondió en NINGÚN intento; en producción esa clienta habría recibido el mensaje
de error y, a la segunda seguida, pasaría a una persona). Regresión del repositorio: `npm run test:flow` 6930/6930 y `tsc` limpio.

## 5. Qué NO cubre

- El portal `/reservar/amore`, el enlace «Mi cita» y los recordatorios (los cubren `lib/mi-cita/*.test.ts` y `lib/amore-recordatorio-citas.test.ts`).
- Audios, fotos y stickers (los transcribe/descarta el worker antes de llegar aquí).
- La entrega real por WhatsApp (QR), Google Calendar real y el panel de la profesional: siguen requiriendo la prueba controlada con un número real.
- La calidad «de estilo» en profundidad: las respuestas se leen en el informe (`AMORE_GEMINI_INFORME`), no se puntúan.
- Pedir una persona con palabras NO previstas **en medio de una reprogramación abierta** (p. ej. «¿me puede atender alguien?» con la sesión esperando un número): Agenda V2 no
  puede avisar a Jessica por sí sola (ciclo de imports), así que ahí solo actúan las frases fijas del detector; con otras palabras la IA lo entiende y la clienta recibe
  «escribe *hablar con una persona* y le aviso de inmediato» (`respuestaDeConsultaEnReserva`, caso 5.10) en vez de «No reconocí esa opción». Fuera de una sesión abierta,
  la IA avisa directamente (casos 5.5–5.8).

## 6. Mantenimiento

- `gemini-3.6-flash`, `gemini-2.5-flash` y `gemini-3.1-flash-lite` son nombres de modelos de Google que pueden retirarse: si uno desaparece su intento falla rápido (404) y el plan sigue
  con el siguiente, pero conviene revisarlos cada trimestre (`PLAN_DE_INTENTOS` en `lib/amore-entrada-gemini.ts`). Correr esta prueba lo detecta (tabla «Llamadas reales a Google»).
- Cualquier cambio al prompt de `lib/amore-entrada-gemini.ts` debe repetirse con esta prueba: los tests unitarios con IA simulada no ven cómo reacciona el modelo.
