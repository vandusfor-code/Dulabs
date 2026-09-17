#!/usr/bin/env node
// DuLabs Developer V1 -- Fase 18 (18.13). Smoke test NO destructivo para
// staging/producción. Solo hace GETs y verifica rechazos de auth; NUNCA envía
// mensajes, ni crea/borra datos, ni toca billing. No corre solo: exige que se
// pasen las URLs por entorno, para que jamás golpee un host por accidente.
//
// Uso:
//   GATEWAY_BASE_URL=https://api.dulabs.dev \
//   APP_BASE_URL=https://www.dulabs.co \
//   node scripts/dev-smoke-test.mjs
//
// Exit codes: 0 = todo OK · 1 = alguna verificación falló · 2 = no configurado.

const GATEWAY = process.env.GATEWAY_BASE_URL?.replace(/\/$/, "");
const APP = process.env.APP_BASE_URL?.replace(/\/$/, "");

if (!GATEWAY && !APP) {
  console.error("[smoke] Configura GATEWAY_BASE_URL y/o APP_BASE_URL. Nada que probar; saliendo (2).");
  process.exit(2);
}

const SECRETOS_PROHIBIDOS = ["service_role", "prv_live", "prv_test", "SUPABASE_SERVICE_ROLE", "META_APP_SECRET", "eyJhbGciOi"];
let fallos = 0;
const ok = (n) => console.log(`  ✓ ${n}`);
const fail = (n, d) => { console.error(`  ✖ ${n} -- ${d}`); fallos++; };

async function req(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, redirect: "manual" });
    const texto = await r.text();
    return { status: r.status, texto };
  } finally { clearTimeout(t); }
}

function sinSecretos(nombre, texto) {
  const bajo = texto.toLowerCase();
  for (const s of SECRETOS_PROHIBIDOS) {
    if (bajo.includes(s.toLowerCase())) { fail(`${nombre}: sin secretos`, `contiene '${s}'`); return; }
  }
  ok(`${nombre}: sin secretos en la respuesta`);
}

async function pruebasGateway() {
  console.log(`\n[gateway] ${GATEWAY}`);
  try {
    const salud = await req(`${GATEWAY}/salud`);
    salud.status === 200 ? ok("/salud responde 200") : fail("/salud", `status ${salud.status}`);
  } catch (e) { fail("/salud", String(e)); }

  try {
    const sinAuth = await req(`${GATEWAY}/api/v1/me`);
    sinAuth.status === 401 ? ok("/api/v1/me sin auth -> 401") : fail("/api/v1/me sin auth", `esperaba 401, dio ${sinAuth.status}`);
    sinSecretos("/api/v1/me sin auth", sinAuth.texto);
  } catch (e) { fail("/api/v1/me sin auth", String(e)); }

  try {
    const keyMala = await req(`${GATEWAY}/api/v1/me`, { headers: { Authorization: "Bearer dl_live_clave_invalida_de_smoke_test" } });
    keyMala.status === 401 ? ok("/api/v1/me con API key inválida -> 401") : fail("/api/v1/me key inválida", `esperaba 401, dio ${keyMala.status}`);
  } catch (e) { fail("/api/v1/me key inválida", String(e)); }
}

async function pruebasApp() {
  console.log(`\n[app] ${APP}`);
  try {
    const spec = await req(`${APP}/api/developers/openapi`);
    spec.status === 200 && spec.texto.includes("openapi") ? ok("/api/developers/openapi -> 200 con spec") : fail("openapi", `status ${spec.status}`);
    sinSecretos("openapi", spec.texto);
  } catch (e) { fail("openapi", String(e)); }

  try {
    const plans = await req(`${APP}/api/developers/plans`);
    const okPlans = plans.status === 200 && plans.texto.includes("plans");
    okPlans ? ok("/api/developers/plans -> 200 con planes") : fail("plans", `status ${plans.status}`);
    sinSecretos("plans", plans.texto);
  } catch (e) { fail("plans", String(e)); }
}

console.log("=== DuLabs Developer V1 -- smoke test (no destructivo) ===");
if (GATEWAY) await pruebasGateway();
if (APP) await pruebasApp();
console.log(`\n${fallos === 0 ? "✅ SMOKE OK" : `❌ SMOKE FALLÓ (${fallos})`}`);
process.exit(fallos === 0 ? 0 : 1);
