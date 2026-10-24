import type { Edge, Node } from "@xyflow/react";

export type Direction = "vertical" | "horizontal";

export type GraphNodeData = {
  label: string;
  kind: "object" | "array" | "scalar";
  title: string;
  direction: Direction;
  /** JSON path（$.a.b[0]），双击节点复制用 */
  path: string;
};

export type GraphNode = Node<GraphNodeData, "kv">;

export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 44;
export const MAX_NODES = 3000;

export interface GraphBuild {
  nodes: GraphNode[];
  edges: Edge[];
  truncated: boolean;
  total: number;
}

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

function pathKeyPart(k: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`;
}

/// 把归一化后的 JSON 值构建为 React Flow 的节点树 + 父子边
export function buildGraph(value: unknown): GraphBuild {
  const nodes: GraphNode[] = [];
  const edges: Edge[] = [];
  let truncated = false;
  let total = 0;

  const walk = (v: unknown, key: string, parentId: string | null, path: string) => {
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
      data: { label, kind, title, direction: "vertical", path },
      position: { x: 0, y: 0 },
    });
    if (parentId !== null) {
      edges.push({ id: `e-${parentId}-${id}`, source: parentId, target: id });
    }

    if (v !== null && typeof v === "object") {
      if (Array.isArray(v)) {
        v.forEach((item, i) => walk(item, `[${i}]`, id, `${path}[${i}]`));
      } else {
        for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
          walk(item, k, id, path + pathKeyPart(k));
        }
      }
    }
  };

  walk(value, "", null, "$");
  return { nodes, edges, truncated, total };
}

// ---------- 树布局（Reingold–Tilford，带轮廓合并） ----------

interface SubtreeLayout {
  /** 相对子树根的坐标：cross = 交叉轴，depth = 层数 */
  positions: Map<string, { cross: number; depth: number }>;
  /** 各层在交叉轴上的左右边界（相对子树根） */
  left: Map<number, number>;
  right: Map<number, number>;
}

/**
 * 树布局：纵向 = 上→下 (DOWN)，横向 = 左→右 (RIGHT)。
 * 兄弟间距 60、层间距 100，与原 elkjs layered 配置一致；
 * 轮廓合并让浅子树旁的深子树滑入空白层，紧凑度接近 elk（实测宽度差 ±10% 内），
 * 1200 节点耗时毫秒级，替代 elkjs（1.4MB）后布局同步完成。
 */
export function layoutGraph(
  nodes: GraphNode[],
  edges: Edge[],
  direction: Direction,
): GraphNode[] {
  if (nodes.length === 0) return [];

  const horizontal = direction === "horizontal";
  const crossSize = horizontal ? NODE_HEIGHT : NODE_WIDTH;
  const crossGap = 60;
  const layerGap = 100;

  // 父子关系：buildGraph 产出的边全部是父子边
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const e of edges) {
    let kids = childrenOf.get(e.source);
    if (!kids) childrenOf.set(e.source, (kids = []));
    kids.push(e.target);
    hasParent.add(e.target);
  }

  const layoutSubtree = (id: string): SubtreeLayout => {
    const kids = childrenOf.get(id) ?? [];
    const positions = new Map<string, { cross: number; depth: number }>([
      [id, { cross: 0, depth: 0 }],
    ]);
    if (kids.length === 0) {
      return {
        positions,
        left: new Map([[0, 0]]),
        right: new Map([[0, crossSize]]),
      };
    }

    const accLeft = new Map<number, number>();
    const accRight = new Map<number, number>();
    let lastChildCross = 0;
    for (const kid of kids) {
      const sub = layoutSubtree(kid);
      // 只在双方都有节点的层上强制间距；浅子树留下的空层允许后续深子树滑入
      let offset = 0;
      for (const [d, l] of sub.left) {
        const r = accRight.get(d + 1);
        if (r !== undefined) offset = Math.max(offset, r + crossGap - l);
      }
      for (const [nid, p] of sub.positions) {
        positions.set(nid, { cross: p.cross + offset, depth: p.depth + 1 });
      }
      for (const [d, l] of sub.left) {
        accLeft.set(d + 1, Math.min(accLeft.get(d + 1) ?? Infinity, l + offset));
      }
      for (const [d, r] of sub.right) {
        accRight.set(d + 1, Math.max(accRight.get(d + 1) ?? -Infinity, r + offset));
      }
      lastChildCross = offset;
    }

    // 父节点居中于首尾子节点之间
    const cross = lastChildCross / 2;
    positions.get(id)!.cross = cross;
    const left = new Map<number, number>([[0, cross]]);
    const right = new Map<number, number>([[0, cross + crossSize]]);
    for (const [d, v] of accLeft) {
      left.set(d, Math.min(v, left.get(d) ?? Infinity));
    }
    for (const [d, v] of accRight) {
      right.set(d, Math.max(v, right.get(d) ?? -Infinity));
    }
    return { positions, left, right };
  };

  // 根可能有多个（buildGraph 只有一个根，此处防御处理），依次排在交叉轴上
  const laid = new Map<string, { cross: number; depth: number }>();
  let cursor = 0;
  for (const n of nodes) {
    if (hasParent.has(n.id)) continue;
    const sub = layoutSubtree(n.id);
    let extent = 0;
    for (const r of sub.right.values()) extent = Math.max(extent, r);
    for (const [nid, p] of sub.positions) {
      laid.set(nid, { cross: p.cross + cursor, depth: p.depth });
    }
    cursor += extent + crossGap;
  }

  return nodes.map((n) => {
    const p = laid.get(n.id);
    const depth = p?.depth ?? 0;
    const cross = p?.cross ?? 0;
    return {
      ...n,
      // 主轴坐标由层数决定：横向层沿 x 展开，纵向层沿 y 展开
      position: horizontal
        ? { x: depth * (NODE_WIDTH + layerGap), y: cross }
        : { x: cross, y: depth * (NODE_HEIGHT + layerGap) },
      data: { ...n.data, direction },
    };
  });
}
