# DuLabs Developer V1 — Fase 11: Plans / Pricing / Subscriptions / Entitlements

Estado: **DISEÑO APROBADO — especificación de implementación PENDIENTE DE REVISIÓN. No implementar código hasta aprobación.**

Alcance de Fase 11: **planes, pricing, suscripciones, entitlements y límites.** NO incluye checkout, Stripe, cobros ni facturación (eso es Fase 12). NO toca Business, AMORE, Fases 1–10, Embedded Signup, Meta, webhooks, outbound ni inbound.

Posicionamiento: *"The developer infrastructure for WhatsApp."* DuLabs aporta la infraestructura oficial de WhatsApp (API, webhooks, procesamiento, números, Flow Builder, jobs, logs, usage, seguridad, administración). El developer aporta su código, servidor, lógica, prompts, proveedor y credenciales de IA, y su aplicación.

---

## 0. Decisiones aprobadas (definitivas)

1. **Modelo de CUENTA** (no por workspace). La suscripción vive en la cuenta; una cuenta agrupa 1..N workspaces/clientes/proyectos. Los números WhatsApp pertenecen a la cuenta y se distribuyen entre sus workspaces (no se asume 1 número = 1 workspace).
2. **Planes definitivos:**
   - **DEVELOPER — US$19/mes:** 2 números, 20.000 msg/mes, 1 workspace, 1 miembro, 2 msg/s/número, API/Keys/Webhooks/Flow Builder/Jobs/Logs/Usage/Starter Kit/docs. **NO puede comprar números adicionales — máximo absoluto 2.**
   - **AGENCY — US$45/mes:** 5 números, 100.000 msg/mes, 5 workspaces, 5 miembros, 2 msg/s/número, todo lo de Developer + gestión de clientes/proyectos + roles/permisos + soporte prioritario. **Puede comprar números adicionales a +US$5/mes c/u.**
   - **ENTERPRISE — desde US$199/mes:** límites personalizados (números/mensajes/workspaces/miembros/throughput) vía overrides por cuenta; features/condiciones por contrato.
3. **Mensajería:** 20K/100K = mensajes **procesados por DuLabs**. NO incluyen ni absorben tarifas de Meta. Las tarifas de Meta se cobran aparte, sin markup de DuLabs.
4. **Downgrade — opción A (BLOQUEAR):** se rechaza el downgrade si algún recurso actual (números, workspaces, miembros) supera el límite del plan destino. Sin soft-lock, sin recursos huérfanos, sin borrado automático.
5. **Trial:** NO se implementa `trialing` en Fase 11. Estados: `active`, `past_due`, `canceled`. NO crear `expired` salvo necesidad estricta (no la hay).
6. **past_due:** permite lectura del dashboard y datos históricos + acceso administrativo para resolver el pago; **bloquea consumo nuevo que genere costo** (nuevos mensajes, nuevos números, números adicionales, recursos nuevos con costo). No borra datos/recursos. La transición real por pago es Fase 12.
7. **Enterprise:** tabla dedicada de overrides por cuenta; `NULL = usar valor del plan base`; no inventar cifras.
8. **Source of truth:** `dulabs_dev_plans` es la base; se extiende el resolvedor existente para que exista **UN SOLO** resolvedor de entitlements. Cero reglas de plan duplicadas en rutas/frontend/RPCs.
9. **Fase 7:** reutilizar `dulabs_dev_plans`, `dulabs_dev_workspace_plans`, usage `period`, RPCs atómicos y `resolverLimitesDelWorkspace()`; no romper compatibilidad.
10. **Fases cerradas:** no modificar Business/AMORE/Fases 1–10/Embedded Signup/Meta/webhooks/outbound/inbound/API contracts cerrados. Solo extender lo estrictamente necesario.
11. **Adicionales Agency:** permitidos solo en Agency/Enterprise (por entitlement); requieren OWNER/ADMIN; auditables; atómicos; sin bypass frontend; preparados para que Fase 12 valide el pago. Sin checkout/Stripe.
12. **Economía:** mantener $19/$45/$199+ y límites; el análisis de costos identifica datos faltantes (Cloud Run, Supabase, Pub/Sub, egress, requests/mensaje).
13. **Frontend:** comunicar claramente Agency ($45 / 5 números / 100K / 5 proyectos / 5 miembros) y Developer ($19 / 2 números / 20K); en el 3.º número de Developer, CTA de upgrade a Agency. Enforcement real en backend/DB (no confiar en frontend).

