import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  type FitViewOptions,
  type NodeMouseHandler,
  BackgroundVariant,
} from "@xyflow/react";
import type { FlowEdge, FlowNode } from "@kontourai/console-core";

// ── Layout constants ──────────────────────────────────────────────────────────
const NODE_WIDTH = 184;
const NODE_HEIGHT = 82;
const LANE_WIDTH = 218;
const ROW_HEIGHT = 112;
const PADDING_X = 28;
const PADDING_Y = 24;

function xFor(lane: number) {
  return PADDING_X + lane * LANE_WIDTH;
}
function yFor(order: number) {
  return PADDING_Y + order * ROW_HEIGHT;
}

// ── Custom node data type ─────────────────────────────────────────────────────
interface FlowNodeData extends Record<string, unknown> {
  kind: string;
  label: string;
  meta: string;
  status: string;
  active: boolean;
  dimmed: boolean;
  hovered: boolean;
}

// ── Custom node component ─────────────────────────────────────────────────────
function FlowNodeCard({ data, selected }: { data: FlowNodeData; selected?: boolean }) {
  const statusClass = data.status.replace(/[^a-z0-9-]/g, "-");
  const cls = [
    "flow-node",
    `flow-node-${data.kind}`,
    `tone-${statusClass}`,
    data.active ? "flow-node-active" : "",
    selected ? "flow-node-selected" : "",
    data.dimmed ? "flow-node-dimmed" : "",
    data.hovered ? "flow-node-hovered" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cls} style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}>
      {/* Edge anchors — invisible, non-interactive; they only give relationship
          lines a point to attach to so node-to-node links render cleanly. */}
      <Handle type="target" position={Position.Left} className="flow-handle" isConnectable={false} />
      <div className="flow-node-top">
        <span>{data.kind}</span>
        <b>{data.status}</b>
      </div>
      <strong>{data.label}</strong>
      <p>{data.meta}</p>
      <Handle type="source" position={Position.Right} className="flow-handle" isConnectable={false} />
    </article>
  );
}

// ── Conversion helpers ────────────────────────────────────────────────────────
function toRFNodes(
  nodes: FlowNode[],
  selectedId: string | null,
  highlightedIds: Set<string>,
  hoveredId: string | null,
): Node<FlowNodeData>[] {
  const hasHighlight = highlightedIds.size > 0;
  return nodes.map((n) => ({
    id: n.id,
    type: "flowNode",
    position: { x: xFor(n.lane), y: yFor(n.order) },
    data: {
      kind: n.kind,
      label: n.label,
      meta: n.meta,
      status: n.status,
      active: n.active,
      dimmed: hasHighlight && !highlightedIds.has(n.id),
      hovered: n.id === hoveredId,
    },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    selectable: true,
    draggable: false,
    selected: n.id === selectedId,
  }));
}

function toRFEdges(edges: FlowEdge[], highlightedEdgeIds: Set<string>): Edge[] {
  const hasHighlight = highlightedEdgeIds.size > 0;
  return edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    type: "smoothstep",
    animated: e.active,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color: e.active ? "var(--accent)" : "var(--flow-edge-idle)",
    },
    className: [
      e.active ? "flow-edge-active" : "flow-edge-inactive",
      hasHighlight && !highlightedEdgeIds.has(e.id) ? "flow-edge-dimmed" : "",
    ]
      .filter(Boolean)
      .join(" "),
    style: {
      stroke: e.active ? "var(--accent)" : "var(--flow-edge-idle)",
      strokeWidth: e.active ? 2 : 1.5,
      strokeDasharray: e.active ? "8 8" : undefined,
    },
  }));
}

const NODE_TYPES: NodeTypes = {
  flowNode: FlowNodeCard as NodeTypes["flowNode"],
};

const FIT_VIEW_OPTIONS: FitViewOptions = {
  padding: 0.12,
  maxZoom: 1.2,
};

// ── Inner component (inside ReactFlowProvider) ────────────────────────────────
interface FlowInnerProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodeId: string | null;
  panToNodeId: string | null;
  onNodeSelect(id: string | null): void;
}

