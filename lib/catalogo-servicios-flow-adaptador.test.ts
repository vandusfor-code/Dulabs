/**
 * AMORE (Fase 2, autorizado) — pruebas contra el tenant REAL de AMORE ya
 * sembrado en la Fase 1 (id_tenant fijo, datos ficticios propios de AMORE,
 * nunca Daniela/Solo Talento). Ningún cambio a esos datos -- solo lectura.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  listarCatalogoServiciosReal,
  resolverServicioCatalogoReal,
  consultarDisponibilidadCatalogoReal,
  formatearDuracion,
  formatearCatalogoReal,
} from "@/lib/catalogo-servicios-flow-adaptador";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const AMORE_TENANT_ID = "ed6ae77f-8a0c-483e-a5d9-8ede68eca50f";

describe("formatearDuracion — pura", () => {
  it("minutos, horas exactas y horas con minutos", () => {
    assert.equal(formatearDuracion(15), "15 min");
    assert.equal(formatearDuracion(60), "1 h");
    assert.equal(formatearDuracion(120), "2 h");
    assert.equal(formatearDuracion(90), "1 h 30 min");
    assert.equal(formatearDuracion(180), "3 h");
  });
});

describe(
  "catalogo-servicios-flow-adaptador — integración real (tenant AMORE, solo lectura)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    let catalogo: Awaited<ReturnType<typeof listarCatalogoServiciosReal>>;

    it("1. listarCatalogoServiciosReal: 28 servicios reales de AMORE, con precio y duración", async () => {
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      catalogo = await listarCatalogoServiciosReal(supabase, AMORE_TENANT_ID);
      assert.equal(catalogo.length, 28);
      const una = catalogo.find((s) => s.nombre === "Uña");
      assert.ok(una);
      assert.equal(una!.precio, 8000);
      assert.equal(una!.duracionMin, 15);
      assert.equal(una!.categoria, "Uñas");
      // Los 2 "adicional" del Excel nunca se cargaron en la Fase 1.
      assert.equal(catalogo.some((s) => s.nombre === "Secado Rapido"), false);
      assert.equal(catalogo.some((s) => s.nombre === "Base Ruber"), false);
    });

    it("formatearCatalogoReal incluye nombre, precio Y duración (nunca solo el nombre)", () => {
      const texto = formatearCatalogoReal(catalogo.slice(0, 2));
      assert.match(texto, /\$\d/, "debe incluir precio formateado");
      assert.match(texto, /min|h/, "debe incluir duración formateada");
    });

    it("2/3/4. resolverServicioCatalogoReal por nombre exacto -> precio y duración reales", () => {
      const resultado = resolverServicioCatalogoReal({ servicios: catalogo, seleccionTipo: "nombre", seleccionNombre: "Uña" });
      assert.equal(resultado.ok, true);
      if (resultado.ok) {
        assert.equal(resultado.servicio.nombre, "Uña");
        assert.equal(resultado.servicio.precio, 8000);
        assert.equal(resultado.servicio.duracionMin, 15);
        assert.ok(resultado.servicio.id, "debe traer el id real del servicio");
      }
    });

    it("resolverServicioCatalogoReal por índice", () => {
      const resultado = resolverServicioCatalogoReal({ servicios: catalogo, seleccionTipo: "index", seleccionIndice: 1 });
      assert.equal(resultado.ok, true);
      if (resultado.ok) assert.equal(resultado.servicio.nombre, catalogo[0]!.nombre);
    });

    it("resolverServicioCatalogoReal ambiguo -> nunca inventa un servicio", () => {
      const resultado = resolverServicioCatalogoReal({ servicios: catalogo, seleccionTipo: "nombre", seleccionNombre: "semipermanente xyz que no existe" });
      assert.equal(resultado.ok, false);
    });

    it("7. servicio de UÑAS un martes real -> Cristal, Mary, Nata y Jessica, las 4 elegibles", async () => {
      const una = catalogo.find((s) => s.nombre === "Uña")!;
      const martes = "2026-09-08";
      const resultado = await consultarDisponibilidadCatalogoReal(supabase, { idTenant: AMORE_TENANT_ID, servicioId: una.id, fecha: martes });
      assert.equal(resultado.ok, true);
      if (resultado.ok) {
        const nombres = resultado.especialistas.map((e) => e.nombre).sort();
        assert.deepEqual(nombres, ["Cristal", "Jessica", "Mary", "Nata"]);
      }
    });

    it("8. servicio NO-uñas (Maquillaje Suave) un martes -> NUNCA ofrece a Cristal (ni a Nata)", async () => {
      const maquillaje = catalogo.find((s) => s.nombre === "Maquillaje Suave")!;
      const martes = "2026-09-08";
      const resultado = await consultarDisponibilidadCatalogoReal(supabase, { idTenant: AMORE_TENANT_ID, servicioId: maquillaje.id, fecha: martes });
      assert.equal(resultado.ok, true);
      if (resultado.ok) {
        const nombres = resultado.especialistas.map((e) => e.nombre).sort();
        assert.deepEqual(nombres, ["Jessica", "Mary"]);
        assert.ok(!nombres.includes("Cristal"));
      }
    });

    it("9. disponibilidad fuera de horario -> Jessica (15:00-20:00) nunca aparece con un huecos antes de las 3pm", async () => {
      const una = catalogo.find((s) => s.nombre === "Uña")!;
      const martes = "2026-09-08";
      const resultado = await consultarDisponibilidadCatalogoReal(supabase, { idTenant: AMORE_TENANT_ID, servicioId: una.id, fecha: martes });
      assert.equal(resultado.ok, true);
      if (resultado.ok) {
        const jessica = resultado.especialistas.find((e) => e.nombre === "Jessica")!;
        assert.ok(jessica.horarios.length > 0);
        assert.ok(jessica.horarios.every((h) => h >= "15:00"), `todos los horarios de Jessica deben ser >= 15:00, vino: ${jessica.horarios.join(",")}`);
        const cristal = resultado.especialistas.find((e) => e.nombre === "Cristal")!;
        assert.ok(cristal.horarios.every((h) => h >= "08:00" && h < "17:00"), "Cristal L-V es 08:00-17:00");
      }
    });

    it("10. domingo -> el salón está cerrado, cero horarios para cualquier profesional en cualquier servicio", async () => {
      const una = catalogo.find((s) => s.nombre === "Uña")!;
      const domingo = "2026-09-06";
      const resultado = await consultarDisponibilidadCatalogoReal(supabase, { idTenant: AMORE_TENANT_ID, servicioId: una.id, fecha: domingo });
      assert.equal(resultado.ok, true);
      if (resultado.ok) {
        assert.ok(resultado.especialistas.length > 0, "siguen apareciendo las elegibles, solo sin cupo");
        for (const e of resultado.especialistas) assert.equal(e.horarios.length, 0, `${e.nombre} no debería tener horarios el domingo`);
        assert.match(resultado.texto, /no encontré horarios/i);
      }
    });

    it("11. aislamiento: un servicio inexistente en OTRO tenant (Daniela) nunca se confunde con el de AMORE", async () => {
      const una = catalogo.find((s) => s.nombre === "Uña")!;
      const resultado = await consultarDisponibilidadCatalogoReal(supabase, {
        idTenant: "c64fac97-eff8-45f2-b691-30b3449da524", // Daniela real -- nunca se toca, solo se prueba que NO encuentra el servicio de AMORE
        servicioId: una.id,
        fecha: "2026-09-08",
      });
      assert.equal(resultado.ok, false);
      if (!resultado.ok) assert.equal(resultado.motivo, "servicio_no_encontrado");
    });
  },
);