---

## 1. Estado actual (auditoría, read-only)

Reutilizable (Fase 7):
- `dulabs_dev_plans` (PK `codigo`): `nombre, mensajes_mensuales_incluidos, numeros_incluidos, mensajes_por_segundo_por_numero, precio_numero_adicional_usd, precio_mensual_usd`. `NULL = sin límite/configurable`.
  - Seed actual: `DEVELOPER(20000,2,2,$5,$19)`, `AGENCY('Agency/Pro',null,null,null,null,$59)`, `ENTERPRISE(null,null,null,null,$199)`.
- `dulabs_dev_workspace_plans` (PK `workspace_id`, `plan_codigo` default DEVELOPER, FK a plans). Ausencia = DEVELOPER.
- `lib/developer/plans.ts::resolverLimitesDelWorkspace()` — resolvedor único de límites.
- RPCs atómicos (advisory lock): `dulabs_dev_reclamar_reservar_mensaje(..., p_limite_mensual, p_cantidad)` y `dulabs_dev_registrar_numero_con_limite(..., p_limite_numeros)`. Reciben el límite ya resuelto (NULL = sin tope).
- `dulabs_dev_usage_ledger.period` (YYYY-MM, America/Bogota).
- `dulabs_dev_memberships` (roles OWNER/ADMIN/MEMBER).

Gaps que Fase 11 cubre:
- No existe estado de suscripción.
- No hay concepto de cuenta que agrupe workspaces.
- No se aplican límites de miembros ni de workspaces.
- No existe mecanismo de números adicionales.
- Seed de AGENCY desalineado ($59 y NULLs) vs. definición aprobada ($45; 5/100K/5/5).

---

## 2. Modelo de datos propuesto (aditivo, solo `dulabs_dev_*`)

### 2.1 `dulabs_dev_accounts` (nueva) — la suscripción vive aquí
| columna | tipo | notas |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `owner_user_id` | uuid not null | referencia lógica a auth.users(id) |
| `plan_codigo` | text not null default 'DEVELOPER' | FK → dulabs_dev_plans(codigo) |
| `estado` | text not null default 'active' | CHECK in ('active','past_due','canceled') |
| `numeros_adicionales` | integer not null default 0 | CHECK >= 0 |
| `periodo_inicio` | timestamptz null | lo fija/renueva Fase 12; Fase 11 puede default a now() |
| `periodo_fin` | timestamptz null | idem |
| `cancelar_al_fin_periodo` | boolean not null default false | |
| `created_at`/`updated_at` | timestamptz | |

RLS activo; SELECT scoped a cuentas del usuario (por membresía de sus workspaces); mutaciones solo service_role.

### 2.2 `dulabs_dev_workspace_plans` (extensión aditiva) — mapea workspace → cuenta
- `+ account_id uuid null` → FK a `dulabs_dev_accounts(id)`.
- El plan efectivo del workspace se hereda de su cuenta. La columna `plan_codigo` existente se conserva por compatibilidad de lectura (legacy); la fuente de verdad pasa a la cuenta.
- **Compat:** workspace sin fila / sin `account_id` ⇒ DEVELOPER, estado `active` (comportamiento actual, sin backfill obligatorio).
- Conteo de workspaces de una cuenta = `count(*) from dulabs_dev_workspace_plans where account_id = :id`.

### 2.3 `dulabs_dev_plan_overrides` (nueva) — solo Enterprise
| columna | tipo | notas |
|---|---|---|
| `account_id` | uuid PK | FK → dulabs_dev_accounts(id) |
| `numeros_incluidos` | integer null | NULL = usar plan base |
| `mensajes_mensuales_incluidos` | integer null | |
| `max_workspaces` | integer null | |
| `max_members` | integer null | |
| `throughput_por_numero` | integer null | |
| `features` | jsonb null | features custom opcionales |

