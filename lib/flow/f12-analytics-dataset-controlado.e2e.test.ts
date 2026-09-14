/**
 * FASE F12 (Debt Zero, autorizado) — Frente 2 reauditado: dataset pequeño y
 * CONOCIDO en un tenant desechable, verificando que Analytics devuelve
 * exactamente el resultado esperado (no solo "no truena").
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { crearUsuarioDePrueba, borrarUsuarioDePrueba, type UsuarioDePrueba } from "@/lib/test-helpers/sesion-prueba";
import { GET as analyticsGET } from "@/app/api/dashboard/analytics/route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function reqGet(url: string, token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new NextRequest(url, { method: "GET", headers });
}

describe(
  "FASE F12 — Analytics: dataset controlado con resultado exacto conocido (Frente 2)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const sufijo = randomUUID().slice(0, 8);
    const TENANT = randomUUID();
    const TENANT_OTRO = randomUUID(); // para probar que NO se filtra su tráfico
    const PHONE = `f12-analytics-${sufijo}`;
    const PHONE_OTRO = `f12-analytics-otro-${sufijo}`;
    let adminUser: UsuarioDePrueba;

    before(async () => {
      adminUser = await crearUsuarioDePrueba(admin, { tenantId: TENANT, rol: "admin", prefijo: "f12-analytics-admin" });
      const { error: e1 } = await admin.from("dulabs_clientes_config").insert({
        id_tenant: TENANT,
        phone_number_id: PHONE,
        whatsapp_business_account_id: `waba-${sufijo}`,
        nombre_negocio: "Tenant analytics",
        telefono_negocio: "570000000004",
      });
      if (e1) throw e1;
      const { error: e2 } = await admin.from("dulabs_clientes_config").insert({
        id_tenant: TENANT_OTRO,
        phone_number_id: PHONE_OTRO,
        whatsapp_business_account_id: `waba-otro-${sufijo}`,
        nombre_negocio: "Tenant OTRO (no debe filtrarse)",
        telefono_negocio: "570000000005",
      });
      if (e2) throw e2;

      const ahora = Date.now();
      // Dataset EXACTO y conocido:
      // - Conversación 1 (telefono ...201): 1 entrante + 1 saliente entregado+leido+respondido.
      // - Conversación 2 (telefono ...202): 1 entrante + 1 saliente SOLO enviado (ni entregado ni leido).
      // Total saliente = 2 (funnel.enviados=2), entregados=1, leidos=1, respondidos=1.
      // FASE F12 -- ojo: un insert en LOTE de PostgREST usa el primer objeto
      // para fijar el conjunto de columnas; una fila que omita una de esas
      // claves recibe NULL explícito en vez del default de la tabla (no
      // "sin cambios"). Por eso TODAS las filas fijan estado_entrega/respondido
      // explícitamente, incluidas las entrantes (donde el valor es irrelevante
      // para este test, pero debe ser un valor válido del CHECK real).
      const filas = [
        { phone_number_id: PHONE, telefono_cliente: "573000000201", direccion: "entrante", origen: "entrante", contenido: "hola", estado_entrega: "enviado", respondido: false, created_at: new Date(ahora - 5000).toISOString() },
        { phone_number_id: PHONE, telefono_cliente: "573000000201", direccion: "saliente", origen: "ia", contenido: "hola de vuelta", estado_entrega: "leido", respondido: true, created_at: new Date(ahora - 4000).toISOString() },
        { phone_number_id: PHONE, telefono_cliente: "573000000202", direccion: "entrante", origen: "entrante", contenido: "hola2", estado_entrega: "enviado", respondido: false, created_at: new Date(ahora - 3000).toISOString() },
        { phone_number_id: PHONE, telefono_cliente: "573000000202", direccion: "saliente", origen: "manual", contenido: "resp2", estado_entrega: "enviado", respondido: false, created_at: new Date(ahora - 2000).toISOString() },
        // Ruido de OTRO tenant, en el MISMO rango de fechas -- si el filtro
        // de tenant fallara, estos 2 mensajes saldrían sumados también.
        { phone_number_id: PHONE_OTRO, telefono_cliente: "573000000999", direccion: "entrante", origen: "entrante", contenido: "ajeno", estado_entrega: "enviado", respondido: false, created_at: new Date(ahora - 3500).toISOString() },
        { phone_number_id: PHONE_OTRO, telefono_cliente: "573000000999", direccion: "saliente", origen: "ia", contenido: "resp ajena", estado_entrega: "leido", respondido: true, created_at: new Date(ahora - 3400).toISOString() },
      ];
      const { error: e3 } = await admin.from("dulabs_mensajes_log").insert(filas);
      if (e3) throw e3;
    });

    after(async () => {
      await admin.from("dulabs_mensajes_log").delete().eq("phone_number_id", PHONE);
      await admin.from("dulabs_mensajes_log").delete().eq("phone_number_id", PHONE_OTRO);
      await admin.from("dulabs_clientes_config").delete().eq("phone_number_id", PHONE);
      await admin.from("dulabs_clientes_config").delete().eq("phone_number_id", PHONE_OTRO);
      await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", TENANT);
      await borrarUsuarioDePrueba(admin, adminUser.id);
    });

    it("devuelve exactamente el funnel esperado, sin mezclar tráfico de otro tenant", async () => {
      const res = await analyticsGET(reqGet("http://localhost/api/dashboard/analytics?periodo=30d", adminUser.token));
      assert.equal(res.status, 200);
      const body = await res.json();

      // Doble conteo / mezcla de tenants: el resultado NUNCA debe incluir
      // el tráfico de PHONE_OTRO (2 mensajes más, 1 de ellos leído/respondido).
      assert.equal(body.funnel.enviados, 2, "exactamente 2 salientes propios, ninguno del otro tenant");
      assert.equal(body.funnel.entregados, 1);
      assert.equal(body.funnel.leidos, 1);
      assert.equal(body.funnel.respondidos, 1);

      // Canales: 1 "ia", 1 "manual" -- ninguno del tenant ajeno (que también era "ia").
      const canalIa = body.canales.find((c: { canal: string; cantidad: number }) => c.canal === "ia");
      const canalManual = body.canales.find((c: { canal: string; cantidad: number }) => c.canal === "manual");
      assert.equal(canalIa?.cantidad, 1, "solo el mensaje IA propio, no el del tenant ajeno");
      assert.equal(canalManual?.cantidad, 1);
    });

    it("timezone / rango de fechas -- un mensaje 40 días atrás NO aparece en el período por defecto (30d)", async () => {
      const hace40dias = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await admin.from("dulabs_mensajes_log").insert({
        phone_number_id: PHONE,
        telefono_cliente: "573000000203",
        direccion: "saliente",
        origen: "ia",
        contenido: "viejo",
        estado_entrega: "leido",
        respondido: true,
        created_at: hace40dias,
      });
      if (error) throw error;

      const res = await analyticsGET(reqGet("http://localhost/api/dashboard/analytics?periodo=30d", adminUser.token));
      const body = await res.json();
      // Sigue siendo 2 -- el mensaje de hace 40 días queda FUERA del
      // período de 30 días, tal como se espera de un filtro de fecha real.
      assert.equal(body.funnel.enviados, 2, "un mensaje de hace 40 días no debe colarse en el período de 30d por defecto");

      await admin.from("dulabs_mensajes_log").delete().eq("telefono_cliente", "573000000203");
    });
  },
);
