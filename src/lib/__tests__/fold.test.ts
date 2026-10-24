import { describe, expect, it } from "vitest";
import {
  allFoldLines,
  buildFoldTree,
  countFolds,
  type FoldNode,
} from "../fold";

const flat = (nodes: FoldNode[], out: FoldNode[] = []): FoldNode[] => {
  for (const n of nodes) {
    out.push(n);
    flat(n.children, out);
  }
  return out;
};

describe("fold: JSON", () => {
  const value = {
    name: "tools-view",
    parsers: { json: { crate: "serde_json" }, yaml: { crate: "y" } },
    tags: [1, 2, 3],
    empty: {},
    nested: [[[1]]],
  };
  const pretty = JSON.stringify(value, null, 2);
  const lines = pretty.split("\n");

  it("识别所有以 {/[ 结尾的行为折叠块起点", () => {
    const all = flat(buildFoldTree(pretty, "json"));
    const openers = new Set(all.map((n) => n.line));
    let mismatch = 0;
    lines.forEach((l, i) => {
      const t = l.trim();
      const isOpener = t.endsWith("{") || t.endsWith("[");
      if (isOpener !== openers.has(i)) mismatch++;
    });
    expect(mismatch).toBe(0);
    // root、parsers、json、yaml、tags、nested 及 2 层内嵌
    expect(all.length).toBe(8);
  });

  it("root 折叠块从首行配对到末行", () => {
    const root = buildFoldTree(pretty, "json").find((n) => n.line === 0);
    expect(root).toBeDefined();
    expect(root!.end).toBe(lines.length - 1);
    expect(root!.hasCloser).toBe(true);
  });

  it("单行空对象不折叠", () => {
    const all = flat(buildFoldTree(pretty, "json"));
    const emptyLine = lines.findIndex((l) => l.includes('"empty"'));
    expect(all.some((n) => n.line === emptyLine)).toBe(false);
  });

  it("未闭合括号不产生折叠块（防御）", () => {
    expect(buildFoldTree('{\n  "a": 1', "json")).toHaveLength(0);
  });
});

describe("fold: XML", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<catalog>
  <book id="bk101">
    <tags>
      <tag>json</tag>
    </tags>
  </book>
  <meta total="2"/>
</catalog>
`;
  const lines = xml.split("\n");

  it("折叠块 = catalog/book/tags，声明与自闭合标签不参与", () => {
    const tree = buildFoldTree(xml, "xml");
    expect(flat(tree)).toHaveLength(3);
  });

  it("catalog 配对到 </catalog>", () => {
    const cat = buildFoldTree(xml, "xml").find((n) => n.line === 1);
    expect(cat).toBeDefined();
    expect(lines[cat!.end].trim()).toBe("</catalog>");
    expect(cat!.hasCloser).toBe(true);
  });
});

describe("fold: YAML", () => {
  const yaml = `service: tools-view
runtime:
  rust: 1.84
  tauri: 2
parsers:
  - name: json
    crate: serde_json
features:
  enabled: true
  items: [pretty-print]
`;
  const lines = yaml.split("\n");

  it("按缩进块识别折叠范围", () => {
    const all = flat(buildFoldTree(yaml, "yaml"));
    expect(all.map((n) => lines[n.line].trim())).toEqual([
      "runtime:",
      "parsers:",
      "- name: json",
      "features:",
    ]);
  });

  it("块终点是下一条缩进不大于本行的非空行之前", () => {
    const all = flat(buildFoldTree(yaml, "yaml"));
    const runtime = all.find((n) => lines[n.line].trim() === "runtime:")!;
    expect(lines[runtime.end].trim()).toBe("tauri: 2");
    expect(runtime.hasCloser).toBe(false);
  });

  it("顶层标量行不折叠", () => {
    const all = flat(buildFoldTree(yaml, "yaml"));
    expect(all.some((n) => lines[n.line].trim() === "service: tools-view")).toBe(false);
  });
});

describe("fold: TOML", () => {
  const toml = `[package]
name = "tools-view"

[deps.serde]
version = "1"

[[items]]
id = 1
`;
  const lines = toml.split("\n");

  it("表格头可折叠，块到下一个同级或更浅表头", () => {
    const tree = buildFoldTree(toml, "toml");
    const all = flat(tree);
    expect(all).toHaveLength(3);
    const pkg = tree.find((n) => lines[n.line].trim() === "[package]")!;
    // [[items]] 是根级表（深度 0），[package] 的块止于它之前
    expect(pkg.end).toBe(5);
    // [deps.serde]（深度 1）是 [package] 的子块，[[items]] 是根级兄弟
    expect(pkg.children).toHaveLength(1);
    expect(tree).toHaveLength(2);
  });

  it("无表头时无折叠块", () => {
    expect(buildFoldTree('a = 1\nb = "x"\n', "toml")).toHaveLength(0);
  });
});

describe("fold: 工具函数", () => {
  it("countFolds 统计含嵌套", () => {
    const tree = buildFoldTree(JSON.stringify({ a: { b: { c: 1 } } }, null, 2), "json");
    expect(countFolds(tree)).toBe(3);
    expect(allFoldLines(tree)).toHaveLength(3);
  });

  it("空输入无折叠块", () => {
    expect(buildFoldTree("", "yaml")).toHaveLength(0);
  });
});
