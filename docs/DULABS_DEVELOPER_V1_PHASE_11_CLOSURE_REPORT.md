# DuLabs Developer V1 — Fase 11 (Plans / Pricing / Subscriptions) — CLOSURE REPORT

**STATUS: VALIDADO CONTRA BD REAL — listo para cierre (pendiente merge a `main`).**

Producto separado de DuLabs Business; portal propio en `/developer`. Esta fase incorpora el modelo de planes, precios, suscripciones y **entitlements a nivel de CUENTA**. No toca Business/AMORE ni las Fases 1–10. El número real conectado en Fase 10 se verificó intacto antes y después de la validación.

Rama de trabajo: `release/developer-v1` (NO fusionada a `main`). Validación real ejecutada el 2026-09-16.

## Alcance cerrado
Modelo de **cuenta** que agrupa workspaces, miembros, mensajes y números; resolvedor único de entitlements por plan (con overrides Enterprise); cambio de plan (upgrade inmediato / downgrade con protección de recursos); números adicionales; límites de workspaces y miembros aplicados atómicamente a nivel de cuenta; estados de suscripción `active / past_due / canceled` con bloqueo de consumo; y autorización/aislamiento por cuenta y por workspace.

## Planes (catálogo real en `dulabs_dev_plans`, verificado por lectura)
| Plan | Precio/mes | Mensajes/mes | Números incluidos | Workspaces | Miembros | Adicionales |
|---|---|---|---|---|---|---|
| DEVELOPER | $19 | 20 000 | 2 | 1 | 1 | **No** (`permite_numeros_adicionales=false`) |
| AGENCY | $45 | 100 000 | 5 | 5 | 5 | **Sí** ($5/número adicional) |
| ENTERPRISE | $199 base | null → override | null → override | null → override | null → override | Sí |

- **DEVELOPER**: hard-cap de 2 números; NO puede comprar números adicionales (el resolver rechaza). El límite de números permanece en 2 (puede conectar hasta 2).
- **AGENCY**: 100 000 mensajes / 5 números / 5 miembros / 5 workspaces **por CUENTA** (compartidos entre workspaces). Permite números adicionales, que suben el `maxNumbers` efectivo.
- **ENTERPRISE**: $199 base; límites `null` en el catálogo, resueltos por `dulabs_dev_plan_overrides` (NULL en una columna = usar el límite base). El catálogo y la tabla de overrides se verificaron por lectura; la resolución de overrides forma parte del resolvedor único de entitlements. (La suite E2E de esta validación se centró en DEVELOPER/AGENCY; no incluye un caso específico de override Enterprise.)

## Modelo de cuenta
- `dulabs_dev_accounts` (owner_user_id, plan_codigo, estado) es la unidad de facturación/entitlements. `dulabs_dev_workspace_plans.account_id` enlaza cada workspace a su cuenta.
- **Materialización atómica**: `ensureCuentaParaWorkspace` → RPC `dulabs_dev_ensure_account_for_workspace` con `pg_advisory_xact_lock` por workspace. Verificado: dos upgrades concurrentes sobre un workspace fresco producen **una sola** cuenta (sin huérfanas).
- `accountId` **nunca** se toma del cliente: la cuenta se deriva server-side del workspace autenticado.

## Workspaces
- Creación bajo la cuenta hasta `maxWorkspaces` (AGENCY=5); el 6.º → **403 `workspace_limit_exceeded`**.
- Límite aplicado atómicamente en `dulabs_dev_crear_workspace` (advisory lock por cuenta): con 1 solo cupo libre y dos creaciones concurrentes, **exactamente una** gana y la otra es rechazada.

## Miembros
- Límite `maxMembers` **por cuenta** (AGENCY=5); el 6.º usuario distinto → **403 `member_limit_exceeded`**.
- Solo cuentan las membresías **`estado='activo'`** para el límite (`v_ya_es` corregido para contar únicamente activas).
- Una membresía **suspendida NO puede reactivarse si eso supera el límite** (reactivación con la cuenta llena → 403); reactivación **bajo** el límite → OK.

## Mensajes
- Entitlement de mensajes por cuenta: DEVELOPER 20 000 / AGENCY 100 000 (ENTERPRISE por override). Valores verificados vía el endpoint de suscripción.
- Reserva/consumo mediante `dulabs_dev_reclamar_reservar_mensaje` (a nivel de cuenta).

