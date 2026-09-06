/**
 * Base de conocimiento REAL de AMORE (autorizado) — datos de seed, tomados
 * del documento "AMORE_Base_de_Conocimiento_Inicial_para_Claude.docx"
 * (auditado antes de esta fase). Solo se importa desde el script de siembra
 * (scripts/_seed-conocimiento-amore.mts, que resuelve `nombreServicioReal`
 * contra dulabs_servicios por nombre EXACTO -- nunca aproximado -- antes de
 * insertar, así ningún servicio inexistente puede recibir ficha).
 *
 * Hallazgos de auditoría respetados acá:
 * - "Secado Rápido" y "Base Rubber" (Adicional) NO existen en dulabs_servicios
 *   -- el documento los proponía, pero AÚN no están en el catálogo real.
 *   NUNCA se incluyen en este seed (el script de siembra los rechazaría de
 *   todas formas por el FK real, pero ni siquiera se intenta).
 * - El documento tampoco trae ficha para "Celulas Madres" (sí existe en el
 *   catálogo real, categoría Cabello) -- se deja sin ficha a propósito
 *   (nunca se inventa una): el resolver ya maneja con honestidad un
 *   servicio real sin conocimiento general (fuente="no_confirmado").
 *
 * `fuente` es "conocimiento_general" en TODAS las filas -- ninguna de estas
 * explicaciones es un protocolo confirmado por AMORE, son explicación
 * profesional general (regla explícita del documento y del pedido).
 */
import type { FuenteConocimiento } from "@/lib/bot-escenarios/tipos";

export interface FichaConocimientoSeed {
  nombreServicioReal: string;
  fuente: FuenteConocimiento;
  queEs: string;
  paraQueSirve: string;
  limites: string;
}

