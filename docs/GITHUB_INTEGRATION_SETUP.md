# GitHub Integration — Setup (Fase 1)

Esta guía agrupa **todo lo que hay que configurar por fuera del repositorio** para
que la integración "Conectar GitHub" de DuLabs Developers funcione. El código ya
está implementado; lo de abajo son las acciones manuales (GitHub + Vercel) que
solo puede hacer el dueño de la cuenta.

> Alcance Fase 1 (deliberado): `workspace → instalación de la GitHub App → repositorio seleccionado`.
> DuLabs **no** lee, clona ni modifica el código; **no** hace commits ni PRs; **no**
> ejecuta nada del repo. Solo vincula el repositorio del desarrollador con su
> workspace para posicionar la infraestructura oficial de WhatsApp de DuLabs.

---

## 1. Crear la GitHub App (una sola vez)

GitHub → **Settings** de tu cuenta u organización → **Developer settings** →
**GitHub Apps** → **New GitHub App**.

Configura **exactamente** estos campos:

| Campo | Valor |
|---|---|
| **GitHub App name** | `DuLabs Developers` (o el que prefieras; el *slug* sale de aquí) |
| **Homepage URL** | `https://www.dulabs.co/developers` |
| **Callback URL** | `https://www.dulabs.co/api/developer/github/callback` |
| **Setup URL** (Post installation) | `https://www.dulabs.co/api/developer/github/callback` |
| ☑ **Redirect on update** | activado (para que reinstalar/ajustar repos vuelva al callback) |
| **Webhook → Active** | ☑ activado |
| **Webhook URL** | `https://www.dulabs.co/api/github/webhook` |
| **Webhook secret** | genera uno fuerte (guárdalo → `GITHUB_WEBHOOK_SECRET`) |

> Reemplaza `https://www.dulabs.co` por el dominio real del entorno si es distinto
> (debe coincidir con `NEXT_PUBLIC_SITE_URL`). Para probar en un preview de
> Vercel puedes crear una App aparte apuntando al dominio del preview.
>
> **Importante (host canónico):** usa el MISMO host (`www.dulabs.co`) en las cuatro
> URLs y como dominio canónico. El código construye la redirección del callback de
> forma relativa al host de la request, así que funciona con o sin `www`; pero si
> `www.dulabs.co` hace un **redirect 301 a otro host** (p. ej. a `dulabs.co`), el
> **POST del webhook perdería el cuerpo y la firma** y el callback perdería el
> query. Verifica que `www.dulabs.co` sirva directo (sin redirect cross-host) en
> `/api/github/webhook` y `/api/developer/github/callback`.

### Permisos (mínimos — no dar de más)

**Repository permissions:**

- **Metadata** → **Read-only** ✅ (único permiso necesario en Fase 1: listar y
  leer info básica de repos para el selector).

**Todo lo demás en "No access"** — en particular **Contents = No access**
(Fase 1 no toca código). Account permissions: ninguno.

### Suscripción a eventos (Webhook)

Marca solo:

- ☑ **Installation** (alta/baja/suspend de la instalación)
- ☑ **Installation repositories** (cambios en los repos autorizados)

### Where can this GitHub App be installed?

- **Any account** (para que cualquier desarrollador la instale en su cuenta/org).

Crea la App. Luego:

1. Copia el **App ID** (General) → `GITHUB_APP_ID`.
2. Copia el **slug** público de la App (está en su URL `https://github.com/apps/<slug>`) → `GITHUB_APP_SLUG`.
3. En **Private keys** → **Generate a private key**: se descarga un `.pem`.
   Es el contenido de `GITHUB_PRIVATE_KEY`. **Es un secreto** — no lo subas al repo.

---

## 2. Variables de entorno (Vercel → Project → Settings → Environment Variables)

Agrega estas cuatro (Production y Preview según corresponda). Ver `.env.example`.

| Variable | Valor | Secreto |
|---|---|---|
| `GITHUB_APP_ID` | App ID numérico | no (pero agrúpalo aquí) |
| `GITHUB_APP_SLUG` | slug de la App | no |
| `GITHUB_PRIVATE_KEY` | contenido completo del `.pem` | **sí** |
| `GITHUB_WEBHOOK_SECRET` | el mismo secreto del webhook | **sí** |

Notas:

- **`GITHUB_PRIVATE_KEY`**: pega el PEM completo (incluidas las líneas
  `-----BEGIN…`/`-----END…`). Si tu método de carga no admite multilínea, puedes
  poner los saltos como `\n` literales: el código los normaliza
  (`lib/developer/github/github-config.ts`).
- **No** se usan `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` en Fase 1.
- Si **falta cualquiera** de las cuatro, la integración se auto-deshabilita de
  forma limpia: la UI muestra "no configurado" y las rutas responden
  `github_not_configured`. Nada más se rompe.

---

## 3. Migración de base de datos (Supabase)

Aplica la migración incluida en el repo (aditiva, no rompe nada):

```
supabase/migrations/20261104000000_dulabs_developer_v1_github_integration.sql
```

Crea 4 tablas `dulabs_dev_github_*` (instalación, repo, states, deliveries) con
RLS por `workspace_id` usando el helper existente
`public.dulabs_dev_workspaces_del_usuario()`. Aplícala con tu flujo habitual de
migraciones de Supabase (mismo que el resto de `supabase/migrations`).

---

## 4. Verificación end-to-end (una vez configurado)

1. Entra a `https://www.dulabs.co/developer/github` con una sesión OWNER/ADMIN.
2. **Conectar GitHub** → te redirige a instalar la App → elige la cuenta/repos.
3. Vuelves al dashboard con "GitHub conectado".
4. **Elegir repositorio** → selecciona uno → queda "vinculado".
5. Abre el repo desde el enlace, y verifica el bloque "Construye con el stack que
   prefieras" (repo + WhatsApp + API base).
6. **Desconectar** revoca el acceso de la App en DuLabs.
7. Webhook: al **eliminar** la instalación desde GitHub (Settings → Applications),
   el estado en DuLabs pasa a "desconectado" automáticamente (evento
   `installation.deleted`, firma verificada).

---

## 5. Resumen de URLs (para copiar/pegar en la App)

```
Homepage URL : https://www.dulabs.co/developers
Callback URL : https://www.dulabs.co/api/developer/github/callback
Setup URL    : https://www.dulabs.co/api/developer/github/callback
Webhook URL  : https://www.dulabs.co/api/github/webhook
Permisos     : Repository → Metadata: Read-only
Eventos      : installation, installation_repositories
```
