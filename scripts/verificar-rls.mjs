// Prueba de aislamiento RLS entre tenants, contra la base real.
//
// Crea dos usuarios efímeros (A y B), siembra datos para A con la service
// role (que ignora RLS), y verifica con la clave ANON + sesión de cada
// usuario que: A ve sus propias filas, B no ve ninguna fila de A, y
// dulabs_clientes_config (sin política, contiene tokens) no devuelve filas
// para nadie. Limpia todo al terminar, pase o falle.
//
// Uso:  node scripts/verificar-rls.mjs [ruta-al-archivo-env]
//       (por defecto lee .env.rls-test.local — ver `vercel env pull`)

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const envFile = process.argv[2] ?? ".env.rls-test.local";
const env = {};
for (const linea of readFileSync(envFile, "utf8").split("\n")) {
  const m = linea.match(/^([A-Z_][A-Z0-9_]*)=["']?(.*?)["']?\s*$/);
  if (m) env[m[1]] = m[2];
}

const URL_SUPABASE = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_SUPABASE || !SERVICE_KEY || !ANON_KEY) {
  console.error(`Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY en ${envFile}`);
  process.exit(1);
}

const admin = createClient(URL_SUPABASE, SERVICE_KEY, { auth: { persistSession: false } });
const sufijo = randomUUID().slice(0, 8);
const PHONE_FAKE = `rls-test-${sufijo}`;
const resultados = [];
let usuarioA = null;
let usuarioB = null;

function check(nombre, ok, detalle = "") {
  resultados.push({ nombre, ok });
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

async function clienteAutenticado(email, password) {
  const cli = createClient(URL_SUPABASE, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await cli.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`No se pudo iniciar sesión como ${email}: ${error.message}`);
  return cli;
}

async function limpiar() {
  await admin.from("dulabs_mensajes_log").delete().eq("phone_number_id", PHONE_FAKE);
  await admin.from("dulabs_pausas_chat").delete().eq("phone_number_id", PHONE_FAKE);
  await admin.from("dulabs_clientes_config").delete().eq("phone_number_id", PHONE_FAKE);
  if (usuarioA) {
    await admin.from("dulabs_suscripciones").delete().eq("id_tenant", usuarioA.id);
    await admin.auth.admin.deleteUser(usuarioA.id);
  }
  if (usuarioB) await admin.auth.admin.deleteUser(usuarioB.id);
}

try {
  // 1. Usuarios efímeros (email confirmado por admin: no se envía ningún correo).
  const passA = `RlsTest-${randomUUID()}`;
  const passB = `RlsTest-${randomUUID()}`;
  const emailA = `rls-test-a-${sufijo}@example.com`;
  const emailB = `rls-test-b-${sufijo}@example.com`;
  const { data: a, error: errA } = await admin.auth.admin.createUser({ email: emailA, password: passA, email_confirm: true });
  if (errA) throw new Error(`createUser A: ${errA.message}`);
  usuarioA = a.user;
  const { data: b, error: errB } = await admin.auth.admin.createUser({ email: emailB, password: passB, email_confirm: true });
  if (errB) throw new Error(`createUser B: ${errB.message}`);
  usuarioB = b.user;
  console.log(`Usuarios efímeros creados (${emailA}, ${emailB})\n`);

  // 2. Datos de prueba del tenant A (vía service role, ignora RLS).
  const { error: errCfg } = await admin.from("dulabs_clientes_config").insert({
    id_tenant: usuarioA.id,
    nombre_negocio: "RLS Test (borrar)",
    whatsapp_business_account_id: `waba-${PHONE_FAKE}`,
    phone_number_id: PHONE_FAKE,
    telefono_negocio: "0000000000",
  });
  if (errCfg) throw new Error(`seed clientes_config: ${errCfg.message}`);
  const { error: errMsg } = await admin.from("dulabs_mensajes_log").insert({
    phone_number_id: PHONE_FAKE,
    telefono_cliente: "573000000000",
    direccion: "entrante",
    contenido: "mensaje de prueba RLS",
  });
  if (errMsg) throw new Error(`seed mensajes_log: ${errMsg.message}`);
  const { error: errSub } = await admin.from("dulabs_suscripciones").insert({
    id_tenant: usuarioA.id,
    plan: "Plan Test RLS",
    precio_cop: 1,
    wompi_payment_source_id: "rls-test",
    wompi_customer_email: emailA,
    fecha_proximo_cobro: "2099-01-01",
  });
  if (errSub) throw new Error(`seed suscripciones: ${errSub.message}`);

  // 3. Como tenant A: debe ver SUS filas (prueba que la política permite, no solo bloquea).
  const cliA = await clienteAutenticado(emailA, passA);
  const subA = await cliA.from("dulabs_suscripciones").select("id_tenant");
  check("A ve su propia suscripción (id_tenant directo)", !subA.error && subA.data?.length === 1, subA.error?.message ?? `filas: ${subA.data?.length}`);
  const msgA = await cliA.from("dulabs_mensajes_log").select("phone_number_id").eq("phone_number_id", PHONE_FAKE);
  check("A ve sus propios mensajes (vía phone_number_id)", !msgA.error && msgA.data?.length === 1, msgA.error?.message ?? `filas: ${msgA.data?.length}`);
  const cfgA = await cliA.from("dulabs_clientes_config").select("phone_number_id");
  check("clientes_config NO devuelve filas ni al propio tenant (tokens protegidos)", !cfgA.error && cfgA.data?.length === 0, cfgA.error?.message ?? `filas: ${cfgA.data?.length}`);

  // 4. Como tenant B: no debe ver NADA de A.
  const cliB = await clienteAutenticado(emailB, passB);
  const subB = await cliB.from("dulabs_suscripciones").select("id_tenant");
  check("B no ve la suscripción de A", !subB.error && subB.data?.length === 0, subB.error?.message ?? `filas: ${subB.data?.length}`);
  const msgB = await cliB.from("dulabs_mensajes_log").select("phone_number_id").eq("phone_number_id", PHONE_FAKE);
  check("B no ve los mensajes de A", !msgB.error && msgB.data?.length === 0, msgB.error?.message ?? `filas: ${msgB.data?.length}`);
  const cfgB = await cliB.from("dulabs_clientes_config").select("phone_number_id");
  check("B no ve la configuración de A", !cfgB.error && cfgB.data?.length === 0, cfgB.error?.message ?? `filas: ${cfgB.data?.length}`);

  // 5. Escrituras con anon+sesión deben fallar (no hay políticas de INSERT).
  const insB = await cliB.from("dulabs_mensajes_log").insert({
    phone_number_id: PHONE_FAKE,
    telefono_cliente: "573000000001",
    direccion: "entrante",
    contenido: "intento de escritura no autorizada",
  });
  check("B no puede insertar en mensajes_log (sin política de INSERT)", Boolean(insB.error), insB.error ? insB.error.message : "el insert fue aceptado");
} catch (err) {
  console.error(`\n💥 Error de preparación: ${err.message}`);
  resultados.push({ nombre: "preparación", ok: false });
} finally {
  await limpiar();
  console.log("\nDatos y usuarios de prueba eliminados.");
}

const fallos = resultados.filter((r) => !r.ok).length;
console.log(`\n${fallos === 0 ? "✅" : "❌"} ${resultados.length - fallos}/${resultados.length} pruebas pasaron`);
process.exit(fallos === 0 ? 0 : 1);
