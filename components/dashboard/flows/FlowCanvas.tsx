"use client";

import { forwardRef, useCallback, useImperativeHandle, useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type IsValidConnection,
  type Node,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { CanvasEdge, CanvasNode } from "@/lib/flow-builder/canvas-adapter";
import { applySelectChanges } from "@/lib/flow-builder/selection-changes";
import type { FlowNodeType, NodePosition } from "@/lib/flow/types";
import { FLOW_NODE_DRAG_MIME } from "./FlowNodePalette";
import { FlowNodeCard } from "./FlowNodeCard";

const nodeTypes: NodeTypes = { flowNode: FlowNodeCard };

export interface FlowCanvasHandle {
  /** Centra el viewport en un nodo (ej. clic en un resultado de búsqueda o en un error de validación). */
  centerOnNode: (nodeId: string) => void;
  /** Centra el viewport en toda la selección actual -- no-op si no hay nada seleccionado. */
  centerOnSelection: () => void;
  /** Encuadra el flow completo. */
  fitView: () => void;
}

interface FlowCanvasProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  /** Professional Editor UX (autorizado) -- selección MÚLTIPLE real, ver onSelectionChange más abajo. */
  selectedNodeIds?: ReadonlySet<string>;
  selectedEdgeIds?: ReadonlySet<string>;
  onSelectionChange?: (selection: { nodeIds: string[]; edgeIds: string[] }) => void;
  onPaneClick?: () => void;
  /** Doble click en el canvas vacío -- abre el menú de agregar nodo rápido en esa posición. */
  onPaneDoubleClick?: (screenX: number, screenY: number, flowPosition: NodePosition) => void;
  /**
   * Todos los nodos que terminaron de arrastrarse (uno solo, o el grupo
   * completo si había selección múltiple) -- ver OnNodeDrag de
   * @xyflow/react, que ya entrega el grupo entero en el 3er argumento.
   */
  onNodesDragStop?: (positions: { id: string; position: NodePosition }[]) => void;
  /** Sale null si React Flow no logró resolver un handle de origen real -- ver isValidConnection más abajo, que ya lo filtra antes de esto. */
  onConnect?: (connection: { source: string; target: string; sourceHandle: string | null }) => void;
  isValidConnection?: (connection: { source: string; target: string; sourceHandle?: string | null }) => boolean;
  onNodeDrop?: (type: FlowNodeType, position: NodePosition) => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  onDeleteEdges?: (edgeIds: string[]) => void;
  onNodeContextMenu?: (nodeId: string, x: number, y: number) => void;
  onSelectionContextMenu?: (x: number, y: number) => void;
  /** `flowPosition` ya viene convertida (screenToFlowPosition) -- lista para crear un nodo ahí si el menú lo pide. */
  onPaneContextMenu?: (x: number, y: number, flowPosition: NodePosition) => void;
  /**
   * Etapa 4 (autorizado) — ids de nodos/edges con errores de la última
   * validación VIGENTE (el caller ya resolvió staleness). Post-procesamiento
   * puro sobre className/style de React Flow, igual que ya hace
   * selected/selectedEdgeId más abajo -- canvas-adapter.ts no se toca, y
   * FlowNodeCard tampoco necesita saber nada de validación.
   */
  nodeIdsWithErrors?: ReadonlySet<string>;
  edgeIdsWithErrors?: ReadonlySet<string>;
  /** Professional Editor UX (autorizado) -- toggle del minimap desde el toolbar. Por defecto visible. */
  minimapVisible?: boolean;
}

/**
 * Etapa 3 (Flow Builder, autorizado) — envoltorio de @xyflow/react dentro de
 * un componente separado del que monta el Provider (useReactFlow solo puede
 * llamarse en un descendiente de ReactFlowProvider, nunca en el mismo
 * componente que lo renderiza).
 */