### 2.4 `dulabs_dev_plans` (columnas nuevas + re-seed)
- `+ max_workspaces integer` (NULL = sin límite)
- `+ max_members integer` (NULL = sin límite)
- `+ permite_numeros_adicionales boolean not null default false`
- **Re-seed idempotente (UPDATE, sin borrar filas):**
  - `DEVELOPER`: mensajes 20000, números 2, msg/s 2, precio_adicional $5 (no aplicable), precio $19, max_workspaces 1, max_members 1, **permite_adicionales false**.
  - `AGENCY`: nombre "Agency", mensajes 100000, números 5, msg/s 2, precio_adicional $5, **precio $45**, max_workspaces 5, max_members 5, **permite_adicionales true**.
  - `ENTERPRISE`: precio base $199, resto NULL (custom vía overrides), **permite_adicionales true**.

### 2.5 Auditoría
Reutilizar el patrón de auditoría admin existente (o `dulabs_dev_*` equivalente) para registrar: `CHANGE_PLAN`, `SET_ADDITIONAL_NUMBERS`, `CREATE_WORKSPACE`, `SET_ESTADO` (operador, cuenta, valores antes/después, motivo). Nunca guardar secretos.

---

## 3. Estados de suscripción y ciclo
- `active` → operación normal.
- `past_due` → lectura + admin para resolver pago; **bloquea consumo nuevo** (mensajes, números, adicionales, recursos con costo).
- `canceled` → al fin de período, entitlements de consumo se bloquean (lectura permitida). No borra datos.
- Sin `trialing` ni `expired`.
- El período (`periodo_inicio/fin`, renovación) se modela ahora; **las transiciones por pago/cobro las dispara Fase 12** (Fase 11 expone las funciones de transición pero no las conecta a Stripe).

---

## 4. Entitlement model (resolvedor único)

`lib/developer/entitlements.ts` (nuevo) — tipo + resolvedor:
```
type Entitlements = {
  planCodigo: string;
  estado: 'active' | 'past_due' | 'canceled';
  consumoBloqueado: boolean;            // true si estado != active
  includedNumbers: number | null;
  additionalNumbers: number;            // 0 si el plan no permite
  maxNumbers: number | null;            // included + additional (o null = sin tope)
  canBuyAdditionalNumbers: boolean;
  maxMessagesMonth: number | null;
  maxWorkspaces: number | null;
  maxMembers: number | null;
  throughputPerNumber: number | null;
  features: string[];
};
```
`resolverEntitlementsDeWorkspace(supabase, workspaceId)`:
1. workspace → `workspace_plans.account_id` → cuenta. Sin cuenta ⇒ DEVELOPER/active (compat).
2. cuenta → plan base (`dulabs_dev_plans`) + `dulabs_dev_plan_overrides` (merge: override no-NULL gana).
3. `additionalNumbers = permite ? cuenta.numeros_adicionales : 0`; `maxNumbers = includedNumbers + additionalNumbers` (o NULL).
4. `consumoBloqueado = estado !== 'active'`.

`resolverLimitesDelWorkspace()` se conserva como **wrapper delgado** (mismo shape que hoy) para no romper Fase 7/10; internamente delega en el resolvedor de entitlements.

**Enforcement de estado sin tocar el send path (Fase 5):** cuando `consumoBloqueado`, el resolvedor devuelve el límite **efectivo** de consumo igual al uso actual (números: `maxNumbers = count actual`; mensajes: `maxMessagesMonth = uso del período`), de modo que el siguiente intento de reserva de número/mensaje es rechazado por los RPCs atómicos ya existentes — sin modificar el código de outbound/connect, solo el valor que el resolvedor entrega (que esas rutas ya consumen). Los valores **nominales** del plan se exponen aparte para el display.

---

