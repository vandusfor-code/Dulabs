import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  construirOpcionesCita,
  renderizarMenuCitas,
  textoSeleccionInvalidaCitas,
  resolverSeleccionCita,
  renderizarConsultaCita,
  OPCIONES_SI_NO,
  resolverSeleccionSiNo,
  textoSeleccionInvalidaSiNo,
  renderizarConfirmacionCancelar,
  renderizarConfirmacionReprogramarInicio,
  renderizarReprogramacionExitosa,
  MENSAJE_SIN_CITAS_FUTURAS,
  MENSAJE_CITA_CANCELADA,
  MENSAJE_ERROR_CANCELACION,
  type CitaParaMenu,
} from "@/lib/agenda-v2/gestion-citas";

const CITAS: CitaParaMenu[] = [
  { citaId: 101, servicioNombre: "Células Madres", profesionalNombre: "Jessica", fechaEtiqueta: "Martes 8 de septiembre", horaTexto: "4:00 p. m." },
  { citaId: 102, servicioNombre: "Cejas con Cera", profesionalNombre: "Mary", fechaEtiqueta: "Jueves 10 de septiembre", horaTexto: "2:00 p. m." },
];

describe("construirOpcionesCita -- exclusivamente las citas reales recibidas, nunca inventadas", () => {
  it("numera en orden y conserva el citaId real de cada una", () => {
    const opciones = construirOpcionesCita(CITAS);
    assert.deepEqual(opciones, [
      { numero: 1, citaId: 101, servicioNombre: "Células Madres", profesionalNombre: "Jessica", fechaEtiqueta: "Martes 8 de septiembre", horaTexto: "4:00 p. m." },
      { numero: 2, citaId: 102, servicioNombre: "Cejas con Cera", profesionalNombre: "Mary", fechaEtiqueta: "Jueves 10 de septiembre", horaTexto: "2:00 p. m." },
    ]);
  });

  it("lista vacía -> opciones vacías, nunca inventa una cita", () => {
    assert.deepEqual(construirOpcionesCita([]), []);
  });
});

describe("renderizarMenuCitas -- texto siempre reconstruido desde datos reales", () => {
  it("incluye cada cita numerada con servicio, profesional, fecha y hora reales", () => {
    const texto = renderizarMenuCitas(construirOpcionesCita(CITAS));
    assert.match(texto, /Encontré estas citas/);
    assert.match(texto, /1\. Células Madres — Jessica/);
    assert.match(texto, /Martes 8 de septiembre · 4:00 p\. m\./);
    assert.match(texto, /2\. Cejas con Cera — Mary/);
    assert.match(texto, /Jueves 10 de septiembre · 2:00 p\. m\./);
    assert.match(texto, /Selecciona la cita que deseas gestionar/);
  });
});

describe("resolverSeleccionCita -- SOLO número exacto contra las opciones ya mostradas, nunca fuzzy", () => {
  const opciones = construirOpcionesCita(CITAS);

  it("número exacto resuelve la cita real correspondiente", () => {
    assert.equal(resolverSeleccionCita("1", opciones)?.citaId, 101);
    assert.equal(resolverSeleccionCita("2", opciones)?.citaId, 102);
  });

  it("número con espacios alrededor también resuelve", () => {
    assert.equal(resolverSeleccionCita("  1  ", opciones)?.citaId, 101);
  });

  it("número fuera de rango o texto no numérico -> undefined, nunca fuzzy ni por nombre", () => {
    assert.equal(resolverSeleccionCita("3", opciones), undefined);
    assert.equal(resolverSeleccionCita("0", opciones), undefined);
    assert.equal(resolverSeleccionCita("Jessica", opciones), undefined);
    assert.equal(resolverSeleccionCita("la de células madres", opciones), undefined);
  });

  it("textoSeleccionInvalidaCitas reenvía EXACTAMENTE las mismas opciones", () => {
    const texto = textoSeleccionInvalidaCitas(opciones);
    assert.match(texto, /No reconocí esa opción/);
    assert.match(texto, /1\. Células Madres — Jessica/);
    assert.match(texto, /2\. Cejas con Cera — Mary/);
  });
});

describe("MENSAJE_SIN_CITAS_FUTURAS -- texto exacto pedido", () => {
  it("coincide con el texto exacto de la sección CONSULTAR CITA", () => {
    assert.equal(MENSAJE_SIN_CITAS_FUTURAS, "No encontramos citas futuras a tu nombre. 💗");
  });
});

describe("renderizarConsultaCita -- EXCLUSIVAMENTE los datos reales recibidos, incluido el Estado real", () => {
  it("incluye servicio, profesional, fecha, hora, duración, valor y estado reales", () => {
    const texto = renderizarConsultaCita({
      servicioNombre: "Células Madres",
      profesionalNombre: "Jessica",
      fechaEtiqueta: "Martes 8 de septiembre",
      horaTexto: "4:00 p. m.",
      duracionMin: 120,
      precio: 100000,
      estado: "confirmada",
    });
    assert.match(texto, /Esta es tu próxima cita/);
    assert.match(texto, /Servicio: Células Madres/);
    assert.match(texto, /Profesional: Jessica/);
    assert.match(texto, /Fecha: Martes 8 de septiembre/);
    assert.match(texto, /Hora: 4:00 p\. m\./);
    assert.match(texto, /Duración: 2 h/);
    assert.match(texto, /Valor: \$100\.000/);
    assert.match(texto, /Estado: Confirmada/);
  });

  it("estado 'pendiente' se muestra con su propia etiqueta real, nunca inventada", () => {
    const texto = renderizarConsultaCita({
      servicioNombre: "Manicure",
      profesionalNombre: "Nata",
      fechaEtiqueta: "Lunes 7 de septiembre",
      horaTexto: "10:00 a. m.",
      duracionMin: 60,
      precio: 40000,
      estado: "pendiente",
    });
    assert.match(texto, /Estado: Pendiente de aprobación/);
  });
});