const FlowCanvasInner = forwardRef<FlowCanvasHandle, FlowCanvasProps>(function FlowCanvasInner(
  {
    nodes,
    edges,
    selectedNodeIds,
    selectedEdgeIds,
    onSelectionChange,
    onPaneClick,
    onPaneDoubleClick,
    onNodesDragStop,
    onConnect,
    isValidConnection,
    onNodeDrop,
    onDeleteNodes,
    onDeleteEdges,
    onNodeContextMenu,
    onSelectionContextMenu,
    onPaneContextMenu,
    nodeIdsWithErrors,
    edgeIdsWithErrors,
    minimapVisible = true,
  },
  ref,
) {
  const { screenToFlowPosition, fitView } = useReactFlow();

  useImperativeHandle(ref, () => ({
    centerOnNode(nodeId: string) {
      void fitView({ nodes: [{ id: nodeId }], padding: 0.6, duration: 300, maxZoom: 1.2 });
    },
    centerOnSelection() {
      const ids = [...(selectedNodeIds ?? [])];
      if (ids.length === 0) return;
      void fitView({ nodes: ids.map((id) => ({ id })), padding: 0.4, duration: 300 });
    },
    fitView() {
      void fitView({ duration: 300 });
    },
  }));

  // Memoizado -- sin esto, estos arrays se recrean con una referencia nueva
  // en CADA render aunque nada haya cambiado, y @xyflow/react trata
  // `nodes`/`edges` como props controladas: resincroniza su store interno
  // cada vez que la referencia cambia. Complementa a onNodesChange/
  // onEdgesChange (más abajo, la corrección real del bucle de selección) --
  // esto reduce cuántas veces se dispara esa resincronización, no es en sí
  // mismo lo que evita el loop.
  const nodesWithSelection = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        selected: selectedNodeIds?.has(n.id) ?? false,
        className: nodeIdsWithErrors?.has(n.id) ? "ring-2 ring-red-500 ring-offset-2 ring-offset-ink" : undefined,
      })),
    [nodes, selectedNodeIds, nodeIdsWithErrors],
  );
  const edgesWithSelection = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        selected: selectedEdgeIds?.has(e.id) ?? false,
        style: edgeIdsWithErrors?.has(e.id) ? { stroke: "#ef4444", strokeWidth: 2.5 } : undefined,
      })),
    [edges, selectedEdgeIds, edgeIdsWithErrors],
  );

  const handleConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    onConnect?.({ source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle });
  };

  // Bugfix real (producción) -- con `nodes`/`edges` controlados (props),
  // React Flow mantiene su PROPIO store interno de selección, que solo se
  // reconcilia con lo que le pasamos si le confirmamos sus NodeChange/
  // EdgeChange vía onNodesChange/onEdgesChange. Sin esto, el `selected` que
  // le mandamos en los props y el que React Flow cree tener internamente
  // quedan permanentemente un ciclo desfasados -- cada resync "corrige" la
  // selección al valor CONTRARIO del que le mandamos, lo que reportaba
  // (antes) por onSelectionChange como una oscilación seleccionado <->
  // vacío infinita ("Maximum update depth exceeded"). Nunca se manifestaba
  // con el nodo Start original porque nunca se seleccionaba
  // programáticamente al cargar -- solo aparece al agregar+seleccionar un
  // nodo nuevo (handleNodeDrop -> selectNode). Solo se procesan los cambios
  // "select" (lo único que este canvas necesita reflejar en su selección
  // externa) -- position/dimensions/remove ya los maneja onNodesDragStop/
  // onBeforeDelete+onNodesDelete/onEdgesDelete, aplicarlos AQUÍ también
  // duplicaría esa lógica.
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!changes.some((c) => c.type === "select")) return;
      const nodeIds = applySelectChanges(selectedNodeIds ?? new Set(), changes);
      onSelectionChange?.({ nodeIds, edgeIds: [...(selectedEdgeIds ?? [])] });
    },
    [selectedNodeIds, selectedEdgeIds, onSelectionChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!changes.some((c) => c.type === "select")) return;
      const edgeIds = applySelectChanges(selectedEdgeIds ?? new Set(), changes);
      onSelectionChange?.({ nodeIds: [...(selectedNodeIds ?? [])], edgeIds });
    },
    [selectedNodeIds, selectedEdgeIds, onSelectionChange],
  );

  const handleIsValidConnection: IsValidConnection = (edgeOrConnection) => {
    if (!isValidConnection) return true;
    const c = edgeOrConnection as Connection | Edge;
    const source = "source" in c ? c.source : undefined;
    const target = "target" in c ? c.target : undefined;
    if (!source || !target) return false;
    return isValidConnection({ source, target, sourceHandle: "sourceHandle" in c ? c.sourceHandle : undefined });
  };

  // Confirmación SOLO cuando al menos un nodo a borrar tiene conexiones
  // (decisión aprobada: borrar un edge solo, o un nodo sin conexiones, no
  // pide confirmación). onBeforeDelete puede cancelar la operación entera
  // devolviendo false -- antes de que React Flow toque nada.
  async function handleBeforeDelete({ nodes: delNodes, edges: delEdges }: { nodes: Node[]; edges: Edge[] }) {
    if (delNodes.length > 0 && delEdges.length > 0) {
      const nombre = delNodes.length === 1 ? `el nodo "${(delNodes[0].data?.label as string) ?? delNodes[0].id}"` : `${delNodes.length} nodos`;
      const ok = window.confirm(
        `¿Eliminar ${nombre}? También se eliminarán ${delEdges.length} ${delEdges.length === 1 ? "conexión" : "conexiones"}.`,
      );
      if (!ok) return false;
    }
    return true;
  }

  return (
    <div
      className="relative h-full w-full"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(FLOW_NODE_DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        const type = e.dataTransfer.getData(FLOW_NODE_DRAG_MIME) as FlowNodeType | "";
        if (!type) return;
        e.preventDefault();
        const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        onNodeDrop?.(type, position);
      }}
      onDoubleClick={(e) => {
        // Solo canvas vacío: si el doble click cayó sobre un nodo/edge, React
        // Flow ya lo maneja aparte (onNodeDoubleClick no se usa hoy) -- acá
        // basta con chequear que el target sea el propio fondo del pane.
        if (!onPaneDoubleClick) return;
        const target = e.target as HTMLElement;
        if (!target.classList.contains("react-flow__pane")) return;
        onPaneDoubleClick(e.clientX, e.clientY, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      }}
    >
      <ReactFlow
        nodes={nodesWithSelection}
        edges={edgesWithSelection}
        nodeTypes={nodeTypes}
        fitView
        // Polish visual (autorizado) -- activa la clase `.react-flow.dark`
        // que trae @xyflow/react (su propio mecanismo de theming), lo que
        // habilita los overrides de app/globals.css (.dash-scope .react-flow.dark)
        // que apuntan el minimapa/controles a los tokens de color de DuLabs
        // en vez del fondo blanco por defecto de la librería.
        colorMode="dark"
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable
        edgesFocusable
        deleteKeyCode={["Delete", "Backspace"]}
        zoomOnDoubleClick={!onPaneDoubleClick}
        onConnect={handleConnect}
        isValidConnection={handleIsValidConnection}
        onBeforeDelete={handleBeforeDelete}
        onNodesDelete={(deleted) => onDeleteNodes?.(deleted.map((n) => n.id))}
        onEdgesDelete={(deleted) => onDeleteEdges?.(deleted.map((e) => e.id))}
        onPaneClick={() => onPaneClick?.()}
        onNodeDragStop={(_event, _node, draggedNodes) => onNodesDragStop?.(draggedNodes.map((n) => ({ id: n.id, position: n.position })))}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          onNodeContextMenu?.(node.id, event.clientX, event.clientY);
        }}
        onSelectionContextMenu={(event) => {
          event.preventDefault();
          onSelectionContextMenu?.(event.clientX, event.clientY);
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          onPaneContextMenu?.(event.clientX, event.clientY, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        }}
      >
        <Background gap={24} />
        {minimapVisible && <MiniMap pannable zoomable />}
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
});

export const FlowCanvas = forwardRef<FlowCanvasHandle, FlowCanvasProps>(function FlowCanvas(props, ref) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} ref={ref} />
    </ReactFlowProvider>
  );
});