## 5. RPCs (extensión atómica)
Reutilizados sin cambiar su firma: `dulabs_dev_reclamar_reservar_mensaje`, `dulabs_dev_registrar_numero_con_limite` (siguen recibiendo el límite efectivo resuelto).

Nuevos (advisory lock por cuenta, security definer, service_role):
- `dulabs_dev_cambiar_plan(p_account_id, p_nuevo_plan, p_actor, p_motivo)`:
  - Lock por cuenta. Si es **downgrade**, cuenta números/workspaces/miembros actuales de la cuenta y compara contra los límites del plan destino; si alguno excede ⇒ retorna `downgrade_bloqueado` con detalle. Si OK, cambia `plan_codigo`. Idempotente.
- `dulabs_dev_set_numeros_adicionales(p_account_id, p_nuevo_total, p_actor, p_motivo)`:
  - Lock por cuenta. Rechaza si el plan no `permite_numeros_adicionales` (`no_permitido`). En decremento, rechaza si números activos > (incluidos + nuevo_total) (`recursos_por_encima`). Si OK, fija `numeros_adicionales`.
- (Opcional) `dulabs_dev_set_estado(p_account_id, p_estado, ...)` — usado por Fase 12; Fase 11 solo lo define.

---

## 6. API / backend
Todas las rutas: `conSesionDeveloper` + gate de rol + auditoría + errores uniformes con `request_id`. Sin checkout/Stripe.

Nuevas:
- `GET /api/developer/subscription` — cuenta, plan, estado, entitlements (nominales + efectivos), uso (números/mensajes/workspaces/miembros), y flags (`canBuyAdditionalNumbers`, `consumoBloqueado`). Roles: todos.
- `POST /api/developer/subscription/plan` — cambiar plan (OWNER). Valida downgrade (opción A) vía RPC. Errores: `downgrade_bloqueado` (409 con detalle de qué reducir).
- `POST /api/developer/subscription/additional-numbers` — fijar total de adicionales (OWNER/ADMIN, Agency/Enterprise). Errores: `not_allowed` (Developer), `resources_above` (decremento inválido). Preparado para que Fase 12 exija pago antes de aplicar.
- `POST /api/developer/workspaces` — crear workspace bajo la cuenta (OWNER/ADMIN), enforcement de `maxWorkspaces` (mínimo necesario para que el modelo de cuenta sea real). (La gestión rica de clientes/proyectos de Agency puede ampliarse en una sub-fase; ver Riesgos.)

Extensiones:
- `POST /api/developer/members` — enforcement de `maxMembers` (rechazo `member_limit_exceeded`).
- `GET /api/developer/usage` — incluir los nuevos entitlements (workspaces/miembros) sin cambiar el contrato existente (aditivo).
- `whatsapp/connect` (Fase 10) — **sin cambios de código**; el límite de números que ya resuelve ahora incluye adicionales (Agency) y respeta el hard-cap Developer.

---

## 7. Enforcement (todos server-side, vía el resolvedor único)
| Recurso | Punto | Fuente de límite |
|---|---|---|
| Números | `whatsapp/connect` → RPC `registrar_numero_con_limite` | `entitlements.maxNumbers` (Developer hard-cap 2; Agency incluidos+adicionales) |
| Mensajes | send path → RPC `reclamar_reservar_mensaje` | `entitlements.maxMessagesMonth` (efectivo si past_due/canceled) |
| Miembros | `POST /members` | `entitlements.maxMembers` |
| Workspaces | `POST /workspaces` | `entitlements.maxWorkspaces` (nivel cuenta) |
| Adicionales | `POST /subscription/additional-numbers` | `permite_numeros_adicionales` + rol + atómico |
| Estado | resolvedor | `estado != active ⇒ consumoBloqueado` |

**Developer hard-cap:** `maxNumbers = 2` siempre (permite_adicionales=false ⇒ additional=0), y el RPC rechaza el 3.º a nivel DB. Además `set_numeros_adicionales` rechaza cualquier intento en Developer.

---

