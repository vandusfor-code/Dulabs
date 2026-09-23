// Estado de carga de la tienda entre vistas (inicio, listado, ficha): el
// header, la navegación y el carrito del layout siguen visibles; solo el
// contenido muestra un esqueleto sobrio mientras llega el HTML del servidor.
export default function CargandoTienda() {
  return (
    <div className="animate-pulse pt-4 sm:pt-6" role="status" aria-label="Cargando">
      <div className="aspect-[4/3] w-full rounded-[26px] bg-ink-2 sm:aspect-[16/9] lg:aspect-[21/9]" />
      <div className="mt-8 h-7 w-56 rounded-lg bg-ink-2" />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-[20px] bg-card">
            <div className="aspect-square bg-ink-2" />
            <div className="space-y-2 p-3.5">
              <div className="h-3.5 w-3/4 rounded bg-ink-2" />
              <div className="h-3 w-1/3 rounded bg-ink-2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
