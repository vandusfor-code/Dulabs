# DuLabs Developer V1 — Fase 12: Billing & Subscriptions (Wompi) — DISEÑO DEFINITIVO

> **STATUS: DISEÑO CERRADO, LISTO PARA IMPLEMENTAR (12.3).** Sin código, sin migraciones, sin deploy, sin merge. Proveedor: **Wompi** (reutilizando patrones probados de Business, con **namespace, tablas, rutas y webhook propios de Developer**; Business intacto). Marcado: **[EXISTE]** ya en repo · **[REUTILIZAR]** patrón de Business · **[NUEVO]** de Developer · **[BLOQUEO]** limitación técnica real de Wompi.

---

## 1. Decisiones comerciales (cerradas)

- **Proveedor:** Wompi únicamente. Nada de Stripe/Paddle/Lemon Squeezy en esta fase.
- **Meta:** DuLabs = Tech Provider. Meta cobra al dueño de la WABA. **DuLabs NO paga los mensajes.** Las cuotas de mensajes de Fase 11 son **límites comerciales/operativos**, no una bolsa que DuLabs pague a Meta. No se descuentan de ingresos.
- **Moneda:** precio canónico comercial **USD**; cobro real vía Wompi en **COP** (conversión server-side; ver §7 FX).
- **Planes:** DEVELOPER $19/mes · AGENCY $45/mes · ENTERPRISE $199/mes (referencia, manual).
- **Anual = 10 meses pagados por 12 de servicio** ("2 meses gratis"): DEVELOPER $190/año, AGENCY $450/año, ENTERPRISE manual.
- **Enterprise:** manual, sin checkout; CTA "Contactar ventas" → correo comercial configurable; límites por overrides de Fase 11.
- **Sin trial, sin cupones** en V1 (arquitectura no los impide a futuro).
- **Upgrade** inmediato pero coordinado con el pago (sin límites nuevos antes de confirmar). **Downgrade** opción A (bloqueado si hay recursos por encima; aplica al siguiente período; no destruye recursos). **Cancelación** `cancelar_al_fin_periodo=true` por defecto.

## 2. Bloqueos técnicos reales de Wompi (no ocultados) + solución V1

1. **[BLOQUEO] Wompi cobra en COP** (`lib/wompi.ts::crearTransaccion` hardcodea `currency:"COP"`). **Solución V1:** USD como precio canónico; el backend convierte USD→COP con **tasa FX server-side** y crea la transacción Wompi en COP. Se persiste `precio_usd_cents`, `monto_cop_cents` y `fx_rate` por transacción (auditable). El frontend nunca envía monto/precio/moneda.
2. **[BLOQUEO] Wompi no tiene objeto "subscription" ni prorrateo ni anual nativos** (recurrencia = fuente tokenizada + cobro programado, como ya hace Business). **Solución V1:** recurrencia propia (tabla `dulabs_dev_billing_subscriptions` + cron `cobro-recurrente` + dunning). Anual = **una** transacción por el precio anual (×10), `intervalo=year`, período 12 meses, próximo cobro +1 año. **Sin prorrateo**: upgrade cobra el nuevo plan y aplica al confirmar; downgrade aplica al siguiente período.
3. **[BLOQUEO] Un comercio Wompi = una sola URL de webhook.** Business ya usa `app/api/wompi/webhook`. Para aislar Developer **se usa un comercio/config Wompi separado** con llaves propias (`DEVELOPER_WOMPI_PRIVATE_KEY`, `_INTEGRITY_KEY`, `_EVENTS_KEY`, `NEXT_PUBLIC_DEVELOPER_WOMPI_PUBLIC_KEY`) y su webhook propio `POST /api/developer/billing/webhook`. → **acción de configuración manual en Wompi + Vercel (no de código).**
4. **[BLOQUEO/limitación comercial] Wompi es del mercado colombiano** (tarjetas COP, PSE, Nequi, Bancolombia). Un pagador internacional típico **no** paga por Wompi. El objetivo "SaaS global en USD" queda **limitado al pago desde Colombia** mientras Wompi sea el único proveedor. Se documenta; la capa `PaymentProvider` permite añadir un proveedor internacional en una fase futura sin reescribir Developer. **No** se resuelve en V1 por decisión comercial (Wompi único).

## 3. Arquitectura