## 8. Frontend (Developer Dashboard)
- Nueva vista `/developer/plan` (o extensión de `/developer/usage` + `/developer/settings`): plan actual, estado (`active`/`past_due`/`canceled`), límites vs uso (números incluidos+adicionales, mensajes, workspaces, miembros), CTA de upgrade.
- Mensajería exacta: Agency "$45/month · 5 WhatsApp numbers · 100K messages · 5 client projects · 5 team members"; Developer "$19/month · 2 WhatsApp numbers · 20K messages".
- Developer intentando 3.º número ⇒ CTA "Upgrade to Agency" (el backend ya lo rechaza; el frontend solo informa).
- Banner `past_due` con acción para resolver pago (Fase 12 lo cablea).
- Sin tocar el flujo de Embedded Signup validado.

---

## 9. Economía unitaria (preliminar)
- **Fijos:** Cloud Run min-instances (gateway/workers), Supabase base, KMS, Secret Manager, observabilidad, Vercel/dominio.
- **Variables/mensaje procesado:** Pub/Sub (in/out), cómputo Cloud Run por request, escrituras Supabase (events/jobs/usage_ledger), egress. **Tarifas de Meta = pass-through, sin markup.**
- **Variables/número:** marginal (fila + ruteo); el costo real lo generan los mensajes.
- **Datos faltantes para validar margen $19/$45:** (a) costo Cloud Run por 1.000 mensajes procesados; (b) costo Supabase de escrituras+almacenamiento+retención a 20K y 100K; (c) volumen/costo Pub/Sub por mensaje; (d) egress por mensaje; (e) ratio real requests/mensaje. Con esos 5 se valida el margen. No se cambian precios ni límites.

---

## 10. Migraciones (aditivas, a correr por el propietario; NO ejecutar en Fase 11)
1. `dulabs_dev_accounts` + RLS + índices (`owner_user_id`).
2. `dulabs_dev_workspace_plans`: `+ account_id` (nullable, FK) + índice `(account_id)`.
3. `dulabs_dev_plan_overrides` + RLS.
4. `dulabs_dev_plans`: `+ max_workspaces, + max_members, + permite_numeros_adicionales` + **UPDATE de seed** (AGENCY $45/5/100K/5/5/true; DEVELOPER 1/1/false; ENTERPRISE $199/true).
5. RPCs: `dulabs_dev_cambiar_plan`, `dulabs_dev_set_numeros_adicionales`, (`dulabs_dev_set_estado` opcional).
Todas: additive, reversibles, solo `dulabs_dev_*`, sin tocar Business/AMORE. Backfill: **ninguno obligatorio** (compat: sin cuenta = DEVELOPER); cuenta se crea al primer upgrade/gestión.

---

## 11. Archivos a modificar / crear (previsto)
Nuevos:
- `lib/developer/entitlements.ts` (tipos + resolvedor único).
- `lib/developer/accounts-store.ts` (CRUD cuenta, scoping).
- `lib/developer/subscription-store.ts` (cambiar plan, adicionales, estado; wrappers de RPC).
- `app/api/developer/subscription/route.ts` (GET).
- `app/api/developer/subscription/plan/route.ts` (POST).
- `app/api/developer/subscription/additional-numbers/route.ts` (POST).
- `app/api/developer/workspaces/route.ts` (POST + GET mínimo).
- `app/developer/plan/page.tsx` (o extensión de usage/settings).
- Componentes de plan/limite/upgrade en `components/developer/*` según necesidad.
- Migraciones `supabase/migrations/2026XXXX_dulabs_developer_v1_fase11_*.sql` (5).
- Tests (ver §12).
Modificar (extensión mínima):
- `lib/developer/plans.ts` (delegar en entitlements; conservar `resolverLimitesDelWorkspace`).
- `app/api/developer/members/route.ts` (enforcement maxMembers).
- `app/api/developer/usage/route.ts` (exponer nuevos entitlements, aditivo).
- `lib/dev-dashboard/dev-client.ts` (métodos subscription/workspaces).
- `scripts/test-flow-manifest.txt` (registrar tests nuevos).
- `docs/DULABS_DEVELOPER_V1_PHASE_11_PLANS_PRICING_DESIGN.md` (este doc).
No se toca: Fase 5 outbound, Fase 6 inbound, Embedded Signup (Fase 10), Business, AMORE.

