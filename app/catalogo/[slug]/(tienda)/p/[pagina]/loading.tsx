// Mientras llega una página propia (política, términos…): un esqueleto de texto, no la rejilla de productos del resto de la tienda. Ocupa toda la pantalla para que el pie (que ya está en el marco)
// quede debajo del pliegue y no «salte» al llegar el contenido.
export default function CargandoPagina() {
  return (
    <div className="joy-esqueleto animate-pulse" role="status" aria-label="Cargando">
      <div className="mx-auto max-w-3xl px-2 pt-12 sm:px-4">
        <div className="mx-auto h-9 w-2/3 rounded-lg bg-ink-2" />
        <div className="mx-auto mt-4 h-3 w-40 rounded bg-ink-2" />
        <div className="mt-12 space-y-3">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className={`h-3.5 rounded bg-ink-2 ${i % 4 === 3 ? "w-1/2" : "w-full"}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