export const AMORE_CONOCIMIENTO_SEED: FichaConocimientoSeed[] = [
  {
    nombreServicioReal: "Repolarizacion",
    fuente: "conocimiento_general",
    queEs:
      "La repolarización capilar es un tratamiento cosmético que suele combinar productos acondicionadores o reparadores para mejorar temporalmente la apariencia, suavidad y manejo del cabello.",
    paraQueSirve: "Puede ser una opción cuando la persona busca cabello con apariencia más hidratada, suave y manejable.",
    limites: "No afirmar fórmula, productos, temperatura, plancha, ingredientes ni protocolo específico de AMORE.",
  },
  {
    nombreServicioReal: "Peinado",
    fuente: "conocimiento_general",
    queEs: "Servicio de arreglo y estilizado del cabello para conseguir una forma o acabado determinado.",
    paraQueSirve: "Puede adaptarse a una ocasión, estilo o preferencia de la clienta.",
    limites: "No asumir que incluye lavado, secado, productos, accesorios o un estilo concreto si AMORE no lo ha confirmado.",
  },
  {
    nombreServicioReal: "Ondas",
    fuente: "conocimiento_general",
    queEs: "Estilizado del cabello para crear ondas o movimiento.",
    paraQueSirve: "Puede ser una opción para quienes buscan un acabado con movimiento y textura ondulada.",
    limites: "No afirmar técnica, herramienta, duración del peinado o productos específicos de AMORE.",
  },
  {
    nombreServicioReal: "Trenzas",
    fuente: "conocimiento_general",
    queEs: "Estilizado del cabello mediante la creación de trenzas.",
    paraQueSirve: "Puede utilizarse como acabado estético o peinado para diferentes ocasiones.",
    limites: "No asumir tipo de trenza, cantidad, extensiones, accesorios o duración sin información de AMORE.",
  },
  {
    nombreServicioReal: "Cejas con Cera",
    fuente: "conocimiento_general",
    queEs: "Servicio de depilación/definición de cejas utilizando cera para retirar vello no deseado.",
    paraQueSirve: "Generalmente se utiliza para limpiar y definir la forma de la ceja.",
    limites: "No afirmar tipo de cera, técnica exacta, productos posteriores ni resultados individuales.",
  },
  {
    nombreServicioReal: "Cejas con Cuchilla",
    fuente: "conocimiento_general",
    queEs: "Servicio de arreglo y definición de cejas mediante una cuchilla diseñada para retirar vello superficial.",
    paraQueSirve: "Puede utilizarse para limpiar y definir visualmente la ceja.",
    limites: "No afirmar técnica exacta, herramientas adicionales ni duración del resultado de AMORE.",
  },
  {
    nombreServicioReal: "Bozo",
    fuente: "conocimiento_general",
    queEs: "Servicio de depilación del vello de la zona del labio superior.",
    paraQueSirve: "Se realiza para retirar vello visible en esa zona y dejar una apariencia más limpia.",
    limites: "No afirmar método de depilación si no está especificado por AMORE.",
  },
  {
    nombreServicioReal: "Axilas",
    fuente: "conocimiento_general",
    queEs: "Servicio de depilación del vello de la zona de las axilas.",
    paraQueSirve: "Se realiza para retirar el vello de esa zona.",
    limites: "No afirmar método, productos o técnica si AMORE no lo ha especificado.",
  },
  {
    nombreServicioReal: "Media Pierna",
    fuente: "conocimiento_general",
    queEs: "Servicio de depilación enfocado en la parte media de las piernas.",
    paraQueSirve: "Puede utilizarse para retirar el vello de esa zona.",
    limites: "No afirmar método de depilación ni límites exactos de la zona sin confirmación.",
  },
  {
    nombreServicioReal: "Nariz",
    fuente: "conocimiento_general",
    queEs: "Servicio de depilación del vello visible de la zona de la nariz.",
    paraQueSirve: "Se realiza para retirar vello de esa zona.",
    limites: "No afirmar método, profundidad o productos utilizados.",
  },
  {
    nombreServicioReal: "Barbilla",
    fuente: "conocimiento_general",
    queEs: "Servicio de depilación del vello de la zona de la barbilla.",
    paraQueSirve: "Se utiliza para retirar vello visible y limpiar la apariencia de la zona.",
    limites: "No afirmar método de depilación sin confirmación.",
  },
  {
    nombreServicioReal: "Pestañas Punto a Punto",
    fuente: "conocimiento_general",
    queEs:
      "Servicio de aplicación de extensiones de pestañas en modalidad punto a punto, generalmente buscando un resultado definido y más personalizado que una tira completa.",
    paraQueSirve: "Puede ser una opción para realzar la mirada manteniendo una apariencia más segmentada.",
    limites: "No afirmar adhesivos, número de pestañas, curvatura, grosor, duración o cuidados específicos de AMORE.",
  },
  {
    nombreServicioReal: "Sombreado de Cejas",
    fuente: "conocimiento_general",
    queEs: "Servicio estético orientado a dar a las cejas una apariencia más definida y sombreada.",
    paraQueSirve: "Puede interesar a quienes buscan mayor definición visual de las cejas.",
    limites: "No afirmar que sea micropigmentación, maquillaje semipermanente o un procedimiento específico si AMORE no lo confirma.",
  },
  {
    nombreServicioReal: "Maquillaje Suave",
    fuente: "conocimiento_general",
    queEs: "Servicio de maquillaje orientado a un acabado más natural y sutil.",
    paraQueSirve: "Puede ser una opción para quienes prefieren un look discreto y ligero.",
    limites: "No afirmar productos, técnicas o elementos incluidos sin confirmación de AMORE.",
  },
  {
    nombreServicioReal: "Maquillaje pro",
    fuente: "conocimiento_general",
    queEs: "Servicio de maquillaje orientado a conseguir un acabado más elaborado o trabajado.",
    paraQueSirve: "Puede ser una opción para eventos, ocasiones especiales o quienes buscan un maquillaje más producido.",
    limites: "No afirmar productos, duración, pestañas, preparación de piel o técnicas incluidas.",
  },
  {
    nombreServicioReal: "Cambio De Esmalte",
    fuente: "conocimiento_general",
    queEs: "Servicio orientado a cambiar el esmalte existente por otro acabado o color.",
    paraQueSirve: "Puede ser útil cuando la persona quiere renovar el color sin solicitar un servicio completo de uñas.",
    limites: "No asumir si incluye retiro de producto, preparación o tipo de esmalte.",
  },
  {
    nombreServicioReal: "Manos semi y Pies Tradi",
    fuente: "conocimiento_general",
    queEs: "Servicio combinado de manos con esmalte semipermanente y pies con acabado tradicional, según el nombre del catálogo.",
    paraQueSirve: "Puede ser una opción para quienes quieren atender manos y pies en una misma cita.",
    limites: "No asumir qué incluye exactamente el acabado tradicional ni el protocolo de AMORE.",
  },
  {
    nombreServicioReal: "Manos y Pies Semi",
    fuente: "conocimiento_general",
    queEs: "Servicio combinado de manos y pies con acabado semipermanente, según el nombre del catálogo.",
    paraQueSirve: "Puede ser una opción para quienes desean un acabado semipermanente en ambas zonas.",
    limites: "No afirmar preparación, productos, retiro o protocolo específico.",
  },
  {
    nombreServicioReal: "Press On",
    fuente: "conocimiento_general",
    queEs:
      "Los Press On son uñas prefabricadas que se colocan sobre las uñas naturales para conseguir rápidamente una forma, longitud o diseño determinado.",
    paraQueSirve: "Son una opción cuando se busca elegir un estilo o diseño y obtener un cambio visible en las uñas.",
    limites: "No afirmar sistema de adhesión, duración, reutilización, diseño incluido o protocolo específico de AMORE.",
  },
  {
    nombreServicioReal: "Retoques",
    fuente: "conocimiento_general",
    queEs: "Servicio de mantenimiento o retoque de un trabajo previo de uñas.",
    paraQueSirve: "Puede ser una opción para corregir o mantener un trabajo anterior.",
    limites: "No asumir qué trabajos acepta AMORE como retoque, plazo máximo desde la cita anterior ni condiciones.",
  },
  {
    nombreServicioReal: "Uña",
    fuente: "conocimiento_general",
    queEs: "Servicio individual relacionado con una uña, según el nombre del catálogo de AMORE.",
    paraQueSirve: "Puede ser útil cuando se necesita atender una uña específica.",
    limites: "No asumir exactamente qué procedimiento incluye el servicio.",
  },
  {
    nombreServicioReal: "Retiro Semi",
    fuente: "conocimiento_general",
    queEs: "Servicio destinado a retirar esmalte o producto semipermanente de las uñas.",
    paraQueSirve: "Puede solicitarse cuando se necesita retirar un semipermanente antes de realizar otro servicio o dejar la uña sin ese producto.",
    limites: "No afirmar método de retiro ni productos utilizados.",
  },
  {
    nombreServicioReal: "Retiro Sistemas",
    fuente: "conocimiento_general",
    queEs: "Servicio destinado al retiro de sistemas aplicados sobre las uñas.",
    paraQueSirve: "Puede solicitarse cuando la persona necesita retirar un sistema antes de otro servicio.",
    limites: "No afirmar qué sistemas específicos incluye ni el método exacto de retiro.",
  },
  {
    nombreServicioReal: "Caballero Manos y Pies",
    fuente: "conocimiento_general",
    queEs: "Servicio combinado de manos y pies dirigido específicamente a caballeros según el catálogo de AMORE.",
    paraQueSirve: "Puede ser una opción para quienes desean atender ambas zonas en una sola visita.",
    limites: "No afirmar tipo de esmalte, preparación o protocolo exacto.",
  },
  {
    nombreServicioReal: "Caballero Manos Semi y Pies Tradi",
    fuente: "conocimiento_general",
    queEs:
      "Servicio combinado para manos con esmalte semipermanente y pies con acabado tradicional, dirigido específicamente a caballeros según el catálogo.",
    paraQueSirve: "Puede ser una opción para quienes desean atender manos y pies en una misma visita.",
    limites: "No asumir qué incluye exactamente el servicio tradicional ni materiales.",
  },
  {
    nombreServicioReal: "Dipping",
    fuente: "conocimiento_general",
    queEs:
      "El Dipping es una técnica de uñas en la que se utiliza un sistema de polvo para crear una cobertura sobre la uña, normalmente con productos adhesivos o de resina.",
    paraQueSirve: "Generalmente se busca un acabado uniforme y una cobertura con sensación de estructura.",
    limites: "No afirmar productos, marcas, pasos exactos, resistencia, duración sobre la uña, retiro o protocolo específico de AMORE.",
  },
  {
    nombreServicioReal: "Caballero Manos Semi",
    fuente: "conocimiento_general",
    queEs: "Servicio de manos con esmalte semipermanente dirigido específicamente a caballeros según el nombre del catálogo de AMORE.",
    paraQueSirve: "Está pensado para el cuidado y acabado estético de las uñas de las manos.",
    limites: "No afirmar protocolo, preparación, color, retiro u otros elementos incluidos.",
  },
];
