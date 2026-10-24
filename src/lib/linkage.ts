/**
 * 图节点 ↔ 格式化区行号的映射（仅 JSON 输出）。
 *
 * buildGraph 与 serde_json 的 pretty 输出使用同样的遍历顺序
 * （对象键序一致 / 数组顺序），因此可以并行走 value 树和 pretty 行：
 * 每个节点占用一行，object/array 还各占一行开/闭括号（空容器是单行）。
 */

export interface Linkage {
  /** 节点序号（n0..）→ pretty 行（0 基）；构建失败时整体为 null */
  lines: number[] | null;
  /** 节点序号 → JSON path（$.a.b[0]） */
  paths: string[];
}

function keyPart(k: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`;
}

export function buildLinkage(value: unknown, pretty: string): Linkage {
  const lines = pretty.split("\n");
  const outLines: number[] = [];
  const outPaths: string[] = [];
  let cursor = 0;
  let valid = true;

  const walk = (v: unknown, path: string) => {
    if (!valid || cursor >= lines.length) {
      valid = false;
      return;
    }
    outLines.push(cursor);
    outPaths.push(path);
    if (v !== null && typeof v === "object") {
      if (Array.isArray(v)) {
        if (v.length === 0) {
          cursor += 1; // 空数组 "[]]" 单行
          return;
        }
        cursor += 1; // 过 "[" 行
        v.forEach((item, i) => walk(item, `${path}[${i}]`));
        cursor += 1; // 过 "]" 行
        return;
      }
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length === 0) {
        cursor += 1; // 空对象 "{}" 单行
        return;
      }
      cursor += 1; // 过 "{" 行
      for (const [k, item] of entries) walk(item, path + keyPart(k));
      cursor += 1; // 过 "}" 行
      return;
    }
    cursor += 1; // 标量占一行
  };

  walk(value, "$");
  if (!valid || cursor !== lines.length) {
    // 行数对不上（空容器单行等边界未覆盖时），放弃定位而不是给出错误行号
    return { lines: null, paths: outPaths };
  }
  return { lines: outLines, paths: outPaths };
}
