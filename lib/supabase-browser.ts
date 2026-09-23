"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

// «Recordarme» del login de DuLabs Developer. La preferencia vive en localStorage (nunca credenciales: solo "sesion" o una fecha
// límite) y decide DÓNDE guarda Supabase la sesión:
//   - sin preferencia  -> localStorage, como siempre (Business y cualquier flujo existente no cambian)
//   - "sesion"         -> sessionStorage: la sesión termina al cerrar la pestaña
//   - <timestamp ms>   -> localStorage hasta esa fecha; vencida, se descarta la sesión guardada y hay que volver a iniciar sesión
const CLAVE_RECORDAR = "dulabs_recordar_sesion";
export const DIAS_RECORDAR_SESION = 30;
const MS_DIA = 24 * 60 * 60 * 1000;

function destino(): Storage {
  const preferencia = window.localStorage.getItem(CLAVE_RECORDAR);
  if (preferencia === null) return window.localStorage;
  if (preferencia === "sesion") return window.sessionStorage;
  const hasta = Number(preferencia);
  if (Number.isFinite(hasta) && Date.now() < hasta) return window.localStorage;
  // Vencida: se borra la sesión recordada (claves de Supabase "sb-…") y la preferencia.
  for (const clave of Object.keys(window.localStorage)) if (clave.startsWith("sb-")) window.localStorage.removeItem(clave);
  window.localStorage.removeItem(CLAVE_RECORDAR);
  return window.localStorage;
}

const almacenamiento = {
  getItem: (clave: string) => destino().getItem(clave),
  setItem: (clave: string, valor: string) => destino().setItem(clave, valor),
  removeItem: (clave: string) => {
    window.localStorage.removeItem(clave);
    window.sessionStorage.removeItem(clave);
  },
};

/** Fija si la próxima sesión se recuerda (N días en este navegador) o solo dura mientras la pestaña siga abierta. */
export function fijarRecordarSesion(recordar: boolean): void {
  window.localStorage.setItem(CLAVE_RECORDAR, recordar ? String(Date.now() + DIAS_RECORDAR_SESION * MS_DIA) : "sesion");
}

// Cliente de Supabase para el navegador: usa la clave anónima (pública,
// protegida por RLS) y mantiene la sesión del usuario logueado.
export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error(
        "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en el entorno"
      );
    }
    client = createClient(url, key, { auth: { storage: almacenamiento } });
  }
  return client;
}
