// Contenido de la línea "A la medida". Las categorías y ejemplos son los que el sitio ya publica (components/site/EnterpriseSections y
// /soluciones-empresariales); aquí solo se agrupan en 4 tarjetas. No hay clientes, logos, cifras ni plazos: el propio sitio aclara que la
// cotización y el tiempo dependen del alcance y que "no todos los proyectos incluyen todo esto".

export const CAPACIDADES_A_MEDIDA: { titulo: string; texto: string; items: string[] }[] = [
  {
    titulo: "Automatizaciones",
    texto: "Procesos y seguimientos que trabajan solos.",
    items: ["Automatización de procesos", "Seguimiento de clientes", "Flujos operativos personalizados"],
  },
  { titulo: "Integraciones", texto: "WhatsApp conectado con tus herramientas.", items: ["WhatsApp Cloud API", "CRM", "APIs y plataformas", "Bases de datos"] },
  { titulo: "Sistemas personalizados", texto: "Software hecho para tu operación.", items: ["CRM empresarial", "Sistemas internos", "Plataformas web", "Dashboards empresariales"] },
  {
    titulo: "Soluciones empresariales",
    texto: "Agentes y datos diseñados con tu equipo.",
    items: ["Agentes de IA personalizados", "Reportes", "Analítica", "Control operativo"],
  },
];
