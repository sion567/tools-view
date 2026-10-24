import { describe, expect, it } from "vitest";
import { buildGraph } from "../graph";
import { buildLinkage } from "../linkage";

describe("buildLinkage", () => {
  const value = {
    name: "tools-view",
    tags: [1, 2],
    empty: {},
    nested: { a: { b: "x" } },
  };
  const pretty = JSON.stringify(value, null, 2);

  it("节点序号与行号一一对应，且与 buildGraph 顺序一致", () => {
    const link = buildLinkage(value, pretty);
    expect(link.lines).not.toBeNull();
    const { nodes } = buildGraph(value);
    expect(link.lines!.length).toBe(nodes.length);
    // 根在第 0 行，name 在第 1 行
    expect(link.lines![0]).toBe(0);
    expect(link.lines![1]).toBe(1);
  });

  it("path 使用标准 JSON path 语法", () => {
    const link = buildLinkage(value, pretty);
    const { nodes } = buildGraph(value);
    expect(link.paths).toEqual(nodes.map((n) => n.data.path));
    expect(link.paths).toContain("$");
    expect(link.paths).toContain("$.tags[1]");
    expect(link.paths).toContain("$.nested.a.b");
  });

  it("空对象单行占位正确", () => {
    const lines = pretty.split("\n");
    const link = buildLinkage(value, pretty);
    // empty 在 "empty": {} 单行上，nested 与其后
    const emptyIdx = link.paths.indexOf("$.empty");
    const nestedIdx = link.paths.indexOf("$.nested");
    expect(lines[link.lines![emptyIdx]]).toContain('"empty": {}');
    expect(lines[link.lines![nestedIdx]]).toContain('"nested": {');
  });

  it("pretty 与 value 行数对不上时放弃定位", () => {
    const link = buildLinkage(value, "{\n  \"name\": \"x\"\n}");
    expect(link.lines).toBeNull();
  });

  it("标量根映射到第 0 行", () => {
    const link = buildLinkage("hello", '"hello"');
    expect(link.lines).toEqual([0]);
    expect(link.paths).toEqual(["$"]);
  });
});
