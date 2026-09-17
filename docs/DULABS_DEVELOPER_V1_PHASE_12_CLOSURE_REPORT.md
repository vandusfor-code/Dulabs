# DuLabs Developer V1 — Fase 12 (Billing & Subscriptions, Wompi) — CLOSURE REPORT

**STATUS: CIERRE TÉCNICO A NIVEL DE CÓDIGO/INTEGRACIÓN/TESTS LOCALES.** El cobro real end-to-end contra Wompi queda pendiente de una acción de **configuración** (variables `DEVELOPER_WOMPI_*` en Vercel), no de código. Sin push/merge/deploy. `main` intacto (`65cb842`). Rama: `feature/developer-v1-fase12-billing`.

Producto separado de Business; namespace propio de Developer. Meta = Tech Provider (DuLabs no paga los mensajes; las cuotas son límites comerciales). Fase 11 permanece intacta con billing OFF.

## Alcance cerrado
Sistema de suscripciones/facturación de Developer con Wompi: pricing USD (mensual/anual), checkout tokenizado, webhooks firmados con event-log, recurrencia + dunning, upgrade con pago, downgrade diferido (opción A), cancelación al fin de período, Enterprise manual — todo **detrás de un feature flag** (`DEVELOPER_BILLING_ENABLED`) que preserva exactamente Fase 11 cuando está OFF.

## Arquitectura (verificada en el código)
`UI /developer/plan → PaymentProvider (WompiProvider) → checkout server-side → Wompi (COP) → webhook (firma→event-log→idempotencia→orden) → RPCs de Fase 11 (set_estado/cambiar_plan) + período → dulabs_dev_accounts → resolverEntitlementsDeWorkspace()`. El resolvedor de entitlements de Fase 11 sigue siendo la **única** fuente de límites; billing solo mueve el estado comercial.

## Wompi (aislado de Business)
- Cliente propio `lib/developer/billing/wompi-client.ts` con llaves `DEVELOPER_WOMPI_*` y comercio separado; **no** reutiliza `lib/wompi.ts`, `dulabs_pagos`, `dulabs_suscripciones`, rutas ni webhook de Business.
- Tokenización de tarjeta **en el navegador** (`components/developer/BillingCheckout.tsx`, public key Developer): la tarjeta nunca toca el servidor; solo se persiste el `payment_source_id`/token id de Wompi.
- Firma de integridad en la creación de transacción; verificación de checksum de webhook en tiempo constante.
- Cobro en **COP** (Wompi no procesa USD); el monto COP se resuelve server-side con FX.

## Pricing (fuente única)
- `dulabs_dev_plans.precio_mensual_usd` es la única fuente. `lib/developer/billing/pricing.ts::resolverPricing`: mensual = precio; **anual = ×10 (2 meses gratis)** derivado (sin columna/tabla de precios duplicada). Enterprise → checkout deshabilitado.
- FX USD→COP server-side (`DEVELOPER_BILLING_USD_COP_RATE`, fail-closed); se registra `precio_usd_cents` + `monto_cop_cents` + `fx_rate` por transacción.

## Checkout (`POST /api/developer/billing/checkout`)
Auth dueño de cuenta; cuenta derivada del workspace (accountId del body ignorado); precio/FX server-side; reserva atómica anti doble-cobro (`dulabs_dev_billing_reservar_checkout`); activación **solo** en la transición a APPROVED (idempotente con el webhook); PENDING(3DS) espera al webhook.

## Recurrencia (`POST /api/developer/billing/cobro-recurrente`, cron)
Cron diario (`vercel.json`, 15:00 UTC, aditivo — no toca los crons de Business), protegido con `CRON_SECRET`. Cobra mensual/anual con la fuente tokenizada; anti doble-cobro (salta PENDING recientes); avanza período + próximo cobro; aplica el downgrade programado al renovar (re-validando recursos).

## Dunning
Fallo de renovación → `past_due`; reintentos (ventana `DIAS_ENTRE_REINTENTOS=3`, hasta `MAX_REINTENTOS_DUNNING=3`); recuperación → `active`; agotados → `canceled`. **Nunca destruye recursos.**