```
UI /developer/plan  (toggle Mensual/Anual, precios USD, tokeniza tarjeta con Wompi public key)
   │  POST /api/developer/billing/checkout { plan, intervalo, token, acceptance_token, accept_personal_auth, customer_email }
   ▼
API DuLabs Developer  (auth dueño de cuenta → resuelve plan/precio USD → FX → COP; reserva atómica; crea fuente+transacción Wompi)
   ▼
Wompi (cobra COP)  ──eventos──▶  POST /api/developer/billing/webhook
                                   1 firma → 2 registra evento → 3 idempotencia → 4 200 rápido
                                   5 procesa → 6 payment/subscription → 7 RPC Fase 11 (set_estado/cambiar_plan) → 8 auditoría
   ▼
dulabs_dev_accounts (estado/plan/periodo)  ──▶  resolverEntitlementsDeWorkspace()  ──▶  enforcement (Fases 5/7/10)
```

- **Capa `PaymentProvider`** [NUEVO] (`lib/developer/billing/payment-provider.ts`): interface con impl Wompi (`WompiProvider`) que **envuelve** el conocimiento de `lib/wompi.ts` sin importar tablas/dominio de Business. Métodos: `crearFuentePago`, `crearTransaccion`, `verificarFirmaWebhook`, `parsearEvento`, `estadoDesde(status)`.
- **Regla fundamental:** Fase 11 controla **qué puede hacer** el cliente (entitlements); Fase 12 controla **si está pagando y su estado de billing**. El resolvedor de Fase 11 sigue siendo la **única** fuente de límites. Billing solo cambia `dulabs_dev_accounts.{estado,plan_codigo,periodo_*,numeros_adicionales}` **vía los RPCs de Fase 11**.

## 4. Source of truth de pricing (única)

[NUEVO] `lib/developer/billing/pricing.ts` → `resolverPricing(plan, intervalo)`:
- Lee `dulabs_dev_plans.precio_mensual_usd` (**[EXISTE]** Fase 11) como base canónica.
- `intervalo="month"` → `usd_total_cents = precio_mensual_usd*100`.
- `intervalo="year"` → `usd_total_cents = precio_mensual_usd*10*100` (**10 meses**; no se guarda columna anual, se **deriva** → sin duplicar precios).
- Enterprise → `{ checkout: false, contacto_ventas: true }`.
- Devuelve `{ plan, intervalo, usd_total_cents, usd_equivalente_mensual_cents, limites: resolverEntitlements(...) }`.
- **Nadie más calcula precios.** UI, checkout, webhook y cron lo consumen.

## 5. Modelo de datos (LEAN — auditado; se eliminó lo innecesario)

Todas `public.dulabs_dev_billing_*`, **RLS on sin políticas (solo `service_role`)**, `created_at/updated_at`, auditoría vía `dulabs_dev_account_audit` **[EXISTE, se reutiliza]** con acciones nuevas (`CHECKOUT`, `PAYMENT_APPROVED`, `PAYMENT_FAILED`, `RENEWAL`, `DOWNGRADE_SCHEDULED`, `CANCEL_SCHEDULED`, `SET_ESTADO`).

**Se DESCARTAN para V1** (no se crean): `invoices` (Wompi no emite facturas; un recibo se deriva de `payments` si se necesita), y tabla `prices` separada (el pricing se deriva de `dulabs_dev_plans` + helper §4). `checkout_sessions` **se fusiona** dentro de `payments` (la fila `pending` ES el registro de checkout).

1. **`dulabs_dev_billing_customers`** — `account_id uuid PK (FK dulabs_dev_accounts)`, `wompi_customer_email text`, `wompi_payment_source_id text`, timestamps. *(cliente + fuente de pago tokenizada; el token de tarjeta se guarda en Wompi, aquí solo su id).*
2. **`dulabs_dev_billing_subscriptions`** — `account_id uuid PK (FK)`, `intervalo text check in ('month','year')`, `precio_usd_cents int`, `proximo_cobro date`, `downgrade_a_plan text null` (intención de downgrade al fin de período), timestamps. *(campos SOLO de billing; `estado/plan_codigo/periodo_*` NO se duplican — viven en `dulabs_dev_accounts`).*
3. **`dulabs_dev_billing_payments`** — `id`, `account_id (FK)`, `reference text UNIQUE`, `provider_transaction_id text UNIQUE null` (idempotencia), `tipo text` (`checkout|renewal|upgrade`), `plan_codigo`, `intervalo`, `precio_usd_cents`, `monto_cop_cents`, `fx_rate numeric`, `estado text` (`PENDING|APPROVED|DECLINED|ERROR|VOIDED`), timestamps. *(checkout + historial de pagos; USD+COP+FX auditable).*
4. **`dulabs_dev_billing_events`** — `id`, `provider_event_id text UNIQUE` (o `reference+transaction` como clave de dedup), `type`, `payload jsonb`, `signature_verified bool`, `status text` (`received|processed|failed|dead_letter|ignored_duplicate`), `attempts int`, `error text`, `correlation_id`, `received_at`, `processed_at`. *(idempotencia/replay/orden/dead-letter/auditoría).*

