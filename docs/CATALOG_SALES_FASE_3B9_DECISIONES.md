# Aquí Sí Lo Compras — hoja de decisiones para poner el agente en operación (3B.9)

Fecha: 2026-10-03. Estado: **nada de esto está cargado en producción**. Cada fila dice qué falta, quién lo decide y qué recomienda DuLabs. Donde hay recomendación,
responder "OK" la acepta; cualquier otra respuesta la reemplaza. Los textos son **PROPUESTAS**: nada sale a un cliente sin que el dueño los apruebe.

## 1. Ya definido por el cliente (no hay que volver a preguntar)

| Tema | Definido |
|---|---|
| Pago | ÚNICAMENTE contra entrega. Sin anticipos, Nequi, Daviplata, transferencia ni cuenta bancaria. |
| Envío | Gratis. Inter Rapidísimo es la transportadora más frecuente. Otras ciudades: normalmente 2 a 3 días hábiles. Bogotá, pedidos **antes de las 11:30 a. m.**: PUEDEN tener entrega el mismo día (nunca "garantizado"). Sin información verificable de una ciudad: una persona. |
| Datos del pedido | Nombre completo, teléfono, ciudad, departamento, dirección completa, barrio, color/referencia cuando aplique. Para retiro en oficina de Inter Rapidísimo: número de documento (si se niega: una persona). |
| Flujo | Producto → datos → resumen → "datos correctos" → pedido pendiente de aceptación → **aviso obligatorio** (texto oficial, 747 bytes, byte a byte idéntico al guardado) → asignación a la responsable → IA pausada → decide una persona (acepta / rechaza / cancela). La IA nunca confirma; un "sí" del cliente solo se registra. |
| Si la responsable ya escribió | La IA NO responde (caso 15). |
| Audio | La nota de voz tiene la misma autoridad que un mensaje escrito; si no se puede transcribir, se pide por escrito. |

## 2. Bloqueantes (sin esto NO se activa)

| # | Qué falta | Quién | Detalle |
|---|---|---|---|
| B1 | **Autorizar el aprovisionamiento (script 02)** | Dueño de DuLabs | Crea la fila del agente DESHABILITADA y habilita 3 módulos. Probado en base local. No cambia la pausa ni la restricción de la IA. |
| B2 | **Cuál es la línea de WhatsApp del agente** | Cliente | En la base, el número conectado a Meta termina en **…8509**; el negocio informó uno que termina en **…5088**, que en el Inbox solo aparece como un interlocutor (cliente). ¿Cuál atiende el agente? Debe ser el que esté conectado por Coexistence. |
| B3 | **Clave de Gemini propia: `GEMINI_KEY_ASLC`** | Dueño de DuLabs | No existe en Vercel (solo Delacour y las de la plataforma). Crear una clave en Google AI Studio y cargarla en Vercel → Production con ese nombre exacto. Sin ella el agente calla. |
| B4 | **La persona responsable (Patricia)** | Cliente | Crear su usuario en Dashboard → Equipo (hoy el único miembro es el administrador). Datos: nombre real, rol y, si la hay, una persona de respaldo. El sistema valida que sea del mismo negocio y esté activa. |
| B5 | **Correo del negocio** | Cliente | Hay dos versiones del correo en circulación (se confirman por el chat; no se publican en el repositorio). Ningún código lo usa todavía. |

## 3. Decisiones con recomendación

| Cód. | Decisión | Recomendación DuLabs | Por qué |
|---|---|---|---|
| D1 | ¿El cliente valida el resumen con un botón antes del aviso? | **Sí** (botón "datos correctos") | Es tu flujo. |
| D3 | Teléfono de contacto: ¿vale "este mismo WhatsApp"? | **Sí** | Menos fricción; la transportadora llama a ese número. |
| D2 | Retiro en oficina Inter: ¿botón o solo si el cliente lo pide? ¿se pide dirección y barrio? ¿oficina por texto o lista? | **Solo si el cliente lo pide**; **sin** dirección ni barrio; **texto libre** | El flujo base es domicilio; no hay lista oficial de oficinas. |
| D4 | Documento de oficina: ¿tipos? ¿cuánto se conserva cifrado? | **Número sin tipo**; **borrar a los 30 días** | Minimiza datos personales (Habeas Data). |
| D14 | ¿Mostrar al cliente el número de pedido? | **Sí** | La responsable y el cliente hablan del mismo pedido. |
| D7 | ¿Quién puede aceptar en el panel? | **Responsable y administradores** | Equipo pequeño: evita pedidos trabados si ella no está. |
| D5 | Stock reservado mientras espera aceptación | **12 horas** | Evita vender dos veces la misma unidad sin retenerla indefinidamente. |
| D6 | Si nadie lo acepta ni lo cierra | **Vence a las 24 horas** | No dejar pedidos eternos. |
| D18 | Plazo de la reserva al aceptar | **El de la plataforma** | Ya probado. |
| D12 | Pregunta sin respuesta verificable durante el checkout | **Pasar a una persona** | Es tu regla ("no inventar"). |
| D17 | Motivos que pasan a una persona sin depender del modelo (queja, garantía, devolución, cambio…) | **No se puede cargar hoy**: el bloque `handoff` no está implementado en el runtime (cargarlo deja la configuración inválida y el agente calla). Ya pasan a una persona de forma determinista: el cliente que la pide (tu caso 12), las dudas de envío y las fallas repetidas; lo demás depende del modelo y de sus políticas. | Decidir después del QA con Gemini real si hace falta implementarlo (desarrollo adicional). |
| D9 | Cobertura | **Todo el país, sin exclusiones**; ciudad que el sistema no reconoce → una persona | Sirve tu regla; el sistema reconoce unas 100 ciudades (capitales y áreas metropolitanas). Si hay ciudades que NO cubren, dame la lista. |
| D10 | Regla de las 11:30 en Bogotá: ¿qué días cuentan? ¿festivos? | **Lunes a viernes**; **ignorar festivos** y decir "puede" | El sistema no tiene un calendario confiable de festivos. |
| — | ¿Qué se le dice a un cliente de Bogotá que pide **después de las 11:30** (o fin de semana)? | **Falta el dato del cliente** | No se inventa un plazo. |
| — | Aviso a la responsable | **Hoy solo en el panel** (conversación asignada + lista "Por aceptar"). Correo y WhatsApp NO están implementados. | Decidir si el panel basta o se implementa correo/WhatsApp (desarrollo adicional). |
| — | Regla de confianza ("¿es una estafa?") | Se carga como **política para el modelo** (`negocio.politicas`, ver §4); se prueba con Gemini real en el QA | El texto fijo `textos.confianza` NO se puede usar hoy (bloque `textos` sin implementar: invalida la configuración). Una política no tiene guardián determinista. |

