// Business Agent 2.0, FASE 6 — animaciones FUNCIONALES de la configuración guiada (acotadas a este módulo: clases con
// prefijo propio, sin tocar los estilos globales). Cortas (<= 700 ms), sin bucles salvo el indicador de "trabajando", y
// desactivadas con prefers-reduced-motion.

const CSS = `
@keyframes ba-onb-check-pop { 0% { transform: scale(.4); opacity: 0 } 70% { transform: scale(1.12); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }
@keyframes ba-onb-step-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: translateY(0) } }
@keyframes ba-onb-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes ba-onb-working { 0%, 100% { opacity: .35 } 50% { opacity: 1 } }
@keyframes ba-onb-celebrate { 0% { transform: scale(.97); box-shadow: 0 0 0 0 color-mix(in oklab, var(--color-lime) 55%, transparent) } 60% { transform: scale(1); box-shadow: 0 0 0 14px transparent } 100% { transform: scale(1); box-shadow: 0 0 0 0 transparent } }
.ba-onb-check-pop { animation: ba-onb-check-pop 320ms cubic-bezier(.2,.9,.3,1.2) both }
.ba-onb-step-in { animation: ba-onb-step-in 260ms ease-out both }
.ba-onb-fade-in { animation: ba-onb-fade-in 200ms ease-out both }
.ba-onb-working { animation: ba-onb-working 1.1s ease-in-out infinite }
.ba-onb-celebrate { animation: ba-onb-celebrate 700ms ease-out both }
@media (prefers-reduced-motion: reduce) {
  .ba-onb-check-pop, .ba-onb-step-in, .ba-onb-fade-in, .ba-onb-working, .ba-onb-celebrate { animation: none !important }
}`;

export const motion = {
  checkPop: "ba-onb-check-pop",
  stepIn: "ba-onb-step-in",
  fadeIn: "ba-onb-fade-in",
  working: "ba-onb-working",
  celebrate: "ba-onb-celebrate",
} as const;

/** Se monta una vez en la configuración guiada. */
export function MotionStyles() {
  return <style>{CSS}</style>;
}