**FX:** tasa server-side en env `DEVELOPER_BILLING_USD_COP_RATE` (configurable sin redeploy si se prefiere una tabla `dulabs_dev_billing_config` de 1 fila — opcional V1); **siempre** registrada por transacción en `payments.fx_rate`. **Índices:** `account_id` en todas; `UNIQUE` en `reference`, `provider_transaction_id`, `provider_event_id`; `billing_events(status, received_at)`. **Anti doble-suscripción/doble-cobro:** RPC de reserva atómica [NUEVO] `dulabs_dev_billing_reservar` (patrón de `dulabs_reservar_suscripcion` de Business) + `UNIQUE` arriba + advisory lock por cuenta (reuso Fase 11).

## 6. Flujo de checkout

`POST /api/developer/billing/checkout` — body conceptual **solo** `{ plan, intervalo, token, acceptance_token, accept_personal_auth, customer_email }`.
1. Auth: `conSesionDeveloper` + `owner_user_id === ctx.userId` (dueño de cuenta); cuenta derivada del workspace. `accountId`/precio/monto/moneda del body **ignorados**.
2. Enterprise → 400 "contacto comercial" (no checkout).
3. `resolverPricing(plan, intervalo)` → `usd_total_cents`; `monto_cop_cents = round(usd_total_cents * fx_rate)`; se registra `fx_rate`.
4. **Reserva atómica** (`dulabs_dev_billing_reservar`) → si ya hay pago en curso/suscripción activa incompatible → 409 (cierra doble checkout).
5. Crea fila `payments(PENDING, reference=dulabs-dev-{accountId}-{ts})` con plan/intervalo/USD/COP/FX.
6. `provider.crearFuentePago` (tokenizada) → `provider.crearTransaccion` (COP, firma de integridad, `recurrent:true`).
7. `estadoDesde(status)`: APPROVED → confirmar (webhook igual reconciliará); PENDING(3DS) → esperar webhook; DECLINED/ERROR/VOIDED → liberar reserva, 402.
8. **Los límites NO suben aquí**: la activación real (`cambiar_plan`/`set_estado(active)`) la hace el **webhook** al confirmar APPROVED (fuente de verdad del pago). Si APPROVED llega inline, se puede activar inline **de forma idempotente** (misma ruta que el webhook), nunca doble.
9. **La tarjeta nunca toca nuestro servidor** (tokenizada en el navegador con la public key).

## 7. FX USD→COP (política segura y auditable)

- Precio canónico: **USD** (en `dulabs_dev_plans`).
- Tasa: `DEVELOPER_BILLING_USD_COP_RATE` **server-side** (nunca del cliente). Cambiarla es acción administrativa (queda en audit al usarse).
- En cada transacción se persiste `precio_usd_cents` + `monto_cop_cents` + `fx_rate` → trazabilidad total.
- El cliente ve USD; se le informa el equivalente COP a cobrar por Wompi antes de confirmar (transparencia).
- **Riesgo:** deriva cambiaria entre revisiones de la tasa (aceptable en V1; revisión periódica de la tasa como tarea operativa).

## 8. Flujo de webhook (`POST /api/developer/billing/webhook`)