## 4. Textos al cliente — PROPUESTAS (sin aprobar; ninguna está cargada)

Reglas del sistema: se envían tal cual; `{pedido}` y, solo en rechazo y cancelación, `{motivo}`; sin espacios al inicio ni al final.

| Texto | Propuesta |
|---|---|
| Saludo | ¡Hola! 👋 Bienvenido a Aquí Sí Lo Compras. ¿En qué te puedo ayudar hoy? |
| Respuesta al "sí" tras el aviso | ¡Gracias por confirmar! 🙌 Una persona de nuestro equipo continuará con tu pedido y te escribirá por este mismo chat. |
| Pedido aceptado | Tu pedido {pedido} fue aceptado ✅ Gracias por tu compra. |
| Pedido rechazado | No pudimos aceptar tu pedido {pedido}. Motivo: {motivo} |
| Pedido cancelado | Tu pedido {pedido} fue cancelado. Motivo: {motivo} |
| Pasar a una persona | **No se puede personalizar hoy** (necesita el bloque `handoff`). Rige el mensaje de siempre: «Te comunico con una asesora para ayudarte mejor. En breve te escribe.» |
| Envío a Bogotá, antes de las 11:30 | Envío gratis. Tu pedido, hecho antes de las 11:30 a. m., puede tener entrega el mismo día (no está garantizado). |
| Envío al resto del país | Envío gratis. Normalmente de 2 a 3 días hábiles, según la ciudad y la transportadora. |
| Ciudad sin cobertura (solo si se excluye una) | Por ahora no tenemos envíos a esa ciudad. |
| Cobertura no verificable | Déjame confirmar con una persona del equipo si llegamos a esa ciudad y en cuánto tiempo; te escribe por este chat. |
| Error al consultar el envío | No pude consultar el envío en este momento. Una persona del equipo te ayudará por este chat. |
| Desconfianza ("¿es una estafa?") — como **2 políticas para el modelo** (≤300 caracteres cada una; no es un texto fijo) | (1) Si el cliente duda o pregunta si es una estafa: responde con calma y de forma comercial, sin ponerte a la defensiva; explica que es un comercio serio y que el pago es contraentrega (paga al recibir, sin anticipos). (2) Puedes ofrecer dejar una nota para solicitar que revise su pedido antes de pagar, aclarando que esa decisión es de la transportadora. NUNCA prometas que podrá abrir el paquete antes de pagar. |

Las dos políticas aplican tu regla: comercio serio, pago contraentrega, "solicitar" una nota y **sin prometer** que la transportadora deje abrir el paquete. Como son una guía para el modelo y no un texto fijo, se verifican con Gemini real en el QA.

**Validado contra el esquema real (2026-10-03):** con todas las recomendaciones de este documento y SIN los bloques `handoff` y `textos`, la configuración completa es válida (≈3,8 KB, el límite de la BD es 32 KB) y la única compuerta que queda cerrada es `cierre_aceptacion_humana`, que se abre en la activación.

Sobre `{motivo}` (rechazo y cancelación): el panel **obliga** a la persona a escribir un motivo (3 a 300 caracteres) y le avisa que el cliente lo va a leer. Si el motivo trae
7 o más dígitos seguidos (parece un documento o teléfono), NO se envía nada al cliente y el panel le pide escribirle desde el Inbox. Si un texto no está configurado, tampoco se envía nada.

## 5. Catálogo (~12 productos)

El módulo es el mismo que usa Delacour, sin desarrollo nuevo. Dashboard → Catálogo → **Carga masiva** (descarga la plantilla, se llena y se sube; nada se crea hasta confirmar):

| Columna | Obligatoria | Nota |
|---|---|---|
| `nombre` | sí | Incluir aquí la referencia propia del cliente si la tiene (ej. "Audífonos X – ref AUD-01"): el sistema asigna SU propia referencia y no guarda un código del cliente. |
| `precio_detal` | sí | Pesos enteros. |
| `stock` | sí | 0 = agotado. |
| `descripcion`, `color`, `material`, `categoria` | no | La descripción es lo que el agente usa para responder características. |
| `imagenes` | no | **Se puede cargar sin fotos** ("sin foto") y agregarlas después (hasta 12 por producto). |

Requisito para que el agente **envíe fotos**: las fotos y el enlace del catálogo salen de la **publicación** del catálogo; hay que publicarlo una vez. Cada color o variante es un producto aparte.
Después, el cliente agrega, quita y actualiza precio, descripción, stock y fotos desde el mismo panel, sin desarrollo ni costo técnico.
