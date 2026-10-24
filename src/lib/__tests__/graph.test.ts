import { describe, expect, it } from "vitest";
import {
  buildGraph,
  layoutGraph,
  NODE_HEIGHT,
  NODE_WIDTH,
  type GraphNode,
} from "../graph";

const assertNoOverlap = (nodes: GraphNode[]) => {
  const list = nodes
    .map((n) => ({ ...n.position, id: n.id }))
    .sort((a, b) => a.x - b.x);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (b.x >= a.x + NODE_WIDTH) break;
      if (Math.abs(a.y - b.y) < NODE_HEIGHT && b.x < a.x + NODE_WIDTH) {
        throw new Error(`节点重叠: ${a.id} 与 ${b.id}`);
      }
    }
  }
};

const bbox = (nodes: GraphNode[]) => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.position.x);
    y0 = Math.min(y0, n.position.y);
    x1 = Math.max(x1, n.position.x + NODE_WIDTH);
    y1 = Math.max(y1, n.position.y + NODE_HEIGHT);
  }
  return { w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
};

const fixtures: Record<string, unknown> = {
  pkg: {
    name: "tools-view",
    version: "0.1.0",
    features: ["auto-detect", "pretty-print", "graph-view"],
    parsers: {
      json: { crate: "serde_json", stable: true },
      yaml: { crate: "yaml_serde", stable: true },
    },
    authors: [
      { name: "张三", role: "maintainer" },
      { name: "李四", role: "contributor" },
    ],
    config: { theme: "dark", layout: "tidy-tree", maxNodes: 3000 },
  },
  wide: (() => {
    const kids = [];
    for (let i = 0; i < 10; i++) {
      const leaf: Record<string, string> = {};
      for (let j = 0; j < 4; j++) leaf[`field${j}`] = `v${i}-${j}`;
      kids.push(leaf);
    }
    return { root: { group: kids } };
  })(),
  uneven: {
    root: {
      chain: { l1: { l2: { l3: { l4: { leaf: "deep" } } } } },
      fan: Array.from({ length: 12 }, (_, i) => ({ k: `leaf-${i}` })),
      mixed: { a: { b: { c: [{ d: 1 }, { d: 2 }] } }, e: ["x", "y"] },
      single: "leaf",
    },
  },
};

describe("buildGraph", () => {
  it("节点带 JSON path", () => {
    const { nodes } = buildGraph(fixtures.pkg);
    const paths = nodes.map((n) => n.data.path);
    expect(paths[0]).toBe("$");
    expect(paths).toContain("$.parsers.json.crate");
    expect(paths).toContain("$.authors[1].name");
  });

  it("超出上限时截断并计数", () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 3500; i++) big[`k${i}`] = "v";
    const { nodes, truncated, total } = buildGraph(big);
    expect(nodes.length).toBe(3000);
    expect(truncated).toBe(true);
    expect(total).toBe(3501);
  });
});

describe("layoutGraph", () => {
  for (const [name, value] of Object.entries(fixtures)) {
    it(`${name}: 纵横双向无重叠且层数一致`, () => {
      const { nodes, edges } = buildGraph(value);
      const v = layoutGraph(nodes, edges, "vertical");
      assertNoOverlap(v);
      const h = layoutGraph(nodes, edges, "horizontal");
      assertNoOverlap(h);

      const layers = Math.round((bbox(v).h + 100) / (NODE_HEIGHT + 100));
      const expectW = layers * NODE_WIDTH + (layers - 1) * 100;
      expect(bbox(h).w).toBe(expectW);
      expect(v.every((n) => n.data.direction === "vertical")).toBe(true);
      expect(h.every((n) => n.data.direction === "horizontal")).toBe(true);
    });
  }

  it("标量根：单节点 @(0,0)", () => {
    const { nodes, edges } = buildGraph("hello");
    const laid = layoutGraph(nodes, edges, "vertical");
    expect(laid).toHaveLength(1);
    expect(laid[0].position).toEqual({ x: 0, y: 0 });
  });

  it("300 层深链：深度坐标正确", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 300; i++) deep = { next: deep };
    const { nodes, edges } = buildGraph(deep);
    const laid = layoutGraph(nodes, edges, "vertical");
    assertNoOverlap(laid);
    const last = laid[laid.length - 1];
    expect(last.position.y).toBe(300 * (NODE_HEIGHT + 100));
  });

  it("空输入返回空数组", () => {
    expect(layoutGraph([], [], "horizontal")).toEqual([]);
  });
});