Pipeline obligatorio [REUTILIZAR patrones de Business, sin sus tablas]:
1. Recibir evento (raw body).
2. **Verificar firma** con `DEVELOPER_WOMPI_EVENTS_KEY` (patrón `verificarChecksumEvento`, comparación en tiempo constante). Inválida → 403, no procesa.
3. **Registrar evento primero** en `dulabs_dev_billing_events` (`provider_event_id UNIQUE`). Si existe → 200 inmediato (idempotencia/replay).
4. Responder **200 rápido**.
5. Procesar: localizar `payments` por `provider_transaction_id`/`reference`; **protección de orden** (patrón `esTransaccionMasReciente`: no revertir un estado más nuevo con evento viejo); **anti doble-cobro** (patrón `debeOmitirCobroPorPagoPendiente`).
6. Actualizar `payments.estado`; si APPROVED → actualizar `subscriptions` (período/próximo cobro) y **RPC Fase 11**: `cambiar_plan` (si upgrade) + `set_estado('active')`. Si DECLINED en renovación → dunning (§10).
7. Marcar evento `processed`; errores → `attempts++`/`failed`→`dead_letter` (cron admin drena).
8. Auditoría con `correlation_id = provider_event_id`.

## 9. Estados

- **Cuenta** (Fase 11, enforcement): `active ⇄ past_due → canceled`; `canceled → active` (nueva suscripción). Único mutador: RPCs Fase 11 desde el billing processor/cron/admin.
- **Payment:** `PENDING → APPROVED | DECLINED | ERROR | VOIDED` (crudo de Wompi; mapeado por `estadoDesde`).
- **Event:** `received → processed | failed → dead_letter`; `ignored_duplicate`.
- Efecto por estado de cuenta: `past_due`/`canceled` ⇒ `consumoBloqueado` (Fase 11: límite efectivo 0) — **no se destruyen** números/workspaces/miembros/datos.

## 10. Recurrencia + dunning

`POST /api/developer/billing/cobro-recurrente` (cron; reutiliza el patrón `cobro-mensual` de Business, dominio Developer):
- Selecciona suscripciones con `proximo_cobro <= hoy` y `estado='active'`; salta las que tienen un pago `PENDING` reciente (anti doble-cobro).
- Cobra vía fuente tokenizada (`recurrent:true`) por `precio_usd_cents→COP` (FX vigente).
- Éxito → nuevo `período` (+1 mes o +1 año según `intervalo`), `proximo_cobro` avanza.
- **Dunning** (fallo de renovación): 1er fallo → `set_estado('past_due')` + aviso; **reintentos** automáticos en ventana de gracia (**propuesta: 3 reintentos en ~7 días** [ajustable]); avisos al cliente; si no se recupera → `set_estado('canceled')` (sin destruir recursos). Recuperado → `set_estado('active')` + período nuevo. Patrón reimplementado en namespace Developer (no se usa `lib/dunning/*` de Business tal cual).

## 11. Upgrade / Downgrade / Cancelación

- **Upgrade** (p. ej. DEVELOPER→AGENCY): checkout por el nuevo plan; **límites suben solo al confirmar APPROVED** (vía `cambiar_plan` en el webhook). Sin prorrateo (Wompi no lo soporta). Sin doble cobro (reserva + idempotencia). El intervalo puede cambiarse en el mismo flujo.
- **Downgrade** (opción A, Fase 11): se **valida atómicamente** que los recursos actuales quepan en el plan destino (RPC `cambiar_plan` ya bloquea con `downgrade_bloqueado` + detalle "numeros/workspaces/miembros: actual>límite"). Si cabe → se registra `downgrade_a_plan` y **se aplica al siguiente período** (el cron ejecuta `cambiar_plan` al renovar). **No** se quitan recursos automáticamente; si excede, se **bloquea** y la UI explica exactamente qué reducir.
- **Cancelación:** `dulabs_dev_accounts.cancelar_al_fin_periodo=true` (**[EXISTE]** columna Fase 11); acceso hasta `periodo_fin`; al finalizar (cron) → `set_estado('canceled')`. **No** se borran workspaces/números/datos/historial de billing.

## 12. Enterprise

Sin checkout. UI: "Enterprise — desde $199 USD/mes — ¿Configuración personalizada? Habla con nuestro equipo" → CTA "Contactar ventas" a **correo comercial configurable** (`NEXT_PUBLIC_DEVELOPER_SALES_EMAIL` o config). Límites por overrides de Fase 11 (`dulabs_dev_plan_overrides`), activación/precio manual por admin.

## 13. APIs (todas bajo `/api/developer/billing/*`, auth dueño de cuenta salvo webhook)

