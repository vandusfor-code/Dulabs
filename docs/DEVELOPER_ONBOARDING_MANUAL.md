# DuLabs Developer — Onboarding: pasos MANUAL_REQUIRED

Acciones que **solo el propietario** puede ejecutar (fuera del código) para que el flujo
`registro → confirmación → provisión → bienvenida` funcione en producción. Todo el código
ya está en la rama `feature/developer-registro-provision`.

---

## 1. Migración de provisión (OBLIGATORIA)

Sin esto, `POST /api/developer/onboarding/provision` falla (RPC inexistente) y el usuario
nuevo queda sin workspace.

Aplicar en **Supabase → SQL Editor** el contenido de:

```
supabase/migrations/20261017000000_dulabs_developer_v1_provisionar_onboarding.sql
```

Crea el RPC `dulabs_dev_provisionar_onboarding(uuid)` (SECURITY DEFINER, grant a
`service_role`). Es **aditivo y reversible** (`drop function public.dulabs_dev_provisionar_onboarding(uuid);`).
No toca datos ni Business/AMORE.

Verificación rápida (SQL Editor):
```sql
select proname from pg_proc where proname = 'dulabs_dev_provisionar_onboarding';
```

---

## 2. Supabase Auth — Site URL y Redirect URLs

**Auth → URL Configuration:**
- **Site URL:** `https://www.dulabs.co`
- **Redirect URLs** (añadir): `https://www.dulabs.co/login`, `https://www.dulabs.co/**`

Esto hace que el `emailRedirectTo` de producción sea aceptado y el enlace de confirmación
NUNCA vaya a `localhost`.

---

## 3. Correo de confirmación con marca DuLabs

Por defecto Supabase manda un correo genérico ("Confirm your email address"). Para que sea
DuLabs, pegar esta plantilla en **Auth → Email Templates → "Confirm signup"**.

**Subject:** `Confirma tu cuenta de DuLabs Developer`

**Message body (HTML):**
```html
<div style="background:#0b0b0f;padding:32px 12px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#141419;border-radius:16px;border:1px solid #23232b;overflow:hidden;">
      <tr><td style="padding:28px 32px 8px;">
        <img src="https://www.dulabs.co/logo.png" width="36" height="36" alt="DuLabs" style="display:block;border-radius:8px;">
        <div style="font-weight:600;font-size:12px;letter-spacing:2px;color:#6366f1;margin-top:10px;text-transform:uppercase;">DuLabs Developers</div>
      </td></tr>
      <tr><td style="padding:16px 32px 0;">
        <h1 style="margin:0;font-size:22px;color:#e7e7ea;">Confirma tu correo</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#a1a1aa;">
          Estás a un paso de activar tu cuenta de DuLabs Developer. Confirma tu correo para entrar a tu workspace y empezar a construir.
        </p>
      </td></tr>
      <tr><td style="padding:24px 32px 32px;">
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#ffffff;color:#0b0b0f;font-weight:600;font-size:14px;text-decoration:none;padding:13px 22px;border-radius:10px;">Confirmar mi correo</a>
        <p style="margin:16px 0 0;font-size:12px;color:#6b6b74;">Si no creaste esta cuenta, ignora este mensaje.</p>
      </td></tr>
    </table>
  </td></tr></table>
</div>
```

> Nota: la personalización completa (dominio remitente propio, DKIM) requiere **SMTP
> personalizado** en Supabase (Auth → SMTP Settings) apuntando a Resend/tu proveedor. Con el
> SMTP por defecto de Supabase el correo sale con branding DuLabs en el cuerpo pero desde el
> dominio de Supabase. Para remitente `@dulabs.co`, configurar SMTP propio (MANUAL).

---

## 4. Email de bienvenida y de pago (Resend)

Ambos correos usan el proveedor existente `lib/dunning/email-provider` (Resend).

> **Hallazgo (2026-09-17):** `RESEND_API_KEY` **NO está** en Vercel Production. Sin ella, los
> correos de bienvenida y de pago no se envían (el registro y la activación NO fallan).

Acción: en Vercel Production añadir:
- `RESEND_API_KEY` = tu API key de Resend (dominio `dulabs.co` verificado en Resend).
- Opcional: `DUNNING_EMAIL_FROM` (por defecto `DuLabs <facturacion@dulabs.co>`).

Verificar: `vercel env ls production | grep RESEND`.

---

## 5. Prueba controlada de la bienvenida WhatsApp (bienvenida_2)

El envío real usa el número oficial DuLabs `3148127388` (phone_number_id
`696346603563682`, WABA `1399061204706262`), su token cifrado de
`dulabs_clientes_config.meta_permanent_token` (vía `resolverTokenMeta`), y la plantilla
aprobada `bienvenida_2` (es_CO). El código lee la estructura real de la plantilla antes de
enviar (no asume variables).

**No se puede probar localmente** (el token es Sensitive en Vercel). Procedimiento tras
desplegar la rama + aplicar la migración:
1. Registrar un usuario de prueba controlado en `/developer-platform/registro` con un
   **WhatsApp de prueba tuyo** como destino.