## Cancelación
`cancelar_al_fin_periodo` (dueño de cuenta, con revertir); acceso hasta el fin del período; el cron/lifecycle pasa a `canceled` al finalizar. No borra workspaces/números/datos.

## Downgrade (opción A)
Con billing ON: no cambia de inmediato; valida recursos (read-only) y registra `downgrade_a_plan`; se aplica al fin de período con **re-validación** de recursos. Si excede → 409 `downgrade_blocked` con detalle. Con billing OFF: comportamiento inmediato de Fase 11.

## Enterprise
Manual, sin checkout; UI muestra CTA "Contactar ventas" → `NEXT_PUBLIC_DEVELOPER_SALES_EMAIL`. Límites por overrides de Fase 11.

## Seguridad (verificada por tests)
Precio/monto/moneda/plan/accountId/estado nunca desde el frontend. Cuenta server-side; solo dueño de cuenta cambia billing (OWNER de un workspace de cuenta ajena → 403 `not_account_owner`, con accountId del body ignorado). Webhook firmado + event-log (idempotencia por `provider_event_id` único) + protección de orden. Reserva atómica anti doble-cobro. Tarjeta nunca persistida. Llaves Developer separadas de Business. Aislamiento tenant conservado. Crypto-guard intacto.

## Tests (resultados verificados)
- TypeScript `tsc --noEmit`: **PASS**
- ESLint (billing/UI): **PASS**
- Unit billing (pricing ×10, FX, firma webhook, estados): **9/9 PASS**
- E2E Billing **ON** (upgrade→402, Enterprise→400, downgrade programado/bloqueado, lifecycle, dunning past_due→canceled, reserva anti doble-cobro, checkout owner-only, accountId ignorado, cancelación): **10/10 PASS**
- E2E Fase 11 con billing **OFF** (regresión): **16/16 PASS**
- `npm run build`: **PASS**
- E2E real contra Wompi sandbox: **NO EJECUTADO** — bloqueado por config ausente (ver Pendiente).
- `test:flow` completo: no ejecutado en este cierre (suites relevantes de Fase 12 y regresión de Fase 11 verificadas arriba).

## Migraciones
Aplicadas manualmente y verificadas: `20261016000000_...fase12_billing_tables.sql` (4 tablas `dulabs_dev_billing_*`) y `20261016000100_...fase12_billing_rpcs.sql` (`dulabs_dev_billing_reservar_checkout`). Aditivas; no modifican Fase 1–11.

## Feature flag
`DEVELOPER_BILLING_ENABLED` server-side. OFF (default) = Fase 11 exacto (16/16). ON = upgrade con pago + downgrade diferido + Enterprise manual. Rollback: apagar el flag revierte al comportamiento Fase 11 sin pérdida de datos.

## Configuración PENDIENTE (bloqueo real, no de código)
Cargar en Vercel Production (comercio Wompi **separado** de Business):
- `DEVELOPER_WOMPI_PRIVATE_KEY`, `DEVELOPER_WOMPI_INTEGRITY_KEY`, `DEVELOPER_WOMPI_EVENTS_KEY`, `NEXT_PUBLIC_DEVELOPER_WOMPI_PUBLIC_KEY`
- `DEVELOPER_BILLING_USD_COP_RATE`
- `NEXT_PUBLIC_DEVELOPER_SALES_EMAIL`
- `DEVELOPER_BILLING_ENABLED=true` (para activar el flujo)
- Configurar el webhook del comercio Wompi Developer → `https://www.dulabs.co/api/developer/billing/webhook`

Verificado el 2026-09-17: ninguna de estas variables existe aún en Vercel Production.

## No se tocó
Business (incl. Wompi/`dulabs_pagos`/`dulabs_suscripciones`), AMORE, Fases 1–11, Embedded Signup, connect, webhooks existentes, crypto. Número real de Fase 10 (`1359526083904105`) intacto.
