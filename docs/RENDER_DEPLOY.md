# DuLabs en Render (despliegue temporal)

Este documento describe cómo se despliega **el mismo DuLabs** (no una versión simplificada) en Render mientras Vercel no está disponible. Conecta al **Supabase original**
(`eobppllxqzlrymagtumi`, región Oregon / us-west-2) y **no cambia dominio, DNS, tablas, usuarios, Storage ni productos**. Blueprint: `render.yaml` (rama `deploy/render`).

## 1. Lo que se midió (no es una suposición)

Compilación y arranque de producción reales sobre este repositorio (Node 24, sin ninguna variable de entorno real):

| Medida | Resultado | Límite de Render |
|---|---|---|
| `npm ci` limpio | 627 paquetes, 160 s, código 0 | — |
| `next build` | **193 s**, pico de memoria **≈ 3 GB** (7 procesos) | build: 8 GB de RAM y 120 min (Starter pipeline) |
| `next start` (arranque) | respondió a los 4 s | — |
| Memoria en reposo / tras recorrer 24 rutas | **166 MB / 174 MB** | plan Free: 512 MB de RAM, **0,1 CPU** |

Con memoria cabe holgado; el riesgo del plan gratis es la CPU (0,1 CPU: las páginas con servidor se renderizan más lento) y las condiciones de la sección 2.

## 2. Condiciones del plan Free de Render (documentación oficial)

- Render dice de los servicios gratuitos: «No los uses para aplicaciones en producción». Sirven para pruebas y para una **contingencia corta**.
- **Se apaga a los 15 min sin visitas** y volver a arrancar tarda ~1 min (la página muestra «cargando»).
- **750 horas gratis al mes para TODO el espacio de trabajo** (no por servicio). Este espacio ya tiene `du-site`: dos servicios encendidos 24/7 pasan de 750 h y Render **suspende todos los servicios gratis** hasta el mes siguiente. Por eso no se debe mantener despierto 24/7 (ver sección 6).
- 500 minutos de pipeline al mes en el plan Hobby; pasados esos minutos Render **cobra** (hay tarjeta registrada) salvo que se fije un tope de gasto en Billing → «Manage spend on pipeline minutes». `autoDeployTrigger: "off"` evita builds por cada commit.
- Sin discos persistentes; reinicios aleatorios; puede suspenderse un servicio con tráfico saliente muy alto.
- Pasar a `Starter` (US$7/mes, 0,5 CPU, sin apagarse) **requiere tu autorización**: no se activa nada de pago desde este repositorio.

## 3. Variables de entorno (solo nombres; los valores los pegas tú en Render)

Esenciales — el Blueprint las pide al crear el servicio (`sync: false`):

| Variable | Para qué | Cuándo se usa |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | inicio de sesión y Storage desde el navegador | **al compilar** (se incrustan en el código del navegador) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | todas las rutas API (catálogo, panel, tienda) | al ejecutar |
| `NEXT_PUBLIC_SITE_URL` | enlaces de correos y compartidos | **al compilar** |

Para entrar y administrar el catálogo no hace falta nada más. El resto de la aplicación lee otras variables (WhatsApp/Meta, Wompi, IA, cifrado de tokens, `CRON_SECRET`…): están todas
con sus nombres en `.env.example`; se agregan después desde el servicio → Environment → «Add from .env». Sin `TOKEN_ENCRYPTION_KEY` el build avisa («falta configuración») pero **no se bloquea**
(el guard de release solo bloquea con `VERCEL_ENV=production`).

## 4. Crear el servicio

1. Render → **New → Blueprint** → repositorio `vandusfor-code/Dulabs` → rama **`deploy/render`**.
2. Revisar que el plan sea **Free** y la región **Oregon**; pegar los valores de las 5 variables (los mismos que hoy en Vercel / `.env.local`).
3. **Apply**. El primer despliegue compila (~3–8 min) y arranca.
4. Si `NEXT_PUBLIC_SITE_URL` cambia, o cualquier `NEXT_PUBLIC_*`: **Manual Deploy → Clear build cache & deploy**.

## 5. Comprobaciones después de desplegar

Separadas en **A (la aplicación está publicada)** y **B (depende de que Supabase y los datos respondan)**:

- A1. `GET /api/health` → 200 `{"ok":true,"servicio":"dulabs",…}` (también acepta `POST`, para pings).
- A2. `/`, `/login`, `/precios`, `/developers` → 200; `/dashboard` redirige a `/login` sin sesión.
- A3. Rutas protegidas sin sesión → 401 (`/api/dashboard/me`, `/api/dashboard/catalogo/productos`).
- B1. `GET /api/health?deep=1` → 200 con `auth.estado: "ok"`; si Supabase no responde contesta **503** con el motivo (`dns`, `http-402`, `http-5xx`…): el inicio de sesión **no debe darse por bueno** en ese caso.
- B2. Inicio de sesión con un usuario real de Delacour (lo hace una persona con su clave) y que el panel cargue su negocio.
- B3. Catálogo: lista de productos con su cantidad real, fotos visibles, categorías, precios detal/mayor, tienda pública `/catalogo/delacour`.
- B4. Crear un producto y subir una foto: **modifica datos reales** (la referencia `DL-00xxxx` que se asigna es definitiva); hacerlo solo con autorización y con un producto de prueba claramente marcado que luego se **desactiva** (nunca se borra).

## 6. Mantenerlo despierto (opcional)

Un ping de QStash a `POST /api/health` cada 10 min mantiene la instancia encendida **solo en horario laboral** (p. ej. 8:00–20:00 Colombia ≈ 360 h/mes). No programar 24/7: se pasaría de las 750 h compartidas con `du-site`.

## 7. Qué NO funciona en este despliegue (y por qué)

- **Webhooks** de Meta/WhatsApp, Wompi y GitHub: sus URLs apuntan a `dulabs.co` (Vercel, bloqueado). No se tocaron. El bot y las automatizaciones **no** atienden desde Render.
- **Crons**: los 8 crons de `vercel.json` y los endpoints que dispara QStash apuntan a `dulabs.co`. Render no los ejecuta (los Cron Jobs de Render son de pago).
- **Correos de recuperación de contraseña**: llevan `NEXT_PUBLIC_SITE_URL`; si apunta a `dulabs.co` el enlace no abre hasta que ese dominio vuelva.
- Servicios independientes (`worker/` en Railway, `services/` en Cloud Run): no forman parte de este despliegue.

## 8. Hallazgo para decidir aparte (no se modificó la autenticación)

`POST /api/auth/login` trata **cualquier** error de Supabase Auth como «credenciales inválidas»: con Supabase sin responder devuelve 401 con «el correo o la contraseña no son correctos» y cuenta
intentos fallidos (puede bloquear 15 min a una persona por una falla de infraestructura). Medido en este despliegue local: con Supabase inalcanzable devolvió **401**. Propuesta: distinguir error
de servicio (→ 503, sin contar intento) de credencial inválida (→ 401). Requiere tu autorización porque toca la ruta de autenticación.

## 9. Apagar / volver atrás

Render → servicio → **Suspend** (no borra nada). Para volver a Vercel basta con restablecer el plan allí; este despliegue no cambió ningún DNS ni dato.