---

## 12. Tests
- Resolvedor de entitlements: Developer/Agency/Enterprise (+overrides), ausencia de cuenta = Developer, estado→consumoBloqueado.
- Números: hard-cap Developer (2, 3.º rechazado a nivel DB), Agency 5 + adicionales, efecto de past_due.
- Mensajes: 20K/100K/NULL; past_due bloquea nuevos.
- Miembros/Workspaces: enforcement de tope; error claro al exceder.
- Upgrade/downgrade: upgrade inmediato; **downgrade bloqueado** con recursos por encima (números/workspaces/miembros), con detalle.
- Adicionales: permitido solo Agency/Enterprise; Developer rechazado; decremento inválido rechazado.
- Concurrencia: doble cambio de plan; adicional + connect de número simultáneos; race de downgrade; dos creaciones de workspace con 1 cupo libre.
- Seguridad: plan/entitlement no manipulable desde frontend; cross-tenant; rol insuficiente; header `x-dulabs-workspace` ajeno.
- Regresión: `test:flow` completo (Fases 1–10 intactas), TypeScript/ESLint/Build.

---

## 13. Seguridad y concurrencia
- Entitlements SIEMPRE server-side desde DB; frontend solo muestra.
- Cambios de plan/adicionales/estado: OWNER (o ADMIN donde aplique), auditados, atómicos (advisory lock por cuenta).
- Multi-tenant: scoping workspace→cuenta; RLS activo; nunca resolver por un id del request.
- Sin bypass: los RPCs reciben el límite resuelto server-side; el 3.º de Developer imposible a nivel DB.
- Downgrade race, adicionales race, workspace/member race: cubiertos por locks.

---

## 14. Criterios de aceptación
1. Un solo resolvedor de entitlements; cero reglas de plan duplicadas.
2. Developer hard-cap 2 números imposible de exceder a nivel DB.
3. Agency: adicionales contabilizados/aplicados atómicamente; +$5 como metadato listo para Fase 12.
4. Enterprise: overrides por cuenta; NULL = base; sin cifras inventadas.
5. Enforcement server-side de números/mensajes/miembros/workspaces.
6. Downgrade bloqueado si hay recursos por encima (opción A); sin huérfanos.
7. Estados active/past_due/canceled modelados; past_due bloquea consumo nuevo; transiciones de pago listas para Fase 12.
8. Frontend comunica los planes y CTA de upgrade; enforcement real en backend.
9. Fase 7 compatible; Fases 1–10, Business y AMORE intactos.
10. TypeScript/ESLint/Build/test:flow PASS.

---

## 15. Riesgos
- **Modelo de cuenta:** refactor de resolución (mitigado por resolvedor único + compat workspace-sin-cuenta=Developer).
- **Gestión rica de clientes/proyectos (Agency):** el CRUD/UI completo de multi-workspace puede exceder Fase 11; se incluye lo mínimo (crear workspace + enforcement) y se marca la UI rica como posible sub-fase.
- **Seed drift ($59→$45):** UPDATE idempotente, sin romper workspaces existentes.
- **Enforcement de past_due vía resolvedor:** cambia el valor de límite que consumen rutas de Fase 5/10 sin tocar su código; requiere test explícito de que no rompe el happy-path activo.
- **Coordinación con Fase 12:** dejar ganchos de estado sin acoplar a Stripe.

---

## 16. Decisiones ya cerradas (no requieren nueva aprobación)
Modelo de cuenta, precios/límites, downgrade opción A, sin trial, past_due bloquea consumo, Enterprise por overrides, resolvedor único, reutilización Fase 7, no tocar fases cerradas. (Aprobadas por el propietario.)

Pendiente de tu revisión: **esta especificación de implementación**. No se implementa código hasta tu OK.
