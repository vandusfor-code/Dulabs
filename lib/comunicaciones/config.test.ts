/**
 * Ajuste final (autorizado) — recordatorios: mensajes predeterminados +
 * anticipación real. `obtenerConfigComunicaciones` se prueba con Supabase
 * FALSO en memoria (nunca real); la persistencia/idempotencia del
 * guardado (upsert real) se prueba contra Supabase real pero con un tenant
 * 100% desechable (UUID al azar, nunca AMORE ni ningún tenant real),
 * limpiado en `after()`. Ningún WhatsApp real se envía en ningún test de
 * este archivo (este módulo nunca envía nada, solo lee/guarda configuración).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  obtenerConfigComunicaciones,
  MENSAJE_CONFIRMACION_PREDETERMINADO,
  MENSAJE_RECORDATORIO_PREDETERMINADO,
  RECORDATORIO_ANTICIPACION_HORAS_REAL,
  RECORDATORIO_ANTICIPACION_MINUTOS_PREDETERMINADA,
} from "./config";
import { renderizarMensajeComunicacion } from "./mensaje";
import { ANTICIPACIONES_RECORDATORIO_MINUTOS } from "./tipos";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

type FilaConfig = {
  id_tenant: string;
  confirmacion_activa: boolean;
  confirmacion_mensaje: string;
  recordatorio_activo: boolean;
  recordatorio_anticipacion_horas: number;
  recordatorio_anticipacion_minutos?: number;
  recordatorio_mensaje: string;
};

function crearFakeSupabaseConfig(fila: FilaConfig | null) {
  const from = (tabla: string) => {
    if (tabla !== "dulabs_comunicaciones_config") throw new Error(`fake de prueba: tabla inesperada "${tabla}"`);
    return {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      then(resolve: (r: { data: FilaConfig | null; error: null }) => unknown) {
        return resolve({ data: fila, error: null });
      },
      maybeSingle() {
        return Promise.resolve({ data: fila, error: null });
      },
    };
  };
  return { from } as unknown as SupabaseClient;
}

describe("obtenerConfigComunicaciones -- mensajes predeterminados (Test 1/2 del pedido)", () => {
  it("Test 1 -- sin fila guardada: mensaje de confirmación predeterminado EXACTO", async () => {
    const supabase = crearFakeSupabaseConfig(null);
    const config = await obtenerConfigComunicaciones(supabase, randomUUID());
    assert.equal(config.confirmacionMensaje, MENSAJE_CONFIRMACION_PREDETERMINADO);
    assert.equal(
      config.confirmacionMensaje,
      "Hola, {{nombre}}. 💗\n\nTu cita en AMORE ha sido confirmada.\n\nServicio: {{servicio}}\nProfesional: {{profesional}}\nFecha: {{fecha}}\nHora: {{hora}}\n\nTe esperamos. ✨",
    );
  });

  it("Test 2 -- sin fila guardada: mensaje de recordatorio predeterminado EXACTO", async () => {
    const supabase = crearFakeSupabaseConfig(null);
    const config = await obtenerConfigComunicaciones(supabase, randomUUID());
    assert.equal(config.recordatorioMensaje, MENSAJE_RECORDATORIO_PREDETERMINADO);
    assert.equal(
      config.recordatorioMensaje,
      "Hola, {{nombre}}. 💗\n\nTe recordamos que tienes una cita en AMORE.\n\nServicio: {{servicio}}\nProfesional: {{profesional}}\nFecha: {{fecha}}\nHora: {{hora}}\n\n¡Te esperamos! ✨",
    );
  });

  it("sin fila guardada: ambos tipos quedan desactivados por defecto (nunca 'activo por defecto')", async () => {
    const supabase = crearFakeSupabaseConfig(null);
    const config = await obtenerConfigComunicaciones(supabase, randomUUID());
    assert.equal(config.confirmacionActiva, false);
    assert.equal(config.recordatorioActivo, false);
  });

  it("Test 7 -- la anticipación predeterminada es 1 hora (la MISMA que ejecuta el cron real, nunca 24)", async () => {
    const supabase = crearFakeSupabaseConfig(null);
    const config = await obtenerConfigComunicaciones(supabase, randomUUID());
    assert.equal(config.recordatorioAnticipacionHoras, RECORDATORIO_ANTICIPACION_HORAS_REAL);
    assert.equal(config.recordatorioAnticipacionHoras, 1);
  });

  it("una fila YA existe pero con el mensaje todavía vacío (tenant que solo tocó un lado de la config): igual se muestra el predeterminado, nunca un campo vacío", async () => {
    const supabase = crearFakeSupabaseConfig({
      id_tenant: "t1",
      confirmacion_activa: false,
      confirmacion_mensaje: "",
      recordatorio_activo: true,
      recordatorio_anticipacion_horas: 1,
      recordatorio_mensaje: "Mi recordatorio personalizado",
    });
    const config = await obtenerConfigComunicaciones(supabase, "t1");
    assert.equal(config.confirmacionMensaje, MENSAJE_CONFIRMACION_PREDETERMINADO, "el lado vacío se rellena con el predeterminado");
    assert.equal(config.recordatorioMensaje, "Mi recordatorio personalizado", "el lado YA personalizado nunca se pisa con el predeterminado");
  });

  it("una fila con AMBOS mensajes personalizados: nunca se sobrescriben con los predeterminados", async () => {
    const supabase = crearFakeSupabaseConfig({
      id_tenant: "t1",
      confirmacion_activa: true,
      confirmacion_mensaje: "Confirmación personalizada de AMORE",
      recordatorio_activo: true,
      recordatorio_anticipacion_horas: 3,
      recordatorio_mensaje: "Recordatorio personalizado de AMORE",
    });
    const config = await obtenerConfigComunicaciones(supabase, "t1");
    assert.equal(config.confirmacionMensaje, "Confirmación personalizada de AMORE");
    assert.equal(config.recordatorioMensaje, "Recordatorio personalizado de AMORE");
    assert.equal(config.recordatorioAnticipacionHoras, 3, "una anticipación ya guardada explícitamente nunca se pisa con el default");
  });

  it("tieneConfiguracionGuardada -- false cuando nunca existió una fila (caso real de AMORE hoy)", async () => {
    const supabase = crearFakeSupabaseConfig(null);
    const config = await obtenerConfigComunicaciones(supabase, randomUUID());
    assert.equal(config.tieneConfiguracionGuardada, false);
  });

  it("tieneConfiguracionGuardada -- true en cuanto existe una fila real, aunque sea con valores predeterminados", async () => {
    const supabase = crearFakeSupabaseConfig({
      id_tenant: "t1",
      confirmacion_activa: false,
      confirmacion_mensaje: "",
      recordatorio_activo: false,
      recordatorio_anticipacion_horas: 1,
      recordatorio_mensaje: "",
    });
    const config = await obtenerConfigComunicaciones(supabase, "t1");
    assert.equal(config.tieneConfiguracionGuardada, true);
  });

  it("Mejora Recordatorios -- sin fila guardada, recordatorioAnticipacionMinutos usa el predeterminado real (60 min = 1 hora antes)", async () => {
    const supabase = crearFakeSupabaseConfig(null);
    const config = await obtenerConfigComunicaciones(supabase, randomUUID());
    assert.equal(config.recordatorioAnticipacionMinutos, RECORDATORIO_ANTICIPACION_MINUTOS_PREDETERMINADA);
    assert.equal(config.recordatorioAnticipacionMinutos, 60);
  });

  for (const minutos of ANTICIPACIONES_RECORDATORIO_MINUTOS) {
    it(`Mejora Recordatorios -- una anticipación guardada de ${minutos} minutos se lee EXACTA, nunca se cae al predeterminado`, async () => {
      const supabase = crearFakeSupabaseConfig({
        id_tenant: "t1",
        confirmacion_activa: false,
        confirmacion_mensaje: "",
        recordatorio_activo: true,
        recordatorio_anticipacion_horas: 1,
        recordatorio_anticipacion_minutos: minutos,
        recordatorio_mensaje: "Recordatorio real",
      });
      const config = await obtenerConfigComunicaciones(supabase, "t1");
      assert.equal(config.recordatorioAnticipacionMinutos, minutos);
    });
  }

  it("Mejora Recordatorios -- defensivo: un valor guardado fuera de las 9 opciones reales (dato viejo/corrupto) cae al predeterminado, nunca se pasa tal cual al motor", async () => {
    const supabase = crearFakeSupabaseConfig({
      id_tenant: "t1",
      confirmacion_activa: false,
      confirmacion_mensaje: "",
      recordatorio_activo: true,
      recordatorio_anticipacion_horas: 1,
      recordatorio_anticipacion_minutos: 999,
      recordatorio_mensaje: "Recordatorio real",
    });
    const config = await obtenerConfigComunicaciones(supabase, "t1");
    assert.equal(config.recordatorioAnticipacionMinutos, RECORDATORIO_ANTICIPACION_MINUTOS_PREDETERMINADA);
  });
});

describe("Test 3 -- variables correctamente sustituidas en los mensajes predeterminados (reutiliza renderizarMensajeComunicacion, sin cambios)", () => {
  const VARIABLES = { nombre: "Ana Pérez", servicio: "Sombreado de Cejas", profesional: "Jessica", fecha: "martes 8 de septiembre", hora: "4:00 p. m." };

  it("mensaje de confirmación predeterminado sustituye las 5 variables reales, nunca deja '{{...}}' sin reemplazar", () => {
    const texto = renderizarMensajeComunicacion(MENSAJE_CONFIRMACION_PREDETERMINADO, VARIABLES);
    assert.match(texto, /Hola, Ana Pérez\./);
    assert.match(texto, /Servicio: Sombreado de Cejas/);
    assert.match(texto, /Profesional: Jessica/);
    assert.match(texto, /Fecha: martes 8 de septiembre/);
    assert.match(texto, /Hora: 4:00 p\. m\./);
    assert.doesNotMatch(texto, /\{\{/, "nunca debe quedar una variable sin sustituir");
  });

  it("mensaje de recordatorio predeterminado sustituye las 5 variables reales, nunca deja '{{...}}' sin reemplazar", () => {
    const texto = renderizarMensajeComunicacion(MENSAJE_RECORDATORIO_PREDETERMINADO, VARIABLES);
    assert.match(texto, /Hola, Ana Pérez\./);
    assert.match(texto, /Te recordamos que tienes una cita en AMORE/);
    assert.match(texto, /Servicio: Sombreado de Cejas/);
    assert.match(texto, /Profesional: Jessica/);
    assert.match(texto, /Fecha: martes 8 de septiembre/);
    assert.match(texto, /Hora: 4:00 p\. m\./);
    assert.doesNotMatch(texto, /\{\{/);
  });
});

describe(
  "Guardado real de la configuración -- integración real, tenants desechables (Tests 4/5/6/8/9 del pedido)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const tenantsCreados: string[] = [];

    before(() => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    });

    after(async () => {
      if (!HAS_SUPABASE || tenantsCreados.length === 0) return;
      await supabase.from("dulabs_comunicaciones_config").delete().in("id_tenant", tenantsCreados);
    });

    /** MISMO upsert real, exacto, que ejecuta el PATCH de la ruta (onConflict: "id_tenant"). */
    async function guardar(idTenant: string, cambios: Partial<FilaConfig>) {
      const { error } = await supabase.from("dulabs_comunicaciones_config").upsert(
        {
          id_tenant: idTenant,
          confirmacion_activa: false,
          confirmacion_mensaje: "",
          recordatorio_activo: false,
          recordatorio_anticipacion_horas: 1,
          recordatorio_mensaje: "",
          ...cambios,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id_tenant" },
      );
      if (error) throw error;
    }

    it("Test 4/6 -- activar confirmación + guardar mensaje personalizado funciona", async () => {
      const tenant = randomUUID();
      tenantsCreados.push(tenant);
      await guardar(tenant, { confirmacion_activa: true, confirmacion_mensaje: "Mensaje personalizado de confirmación" });
      const config = await obtenerConfigComunicaciones(supabase, tenant);
      assert.equal(config.confirmacionActiva, true);
      assert.equal(config.confirmacionMensaje, "Mensaje personalizado de confirmación");
    });

    it("Test 5 -- persistencia después de 'recargar' (una nueva lectura real ve exactamente lo guardado)", async () => {
      const tenant = randomUUID();
      tenantsCreados.push(tenant);
      await guardar(tenant, { recordatorio_activo: true, recordatorio_mensaje: "Mensaje personalizado de recordatorio", recordatorio_anticipacion_horas: 2 });
      const primeraLectura = await obtenerConfigComunicaciones(supabase, tenant);
      const segundaLectura = await obtenerConfigComunicaciones(supabase, tenant); // simula "recargar la página"
      assert.deepEqual(segundaLectura, primeraLectura);
      assert.equal(segundaLectura.recordatorioMensaje, "Mensaje personalizado de recordatorio");
      assert.equal(segundaLectura.recordatorioAnticipacionHoras, 2);
    });

    it("Test 6 -- activación/desactivación: un guardado posterior que solo cambia el switch NUNCA borra el mensaje ya guardado", async () => {
      const tenant = randomUUID();
      tenantsCreados.push(tenant);
      await guardar(tenant, { confirmacion_activa: true, confirmacion_mensaje: "Mensaje que debe sobrevivir" });
      await guardar(tenant, { confirmacion_activa: false, confirmacion_mensaje: "Mensaje que debe sobrevivir" }); // mismo criterio que el PATCH real: reenvía el mensaje actual si no cambia
      const config = await obtenerConfigComunicaciones(supabase, tenant);
      assert.equal(config.confirmacionActiva, false, "el switch sí cambió");
      assert.equal(config.confirmacionMensaje, "Mensaje que debe sobrevivir", "el mensaje nunca se pierde solo por desactivar");
    });

    it("Test 8 -- no se crean configuraciones duplicadas: varios guardados seguidos del MISMO tenant siguen siendo UNA sola fila", async () => {
      const tenant = randomUUID();
      tenantsCreados.push(tenant);
      await guardar(tenant, { confirmacion_activa: true, confirmacion_mensaje: "v1" });
      await guardar(tenant, { confirmacion_activa: true, confirmacion_mensaje: "v2" });
      await guardar(tenant, { recordatorio_activo: true, recordatorio_mensaje: "v3" });
      const { count, error } = await supabase.from("dulabs_comunicaciones_config").select("id_tenant", { count: "exact", head: true }).eq("id_tenant", tenant);
      if (error) throw error;
      assert.equal(count, 1, "el upsert por id_tenant NUNCA debe crear una segunda fila");
    });

    it("Test 9 -- no afecta otros tenants: guardar la configuración de uno nunca toca la de otro", async () => {
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      tenantsCreados.push(tenantA, tenantB);
      await guardar(tenantA, { confirmacion_activa: true, confirmacion_mensaje: "Mensaje de A" });
      await guardar(tenantB, { confirmacion_activa: true, confirmacion_mensaje: "Mensaje de B" });
      const configA = await obtenerConfigComunicaciones(supabase, tenantA);
      const configB = await obtenerConfigComunicaciones(supabase, tenantB);
      assert.equal(configA.confirmacionMensaje, "Mensaje de A");
      assert.equal(configB.confirmacionMensaje, "Mensaje de B");
    });
  },
);