describe("OPCIONES_SI_NO / resolverSeleccionSiNo -- SOLO número exacto (1-2), nunca 'sí'/'no' en texto libre", () => {
  it("1=sí, 2=no, en ese orden exacto", () => {
    assert.deepEqual(OPCIONES_SI_NO, [
      { numero: 1, accion: "si" },
      { numero: 2, accion: "no" },
    ]);
  });

  it("número exacto resuelve la acción correspondiente", () => {
    assert.equal(resolverSeleccionSiNo("1", OPCIONES_SI_NO)?.accion, "si");
    assert.equal(resolverSeleccionSiNo("2", OPCIONES_SI_NO)?.accion, "no");
  });

  it("texto libre ('sí', 'no', 'dale', 'claro') -> siempre undefined, nunca se infiere", () => {
    for (const texto of ["sí", "si", "no", "dale", "claro", "obvio"]) {
      assert.equal(resolverSeleccionSiNo(texto, OPCIONES_SI_NO), undefined, `"${texto}" nunca debe resolver -- solo número exacto`);
    }
  });

  it("textoSeleccionInvalidaSiNo incluye las 2 opciones", () => {
    const texto = textoSeleccionInvalidaSiNo();
    assert.match(texto, /1\. Sí/);
    assert.match(texto, /2\. No/);
  });
});

describe("renderizarConfirmacionCancelar -- EXCLUSIVAMENTE los datos reales recibidos, texto exacto pedido", () => {
  it("incluye servicio, profesional, fecha, hora reales y el menú 1/2 exacto", () => {
    const texto = renderizarConfirmacionCancelar({
      servicioNombre: "Células Madres",
      profesionalNombre: "Jessica",
      fechaEtiqueta: "Martes 8 de septiembre",
      horaTexto: "4:00 p. m.",
    });
    assert.match(texto, /Vas a cancelar esta cita/);
    assert.match(texto, /Servicio: Células Madres/);
    assert.match(texto, /Profesional: Jessica/);
    assert.match(texto, /Fecha: Martes 8 de septiembre/);
    assert.match(texto, /Hora: 4:00 p\. m\./);
    assert.match(texto, /1\. Sí, cancelar/);
    assert.match(texto, /2\. No, conservar cita/);
  });
});

describe("MENSAJE_CITA_CANCELADA / MENSAJE_ERROR_CANCELACION -- textos exactos pedidos", () => {
  it("textos exactos", () => {
    assert.equal(MENSAJE_CITA_CANCELADA, "Tu cita fue cancelada correctamente. 💗");
    assert.equal(MENSAJE_ERROR_CANCELACION, "No pudimos cancelar tu cita en este momento. Por favor intenta nuevamente.");
  });
});

describe("renderizarConfirmacionReprogramarInicio -- muestra la cita ACTUAL real antes de tocar nada", () => {
  it("incluye servicio/profesional/fecha/hora reales de la cita actual y el menú 1/2", () => {
    const texto = renderizarConfirmacionReprogramarInicio({
      servicioNombre: "Cejas con Cera",
      profesionalNombre: "Mary",
      fechaEtiqueta: "Jueves 10 de septiembre",
      horaTexto: "2:00 p. m.",
    });
    assert.match(texto, /Esta es tu cita actual/);
    assert.match(texto, /Servicio: Cejas con Cera/);
    assert.match(texto, /1\. Sí, reprogramar/);
    assert.match(texto, /2\. No, mantener cita/);
  });
});

describe("renderizarReprogramacionExitosa -- EXCLUSIVAMENTE los datos reales de la NUEVA fecha/hora", () => {
  it("incluye servicio/profesional reales y la NUEVA fecha/hora, nunca la anterior", () => {
    const texto = renderizarReprogramacionExitosa({
      servicioNombre: "Cejas con Cera",
      profesionalNombre: "Mary",
      fechaEtiqueta: "Viernes 11 de septiembre",
      horaTexto: "5:00 p. m.",
    });
    assert.match(texto, /¡Listo! 💗 Tu cita fue reprogramada/);
    assert.match(texto, /Servicio: Cejas con Cera/);
    assert.match(texto, /Profesional: Mary/);
    assert.match(texto, /Nueva fecha: Viernes 11 de septiembre/);
    assert.match(texto, /Nueva hora: 5:00 p\. m\./);
    assert.doesNotMatch(texto, /Jueves 10 de septiembre|2:00 p\. m\./, "nunca debe mostrar la fecha/hora anterior");
  });
});
