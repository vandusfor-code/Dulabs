/**
 * AMORE (Fase 4, base de clientes, autorizado) — integración real contra el
 * panel administrativo YA existente y genérico (app/api/agenda/[token]/clientes/*,
 * construido en la Fase 5 del panel de Daniela) usando el token REAL de una
 * profesional de AMORE (Mary).
 *
 * IMPORTANTE (seguridad): las citas se crean llamando reservarCitaPorServicio
 * (lib/disponibilidad-servicio.ts) DIRECTAMENTE -- NUNCA el POST del portal
 * público (app/api/reservar/[tenant]/route.ts). AMORE es un tenant real con
 * un token de Meta real configurado: pasar por esa ruta dispararía un envío
 * real de WhatsApp (enviarConfirmacionReservaWhatsApp) a un número de
 * prueba/falso. reservarCitaPorServicio crea la cita y registra el cliente
 * (recordarNombreCliente) SIN ningún efecto de WhatsApp -- ese envío vive
 * aparte, en la ruta, no en la función de dominio.
 *
 * Ninguna reserva usa un teléfono real; toda fila creada se borra en el
 * after(). Ningún dato de Daniela/Solo Talento se toca -- ver los tests de
 * aislamiento (solo lectura sobre esos tenants).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import { GET as clientesGET, POST as clientesPOST } from "./route";
import { GET as clienteDetalleGET, PATCH as clienteDetallePATCH } from "./[id]/route";
import { reservarCitaPorServicio } from "@/lib/disponibilidad-servicio";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const AMORE_TENANT_ID = "ed6ae77f-8a0c-483e-a5d9-8ede68eca50f";
const AMORE_TOKEN_MARY = "31730a67"; // token real de Mary, ver dulabs_especialistas
const DANIELA_TENANT_ID = "c64fac97-eff8-45f2-b691-30b3449da524";
const SOLOTALENTO_TENANT_ID = "11ccf0a3-726b-4d4b-9f7d-2deb8441d6a9";

function paramsToken(token: string) {
  return { params: Promise.resolve({ token }) };
}
function paramsTokenId(token: string, id: string) {
  return { params: Promise.resolve({ token, id }) };
}
function reqTenant(url: string) {
  return new NextRequest(url);
}
function reqPost(url: string, body: unknown) {
  return new NextRequest(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function reqPatch(url: string, body: unknown) {
  return new NextRequest(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe(
  "Panel administrativo de AMORE — base de clientes (Fase 4, integración real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    let servicioUnaId: string;
    let especialistaCristalId: number;
    const citaIds: number[] = [];
    const telefonosPrueba: string[] = [];
    // "Login AMORE" (autorizado, hallazgo real de esta verificación) -- una
    // vez el tenant tiene alguna fila en dulabs_usuarios, requireAuth (ver
    // lib/auth/authz.ts) exige una cookie de sesión real -- el token crudo
    // en la URL deja de bastar. Este archivo llama las rutas SIN sesión
    // (mismo criterio que el resto de la plataforma sin login) -- si AMORE
    // ya tiene login habilitado, estas pruebas HTTP se saltan con un
    // mensaje claro en vez de reportar un 401 falso como si fuera un bug.
    let sesionRequerida = false;

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { count } = await supabase.from("dulabs_usuarios").select("id", { count: "exact", head: true }).eq("id_tenant", AMORE_TENANT_ID);
      sesionRequerida = (count ?? 0) > 0;
      const { data: servicios } = await supabase.from("dulabs_servicios").select("id,nombre").eq("id_tenant", AMORE_TENANT_ID).eq("activo", true);
      servicioUnaId = servicios!.find((s) => (s.nombre as string).toLowerCase().includes("uña"))!.id as string;
      const { data: especialistas } = await supabase.from("dulabs_especialistas").select("id,nombre").eq("id_tenant", AMORE_TENANT_ID).eq("activo", true);
      especialistaCristalId = especialistas!.find((e) => e.nombre === "Cristal")!.id as number;
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (citaIds.length) await supabase.from("dulabs_citas_especialista").delete().in("id", citaIds);
      for (const telefono of telefonosPrueba) {
        await supabase.from("dulabs_clientes_conocidos").delete().eq("id_tenant", AMORE_TENANT_ID).eq("telefono_cliente", telefono);
      }
    });

    function proximoMartes(offsetSemanas = 0): string {
      const hoy = new Date();
      const diaSemana = hoy.getUTCDay();
      const diasHastaMartes = ((2 - diaSemana + 7) % 7) || 7;
      const fecha = new Date(hoy);
      fecha.setUTCDate(hoy.getUTCDate() + diasHastaMartes + offsetSemanas * 7);
      return fecha.toISOString().slice(0, 10);
    }

    async function reservar(params: {
      telefono: string;
      nombre: string;
      hora: string;
      fecha: string;
      fechaNacimientoDia?: number;
      fechaNacimientoMes?: number;
    }) {
      const inicio = new Date(`${params.fecha}T${params.hora}:00-05:00`);
      const resultado = await reservarCitaPorServicio(supabase, {
        idTenant: AMORE_TENANT_ID,
        especialistaId: especialistaCristalId,
        servicioId: servicioUnaId,
        telefonoCliente: params.telefono,
        nombreCliente: params.nombre,
        fechaNacimientoDia: params.fechaNacimientoDia,
        fechaNacimientoMes: params.fechaNacimientoMes,
        inicio,
        origen: "manual",
      });
      assert.equal(resultado.ok, true, JSON.stringify(resultado));
      if (resultado.ok) citaIds.push(resultado.cita.id);
      return resultado;
    }

    it("1/3/4/5. reservar crea el cliente con nombre y cumpleaños, y aparece en el panel de AMORE", async (t) => {
      if (sesionRequerida) return t.skip("AMORE ya tiene Login habilitado -- esta prueba llama la ruta HTTP sin cookie de sesión");
      const telefono = `test-clientes-admin-${randomUUID().slice(0, 8)}`;
      telefonosPrueba.push(telefono);
      await reservar({ telefono, nombre: "Ana Prueba Clientes", hora: "08:00", fecha: proximoMartes(1), fechaNacimientoDia: 20, fechaNacimientoMes: 3 });

      const res = await clientesGET(reqTenant(`http://localhost/api/agenda/${AMORE_TOKEN_MARY}/clientes`), paramsToken(AMORE_TOKEN_MARY));
      const body = await res.json();
      const fila = body.clientes.find((c: { telefono: string }) => c.telefono === telefono);
      assert.ok(fila, "el cliente recién creado debe aparecer en el panel");
      assert.equal(fila.nombre, "Ana Prueba Clientes");
      assert.equal(fila.cumpleDia, 20);
      assert.equal(fila.cumpleMes, 3);
      assert.ok(fila.fechaRegistro);
    });

    it("2. cliente existente por WhatsApp no se duplica al reservar de nuevo (con o sin cumpleaños)", async () => {
      const telefono = `test-clientes-admin-${randomUUID().slice(0, 8)}`;
      telefonosPrueba.push(telefono);
      await reservar({ telefono, nombre: "Cliente Repetido", hora: "08:30", fecha: proximoMartes(1), fechaNacimientoDia: 5, fechaNacimientoMes: 11 });
      // Segunda reserva: SIN mandar cumpleaños -- no debe borrar el que ya quedó guardado.
      await reservar({ telefono, nombre: "Cliente Repetido (actualizado)", hora: "08:45", fecha: proximoMartes(1) });

      const { data: filas } = await supabase
        .from("dulabs_clientes_conocidos")
        .select("id,nombre,cumple_dia,cumple_mes")
        .eq("id_tenant", AMORE_TENANT_ID)
        .eq("telefono_cliente", telefono);
      assert.equal(filas!.length, 1, "nunca debe duplicarse la fila de cliente conocido");
      assert.equal(filas![0]!.nombre, "Cliente Repetido (actualizado)", "el nombre SÍ se actualiza");
      assert.equal(filas![0]!.cumple_dia, 5, "el cumpleaños ya guardado NUNCA se borra por una reserva que no lo manda");
      assert.equal(filas![0]!.cumple_mes, 11);
    });

    it("6. búsqueda por nombre funciona (server-side, ?q=)", async (t) => {
      if (sesionRequerida) return t.skip("AMORE ya tiene Login habilitado -- esta prueba llama la ruta HTTP sin cookie de sesión");
      const telefono = `test-clientes-admin-${randomUUID().slice(0, 8)}`;
      telefonosPrueba.push(telefono);
      await reservar({ telefono, nombre: "Valentina Buscar Nombre", hora: "10:00", fecha: proximoMartes(1) });

      const res = await clientesGET(
        reqTenant(`http://localhost/api/agenda/${AMORE_TOKEN_MARY}/clientes?q=${encodeURIComponent("Valentina Buscar")}`),
        paramsToken(AMORE_TOKEN_MARY)
      );
      const body = await res.json();
      assert.ok(body.clientes.some((c: { telefono: string }) => c.telefono === telefono));
      assert.ok(body.clientes.every((c: { nombre: string }) => c.nombre.toLowerCase().includes("valentina buscar")));
    });

    it("7. búsqueda por WhatsApp funciona (server-side, ?q=)", async (t) => {
      if (sesionRequerida) return t.skip("AMORE ya tiene Login habilitado -- esta prueba llama la ruta HTTP sin cookie de sesión");
      const telefono = `test-clientes-admin-90001${randomUUID().slice(0, 4)}`;
      telefonosPrueba.push(telefono);
      await reservar({ telefono, nombre: "Buscar Por Telefono", hora: "11:00", fecha: proximoMartes(1) });

      const res = await clientesGET(
        reqTenant(`http://localhost/api/agenda/${AMORE_TOKEN_MARY}/clientes?q=${encodeURIComponent(telefono)}`),
        paramsToken(AMORE_TOKEN_MARY)
      );
      const body = await res.json();
      assert.ok(body.clientes.some((c: { telefono: string }) => c.telefono === telefono));
    });

    it("8/9. detalle del cliente funciona y el historial muestra ÚNICAMENTE reservas de AMORE (servicio/profesional/fecha/hora/estado)", async (t) => {
      if (sesionRequerida) return t.skip("AMORE ya tiene Login habilitado -- esta prueba llama la ruta HTTP sin cookie de sesión");
      const telefono = `test-clientes-admin-${randomUUID().slice(0, 8)}`;
      telefonosPrueba.push(telefono);
      await reservar({ telefono, nombre: "Detalle Historial", hora: "12:00", fecha: proximoMartes(2) });

      const listado = await clientesGET(reqTenant(`http://localhost/api/agenda/${AMORE_TOKEN_MARY}/clientes`), paramsToken(AMORE_TOKEN_MARY));
      const bodyListado = await listado.json();
      const clienteId = bodyListado.clientes.find((c: { telefono: string }) => c.telefono === telefono)!.id;

      const res = await clienteDetalleGET(
        reqTenant(`http://localhost/api/agenda/${AMORE_TOKEN_MARY}/clientes/${clienteId}`),
        paramsTokenId(AMORE_TOKEN_MARY, String(clienteId))
      );
      const body = await res.json();
      assert.equal(body.cliente.nombre, "Detalle Historial");
      assert.equal(body.historial.length, 1);
      assert.ok((body.historial[0].servicio as string).toLowerCase().includes("uña"));
      assert.equal(body.historial[0].profesional, "Cristal");
      assert.ok(body.historial[0].inicio);
      assert.equal(body.historial[0].estado, "pendiente");
    });

    it("10/11/12. aislamiento: clientes de Daniela y Solo Talento NUNCA aparecen en AMORE, y nada de ellos se modifica", async (t) => {
      if (sesionRequerida) return t.skip("AMORE ya tiene Login habilitado -- esta prueba llama la ruta HTTP sin cookie de sesión");
      const { data: danielaClientesAntes } = await supabase.from("dulabs_clientes_conocidos").select("id").eq("id_tenant", DANIELA_TENANT_ID).limit(1);
      const { data: soloClientesAntes } = await supabase.from("dulabs_clientes_conocidos").select("id").eq("id_tenant", SOLOTALENTO_TENANT_ID).limit(1);

      const res = await clientesGET(reqTenant(`http://localhost/api/agenda/${AMORE_TOKEN_MARY}/clientes`), paramsToken(AMORE_TOKEN_MARY));
      const body = await res.json();
      const { data: telefonosAmoreReales } = await supabase.from("dulabs_clientes_conocidos").select("telefono_cliente").eq("id_tenant", AMORE_TENANT_ID);
      const setAmore = new Set((telefonosAmoreReales ?? []).map((c) => c.telefono_cliente));
      assert.ok(
        (body.clientes as { telefono: string }[]).every((c) => setAmore.has(c.telefono)),
        "el panel de AMORE nunca debe listar un teléfono que no sea de su propio tenant"
      );

      const { data: danielaClientesDespues } = await supabase.from("dulabs_clientes_conocidos").select("id").eq("id_tenant", DANIELA_TENANT_ID).limit(1);
      const { data: soloClientesDespues } = await supabase.from("dulabs_clientes_conocidos").select("id").eq("id_tenant", SOLOTALENTO_TENANT_ID).limit(1);
      assert.deepEqual(danielaClientesAntes, danielaClientesDespues, "clientes de Daniela sin cambios");
      assert.deepEqual(soloClientesAntes, soloClientesDespues, "clientes de Solo Talento sin cambios");
    });

    it("un id de cliente que pertenece a OTRO tenant nunca es visible desde el token de AMORE (aislamiento por id)", async (t) => {
      if (sesionRequerida) return t.skip("AMORE ya tiene Login habilitado -- esta prueba llama la ruta HTTP sin cookie de sesión");
      const { data: clienteDaniela } = await supabase
        .from("dulabs_clientes_conocidos")
        .select("id")
        .eq("id_tenant", DANIELA_TENANT_ID)
        .limit(1)
        .maybeSingle();
      if (!clienteDaniela) return; // defensivo -- no se asume que Daniela siempre tiene clientes en este entorno
      const res = await clienteDetalleGET(
        reqTenant(`http://localhost/api/agenda/${AMORE_TOKEN_MARY}/clientes/${clienteDaniela.id}`),
        paramsTokenId(AMORE_TOKEN_MARY, String(clienteDaniela.id))
      );
      assert.equal(res.status, 404);
    });

    // ------------------------------------------------------------------
    // NUEVA FASE (autorizado) -- crear/editar cliente desde el admin (item 4
    // y 8 del pedido). Mismo criterio de identidad que el registro real por
    // WhatsApp: para AMORE, "whatsapp-qr:<tenant>" (ver ./identidad.ts) --
    // así un cliente creado a mano queda EXACTAMENTE igual que uno que
    // escribió por WhatsApp, nunca un registro paralelo.
    // ------------------------------------------------------------------
    it("POST /clientes crea un cliente nuevo, normaliza el WhatsApp y persiste cumpleaños/correo", async (t) => {
      if (sesionRequerida) return t.skip("AMORE ya tiene Login habilitado -- esta prueba llama la ruta HTTP sin cookie de sesión");
      const telefono = `test-clientes-admin-${randomUUID().slice(0, 8)}`;
      telefonosPrueba.push(telefono);

      const res = await clientesPOST(
        reqPost(`http://localhost/api/agenda/${AMORE_TOKEN_MARY}/clientes`, {
          nombre: "Cliente Creado Desde Admin",
          telefono,
          correo: "cliente@ejemplo.com",
          cumpleDia: 10,
          cumpleMes: 12,
        }),
        paramsToken(AMORE_TOKEN_MARY)
      );
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.yaExistia, false);
      assert.equal(body.cliente.nombre, "Cliente Creado Desde Admin");
      assert.equal(body.cliente.telefono, telefono);
      assert.equal(body.cliente.correo, "cliente@ejemplo.com");
      assert.equal(body.cliente.cumpleDia, 10);
      assert.equal(body.cliente.cumpleMes, 12);

      // Queda EXACTAMENTE en la misma tabla/identidad que usa el registro
      // real por WhatsApp -- una futura conversación real de esta clienta la
      // reconoce, nunca crea un segundo registro.
      const { data: fila } = await supabase
        .from("dulabs_clientes_conocidos")
        .select("phone_number_id")
        .eq("id_tenant", AMORE_TENANT_ID)
        .eq("telefono_cliente", telefono)
        .single();
      assert.equal(fila!.phone_number_id, `whatsapp-qr:${AMORE_TENANT_ID}`);
    });

    it("POST /clientes con un WhatsApp que ya existe -> NUNCA duplica, entrega el cliente existente", async (t) => {
      if (sesionRequerida) return t.skip("AMORE ya tiene Login habilitado -- esta prueba llama la ruta HTTP sin cookie de sesión");
      const telefono = `test-clientes-admin-${randomUUID().slice(0, 8)}`;
      telefonosPrueba.push(telefono);
      const primero = await clientesPOST(
        reqPost(`http://localhost/api/agenda/${AMORE_TOKEN_MARY}/clientes`, { nombre: "Primera Vez", telefono }),
        paramsToken(AMORE_TOKEN_MARY)
      );
      const primerBody = await primero.json();
      assert.equal(primerBody.yaExistia, false);

      const segundo = await clientesPOST(
        // Mismo número, con espacios/+ -- debe normalizar igual y encontrar el mismo cliente.
        reqPost(`http://localhost/api/agenda/${AMORE_TOKEN_MARY}/clientes`, { nombre: "Intento Duplicado", telefono: `+57 ${telefono.replace(/^57/, "")}` }),
        paramsToken(AMORE_TOKEN_MARY)
      );
      const segundoBody = await segundo.json();
      assert.equal(segundoBody.yaExistia, true);
      assert.equal(segundoBody.cliente.id, primerBody.cliente.id);
      assert.equal(segundoBody.cliente.nombre, "Primera Vez", "nunca sobrescribe el existente en silencio");

      const { data: filas } = await supabase.from("dulabs_clientes_conocidos").select("id").eq("id_tenant", AMORE_TENANT_ID).eq("telefono_cliente", telefono);
      assert.equal(filas!.length, 1, "nunca debe quedar una fila duplicada");
    });

    it("PATCH /clientes/[id] edita nombre/WhatsApp/cumpleaños/correo y persiste de verdad", async (t) => {
      if (sesionRequerida) return t.skip("AMORE ya tiene Login habilitado -- esta prueba llama la ruta HTTP sin cookie de sesión");
      const telefonoOriginal = `test-clientes-admin-${randomUUID().slice(0, 8)}`;
      const telefonoNuevo = `test-clientes-admin-${randomUUID().slice(0, 8)}`;
      telefonosPrueba.push(telefonoOriginal, telefonoNuevo);

      const creado = await clientesPOST(
        reqPost(`http://localhost/api/agenda/${AMORE_TOKEN_MARY}/clientes`, { nombre: "Nombre Original", telefono: telefonoOriginal }),
        paramsToken(AMORE_TOKEN_MARY)
      );
      const clienteId = (await creado.json()).cliente.id;

      const editado = await clienteDetallePATCH(
        reqPatch(`http://localhost/api/agenda/${AMORE_TOKEN_MARY}/clientes/${clienteId}`, {
          nombre: "Nombre Editado",
          telefono: telefonoNuevo,
          correo: "editado@ejemplo.com",
          cumpleDia: 25,
          cumpleMes: 6,
        }),
        paramsTokenId(AMORE_TOKEN_MARY, String(clienteId))
      );
      const body = await editado.json();
      assert.equal(editado.status, 200, JSON.stringify(body));
      assert.equal(body.cliente.nombre, "Nombre Editado");
      assert.equal(body.cliente.telefono, telefonoNuevo);
      assert.equal(body.cliente.correo, "editado@ejemplo.com");
      assert.equal(body.cliente.cumpleDia, 25);
      assert.equal(body.cliente.cumpleMes, 6);

      const detalle = await clienteDetalleGET(
        reqTenant(`http://localhost/api/agenda/${AMORE_TOKEN_MARY}/clientes/${clienteId}`),
        paramsTokenId(AMORE_TOKEN_MARY, String(clienteId))
      );
      const detalleBody = await detalle.json();
      assert.equal(detalleBody.cliente.nombre, "Nombre Editado");
      assert.equal(detalleBody.cliente.telefono, telefonoNuevo);
    });

    it("PATCH /clientes/[id] con un id de OTRO tenant -> 404, nunca edita datos ajenos", async (t) => {
      if (sesionRequerida) return t.skip("AMORE ya tiene Login habilitado -- esta prueba llama la ruta HTTP sin cookie de sesión");
      const { data: clienteDaniela } = await supabase.from("dulabs_clientes_conocidos").select("id").eq("id_tenant", DANIELA_TENANT_ID).limit(1).maybeSingle();
      if (!clienteDaniela) return;
      const res = await clienteDetallePATCH(
        reqPatch(`http://localhost/api/agenda/${AMORE_TOKEN_MARY}/clientes/${clienteDaniela.id}`, { nombre: "Intento De Edicion Ajena" }),
        paramsTokenId(AMORE_TOKEN_MARY, String(clienteDaniela.id))
      );
      assert.equal(res.status, 404);
    });
  }
);
