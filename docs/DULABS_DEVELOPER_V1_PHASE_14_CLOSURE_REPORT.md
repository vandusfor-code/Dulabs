# DuLabs Developer V1 — Fase 14: API Docs + Developer Portal (cierre)

**Fecha:** 2026-09-17
**Rama:** `feature/developer-v1-fase13-events` (Fase 14 apilada sobre 12→13; `main` intacto en `65cb842`)
**Estado:** ✅ Completa. Sin push / merge / deploy.

---

## 1. Alcance y decisiones (recordatorio)

- **D1** Portal público en `/developers` **sin login** (no infra extra).
- **D2** Base URL `https://api.dulabs.dev/api/v1`. Verificado en repo: el dominio aparece
  **solo** en la UI ya publicada (`app/developer/api/page.tsx`), no en config del repo (es
  dominio de gateway a nivel infra/deploy). No hay dominio en conflicto → **no es
  discrepancia**. Queda como config de infra a confirmar en el deploy real.
- **D3** SDK **fuera** de alcance (no se construyó).
- **D4** OpenAPI **versionado en el repo** como fuente única de la documentación; el código
  del gateway sigue siendo fuente de verdad del comportamiento. Render propio y ligero (sin
  dependencias externas).
- **D5** Ejemplos en **cURL + JavaScript/TS** (Python diferido). "Try it" fuera de alcance.

**Reglas respetadas:** no se reconstruyó ni modificó el API; no se inventaron
endpoints/params/respuestas/códigos/headers (todo derivado de los handlers reales del
gateway); **no** se documenta `/api/v1/dev/*`, callbacks internas de Meta ni endpoints
internos; nunca se exponen secretos (solo placeholders); Developer aislado de
Business/AMORE; aislamiento por tenant intacto; cada bloque con sus tests; regresión de
Fases 11–13 ejecutada; commits locales por bloque.

---

## 2. Bloques completados

| Bloque | Descripción | Estado |
|---|---|---|
| 14.1 | OpenAPI 3.1 del API público + test de conformidad + ruta pública `/api/developers/openapi` | ✅ (commit `b70c94b`) |
| 14.5 | Docs de errores, idempotencia/rate limits y firma de webhooks | ✅ (`8240d42`) |
| 14.4 | Componente de code samples (cURL + JS/TS) con copiar | ✅ (`dc43130`) |
| 14.2 | API Reference renderizada desde el OpenAPI | ✅ (`667f87c`) |
| 14.3 | Portal público `/developers` (shell, nav, quickstart, guías) + enlace desde el dashboard | ✅ (`2bef255`) |
| 14.8 | Seguridad/tests del portal + manifiesto + regresión + cierre | ✅ (`5c5f270`) |

Orden de ejecución cumplido: 14.1 → 14.5 → 14.4 → 14.2 → 14.3 → 14.8.

---

## 3. Tests — PASS/FAIL

**Fase 14 (nuevos)**
- `lib/developers/openapi.conformidad.test.ts` + `lib/developers/portal.test.ts` → **7/7 PASS**
  - Conformidad: cada ruta del spec existe en el routing real del gateway; no se documenta
    `/dev/` ni `webhooks/meta`; el enum de códigos de error == catálogo de `errors.ts`;
    `paths` del spec == `RUTAS_PUBLICAS`.
  - Portal: sin enlaces muertos en la nav; solo placeholders de API key
    (`dl_live_tu_api_key` / `dl_live_your_api_key`); ningún archivo referencia superficie interna.
- Ambos añadidos a `scripts/test-flow-manifest.txt`.

**Regresión Fases 11–13**
- Fase 12 unit (`billing-unit`) + Fase 13 unit (`events-fase13`) → **13/13 PASS**.
- Fase 11 E2E (`fase11-plans`) + Fase 12 E2E billing ON (`fase12-billing`) + Fase 13 E2E
  (`fase13-events`) → **32/32 PASS** (16 + 10 + 6).

**Calidad global**
- `tsc --noEmit` → **0 errores**.
- ESLint (archivos tocados) → **0 errores**.
- `npm run build` → **PASS** (compiló en ~53s). Las 7 páginas `/developers/*` como estáticas
  (○) y `/api/developers/openapi` como dinámica (ƒ).

