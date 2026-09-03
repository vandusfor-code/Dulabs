"use client";

import { useMemo } from "react";
import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { danielaAgendarCitaFlow } from "@/lib/flows/daniela-agendar-cita.flow";
import { flowDefinitionToCanvas } from "@/lib/flow-builder/canvas-adapter";
import { FlowNodeCard } from "@/components/dashboard/flows/FlowNodeCard";

const nodeTypes: NodeTypes = { flowNode: FlowNodeCard };

/**
 * Etapa 0 (spike del Flow Builder, autorizado) — comprueba que
 * FlowDefinition -> canvas-adapter -> @xyflow/react funciona con un Flow
 * real. Ruta de desarrollo aislada, sin enlace en el menú principal.
 *
 * NO es el Builder: sin edición, sin guardar, sin publicar, sin llamadas a
 * /api/flows. Usa danielaAgendarCitaFlow() directo, sin copiar sus nodos.
 */
export default function FlowBuilderSpikePage() {
  const { nodes, edges } = useMemo(() => flowDefinitionToCanvas(danielaAgendarCitaFlow()), []);

  return (
    <div className="flex flex-col">
      <div className="border-b border-edge bg-card px-6 py-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-mist">Etapa 0 · Spike aislado — solo lectura</p>
        <h1 className="text-xl font-semibold text-fg">Flow Builder — prueba de canvas</h1>
        <p className="text-sm text-mist">
          Daniela — Agendar cita · {nodes.length} nodos · {edges.length} edges. Sin edición, sin guardar, sin publicar.
        </p>
      </div>
      <div className="h-[75vh] min-h-[560px] w-full">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