- `POST /checkout` (§6) · `POST /webhook` (§8, firma, sin sesión) · `POST /cobro-recurrente` (cron, protegido por `CRON_SECRET`) · `GET /api/developer/subscription` (**[EXISTE]**, se extiende con estado de billing/próximo cobro/método) · `POST /api/developer/subscription/plan` y `.../additional-numbers` (**[EXISTE]**, ahora **exigen pago**).

## 14. Seguridad (explícita)

Precio/monto/moneda/plan/accountId/estado **nunca** del frontend → todo server-side. Webhook firmado + event-log + idempotencia (`UNIQUE` transaction/event) + replay (dedup) + orden (precedencia). Doble checkout/cobro → reserva atómica + `UNIQUE`. Cross-tenant → cuenta derivada del workspace; gate dueño de cuenta. SSRF → n/a (no fetch a URLs del cliente; si se agregan webhooks salientes a futuro, usar `ssrf-guard` **[EXISTE]**). Secretos Wompi solo server-side (env); **tarjeta nunca toca el servidor** (tokenización en navegador). Extender el **crypto-guard de release** para exigir `DEVELOPER_WOMPI_*` en producción.

## 15. Idempotencia y concurrencia

Entrada: `UNIQUE(provider_event_id)` + estado `processed`. Salida: `reference UNIQUE` + reserva atómica. Mutaciones: RPCs atómicos con advisory lock por cuenta (reuso Fase 11). Concurrencia cubierta: doble checkout, cambio de plan concurrente, cancelación+renovación, webhook fuera de orden.

## 16. Pruebas (E2E real + unit)

Unit: `pricing` (mensual/anual ×10, Enterprise sin checkout), FX (USD→COP, registro), firma/checksum, mapeo de estados, precedencia de orden. E2E real (BD + Wompi sandbox): checkout APPROVED/DECLINED/PENDING(3DS); webhook válido/inválido/duplicado/replay/fuera-de-orden; renovación mensual y anual (cron); upgrade (activa solo tras APPROVED, sin doble cobro); downgrade (bloqueo por recursos + aplicación a siguiente período); cancelación (`cancelar_al_fin_periodo`, acceso hasta fin); past_due→reintentos→recuperación→active; past_due→canceled; concurrencia; cross-tenant; manipulación de precio/monto/moneda/plan/accountId/estado; Enterprise sin checkout. **Regresión Fase 10** (número real `1359526083904105` intacto) y **Fase 11** (16/16).

## 17. Criterios de aceptación (Fase 12 CLOSED)

Todos los tests §16 verdes; TS/ESLint/build verdes; migraciones `dulabs_dev_billing_*` aplicadas manualmente y verificadas; comercio Wompi Developer + `DEVELOPER_WOMPI_*` configurados en prod; secretos ausentes de logs; entitlements suben/bajan **solo** por eventos de pago firmados; ningún recurso destruido en downgrade/cancelación; Business/AMORE/Fases 1–11 intactas; closure report + verificación de producción.

## 18. Qué se reutiliza de Business (conocimiento/patrón) vs qué NO

**Se reutiliza (patrón, no dominio):** tokenización de tarjeta en navegador; precio server-side; reserva atómica anti doble-cobro; firma de integridad de transacción; verificación de checksum de webhook (tiempo constante); mapeo de estados APPROVED/PENDING/…; protección de eventos fuera de orden; anti doble-cobro por pago PENDING; recurrencia por cron + dunning. **NO se reutiliza (dominio Business):** tablas `dulabs_pagos`/`dulabs_suscripciones`; `lib/planes.ts`/`PLANES` (COP); `app/api/wompi/webhook`, `app/api/pagos/suscribir`, `app/api/wompi/cobro-mensual`; `lib/dunning/*`; el comercio Wompi de Business (Developer usa uno separado).

## 19. Impacto sobre Fase 11

No destructivo. Se **conectan** los ganchos existentes (`set_estado` pasa a tener caller; `subscription/plan` y `additional-numbers` exigen pago). Resolvedor de entitlements **sin cambios** (única fuente de límites). Posible columna aditiva opcional en `accounts` (`intervalo_billing`) — evaluable, no obligatoria (vive mejor en `billing_subscriptions`).

## 20. Orden exacto de implementación (Fase 12.3)

