// AMORE (Fase 3 del portal, autorizado) — identidad visual propia, distinta
// de la de Daniela (rosa/Cormorant Garamond+Parisienne): paleta burdeos +
// dorado sobre crema, un solo serif elegante (Playfair Display). Un único
// archivo de constantes para las 7 pantallas del portal de AMORE, en vez de
// repetir los mismos hex en cada componente (mismo espíritu que ya reduce
// duplicación en otras partes del proyecto, sin ser una arquitectura nueva:
// solo constantes, cero lógica).

export const AMORE = {
  burdeos: "#6B2737",
  burdeosSuave: "#F3E7E9",
  dorado: "#B08D57",
  doradoSuave: "#F1E9DA",
  fondo: "#FAF6EF",
  texto: "#1F1B1A",
  textoSecundario: "#6B625F",
  borde: "#E5DDD3",
  verde: "#3FA96A",
  verdeSuave: "#E9F7EF",
  rojo: "#B4232C",
  rojoSuave: "#FDECEC",
} as const;

export const serifAmore = { fontFamily: "var(--font-playfair-amore), 'Playfair Display', serif" };
