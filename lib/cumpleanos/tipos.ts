// Cumpleaños automáticos (Fase 6A, genérico para DuLabs, autorizado) —
// tipos compartidos por todo el módulo. AMORE es el primer tenant que lo
// usa, pero nada acá lo menciona: todo llega parametrizado por idTenant.

export type ConfigCumpleanos = {
  idTenant: string;
  activo: boolean;
  mensaje: string;
  nombreNegocio: string | null;
  horaEnvio: string;
  zonaHoraria: string;
};

export type ClienteCumpleanos = {
  id: number;
  idTenant: string;
  phoneNumberId: string;
  telefonoCliente: string;
  nombre: string;
  cumpleDia: number;
  cumpleMes: number;
};
