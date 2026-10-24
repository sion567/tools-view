import { beforeAll, describe, expect, it } from "vitest";
import { buildGraph, layoutGraph, NODE_HEIGHT, NODE_WIDTH } from "../graph";
import { buildGraphContent, planBands } from "../graphExport";

// buildGraphContent 会读 CSS 变量与 canvas 量宽，Node 环境 stub 掉
beforeAll(() => {
  globalThis.document = {
    documentElement: {},
    createElement: () => ({ getContext: () => null }),
  } as unknown as Document;
  globalThis.getComputedStyle = (() => ({
    getPropertyValue: () => "#000000",
  })) as unknown as typeof getComputedStyle;
});

describe("graphExport", () => {
  const value = { a: { b: 1, c: 2 }, d: [1, 2], e: "leaf" };

  for (const direction of ["vertical", "horizontal"] as const) {
    it(`${direction}: 边端点严格落在节点边框上`, () => {
      const { nodes: base, edges } = buildGraph(value);
      const nodes = layoutGraph(base, edges, direction);
      const { full } = buildGraphContent(nodes, edges);

      const paths = [...full.svg.matchAll(/<path d="([^"]+)" fill="none"/g)].map(
        (m) => m[1],
      );
      expect(paths.length).toBe(edges.length);

      const byId = new Map(nodes.map((n) => [n.id, n]));
      for (let i = 0; i < edges.length; i++) {
        const s = byId.get(edges[i].source)!;
        const t = byId.get(edges[i].target)!;
        const d = paths[i];
        const first = d.match(/^M(-?[\d.]+)[ ,](-?[\d.]+)/);
        const last = d.match(/(-?[\d.]+)[ ,](-?[\d.]+)$/);
        expect(first).not.toBeNull();
        expect(last).not.toBeNull();
        const [sx, sy] = [+first![1], +first![2]];
        const [tx, ty] = [+last![1], +last![2]];
        const expS =
          direction === "vertical"
            ? [s.position.x + NODE_WIDTH / 2, s.position.y + NODE_HEIGHT]
            : [s.position.x + NODE_WIDTH, s.position.y + NODE_HEIGHT / 2];
        const expT =
          direction === "vertical"
            ? [t.position.x + NODE_WIDTH / 2, t.position.y]
            : [t.position.x, t.position.y + NODE_HEIGHT / 2];
        expect(Math.abs(sx - expS[0]) < 0.01 && Math.abs(sy - expS[1]) < 0.01).toBe(true);
        expect(Math.abs(tx - expT[0]) < 0.01 && Math.abs(ty - expT[1]) < 0.01).toBe(true);
      }
    });
  }

  it("超大图分块都在画布上限内", () => {
    const bands = planBands(300_000, 1000);
    expect(bands.length).toBeGreaterThan(1);
    for (const b of bands) {
      expect(b.width).toBeLessThanOrEqual(65535);
      expect(b.width * b.height).toBeLessThanOrEqual(100_000_000);
    }
    // 分块拼起来覆盖整个宽度
    const covered = bands.reduce((s, b) => s + b.width, 0);
    expect(covered).toBe(300_000);
  });
});
