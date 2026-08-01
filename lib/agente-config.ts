import type ExcelJS from "exceljs";
import { celdaATexto, normalizarEncabezado, mapearColumnas } from "@/lib/archivo-texto";
import { normalizarTelefono } from "@/lib/marketplace-store";

// Parser de la plantilla de configuración de un agente del Marketplace
// (public/plantillas/agente-config-plantilla.xlsx, generada por
// scripts/generar-plantilla-agente-config.mjs): una hoja con columnas
// Campo | Valor. El único campo que se lee de forma estructurada es el
// "Número admin"; el resto es texto libre del negocio que se usa como base
// de conocimiento del agente (igual que cualquier archivo de Base de
// Conocimiento — la IA ya lo interpreta hoy).

export interface ConfigAgenteNegocio {
  /** Teléfono admin normalizado (solo dígitos, con código de país), o null. */
  numeroAdmin: string | null;
  nombreAdmin: string | null;
  /** Todos los campos del negocio como "Campo: Valor", para la base de conocimiento. */
  textoNegocio: string;
}

export function parseConfigAgente(libro: ExcelJS.Workbook): ConfigAgenteNegocio | null {
  const hoja = libro.worksheets[0];
  if (!hoja) return null;
  const columnas = mapearColumnas(hoja);
  const colCampo = columnas.get("campo");
  const colValor = columnas.get("valor");
  if (!colCampo || !colValor) return null; // no coincide con la plantilla oficial

  let numeroAdmin: string | null = null;
  let nombreAdmin: string | null = null;
  const lineas: string[] = [];

  hoja.eachRow((fila, numeroFila) => {
    if (numeroFila === 1) return;
    const campo = celdaATexto(fila.getCell(colCampo).value).trim();
    const valor = celdaATexto(fila.getCell(colValor).value).trim();
    if (!campo || !valor) return;
    const campoNorm = normalizarEncabezado(campo);
    if (campoNorm.startsWith("numero admin")) {
      numeroAdmin = normalizarTelefono(valor);
      return;
    }
    if (campoNorm.startsWith("nombre del admin") || campoNorm.startsWith("nombre admin")) {
      nombreAdmin = valor;
      return;
    }
    lineas.push(`${campo}: ${valor}`);
  });

  if (lineas.length === 0 && !numeroAdmin) return null;
  return { numeroAdmin, nombreAdmin, textoNegocio: lineas.join("\n") };
}
