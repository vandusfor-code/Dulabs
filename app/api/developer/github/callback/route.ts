import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { obtenerGithubConfig } from "@/lib/developer/github/github-config";
import { consumirConnectState } from "@/lib/developer/github/github-connect-state-store";
import { obtenerInstalacion } from "@/lib/developer/github/github-app-client";
import { guardarInstalacion } from "@/lib/developer/github/github-installations-store";

// DuLabs Developer V1 -- GitHub Integration (Fase 1, autorizado).
// Callback (Setup URL) de la GitHub App. Llega como redirección del navegador
// SIN sesión (sin Bearer), así que NO usa conSesionDeveloper: la autoridad es
// el `state` single-use, creado por una request autenticada (OWNER/ADMIN) que
// lo ligó a un workspace concreto. Nunca se confía en un workspace del query.
// Corre con service_role server-side.

export const runtime = "nodejs";

function volverA(request: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL("/developer/github", request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const installationIdRaw = sp.get("installation_id");
  const state = sp.get("state");
  const setupAction = sp.get("setup_action"); // "install" | "update" | "request"

  const config = obtenerGithubConfig();
  if (!config) return volverA(request, { error: "not_configured" });

  // Sin state => la App se instaló directo desde GitHub (no desde el botón de
  // DuLabs). No podemos ligarla a un workspace de forma segura: se pide
  // reconectar desde el dashboard.
  if (!state) return volverA(request, { error: "sin_state" });

  const supabase = supabaseAdmin();

  let consumido: Awaited<ReturnType<typeof consumirConnectState>>;
  try {
    consumido = await consumirConnectState(supabase, { state });
  } catch {
    return volverA(request, { error: "state_error" });
  }
  if (!consumido) return volverA(request, { error: "state_invalido" });

  // El usuario pudo cancelar o solo "solicitar" la instalación (org sin permiso
  // directo): no hay installation_id. Se trata como cancelado (no es error duro).
  const installationId = installationIdRaw ? Number(installationIdRaw) : NaN;
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return volverA(request, { error: setupAction === "request" ? "pendiente_aprobacion" : "cancelado" });
  }

  // Verifica la instalación contra GitHub (autenticado como App) -- nunca se
  // confía en el installation_id del query sin validarlo.
  const inst = await obtenerInstalacion(config, installationId);
  if (inst === null) return volverA(request, { error: "instalacion_no_encontrada" });
  // GithubApiError es el único miembro con `ok` -> narrowing limpio a GithubInstallation.
  if ("ok" in inst) return volverA(request, { error: "github_error" });

  try {
    await guardarInstalacion(supabase, { workspaceId: consumido.workspaceId, installation: inst });
  } catch {
    return volverA(request, { error: "persistencia" });
  }

  return volverA(request, { connected: "1" });
}