2. Confirmar el correo.
3. Entrar al dashboard (dispara la provisión → bienvenida email + WhatsApp una sola vez).
4. Verificar en logs de Vercel: `[developer/welcome] ... whatsapp=ok` y el `wamid` retornado.
5. Confirmar recepción en el WhatsApp de prueba.
6. Limpiar el usuario/workspace de prueba si aplica.

Si `bienvenida_2` tuviera 0 variables (nombre fijo) o >1, el código aborta con motivo claro
(`plantilla_variables_inesperadas`) sin mandar un payload inválido — en ese caso ajustar la
plantilla en Meta o el mapeo de variables.

---

## 6. Confirmación de pago (Wompi → email + WhatsApp)

Al confirmarse un pago (webhook Wompi, transición a APPROVED) se dispara la confirmación una
sola vez, no bloqueante:
- **Email:** branded, vía Resend (requiere `RESEND_API_KEY`, ya cubierto en paso 4). Funciona sin config extra.
- **WhatsApp:** GATED. No existe todavía una plantilla Meta aprobada de confirmación de pago.
  - **MANUAL_REQUIRED:** crear y aprobar en Meta una plantilla de confirmación de pago (Utility,
    es_CO) con **2 variables de cuerpo**: `{{1}}` = nombre, `{{2}}` = plan. Ej.:
    *"Hola {{1}}, tu plan {{2}} de DuLabs ya está activo. ¡Gracias!"*
  - Luego setear en Vercel Production: `DEV_PAYMENT_TEMPLATE_NAME` = nombre de la plantilla
    (y opcional `DEV_PAYMENT_TEMPLATE_LANG`, por defecto `es_CO`).
  - El código lee la estructura real de la plantilla y valida que el nº de variables coincida
    antes de enviar; si no coincide o no está aprobada, omite el envío con un motivo claro (no
    manda un payload inválido). Sin la env, el WhatsApp de pago simplemente no se envía (el pago
    y la activación NO se afectan).

## 7. Verificación E2E (para pasar de CODE_READY a VERIFIED)

Ya desplegado y verificado en vivo (sin acción tuya): `/developer-platform/registro` = 200,
`POST /api/developer/onboarding/provision` = 401 sin sesión (gate OK), CTA de la landing →
registro. Falta la verificación que toca la BD / envía mensajes, que requiere tus credenciales.

**7.1 Provisión (después de aplicar la migración del paso 1).** Verifica cuenta+workspace+
membership OWNER + idempotencia contra la BD real, con limpieza automática. No envía mensajes:
```bash
SUPABASE_URL=https://<proyecto>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role> \
  node scripts/verify-onboarding-e2e.mjs
```
Esperado: `RESULTADO: N PASS, 0 FAIL`.

**7.2 WhatsApp de bienvenida (envía un mensaje REAL a un número TUYO de prueba).** Reutiliza el
código real (número oficial DuLabs + token de `dulabs_clientes_config` + `bienvenida_2`):
```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TOKEN_ENCRYPTION_KEY=... \
  node --import tsx scripts/verify-bienvenida-whatsapp.mts +57XXXXXXXXXX "Juan"
```
Esperado: `PASS  Meta aceptó el mensaje. wamid=...` y recepción en el WhatsApp de prueba. Si sale
`FAIL motivo=variables_no_coinciden`, ajustar el nº de variables de `bienvenida_2` en Meta o el
mapeo (el código NO manda payloads inválidos).

**7.3 Email (tras añadir `RESEND_API_KEY`).** Regístrate en `/developer-platform/registro` con un
correo tuyo, confirma, entra al dashboard: deben llegar el correo de bienvenida y (tras pagar) el
de pago. Verificable también en los logs de Vercel: `[developer/welcome] ... email=ok`.

**7.4 Pago Wompi (sandbox).** Con el checkout en modo sandbox, completa un pago de prueba y
verifica en logs `[dev-billing-webhook] ... processed` + suscripción activa en el dashboard. No
ejecutes un cobro real.

## Estado

| Paso | Tipo | Estado |
|---|---|---|
| RPC provisión (migración) | Código | CODE_READY — falta aplicar SQL (paso 1) |
| Registro completo | Código | VERIFIED (render + validación) |
| Redirect producción | Código | CODE_READY — falta config Auth (paso 2) |
| Correo confirmación branded | Config | MANUAL (paso 3) |
| Email bienvenida | Código | CODE_READY — requiere RESEND_API_KEY (paso 4) |
| WhatsApp bienvenida | Código | CODE_READY — prueba controlada en runtime (paso 5) |
| Wompi checkout→webhook→activación | Código | CODE_READY (firma, idempotencia, activación por webhook ya sólidas) |
| Email confirmación de pago | Código | CODE_READY — requiere RESEND_API_KEY |
| WhatsApp confirmación de pago | Config | MANUAL — falta plantilla Meta + DEV_PAYMENT_TEMPLATE_NAME (paso 6) |
