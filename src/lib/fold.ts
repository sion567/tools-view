/**
 * 格式化输出的可折叠块解析。
 *
 * 三种格式都按"行"识别折叠范围：
 * - JSON：以 `{` / `[` 结尾的行是块起点，缩进对应的 `}` / `]` 行是终点
 * - XML：`<tag ...>` 开标签行是起点，配对的 `</tag>` 行是终点（自闭合不参与）
 * - YAML：没有括号可配对，按缩进块折叠——下一条非空行缩进更深即为可折叠行，
 *   块延伸到下一条缩进不大于它的非空行为止
 */

export type FoldFormat = "json" | "yaml" | "xml" | "toml";

export interface FoldNode {
  /** 起始行（0 基） */
  line: number;
  /** 结束行（含）。json/xml 是闭合括号/标签行；yaml 是块内最后一行 */
  end: number;
  /** json/xml 有闭合行，yaml 没有 */
  hasCloser: boolean;
  children: FoldNode[];
}

export function buildFoldTree(pretty: string, format: FoldFormat): FoldNode[] {
  const lines = pretty.split("\n");
  if (format === "yaml") return buildYamlTree(lines);
  if (format === "toml") return buildTomlTree(lines);
  return buildBracketTree(lines, format);
}

/** 括号 / 标签配对式（JSON、XML） */
function buildBracketTree(lines: string[], format: FoldFormat): FoldNode[] {
  const roots: FoldNode[] = [];
  const childrenStack: FoldNode[][] = [roots];
  const openStack: FoldNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();

    const isCloser =
      format === "json"
        ? /^[}\]]/.test(t)
        : /^<\/[\w.\-:]+>$/.test(t);
    if (isCloser && openStack.length > 0) {
      const node = openStack.pop()!;
      node.end = i;
      node.hasCloser = true;
      childrenStack.pop();
      continue;
    }

    const isOpener =
      format === "json"
        ? t.endsWith("{") || t.endsWith("[")
        : /^<[A-Za-z_][\w.\-:]*(\s[^>]*)?>$/.test(t) && !t.endsWith("/>");
    if (isOpener) {
      const node: FoldNode = { line: i, end: i, hasCloser: false, children: [] };
      childrenStack[childrenStack.length - 1].push(node);
      childrenStack.push(node.children);
      openStack.push(node);
    }
  }

  // 防御：未闭合的节点（正常 pretty 输出不会出现）不可折叠，
  // 从树中摘掉，但其内部已闭合的子块上提保留
  const prune = (list: FoldNode[]): FoldNode[] => {
    const out: FoldNode[] = [];
    for (const n of list) {
      const kids = prune(n.children);
      if (n.hasCloser) {
        n.children = kids;
        out.push(n);
      } else {
        out.push(...kids);
      }
    }
    return out;
  };
  return prune(roots);
}

/** 缩进块式（YAML） */
function buildYamlTree(lines: string[]): FoldNode[] {  const indentOf = lines.map((l) => (l.trim() === "" ? -1 : l.length - l.trimStart().length));

  // 可折叠行：下一条非空行缩进更深
  const foldable: FoldNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (indentOf[i] < 0) continue;
    let j = i + 1;
    while (j < lines.length && indentOf[j] < 0) j++;
    if (j >= lines.length || indentOf[j] <= indentOf[i]) continue;
    // 块终点：下一条缩进不大于本行的非空行（的前一行）
    let k = j;
    while (k < lines.length && (indentOf[k] < 0 || indentOf[k] > indentOf[i])) k++;
    foldable.push({ line: i, end: k - 1, hasCloser: false, children: [] });
  }

  // 按包含关系嵌套
  const roots: FoldNode[] = [];
  const stack: FoldNode[] = [];
  for (const node of foldable) {
    while (stack.length > 0 && stack[stack.length - 1].end < node.line) stack.pop();
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

/** 表格头式（TOML）：[table] / [[array]] 头部行可折叠，块到下一个同级或更浅的表头 */
function buildTomlTree(lines: string[]): FoldNode[] {
  const HEADER_RE = /^\s*\[+.*\]+\s*$/;
  const isHeader = (l: string) => HEADER_RE.test(l);
  const depthOf = (l: string) => {
    const m = l.trim().match(/^\[+(.*?)\]+$/);
    return m ? (m[1].match(/\./g)?.length ?? 0) : -1;
  };

  const roots: FoldNode[] = [];
  const stack: FoldNode[] = [];
  const closeTop = (end: number) => {
    const n = stack.pop();
    if (n) n.end = end;
  };
  for (let i = 0; i < lines.length; i++) {
    if (!isHeader(lines[i])) continue;
    const d = depthOf(lines[i]);
    while (stack.length > 0 && depthOf(lines[stack[stack.length - 1].line]) >= d) {
      closeTop(i - 1);
    }
    const node: FoldNode = { line: i, end: i, hasCloser: false, children: [] };
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  while (stack.length > 0) closeTop(lines.length - 1);
  return roots;
}

/** 统计折叠块总数（含嵌套） */
export function countFolds(nodes: FoldNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countFolds(n.children), 0);
}

/** 收集全部折叠块的起始行（"全部折叠"用） */
export function allFoldLines(nodes: FoldNode[], out: number[] = []): number[] {
  for (const n of nodes) {
    out.push(n.line);
    allFoldLines(n.children, out);
  }
  return out;
}

/**
 * 展开包含 line 的所有折叠块（搜索导航跳到折叠体内的命中行时用）。
 * 无需展开时返回原 Set 引用，避免无谓重渲染。
 */
export function expandToLine(
  nodes: FoldNode[],
  line: number,
  collapsed: Set<number>,
): Set<number> {
  const next = new Set(collapsed);
  const walk = (list: FoldNode[]) => {
    for (const n of list) {
      if (n.line < line && line <= n.end) {
        next.delete(n.line);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return next.size === collapsed.size ? collapsed : next;
}
