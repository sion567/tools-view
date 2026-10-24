import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  allFoldLines,
  buildFoldTree,
  countFolds,
  type FoldNode,
} from "../lib/fold";
import type { ParseResponse } from "../lib/types";

/** 超过此行数停用折叠视图，回落纯文本，避免渲染上万个行组件 */
const FOLD_MAX_LINES = 3000;

interface FormatPanelProps {
  response: ParseResponse | null;
  busy: boolean;
  hidden?: boolean;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

interface Row {
  line: number;
  fold?: FoldNode;
  collapsed?: boolean;
  hiddenCount?: number;
}

export default function FormatPanel({
  response,
  busy,
  hidden,
  fullscreen,
  onToggleFullscreen,
}: FormatPanelProps) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());

  const pretty = response?.ok ? (response.pretty ?? "") : "";
  const error = response && !response.ok ? response.error : null;
  const format = response?.ok ? response.format : null;

  const lines = useMemo(() => (pretty ? pretty.split("\n") : []), [pretty]);
  const folds = useMemo(
    () => (pretty && format ? buildFoldTree(pretty, format) : []),
    [pretty, format],
  );
  const foldCount = useMemo(() => countFolds(folds), [folds]);
  const interactive = lines.length > 0 && lines.length <= FOLD_MAX_LINES;

  // 新内容到达后重置折叠状态（行号含义已变）
  useEffect(() => {
    setCollapsed(new Set());
  }, [pretty]);

  const toggle = (line: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  };
  const collapseAll = () => setCollapsed(new Set(allFoldLines(folds)));
  const expandAll = () => setCollapsed(new Set());

  const rows = useMemo<Row[]>(() => {
    if (!interactive) return [];
    const out: Row[] = [];
    // 渲染 lines[from, to) 区间，nodes 是区间内按行序排列的折叠块
    const walk = (from: number, to: number, nodes: FoldNode[]) => {
      let cursor = from;
      for (const node of nodes) {
        for (let i = cursor; i < node.line; i++) out.push({ line: i });
        const isCollapsed = collapsed.has(node.line);
        out.push({
          line: node.line,
          fold: node,
          collapsed: isCollapsed,
          hiddenCount: isCollapsed
            ? node.end - node.line - (node.hasCloser ? 1 : 0)
            : undefined,
        });
        if (isCollapsed) {
          cursor = node.end + 1;
          continue;
        }
        walk(node.line + 1, node.hasCloser ? node.end : node.end + 1, node.children);
        if (node.hasCloser) out.push({ line: node.end });
        cursor = node.end + 1;
      }
      for (let i = cursor; i < to; i++) out.push({ line: i });
    };
    walk(0, lines.length, folds);
    return out;
  }, [lines, folds, collapsed, interactive]);

  const gutterStyle = {
    "--gutter-w": `${String(lines.length).length + 1}ch`,
  } as CSSProperties;

  const copy = async () => {
    if (!pretty) return;
    try {
      await navigator.clipboard.writeText(pretty);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // 剪贴板不可用时忽略
    }
  };

  return (
    <section className={`panel format-panel${hidden ? " panel-hidden" : ""}`}>
      <header className="panel-header">
        <span className="panel-title">格式化区</span>
        {format && <span className={`badge fmt-${format}`}>{format.toUpperCase()}</span>}
        {pretty && lines.length > FOLD_MAX_LINES && (
          <span className="badge muted">超 {FOLD_MAX_LINES} 行，折叠视图已停用</span>
        )}
        <div className="panel-actions">
          {interactive && foldCount > 0 && (
            <>
              <button className="btn" onClick={collapseAll}>
                全部折叠
              </button>
              <button
                className="btn"
                onClick={expandAll}
                disabled={collapsed.size === 0}
              >
                全部展开
              </button>
            </>
          )}
          <button className="btn" onClick={copy} disabled={!pretty}>
            {copied ? "已复制" : "复制"}
          </button>
          <button
            className="btn"
            onClick={onToggleFullscreen}
            title={fullscreen ? "恢复并排显示" : "全屏显示此面板"}
          >
            {fullscreen ? "并排" : "全屏"}
          </button>
        </div>
      </header>
      <div className="panel-body">
        {error ? (
          <div className="error-box">
            <div className="error-title">✕ 解析失败</div>
            <div className="error-message">{error.message}</div>
            {(error.line !== null || error.column !== null) && (
              <div className="error-pos">
                行 {error.line ?? "?"}，列 {error.column ?? "?"}
              </div>
            )}
          </div>
        ) : pretty ? (
          interactive ? (
            <div className="pretty-lines" style={gutterStyle}>
              {rows.map((r) => (
                <div className="pl-row" key={r.line}>
                  <span className="pl-gutter">{r.line + 1}</span>
                  {r.fold ? (
                    <button
                      className="pl-toggle"
                      onClick={() => toggle(r.fold!.line)}
                      aria-label={r.collapsed ? "展开此块" : "折叠此块"}
                      aria-expanded={!r.collapsed}
                    >
                      {r.collapsed ? "▸" : "▾"}
                    </button>
                  ) : (
                    <span className="pl-toggle-sp" />
                  )}
                  <span className="pl-code">
                    {lines[r.line]}
                    {r.fold && r.collapsed && (
                      <span className="pl-summary">
                        {" … "}
                        {r.fold.hasCloser ? lines[r.fold.end].trim() : ""}
                        {r.hiddenCount ? `（隐藏 ${r.hiddenCount} 行）` : ""}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <pre className="pretty">{pretty}</pre>
          )
        ) : (
          <div className="placeholder">{busy ? "解析中…" : "解析结果将显示在这里"}</div>
        )}
      </div>
    </section>
  );
}
