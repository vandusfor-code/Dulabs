# DuLabs Developer V1 — Fase 15: Landing comercial DuLabs Developer (cierre)

**Fecha:** 2026-09-17
**Rama:** `feature/developer-v1-fase15-landing` (apilada sobre Fase 14 en `f3496f4`; `main` intacto en `65cb842`)
**Estado:** ✅ Completa. Sin push / merge / deploy.

---

## 1. Bloques implementados

| Bloque | Descripción | Commit |
|---|---|---|
| 15.2 | Endpoint público read-only `GET /api/developers/plans` | `84f2838` |
| 15.4 | Sección de pricing pública (toggle mensual/anual) | `a6de8b8` |
| 15.3 / 15.5 | Landing comercial `/developer-platform` + CTAs/onboarding | `286d003` |
| 15.6 | SEO (sitemap/robots) + navegación (Nav/Footer aditivos) | `a5ef965` |
| — | Fix gramática ES/EN de límites en pricing | `f81013e` |
| 15.8 | Tests de landing, pricing y SEO | `11368a0` |

Las tres superficies quedan **diferenciadas**: `/developer-platform` (landing pública),
`/developers` (docs, Fase 14, sin cambios de propósito), `/developer` (dashboard privado).

Flujo principal: Landing → «Comenzar» / «Get API Key» → `/login?next=/developer` → dashboard.
CTA de docs: Landing → `/developers`.

---

## 2. Archivos

**Creados**
- `lib/developers/planes-publicos.ts` — proyección pública del catálogo (anual x10 vía `MESES_COBRADOS`, manual vía `esPlanManual`).
- `app/api/developers/plans/route.ts` — endpoint público read-only, cacheable (ISR 5 min), fail-safe.
- `app/developer-platform/page.tsx` — página (server): metadata + JSON-LD + ensamblado.
- `components/developer-platform/`: `constants.ts`, `DevNav.tsx`, `DevHero.tsx`, `DevSections.tsx` (plataforma, API-first, webhooks, observabilidad, seguridad, docs), `DevPricing.tsx`, `DevFaqCta.tsx`.
- Tests: `lib/developers/planes-publicos.test.ts`, `lib/developers/landing-fase15.test.ts`, `app/api/developers/plans/fase15-plans.e2e.test.ts`.

**Modificados**
- `lib/schema.ts` — `softwareApplicationSchema` (SEO, sin precios).
- `app/robots.ts` — protege `/developer$` y `/developer/` (NO bloquea landing ni docs).
- `app/sitemap.ts` — agrega `/developer-platform` (nunca `/developer`).
- `components/site/Nav.tsx` — enlace «Developers» aditivo.
- `components/site/Sections.tsx` — columna «Developers» en el footer (grid 5→6).
- `scripts/test-flow-manifest.txt` — +3 tests de Fase 15.

---

## 3. Tests — PASS/FAIL

**Fase 15 (nuevos)** — **23/23 PASS**
- `planes-publicos.test.ts` (unit puro): anual x10, eq. mensual, Enterprise manual, checkout, sin precio→null, sin fugas de campos.
- `landing-fase15.test.ts` (estático): 3 superficies diferenciadas, CTAs (`/login?next=/developer`, `/developers`), sin enlace directo al dashboard privado, solo placeholders de API key, bilingüe ES/EN, sitemap incluye landing y NO el dashboard, robots protege el dashboard sin atrapar landing/docs, Business intacto (Nav/Footer aditivos).
- `fase15-plans.e2e.test.ts` (e2e real): pricing público == `dulabs_dev_plans`, anual x10, orden por precio, Enterprise manual, Developer con checkout, respuesta sin secretos, cache pública.

**Verificación en navegador** (dev server): landing renderiza; `GET /api/developers/plans` → 200; 3 tarjetas ($19/$45/$199); toggle anual ($15.83/$37.50/$165.83, facturado $190/$450/$1990); ES/EN OK; CTAs con hrefs correctos. (Los warnings de consola son `eval()`/CSP de React en modo dev del panel, no del producto.)

---

## 4. Regresión Fases 11–14 — PASS

- **Fase 11:** E2E 16/16 ✓
- **Fase 12:** unit 9/9 ✓ · billing ON 10/10 ✓
- **Fase 13:** unit 4/4 ✓ · e2e 6/6 ✓
- **Fase 14:** 7/7 ✓
- **TypeScript** `tsc --noEmit`: 0 errores ✓
- **ESLint**: 0 errores ✓
- **Build** `npm run build`: PASS ✓ (`/developer-platform` estático, `/api/developers/plans` ISR 5 min)

---

## 5. Seguridad