1. **Migraciones** `dulabs_dev_billing_*` (4 tablas + RPC reserva) — aditivas, aplicación manual.
2. **Pricing helper** (§4) + tests unit.
3. **Capa `PaymentProvider` + `WompiProvider`** (envuelve `lib/wompi.ts`; FX) + tests.
4. **Checkout** `POST /checkout` (reserva, tokenización, transacción) + tests.
5. **Webhook** `POST /webhook` (firma, event-log, idempotencia, orden, RPCs Fase 11) + tests.
6. **Recurrencia + dunning** `cobro-recurrente` (cron) + tests.
7. **Upgrade/downgrade/cancelación** cableados a billing + tests.
8. **UI** `/developer/plan` (toggle, USD, "2 meses gratis", estado, past_due, Enterprise CTA).
9. **Seguridad/adversarial** (§14) + **regresión** Fase 10/11.
10. **Closure report** + promoción (con aprobación).

## 21. Riesgos

🔴 Alcance internacional de Wompi (COP/Colombia) vs objetivo USD-global → mitigado por `PaymentProvider` (proveedor internacional futuro). 🟠 Comercio Wompi separado (config manual). 🟠 Sin proration/anual nativos → lógica propia. 🟡 Deriva FX. 🟡 3DS PENDING async. 🟢 Meta sin riesgo (Tech Provider). 🟢 Compatibilidad Fases 1–11 (billing solo escribe vía RPCs Fase 11).

## 22. Plan de rollback

Migraciones aditivas (DROP `dulabs_dev_billing_*` solo si vacías). Código por PR revertible (`git revert`) sin tocar Fase 11 (billing no modifica el resolvedor). Si billing falla, `set_estado` puede quedar sin caller → vuelve al comportamiento Fase 11 (planes sin cobro) sin pérdida de datos. Feature flag `DEVELOPER_BILLING_ENABLED` (env) para activar/desactivar sin redeploy.

---

## DECISIONES CERRADAS

- Proveedor: **Wompi** (namespace Developer propio; Business intacto).
- Meta: Tech Provider; DuLabs no paga mensajes; cuotas = límites comerciales.
- Moneda: **USD canónico**, cobro **COP** con FX server-side auditable (`precio_usd_cents`+`monto_cop_cents`+`fx_rate` por transacción).
- Periodicidad: **mensual** y **anual = ×10 (2 meses gratis)**; anual = 1 transacción, período 12m, próximo cobro +1 año.
- Enterprise: **manual**, sin checkout, CTA "Contactar ventas" a correo comercial configurable; límites por overrides.
- Trials/cupones: **no** en V1 (arquitectura no los impide).
- Upgrade: inmediato, límites solo tras pago confirmado, sin doble cobro, sin prorrateo.
- Downgrade: opción A (bloqueo si excede + explicación), aplica al siguiente período, no destruye recursos.
- Cancelación: `cancelar_al_fin_periodo=true` por defecto; acceso hasta fin; no destruye.
- past_due: dunning (1er fallo→past_due, 3 reintentos ~7 días, avisos, luego canceled), sin destruir recursos.
- Aislamiento: tablas `dulabs_dev_billing_*`, rutas `/api/developer/billing/*`, comercio Wompi separado; no se tocan `dulabs_pagos`/`dulabs_suscripciones`/planes/webhook/rutas de Business.
- Source of truth de pricing: `dulabs_dev_plans` + helper `resolverPricing` (anual derivado ×10; sin tabla de precios duplicada).
- Modelo de datos: **4 tablas** (`customers`, `subscriptions`, `payments`, `events`) + auditoría en `dulabs_dev_account_audit`; **sin** `invoices`/`prices`/`checkout_sessions` separadas.

**No quedan decisiones comerciales pendientes para comenzar la implementación (12.3).** Únicas acciones **no-código** previas a 12.3: (a) crear el **comercio/config Wompi de Developer** y cargar `DEVELOPER_WOMPI_*` + `DEVELOPER_BILLING_USD_COP_RATE` + correo de ventas en Vercel; (b) confirmar la **tasa FX** inicial. Ambas son de configuración, no bloquean el diseño.

> Contradicción técnica real señalada (no oculta): Wompi cobra **COP** y es de mercado **colombiano**; "USD-global" se cumple a nivel de **precio de exhibición** y de pago **desde Colombia**, no como aceptación universal de tarjetas internacionales. Solución V1 arriba; expansión internacional = proveedor adicional en fase futura vía `PaymentProvider`.
