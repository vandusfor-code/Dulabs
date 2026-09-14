import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// FASE F12 (Debt Zero, autorizado) — helper compartido para tests que
// necesitan una sesión real firmada (Bearer token) contra rutas del
// dashboard. Hallazgo real de esta oleada: NEXT_PUBLIC_SUPABASE_ANON_KEY
// vacío en .env.local NO es un bloqueo real -- signInWithPassword funciona
// igual usando la SERVICE_ROLE_KEY como apikey del cliente (confirmado
// contra Supabase real). El access_token resultante es un JWT de usuario
// normal, idéntico al que produciría el anon key real -- las rutas lo
// validan con auth.getUser(token) sin importar qué key firmó el sign-in.
// Esto es puramente un helper de TEST: nunca se usa este patrón en código
// de producción (ahí sí se necesita el anon key real, publicado a
// propósito para el navegador).
export function crearClienteDePruebaComoSesion(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY en el entorno de test");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type UsuarioDePrueba = { id: string; miembroId: number; email: string; token: string };

// Crea un usuario real de Auth + fila de dulabs_miembros_equipo + inicia
// sesión real, devolviendo el access_token listo para usar como
// `Authorization: Bearer <token>` contra cualquier ruta del dashboard.
export async function crearUsuarioDePrueba(
  admin: SupabaseClient,
  params: { tenantId: string; rol: "admin" | "agente" | "lectura"; prefijo: string },
): Promise<UsuarioDePrueba> {
  const email = `${params.prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `F12Test-${Math.random().toString(36).slice(2, 12)}`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) throw createError ?? new Error("no se pudo crear el usuario de prueba");

  const { data: miembro, error: miembroError } = await admin
    .from("dulabs_miembros_equipo")
    .insert({
      tenant_id: params.tenantId,
      user_id: created.user.id,
      email,
      rol: params.rol,
      estado: "activo",
    })
    .select("id")
    .single();
  if (miembroError) throw miembroError;

  const sesion = crearClienteDePruebaComoSesion();
  const { data: signIn, error: signInError } = await sesion.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) throw signInError ?? new Error("no se pudo iniciar sesión de prueba");

  return { id: created.user.id, miembroId: miembro.id, email, token: signIn.session.access_token };
}

export async function borrarUsuarioDePrueba(admin: SupabaseClient, userId: string): Promise<void> {
  await admin.auth.admin.deleteUser(userId).catch(() => {});
}
