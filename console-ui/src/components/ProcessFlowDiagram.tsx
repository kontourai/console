import type { FlowEdge, FlowNode } from "@kontourai/console-core";

const NODE_WIDTH = 184;
const NODE_HEIGHT = 82;
const LANE_WIDTH = 218;
const ROW_HEIGHT = 112;
const PADDING_X = 28;
const PADDING_Y = 30;

const LANE_LABELS = ["stage", "process", "step", "gates", "claims", "actions", "timeline"];

function xFor(lane: number) {
  return PADDING_X + lane * LANE_WIDTH;
}

function yFor(order: number) {
  return PADDING_Y + order * ROW_HEIGHT;
}

function nodeCenter(node: FlowNode) {
  return {
    x: xFor(node.lane) + NODE_WIDTH / 2,
    y: yFor(node.order) + NODE_HEIGHT / 2,
  };
}

function edgePath(from: FlowNode, to: FlowNode) {
  const a = nodeCenter(from);
  const b = nodeCenter(to);
  const startX = a.x + NODE_WIDTH / 2;
  const endX = b.x - NODE_WIDTH / 2;
  const midX = startX + Math.max(30, (endX - startX) / 2);
  return `M ${startX} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${endX} ${b.y}`;
}

function FlowEdgePath({ edge, nodesById }: { edge: FlowEdge; nodesById: Map<string, FlowNode> }) {
  const from = nodesById.get(edge.from);
  const to = nodesById.get(edge.to);
  if (!from || !to) return null;

  return <path className={edge.active ? "flow-edge flow-edge-active" : "flow-edge"} d={edgePath(from, to)} />;
}

function FlowNodeCard({ node }: { node: FlowNode }) {
  const statusClass = node.status.replace(/[^a-z0-9-]/g, "-");

  return (
    <foreignObject x={xFor(node.lane)} y={yFor(node.order)} width={NODE_WIDTH} height={NODE_HEIGHT}>
      <article className={`flow-node flow-node-${node.kind} tone-${statusClass} ${node.active ? "flow-node-active" : ""}`}>
        <div className="flow-node-top">
          <span>{node.kind}</span>
          <b>{node.status}</b>
        </div>
        <strong>{node.label}</strong>
        <p>{node.meta}</p>
      </article>
    </foreignObject>
  );
}

export function ProcessFlowDiagram({ nodes, edges }: { nodes: FlowNode[]; edges: FlowEdge[] }) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const maxOrder = Math.max(0, ...nodes.map((node) => node.order));
  const width = PADDING_X * 2 + LANE_WIDTH * LANE_LABELS.length - (LANE_WIDTH - NODE_WIDTH);
  const height = PADDING_Y * 2 + (maxOrder + 1) * ROW_HEIGHT;

  return (
    <div className="flow-scroll" aria-label="Process flow diagram">
      <svg className="flow-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="flow-title" aria-describedby="flow-node-list">
        <title id="flow-title">Kontour process flow</title>
        {LANE_LABELS.map((label, lane) => (
          <g key={label}>
            <text className="flow-lane-label" x={xFor(lane)} y="17">{label}</text>
            <line className="flow-lane-line" x1={xFor(lane)} x2={xFor(lane)} y1="24" y2={height - 12} />
          </g>
        ))}
        <g>
          {edges.map((edge) => <FlowEdgePath key={edge.id} edge={edge} nodesById={nodesById} />)}
        </g>
        <g>
          {nodes.map((node) => <FlowNodeCard key={node.id} node={node} />)}
        </g>
      </svg>
      <ol id="flow-node-list" className="flow-node-list">
        {nodes.map((node) => (
          <li key={node.id}>
            {node.kind}: {node.label}; status {node.status}; {node.meta}
          </li>
        ))}
      </ol>
    </div>
  );
}