- El endpoint `/api/developers/plans` es **estrictamente read-only**: no acepta ningún input del
  cliente (ni `accountId`, ni precios, ni moneda), solo lee el catálogo y proyecta campos
  comerciales seguros. Test verifica que la respuesta no contiene `service_role`, `account_id`,
  `wompi`, `token`, `secret`, `payment_source`, `fx_rate`, `customer_id`.
- La landing es pública y **no** expone claves/secretos/datos de usuarios; los ejemplos de
  código usan solo placeholders (`dl_live_your_api_key`).
- El dashboard privado `/developer` queda protegido en `robots.ts` (`/developer$`, `/developer/`)
  sin bloquear `/developer-platform` ni `/developers`.
- No se tocó billing (Fase 12) ni el flag `DEVELOPER_BILLING_ENABLED`; no hay checkout en la
  landing ni dependencia de Wompi.
- Aislamiento Developer / Business / AMORE respetado: la landing tiene su propio nav; los
  cambios al Nav/Footer de Business son aditivos y no rompen el sitio (regresión verificada).

---

## 6. Pricing

- **Fuente única:** `dulabs_dev_plans` + lógica de Fase 12 (anual = mensual x10). No se
  hardcodean cifras como autoridad ni se creó una segunda fuente.
- Catálogo verificado contra DB: Developer $19 (20.000 msgs, 2 números, 1 ws/1 miembro),
  Agency $45 (100.000, 5 números, +$5/número, 5 ws/5 miembros), Enterprise $199 (ilimitado,
  ventas). Anual: $190 / $450 / $1.990 (2 meses gratis).
- Enterprise → «Contactar ventas» vía `NEXT_PUBLIC_DEVELOPER_SALES_EMAIL` (fallback
  `contacto@dulabs.co` si la env no existe).

---

## 7. SEO

- `metadata` (title/description/canonical/OpenGraph/Twitter) + JSON-LD (`breadcrumb` +
  `SoftwareApplication` sin precios) en `/developer-platform`.
- `sitemap.xml` incluye `/developer-platform`; excluye `/developer`.
- `robots.txt` protege el dashboard privado; permite landing y docs.

---

## 8. Riesgos restantes

1. **Dominio del gateway:** los ejemplos usan `https://api.dulabs.dev/api/v1` (mismo que
   Fase 14). Confirmar el dominio real del gateway en el deploy.
2. **`/api/developers/plans` se prerenderiza en build (ISR):** requiere que el entorno de build
   tenga acceso a Supabase para hornear el catálogo (se revalida cada 5 min). Si el build no
   tuviera DB, la primera respuesta sería el fail-safe (lista vacía) hasta la primera
   revalidación. No bloquea; a tener en cuenta en CI/deploy.
3. **Copy de plan cards:** pluralización simple ("1 workspaces") no se resolvió por idioma
   (bajo impacto, estilo típico de tarjetas SaaS).
4. **`robots` con `$`:** `/developer$` usa la extensión de wildcards (Google/Bing la respetan;
   otros crawlers la ignoran de forma inocua). El dashboard igual redirige a login por auth.

---

## 9. Dependencias externas

- Supabase (`dulabs_dev_plans`, Fase 7/11) para el catálogo.
- i18n existente (`@/lib/i18n`, `LangProvider` en el root layout).
- Componentes reutilizados de Business (`Reveal`, `PageSpotlight`, `JsonLd`, `Footer`) y de
  Fase 14 (`CodeSample`).
- `NEXT_PUBLIC_DEVELOPER_SALES_EMAIL` (opcional; hay fallback).

---

## 10. Git

Rama `feature/developer-v1-fase15-landing` (sobre `f3496f4`, Fase 14). Commits:

```
11368a0 test(developer-platform): Fase 15.8 — tests de landing, pricing y SEO
f81013e fix(developer-platform): gramática ES/EN de límites ilimitados en pricing
a5ef965 feat(developer-platform): Fase 15.6 — SEO y navegación
286d003 feat(developer-platform): Fase 15.3 — landing comercial /developer-platform
a6de8b8 feat(developer-platform): Fase 15.4 — pricing público con toggle mensual/anual
84f2838 feat(developers): Fase 15.2 — endpoint público read-only de planes
```

Working tree limpio salvo `supabase/.temp/` (untracked, ajeno a la fase). Sin push/merge/deploy.

---

## 11. Pendientes reales para Fase 16

- Confirmar dominio real del gateway y validar `/api/developers/plans` en el pipeline de deploy.
- Decidir si se abre PR/merge de la pila 12→13→14→15 a `main` (hasta ahora todo local).
- Posibles siguientes: SDK (JS/Python), «Try It» interactivo, casos de uso/logos, blog/recursos
  Developer, OG image dedicada, y activar billing (`DEVELOPER_BILLING_ENABLED`) para cerrar el
  flujo self-service extremo a extremo.