## Estados de suscripción
- `active`: operación normal (default).
- `past_due`: **consumo bloqueado** (`consumoBloqueado=true`) y compra de números adicionales bloqueada (**402**) — verificado por E2E. No se destruyen recursos existentes.
- `canceled`: soportado por el modelo de estados (`setEstado` / `dulabs_dev_set_estado`); mismo principio de bloqueo de nuevo consumo sin destruir recursos. (En esta suite E2E se ejercitó específicamente `past_due`.)
- Operaciones administrativas sin costo directo (p. ej. crear workspace) pueden continuar según la implementación aprobada.

## Seguridad y aislamiento (verificado por E2E)
- Cambiar plan: **solo OWNER**; MEMBER y ADMIN → 403.
- Solo el `owner_user_id` de la CUENTA puede cambiar el plan: un OWNER de un workspace de una cuenta ajena → **403 `not_account_owner`**.
- Cross-tenant: `x-dulabs-workspace` de un workspace ajeno → **403 `workspace_forbidden`** (no llega a tocar la cuenta).
- Un `accountId` inyectado en el body se **ignora**: la cuenta se deriva del workspace autenticado (la cuenta del atacante no se modifica; la ajena queda intacta).
- Concurrencia segura mediante advisory locks por cuenta/workspace.

## Migraciones
Aplicadas manualmente en Supabase (proceso estándar del proyecto). No se re-ejecutan ni se modifican las históricas.
- `20261015000000_dulabs_developer_v1_fase11_accounts_plans.sql` — tablas `dulabs_dev_accounts`, `dulabs_dev_plan_overrides`, `dulabs_dev_account_audit`; columnas `account_id` en `dulabs_dev_workspace_plans` y `max_workspaces` / `max_members` / `permite_numeros_adicionales` en `dulabs_dev_plans`; re-seed del pricing aprobado.
- `20261015000100_dulabs_developer_v1_fase11_rpcs.sql` — RPCs `dulabs_dev_reclamar_reservar_mensaje`, `dulabs_dev_registrar_numero_con_limite`, `dulabs_dev_cambiar_plan`, `dulabs_dev_set_numeros_adicionales`, `dulabs_dev_set_estado`.
- `20261015000200_dulabs_developer_v1_fase11_resource_rpcs.sql` — RPCs `dulabs_dev_crear_workspace`, `dulabs_dev_crear_miembro_con_limite`, `dulabs_dev_ensure_account_for_workspace`.

### Fix aditivo posterior
- `20261015000300_dulabs_developer_v1_fase11_fix_crear_workspace_ambiguity.sql` — `CREATE OR REPLACE FUNCTION dulabs_dev_crear_workspace(...)` con `#variable_conflict use_column`, para resolver el error de runtime `column reference "workspace_id" is ambiguous` (la columna de salida `workspace_id` del `RETURNS TABLE` colisionaba con la columna homónima en `INSERT` / `ON CONFLICT`). Mismo contrato, misma firma, mismo `RETURNS TABLE`; **sin cambios de TypeScript**. Aditiva: no modifica las históricas.
- **Commit del fix:** `85104a0` (rama `release/developer-v1`).

## Resultados E2E (real contra Postgres)
`app/api/developer/fase11-plans.e2e.test.ts` — invoca los route handlers reales con sesiones JWT reales; solo toca tablas `dulabs_dev_*` + usuarios de Auth desechables (con limpieza en `after`).

```
TESTS: 16   PASS: 16   FAIL: 0   SKIP: 0
```

Cobertura verificada: entitlements DEVELOPER/AGENCY; límites Developer (2/20K/1/1) y bloqueo de adicionales (403); números adicionales AGENCY (5+3=8); creación de workspaces y tope (403) + concurrencia de cupo; downgrade bloqueado con >1 workspace (409 `downgrade_blocked`); límite de miembros por cuenta (403) + reactivación bajo/sobre límite; `past_due` (consumo bloqueado + 402); materialización de cuenta concurrente (1 sola cuenta); seguridad por rol / `not_account_owner` / cross-tenant / `accountId` inyectado ignorado.

## Regresión verificada — número real de Fase 10 (intacto)
Verificado por lectura **antes y después** del E2E:
- `phone_number_id`: **1359526083904105**
- `waba_id`: **1447966503807955**
- estado: **conectado**
- registros: **1 (único)** — `id a9b857d1-4367-44b2-bfa4-f3403e6e337e`, workspace `e311154e-cfbb-4a5c-882f-952fcacba4d8`, "Dulabs Ventas"
- token de Meta: **cifrado, presente** (no se muestra el valor)
- Sin cambios ni duplicados provocados por el E2E.

## Pendiente para el cierre formal
- Merge de `release/developer-v1` → `main` y deploy a producción — **cuando se autorice** (no realizado; `main` intacto).
- Esta fase no se marca CLOSED en `main` hasta ese merge.