---

## 4. Archivos principales

**OpenAPI (fuente única de docs)**
- `lib/developers/openapi.ts` — spec 3.1, `OPENAPI_BASE_URL`, `RUTAS_PUBLICAS`, `OPENAPI_DEVELOPER_V1`.
- `app/api/developers/openapi/route.ts` — sirve el spec (público, `Cache-Control` 5 min).
- `lib/developers/openapi.conformidad.test.ts` — anti-drift spec↔gateway.

**Portal público (`/developers`)**
- `app/developers/layout.tsx` — shell público (header + sidebar), sin auth.
- `app/developers/page.tsx` — quickstart.
- `app/developers/authentication/page.tsx` — API keys / Bearer / GET /me.
- `app/developers/messages/page.tsx` — envío + estados (POST /messages, GET /messages/{id}).
- `app/developers/webhooks/page.tsx` — eventos, entrega/reintentos/DLQ/dedup, firma HMAC.
- `app/developers/rate-limits/page.tsx` — idempotencia + límites + headers.
- `app/developers/errors/page.tsx` — catálogo de errores + sobre de error.
- `app/developers/reference/page.tsx` — API Reference.

**Componentes**
- `components/developers/DocsSidebar.tsx` — nav (`DOCS_NAV`) con estado activo.
- `components/developers/CodeSample.tsx` — tabs cURL/JS + copiar.
- `components/developers/OpenApiReference.tsx` — render del OpenAPI.

**Tests / otros**
- `lib/developers/portal.test.ts` — seguridad del portal.
- `scripts/test-flow-manifest.txt` — +2 líneas (tests Fase 14).
- `app/developer/api/page.tsx` — el bloque "Full documentation" ahora enlaza a `/developers`.

---

## 5. Riesgos reales restantes

1. **Dominio del gateway (D2):** `api.dulabs.dev` es config de infra/deploy, no del repo.
   Confirmar en el deploy real que ese es el dominio del gateway público antes de publicar
   el portal externamente. (No bloquea Fase 14; sí es un check de release.)
2. **Portal sin auth es superficie pública nueva:** hoy solo son páginas estáticas + una ruta
   GET del spec (sin datos ni secretos). Si en el futuro se agrega "Try it" o cualquier
   endpoint con estado bajo `/api/developers/*`, requerirá su propio hardening (rate limit,
   CORS, auth). Fuera de alcance actual, pero a tener presente.
3. **Anti-drift cubre estructura, no prosa:** el test de conformidad garantiza que rutas y
   códigos de error del spec coincidan con el gateway, pero las descripciones/ejemplos en
   prosa de las guías se mantienen a mano. Cambios de contrato en el gateway deben
   reflejarse en `openapi.ts` (el test avisa si una ruta/código se desalinea).

---

## 6. Commits locales (Fase 14)

```
5c5f270 test(developers): Fase 14.8 — tests del portal (enlaces vivos, solo placeholders, sin superficie interna)
2bef255 feat(developers): Fase 14.3 — portal público /developers (shell, nav, quickstart y guías)
667f87c feat(developers): Fase 14.2 — API Reference renderizada desde el OpenAPI
8240d42 feat(developers): Fase 14.5 — docs de errores, rate limits/idempotencia y firma de webhooks
dc43130 feat(developers): Fase 14.4 — componente CodeSample (cURL + JS/TS)
b70c94b feat(developers): Fase 14.1 — OpenAPI 3.1 del API público + test de conformidad
```

Working tree limpio salvo `supabase/.temp/` (untracked, no es de esta fase).

---

## 7. Qué se necesita para Fase 15

- Confirmar el dominio real del gateway (D2) como paso de release del portal.
- Decidir si Fase 15 abre PR/merge de la pila 12→13→14 a `main` (hasta ahora todo local).
- Definir alcance de Fase 15 (p. ej. SDK — diferido en D3 —, "Try it" interactivo, o Python
  en los ejemplos). Si toca `/api/developers/*` con estado, planear hardening dedicado.