function FlowInner({
  nodes: coreNodes,
  edges: coreEdges,
  selectedNodeId,
  panToNodeId,
  onNodeSelect,
}: FlowInnerProps) {
  const { fitView } = useReactFlow();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Hover state ─────────────────────────────────────────────────────────────
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // ── Highlight / dim memo (selection takes precedence over hover) ─────────────
  const { highlightedNodeIds, highlightedEdgeIds } = useMemo(() => {
    // Determine the focal node: selected if present, otherwise hovered
    const focalId = selectedNodeId ?? hoveredId;
    if (!focalId) {
      return { highlightedNodeIds: new Set<string>(), highlightedEdgeIds: new Set<string>() };
    }
    const nodeIds = new Set<string>([focalId]);
    const edgeIds = new Set<string>();
    for (const e of coreEdges) {
      if (e.from === focalId || e.to === focalId) {
        edgeIds.add(e.id);
        nodeIds.add(e.from);
        nodeIds.add(e.to);
      }
    }
    return { highlightedNodeIds: nodeIds, highlightedEdgeIds: edgeIds };
  }, [selectedNodeId, hoveredId, coreEdges]);

  const rfNodes = useMemo(
    () => toRFNodes(coreNodes, selectedNodeId, highlightedNodeIds, hoveredId),
    [coreNodes, selectedNodeId, highlightedNodeIds, hoveredId],
  );
  const rfEdges = useMemo(
    () => toRFEdges(coreEdges, highlightedEdgeIds),
    [coreEdges, highlightedEdgeIds],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  useEffect(() => { setNodes(rfNodes); }, [rfNodes, setNodes]);
  useEffect(() => { setEdges(rfEdges); }, [rfEdges, setEdges]);

  // Debounced fitView when core data changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { fitView(FIT_VIEW_OPTIONS); }, 160);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [coreNodes, fitView]);

  // ── Pan to node when selected from side-panel ───────────────────────────────
  // panToNodeId is only set by side-panel clicks (not canvas clicks).
  // We track the last value we acted on so the effect is idempotent across
  // re-renders that don't change panToNodeId.
  const lastPannedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!panToNodeId || panToNodeId === lastPannedRef.current) return;
    lastPannedRef.current = panToNodeId;
    const coreNode = coreNodes.find((n) => n.id === panToNodeId);
    if (!coreNode) return;
    fitView({
      nodes: [{ id: panToNodeId }],
      duration: 600,
      maxZoom: 1.2,
      padding: 0.3,
    });
  }, [panToNodeId, coreNodes, fitView]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      onNodeSelect(node.id === selectedNodeId ? null : node.id);
    },
    [selectedNodeId, onNodeSelect],
  );

  const onPaneClick = useCallback(() => { onNodeSelect(null); }, [onNodeSelect]);

  const onPaneDblClick = useCallback(() => { fitView(FIT_VIEW_OPTIONS); }, [fitView]);

  // ── Hover handlers ───────────────────────────────────────────────────────────
  const onNodeMouseEnter: NodeMouseHandler = useCallback(
    (_event, node) => { setHoveredId(node.id); },
    [],
  );

  const onNodeMouseLeave: NodeMouseHandler = useCallback(
    () => { setHoveredId(null); },
    [],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onNodeMouseEnter={onNodeMouseEnter}
      onNodeMouseLeave={onNodeMouseLeave}
      onPaneClick={onPaneClick}
      onDoubleClick={onPaneDblClick}
      nodeTypes={NODE_TYPES}
      fitView
      fitViewOptions={FIT_VIEW_OPTIONS}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesReconnectable={false}
      elementsSelectable={true}
      panOnScroll={false}
      zoomOnDoubleClick={false}
      minZoom={0.15}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      className="flow-rf"
    >
      <Background
        variant={BackgroundVariant.Lines}
        gap={28}
        lineWidth={1}
        style={{ stroke: "var(--grid-line)" }}
      />
      <Controls
        className="flow-controls"
        showInteractive={false}
        fitViewOptions={FIT_VIEW_OPTIONS}
      />
      <MiniMap
        className="flow-minimap"
        nodeColor={(node) => {
          const d = node.data as FlowNodeData;
          if (d.active) return "var(--accent)";
          return "var(--panel-2)";
        }}
        maskColor="color-mix(in srgb, var(--bg) 72%, transparent)"
        style={{ background: "var(--panel)" }}
      />
    </ReactFlow>
  );
}

// ── Public export ─────────────────────────────────────────────────────────────
export interface FlowCanvasProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodeId: string | null;
  /** Set to a node ID when selection came from the side-panel; FlowInner will
   *  smoothly pan/zoom the canvas to centre on that node. Leave null when the
   *  selection was triggered by a canvas click (node already in view). */
  panToNodeId: string | null;
  onNodeSelect(id: string | null): void;
}

export function FlowCanvas({ nodes, edges, selectedNodeId, panToNodeId, onNodeSelect }: FlowCanvasProps) {
  return (
    <div className="flow-canvas-wrap" aria-label="Process flow diagram">
      <ReactFlowProvider>
        <FlowInner
          nodes={nodes}
          edges={edges}
          selectedNodeId={selectedNodeId}
          panToNodeId={panToNodeId}
          onNodeSelect={onNodeSelect}
        />
      </ReactFlowProvider>
      <ol className="flow-node-list" aria-label="Flow nodes">
        {nodes.map((n) => (
          <li key={n.id}>
            {n.kind}: {n.label}; status {n.status}; {n.meta}
          </li>
        ))}
      </ol>
    </div>
  );
}
