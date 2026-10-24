import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  allFoldLines,
  buildFoldTree,
  countFolds,
  type FoldNode,
} from "../lib/fold";
import { saveTextFile } from "../lib/parse";
import type { Format, FormatTarget, ParseResponse } from "../lib/types";

/** 虚拟滚动的固定行高（与 .pretty-lines 的 line-height 一致） */
const ROW_H = 20;
/** 超过此行数停用折叠视图（解析成本保护） */
const FOLD_MAX_LINES = 100_000;

interface FormatPanelProps {
  response: ParseResponse | null;
  busy: boolean;
  target: FormatTarget;
  onTargetChange: (t: FormatTarget) => void;
  query: string;
  onQueryChange: (q: string) => void;
  /** 图线区节点点击请求定位：行号（0 基）+ 时间戳 */
  locate: { line: number; ts: number } | null;
  /** 点击错误位置，请求输入区定位 */
  onLocateEditor: (line: number) => void;
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

/** 命中关键字高亮 */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const lq = q.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  let key = 0;
  for (;;) {
    const at = lower.indexOf(lq, i);
    if (at < 0) {
      parts.push(<span key={key}>{text.slice(i)}</span>);
      break;
    }
    if (at > i) parts.push(<span key={key++}>{text.slice(i, at)}</span>);
    parts.push(
      <mark className="pl-hit" key={key++}>
        {text.slice(at, at + q.length)}
      </mark>,
    );
    i = at + q.length;
  }
  return <>{parts}</>;
}

const TARGET_OPTIONS: { value: FormatTarget; label: string }[] = [
  { value: "auto", label: "原格式" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "xml", label: "XML" },
  { value: "toml", label: "TOML" },
];

export default function FormatPanel({
  response,
  busy,
  target,
  onTargetChange,
  query,
  onQueryChange,
  locate,
  onLocateEditor,
  hidden,
  fullscreen,
  onToggleFullscreen,
}: FormatPanelProps) {
  const [copied, setCopied] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);
  const [flash, setFlash] = useState<{ line: number; ts: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const pretty = response?.ok ? (response.pretty ?? "") : "";
  const error = response && !response.ok ? response.error : null;
  const format = response?.ok ? response.format : null;
  const outFormat: Format | null = target === "auto" ? format : target;
  const q = query.trim().toLowerCase();

  const lines = useMemo(() => (pretty ? pretty.split("\n") : []), [pretty]);
  const folds = useMemo(
    () => (pretty && outFormat ? buildFoldTree(pretty, outFormat) : []),
    [pretty, outFormat],
  );
  const foldCount = useMemo(() => countFolds(folds), [folds]);
  const interactive = lines.length > 0 && lines.length <= FOLD_MAX_LINES;

  // 新内容到达后重置折叠状态（行号含义已变）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 新内容必须清掉旧折叠状态
    setCollapsed(new Set());
  }, [pretty]);

  // 虚拟滚动：监听滚动与容器尺寸
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [interactive]);

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
    if (q) {
      // 搜索态：忽略折叠结构，仅显示命中行
      const out: Row[] = [];
      lines.forEach((text, i) => {
        if (text.toLowerCase().includes(q)) out.push({ line: i });
      });
      return out;
    }
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
  }, [lines, folds, collapsed, interactive, q]);

  // 图线区节点定位：滚动到目标行并闪烁
  useEffect(() => {
    if (!locate) return;
    const el = containerRef.current;
    if (el) {
      el.scrollTo({ top: Math.max(0, locate.line * ROW_H - el.clientHeight / 2) });
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 定位请求到达时同步触发闪烁
    setFlash({ line: locate.line, ts: locate.ts });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locate?.ts]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 1800);
    return () => window.clearTimeout(t);
  }, [flash]);

  const gutterStyle = {
    "--gutter-w": `${String(lines.length).length + 1}ch`,
  } as CSSProperties;

  // 虚拟窗口
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 8);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_H) + 8);
  const visible = rows.slice(start, end);

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

  const save = async () => {
    if (!pretty || !outFormat) return;
    const r = await saveTextFile(pretty, `tools-view.${outFormat}`);
    if (r === "saved") {
      setSavedNote("已保存");
      setTimeout(() => setSavedNote(null), 1500);
    }
  };

  return (
    <section className={`panel format-panel${hidden ? " panel-hidden" : ""}`}>
      <header className="panel-header">
        <span className="panel-title">格式化区</span>
        {format && <span className={`badge fmt-${format}`}>{format.toUpperCase()}</span>}
        {target !== "auto" && outFormat && outFormat !== format && (
          <span className={`badge fmt-${outFormat}`}>→ {outFormat.toUpperCase()}</span>
        )}
        {lines.length > FOLD_MAX_LINES && (
          <span className="badge muted">超 {FOLD_MAX_LINES} 行，折叠视图已停用</span>
        )}
        <div className="panel-actions">
          {pretty && (
            <input
              className="search"
              type="search"
              placeholder="搜索…"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              aria-label="搜索格式化结果"
            />
          )}
          {q && <span className="badge muted">{rows.length} 处</span>}
          {pretty && (
            <select
              className="formatsel"
              value={target}
              onChange={(e) => onTargetChange(e.target.value as FormatTarget)}
              title="输出格式（转换）"
              aria-label="输出格式"
            >
              {TARGET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {interactive && !q && foldCount > 0 && (
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
            onClick={save}
            disabled={!pretty || !outFormat}
            title="保存到文件"
          >
            {savedNote ?? "保存"}
          </button>
          <button
            className="btn"
            onClick={onToggleFullscreen}
            title={fullscreen ? "恢复并排显示（Ctrl+1）" : "全屏显示此面板（Ctrl+2）"}
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
              <button
                className="error-pos error-jump"
                onClick={() => error.line != null && onLocateEditor(error.line)}
                disabled={error.line == null}
                title="点击定位到输入区对应行"
              >
                行 {error.line ?? "?"}，列 {error.column ?? "?"} ↩
              </button>
            )}
          </div>
        ) : pretty ? (
          interactive ? (
            <div
              className="pretty-lines"
              style={gutterStyle}
              ref={containerRef}
              role="region"
              aria-label="格式化结果"
            >
              <div style={{ height: rows.length * ROW_H }}>
                <div style={{ transform: `translateY(${start * ROW_H}px)` }}>
                  {visible.map((r) => (
                    <div
                      className={`pl-row${r.line === flash?.line ? " pl-flash" : ""}`}
                      key={r.line}
                    >
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
                        <Highlight text={lines[r.line]} q={q} />
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
              </div>
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
