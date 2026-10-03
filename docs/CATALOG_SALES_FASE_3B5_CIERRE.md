# catalog_sales · Fase 3B.5 — Aceptación humana: cierre técnico

Estado: **cerrada técnicamente** (sin commit, sin push, sin activar). Sin migraciones ni SQL.

## Flujo y orden (no se invierte)

1. el checkout (3B.4) deja el pedido en `pending_acceptance` — antes de guardar, el motor verifica que la persona
   responsable sea un miembro **activo del mismo negocio** (si no: no se guarda nada y no se envía el aviso);
2. se envía el **aviso obligatorio** (texto de 3B.4, intacto);
3. el aviso queda **registrado** (`recordAcceptanceNotice`);
4. **entonces** (nunca antes, y sin esperar el "sí"): se asigna la conversación a la responsable, se le avisa (canal
   del panel) y
5. la **IA queda en silencio** (pausa que nunca acorta una pausa humana);
6. el cliente puede responder "sí": se registra (una vez) y, solo si ninguna persona escribió, recibe UNA respuesta fija;
7. la responsable acepta (`acceptOrder`) o rechaza/cancela desde "Por aceptar". Solo un humano llega a `confirmed`.

## Qué pasa si falla cada cosa (código real)

| Falla | Resultado |
|---|---|
| Validación de la responsable, **antes de guardar** | `UNAVAILABLE`: nada se guarda ni se avisa; el cliente ve el mensaje de "no disponible"; el pedido sigue `pending_confirmation`. Nunca se confirma. |
| Validación de la responsable, **al asignar** (se desactivó entre guardar y registrar el aviso, o la lectura falla) | No se asigna a nadie, **la IA igual calla** y queda constancia; el pedido sigue visible en "Por aceptar". |
| Asignación | Pasos independientes: se avisa y se pausa igual; el reintento (registrar el aviso de nuevo) la repara. UNIQUE (número, cliente) + un solo evento. |
| Aviso a la persona | Cada canal es independiente; correo/WhatsApp sin adaptador = `no_configurado` (no se inventan destinos). |
| "¿Una persona ya escribió?" | Dos fuentes (historial Inbox/celular + bitácora). Sin certeza (error de lectura, fecha inválida) ⇒ se asume que sí ⇒ **no se responde**. |
| Registro del "sí" | **Silencio** (`handled`): nunca otro agente, flujo ni modelo. |
| Envío de la respuesta | Queda registrada, no se reintenta (nunca dos respuestas). |
| Error ANTES de saber que hay pedido pendiente (configuración/búsqueda) | El mensaje sigue su camino; la **barrera del agente** decide con su propia lectura (abajo). |

**Barrera del agente** (`pendingAcceptance`, `lib/agente/webhook.ts`): en un número con aceptación humana, mientras exista un
pedido pendiente **con aviso**, el agente no atiende (haya o no pausa vigente). Si la barrera no existe o no se puede leer:
no se atiende (fail-closed). Delacour nunca la consulta. El agente además queda sin `confirm_order` porque la configuración
con aceptación **exige** `checkout_conversacional` (antes se admitía sin él y el modelo conservaba esa herramienta: corregido,
`checkout_required_for_acceptance`).

## Por qué la IA no puede confirmar, reservar ni vender

- BD: `pending_acceptance → confirmed|cancelled|rejected` solo con actor `human` (prueba SQL 5a); el sistema solo puede vencer.
- Motor: `acceptOrder` solo se llama desde el panel (persona autenticada del negocio con permiso); el checkout con aceptación
  nunca llama a `confirmOrder`; el modelo no tiene `confirm_order`.
- El "sí" del cliente solo escribe `respuesta_cliente_at`: sin estado, sin reserva, sin stock, sin venta.

## Idempotencia y concurrencia (qué garantiza cada capa)

- Registrar aviso / respuesta: `dulabs_catalogo_pedido_aceptacion_marca` hace `SELECT … FOR UPDATE` y el evento va con
  `ON CONFLICT (event_id) DO NOTHING`; el motor solo responde si **esta** llamada fue la que registró.
- Aceptar / rechazar / cancelar: `dulabs_catalogo_pedido_transicion` es un `UPDATE … WHERE estado = <visto>` (compare-and-set)
  en una transacción con el trigger de reserva y el evento: un perdedor recibe conflicto; nunca dos confirmaciones ni dos reservas.
- Asignación: UNIQUE (número, cliente) + 23505; solo el ganador escribe el evento.
- Webhook duplicado: `UPDATE … WHERE procesado_at IS NULL` antes de la puerta.
- Pausa: `extenderPausaChat` (sentencias atómicas, nunca acorta).

## Multi-negocio

El negocio sale **siempre de la sesión**; un pedido de otro negocio es "no encontrado" (no se ve, no se acepta, no se rechaza,
su documento no se lee). Una persona de otro negocio nunca es responsable ni se le asigna. Documento solo enmascarado.

## Pendiente (no es de 3B.5)

- **3B.6**: cobertura de envíos, tiempos y festivos, `consultar_envio`, handoff determinista por pregunta sin respuesta.
- **3B.8**: textos finales (mensaje al cliente al aceptar/rechazar, unavailable, etc.).
- **3B.9**: crear a la responsable real y su `miembro_id`, cargar la configuración (aviso, respuesta al "sí", reserva, `aceptan`),
  enlazar "Por aceptar" en el menú, decidir si se enciende `cierre_aceptacion_humana`, catálogo y activación.
- Sin barrido: si el aviso no logra enviarse/registrarse, el pedido queda en "Por aceptar" sin asignar (visible, la IA calla por
  el traspaso del checkout).
