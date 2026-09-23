import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cargarDatosNegocioAmore, formatearContextoNegocio, construirContextoNegocioAmore } from "@/lib/amore-contexto-negocio";
import { crearSupabaseEnMemoria } from "@/lib/test-helpers/supabase-en-memoria";
import { detectarSoloSaludo, instruccionConDatosReales } from "@/lib/amore-entrada-gemini";

const T = "tenant-amore";

function tablas() {
  return {
    dulabs_servicios: [
      { id: "s1", id_tenant: T, nombre: "Dipping", precio: 60000, duracion_min: 120, categoria: "Uñas", descripcion: null, activo: true },
      { id: "s2", id_tenant: T, nombre: "Press On", precio: 80000, duracion_min: 120, categoria: "Uñas", descripcion: null, activo: true },
      { id: "s3", id_tenant: T, nombre: "Repolarizacion", precio: null, duracion_min: 90, categoria: "Cabello", descripcion: null, activo: true },
      { id: "s4", id_tenant: T, nombre: "Servicio retirado", precio: 1000, duracion_min: 30, categoria: "Uñas", descripcion: null, activo: false },
      { id: "x1", id_tenant: "otro", nombre: "De otro tenant", precio: 5, duracion_min: 5, categoria: "Uñas", descripcion: null, activo: true },
    ],
    dulabs_bot_conocimiento: [
      { tenant_id: T, servicio_id: "s3", fuente: "conocimiento_general", que_es: "Tratamiento que mejora la apariencia del cabello.", para_que_sirve: "Cabello más manejable.", limites: "No afirmar productos ni protocolo.", activo: true },
    ],
    dulabs_servicio_especialista: [
      { id_tenant: T, servicio_id: "s1", especialista_id: 1 },
      { id_tenant: T, servicio_id: "s1", especialista_id: 2 },
      { id_tenant: T, servicio_id: "s1", especialista_id: 9 },
    ],
    dulabs_especialistas: [
      { id: 1, id_tenant: T, nombre: "Mary", activo: true },
      { id: 2, id_tenant: T, nombre: "Cristal", activo: true },
      { id: 9, id_tenant: T, nombre: "Ex empleada", activo: false },
    ],
  };
}

describe("contexto REAL del negocio para Gemini", () => {
  it("solo servicios ACTIVOS del tenant, con precio COP y duración reales", async () => {
    const texto = formatearContextoNegocio(await cargarDatosNegocioAmore(crearSupabaseEnMemoria(tablas()), T));
    assert.match(texto, /- Dipping: \$60\.000, 120 min aprox\./);
    assert.match(texto, /- Press On: \$80\.000, 120 min aprox\./);
    assert.doesNotMatch(texto, /Servicio retirado/, "un servicio inactivo nunca se ofrece");
    assert.doesNotMatch(texto, /De otro tenant/, "nunca datos de otro tenant");
    assert.match(texto, /lista COMPLETA/);
  });

  it("precio no registrado (null -> 0 en el catálogo) NUNCA se presenta como $0", async () => {
    const texto = formatearContextoNegocio(await cargarDatosNegocioAmore(crearSupabaseEnMemoria(tablas()), T));
    assert.match(texto, /- Repolarizacion: precio no registrado/);
    assert.doesNotMatch(texto, /\$0\b/);
  });

  it("quién realiza cada servicio: solo profesionales ACTIVAS con asociación explícita", async () => {
    const texto = formatearContextoNegocio(await cargarDatosNegocioAmore(crearSupabaseEnMemoria(tablas()), T));
    assert.match(texto, /Lo realizan: Mary, Cristal\./);
    assert.doesNotMatch(texto, /Ex empleada/);
  });

  it("fichas del documento oficial: qué es / para qué sirve / límites como restricción", async () => {
    const texto = formatearContextoNegocio(await cargarDatosNegocioAmore(crearSupabaseEnMemoria(tablas()), T));
    assert.match(texto, /Qué es: Tratamiento que mejora la apariencia del cabello\./);
    assert.match(texto, /NO afirmar: No afirmar productos ni protocolo\./);
  });

  it("caché corta por tenant: no repite las consultas dentro de 60 s, sí después", async () => {
    let consultas = 0;
    const base = crearSupabaseEnMemoria(tablas());
    const contando = { from: (t: string) => (consultas++, base.from(t)) } as unknown as typeof base;
    let ahora = 1_000_000;
    await construirContextoNegocioAmore(contando, "tenant-cache", () => ahora);
    const tras1 = consultas;
    ahora += 30_000;
    await construirContextoNegocioAmore(contando, "tenant-cache", () => ahora);
    assert.equal(consultas, tras1, "dentro de la ventana usa la caché");
    ahora += 31_000;
    await construirContextoNegocioAmore(contando, "tenant-cache", () => ahora);
    assert.ok(consultas > tras1, "vencida la ventana vuelve a leer los datos reales");
  });

  it("el bloque de datos reales va delimitado en la instrucción de sistema; sin datos, la instrucción queda igual", () => {
    const con = instruccionConDatosReales("- Dipping: $60.000");
    assert.match(con, /\[DATOS REALES DE AMORE[^\]]*\]\n- Dipping: \$60\.000\n\[FIN DE DATOS REALES\]$/);
    assert.equal(instruccionConDatosReales(undefined), instruccionConDatosReales(""));
    assert.doesNotMatch(instruccionConDatosReales(undefined), /DATOS REALES DE AMORE --/);
  });
});

describe("detectarSoloSaludo -- primer contacto: solo un saludo recibe el menú; cualquier necesidad se atiende", () => {
  it("saludos puros", () => {
    for (const m of ["Hola", "hola!", "Hola, buenas noches", "holaaaa", "Buenos días hermosa 💗", "buenas"]) assert.equal(detectarSoloSaludo(m), true, m);
  });
  it("un saludo con una necesidad NO es solo saludo", () => {
    for (const m of ["Hola, quiero una cita", "hola cuánto cuesta el dipping", "Hola hermosa, estoy mirando para una boda", "hola quiero con Cristal"]) {
      assert.equal(detectarSoloSaludo(m), false, m);
    }
  });
});
