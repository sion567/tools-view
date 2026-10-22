import type { Edge, Node } from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";

export type Direction = "vertical" | "horizontal";

export type GraphNodeData = {
  label: string;
  kind: "object" | "array" | "scalar";
  title: string;
  direction: Direction;
};

export type GraphNode = Node<GraphNodeData, "kv">;

export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 44;
export const MAX_NODES = 1200;

export interface GraphBuild {
  nodes: GraphNode[];
  edges: Edge[];
  truncated: boolean;
  total: number;
}

const elk = new ELK();

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function scalarText(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return `"${v}"`;
  return String(v);
}

function summaryOf(
  key: string,
  v: unknown,
): { label: string; kind: GraphNodeData["kind"]; title: string } {
  const title = truncate(JSON.stringify(v) ?? "", 400);
  const name = key === "" ? "root" : key;

  if (v !== null && typeof v === "object") {
    if (Array.isArray(v)) {
      return { label: `${name} [${v.length}]`, kind: "array", title };
    }
    const count = Object.keys(v as Record<string, unknown>).length;
    return { label: `${name} {${count}}`, kind: "object", title };
  }
  return { label: `${name}: ${scalarText(v)}`, kind: "scalar", title };
}

/// 把归一化后的 JSON 值构建为 React Flow 的节点树 + 父子边
export function buildGraph(value: unknown): GraphBuild {
  const nodes: GraphNode[] = [];
  const edges: Edge[] = [];
  let truncated = false;
  let total = 0;

  const walk = (v: unknown, key: string, parentId: string | null) => {
    total += 1;
    if (nodes.length >= MAX_NODES) {
      truncated = true;
      return;
    }
    const { label, kind, title } = summaryOf(key, v);
    const id = `n${nodes.length}`;
    nodes.push({
      id,
      type: "kv",
      data: { label, kind, title, direction: "vertical" },
      position: { x: 0, y: 0 },
    });
    if (parentId !== null) {
      edges.push({ id: `e-${parentId}-${id}`, source: parentId, target: id });
    }

    if (v !== null && typeof v === "object") {
      if (Array.isArray(v)) {
        v.forEach((item, i) => walk(item, `[${i}]`, id));
      } else {
        for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
          walk(item, k, id);
        }
      }
    }
  };

  walk(value, "", null);
  return { nodes, edges, truncated, total };
}

/// elkjs 分层布局：horizontal = 左→右 (RIGHT)，vertical = 上→下 (DOWN)
export async function layoutGraph(
  nodes: GraphNode[],
  edges: Edge[],
  direction: Direction,
): Promise<GraphNode[]> {
  if (nodes.length === 0) return [];

  const graph = {
    id: "root-graph",
    children: nodes.map((n) => ({
      id: n.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  const laid = await elk.layout(graph, {
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction === "horizontal" ? "RIGHT" : "DOWN",
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.nodeNodeBetweenLayers": "100",
    },
  });

  const positions = new Map<string, { x: number; y: number }>();
  for (const child of laid.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  return nodes.map((n) => ({
    ...n,
    position: positions.get(n.id) ?? n.position,
    // 方向写进 data，节点组件据此联动 handle 的位置
    data: { ...n.data, direction },
  }));
}
