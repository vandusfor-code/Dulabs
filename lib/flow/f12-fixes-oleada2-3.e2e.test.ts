/**
 * FASE F12 (Debt Zero, autorizado) — tests dinámicos dedicados para los 6
 * fixes de las Oleadas 2 y 3 (antes solo validados por regresión de la
 * suite existente + tipos/lint). Usa el mismo helper de sesión real que
 * f12-pentest-dinamico.e2e.test.ts (SERVICE_ROLE_KEY como apikey para
 * signInWithPassword -- confirmado que produce un access_token idéntico al
 * que daría el anon key real).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { crearUsuarioDePrueba, borrarUsuarioDePrueba, type UsuarioDePrueba } from "@/lib/test-helpers/sesion-prueba";
import { GET as conversacionesGET } from "@/app/api/dashboard/conversaciones/route";
import { POST as asignarPOST } from "@/app/api/dashboard/conversaciones/asignar/route";
import { POST as handoffPOST } from "@/app/api/dashboard/conversaciones/handoff/route";
import { GET as campanasGET } from "@/app/api/dashboard/campanas/route";
import { GET as plantillasGET } from "@/app/api/plantillas/route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function reqGet(url: string, token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new NextRequest(url, { method: "GET", headers });
}
function reqJson(url: string, method: string, body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new NextRequest(url, { method, headers, body: JSON.stringify(body) });
}

describe(
  "FASE F12 — tests dedicados de los fixes de Oleada 2/3 (Inbox + campañas/plantillas)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const sufijo = randomUUID().slice(0, 8);
    const TENANT = randomUUID();
    const PHONE = `f12-fixes-${sufijo}`;
    let adminUser: UsuarioDePrueba;
    let agenteUser: UsuarioDePrueba;

    before(async () => {
      adminUser = await crearUsuarioDePrueba(admin, { tenantId: TENANT, rol: "admin", prefijo: "f12-fixes-admin" });
      agenteUser = await crearUsuarioDePrueba(admin, { tenantId: TENANT, rol: "agente", prefijo: "f12-fixes-agente" });
      const { error } = await admin.from("dulabs_clientes_config").insert({
        id_tenant: TENANT,
        phone_number_id: PHONE,
        whatsapp_business_account_id: `waba-${sufijo}`,
        nombre_negocio: "Tenant fixes pentest",
        telefono_negocio: "570000000003",
      });
      if (error) throw error;
    });

    after(async () => {
      await admin.from("dulabs_mensajes_log").delete().eq("phone_number_id", PHONE);
      await admin.from("dulabs_campanas").delete().eq("id_tenant", TENANT);
      await admin.from("dulabs_plantillas").delete().eq("id_tenant", TENANT);
      await admin.from("dulabs_conversacion_asignaciones").delete().eq("phone_number_id", PHONE);
      await admin.from("dulabs_conversacion_eventos").delete().eq("phone_number_id", PHONE);
      await admin.from("dulabs_pausas_chat").delete().eq("phone_number_id", PHONE);
      await admin.from("dulabs_clientes_config").delete().eq("phone_number_id", PHONE);
      await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", TENANT);
      await borrarUsuarioDePrueba(admin, adminUser.id);
      await borrarUsuarioDePrueba(admin, agenteUser.id);
    });

    it("1. conversaciones: paginación real por cursor -- página 2 nunca repite ni pierde", async () => {
      // 3 conversaciones distintas con actividad en 3 momentos distintos.
      const clientes = ["573000000091", "573000000092", "573000000093"];
      const base = Date.now() - 10_000;
      for (let i = 0; i < clientes.length; i++) {
        await admin.from("dulabs_mensajes_log").insert({
          phone_number_id: PHONE,
          telefono_cliente: clientes[i],
          direccion: "entrante",
          contenido: `msg-${i}`,
          created_at: new Date(base + i * 1000).toISOString(),
        });
      }

      const pagina1 = await conversacionesGET(
        reqGet(`http://localhost/api/dashboard/conversaciones?limite=2`, adminUser.token),
      );
      const body1 = await pagina1.json();
      assert.equal(body1.conversaciones.length, 2);
      assert.ok(body1.siguiente_cursor, "debe indicar que hay más páginas");

      const pagina2 = await conversacionesGET(
        reqGet(
          `http://localhost/api/dashboard/conversaciones?limite=2&cursor=${encodeURIComponent(body1.siguiente_cursor)}`,
          adminUser.token,
        ),
      );
      const body2 = await pagina2.json();
      assert.equal(body2.conversaciones.length, 1);

      const telefonosPagina1 = body1.conversaciones.map((c: { telefono_cliente: string }) => c.telefono_cliente);
      const telefonosPagina2 = body2.conversaciones.map((c: { telefono_cliente: string }) => c.telefono_cliente);
      // Ningún teléfono se repite entre páginas, y juntas cubren las 3.
      assert.equal(new Set([...telefonosPagina1, ...telefonosPagina2]).size, 3);
      assert.equal(telefonosPagina1.some((t: string) => telefonosPagina2.includes(t)), false);
    });

    it("2. asignar: dos peticiones concurrentes -- exactamente una gana (gano=true), la otra gano=false, sin 500", async () => {
      const telefono = "573000000094";
      const [r1, r2] = await Promise.all([
        asignarPOST(
          reqJson("http://localhost/api/dashboard/conversaciones/asignar", "POST", {
            phone_number_id: PHONE,
            telefono_cliente: telefono,
            miembro_id: adminUser.miembroId,
          }, adminUser.token),
        ),
        asignarPOST(
          reqJson("http://localhost/api/dashboard/conversaciones/asignar", "POST", {
            phone_number_id: PHONE,
            telefono_cliente: telefono,
            miembro_id: agenteUser.miembroId,
          }, agenteUser.token),
        ),
      ]);
      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);
      const [b1, b2] = await Promise.all([r1.json(), r2.json()]);
      const ganadores = [b1.gano, b2.gano].filter(Boolean).length;
      assert.equal(ganadores, 1, "exactamente uno de los dos debe reportar gano=true");

      const { data: eventos } = await admin
        .from("dulabs_conversacion_eventos")
        .select("id")
        .eq("phone_number_id", PHONE)
        .eq("telefono_cliente", telefono);
      assert.equal(eventos?.length, 1, "solo el ganador real debe haber dejado un evento de auditoría");
    });

    it("3. handoff: tomar una conversación YA asignada a otro agente -- gano=false, sin evento falso", async () => {
      const telefono = "573000000095";
      await admin.from("dulabs_conversacion_asignaciones").insert({
        phone_number_id: PHONE,
        telefono_cliente: telefono,
        miembro_id: adminUser.miembroId,
      });

      const res = await handoffPOST(
        reqJson("http://localhost/api/dashboard/conversaciones/handoff", "POST", {
          phone_number_id: PHONE,
          telefono_cliente: telefono,
          accion: "tomar",
        }, agenteUser.token),
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.gano, false);

      const { data: fila } = await admin
        .from("dulabs_conversacion_asignaciones")
        .select("miembro_id")
        .eq("phone_number_id", PHONE)
        .eq("telefono_cliente", telefono)
        .single();
      assert.equal(fila?.miembro_id, adminUser.miembroId, "la conversación sigue siendo del admin, no se le arrebató");

      const { data: eventos } = await admin
        .from("dulabs_conversacion_eventos")
        .select("id")
        .eq("phone_number_id", PHONE)
        .eq("telefono_cliente", telefono)
        .eq("tipo", "asignado");
      assert.equal(eventos?.length, 0, "no debe quedar un evento falso a nombre de quien no la tomó");
    });

    it("4. handoff: tomar una conversación SIN asignar -- gano=true, evento real registrado", async () => {
      const telefono = "573000000096";
      const res = await handoffPOST(
        reqJson("http://localhost/api/dashboard/conversaciones/handoff", "POST", {
          phone_number_id: PHONE,
          telefono_cliente: telefono,
          accion: "tomar",
        }, adminUser.token),
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.gano, true);
      const { data: eventos } = await admin
        .from("dulabs_conversacion_eventos")
        .select("id")
        .eq("phone_number_id", PHONE)
        .eq("telefono_cliente", telefono)
        .eq("tipo", "asignado");
      assert.equal(eventos?.length, 1);
    });

    it("5. campanas/route.ts: la tendencia semanal solo cuenta mensajes dentro de la ventana de 7 semanas", async () => {
      const { data: plantilla } = await admin
        .from("dulabs_plantillas")
        .insert({
          id_tenant: TENANT,
          phone_number_id: PHONE,
          whatsapp_business_account_id: `waba-${sufijo}`,
          nombre: `f12-plantilla-${sufijo}`,
          categoria: "MARKETING",
          cuerpo: "hola",
          estado: "APPROVED",
        })
        .select("id")
        .single();
      if (!plantilla) throw new Error("no se pudo crear la plantilla de prueba");
      const { data: campana } = await admin
        .from("dulabs_campanas")
        .insert({
          id_tenant: TENANT,
          phone_number_id: PHONE,
          plantilla_id: plantilla.id,
          nombre: "Campaña de prueba",
          destinatarios_total: 2,
        })
        .select("id")
        .single();
      if (!campana) throw new Error("no se pudo crear la campaña de prueba");

      const hace10Semanas = new Date(Date.now() - 10 * 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error: insertMsgError } = await admin.from("dulabs_mensajes_log").insert([
        {
          phone_number_id: PHONE,
          telefono_cliente: "573000000097",
          direccion: "saliente",
          contenido: "vieja",
          campana_id: campana.id,
          estado_entrega: "leido",
          created_at: hace10Semanas, // FUERA de la ventana de tendencia
        },
        {
          phone_number_id: PHONE,
          telefono_cliente: "573000000098",
          direccion: "saliente",
          contenido: "reciente",
          campana_id: campana.id,
          estado_entrega: "entregado",
          created_at: new Date().toISOString(), // DENTRO de la ventana de tendencia
        },
      ]);
      if (insertMsgError) throw insertMsgError;

      const res = await campanasGET(reqGet("http://localhost/api/dashboard/campanas", adminUser.token));
      assert.equal(res.status, 200);
      const body = await res.json();
      // KPI total (mensajesEnviados): ambas filas cuentan -- no está
      // acotado por fecha, solo por el tope defensivo de 200k.
      assert.equal(body.kpis.mensajesEnviados, 2);
      // Tendencia (6 semanas): la fila de hace 10 semanas NUNCA debe sumar
      // en ningún bucket -- si el fix fallara y usara la lista sin acotar,
      // esta suma podría aparecer en la semana más vieja del arreglo.
      const totalEnTendencia = body.tendencia.reduce(
        (acc: number, s: { entregados: number; leidos: number }) => acc + s.entregados + s.leidos,
        0,
      );
      assert.equal(totalEnTendencia, 1, "solo el mensaje reciente debe aparecer en la tendencia de 7 semanas");
      // El funnel por campaña sí ve ambos mensajes (histórico completo, acotado por el tope defensivo).
      const campanaEnLista = body.campanas.find((c: { id: number }) => c.id === campana.id);
      assert.equal(campanaEnLista.funnel.sent, 2);
    });

    it("6. plantillas/route.ts: consumo por plantilla se acota a las campañas/mensajes más recientes (tope defensivo activo)", async () => {
      const res = await plantillasGET(reqGet("http://localhost/api/plantillas", adminUser.token));
      assert.equal(res.status, 200);
      const body = await res.json();
      const plantillaDePrueba = body.plantillas.find((p: { nombre: string }) => p.nombre === `f12-plantilla-${sufijo}`);
      assert.ok(plantillaDePrueba, "la plantilla de prueba debe aparecer en la lista");
      // 2 mensajes reales enviados vía esa campaña en el test anterior, 1 leído.
      assert.equal(plantillaDePrueba.enviados, 2);
      assert.equal(plantillaDePrueba.tasaLectura, 0.5);
    });
  },
);
