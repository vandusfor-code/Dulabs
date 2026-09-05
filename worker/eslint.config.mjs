import tseslint from "typescript-eslint";

// WhatsApp Worker (Fase 9B) -- proyecto Node plano, sin React/Next, así que
// no reutiliza eslint-config-next del repo de Next (esas reglas no aplican
// acá). Config mínima: recomendaciones de typescript-eslint nada más.
export default tseslint.config(
  { ignores: ["node_modules/**"] },
  ...tseslint.configs.recommended
);
