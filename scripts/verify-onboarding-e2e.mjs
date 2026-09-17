#!/usr/bin/env node
// Verificación E2E del onboarding de DuLabs Developer (provisión de workspace).
//
// Qué prueba (contra la BD real, de forma SEGURA y REPETIBLE, sin enviar
// mensajes): crea un usuario de prueba confirmado, ejecuta el RPC de provisión
// dulabs_dev_provisionar_onboarding, valida que se crearon cuenta + workspace +
// membership OWNER, valida la idempotencia (segunda llamada no duplica), y
// LIMPIA todo (borra membership, workspace_plan, cuenta y el usuario de prueba).
//
// Requisitos (variables de entorno):
//   SUPABASE_URL=...                 (URL del proyecto)
//   SUPABASE_SERVICE_ROLE_KEY=...    (service role; NUNCA se imprime)
// La migración 20261017000000_dulabs_developer_v1_provisionar_onboarding.sql
// debe estar aplicada; si no, el RPC no existe y el script lo reporta.
//
// Uso (PowerShell):
//   $env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="..."; node scripts/verify-onboarding-e2e.mjs
// Uso (bash):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/verify-onboarding-e2e.mjs

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  process.exit(2);
}
const sb = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let ok = 0, fail = 0;
function check(nombre, cond, detalle = "") {
  if (cond) { ok++; console.log(`  PASS  ${nombre}`); }
  else { fail++; console.log(`  FAIL  ${nombre}${detalle ? "  -> " + detalle : ""}`); }
}

const email = `e2e-onboarding+${Date.now()}@dulabs-test.co`;
let userId = null;
let workspaceId = null;
let accountId = null;

try {
  // 1. Crear usuario de prueba confirmado con metadata de negocio.
  const { data: creado, error: eCrear } = await sb.auth.admin.createUser({
    email,
    password: `Test-${Date.now()}-Aa1!`,
    email_confirm: true,
    user_metadata: { nombre: "Prueba E2E", empresa: "Dulabs QA", whatsapp: "+573000000000", producto: "developer" },
  });
  if (eCrear) throw new Error(`createUser: ${eCrear.message}`);
  userId = creado.user.id;
  console.log(`\n[usuario de prueba] ${email}  id=${userId}\n`);

  // 2. Provisión (primera vez) -> created=true, devuelve workspace_id.
  const { data: p1, error: e1 } = await sb.rpc("dulabs_dev_provisionar_onboarding", { p_owner_user_id: userId });
  if (e1) throw new Error(`RPC provisión (¿migración aplicada?): ${e1.message}`);
  const f1 = Array.isArray(p1) ? p1[0] : p1;
  workspaceId = f1?.workspace_id ?? null;
  check("provisión devuelve workspace_id", Boolean(workspaceId), JSON.stringify(f1));
  check("primera provisión created=true", f1?.created === true, JSON.stringify(f1));

  // 3. Validar cuenta + workspace_plan + membership OWNER.
  const { data: wp } = await sb.from("dulabs_dev_workspace_plans").select("workspace_id, account_id").eq("workspace_id", workspaceId).maybeSingle();
  check("workspace_plans creado", Boolean(wp), "no existe fila");
  accountId = wp?.account_id ?? null;
  check("workspace ligado a una cuenta", Boolean(accountId));

  if (accountId) {
    const { data: acc } = await sb.from("dulabs_dev_accounts").select("id, owner_user_id, plan_codigo, estado").eq("id", accountId).maybeSingle();
    check("cuenta creada con owner correcto", acc?.owner_user_id === userId, JSON.stringify(acc));
    check("cuenta en plan DEVELOPER active", acc?.plan_codigo === "DEVELOPER" && acc?.estado === "active", JSON.stringify(acc));
  }

  const { data: mem } = await sb.from("dulabs_dev_memberships").select("workspace_id, user_id, rol, estado").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  check("membership OWNER activo", mem?.rol === "OWNER" && mem?.estado === "activo", JSON.stringify(mem));

  // 4. Idempotencia: segunda provisión -> created=false, MISMO workspace.
  const { data: p2, error: e2 } = await sb.rpc("dulabs_dev_provisionar_onboarding", { p_owner_user_id: userId });
  if (e2) throw new Error(`RPC provisión (2da): ${e2.message}`);
  const f2 = Array.isArray(p2) ? p2[0] : p2;
  check("segunda provisión created=false (idempotente)", f2?.created === false, JSON.stringify(f2));
  check("segunda provisión mismo workspace", f2?.workspace_id === workspaceId, `${f2?.workspace_id} vs ${workspaceId}`);

  // 5. No hay workspaces duplicados para el usuario.
  const { data: mems } = await sb.from("dulabs_dev_memberships").select("workspace_id").eq("user_id", userId);
  check("sin memberships duplicadas", (mems ?? []).length === 1, `count=${(mems ?? []).length}`);
} catch (err) {
  fail++;
  console.log(`  FAIL  excepción -> ${err instanceof Error ? err.message : String(err)}`);
} finally {
  // 6. Cleanup (best-effort).
  try {
    if (workspaceId) {
      await sb.from("dulabs_dev_memberships").delete().eq("workspace_id", workspaceId);
      await sb.from("dulabs_dev_workspace_plans").delete().eq("workspace_id", workspaceId);
    }
    if (accountId) {
      await sb.from("dulabs_dev_account_audit").delete().eq("account_id", accountId);
      await sb.from("dulabs_dev_accounts").delete().eq("id", accountId);
    }
    if (userId) await sb.auth.admin.deleteUser(userId);
    console.log("\n[cleanup] usuario/cuenta/workspace de prueba eliminados.");
  } catch (e) {
    console.log(`\n[cleanup] parcial: ${e instanceof Error ? e.message : String(e)} (revisar manualmente id=${userId})`);
  }
}

console.log(`\nRESULTADO: ${ok} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
